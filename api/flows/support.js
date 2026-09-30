const whatsapp = require('../whatsapp/client');
const logger = require('../utils/logger');
const { getCrmAdapter } = require('../crm');
const { triggerEscalation } = require('../escalation/escalationService');

const crm = getCrmAdapter();

async function startSupport(session, customer, input, reason = 'explicit_human_request') {
  try {
    const result = await triggerEscalation({
      crm,
      phone: session.phone,
      customerId: customer ? customer.id : null,
      customer,
      session,
      reason,
      originalCustomerMessage: input && input.text,
      media: input && input.voice ? [{
        type: 'audio',
        mediaId: input.voice.mediaId,
        transcript: input.voice.transcript,
        detectedLanguage: input.voice.detectedLanguage,
        transcriptionConfidence: input.voice.confidence,
      }] : [],
      botActions: ['Customer requested human support'],
      suggestedNextAction: 'Continue the conversation using the collected booking or complaint context.',
    });
    await whatsapp.sendText(session.phone, "I've shared the details with our support team, including the information you've already provided, so you won't need to explain everything again. A team member will continue from here.");
    return { handoff: true, priority: result.priority, reason: result.reason };
  } catch (err) {
    logger.error('SUPPORT', 'escalateToHuman failed:', err.message);
    await whatsapp.sendText(session.phone, "I'm sorry, I wasn't able to connect this to our support team just now. Please try again in a moment.");
    return { handoff: false, priority: null, reason };
  }
}

module.exports = { startSupport, steps: {} };
