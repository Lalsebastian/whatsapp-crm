// Final confirmation: the only place the booking flow writes to the CRM.
//
// One service  -> crm.createBooking (with an idempotency key).
// Several      -> crm.createBookings, a single all-or-nothing call, so the
//                 customer can never end up with only part of a multi-service
//                 request booked. Adapters without that capability fall back
//                 to one call per service (the pre-atomic behaviour).
const { randomUUID } = require('node:crypto');
const whatsapp = require('../../whatsapp/client');
const sessionStore = require('../../session/sessionStore');
const logger = require('../../utils/logger');
const { formatDateForCustomer, formatSlotForCustomer } = require('../dateUtils');
const { executeOnce } = require('../../reliability/actionGuard');
const { triggerEscalation } = require('../../escalation/escalationService');
const messageBudget = require('../../analytics/messageBudget');
const { crm, FLOW, correctionContext } = require('./shared');
const { showAvailability, promptForDate } = require('./schedule');
const { promptServiceList } = require('./servicePrompts');
const { checkBooking } = require('./qualityGate');
const { promptFinalConfirmation } = require('./summary');
const { promptChangeDetails, handleNaturalCorrection } = require('./corrections');
const { suggestAddOn } = require('./bundles');
const { invalidateCustomerProfile } = require('../../customer/customerProfileService');
const { ACTIONS, actionId } = require('../quickActions');

function bookingPayload(customer, item) {
  const payload = {
    customerId: customer.id,
    propertyId: item.propertyId,
    serviceId: item.serviceId,
    date: item.date,
    time: item.time,
  };
  if (item.slotId) payload.slotId = item.slotId;
  if (item.issue) payload.notes = item.issue;
  return payload;
}

async function serviceNameFor(item) {
  if (item.serviceName) return item.serviceName;
  const service = await crm.getServiceDetails(item.serviceId);
  return service ? service.name : 'Service';
}

function auditCreated(session, customer, booking, item, duplicate) {
  if (duplicate) {
    logger.audit('BOOKING_DUPLICATE_BLOCKED', {
      phone: session.phone,
      customerId: customer.id,
      sessionId: session.phone,
      result: 'existing_result_returned',
      bookingReference: booking.reference,
    });
    return;
  }
  logger.audit('BOOKING_CREATED', {
    phone: session.phone,
    customerId: customer.id,
    sessionId: session.phone,
    result: 'success',
    bookingReference: booking.reference,
    bookingId: booking.id,
    serviceId: item.serviceId,
  });
}

function auditRequested(session, customer, item) {
  logger.audit('BOOKING_CREATE_REQUESTED', {
    phone: session.phone,
    customerId: customer.id,
    sessionId: session.phone,
    result: 'requested',
    serviceId: item.serviceId,
  });
}

function auditFailure(session, customer, err, serviceId) {
  logger.error('BOOKING', 'createBooking failed:', err.message);
  logger.audit(err.duplicateBlocked ? 'BOOKING_DUPLICATE_BLOCKED' : 'BOOKING_CREATE_FAILED', {
    phone: session.phone,
    customerId: customer.id,
    sessionId: session.phone,
    result: err.uncertain ? 'uncertain' : 'failed',
    reason: err.code || err.message,
    serviceId,
  });
}

// A write that timed out may or may not have happened. Never retry it:
// hand it to staff to verify in the CRM, and tell the customer exactly that.
async function handleUncertainOutcome(session, customer, err, items) {
  let escalated = false;
  if (!err.duplicateBlocked) {
    try {
      await triggerEscalation({
        crm,
        phone: session.phone,
        customerId: customer.id,
        customer,
        session,
        reason: 'booking_creation_uncertain',
        summary: items.length > 1
          ? `A ${items.length}-service booking request timed out. Please verify the CRM before retrying.`
          : 'A booking creation request timed out. Please verify the CRM before retrying.',
        booking: items[0],
        originalCustomerMessage: items[0] && items[0].issue,
        suggestedNextAction: 'Verify whether the booking was created before attempting another booking submission.',
      });
      escalated = true;
    } catch (escalationError) {
      logger.error('BOOKING', 'Uncertain booking escalation failed:', escalationError.message);
    }
  }
  const message = err.duplicateBlocked
    ? 'Your booking request is already being checked. Please wait for our support team before trying again.'
    : `I'm sorry, I could not verify whether the booking was completed. I have kept your details and ${escalated ? 'asked our support team to check the request' : 'recommend contacting support before trying again'} so that a duplicate booking is not created.`;
  await whatsapp.sendText(session.phone, message);
}

