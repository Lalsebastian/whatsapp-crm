// My Bookings flow: list -> select a booking -> status / reschedule / cancel.
const whatsapp = require('../whatsapp/client');
const sessionStore = require('../session/sessionStore');
const logger = require('../utils/logger');
const { parseDateInput } = require('./dateUtils');
const { getCrmAdapter } = require('../crm');

const crm = getCrmAdapter();
const FLOW = 'my_bookings';

function formatStatus(status) {
  return status
    ? status.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
    : 'Not available';
}

async function showMyBookings(session, customer) {
  const bookings = await crm.getBookings(customer.id, { limit: 5 });
  if (!bookings || bookings.length === 0) {
    await whatsapp.sendButtons(session.phone, "You don't have any bookings yet. Would you like to book a service?", [{ id: 'BOOK_SERVICE', title: 'Book a Service' }]);
    await sessionStore.clearFlow(session.phone);
    return;
  }

  await whatsapp.sendListMessage(session.phone, 'Certainly. Please select one of your recent bookings.', 'Choose booking', [
    {
      title: 'Your Bookings',
      rows: bookings.map((b) => ({
        id: `BKG_${b.id}`,
        title: b.reference,
        description: `${b.scheduledDate || ''} ${b.scheduledTime || ''} — ${formatStatus(b.status)}`.slice(0, 72),
      })),
    },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'select_booking', { bookings });
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

  await whatsapp.sendButtons(
    session.phone,
    `📋 Booking ${booking.reference}\n📅 ${booking.scheduledDate} at ${booking.scheduledTime}\nStatus: ${formatStatus(booking.status)}`,
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
    await whatsapp.sendButtons(session.phone, `Please confirm that you want to cancel booking ${booking.reference}. This action cannot be undone.`, [
      { id: 'CANCEL_YES', title: 'Yes, cancel' },
      { id: 'CANCEL_NO', title: 'No, keep it' },
    ]);
    await sessionStore.setFlow(session.phone, FLOW, 'confirm_cancel', { booking });
    return;
  }
  if (input.buttonId === 'ACTION_RESCHEDULE') {
    await whatsapp.sendButtons(session.phone, '📅 Certainly. What new date would you prefer? Select an option, or enter a date in YYYY-MM-DD format.', [
      { id: 'DATE_TODAY', title: 'Today' },
      { id: 'DATE_TOMORROW', title: 'Tomorrow' },
    ]);
    await sessionStore.setFlow(session.phone, FLOW, 'awaiting_reschedule_date', { booking });
    return;
  }
  await whatsapp.sendText(session.phone, 'Please select Reschedule, Cancel, or Back.');
}

async function handleConfirmCancel(session, customer, input) {
  const { booking } = session.context;
  if (input.buttonId === 'CANCEL_NO') {
    await sessionStore.clearFlow(session.phone);
    await whatsapp.sendText(session.phone, 'Certainly. Your booking has not been changed. Type "menu" if you need any further assistance.');
    return;
  }
  if (input.buttonId !== 'CANCEL_YES') {
    await whatsapp.sendText(session.phone, 'Please select Yes or No to continue.');
    return;
  }
  try {
    await crm.cancelBooking(booking.id);
    await sessionStore.clearFlow(session.phone);
    await whatsapp.sendText(session.phone, `Booking ${booking.reference} has been cancelled successfully.`);
  } catch (err) {
    logger.error('MY_BOOKINGS', 'cancelBooking failed:', err.message);
    await whatsapp.sendText(session.phone, "I'm sorry, I couldn't cancel that booking because of a system error. Please try again, or type \"support\" to speak with our team.");
  }
}

async function handleAwaitingRescheduleDate(session, customer, input) {
  const { booking } = session.context;
  let date = null;
  if (input.buttonId === 'DATE_TODAY') date = parseDateInput('today');
  else if (input.buttonId === 'DATE_TOMORROW') date = parseDateInput('tomorrow');
  else if (input.text) date = parseDateInput(input.text);

  if (!date) {
    await whatsapp.sendText(session.phone, "I couldn't identify that date. Please enter it in YYYY-MM-DD format, or select Today or Tomorrow.");
    return;
  }

  const slots = await crm.getAvailability(booking.serviceId, date);
  if (!slots || slots.length === 0) {
    await whatsapp.sendText(session.phone, `I'm sorry, we don't have any available times on ${date}. Please select another date.`);
    return;
  }

  await whatsapp.sendListMessage(session.phone, `🕒 These times are available on ${date}:`, 'Choose time', [
    { title: 'Available Slots', rows: slots.map((s) => ({ id: `SLOT_${s}`, title: s })) },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'awaiting_reschedule_slot', { booking, date });
}

async function handleAwaitingRescheduleSlot(session, customer, input) {
  const { booking, date } = session.context;
  if (!input.buttonId || !input.buttonId.startsWith('SLOT_')) {
    await whatsapp.sendText(session.phone, 'Please select one of the available times from the list above.');
    return;
  }
  const time = input.buttonId.replace('SLOT_', '');
  try {
    const updated = await crm.rescheduleBooking(booking.id, { date, time });
    await sessionStore.clearFlow(session.phone);
    await whatsapp.sendText(session.phone, `✅ Booking ${updated.reference} has been rescheduled successfully for ${updated.scheduledDate} at ${updated.scheduledTime}.`);
  } catch (err) {
    logger.error('MY_BOOKINGS', 'rescheduleBooking failed:', err.message);
    await whatsapp.sendText(session.phone, "I'm sorry, I couldn't reschedule that booking because of a system error. Please try again, or type \"support\" to speak with our team.");
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
