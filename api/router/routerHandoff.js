// Router-level handoff to a human (safety concerns, repeated
// misunderstanding, explicit requests detected outside a flow).
const whatsapp = require('../whatsapp/client');
const logger = require('../utils/logger');
const { getCrmAdapter } = require('../crm');
const { triggerEscalation } = require('../escalation/escalationService');

const crm = getCrmAdapter();

async function createRouterHandoff(session, customer, inbound, trigger, intentResult, safetyMessage) {
  if (safetyMessage) await whatsapp.sendText(session.phone, safetyMessage);
  try {
    const result = await triggerEscalation({
      crm,
      phone: session.phone,
      customerId: customer ? customer.id : null,
      customer,
      session,
      reason: trigger.reason,
      originalCustomerMessage: inbound.text,
      media: inbound.voice ? [{
        type: 'audio',
        mediaId: inbound.voice.mediaId,
        transcript: inbound.voice.transcript,
        detectedLanguage: inbound.voice.detectedLanguage,
        transcriptionConfidence: inbound.voice.confidence,
      }] : [],
      botActions: safetyMessage ? ['Safety guidance provided'] : [],
      suggestedNextAction: safetyMessage
        ? 'Review the safety concern immediately and contact the customer.'
        : 'Review the customer request and continue the conversation.',
    });
    await whatsapp.sendText(
      session.phone,
      "I've shared the details with our support team, including the information you've already provided, so you won't need to explain everything again. A team member will continue from here."
    );
    return {
      reply: 'escalated',
      intent: intentResult && intentResult.intent,
      confidence: intentResult && intentResult.confidence,
      handoff: true,
      priority: result.priority,
      handoffReason: trigger.reason,
    };
  } catch (err) {
    logger.error('ROUTER', 'triggerEscalation failed:', err.message);
    await whatsapp.sendText(session.phone, "I'm sorry, I wasn't able to connect this to our support team just now. Please try again in a moment.");
    return {
      reply: 'escalation_failed',
      intent: intentResult && intentResult.intent,
      confidence: intentResult && intentResult.confidence,
      handoff: false,
      priority: null,
      handoffReason: trigger.reason,
    };
  }
}

module.exports = {
  createRouterHandoff,
};
