const whatsapp = require('../whatsapp/client');
const sessionStore = require('../session/sessionStore');

async function sendMainMenu(session, customer) {
  await sessionStore.clearFlow(session.phone);
  await whatsapp.sendButtons(
    session.phone,
    'Hello 👋 Welcome to Joboy.\n\nI can help you book a home service, manage an existing booking, or resolve a service issue.\n\nHow can I help you today?',
    [
      { id: 'BOOK_SERVICE', title: 'Book a Service' },
      { id: 'MY_BOOKINGS', title: 'My Bookings' },
      { id: 'MORE_OPTIONS', title: 'More Options' },
    ]
  );
}

async function sendMoreOptions(session) {
  await sessionStore.clearFlow(session.phone);
  await whatsapp.sendButtons(
    session.phone,
    'Please choose an option below.\n\nYou can also type "services" to browse service information.',
    [
      { id: 'MAKE_COMPLAINT', title: 'Make a Complaint' },
      { id: 'COMPLAINT_STATUS', title: 'Complaint Status' },
      { id: 'HUMAN_SUPPORT', title: 'Talk to Support' },
    ]
  );
}

module.exports = { sendMainMenu, sendMoreOptions };
