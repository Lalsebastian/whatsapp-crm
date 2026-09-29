// The ONLY entry point flows/router code should use for free-text understanding.
// Every failure mode (network error, malformed JSON, invalid intent value)
// degrades to UNKNOWN with confidence 0 rather than throwing or guessing —
// callers can always safely proceed as if the AI didn't understand.
const {
  buildIntentPrompt,
  buildComplaintCategoryPrompt,
  buildServiceMatchPrompt,
  INTENTS,
  COMPLAINT_CATEGORIES,
} = require('./promptTemplates');
const { callGemini } = require('./providers/geminiProvider');
const logger = require('../utils/logger');

const UNKNOWN_RESULT = Object.freeze({
  intent: 'UNKNOWN',
  service: null,
  issue: null,
  locationHint: null,
  preferredDate: null,
  preferredTime: null,
  language: 'en',
  confidence: 0,
});

const UNKNOWN_COMPLAINT_CATEGORY = Object.freeze({ category: null, confidence: 0 });

function safeParseJson(text) {
  try {
    const cleaned = text.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    return null;
  }
}

function validate(parsed) {
  if (!parsed || typeof parsed !== 'object' || !INTENTS.includes(parsed.intent)) return null;
  const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0;
  return {
    intent: parsed.intent,
    service: parsed.service || null,
    issue: parsed.issue || null,
    locationHint: parsed.locationHint || null,
    preferredDate: parsed.preferredDate || null,
    preferredTime: parsed.preferredTime || null,
    language: parsed.language || 'en',
    confidence,
  };
}

async function detectIntent(text, context = {}) {
  try {
    const prompt = buildIntentPrompt(text, context);
    const raw = await callGemini(prompt);
    const parsed = safeParseJson(raw);
    const validated = validate(parsed);
    if (!validated) {
      logger.warn('AI', 'Unparseable/invalid intent response — falling back to UNKNOWN:', raw);
      // debugReason is extra, dev-only diagnostic info — surfaced by
      // /api/chat/test, never sent to a real WhatsApp customer.
      return { ...UNKNOWN_RESULT, debugReason: `Unparseable response from model: ${String(raw).slice(0, 300)}` };
    }
    return validated;
  } catch (err) {
    const detail = err.response ? `Gemini ${err.response.status}: ${JSON.stringify(err.response.data)}` : err.message;
    logger.error('AI', 'Intent detection failed:', detail);
    return { ...UNKNOWN_RESULT, debugReason: detail };
  }
}

async function classifyComplaintCategory(text, context = {}) {
  try {
    const prompt = buildComplaintCategoryPrompt(text, context);
    const raw = await callGemini(prompt);
    const parsed = safeParseJson(raw);
    if (!parsed || typeof parsed !== 'object' || !COMPLAINT_CATEGORIES.includes(parsed.category)) {
      logger.warn('AI', 'Unparseable/invalid complaint category response — falling back to category selection:', raw);
      return UNKNOWN_COMPLAINT_CATEGORY;
    }

    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0;
    return { category: parsed.category, confidence };
  } catch (err) {
    const detail = err.response ? `Gemini ${err.response.status}: ${JSON.stringify(err.response.data)}` : err.message;
    logger.error('AI', 'Complaint category detection failed:', detail);
    return UNKNOWN_COMPLAINT_CATEGORY;
  }
}

async function matchServiceToCatalog(text, services, context = {}) {
  if (!text || !Array.isArray(services) || services.length === 0) {
    return { serviceId: null, confidence: 0 };
  }

  try {
    const prompt = buildServiceMatchPrompt(text, services, context);
    const raw = await callGemini(prompt);
    const parsed = safeParseJson(raw);
    const validIds = new Set(services.map((service) => String(service.id)));
    if (!parsed || typeof parsed !== 'object' || !validIds.has(String(parsed.serviceId))) {
      logger.warn('AI', 'Invalid service catalog match — falling back to service options:', raw);
      return { serviceId: null, confidence: 0 };
    }

    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0;
    return { serviceId: String(parsed.serviceId), confidence };
  } catch (err) {
    const detail = err.response ? `Gemini ${err.response.status}: ${JSON.stringify(err.response.data)}` : err.message;
    logger.error('AI', 'Service catalog matching failed:', detail);
    return { serviceId: null, confidence: 0 };
  }
}

module.exports = { detectIntent, classifyComplaintCategory, matchServiceToCatalog };
