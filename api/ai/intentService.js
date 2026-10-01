// The ONLY entry point flows/router code should use for free-text understanding.
// Every failure mode (network error, malformed JSON, invalid intent value)
// degrades to UNKNOWN with confidence 0 rather than throwing or guessing —
// callers can always safely proceed as if the AI didn't understand.
const {
  buildIntentPrompt,
  buildComplaintCategoryPrompt,
  buildServiceMatchPrompt,
  buildBookingCorrectionPrompt,
  buildHandoffSummaryPrompt,
  INTENTS,
  COMPLAINT_CATEGORIES,
} = require('./promptTemplates');
const { callGemini, GEMINI_MODEL } = require('./providers/geminiProvider');
const logger = require('../utils/logger');

const UNKNOWN_RESULT = Object.freeze({
  intent: 'UNKNOWN',
  service: null,
  serviceId: null,
  room: null,
  issue: null,
  propertyHint: null,
  locationHint: null,
  preferredDate: null,
  preferredTime: null,
  bookingReference: null,
  complaintReference: null,
  language: 'en',
  urgency: 'normal',
  confidence: 0,
});

const UNKNOWN_COMPLAINT_CATEGORY = Object.freeze({ category: null, confidence: 0 });
const UNKNOWN_BOOKING_CORRECTION = Object.freeze({
  service: null,
  locationHint: null,
  preferredDate: null,
  preferredTime: null,
  confidence: 0,
});

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
    serviceId: null,
    room: parsed.room || null,
    issue: parsed.issue || null,
    propertyHint: parsed.propertyHint || parsed.locationHint || null,
    locationHint: parsed.locationHint || null,
    preferredDate: parsed.preferredDate || null,
    preferredTime: parsed.preferredTime || null,
    bookingReference: parsed.bookingReference || null,
    complaintReference: parsed.complaintReference || null,
    language: parsed.language || 'en',
    urgency: parsed.urgency === 'urgent' ? 'urgent' : 'normal',
    confidence,
  };
}

async function callTracked(taskType, prompt) {
  const startedAt = Date.now();
  logger.audit('AI_INTENT_REQUESTED', {
    provider: 'gemini',
    model: GEMINI_MODEL,
    taskType,
    result: 'requested',
  });
  try {
    const raw = await callGemini(prompt);
    logger.audit('AI_INTENT_RESOLVED', {
      provider: 'gemini',
      model: GEMINI_MODEL,
      taskType,
      latencyMs: Date.now() - startedAt,
      result: 'success',
    });
    return raw;
  } catch (error) {
    const timeout = ['OPERATION_TIMEOUT', 'ECONNABORTED', 'ETIMEDOUT'].includes(error.code);
    logger.audit(timeout ? 'AI_TIMEOUT' : 'AI_ERROR', {
      provider: 'gemini',
      model: GEMINI_MODEL,
      taskType,
      latencyMs: Date.now() - startedAt,
      errorCategory: timeout ? 'AI_PROVIDER_TIMEOUT' : 'AI_PROVIDER_ERROR',
      statusCode: error.response && error.response.status,
      result: 'failed',
    });
    throw error;
  }
}

async function detectIntent(text, context = {}) {
  try {
    const prompt = buildIntentPrompt(text, context);
    const raw = await callTracked('intent_detection', prompt);
    const parsed = safeParseJson(raw);
    const validated = validate(parsed);
    if (!validated) {
      logger.audit('AI_FALLBACK_USED', { taskType: 'intent_detection', reason: 'invalid_response', result: 'fallback' });
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
    const raw = await callTracked('complaint_classification', prompt);
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
    const raw = await callTracked('service_match', prompt);
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

async function analyzeBookingCorrection(text, context = {}) {
  if (!text) return UNKNOWN_BOOKING_CORRECTION;
  try {
    const prompt = buildBookingCorrectionPrompt(text, context);
    const raw = await callTracked('booking_correction', prompt);
    const parsed = safeParseJson(raw);
    if (!parsed || typeof parsed !== 'object') {
      logger.warn('AI', 'Invalid booking correction response:', raw);
      return UNKNOWN_BOOKING_CORRECTION;
    }
    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0;
    const optionalText = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
    return {
      service: optionalText(parsed.service),
      locationHint: optionalText(parsed.locationHint),
      preferredDate: optionalText(parsed.preferredDate),
      preferredTime: optionalText(parsed.preferredTime),
      confidence,
    };
  } catch (err) {
    const detail = err.response ? `Gemini ${err.response.status}: ${JSON.stringify(err.response.data)}` : err.message;
    logger.error('AI', 'Booking correction analysis failed:', detail);
    return UNKNOWN_BOOKING_CORRECTION;
  }
}

async function summarizeHandoff(handoff) {
  try {
    const raw = await callTracked('handoff_summary', buildHandoffSummaryPrompt(handoff));
    const parsed = safeParseJson(raw);
    if (!parsed || typeof parsed.summary !== 'string' || !parsed.summary.trim()) return null;
    return parsed.summary.trim().slice(0, 1000);
  } catch (err) {
    const detail = err.response ? `Gemini ${err.response.status}: ${JSON.stringify(err.response.data)}` : err.message;
    logger.error('AI', 'Handoff summary generation failed:', detail);
    return null;
  }
}

module.exports = {
  detectIntent,
  classifyComplaintCategory,
  matchServiceToCatalog,
  analyzeBookingCorrection,
  summarizeHandoff,
};
