const { clearFamily, rankFamilies, urgentReason } = require('./serviceSynonyms');
const { detectShortcut } = require('./shortcuts');

const ROOM_PATTERNS = [
  ['kitchen', /\bkitchen\b/i],
  ['bathroom', /\b(?:bathroom|washroom|toilet)\b/i],
  ['bedroom', /\b(?:bedroom|bed room)\b/i],
  ['living room', /\b(?:living room|hall)\b/i],
  ['dining room', /\b(?:dining room|dining)\b/i],
  ['balcony', /\bbalcony\b/i],
  ['terrace', /\b(?:terrace|rooftop|roof)\b/i],
  ['garden', /\b(?:garden|yard)\b/i],
  ['garage', /\bgarage\b/i],
  ['office', /\boffice\b/i],
  ['entire home', /\b(?:entire|whole) (?:home|house|flat|apartment)\b/i],
];

const SERVICE_SIGNALS = [
  ['Plumbing', /\b(?:plumb(?:er|ing)?|pipe|tap|faucet|sink|drain|leak(?:ing)?|water line)\b/i],
  ['Electrical', /\b(?:electric(?:al|ian)?|light|bulb|switch|socket|wiring|breaker|power)\b/i],
  ['Pest Control', /\b(?:pest|cockroach(?:es)?|roach(?:es)?|ant(?:s)?|termite(?:s)?|bed ?bug(?:s)?|insect(?:s)?)\b/i],
  ['Appliance Repair', /\b(?:fridge|refrigerator|washing machine|dishwasher|oven|appliance)\b/i],
  ['AC Service & Repair', /\b(?:a\/?c|air conditioner|air conditioning)\b/i],
  ['Cleaning', /\b(?:clean(?:ing)?|dirty|deep clean|maid)\b/i],
];

function firstMatch(text, entries) {
  const found = entries.find(([, pattern]) => pattern.test(text));
  return found ? found[0] : null;
}

function extractLocationHint(text) {
  const match = String(text || '').match(/\b(?:at|in|near)\s+([a-z][a-z .'-]{2,40}?)(?=\s+(?:today|tomorrow|nale|morning|afternoon|evening|after|before|at\s+\d)|[,.;]|$)/i);
  return match ? match[1].trim() : null;
}

function extractTime(text) {
  const value = String(text || '');
  const after = value.match(/\bafter\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i);
  if (after) return after[0];
  const clock = value.match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i);
  if (clock) return clock[0];
  const period = value.match(/\b(?:morning|afternoon|evening|night|ravile|raavile|uchakku|vaikunneram|subah|dopahar|shaam)\b/i);
  return period ? period[0].toLowerCase() : null;
}

function extractDate(text) {
  const value = String(text || '');
  const relative = value.match(/\b(?:day after tomorrow|tomorrow|today|nale|naale|kal)\b/i);
  if (relative) {
    const normalized = relative[0].toLowerCase();
    if (['nale', 'naale', 'kal'].includes(normalized)) return 'tomorrow';
    return normalized;
  }
  const explicit = value.match(/\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b/);
  if (explicit) return explicit[0];
  const weekday = value.match(/\b(?:next )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  return weekday ? weekday[0] : null;
}

function normalizeCustomerMessage(text, ai = {}) {
  const value = String(text || '').trim();
  const lower = value.toLowerCase();
  const room = ai.room || firstMatch(value, ROOM_PATTERNS);
  const shortcut = detectShortcut(value);
  // The synonym dictionary decides the service; the regex list is only a
  // fallback for wording it does not know yet.
  const family = clearFamily(value);
  const inferredService = family ? family.label : (rankFamilies(value).length > 1 ? null : firstMatch(value, SERVICE_SIGNALS));
  const complaintReference = ai.complaintReference || (value.match(/\bCM-[A-Z0-9-]+\b/i) || [])[0] || null;
  const bookingReference = ai.bookingReference || (value.match(/\bBK-[A-Z0-9-]+\b/i) || [])[0] || null;
  const repeatProblem = (shortcut && shortcut.repeatProblem) || /\b(?:still|again|returned|back|same issue|repeat)\b/i.test(value);
  const complaintSignal = /\b(?:complaint|damag(?:e|ed)|refund|rude|late|yesterday).*(?:still|again|not|issue|problem|leak)/i.test(value)
    || repeatProblem;
  const issueSignal = rankFamilies(value).length > 0 || SERVICE_SIGNALS.some(([, pattern]) => pattern.test(value));
  const ruleIntent = shortcut ? shortcut.intent : null;
  const deterministicIntent = ruleIntent && ruleIntent !== 'NEW_BOOKING'
    ? ruleIntent
    : (complaintSignal ? 'COMPLAINT' : (room || inferredService || issueSignal || ruleIntent ? 'NEW_BOOKING' : null));
  const ruleConfidence = shortcut ? shortcut.confidence : (deterministicIntent ? (inferredService ? 0.95 : 0.82) : 0);
  const language = ai.language || (/\b(?:nale|naale|aanu|venam|illa|potti|ravile|vaikunneram)\b/i.test(value) ? 'manglish' : 'en');
  // A clear, explicit command ("cancel my booking", "talk to a human") beats
  // a model's reading; otherwise the model's intent is preferred when it has one.
  const strongRule = shortcut && shortcut.confidence >= 0.94 && shortcut.intent !== 'NEW_BOOKING';
  const aiIntent = ai.intent && ai.intent !== 'UNKNOWN' ? ai.intent : null;

  return {
    intent: strongRule ? shortcut.intent : (aiIntent || deterministicIntent || ai.intent || 'UNKNOWN'),
    service: ai.service || inferredService,
    serviceId: ai.serviceId || null,
    room,
    issue: ai.issue || (issueSignal ? value : null),
    propertyHint: ai.propertyHint || ai.locationHint || extractLocationHint(value),
    locationHint: ai.locationHint || ai.propertyHint || extractLocationHint(value),
    preferredDate: ai.preferredDate || extractDate(value),
    preferredTime: ai.preferredTime || extractTime(value),
    bookingReference,
    complaintReference,
    language,
    urgency: ai.urgency || (/\b(?:urgent|emergency|immediately|asap|flooding|sparking)\b/i.test(lower) || urgentReason(value) ? 'urgent' : 'normal'),
    confidence: strongRule ? shortcut.confidence : Math.max(Number(ai.confidence) || 0, deterministicIntent ? ruleConfidence : 0),
    repeatProblem,
    ambiguousService: !inferredService && rankFamilies(value).length > 1,
    serviceCandidates: rankFamilies(value).map((item) => item.label),
  };
}

function extractedStructuredFields(understanding = {}) {
  return [
    (understanding.service || understanding.serviceId) && 'service',
    understanding.room && 'room',
    understanding.issue && 'issue',
    (understanding.propertyHint || understanding.locationHint) && 'property',
    understanding.preferredDate && 'date',
    understanding.preferredTime && 'time',
    understanding.bookingReference && 'bookingReference',
    understanding.complaintReference && 'complaintReference',
    understanding.urgency && understanding.urgency !== 'normal' && 'urgency',
  ].filter(Boolean);
}

module.exports = { normalizeCustomerMessage, extractedStructuredFields, ROOM_PATTERNS, SERVICE_SIGNALS };
