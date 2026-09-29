// Single source of truth mapping both main-menu button taps AND AI-detected
// intents to the SAME flow handler functions — this is what satisfies "button
// responses and AI-detected free-text intents must use the same workflow
// handlers" from the brief.
const mainMenu = require('../flows/mainMenu');
const booking = require('../flows/booking');
const myBookings = require('../flows/myBookings');
const complaint = require('../flows/complaint');
const complaintStatus = require('../flows/complaintStatus');
const serviceInfo = require('../flows/serviceInfo');
const support = require('../flows/support');

// Entry points reachable from a main-menu tap or a mapped AI intent.
const entryPoints = {
  MAIN_MENU: mainMenu.sendMainMenu,
  MORE_OPTIONS: mainMenu.sendMoreOptions,
  BOOK_SERVICE: booking.startBooking,
  MY_BOOKINGS: myBookings.showMyBookings,
  MAKE_COMPLAINT: complaint.startComplaint,
  COMPLAINT_STATUS: complaintStatus.promptForReference,
  SERVICE_INFO: serviceInfo.showServiceInfo,
  HUMAN_SUPPORT: support.startSupport,
  // Backward-compatible alias for previously delivered list-message replies.
  TALK_TO_SUPPORT: support.startSupport,
};

// AI intent -> entry point key. NEW_BOOKING/COMPLAINT etc. all resolve to the
// exact same handlers a button tap would call.
const intentToEntryPoint = {
  NEW_BOOKING: 'BOOK_SERVICE',
  MY_BOOKINGS: 'MY_BOOKINGS',
  BOOKING_STATUS: 'MY_BOOKINGS',
  RESCHEDULE_BOOKING: 'MY_BOOKINGS',
  CANCEL_BOOKING: 'MY_BOOKINGS',
  COMPLAINT: 'MAKE_COMPLAINT',
  COMPLAINT_STATUS: 'COMPLAINT_STATUS',
  GENERAL_QUERY: 'SERVICE_INFO',
  HUMAN_AGENT: 'TALK_TO_SUPPORT',
};

// flow name (as stored in sessions.current_flow) -> { step: handler }
const stepHandlers = {
  booking: booking.steps,
  my_bookings: myBookings.steps,
  complaint: complaint.steps,
  complaint_status: complaintStatus.steps,
};

module.exports = { entryPoints, intentToEntryPoint, stepHandlers };
