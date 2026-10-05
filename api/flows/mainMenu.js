// Main menu with progressive disclosure: the customer sees the 2–3 actions
// that fit their situation (open complaint, upcoming visit, returning or new
// customer), never the full catalogue of options. Everything else is still
// one "More Options" tap or a typed request away.
const whatsapp = require('../whatsapp/client');
const sessionStore = require('../session/sessionStore');
const logger = require('../utils/logger');
const { getCrmAdapter } = require('../crm');
const { menuFor } = require('./quickActions');

const crm = getCrmAdapter();

async function serviceNameLookup(serviceId) {
  if (!serviceId) return null;
  try {
    const service = await crm.getServiceDetails(serviceId);
    return service ? service.name : null;
  } catch {
    return null;
  }
}

async function sendMainMenu(session, customer) {
  await sessionStore.clearFlow(session.phone);
  const profile = customer && customer.profile;
  const knownName = profile && profile.returningCustomer && profile.name;
  let menu;
  try {
    menu = await menuFor(profile, serviceNameLookup);
  } catch (error) {
    logger.warn('MAIN_MENU', 'Contextual menu unavailable; using the standard menu:', error.message);
    menu = await menuFor(null);
  }

  let greeting;
  if (knownName) {
    greeting = `Hello ${knownName} 👋 Welcome back to Joboy.`;
  } else if (menu.situation === 'new_customer') {
    greeting = 'Hello 👋 Welcome to Joboy.\n\nWe send verified professionals for AC, plumbing, electrical, cleaning and more. You can also just tell me what you need, for example "AC not cooling, tomorrow morning".';
  } else {
    greeting = 'Hello 👋 Welcome to Joboy.';
  }
  const body = [greeting, menu.context, 'How can I help you today?'].filter(Boolean).join('\n\n');

  await whatsapp.sendButtons(session.phone, body, menu.buttons);
  logger.audit('MAIN_MENU_SHOWN', {
    phone: session.phone,
    customerId: customer && customer.id,
    flow: 'main_menu',
    situation: menu.situation,
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
