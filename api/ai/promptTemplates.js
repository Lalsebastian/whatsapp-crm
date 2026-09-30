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
  'FEEDBACK',
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
const { hintsForService } = require('./serviceHints');

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
- A request to rate, review, or give feedback about a completed service is FEEDBACK.
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
    semanticHints: hintsForService(service),
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

function buildBookingCorrectionPrompt(message, context = {}) {
  return `Extract changes the customer wants to make to a home-services booking that is currently being reviewed. You only interpret the request; you never update or create a booking.

Return ONLY one JSON object with exactly this shape:
{
  "service": string or null,
  "locationHint": string or null,
  "preferredDate": string or null,
  "preferredTime": string or null,
  "confidence": number between 0 and 1
}

Rules:
- Include only fields the customer explicitly wants to change. Leave every unchanged field null.
- Understand corrections such as "actually make it tomorrow", "use my office address", "make it plumbing instead", and "evening is better".
- A single message may change several fields, such as "change it to plumbing tomorrow morning".
- For a relative date or weekday, preserve the customer's wording (for example "tomorrow" or "Friday").
- Never invent a service, address, date, or time.
- Understand English, Malayalam, Manglish, Hindi, Hinglish, and mixed-language requests.

Current booking: ${JSON.stringify(context.booking || {})}
Preferred language: ${context.preferredLanguage || 'unknown'}
Customer correction: """${message}"""`;
}

function buildHandoffSummaryPrompt(handoff) {
  return `Write a short internal support summary for a home-services case.

Return ONLY one JSON object with exactly this shape:
{
  "summary": string
}

Rules:
- Use only facts present in the supplied handoff data.
- Keep the summary concise: no more than three short sentences.
- Preserve the practical issue, relevant booking or complaint context, supplied media, and what the customer is asking for.
- Do not speculate about emotions, fault, technician arrival times, outcomes, or promises.
- Do not invent missing details.
- This is internal staff context, not customer-facing wording.

Handoff data: ${JSON.stringify(handoff)}`;
}

module.exports = {
  INTENTS,
  LANGUAGES,
  COMPLAINT_CATEGORIES,
  buildIntentPrompt,
  buildComplaintCategoryPrompt,
  buildServiceMatchPrompt,
  buildBookingCorrectionPrompt,
  buildHandoffSummaryPrompt,
};
