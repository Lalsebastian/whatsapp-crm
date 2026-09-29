// Central place for every human-escalation trigger described in the brief:
// explicit request, refund/payment dispute, property damage, safety concern,
// repeated unresolved complaints, and the bot genuinely struggling to
// understand the customer.
//
// "Struggling" (UNKNOWN intent, or a low-confidence read on a determined one)
// only escalates after it happens repeatedly (see router/unknownStreak.js),
// not on a single so-so message — a single mediocre confidence score from the
// AI provider on an otherwise-clear message ("I want AC service tomorrow")
// isn't a good enough reason to permanently silence the bot for that
// customer; only genuine repeated failure to understand them is.
const sessionStore = require('../session/sessionStore');
const logger = require('../utils/logger');

const RE_SAFETY = /\b(unsafe|danger|threat|harass|inappropriate|scared|afraid)\b/i;
const RE_PAYMENT = /\b(refund|overcharg|payment issue|money back|dispute|scam)\b/i;
const RE_DAMAGE = /\b(damage|damaged|broke|broken)\b/i;
const RE_HUMAN = /\b(human|agent|representative|real person|talk to (a )?person|speak to (someone|somebody))\b/i;

const LOW_CONFIDENCE_THRESHOLD = 0.4;
const STRUGGLE_STREAK_THRESHOLD = 3;

// A message "struggles" if the AI couldn't determine an intent, or determined
// one but wasn't confident about it. Callers track this streak per phone
// (router/unknownStreak.js) and reset it the moment a message is handled
// confidently.
function isStruggling({ intent, confidence }) {
  if (intent === 'UNKNOWN') return true;
  return typeof confidence === 'number' && confidence < LOW_CONFIDENCE_THRESHOLD;
}

function evaluateTriggers({ text = '', intent, confidence, category, repeatedComplaintCount = 0, struggleStreak = 0 } = {}) {
  if (intent === 'HUMAN_AGENT') return { escalate: true, reason: 'explicit_human_request' };
  if (category === 'property_damage') return { escalate: true, reason: 'property_damage' };
  if (category === 'payment_issue') return { escalate: true, reason: 'payment_dispute' };
  if (RE_SAFETY.test(text)) return { escalate: true, reason: 'safety_concern' };
  if (RE_PAYMENT.test(text)) return { escalate: true, reason: 'payment_dispute' };
  if (RE_DAMAGE.test(text)) return { escalate: true, reason: 'property_damage' };
  if (RE_HUMAN.test(text)) return { escalate: true, reason: 'explicit_human_request' };
  if (repeatedComplaintCount >= 3) return { escalate: true, reason: 'repeated_unresolved_complaint' };
  if (isStruggling({ intent, confidence }) && struggleStreak >= STRUGGLE_STREAK_THRESHOLD) {
    return { escalate: true, reason: 'intent_undetermined' };
  }
  return { escalate: false, reason: null };
}

async function triggerEscalation({ crm, phone, customerId, reason, summary }) {
  logger.audit('ESCALATION_REQUESTED', { phone, customerId, reason, result: 'requested' });
  try {
    const escalation = await crm.escalateToHuman({ customerId, phone, reason, summary });
    await sessionStore.setHumanTakeover(phone, true);
    logger.audit('ESCALATION_CREATED', {
      phone,
      customerId,
      reason,
      result: 'success',
      escalationId: escalation && escalation.id,
    });
    logger.log('HUMAN_ESCALATION', { phone, reason });
    return escalation;
  } catch (error) {
    logger.audit('ESCALATION_FAILED', {
      phone,
      customerId,
      reason,
      result: error.uncertain ? 'uncertain' : 'failed',
      error: error.code || error.message,
    });
    throw error;
  }
}

module.exports = { evaluateTriggers, triggerEscalation, isStruggling };
