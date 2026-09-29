const whatsapp = require('../whatsapp/client');
const sessionStore = require('../session/sessionStore');
const logger = require('../utils/logger');
const { getCrmAdapter } = require('../crm');
const { triggerEscalation } = require('../escalation/escalationService');

const crm = getCrmAdapter();

async function startSupport(session, customer, input, reason = 'explicit_human_request') {
  let escalationCreated = false;
  try {
    await triggerEscalation({
      crm,
      phone: session.phone,
      customerId: customer ? customer.id : null,
      reason,
      summary: 'Customer requested to speak with a human agent.',
    });
    escalationCreated = true;
  } catch (err) {
    logger.error('SUPPORT', 'escalateToHuman failed:', err.message);
  }
  await sessionStore.clearFlow(session.phone);
  if (escalationCreated) {
    await whatsapp.sendText(session.phone, '🙋 Your request has been sent to our support team. A team member will reply here as soon as possible.');
  } else {
    await whatsapp.sendText(session.phone, 'I\'m sorry, I could not connect you with our support team right now. Please try again shortly by typing "support".');
  }
}

module.exports = { startSupport, steps: {} };
