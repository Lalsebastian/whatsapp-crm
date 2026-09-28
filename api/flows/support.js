const whatsapp = require('../whatsapp/client');
const sessionStore = require('../session/sessionStore');
const logger = require('../utils/logger');
const { getCrmAdapter } = require('../crm');
const { triggerEscalation } = require('../escalation/escalationService');

const crm = getCrmAdapter();

async function startSupport(session, customer, input, reason = 'explicit_human_request') {
  try {
    await triggerEscalation({
      crm,
      phone: session.phone,
      customerId: customer ? customer.id : null,
      reason,
      summary: 'Customer requested to speak with a human agent.',
    });
  } catch (err) {
    logger.error('SUPPORT', 'escalateToHuman failed:', err.message);
  }
  await sessionStore.clearFlow(session.phone);
  await whatsapp.sendText(session.phone, "🙋 You're being connected to our support team. Someone will reply here shortly — no need to use the bot in the meantime.");
}

module.exports = { startSupport, steps: {} };
