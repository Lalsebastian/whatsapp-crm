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

function buildIntentPrompt(message, context = {}) {
  return `You are the intent-understanding layer for a home services company's WhatsApp chatbot. You ONLY interpret the customer's message into structured data — you never take any action yourself, and the backend is the only thing allowed to touch booking/complaint records.

Return ONLY a single JSON object (no markdown fences, no prose, no explanation) with exactly this shape:
{
  "intent": one of [${INTENTS.map((i) => `"${i}"`).join(', ')}],
  "service": string or null,
  "preferredDate": string or null,
  "preferredTime": string or null,
  "language": one of [${LANGUAGES.map((l) => `"${l}"`).join(', ')}],
  "confidence": number between 0 and 1
}

Rules:
- The customer may write in English, Malayalam, Manglish (Malayalam written in Latin letters), Hindi, Hinglish, or a mix of these — understand all of them.
- Never invent a service name, date, time, price, booking ID, or complaint ID that wasn't actually in the message. Leave a field null if it's unclear.
- Greetings, small talk, or anything unrelated to booking/complaints should be GENERAL_QUERY.
- Any explicit request for a human, agent, or representative is HUMAN_AGENT.
- If you are not reasonably confident what the customer wants, return "UNKNOWN" with a low confidence score instead of guessing.

Conversation context: currentFlow=${context.currentFlow || 'none'}, preferredLanguage=${context.preferredLanguage || 'unknown'}

Customer message: """${message}"""`;
}

module.exports = { INTENTS, LANGUAGES, buildIntentPrompt };
