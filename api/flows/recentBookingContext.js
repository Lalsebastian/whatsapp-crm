const whatsapp = require('../whatsapp/client');
const sessionStore = require('../session/sessionStore');
const { getCrmAdapter } = require('../crm');
const complaint = require('./complaint');
const support = require('./support');
const { hintsForService } = require('../ai/serviceHints');
const { normalizeCustomerMessage } = require('../ai/messageUnderstanding');

const crm = getCrmAdapter();
const FLOW = 'recent_booking_context';
const CONTEXT_PATTERN = /\b(?:same|again|returned|back|still|repeat|yesterday)\b/i;
const IGNORED_WORDS = new Set(['service', 'repair', 'maintenance', 'issue', 'work', 'home']);

function serviceTerms(service) {
  return [service.name, service.category, ...hintsForService(service)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length >= 2 && !IGNORED_WORDS.has(word));
}

async function findRecentRelevantBooking(customer, text) {
  const bookings = (customer.profile && customer.profile.recentBookings) || [];
  if (!CONTEXT_PATTERN.test(text) || bookings.length === 0) return null;
  const uniqueServiceIds = [...new Set(bookings.map((booking) => booking.serviceId).filter(Boolean))];
  const services = await Promise.all(uniqueServiceIds.map((id) => crm.getServiceDetails(id)));
  const lower = text.toLowerCase();
  const serviceById = new Map(services.filter(Boolean).map((service) => [service.id, service]));
  const matches = bookings.filter((booking) => {
    const service = serviceById.get(booking.serviceId);
    return service && serviceTerms(service).some((term) => lower.includes(term));
  });
  if (matches.length === 0) return null;
  const booking = matches[0];
  return { booking, service: serviceById.get(booking.serviceId) };
}

async function tryStartRecentBookingContext(session, customer, input) {
  let found;
  try {
    found = await findRecentRelevantBooking(customer, input.text || '');
  } catch (_error) {
    return false;
  }
  if (!found) return false;
  const understanding = normalizeCustomerMessage(input.text || '');
  const issue = understanding.issue || 'the reported issue';
  await whatsapp.sendButtons(
    session.phone,
    `I'm sorry ${understanding.repeatProblem ? 'the issue has returned' : 'to hear about this'} after your recent ${found.service.name} service. I found booking ${found.booking.reference}. Would you like me to register ${issue === 'the reported issue' ? 'this' : `“${issue}”`} as a repeat-service complaint?`,
    [
      { id: 'CONFIRM_RECENT_BOOKING', title: 'Yes' },
      { id: 'CHOOSE_OTHER_BOOKING', title: 'Not This Booking' },
      { id: 'TALK_TO_SUPPORT', title: 'Talk to Support' },
    ]
  );
  await sessionStore.setFlow(session.phone, FLOW, 'confirm_booking', {
    bookingId: found.booking.id,
    originalMessage: input.text,
    room: understanding.room,
    issue: understanding.issue,
    category: 'problem_returned',
  });
  return true;
}

async function handleConfirmBooking(session, customer, input) {
  if (input.buttonId === 'TALK_TO_SUPPORT') {
    return support.startSupport(session, customer, { text: session.context.originalMessage });
  }
  if (input.buttonId === 'CHOOSE_OTHER_BOOKING') {
    return complaint.startComplaint(session, customer, { text: session.context.originalMessage });
  }
  if (input.buttonId !== 'CONFIRM_RECENT_BOOKING') {
    await whatsapp.sendText(session.phone, 'Please confirm whether this is related to the recent booking.');
    return;
  }
  const bookings = await crm.getBookings(customer.id, { limit: 5 });
  const booking = bookings.find((item) => item.id === session.context.bookingId);
  if (!booking) {
    await whatsapp.sendText(session.phone, 'That booking is no longer available. Please choose another booking.');
    return complaint.startComplaint(session, customer, { text: session.context.originalMessage });
  }
  return complaint.startComplaintForBooking(session, customer, {
    bookingId: booking.id,
    description: session.context.originalMessage,
    category: session.context.category,
  });
}

module.exports = {
  tryStartRecentBookingContext,
  findRecentRelevantBooking,
  steps: { confirm_booking: handleConfirmBooking },
};
