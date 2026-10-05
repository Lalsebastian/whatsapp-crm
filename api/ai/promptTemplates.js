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
  "room": string or null,
  "issue": string or null,
  "propertyHint": string or null,
  "locationHint": string or null,
  "preferredDate": string or null,
  "preferredTime": string or null,
  "bookingReference": string or null,
  "complaintReference": string or null,
  "urgency": one of ["normal", "urgent"],
  "language": one of [${LANGUAGES.map((l) => `"${l}"`).join(', ')}],
  "confidence": number between 0 and 1
}

Rules:
- The customer may write in English, Malayalam, Manglish (Malayalam written in Latin letters), Hindi, Hinglish, or a mix of these — understand all of them.
- Never invent a service name, date, time, price, booking reference, complaint reference, address, or location that wasn't actually in the message. Leave a field null if it's unclear.
- A room or household area such as kitchen or bathroom is not itself a service.
- Extract every explicitly supplied booking field in the same response, including room, issue, property/location, date, time, and references.
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
  return `You assist a human support agent who is taking over a home-services WhatsApp conversation.

Return ONLY one JSON object with exactly this shape:
{
  "summary": string,
  "suggestedReply": string,
  "nextAction": string
}

Rules:
- Use only facts present in the supplied handoff data. Do not invent missing details.
- "summary": internal staff context, at most three short sentences: the practical issue, the relevant booking or complaint, supplied media, and what the customer wants.
- "suggestedReply": the agent's first WhatsApp message to the customer, at most three short sentences, warm and specific to this case, written in the customer's language when it is clear from the data (otherwise English). Address the customer by first name if known. It must NOT promise arrival times, refunds, compensation, fault, or outcomes, and must not claim actions that have not happened.
- "nextAction": one short internal instruction for the agent (what to check or do first).
- No speculation about emotions, fault, or causes.

Handoff data: ${JSON.stringify(handoff)}`;
}

function buildImageReviewPrompt(context = {}) {
  return `You review a photo a customer sent to a home-services company about a service problem.

Return ONLY one JSON object with exactly this shape:
{
  "relevance": one of ["relevant", "unclear", "unrelated"],
  "subject": string,
  "containsSensitiveDocument": boolean,
  "confidence": number between 0 and 1
}

Rules:
- "subject" is a short, neutral description of what is visible (at most 12 words), e.g. "water stain under a kitchen sink".
- "relevant": the photo plausibly shows a home, appliance, fixture, damage, leak, pest, mess, receipt or invoice related to a home service.
- "unclear": too dark, blurred or close-up to tell.
- "unrelated": clearly unrelated (selfie, meme, screenshot of a chat, landscape).
- "containsSensitiveDocument": true if a passport, ID card, bank/credit card, cheque, or a document with personal data is readable.
- Describe only what is visible. Do NOT diagnose causes, assign fault, estimate costs, or judge safety.
- Never invent details that are not visible.

Customer's issue so far (may be empty): """${String(context.issue || '').slice(0, 300)}"""`;
}

module.exports = {
  buildImageReviewPrompt,
  INTENTS,
  LANGUAGES,
  COMPLAINT_CATEGORIES,
  buildIntentPrompt,
  buildComplaintCategoryPrompt,
  buildServiceMatchPrompt,
  buildBookingCorrectionPrompt,
  buildHandoffSummaryPrompt,
};
