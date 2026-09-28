const whatsapp = require('../whatsapp/client');
const sessionStore = require('../session/sessionStore');

async function sendMainMenu(session, customer) {
  await sessionStore.clearFlow(session.phone);
  await whatsapp.sendListMessage(
    session.phone,
    "👋 Welcome! How can we help you today?",
    'View options',
    [
      {
        title: 'Main Menu',
        rows: [
          { id: 'BOOK_SERVICE', title: 'Book a Service', description: 'Schedule a home service visit' },
          { id: 'MY_BOOKINGS', title: 'My Bookings', description: 'View, reschedule or cancel' },
          { id: 'MAKE_COMPLAINT', title: 'Make a Complaint', description: 'Report an issue with a service' },
          { id: 'COMPLAINT_STATUS', title: 'Complaint Status', description: 'Check a complaint reference' },
          { id: 'SERVICE_INFO', title: 'Service Information', description: 'Browse our services' },
          { id: 'TALK_TO_SUPPORT', title: 'Talk to Support', description: 'Speak to a human agent' },
        ],
      },
    ]
  );
}

module.exports = { sendMainMenu };
