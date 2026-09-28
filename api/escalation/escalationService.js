// Central place for every human-escalation trigger described in the brief:
// explicit request, refund/payment dispute, property damage, safety concern,
// repeated unresolved complaints, low AI confidence, and intent that stays
// undetermined after repeated attempts (tracked via session.context.unknownStreak
// by the router, passed in as `unknownStreak`).
const sessionStore = require('../session/sessionStore');

const RE_SAFETY = /\b(unsafe|danger|threat|harass|inappropriate|scared|afraid)\b/i;
const RE_PAYMENT = /\b(refund|overcharg|payment issue|money back|dispute|scam)\b/i;
const RE_DAMAGE = /\b(damage|damaged|broke|broken)\b/i;
const RE_HUMAN = /\b(human|agent|representative|real person|talk to (a )?person|speak to (someone|somebody))\b/i;

const LOW_CONFIDENCE_THRESHOLD = 0.4;
const UNKNOWN_STREAK_THRESHOLD = 3;

function evaluateTriggers({ text = '', intent, confidence, category, repeatedComplaintCount = 0, unknownStreak = 0 } = {}) {
  if (intent === 'HUMAN_AGENT') return { escalate: true, reason: 'explicit_human_request' };
  if (category === 'property_damage') return { escalate: true, reason: 'property_damage' };
  if (category === 'payment_issue') return { escalate: true, reason: 'payment_dispute' };
  if (RE_SAFETY.test(text)) return { escalate: true, reason: 'safety_concern' };
  if (RE_PAYMENT.test(text)) return { escalate: true, reason: 'payment_dispute' };
  if (RE_DAMAGE.test(text)) return { escalate: true, reason: 'property_damage' };
  if (RE_HUMAN.test(text)) return { escalate: true, reason: 'explicit_human_request' };
  if (repeatedComplaintCount >= 3) return { escalate: true, reason: 'repeated_unresolved_complaint' };
  if (typeof confidence === 'number' && confidence < LOW_CONFIDENCE_THRESHOLD && intent !== 'UNKNOWN') {
    return { escalate: true, reason: 'low_ai_confidence' };
  }
  if (intent === 'UNKNOWN' && unknownStreak >= UNKNOWN_STREAK_THRESHOLD) {
    return { escalate: true, reason: 'intent_undetermined' };
  }
  return { escalate: false, reason: null };
}

async function triggerEscalation({ crm, phone, customerId, reason, summary }) {
  await crm.escalateToHuman({ customerId, phone, reason, summary });
  await sessionStore.setHumanTakeover(phone, true);
}

module.exports = { evaluateTriggers, triggerEscalation };
