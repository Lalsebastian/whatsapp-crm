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
  buildImageReviewPrompt,
  INTENTS,
  COMPLAINT_CATEGORIES,
} = require('./promptTemplates');
const geminiProvider = require('./providers/geminiProvider');

const { callGemini, GEMINI_MODEL } = geminiProvider;
const messageBudget = require('../analytics/messageBudget');
const { getRequestContext } = require('../reliability/requestContext');

// Below this a primary answer is poor enough to justify the fallback model.
const LOW_CONFIDENCE = 0.4;
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

async function callTracked(taskType, prompt, { model = GEMINI_MODEL } = {}) {
  const startedAt = Date.now();
  // Every model request is counted against the conversation for the
  // AI-calls-per-booking cost analytics.
  messageBudget.aiCall(getRequestContext().phone);
  logger.audit('AI_INTENT_REQUESTED', {
    provider: 'gemini',
    model,
    taskType,
    result: 'requested',
  });
  try {
    const raw = await callGemini(prompt, model === GEMINI_MODEL ? undefined : { model });
    logger.audit('AI_INTENT_RESOLVED', {
      provider: 'gemini',
      model,
      taskType,
      latencyMs: Date.now() - startedAt,
      result: 'success',
    });
    return raw;
  } catch (error) {
    const timeout = ['OPERATION_TIMEOUT', 'ECONNABORTED', 'ETIMEDOUT'].includes(error.code);
    logger.audit(timeout ? 'AI_TIMEOUT' : 'AI_ERROR', {
      provider: 'gemini',
      model,
      taskType,
      latencyMs: Date.now() - startedAt,
      errorCategory: timeout ? 'AI_PROVIDER_TIMEOUT' : 'AI_PROVIDER_ERROR',
      statusCode: error.response && error.response.status,
      result: 'failed',
    });
    throw error;
  }
}

function errorDetail(err) {
  return err.response ? `Gemini ${err.response.status}: ${JSON.stringify(err.response.data)}` : err.message;
}

// One attempt with a given model: validated result, or { failure } when the
// call errored or the answer could not be used.
async function attemptIntent(prompt, taskType, model) {
  try {
    const raw = await callTracked(taskType, prompt, { model });
    const validated = validate(safeParseJson(raw));
    return validated ? { result: validated } : { failure: `Unparseable response from model: ${String(raw).slice(0, 300)}`, unparseable: true };
  } catch (err) {
    return { failure: errorDetail(err) };
  }
}

/**
 * Intent detection with a bounded escalation ladder, so a message never pays
 * for more than it needs:
 *   1. primary model
 *   2. primary model again, only if the first answer was unparseable
 *   3. fallback model (fallbackModel, optional), only if the primary
 *      failed twice, errored, or answered with very low confidence
 */
async function detectIntent(text, context = {}) {
  const prompt = buildIntentPrompt(text, context);
  let attempt = await attemptIntent(prompt, 'intent_detection', GEMINI_MODEL);
  if (attempt.unparseable) {
    logger.audit('AI_FALLBACK_USED', { taskType: 'intent_detection', reason: 'invalid_response_retry', result: 'retry' });
    attempt = await attemptIntent(prompt, 'intent_detection_retry', GEMINI_MODEL);
  }

  const poor = attempt.result && attempt.result.confidence < LOW_CONFIDENCE;
  const fallbackModel = geminiProvider.fallbackModel();
  if (fallbackModel && (attempt.failure || poor)) {
    const fallback = await attemptIntent(prompt, 'intent_detection_fallback_model', fallbackModel);
    logger.audit('AI_FALLBACK_MODEL_USED', {
      taskType: 'intent_detection',
      model: fallbackModel,
      reason: attempt.failure ? 'primary_failed' : 'primary_low_confidence',
      result: fallback.result ? 'success' : 'failed',
    });
    if (fallback.result && (!attempt.result || fallback.result.confidence > attempt.result.confidence)) {
      return { ...fallback.result, model: fallbackModel };
    }
  }

  if (attempt.result) return attempt.result;
  logger.audit('AI_FALLBACK_USED', { taskType: 'intent_detection', reason: 'invalid_response', result: 'fallback' });
  logger.warn('AI', 'Intent detection unusable — falling back to UNKNOWN:', attempt.failure);
  // debugReason is extra, dev-only diagnostic info — surfaced by
  // /api/chat/test, never sent to a real WhatsApp customer.
  return { ...UNKNOWN_RESULT, debugReason: attempt.failure };
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

function boundedText(value, max) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

/**
 * Agent assist for a handoff, in one model call.
 * @returns {Promise<{summary: string, suggestedReply: string|null, nextAction: string|null}|null>}
 */
async function assistHandoff(handoff) {
  try {
    const raw = await callTracked('handoff_assist', buildHandoffSummaryPrompt(handoff));
    const parsed = safeParseJson(raw);
    const summary = parsed && boundedText(parsed.summary, 1000);
    if (!summary) return null;
    return {
      summary,
      suggestedReply: boundedText(parsed.suggestedReply, 600),
      nextAction: boundedText(parsed.nextAction, 300),
    };
  } catch (err) {
    logger.error('AI', 'Handoff assist generation failed:', errorDetail(err));
    return null;
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

const IMAGE_RELEVANCE = new Set(['relevant', 'unclear', 'unrelated']);

/**
 * Describes a complaint photo (what is visible, whether it is relevant,
 * whether it shows a personal document). Never a diagnosis.
 * @returns {Promise<{relevance, subject, containsSensitiveDocument, confidence}|null>} null when unavailable
 */
async function analyzeComplaintImage({ buffer, mimeType, issue }) {
  const startedAt = Date.now();
  messageBudget.aiCall(getRequestContext().phone);
  try {
    const raw = await geminiProvider.callGeminiAudio({ buffer, mimeType, prompt: buildImageReviewPrompt({ issue }) });
    const parsed = safeParseJson(raw);
    if (!parsed || !IMAGE_RELEVANCE.has(parsed.relevance)) {
      logger.warn('AI', 'Unusable image review response:', String(raw).slice(0, 200));
      return null;
    }
    logger.audit('AI_IMAGE_REVIEWED', {
      provider: 'gemini',
      taskType: 'image_review',
      relevance: parsed.relevance,
      sensitive: !!parsed.containsSensitiveDocument,
      latencyMs: Date.now() - startedAt,
      result: 'success',
    });
    return {
      relevance: parsed.relevance,
      subject: typeof parsed.subject === 'string' ? parsed.subject.trim().slice(0, 100) : '',
      containsSensitiveDocument: parsed.containsSensitiveDocument === true,
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0,
    };
  } catch (err) {
    logger.error('AI', 'Image review failed:', errorDetail(err));
    return null;
  }
}

module.exports = {
  analyzeComplaintImage,
  assistHandoff,
  detectIntent,
  classifyComplaintCategory,
  matchServiceToCatalog,
  analyzeBookingCorrection,
  summarizeHandoff,
};
