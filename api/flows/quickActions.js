// Contextual actions: the 2–3 most likely next steps for this customer, as
// WhatsApp buttons. Used by the main menu (progressive disclosure) and after
// every completed step (quick replies), so customers are never shown every
// option every time.
//
// Targeted actions carry the record id in the button payload, e.g.
// "RESCHEDULE_BOOKING:8b1f…", and are handled by router/globalActions.js
// from any point in the conversation. Ownership is always re-checked there.
const { todayInTimeZone, formatDateForCustomer, formatSlotForCustomer } = require('./dateUtils');

const ACTIONS = Object.freeze({
  VIEW_BOOKING: 'VIEW_BOOKING',
  RESCHEDULE_BOOKING: 'RESCHEDULE_BOOKING',
  CANCEL_BOOKING: 'CANCEL_BOOKING',
  COMPLAINT_STATUS: 'COMPLAINT_STATUS',
  ADD_COMPLAINT_DETAILS: 'ADD_COMPLAINT_DETAILS',
  BOOK_AGAIN: 'BOOK_AGAIN',
  ADD_SERVICE: 'ADD_SERVICE',
  RESUME_DRAFT: 'RESUME_DRAFT',
  DISCARD_DRAFT: 'DISCARD_DRAFT',
  ATTACH_MEDIA: 'ATTACH_MEDIA',
  REPORT_WITH_MEDIA: 'REPORT_WITH_MEDIA',
});
const KINDS = new Set(Object.values(ACTIONS));

const ACTIVE_BOOKING_STATUSES = new Set(['pending', 'confirmed', 'rescheduled', 'technician_assigned', 'technician_on_the_way', 'in_progress']);
const CHANGEABLE_BOOKING_STATUSES = new Set(['pending', 'confirmed', 'rescheduled', 'technician_assigned']);

function actionId(kind, id) {
  return id ? `${kind}:${id}` : kind;
}

/** { kind, id } for a targeted action payload, or null for anything else. */
function parseActionId(buttonId) {
  const match = String(buttonId || '').match(/^([A-Z_]+):(.+)$/);
  if (!match || !KINDS.has(match[1])) return null;
  return { kind: match[1], id: match[2] };
}

function isUpcoming(booking, today) {
  return booking && ACTIVE_BOOKING_STATUSES.has(String(booking.status || '').toLowerCase())
    && (!booking.scheduledDate || booking.scheduledDate >= today);
}

function canChange(booking) {
  return booking && CHANGEABLE_BOOKING_STATUSES.has(String(booking.status || '').toLowerCase());
}

/**
 * What matters most for this customer right now, from their CRM profile.
 */
function customerSituation(profile) {
  const today = todayInTimeZone();
  const bookings = (profile && profile.recentBookings) || [];
  const upcoming = bookings
    .filter((booking) => isUpcoming(booking, today))
    .sort((left, right) => String(left.scheduledDate || '').localeCompare(String(right.scheduledDate || '')));
  const complaints = (profile && profile.activeComplaints) || [];
  return {
    openComplaint: complaints[0] || null,
    openComplaintCount: complaints.length,
    upcomingBooking: upcoming[0] || null,
    upcomingCount: upcoming.length,
    lastCompleted: bookings.find((booking) => String(booking.status || '').toLowerCase() === 'completed') || null,
    isNewCustomer: bookings.length === 0 && complaints.length === 0,
  };
}

function bookingWhen(booking) {
  const time = booking.scheduledTime ? ` at ${formatSlotForCustomer(String(booking.scheduledTime).slice(0, 5))}` : '';
  return `${formatDateForCustomer(booking.scheduledDate)}${time}`;
}

function shortTitle(text) {
  return String(text).slice(0, 20);
}

// Buttons for one booking, based on what can still be done with it.
function bookingButtons(booking) {
  const buttons = [{ id: actionId(ACTIONS.VIEW_BOOKING, booking.id), title: 'My Booking' }];
  if (canChange(booking)) {
    buttons.push({ id: actionId(ACTIONS.RESCHEDULE_BOOKING, booking.id), title: 'Reschedule' });
    buttons.push({ id: actionId(ACTIONS.CANCEL_BOOKING, booking.id), title: 'Cancel Booking' });
  } else {
    buttons.push({ id: 'HUMAN_SUPPORT', title: 'Talk to Support' });
  }
  return buttons;
}

function complaintButtons(complaint) {
  return [
    { id: actionId(ACTIONS.COMPLAINT_STATUS, complaint.id), title: 'Complaint Status' },
    { id: actionId(ACTIONS.ADD_COMPLAINT_DETAILS, complaint.id), title: 'Add Details' },
    { id: 'HUMAN_SUPPORT', title: 'Talk to Support' },
  ];
}

/**
 * The menu for this customer: a context line and at most three buttons.
 * `serviceName(serviceId)` resolves names for the wording (may return null).
 */
async function menuFor(profile, serviceName = async () => null) {
  const situation = customerSituation(profile);
  if (situation.openComplaint) {
    const complaint = situation.openComplaint;
    return {
      situation: 'open_complaint',
      context: `Your complaint ${complaint.reference} is ${String(complaint.status || 'open').replace(/_/g, ' ')}.`,
      buttons: complaintButtons(complaint),
    };
  }
  if (situation.upcomingBooking) {
    const booking = situation.upcomingBooking;
    const name = await serviceName(booking.serviceId);
    return {
      situation: 'upcoming_booking',
      context: `Your ${name ? `${name} ` : ''}visit (${booking.reference}) is on ${bookingWhen(booking)}.`,
      buttons: bookingButtons(booking),
    };
  }
  if (situation.lastCompleted && situation.lastCompleted.serviceId) {
    const name = await serviceName(situation.lastCompleted.serviceId);
    if (name) {
      return {
        situation: 'returning_customer',
        context: null,
        buttons: [
          { id: actionId(ACTIONS.BOOK_AGAIN, situation.lastCompleted.serviceId), title: shortTitle(`Book ${name} Again`.length <= 20 ? `Book ${name} Again` : 'Book Again') },
          { id: 'BOOK_SERVICE', title: 'Book a Service' },
          { id: 'MORE_OPTIONS', title: 'More Options' },
        ],
      };
    }
  }
  if (situation.isNewCustomer) {
    return {
      situation: 'new_customer',
      context: null,
      buttons: [
        { id: 'BOOK_SERVICE', title: 'Book a Service' },
        { id: 'SERVICE_INFO', title: 'Our Services' },
        { id: 'HUMAN_SUPPORT', title: 'Talk to Support' },
      ],
    };
  }
  return {
    situation: 'default',
    context: null,
    buttons: [
      { id: 'BOOK_SERVICE', title: 'Book a Service' },
      { id: 'MY_BOOKINGS', title: 'My Bookings' },
      { id: 'MORE_OPTIONS', title: 'More Options' },
    ],
  };
}

module.exports = {
  ACTIONS,
  actionId,
  parseActionId,
  customerSituation,
  bookingButtons,
  complaintButtons,
  bookingWhen,
  canChange,
  isUpcoming,
  menuFor,
};
