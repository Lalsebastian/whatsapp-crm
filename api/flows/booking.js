// Hybrid booking flow. Buttons/lists remain the fastest path, while text and
// transcribed voice notes can prefill fields. AI only interprets input; every
// service, property, date and slot is validated against CRM data before the
// backend performs any booking action.
const whatsapp = require('../whatsapp/client');
const sessionStore = require('../session/sessionStore');
const logger = require('../utils/logger');
const { parseDateInput, formatDateForCustomer, formatSlotForCustomer } = require('./dateUtils');
const { matchServiceToCatalog } = require('../ai/intentService');
const AI_CONFIDENCE = require('../ai/confidence');
const { getCrmAdapter } = require('../crm');
const { randomUUID } = require('node:crypto');
const { executeOnce } = require('../reliability/actionGuard');
const { triggerEscalation } = require('../escalation/escalationService');

const crm = getCrmAdapter();
const FLOW = 'booking';

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchServiceByText(text, services) {
  const lower = String(text || '').trim().toLowerCase();
  if (!lower) return null;
  const byCategory = services.filter((service) => service.category &&
    new RegExp(`\\b${escapeRegex(service.category)}\\b`, 'i').test(lower));
  if (byCategory.length === 1) return byCategory[0];
  const byName = services.filter((service) => {
    const name = String(service.name || '').toLowerCase();
    return name && (lower.includes(name) || name.includes(lower));
  });
  return byName.length === 1 ? byName[0] : null;
}

function propertyDisplay(property) {
  const place = [property.area, property.city].filter(Boolean).join(', ');
  return property.label ? `${property.label}${place ? ` — ${place}` : ''}` : property.addressLine;
}

function matchSavedProperty(locationHint, properties) {
  const hint = String(locationHint || '').trim().toLowerCase();
  if (!hint) return null;
  const matches = properties.filter((property) =>
    [property.label, property.addressLine, property.area, property.city]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(hint) || hint.includes(String(value).toLowerCase()))
  );
  return matches.length === 1 ? matches[0] : null;
}

function selectPreferredSlot(preference, slots) {
  const wanted = String(preference || '').trim().toLowerCase();
  if (!wanted) return null;
  const exact = slots.filter((slot) =>
    String(slot).toLowerCase() === wanted || formatSlotForCustomer(slot).toLowerCase() === wanted
  );
  if (exact.length === 1) return exact[0];
  const clock = wanted.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (clock) {
    let requestedHour = Number(clock[1]);
    const requestedMinute = Number(clock[2] || 0);
    const period = clock[3] || (/evening|night|shaam|vaikunneram/.test(wanted) ? 'pm' : null);
    if (period === 'pm' && requestedHour < 12) requestedHour += 12;
    if (period === 'am' && requestedHour === 12) requestedHour = 0;
    const requestedTotal = requestedHour * 60 + requestedMinute;
    const candidates = slots
      .map((slot) => {
        const match = String(slot).match(/^(\d{1,2}):(\d{2})/);
        return match ? { slot, total: Number(match[1]) * 60 + Number(match[2]) } : null;
      })
      .filter(Boolean)
      .filter((entry) => /\bafter\b/.test(wanted) ? entry.total >= requestedTotal : entry.total === requestedTotal)
      .sort((a, b) => a.total - b.total);
    if (candidates.length > 0) return candidates[0].slot;
  }
  const periodMatches = slots.filter((slot) => {
    const hourMatch = String(slot).match(/^(\d{1,2}):/);
    if (!hourMatch) return false;
    const hour = Number(hourMatch[1]);
    if (/morning|ravile|raavile|subah/.test(wanted)) return hour < 12;
    if (/afternoon|uchakku|dopahar/.test(wanted)) return hour >= 12 && hour < 17;
    if (/evening|vaikunneram|shaam|night/.test(wanted)) return hour >= 17;
    return false;
  });
  return periodMatches.length === 1 ? periodMatches[0] : null;
}

function aiPrefill(input = {}) {
  const ai = input.ai || {};
  return {
    issue: ai.issue || null,
    locationHint: ai.locationHint || null,
    date: parseDateInput(ai.preferredDate),
    preferredTime: ai.preferredTime || null,
    voiceNotes: input.voice ? [input.voice] : [],
    cart: [],
  };
}

