// Intent shortcut engine: deterministic detection of high-value intents so a
// customer who says what they want goes straight to the right flow, with no
// menu navigation and no AI call.
//
//   "book AC tomorrow"        -> NEW_BOOKING (service AC, date tomorrow)
//   "cancel my booking"       -> CANCEL_BOOKING
//   "same problem again"      -> COMPLAINT (repeat problem)
//   "where is my complaint"   -> COMPLAINT_STATUS
//   "talk to human"           -> HUMAN_AGENT
//
// Rules are ordered from most to least specific. A rule fires only on clear
// wording; anything ambiguous returns null (or low confidence) so the caller
// can fall back to AI or ask a focused question.
const { rankFamilies, clearFamily, urgentReason } = require('./serviceSynonyms');

const RULES = [
  {
    intent: 'HUMAN_AGENT',
    confidence: 0.98,
    test: /\b(?:human|real person|live agent|customer care|customer service|representative|talk to (?:a |an |the )?(?:person|someone|somebody|agent|support|team|staff)|speak (?:to|with) (?:a |an |the )?(?:person|someone|agent|support|team|staff)|call me back)\b/i,
  },
  {
    intent: 'COMPLAINT_STATUS',
    confidence: 0.96,
    test: /\bCM-[A-Z0-9]{4,}\b|\b(?:where(?:'s| is)?|status|update|progress|track|any news|what happened)\b[^.?!]{0,30}\bcomplaints?\b|\bcomplaints?\b[^.?!]{0,20}\b(?:status|update|progress)\b/i,
  },
  {
    intent: 'CANCEL_BOOKING',
    confidence: 0.96,
    test: /\b(?:cancel|cancell?ation)\b[^.?!]{0,25}\b(?:booking|appointment|visit|service|job|order|it)\b|\bdon'?t (?:need|want) (?:the |my )?(?:booking|appointment|visit|technician) any ?more\b/i,
  },
  {
    intent: 'RESCHEDULE_BOOKING',
    confidence: 0.94,
    test: /\b(?:reschedule|re-schedule|postpone|prepone)\b|\b(?:change|move|shift)\s+(?:the |my )?(?:booking |appointment |visit )?(?:date|time|slot|day)\b|\b(?:change|move|shift)\s+(?:my |the )?(?:booking|appointment|visit)\b/i,
  },
  {
    intent: 'BOOKING_STATUS',
    confidence: 0.92,
    test: /\b(?:where(?:'s| is)?|when (?:is|will|does)|status|track|eta|any update)\b[^.?!]{0,30}\b(?:technician|booking|appointment|plumber|electrician|cleaner|worker|team)\b|\b(?:technician|plumber|electrician|worker)\b[^.?!]{0,20}\b(?:not|hasn'?t|has not|didn'?t|did not) (?:come|arrive|arrived|reach|reached|turn(?:ed)? up)\b|\b(?:booking|appointment)\s+status\b|\bBK-[A-Z0-9]{4,}\b/i,
  },
  {
    intent: 'MY_BOOKINGS',
    confidence: 0.95,
    test: /\b(?:my|show|see|view|list)\b[^.?!]{0,10}\b(?:bookings?|appointments?)\b/i,
  },
  {
    intent: 'COMPLAINT',
    confidence: 0.9,
    repeatProblem: true,
    test: /\bsame (?:problem|issue|thing)\b|\b(?:problem|issue|leak|leaking|fault|dripping|tripping)\b[^.?!]{0,20}\b(?:again|came back|is back|returned)\b|\bstill (?:not working|leaking|broken|the same|dripping|not cooling)\b|\bnot fixed\b/i,
  },
  {
    intent: 'COMPLAINT',
    confidence: 0.9,
    test: /\b(?:complain|complaint|bad service|poor service|not satisfied|unsatisfied|dissatisfied|unhappy with|rude|overcharg\w*|refund|damaged my|broke my)\b/i,
  },
  {
    intent: 'FEEDBACK',
    confidence: 0.92,
    test: /\b(?:rate|rating|review|feedback)\b[^.?!]{0,20}\b(?:service|booking|technician|visit|job)\b|\bgive (?:a )?(?:rating|feedback|review)\b/i,
  },
  {
    intent: 'GENERAL_QUERY',
    confidence: 0.85,
    services: true,
    test: /\b(?:what services|which services|services (?:do you|you) (?:offer|provide|have)|price list|prices?|rates?|how much (?:is|does|for)|charges?)\b/i,
  },
];

const BOOKING_VERBS = /\b(?:book|booking|schedule|need|needs|want|require|send|arrange|get|fix|repair|install|service|venam|venum|chahiye|cheyyanam)\b/i;

/**
 * @returns {null | {
 *   intent: string, confidence: number, source: 'shortcut',
 *   repeatProblem?: boolean, urgentReason?: string|null,
 *   serviceFamily?: {key, label}|null, candidates: Array<{key, label, score}>
 * }}
 */
function detectShortcut(text) {
  const value = String(text || '').trim();
  if (!value) return null;
  const candidates = rankFamilies(value);
  const family = clearFamily(value);
  const base = { source: 'shortcut', candidates, serviceFamily: family, urgentReason: urgentReason(value) };

  for (const rule of RULES) {
    if (rule.test.test(value)) {
      return { ...base, intent: rule.intent, confidence: rule.confidence, repeatProblem: !!rule.repeatProblem, servicesInfo: !!rule.services };
    }
  }

  // A clear service family is a booking request ("water leak", "book AC
  // tomorrow", "washing machine not spinning").
  if (family) {
    return { ...base, intent: 'NEW_BOOKING', confidence: BOOKING_VERBS.test(value) ? 0.95 : 0.9 };
  }
  // Several plausible services: still a booking, but which service needs a
  // focused question, not a menu.
  if (candidates.length > 1) {
    return { ...base, intent: 'NEW_BOOKING', confidence: 0.7, ambiguousService: true };
  }
  if (/\b(?:book|booking|appointment|schedule)\b/i.test(value)) {
    return { ...base, intent: 'NEW_BOOKING', confidence: 0.86 };
  }
  return null;
}

module.exports = { detectShortcut, RULES };
