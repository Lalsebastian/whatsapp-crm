const whatsapp = require('../whatsapp/client');
const sessionStore = require('../session/sessionStore');
const logger = require('../utils/logger');
const { getCrmAdapter } = require('../crm');
const { triggerEscalation } = require('../escalation/escalationService');

const crm = getCrmAdapter();

async function startSupport(session, customer, input, reason = 'explicit_human_request') {
  let escalationCreated = false;
  const contextSummary = session.currentFlow
    ? `Customer requested support during ${session.currentFlow}/${session.currentStep || 'unknown'} with context: ${JSON.stringify(session.context || {})}`
    : 'Customer requested to speak with a human agent.';
  try {
    await triggerEscalation({
      crm,
      phone: session.phone,
      customerId: customer ? customer.id : null,
      reason,
      summary: contextSummary,
    });
    escalationCreated = true;
  } catch (err) {
    logger.error('SUPPORT', 'escalateToHuman failed:', err.message);
  }
  await sessionStore.clearFlow(session.phone);
  if (escalationCreated) {
    await whatsapp.sendText(session.phone, "I've shared the information you've already provided with our support team, so you won't need to explain everything again. A team member will reply here as soon as possible.");
  } else {
    await whatsapp.sendText(session.phone, 'I\'m sorry, I could not connect you with our support team right now. Please try again shortly by typing "support".');
  }
}

module.exports = { startSupport, steps: {} };