async function handleSlotUnavailable(session) {
  await whatsapp.sendText(
    session.phone,
    'I\'m sorry, one of the selected times was just booked by someone else, so nothing has been booked yet. Please select Change Details to choose another time.'
  );
}

// Returns the confirmed bookings, or null when the flow already replied.
async function createSingle(session, customer, item, confirmationNonce) {
  const actionKey = `booking:${customer.id}:${confirmationNonce}:${item.actionId}`;
  auditRequested(session, customer, item);
  try {
    const { value: booking, duplicate } = await executeOnce(actionKey, () => crm.createBooking({
      ...bookingPayload(customer, item),
      idempotencyKey: `wa-${confirmationNonce}-${item.actionId}`,
    }));
    auditCreated(session, customer, booking, item, duplicate);
    return [{ ...booking, serviceName: await serviceNameFor(item), requestedDate: item.date, requestedTime: item.time }];
  } catch (err) {
    auditFailure(session, customer, err, item.serviceId);
    if (err.uncertain) {
      await handleUncertainOutcome(session, customer, err, [item]);
    } else if (err.code === 'SLOT_UNAVAILABLE') {
      await handleSlotUnavailable(session);
    } else {
      await whatsapp.sendText(session.phone, "I'm sorry, I couldn't confirm your booking because of a system error. Your booking details are still saved, so you can try Confirm Booking again.");
    }
    return null;
  }
}

async function createAtomically(session, customer, cart, confirmationNonce) {
  const actionKey = `booking-batch:${customer.id}:${confirmationNonce}`;
  cart.forEach((item) => auditRequested(session, customer, item));
  try {
    const { value: bookings, duplicate } = await executeOnce(actionKey, async () => {
      const created = await crm.createBookings({
        customerId: customer.id,
        items: cart.map((item) => {
          const { customerId, ...itemPayload } = bookingPayload(customer, item);
          return itemPayload;
        }),
        idempotencyKey: `wa-${confirmationNonce}`,
      });
      if (!Array.isArray(created) || created.length !== cart.length) {
        // The CRM answered but not with one booking per requested service:
        // we cannot tell what was stored, so treat it as uncertain.
        const error = new Error(`createBookings returned ${Array.isArray(created) ? created.length : 'no'} bookings for ${cart.length} services`);
        error.code = 'BOOKING_BATCH_MISMATCH';
        error.uncertain = true;
        throw error;
      }
      return created;
    });
    const confirmed = [];
    for (let index = 0; index < cart.length; index += 1) {
      auditCreated(session, customer, bookings[index], cart[index], duplicate);
      confirmed.push({
        ...bookings[index],
        serviceName: await serviceNameFor(cart[index]),
        requestedDate: cart[index].date,
        requestedTime: cart[index].time,
      });
    }
    logger.audit('BOOKING_BATCH_CREATED', {
      phone: session.phone,
      customerId: customer.id,
      count: cart.length,
      result: duplicate ? 'existing_result_returned' : 'success',
    });
    return confirmed;
  } catch (err) {
    auditFailure(session, customer, err, null);
    if (err.uncertain) {
      await handleUncertainOutcome(session, customer, err, cart);
    } else if (err.code === 'SLOT_UNAVAILABLE') {
      await handleSlotUnavailable(session);
    } else {
      await whatsapp.sendText(session.phone, `I'm sorry, I couldn't confirm your bookings because of a system error. None of the ${cart.length} services were booked, and your details are still saved, so you can try Confirm Booking again.`);
    }
    return null;
  }
}

