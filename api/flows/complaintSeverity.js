// Complaint severity: decides how serious a complaint is and therefore its
// CRM priority and whether a human takes over immediately.
//
//   safety    gas, sparks, flooding, threats, feeling unsafe    -> urgent/high, human now
//   damage    property damaged during or after the service      -> high, human now
//   payment   overcharge, refund, billing dispute               -> high, human now
//   repeated  the same problem came back, or several open cases -> high, human now
//   conduct   technician behaviour                              -> high, human now
//   normal    everything else                                   -> normal, team follows up
const { priorityFor } = require('../escalation/escalationService');
const { urgentReason } = require('../ai/serviceSynonyms');

const RE_SAFETY_WORDS = /\b(?:unsafe|dangerous|threat\w*|harass\w*|inappropriate|scared|afraid|assault\w*|abus\w*)\b/i;
const RE_DAMAGE = /\b(?:damag\w*|broke|broken|scratch\w*|cracked|stain\w*|burnt|ruined)\b/i;
const RE_PAYMENT = /\b(?:refund|overcharg\w*|charged (?:twice|double|extra)|billing|invoice|payment|money back|extra money)\b/i;
const RE_REPEAT = /\b(?:again|same (?:problem|issue)|came back|returned|still (?:not|leaking|broken)|second time|third time|not fixed)\b/i;

const SEVERITY_BY_CATEGORY = {
  property_damage: 'damage',
  payment_issue: 'payment',
  problem_returned: 'repeated',
  technician_behaviour: 'conduct',
};

const REASONS = {
  damage: 'property_damage',
  payment: 'payment_dispute',
  repeated: 'repeat_service_failure',
  conduct: 'technician_behaviour',
};

/**
 * @param {object} input
 * @param {string} [input.category]
 * @param {string} [input.description]
 * @param {number} [input.openComplaintCount] other open complaints for this customer
 * @returns {{ level: string, priority: 'urgent'|'high'|'normal', escalate: boolean, reason: string|null }}
 */
function assessSeverity({ category, description = '', openComplaintCount = 0 } = {}) {
  const text = String(description || '');
  const urgent = urgentReason(text);
  if (urgent || RE_SAFETY_WORDS.test(text)) {
    const reason = urgent || 'safety_concern';
    return { level: 'safety', priority: priorityFor(reason, text) === 'URGENT' ? 'urgent' : 'high', escalate: true, reason };
  }
  let level = SEVERITY_BY_CATEGORY[category] || null;
  if (!level && RE_DAMAGE.test(text)) level = 'damage';
  if (!level && RE_PAYMENT.test(text)) level = 'payment';
  if (!level && (RE_REPEAT.test(text) || openComplaintCount >= 2)) level = 'repeated';
  if (!level) return { level: 'normal', priority: 'normal', escalate: false, reason: null };
  return { level, priority: 'high', escalate: true, reason: REASONS[level] };
}

module.exports = { assessSeverity };
