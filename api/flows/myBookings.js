// My Bookings flow: status / reschedule / cancel for the customer's bookings.
//
// Entry points jump straight to the right booking whenever it is clear which
// one the customer means ("cancel my booking" with one upcoming visit goes
// directly to the cancel confirmation); a list is only shown when there is a
// real choice to make.
const whatsapp = require('../whatsapp/client');
const sessionStore = require('../session/sessionStore');
const logger = require('../utils/logger');
const { parseDateInput, formatDateForCustomer, formatSlotForCustomer, todayInTimeZone } = require('./dateUtils');
const { getCrmAdapter } = require('../crm');
const { normalizeSlots, findSlot } = require('../crm/slots');
const { invalidateCustomerProfile } = require('../customer/customerProfileService');
const { upcomingAvailableDates } = require('./booking/schedule');
const { ACTIONS, actionId, bookingButtons, canChange, isUpcoming } = require('./quickActions');

const crm = getCrmAdapter();
const FLOW = 'my_bookings';

function formatStatus(status) {
  const labels = {
    pending: 'Booking Pending',
    confirmed: 'Booking Confirmed',
    technician_assigned: 'Technician Assigned',
    technician_on_the_way: 'Technician On The Way',
    in_progress: 'Service In Progress',
    completed: 'Completed',
    cancelled: 'Cancelled',
    rescheduled: 'Rescheduled',
  };
  return labels[status] || (status
    ? status.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
    : 'Not available');
}

function timeLabel(value) {
  return formatSlotForCustomer(String(value || '').slice(0, 5));
}

async function serviceNameFor(booking) {
  if (!booking.serviceId) return null;
  try {
    const service = await crm.getServiceDetails(booking.serviceId);
    return service ? service.name : null;
  } catch {
    return null;
  }
}

function ownedBy(booking, customer) {
  return booking && customer && (!booking.customerId || String(booking.customerId) === String(customer.id));
}

// Which bookings an intended action can apply to.
function candidatesFor(action, bookings) {
  const today = todayInTimeZone();
  if (action === 'status') {
    const upcoming = bookings.filter((booking) => isUpcoming(booking, today));
    return upcoming.length ? upcoming : bookings.slice(0, 1);
  }
  return bookings.filter((booking) => isUpcoming(booking, today) && canChange(booking));
}

/**
 * @param {object} [input]
 * @param {'status'|'reschedule'|'cancel'} [input.intendedAction] set by the
 *   router for "where is my technician" / "reschedule" / "cancel my booking"
 */