// Fallback for CRMs without createBookings: one call per service. A failure
// part-way keeps the remaining services saved for another attempt.
async function createSequentially(session, customer, cart, confirmationNonce) {
  const confirmed = [];
  for (let index = 0; index < cart.length; index += 1) {
    const item = cart[index];
    const actionKey = `booking:${customer.id}:${confirmationNonce}:${item.actionId}`;
    auditRequested(session, customer, item);
    try {
      const { value: booking, duplicate } = await executeOnce(actionKey, () => crm.createBooking({
        ...bookingPayload(customer, item),
        idempotencyKey: `wa-${confirmationNonce}-${item.actionId}`,
      }));
      auditCreated(session, customer, booking, item, duplicate);
      confirmed.push({ ...booking, serviceName: await serviceNameFor(item), requestedDate: item.date, requestedTime: item.time });
    } catch (err) {
      auditFailure(session, customer, err, item.serviceId);
      if (err.uncertain) {
        await handleUncertainOutcome(session, customer, err, [item]);
        return null;
      }
      if (confirmed.length === 0) {
        await whatsapp.sendText(session.phone, "I'm sorry, I couldn't confirm your booking because of a system error. Your booking details are still saved, so you can try Confirm Booking again.");
      } else {
        await sessionStore.setFlow(session.phone, FLOW, 'confirm', { cart: cart.slice(index), confirmationNonce });
        const references = confirmed.map((booking) => booking.reference).join(', ');
        await whatsapp.sendText(session.phone, `I confirmed ${confirmed.length} service${confirmed.length > 1 ? 's' : ''} (${references}), but I could not confirm the remaining service${cart.length - index > 1 ? 's' : ''}. The remaining details are still saved; please try again or type "support".`);
      }
      return null;
    }
  }
  return confirmed;
}

async function completeBooking(session, customer, confirmed, cart = []) {
  await sessionStore.clearFlow(session.phone);
  logger.audit('CONVERSATION_COMPLETED', {
    phone: session.phone,
    sessionId: session.phone,
    customerId: customer.id,
    flow: FLOW,
    outcome: 'booking_created',
    count: confirmed.length,
    result: 'completed',
  });
  invalidateCustomerProfile(customer.id);
  const summaries = confirmed.map((booking) =>
    `Reference: *${booking.reference}*\nService: ${booking.serviceName}\nDate: ${formatDateForCustomer(booking.scheduledDate || booking.requestedDate)}\nTime: ${formatSlotForCustomer(String(booking.scheduledTime || booking.requestedTime || '').slice(0, 5))}`
  );
  const first = cart[0] || {};
  const addOn = await suggestAddOn(crm, cart);
  const addPayload = (serviceId) => actionId(ACTIONS.ADD_SERVICE, `${serviceId}~${first.propertyId || ''}~${first.date || ''}`);
  const tip = addOn
    ? `\n\nMany customers add ${addOn.service.name} with ${addOn.bookedLabel}. Tap below to add it for the same address and date.`
    : '';
  const body = `Your booking${confirmed.length > 1 ? 's are' : ' is'} confirmed ✅\n\n${summaries.join('\n\n')}\n\nWe'll keep you updated here on WhatsApp.${tip}`;
  const buttons = [
    { id: actionId(ACTIONS.VIEW_BOOKING, confirmed[0].id), title: confirmed.length > 1 ? 'View Bookings' : 'View Booking' },
    addOn
      ? { id: addPayload(addOn.service.id), title: `Add ${addOn.shortLabel}`.slice(0, 20) }
      : { id: addPayload('*'), title: 'Add Another Service' },
    { id: 'MAIN_MENU', title: 'Main Menu' },
  ];
  if (confirmed.length > 1 || !confirmed[0].id) buttons[0] = { id: 'MY_BOOKINGS', title: confirmed.length > 1 ? 'View Bookings' : 'View Booking' };
  // WhatsApp caps an interactive body at 1024 characters; a long multi-service
  // summary goes as text, with the actions in a short follow-up.
  if (body.length <= 1000) {
    await whatsapp.sendButtons(session.phone, body, buttons);
  } else {
    await whatsapp.sendText(session.phone, body);
    await whatsapp.sendButtons(session.phone, 'What would you like to do next?', buttons);
  }
  if (addOn) {
    logger.audit('ADD_ON_SUGGESTED', { phone: session.phone, customerId: customer.id, serviceId: addOn.service.id, result: 'suggested' });
  }
  const messageCount = messageBudget.complete(session.phone);
  logger.audit('BOOKING_COST_SUMMARY', {
    phone: session.phone,
    sessionId: session.phone,
    customerId: customer.id,
    botMessages: messageCount.botMessages,
    templateMessages: messageCount.templateMessages,
    aiCalls: messageCount.aiCalls,
    aiCallsAvoided: messageCount.aiCallsAvoided,
    estimatedCost: messageCount.estimatedCost,
    currency: messageCount.currency,
    result: 'completed',
  });
  logger.audit('BOOKING_CUSTOMER_TURNS', {
    phone: session.phone,
    sessionId: session.phone,
    customerId: customer.id,
    turns: messageCount.customerMessages,
    result: 'completed',
  });
  logger.audit('BOOKING_BOT_TURNS', {
    phone: session.phone,
    sessionId: session.phone,
    customerId: customer.id,
    turns: messageCount.botMessages,
    result: 'completed',
  });
  logger.audit('BOOKING_MESSAGES_TO_COMPLETE', {
    phone: session.phone,
    sessionId: session.phone,
    customerId: customer.id,
    botMessages: messageCount.botMessages,
    customerMessages: messageCount.customerMessages,
    totalMessages: messageCount.botMessages + messageCount.customerMessages,
    fieldsExtractedFirstMessage: messageCount.fieldsExtractedFirstMessage,
    redundantQuestionsAvoided: messageCount.redundantQuestionsAvoided,
    withinFourBotMessages: messageCount.botMessages <= 4,
    fastPathUsed: messageCount.fastPathUsed,
    result: 'completed',
  });
}