async function promptServiceList(session, services, context = {}, intro) {
  await whatsapp.sendListMessage(
    session.phone,
    intro || 'Certainly. What service can I help you with? You can select one below or describe the problem in your own words.',
    'Choose service',
    [{ title: 'Available Services', rows: services.slice(0, 10).map((service) => ({
      id: `SVC_${service.id}`,
      title: service.name,
      description: service.basePrice ? `From AED ${service.basePrice}` : (service.description || ''),
    })) }]
  );
  await sessionStore.setFlow(session.phone, FLOW, 'select_service', context);
}

async function promptServiceConfirmation(session, service, context) {
  await whatsapp.sendButtons(session.phone, `It sounds like you need ${service.name}. Is that correct?`, [
    { id: 'CONFIRM_INFERRED_SERVICE', title: `Yes, ${service.name}` },
    { id: 'CHOOSE_ANOTHER_SERVICE', title: 'Choose Another' },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'confirm_service', { ...context, inferredServiceId: service.id });
}

async function resolveSemanticService(session, text, services) {
  const result = await matchServiceToCatalog(text, services, { preferredLanguage: session.preferredLanguage });
  if (!result.serviceId || result.confidence < AI_CONFIDENCE.MEDIUM) return null;
  const service = services.find((item) => String(item.id) === String(result.serviceId));
  return service ? { service, confidence: result.confidence } : null;
}

async function startBooking(session, customer, input = {}) {
  logger.log('BOOKING_STARTED', { phone: session.phone });
  const services = await crm.getServices();
  if (!services || services.length === 0) {
    await whatsapp.sendText(session.phone, "I'm sorry, our services are not available for booking right now. Please try again shortly, or type \"support\" to speak with our team.");
    return;
  }
  const context = aiPrefill(input);
  if (input.ai) {
    const deterministic = matchServiceByText(input.ai.service, services);
    const semantic = deterministic ? null : await resolveSemanticService(session, input.text, services);
    const service = deterministic || (semantic && semantic.service);
    if (service) return promptServiceConfirmation(session, service, context);
    logger.log('AI_FALLBACK_USED', { flow: FLOW, reason: 'service_not_resolved' });
  }
  await promptServiceList(session, services, context);
}

async function continueWithService(session, customer, service, priorContext = {}) {
  logger.log('SERVICE_SELECTED', { phone: session.phone, serviceId: service.id });
  const { inferredServiceId, ...cleanContext } = priorContext;
  const context = {
    ...cleanContext,
    serviceId: service.id,
    serviceName: service.name,
    price: service.basePrice || null,
  };
  if (context.propertyId) return advanceAfterProperty(session, context);

  const properties = await crm.getCustomerProperties(customer.id);
  const matchedProperty = matchSavedProperty(context.locationHint, properties);
  if (matchedProperty) {
    return advanceAfterProperty(session, {
      ...context,
      propertyId: matchedProperty.id,
      propertyLabel: propertyDisplay(matchedProperty),
    });
  }
  if (properties.length === 0) {
    const noted = context.locationHint ? ` I noted “${context.locationHint}”, but I still need the full address.` : '';
    await whatsapp.sendText(session.phone, `Please send the full service address.${noted}`);
    await sessionStore.setFlow(session.phone, FLOW, 'awaiting_new_property', context);
    return;
  }

  const propertyOptions = {};
  const rows = properties.slice(0, 9).map((property) => {
    propertyOptions[property.id] = propertyDisplay(property);
    return {
      id: `PROP_${property.id}`,
      title: property.label || property.addressLine.slice(0, 24),
      description: [property.addressLine, property.area, property.city].filter(Boolean).join(', ').slice(0, 72),
    };
  });
  rows.push({ id: 'PROP_NEW', title: 'Use Another Address', description: 'Enter a different service address' });
  await whatsapp.sendListMessage(session.phone, `Where would you like the ${service.name} professional to visit?`, 'Choose address', [
    { title: 'Saved Addresses', rows },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'select_property', { ...context, propertyOptions });
}

async function handleSelectService(session, customer, input) {
  const services = await crm.getServices();
  const voiceContext = input.voice
    ? { ...session.context, voiceNotes: [...(session.context.voiceNotes || []), input.voice] }
    : session.context;
  if (input.buttonId && input.buttonId.startsWith('SVC_')) {
    const service = await crm.getServiceDetails(input.buttonId.replace('SVC_', ''));
    if (service) return continueWithService(session, customer, service, voiceContext);
  } else if (input.text) {
    const deterministic = matchServiceByText(input.text, services);
    if (deterministic) {
      return continueWithService(session, customer, deterministic, voiceContext);
    }
    const semantic = await resolveSemanticService(session, input.text, services);
    if (semantic) {
      return promptServiceConfirmation(session, semantic.service, {
        ...voiceContext,
        issue: voiceContext.issue || input.text.trim(),
        aiServiceConfidence: semantic.confidence,
      });
    }
    logger.log('AI_LOW_CONFIDENCE', { flow: FLOW, step: 'select_service' });
  }
  const message = input.buttonId
    ? "I'm sorry, that service is no longer available. Please select another service."
    : "I couldn't confidently match that request to an available service. Please select the closest option below.";
  await promptServiceList(session, services, voiceContext, message);
}

async function handleConfirmService(session, customer, input) {
  if (input.buttonId === 'CHOOSE_ANOTHER_SERVICE') {
    const services = await crm.getServices();
    const { inferredServiceId, ...context } = session.context;
    return promptServiceList(session, services, context, 'Certainly. Please choose another service or describe what you need.');
  }
  if (input.buttonId !== 'CONFIRM_INFERRED_SERVICE') {
    await whatsapp.sendText(session.phone, 'Please confirm the suggested service or choose another service.');
    return;
  }
  const service = await crm.getServiceDetails(session.context.inferredServiceId);
  if (!service) {
    const services = await crm.getServices();
    return promptServiceList(session, services, session.context, 'That service is no longer available. Please choose another service.');
  }
  await continueWithService(session, customer, service, session.context);
}

async function handleSelectProperty(session, customer, input) {
  if (input.buttonId === 'PROP_NEW') {
    await whatsapp.sendText(session.phone, 'Certainly. Please send the full service address.');
    await sessionStore.setFlow(session.phone, FLOW, 'awaiting_new_property', session.context);
    return;
  }
  let propertyId = input.buttonId && input.buttonId.startsWith('PROP_')
    ? input.buttonId.replace('PROP_', '')
    : null;
  if (!propertyId && input.text) {
    const words = input.text.toLowerCase().split(/\W+/).filter((word) => word.length > 2 && !['the', 'my', 'address'].includes(word));
    const matches = Object.entries(session.context.propertyOptions || {}).filter(([, label]) =>
      words.length > 0 && words.every((word) => String(label).toLowerCase().includes(word))
    );
    if (matches.length === 1) propertyId = matches[0][0];
  }
  if (!propertyId) {
    await whatsapp.sendText(session.phone, 'Please select a saved address or choose Use Another Address.');
    return;
  }
  await advanceAfterProperty(session, {
    ...session.context,
    voiceNotes: input.voice ? [...(session.context.voiceNotes || []), input.voice] : session.context.voiceNotes,
    propertyId,
    propertyLabel: session.context.propertyOptions && session.context.propertyOptions[propertyId],
    propertyOptions: undefined,
  });
}

async function handleAwaitingNewProperty(session, customer, input) {
  if (!input.text || input.text.trim().length < 5) {
    await whatsapp.sendText(session.phone, 'Please send the full service address so our technician can locate it.');
    return;
  }
  const property = await crm.addProperty(customer.id, { addressLine: input.text.trim() });
  await advanceAfterProperty(session, {
    ...session.context,
    propertyId: property.id,
    propertyLabel: propertyDisplay(property),
  });
}

async function advanceAfterProperty(session, context) {
  if (context.date) return showAvailability(session, context, context.date);
  await promptForDate(session, context);
}

async function promptForDate(session, context) {
  await whatsapp.sendButtons(session.phone, 'What date would you prefer? Select an option below, or enter a date in YYYY-MM-DD format.', [
    { id: 'DATE_TODAY', title: 'Today' },
    { id: 'DATE_TOMORROW', title: 'Tomorrow' },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'select_date', context);
}

async function showAvailability(session, context, date) {
  const slots = await crm.getAvailability(context.serviceId, date);
  const dateLabel = formatDateForCustomer(date);
  if (!slots || slots.length === 0) {
    const { date: ignoredDate, time: ignoredTime, ...retryContext } = context;
    await whatsapp.sendText(session.phone, `I'm sorry, we don't have any available times on ${dateLabel}. Please select another date.`);
    await sessionStore.setFlow(session.phone, FLOW, 'select_date', retryContext);
    return;
  }
  const preferredSlot = selectPreferredSlot(context.preferredTime, slots);
  if (preferredSlot) return promptItemReview(session, { ...context, date, time: preferredSlot });
  await whatsapp.sendListMessage(session.phone, `Available times for ${dateLabel}:`, 'Choose time', [
    { title: 'Available Times', rows: slots.slice(0, 10).map((slot) => ({
      id: `SLOT_${slot}`,
      title: formatSlotForCustomer(slot),
    })) },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'select_slot', { ...context, date, availableSlots: slots });
}

async function handleSelectDate(session, customer, input) {
  let date = null;
  if (input.buttonId === 'DATE_TODAY') date = parseDateInput('today');
  else if (input.buttonId === 'DATE_TOMORROW') date = parseDateInput('tomorrow');
  else if (input.text) date = parseDateInput(input.ai && input.ai.preferredDate) || parseDateInput(input.text);
  if (!date) {
    await whatsapp.sendText(session.phone, "I couldn't identify that date. Please enter it in YYYY-MM-DD format, or select Today or Tomorrow.");
    return;
  }
  await showAvailability(session, {
    ...session.context,
    voiceNotes: input.voice ? [...(session.context.voiceNotes || []), input.voice] : session.context.voiceNotes,
    preferredTime: (input.ai && input.ai.preferredTime) || session.context.preferredTime,
  }, date);
}

async function handleSelectSlot(session, customer, input) {
  let time = input.buttonId && input.buttonId.startsWith('SLOT_')
    ? input.buttonId.replace('SLOT_', '')
    : null;
  if (!time && input.text) {
    time = selectPreferredSlot(
      (input.ai && input.ai.preferredTime) || input.text,
      session.context.availableSlots || []
    );
  }
  if (!time) {
    await whatsapp.sendText(session.phone, 'Please select one of the available times from the list above.');
    return;
  }
  const { availableSlots, ...context } = session.context;
  await promptItemReview(session, {
    ...context,
    time,
    voiceNotes: input.voice ? [...(context.voiceNotes || []), input.voice] : context.voiceNotes,
  });
}

async function promptItemReview(session, context) {
  let serviceName = context.serviceName;
  if (!serviceName) {
    const service = await crm.getServiceDetails(context.serviceId);
    serviceName = service ? service.name : 'Service';
  }
  const currentItem = {
    serviceId: context.serviceId,
    serviceName,
    propertyId: context.propertyId,
    propertyLabel: context.propertyLabel || context.locationHint || 'Saved service address',
    date: context.date,
    time: context.time,
    issue: context.issue || null,
  };
  const issueLine = currentItem.issue ? `\n📝 ${currentItem.issue}` : '';
  await whatsapp.sendButtons(
    session.phone,
    `Here's what I have:\n\n🔧 ${currentItem.serviceName}\n📍 ${currentItem.propertyLabel}\n📅 ${formatDateForCustomer(currentItem.date)}\n🕙 ${formatSlotForCustomer(currentItem.time)}${issueLine}\n\nWould you like to add another service or continue with this booking?`,
    [
      { id: 'ADD_ANOTHER_SERVICE', title: 'Add Another Service' },
      { id: 'PROCEED_TO_BOOKING', title: 'Proceed to Booking' },
      { id: 'CHANGE_BOOKING_DETAILS', title: 'Change Details' },
    ]
  );
  await sessionStore.setFlow(session.phone, FLOW, 'review_item', { ...context, currentItem });
}

async function handleReviewItem(session, customer, input) {
  const { currentItem } = session.context;
  if (!currentItem) {
    await whatsapp.sendText(session.phone, 'I could not find the service details. Please type "menu" to start again.');
    return;
  }
  if (input.buttonId === 'CHANGE_BOOKING_DETAILS') {
    return promptChangeDetails(session, session.context.cart || [], currentItem);
  }
  if (!['ADD_ANOTHER_SERVICE', 'PROCEED_TO_BOOKING'].includes(input.buttonId)) {
    await whatsapp.sendText(session.phone, 'Please select Add Another Service, Proceed to Booking, or Change Details.');
    return;
  }
  const cart = [...(session.context.cart || []), currentItem];
  if (input.buttonId === 'ADD_ANOTHER_SERVICE') {
    const services = await crm.getServices();
    return promptServiceList(session, services, {
      cart,
      propertyId: currentItem.propertyId,
      propertyLabel: currentItem.propertyLabel,
      date: currentItem.date,
    }, 'Your service is ready to book. What other service would you like to add for the same address?');
  }
  await promptFinalConfirmation(session, cart);
}

async function promptChangeDetails(session, cart, currentItem) {
  await whatsapp.sendButtons(session.phone, 'Which booking detail would you like to change?', [
    { id: 'CHANGE_SERVICE', title: 'Service' },
    { id: 'CHANGE_ADDRESS', title: 'Address' },
    { id: 'CHANGE_DATE_TIME', title: 'Date / Time' },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'change_details', { cart, currentItem });
}

async function handleChangeDetails(session, customer, input) {
  const { cart = [], currentItem } = session.context;
  if (!currentItem) {
    await whatsapp.sendText(session.phone, 'I could not find the booking details. Please type "menu" to start again.');
    return;
  }
  if (input.buttonId === 'CHANGE_SERVICE') {
    const services = await crm.getServices();
    return promptServiceList(session, services, {
      cart,
      propertyId: currentItem.propertyId,
      propertyLabel: currentItem.propertyLabel,
      date: currentItem.date,
      issue: currentItem.issue,
    }, 'Certainly. Please choose the service you need.');
  }
  if (input.buttonId === 'CHANGE_ADDRESS') {
    const service = await crm.getServiceDetails(currentItem.serviceId);
    return continueWithService(session, customer, service || {
      id: currentItem.serviceId,
      name: currentItem.serviceName,
    }, {
      cart,
      date: currentItem.date,
      issue: currentItem.issue,
    });
  }
  if (input.buttonId === 'CHANGE_DATE_TIME') {
    return promptForDate(session, { ...currentItem, cart, date: undefined, time: undefined });
  }
  await whatsapp.sendText(session.phone, 'Please select Service, Address, or Date / Time.');
}

async function promptFinalConfirmation(session, cart) {
  const preparedCart = cart.map((item) => ({ ...item, actionId: item.actionId || randomUUID() }));
  const confirmationNonce = randomUUID();
  const lines = preparedCart.map((item, index) =>
    `${preparedCart.length > 1 ? `${index + 1}. ` : ''}${item.serviceName}\n📍 ${item.propertyLabel}\n📅 ${formatDateForCustomer(item.date)}\n🕙 ${formatSlotForCustomer(item.time)}`
  );
  await whatsapp.sendButtons(
    session.phone,
    `Everything is ready.\n\n${lines.join('\n\n')}\n\nShall I confirm ${preparedCart.length > 1 ? 'these bookings' : 'the booking'}?`,
    [
      { id: 'CONFIRM_BOOKING', title: 'Confirm Booking' },
      { id: 'CHANGE_BOOKING_DETAILS', title: 'Change Details' },
      { id: 'CANCEL_FLOW', title: 'Cancel' },
    ]
  );
  await sessionStore.setFlow(session.phone, FLOW, 'confirm', { cart: preparedCart, confirmationNonce });
}

async function handleConfirm(session, customer, input) {
  if (input.buttonId === 'CANCEL_FLOW') {
    logger.log('BOOKING_ABANDONED', { phone: session.phone, step: 'confirm' });
    await sessionStore.clearFlow(session.phone);
    await whatsapp.sendText(session.phone, 'Certainly. Your booking request has been cancelled. Type "menu" whenever you would like to start again.');
    return;
  }
  if (input.buttonId === 'CHANGE_BOOKING_DETAILS') {
    const item = session.context.cart && session.context.cart[session.context.cart.length - 1];
    if (item) return promptChangeDetails(session, session.context.cart.slice(0, -1), item);
  }
  if (input.buttonId !== 'CONFIRM_BOOKING') {
    await whatsapp.sendText(session.phone, 'Please select Confirm Booking, Change Details, or Cancel.');
    return;
  }

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

  const confirmed = [];
  for (let index = 0; index < cart.length; index += 1) {
    const item = cart[index];
    const payload = {
      customerId: customer.id,
      propertyId: item.propertyId,
      serviceId: item.serviceId,
      date: item.date,
      time: item.time,
    };
    if (item.issue) payload.notes = item.issue;
    const actionKey = `booking:${customer.id}:${confirmationNonce}:${item.actionId}`;
    logger.audit('BOOKING_CREATE_REQUESTED', {
      phone: session.phone,
      customerId: customer.id,
      sessionId: session.phone,
      result: 'requested',
      serviceId: item.serviceId,
    });
    try {
      const { value: booking, duplicate } = await executeOnce(actionKey, () => crm.createBooking(payload));
      if (duplicate) {
        logger.audit('BOOKING_DUPLICATE_BLOCKED', {
          phone: session.phone,
          customerId: customer.id,
          sessionId: session.phone,
          result: 'existing_result_returned',
          bookingReference: booking.reference,
        });
      }
      if (!duplicate) {
        logger.audit('BOOKING_CREATED', {
          phone: session.phone,
          customerId: customer.id,
          sessionId: session.phone,
          result: 'success',
          bookingReference: booking.reference,
        });
      }
      let serviceName = item.serviceName;
      if (!serviceName) {
        const service = await crm.getServiceDetails(item.serviceId);
        serviceName = service ? service.name : 'Service';
      }
      confirmed.push({ ...booking, serviceName, requestedDate: item.date, requestedTime: item.time });
    } catch (err) {
      logger.error('BOOKING', 'createBooking failed:', err.message);
      logger.audit(err.duplicateBlocked ? 'BOOKING_DUPLICATE_BLOCKED' : 'BOOKING_CREATE_FAILED', {
        phone: session.phone,
        customerId: customer.id,
        sessionId: session.phone,
        result: err.uncertain ? 'uncertain' : 'failed',
        reason: err.code || err.message,
      });
      if (err.uncertain) {
        let escalated = false;
        if (!err.duplicateBlocked) {
          try {
            await triggerEscalation({
              crm,
              phone: session.phone,
              customerId: customer.id,
              reason: 'booking_creation_uncertain',
              summary: 'A booking creation request timed out. Please verify the CRM before retrying.',
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
        return;
      }
      if (confirmed.length === 0) {
        await whatsapp.sendText(session.phone, "I'm sorry, I couldn't confirm your booking because of a system error. Your booking details are still saved, so you can try Confirm Booking again.");
      } else {
        await sessionStore.setFlow(session.phone, FLOW, 'confirm', { cart: cart.slice(index), confirmationNonce });
        const references = confirmed.map((booking) => booking.reference).join(', ');
        await whatsapp.sendText(session.phone, `I confirmed ${confirmed.length} service${confirmed.length > 1 ? 's' : ''} (${references}), but I could not confirm the remaining service${cart.length - index > 1 ? 's' : ''}. The remaining details are still saved; please try again or type "support".`);
      }
      return;
    }
  }

  await sessionStore.clearFlow(session.phone);
  logger.log('BOOKING_COMPLETED', { phone: session.phone, count: confirmed.length });
  const summaries = confirmed.map((booking) =>
    `Reference: *${booking.reference}*\nService: ${booking.serviceName}\nDate: ${formatDateForCustomer(booking.scheduledDate || booking.requestedDate)}\nTime: ${formatSlotForCustomer(booking.scheduledTime || booking.requestedTime)}`
  );
  await whatsapp.sendText(
    session.phone,
    `Your booking${confirmed.length > 1 ? 's are' : ' is'} confirmed ✅\n\n${summaries.join('\n\n')}\n\nWe'll keep you updated here on WhatsApp. If you need to make changes, simply message me.`
  );
}

module.exports = {
  startBooking,
  steps: {
    select_service: handleSelectService,
    confirm_service: handleConfirmService,
    select_property: handleSelectProperty,
    awaiting_new_property: handleAwaitingNewProperty,
    select_date: handleSelectDate,
    select_slot: handleSelectSlot,
    review_item: handleReviewItem,
    change_details: handleChangeDetails,
    confirm: handleConfirm,
  },
};