async function showMyBookings(session, customer, input = {}) {
  const intendedAction = input.intendedAction || null;
  const bookings = await crm.getBookings(customer.id, { limit: 5 }) || [];
  if (bookings.length === 0) {
    await whatsapp.sendButtons(session.phone, "You don't have any bookings yet. Would you like to book a service?", [{ id: 'BOOK_SERVICE', title: 'Book a Service' }]);
    await sessionStore.clearFlow(session.phone);
    return;
  }

  const reference = input.ai && input.ai.bookingReference ? String(input.ai.bookingReference).toUpperCase() : null;
  if (reference) {
    const referenced = bookings.find((booking) => String(booking.reference).toUpperCase() === reference)
      || await crm.getBookingStatus(reference);
    if (referenced && ownedBy(referenced, customer)) return actOnBooking(session, customer, referenced, intendedAction || 'status');
    await whatsapp.sendText(session.phone, `I couldn't find booking ${reference} on your account. Here are your recent bookings instead.`);
  }

  if (intendedAction) {
    const candidates = candidatesFor(intendedAction, bookings);
    if (candidates.length === 1) return actOnBooking(session, customer, candidates[0], intendedAction);
    if (candidates.length === 0) {
      await sessionStore.clearFlow(session.phone);
      await whatsapp.sendButtons(
        session.phone,
        `You don't have an upcoming booking that can be ${intendedAction === 'cancel' ? 'cancelled' : 'rescheduled'} here. If a visit is already in progress, our support team can help.`,
        [
          { id: 'MY_BOOKINGS', title: 'My Bookings' },
          { id: 'HUMAN_SUPPORT', title: 'Talk to Support' },
          { id: 'MAIN_MENU', title: 'Main Menu' },
        ]
      );
      return;
    }
  }

  const listed = intendedAction ? candidatesFor(intendedAction, bookings) : bookings;
  const prompt = {
    cancel: 'Which booking would you like to cancel?',
    reschedule: 'Which booking would you like to reschedule?',
    status: 'Which booking would you like to check?',
  }[intendedAction] || 'Certainly. Please select one of your recent bookings.';
  await whatsapp.sendListMessage(session.phone, prompt, 'Choose booking', [
    {
      title: 'Your Bookings',
      rows: listed.map((b) => ({
        id: `BKG_${b.id}`,
        title: b.reference,
        description: `${formatDateForCustomer(b.scheduledDate)} ${timeLabel(b.scheduledTime)} — ${formatStatus(b.status)}`.slice(0, 72),
      })),
    },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'select_booking', { bookings: listed, intendedAction });
}

async function actOnBooking(session, customer, booking, action) {
  if (action === 'cancel') return startCancelForBooking(session, customer, booking);
  if (action === 'reschedule') return startRescheduleForBooking(session, customer, booking);
  if (action === 'status') return showBookingDetails(session, customer, booking);
  return showBookingActions(session, booking);
}

async function showBookingDetails(session, customer, booking) {
  await sessionStore.clearFlow(session.phone);
  const name = await serviceNameFor(booking);
  const lines = [
    `📋 *${booking.reference}*${name ? ` · ${name}` : ''}`,
    `📅 ${formatDateForCustomer(booking.scheduledDate)}${booking.scheduledTime ? ` at ${timeLabel(booking.scheduledTime)}` : ''}`,
    `Status: ${formatStatus(booking.status)}`,
  ];
  const buttons = canChange(booking)
    ? bookingButtons(booking).filter((button) => !button.id.startsWith(ACTIONS.VIEW_BOOKING)).concat([{ id: 'MAIN_MENU', title: 'Main Menu' }])
    : [{ id: 'HUMAN_SUPPORT', title: 'Talk to Support' }, { id: 'MAIN_MENU', title: 'Main Menu' }];
  await whatsapp.sendButtons(session.phone, lines.join('\n'), buttons.slice(0, 3));
  logger.audit('BOOKING_DETAILS_SHOWN', { phone: session.phone, customerId: customer && customer.id, bookingReference: booking.reference, result: 'shown' });
}

async function showBookingActions(session, booking) {
  await whatsapp.sendButtons(
    session.phone,
    `📋 Booking ${booking.reference}\n📅 ${formatDateForCustomer(booking.scheduledDate)}\n🕙 ${timeLabel(booking.scheduledTime)}\nStatus: ${formatStatus(booking.status)}`,
    [
      { id: 'ACTION_RESCHEDULE', title: 'Reschedule' },
      { id: 'ACTION_CANCEL', title: 'Cancel' },
      { id: 'ACTION_BACK', title: 'Back' },
    ]
  );
  await sessionStore.setFlow(session.phone, FLOW, 'select_action', { booking });
}

async function cannotChange(session, booking, verb) {
  await sessionStore.clearFlow(session.phone);
  await whatsapp.sendButtons(
    session.phone,
    `Booking ${booking.reference} is ${formatStatus(booking.status).toLowerCase()}, so it can't be ${verb} here. Our support team can help with any changes.`,
    [
      { id: 'HUMAN_SUPPORT', title: 'Talk to Support' },
      { id: 'MAIN_MENU', title: 'Main Menu' },
    ]
  );
}

async function startCancelForBooking(session, customer, booking) {
  if (!canChange(booking)) return cannotChange(session, booking, 'cancelled');
  const name = await serviceNameFor(booking);
  await whatsapp.sendButtons(
    session.phone,
    `Please confirm that you want to cancel your ${name ? `${name} ` : ''}booking ${booking.reference} on ${formatDateForCustomer(booking.scheduledDate)}${booking.scheduledTime ? ` at ${timeLabel(booking.scheduledTime)}` : ''}. This can't be undone.`,
    [
      { id: 'CANCEL_YES', title: 'Yes, Cancel Booking' },
      { id: 'CANCEL_NO', title: 'Keep Booking' },
    ]
  );
  await sessionStore.setFlow(session.phone, FLOW, 'confirm_cancel', { booking });
}

async function startRescheduleForBooking(session, customer, booking) {
  if (!canChange(booking)) return cannotChange(session, booking, 'rescheduled');
  const days = await upcomingAvailableDates({ serviceId: booking.serviceId });
  if (days && days.length > 0) {
    const rows = days.slice(0, 9).map((day) => ({
      id: `DATE_${day.date}`,
      title: formatDateForCustomer(day.date).slice(0, 24),
      description: `${day.slots.length} time${day.slots.length === 1 ? '' : 's'} available`,
    }));
    rows.push({ id: 'DATE_OTHER', title: 'Another date', description: 'Type the date you would prefer' });
    await whatsapp.sendListMessage(
      session.phone,
      `📅 Certainly. Your booking ${booking.reference} is currently on ${formatDateForCustomer(booking.scheduledDate)}. Which new date works for you?`,
      'Choose date',
      [{ title: 'Available Dates', rows }]
    );
  } else {
    await whatsapp.sendButtons(session.phone, '📅 Certainly. What new date would you prefer? Select an option, or enter a date in YYYY-MM-DD format.', [
      { id: 'DATE_TODAY', title: 'Today' },
      { id: 'DATE_TOMORROW', title: 'Tomorrow' },
    ]);
  }
  await sessionStore.setFlow(session.phone, FLOW, 'awaiting_reschedule_date', { booking });
}

async function handleSelectBooking(session, customer, input) {
  if (!input.buttonId || !input.buttonId.startsWith('BKG_')) {
    await whatsapp.sendText(session.phone, 'Please select a booking from the list above.');
    return;
  }
  const bookingId = input.buttonId.replace('BKG_', '');
  const booking = (session.context.bookings || []).find((b) => b.id === bookingId);
  if (!booking) {
    await whatsapp.sendText(session.phone, "I'm sorry, I couldn't find that booking. I'll show you the latest list so you can try again.");
    return showMyBookings(session, customer);
  }
  return actOnBooking(session, customer, booking, session.context.intendedAction);
}

async function handleSelectAction(session, customer, input) {
  const { booking } = session.context;
  if (!booking) return showMyBookings(session, customer);

  if (input.buttonId === 'ACTION_BACK') return showMyBookings(session, customer);
  if (input.buttonId === 'ACTION_CANCEL') return startCancelForBooking(session, customer, booking);
  if (input.buttonId === 'ACTION_RESCHEDULE') return startRescheduleForBooking(session, customer, booking);
  await whatsapp.sendText(session.phone, 'Please select Reschedule, Cancel, or Back.');
}

async function handleConfirmCancel(session, customer, input) {
  const { booking } = session.context;
  if (input.buttonId === 'CANCEL_NO') {
    await sessionStore.clearFlow(session.phone);
    await whatsapp.sendButtons(session.phone, `Certainly. Booking ${booking.reference} has not been changed.`, [
      { id: actionId(ACTIONS.VIEW_BOOKING, booking.id), title: 'View Booking' },
      { id: 'MAIN_MENU', title: 'Main Menu' },
    ]);
    return;
  }
  if (input.buttonId !== 'CANCEL_YES') {
    await whatsapp.sendText(session.phone, 'Please select Yes, Cancel Booking or Keep Booking to continue.');
    return;
  }
  try {
    logger.audit('BOOKING_CANCEL_REQUESTED', {
      phone: session.phone,
      customerId: customer.id,
      bookingReference: booking.reference,
      result: 'requested',
    });
    await crm.cancelBooking(booking.id);
    invalidateCustomerProfile(customer.id);
    logger.audit('BOOKING_CANCELLED', {
      phone: session.phone,
      customerId: customer.id,
      bookingReference: booking.reference,
      result: 'success',
    });
    await sessionStore.clearFlow(session.phone);
    await whatsapp.sendButtons(session.phone, `Booking ${booking.reference} has been cancelled successfully.`, [
      { id: 'BOOK_SERVICE', title: 'Book a Service' },
      { id: 'MAIN_MENU', title: 'Main Menu' },
    ]);
  } catch (err) {
    logger.error('MY_BOOKINGS', 'cancelBooking failed:', err.message);
    logger.audit('BOOKING_CANCEL_FAILED', {
      phone: session.phone,
      customerId: customer.id,
      bookingReference: booking.reference,
      result: err.uncertain ? 'uncertain' : 'failed',
      reason: err.code || err.message,
    });
    const message = err.uncertain
      ? `I'm sorry, I could not verify whether booking ${booking.reference} was cancelled. Please check its status or contact support before trying again.`
      : "I'm sorry, I couldn't cancel that booking because of a system error. Please try again, or type \"support\" to speak with our team.";
    await whatsapp.sendText(session.phone, message);
  }
}

async function handleAwaitingRescheduleDate(session, customer, input) {
  const { booking } = session.context;
  if (input.buttonId === 'DATE_OTHER') {
    await whatsapp.sendText(session.phone, 'Certainly. Please type the date you would prefer, for example "next Monday" or YYYY-MM-DD.');
    return;
  }
  let date = null;
  const listed = input.buttonId && input.buttonId.match(/^DATE_(\d{4}-\d{2}-\d{2})$/);
  if (input.buttonId === 'DATE_TODAY') date = parseDateInput('today');
  else if (input.buttonId === 'DATE_TOMORROW') date = parseDateInput('tomorrow');
  else if (listed) date = parseDateInput(listed[1]);
  else if (input.text) date = parseDateInput((input.ai && input.ai.preferredDate) || input.text) || parseDateInput(input.text);

  if (!date) {
    await whatsapp.sendText(session.phone, "I couldn't identify that date. Please enter it in YYYY-MM-DD format, or select Today or Tomorrow.");
    return;
  }

  if (date < todayInTimeZone()) {
    await whatsapp.sendText(session.phone, 'That date has already passed. Please choose today or a later date.');
    return;
  }

  const slots = normalizeSlots(await crm.getAvailability(booking.serviceId, date), { date });
  if (slots.length === 0) {
    await whatsapp.sendText(session.phone, `I'm sorry, we don't have any available times on ${formatDateForCustomer(date)}. Please select another date.`);
    return;
  }

  await whatsapp.sendListMessage(session.phone, `Available times for ${formatDateForCustomer(date)}:`, 'Choose time', [
    { title: 'Available Times', rows: slots.slice(0, 10).map((slot) => ({ id: `SLOT_${slot.id}`, title: slot.label })) },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'awaiting_reschedule_slot', { booking, date, availableSlots: slots });
}

async function handleAwaitingRescheduleSlot(session, customer, input) {
  const { booking, date } = session.context;
  if (!input.buttonId || !input.buttonId.startsWith('SLOT_')) {
    await whatsapp.sendText(session.phone, 'Please select one of the available times from the list above.');
    return;
  }
  const tapped = input.buttonId.slice('SLOT_'.length);
  const offered = normalizeSlots(session.context.availableSlots, { date });
  const slot = offered.length > 0 ? findSlot(offered, tapped) : normalizeSlots([tapped])[0];
  if (!slot) {
    await whatsapp.sendText(session.phone, 'That time is no longer on offer. Please choose one of the times from the latest list.');
    return;
  }
  const time = slot.start;
  try {
    logger.audit('BOOKING_RESCHEDULE_REQUESTED', {
      phone: session.phone,
      customerId: customer.id,
      bookingReference: booking.reference,
      result: 'requested',
    });
    const updated = await crm.rescheduleBooking(booking.id, { date, time });
    invalidateCustomerProfile(customer.id);
    logger.audit('BOOKING_RESCHEDULED', {
      phone: session.phone,
      customerId: customer.id,
      bookingReference: updated.reference,
      result: 'success',
    });
    await sessionStore.clearFlow(session.phone);
    await whatsapp.sendButtons(
      session.phone,
      `✅ Booking ${updated.reference} has been rescheduled for ${formatDateForCustomer(updated.scheduledDate)} at ${timeLabel(updated.scheduledTime)}.`,
      [
        { id: actionId(ACTIONS.VIEW_BOOKING, updated.id || booking.id), title: 'View Booking' },
        { id: 'MAIN_MENU', title: 'Main Menu' },
      ]
    );
  } catch (err) {
    logger.error('MY_BOOKINGS', 'rescheduleBooking failed:', err.message);
    logger.audit('BOOKING_RESCHEDULE_FAILED', {
      phone: session.phone,
      customerId: customer.id,
      bookingReference: booking.reference,
      result: err.uncertain ? 'uncertain' : 'failed',
      reason: err.code || err.message,
    });
    let message;
    if (err.uncertain) {
      message = `I'm sorry, I could not verify whether booking ${booking.reference} was rescheduled. Please check its status or contact support before trying again.`;
    } else if (err.code === 'SLOT_UNAVAILABLE') {
      message = 'I\'m sorry, that time was just booked by someone else. Your booking has not been changed. Please choose another time from the list above.';
    } else {
      message = "I'm sorry, I couldn't reschedule that booking because of a system error. Please try again, or type \"support\" to speak with our team.";
    }
    await whatsapp.sendText(session.phone, message);
  }
}

module.exports = {
  showMyBookings,
  showBookingDetails,
  startCancelForBooking,
  startRescheduleForBooking,
  ownedBy,
  steps: {
    select_booking: handleSelectBooking,
    select_action: handleSelectAction,
    confirm_cancel: handleConfirmCancel,
    awaiting_reschedule_date: handleAwaitingRescheduleDate,
    awaiting_reschedule_slot: handleAwaitingRescheduleSlot,
  },
};