async function handleConfirm(session, customer, input) {
  if (input.buttonId === 'CANCEL_FLOW') {
    await whatsapp.sendButtons(session.phone, 'Would you like to cancel this booking request?', [
      { id: 'CONFIRM_CANCEL_FLOW', title: 'Yes, Cancel' },
      { id: 'KEEP_BOOKING', title: 'Keep Booking' },
    ]);
    await sessionStore.setFlow(session.phone, FLOW, 'confirm_cancel', session.context);
    return;
  }
  if (['CHANGE_BOOKING_DETAILS', 'CHANGE_DETAILS'].includes(input.buttonId)) {
    const item = session.context.cart && session.context.cart[session.context.cart.length - 1];
    if (item) return promptChangeDetails(session, session.context.cart.slice(0, -1), item);
  }
  if (input.text) {
    const item = session.context.cart && session.context.cart[session.context.cart.length - 1];
    if (item) {
      return handleNaturalCorrection(
        session,
        customer,
        input,
        session.context.cart.slice(0, -1),
        item
      );
    }
  }
  if (input.buttonId === 'CONFIRM_DUPLICATE') {
    return handleConfirm({ ...session, context: { ...session.context, allowDuplicate: true } }, customer, { buttonId: 'CONFIRM_BOOKING', allowDuplicate: true });
  }
  if (input.buttonId !== 'CONFIRM_BOOKING') {
    await whatsapp.sendText(session.phone, 'Please select Confirm Booking, Change Details, or Cancel.');
    return;
  }
  logger.audit('BOOKING_CONFIRMED', {
    phone: session.phone,
    sessionId: session.phone,
    customerId: customer.id,
    flow: FLOW,
    step: 'confirm',
    source: 'button',
    result: 'confirmed',
  });

  const fallbackItem = {
    serviceId: session.context.serviceId,
    propertyId: session.context.propertyId,
    serviceName: session.context.serviceName,
    propertyLabel: session.context.propertyLabel,
    date: session.context.date,
    time: session.context.time,
    issue: session.context.issue,
  };
  const cart = session.context.cart && session.context.cart.length ? session.context.cart : [fallbackItem];
  const confirmationNonce = session.context.confirmationNonce || randomUUID();
  session.context.confirmationNonce = confirmationNonce;
  cart.forEach((item) => {
    if (!item.actionId) item.actionId = randomUUID();
  });
  if (cart.some((item) => !item.serviceId || !item.propertyId || !item.date || !item.time)) {
    logger.error('BOOKING', 'Missing required fields at confirm step', session.context);
    await whatsapp.sendText(session.phone, 'I\'m sorry, some booking details are missing, so I could not complete the request. Please type "menu" to start again.');
    await sessionStore.clearFlow(session.phone);
    return;
  }

  const gate = await checkBooking(crm, customer, cart, {
    phone: session.phone,
    allowDuplicate: !!(input.allowDuplicate || session.context.allowDuplicate),
  });
  logger.audit('BOOKING_GATE_CHECKED', {
    phone: session.phone,
    customerId: customer && customer.id,
    itemCount: cart.length,
    result: gate.ok ? 'passed' : gate.problem,
  });
  if (!gate.ok) return handleGateFailure(session, customer, cart, gate, confirmationNonce);

  let confirmed;
  if (cart.length === 1) {
    confirmed = await createSingle(session, customer, cart[0], confirmationNonce);
  } else if (typeof crm.createBookings === 'function') {
    confirmed = await createAtomically(session, customer, cart, confirmationNonce);
  } else {
    confirmed = await createSequentially(session, customer, cart, confirmationNonce);
  }
  if (confirmed) await completeBooking(session, customer, confirmed, cart);
}

