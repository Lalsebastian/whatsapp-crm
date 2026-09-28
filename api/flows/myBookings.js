// My Bookings flow: list -> select a booking -> status / reschedule / cancel.
const whatsapp = require('../whatsapp/client');
const sessionStore = require('../session/sessionStore');
const logger = require('../utils/logger');
const { parseDateInput } = require('./dateUtils');
const { getCrmAdapter } = require('../crm');

const crm = getCrmAdapter();
const FLOW = 'my_bookings';

async function showMyBookings(session, customer) {
  const bookings = await crm.getBookings(customer.id, { limit: 5 });
  if (!bookings || bookings.length === 0) {
    await whatsapp.sendButtons(session.phone, "You don't have any bookings yet.", [{ id: 'BOOK_SERVICE', title: 'Book a Service' }]);
    await sessionStore.clearFlow(session.phone);
    return;
  }

  await whatsapp.sendListMessage(session.phone, 'Here are your recent bookings:', 'Choose booking', [
    {
      title: 'Your Bookings',
      rows: bookings.map((b) => ({
        id: `BKG_${b.id}`,
        title: b.reference,
        description: `${b.scheduledDate || ''} ${b.scheduledTime || ''} — ${b.status}`.slice(0, 72),
      })),
    },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'select_booking', { bookings });
}

async function handleSelectBooking(session, customer, input) {
  if (!input.buttonId || !input.buttonId.startsWith('BKG_')) {
    await whatsapp.sendText(session.phone, 'Please choose a booking from the list above.');
    return;
  }
  const bookingId = input.buttonId.replace('BKG_', '');
  const booking = (session.context.bookings || []).find((b) => b.id === bookingId);
  if (!booking) {
    await whatsapp.sendText(session.phone, "Sorry, I couldn't find that booking. Let's try again.");
    return showMyBookings(session, customer);
  }

  await whatsapp.sendButtons(
    session.phone,
    `📋 Booking ${booking.reference}\n📅 ${booking.scheduledDate} at ${booking.scheduledTime}\nStatus: ${booking.status}`,
    [
      { id: 'ACTION_RESCHEDULE', title: 'Reschedule' },
      { id: 'ACTION_CANCEL', title: 'Cancel' },
      { id: 'ACTION_BACK', title: 'Back' },
    ]
  );
  await sessionStore.setFlow(session.phone, FLOW, 'select_action', { booking });
}

async function handleSelectAction(session, customer, input) {
  const { booking } = session.context;
  if (!booking) return showMyBookings(session, customer);

  if (input.buttonId === 'ACTION_BACK') {
    return showMyBookings(session, customer);
  }
  if (input.buttonId === 'ACTION_CANCEL') {
    await whatsapp.sendButtons(session.phone, `Cancel booking ${booking.reference}? This can't be undone.`, [
      { id: 'CANCEL_YES', title: 'Yes, cancel' },
      { id: 'CANCEL_NO', title: 'No, keep it' },
    ]);
    await sessionStore.setFlow(session.phone, FLOW, 'confirm_cancel', { booking });
    return;
  }
  if (input.buttonId === 'ACTION_RESCHEDULE') {
    await whatsapp.sendButtons(session.phone, '📅 What new date would you like? Choose an option or type a date (YYYY-MM-DD).', [
      { id: 'DATE_TODAY', title: 'Today' },
      { id: 'DATE_TOMORROW', title: 'Tomorrow' },
    ]);
    await sessionStore.setFlow(session.phone, FLOW, 'awaiting_reschedule_date', { booking });
    return;
  }
  await whatsapp.sendText(session.phone, 'Please choose Reschedule, Cancel, or Back.');
}

async function handleConfirmCancel(session, customer, input) {
  const { booking } = session.context;
  if (input.buttonId === 'CANCEL_NO') {
    await sessionStore.clearFlow(session.phone);
    await whatsapp.sendText(session.phone, 'No changes made. Type "menu" anytime.');
    return;
  }
  if (input.buttonId !== 'CANCEL_YES') {
    await whatsapp.sendText(session.phone, 'Please tap Yes or No.');
    return;
  }
  try {
    await crm.cancelBooking(booking.id);
    await sessionStore.clearFlow(session.phone);
    await whatsapp.sendText(session.phone, `Booking ${booking.reference} has been cancelled.`);
  } catch (err) {
    logger.error('MY_BOOKINGS', 'cancelBooking failed:', err.message);
    await whatsapp.sendText(session.phone, "Sorry, we couldn't cancel that booking due to a system error. Please try again or type \"support\".");
  }
}

async function handleAwaitingRescheduleDate(session, customer, input) {
  const { booking } = session.context;
  let date = null;
  if (input.buttonId === 'DATE_TODAY') date = parseDateInput('today');
  else if (input.buttonId === 'DATE_TOMORROW') date = parseDateInput('tomorrow');
  else if (input.text) date = parseDateInput(input.text);

  if (!date) {
    await whatsapp.sendText(session.phone, "I couldn't understand that date. Please type it as YYYY-MM-DD, or tap Today/Tomorrow.");
    return;
  }

  const slots = await crm.getAvailability(booking.serviceId, date);
  if (!slots || slots.length === 0) {
    await whatsapp.sendText(session.phone, `Sorry, no time slots are available on ${date}. Please try another date.`);
    return;
  }

  await whatsapp.sendListMessage(session.phone, `🕒 Available times on ${date}:`, 'Choose time', [
    { title: 'Available Slots', rows: slots.map((s) => ({ id: `SLOT_${s}`, title: s })) },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'awaiting_reschedule_slot', { booking, date });
}

async function handleAwaitingRescheduleSlot(session, customer, input) {
  const { booking, date } = session.context;
  if (!input.buttonId || !input.buttonId.startsWith('SLOT_')) {
    await whatsapp.sendText(session.phone, 'Please choose a time slot from the list above.');
    return;
  }
  const time = input.buttonId.replace('SLOT_', '');
  try {
    const updated = await crm.rescheduleBooking(booking.id, { date, time });
    await sessionStore.clearFlow(session.phone);
    await whatsapp.sendText(session.phone, `✅ Booking ${updated.reference} rescheduled to ${updated.scheduledDate} at ${updated.scheduledTime}.`);
  } catch (err) {
    logger.error('MY_BOOKINGS', 'rescheduleBooking failed:', err.message);
    await whatsapp.sendText(session.phone, "Sorry, we couldn't reschedule that booking due to a system error. Please try again or type \"support\".");
  }
}

module.exports = {
  showMyBookings,
  steps: {
    select_booking: handleSelectBooking,
    select_action: handleSelectAction,
    confirm_cancel: handleConfirmCancel,
    awaiting_reschedule_date: handleAwaitingRescheduleDate,
    awaiting_reschedule_slot: handleAwaitingRescheduleSlot,
  },
};
