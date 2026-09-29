const INTENTS = [
  'NEW_BOOKING',
  'MY_BOOKINGS',
  'BOOKING_STATUS',
  'RESCHEDULE_BOOKING',
  'CANCEL_BOOKING',
  'COMPLAINT',
  'COMPLAINT_STATUS',
  'GENERAL_QUERY',
  'HUMAN_AGENT',
  'UNKNOWN',
];

const LANGUAGES = ['en', 'ml', 'manglish', 'hi', 'hinglish', 'mixed'];

const COMPLAINT_CATEGORIES = [
  'service_not_completed',
  'problem_returned',
  'technician_delayed',
  'technician_behaviour',
  'property_damage',
  'payment_issue',
  'other',
];

function buildIntentPrompt(message, context = {}) {
  return `You are the intent-understanding layer for a home services company's WhatsApp chatbot. You ONLY interpret the customer's message into structured data — you never take any action yourself, and the backend is the only thing allowed to touch booking/complaint records.

Return ONLY a single JSON object (no markdown fences, no prose, no explanation) with exactly this shape:
{
  "intent": one of [${INTENTS.map((i) => `"${i}"`).join(', ')}],
  "service": string or null,
  "issue": string or null,
  "locationHint": string or null,
  "preferredDate": string or null,
  "preferredTime": string or null,
  "language": one of [${LANGUAGES.map((l) => `"${l}"`).join(', ')}],
  "confidence": number between 0 and 1
}

Rules:
- The customer may write in English, Malayalam, Manglish (Malayalam written in Latin letters), Hindi, Hinglish, or a mix of these — understand all of them.
- Never invent a service name, date, time, price, booking ID, or complaint ID that wasn't actually in the message. Leave a field null if it's unclear.
- Extract a short issue description and location hint only when the customer explicitly provides them.
- Greetings, small talk, or anything unrelated to booking/complaints should be GENERAL_QUERY.
- Any explicit request for a human, agent, or representative is HUMAN_AGENT.
- If you are not reasonably confident what the customer wants, return "UNKNOWN" with a low confidence score instead of guessing.

Conversation context: currentFlow=${context.currentFlow || 'none'}, preferredLanguage=${context.preferredLanguage || 'unknown'}

Customer message: """${message}"""`;
}

function buildComplaintCategoryPrompt(message, context = {}) {
  return `You classify a customer's home-services complaint into one category. You only interpret the message; you never create, update, or submit a complaint.

Return ONLY a single JSON object (no markdown fences, prose, or explanation) with exactly this shape:
{
  "category": one of [${COMPLAINT_CATEGORIES.map((category) => `"${category}"`).join(', ')}] or null,
  "confidence": number between 0 and 1
}

Rules:
- Choose the single category that best represents the main issue in the message.
- Use "other" only when the issue is clear but does not fit another category.
- Return null with low confidence when the complaint category is unclear.
- Understand English, Malayalam, Manglish, Hindi, Hinglish, and mixed-language messages.
- Do not invent details that are not in the customer's message.

Conversation context: preferredLanguage=${context.preferredLanguage || 'unknown'}

Customer complaint: """${message}"""`;
}

function buildServiceMatchPrompt(message, services, context = {}) {
  const catalog = services.map((service) => ({
    id: service.id,
    name: service.name,
    category: service.category || null,
    description: service.description || null,
  }));

  return `Match a customer's home-service request to the supplied CRM service catalog. You only interpret the request; you never book or modify anything.

Return ONLY one JSON object with exactly this shape:
{
  "serviceId": string or null,
  "confidence": number between 0 and 1
}

Rules:
- serviceId must be one of the exact IDs in the supplied catalog, or null.
- Never invent a service or ID.
- Return null with low confidence when more than one service is plausible or none fits.
- Understand English, Malayalam, Manglish, Hindi, Hinglish, and mixed-language requests.

Preferred language: ${context.preferredLanguage || 'unknown'}
CRM services: ${JSON.stringify(catalog)}
Customer request: """${message}"""`;
}

module.exports = {
  INTENTS,
  LANGUAGES,
  COMPLAINT_CATEGORIES,
  buildIntentPrompt,
  buildComplaintCategoryPrompt,
  buildServiceMatchPrompt,
};