// Explains exactly what changed since the summary was shown, and goes
// straight to fixing that one detail, keeping everything else.
async function handleGateFailure(session, customer, cart, gate, confirmationNonce) {
  const item = cart[gate.index] || cart[0];
  const others = cart.filter((_, index) => index !== gate.index);
  const when = `${formatDateForCustomer(item.date)} at ${formatSlotForCustomer(String(item.time).slice(0, 5))}`;
  const service = item.serviceName || 'this service';
  switch (gate.problem) {
    case 'slot_unavailable':
    case 'slot_passed':
      await whatsapp.sendText(session.phone, gate.problem === 'slot_passed'
        ? `The ${when} time has already passed, so nothing has been booked yet. Here are the times still open:`
        : `I'm sorry, the ${when} time for ${service} was just taken, so nothing has been booked yet. Here are the times still open:`);
      return showAvailability(session, correctionContext(item, others, ['time']), item.date);
    case 'date_past':
      await whatsapp.sendText(session.phone, `${formatDateForCustomer(item.date)} has already passed, so nothing has been booked yet. Please choose a new date.`);
      return promptForDate(session, { ...correctionContext(item, others, ['date']), date: undefined });
    case 'service_unavailable':
      await whatsapp.sendText(session.phone, `${service} is no longer available to book, so nothing has been booked yet. Please choose another service.`);
      return promptServiceList(session, await crm.getServices(), correctionContext(item, others, ['service']));
    case 'property_not_found':
    case 'not_serviceable':
      await whatsapp.sendText(session.phone, gate.problem === 'not_serviceable'
        ? `${service} isn't available at ${item.propertyLabel || 'that address'} at the moment, so nothing has been booked yet. Please send another service address.`
        : 'I couldn\'t find that service address on your account any more, so nothing has been booked yet. Please send the full service address.');
      return sessionStore.setFlow(session.phone, FLOW, 'awaiting_new_property', {
        ...correctionContext(item, others, ['property']),
        propertyId: undefined,
        propertyLabel: undefined,
        location: undefined,
      });
    case 'duplicate_booking':
      await whatsapp.sendButtons(
        session.phone,
        `You already have ${service} booked for ${formatDateForCustomer(gate.existing.scheduledDate)} (${gate.existing.reference}). Would you still like to book another visit?`,
        [
          { id: gate.existing.id ? actionId(ACTIONS.VIEW_BOOKING, gate.existing.id) : 'MY_BOOKINGS', title: 'View Booking' },
          { id: 'CONFIRM_DUPLICATE', title: 'Book Anyway' },
          { id: 'CHANGE_DETAILS', title: 'Change Details' },
        ]
      );
      return sessionStore.setFlow(session.phone, FLOW, 'confirm', { ...session.context, cart, confirmationNonce });
    case 'duplicate_in_cart':
      await whatsapp.sendText(session.phone, `${service} at ${when} is in this request twice. Please choose a different time for the second one.`);
      return showAvailability(session, correctionContext(item, others, ['time']), item.date);
    default:
      await whatsapp.sendText(session.phone, 'I\'m sorry, I couldn\'t verify your booking details, so nothing has been booked. Please type "menu" to start again, or "support" for help.');
      return sessionStore.clearFlow(session.phone);
  }
}

async function handleConfirmCancel(session, customer, input) {
  if (input.buttonId === 'CONFIRM_CANCEL_FLOW') {
    logger.audit('BOOKING_CANCELLED_BEFORE_CREATION', {
      phone: session.phone, sessionId: session.phone, customerId: customer.id,
      flow: FLOW, step: 'confirm_cancel', source: 'button', result: 'cancelled',
    });
    logger.audit('BOOKING_ABANDONED', {
      phone: session.phone, sessionId: session.phone, customerId: customer.id,
      flow: FLOW, step: 'confirm_cancel', reason: 'explicit_cancellation', result: 'abandoned',
    });
    await sessionStore.clearFlow(session.phone);
    messageBudget.reset(session.phone);
    await whatsapp.sendText(session.phone, 'Your booking request has been cancelled. No booking was created. Type "menu" whenever you would like to start again.');
    return;
  }
  if (input.buttonId === 'KEEP_BOOKING') {
    return promptFinalConfirmation(session, session.context.cart || []);
  }
  await whatsapp.sendText(session.phone, 'Please select Yes, Cancel or Keep Booking.');
}

module.exports = {
  handleConfirm,
  handleConfirmCancel,
};
