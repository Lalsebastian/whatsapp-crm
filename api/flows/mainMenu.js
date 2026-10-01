const whatsapp = require('../whatsapp/client');
const sessionStore = require('../session/sessionStore');
const logger = require('../utils/logger');

async function sendMainMenu(session, customer) {
  await sessionStore.clearFlow(session.phone);
  const profile = customer && customer.profile;
  const knownName = profile && profile.returningCustomer && profile.name;
  const greeting = knownName
    ? `Hello ${knownName} 👋 Welcome back to Joboy.\n\nHow can I help you today?`
    : 'Hello 👋 Welcome to Joboy.\n\nI can help you book a home service, manage an existing booking, or resolve a service issue.\n\nHow can I help you today?';
  await whatsapp.sendButtons(
    session.phone,
    greeting,
    [
      { id: 'BOOK_SERVICE', title: 'Book a Service' },
      { id: 'MY_BOOKINGS', title: 'My Bookings' },
      { id: 'MORE_OPTIONS', title: 'More Options' },
    ]
  );
  logger.audit('MAIN_MENU_SHOWN', {
    phone: session.phone,
    customerId: customer && customer.id,
    flow: 'main_menu',
    result: 'shown',
  });
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
