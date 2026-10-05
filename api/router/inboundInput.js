// Turns an inbound message into the `input` object flow step handlers expect:
// AI understanding for text, transcription for voice notes, media references
// for photos/videos and normalized location pins.
const whatsapp = require('../whatsapp/client');
const db = require('../db/supabaseClient');
const logger = require('../utils/logger');
const testChannel = require('../whatsapp/testChannel');
const voiceConfig = require('../config/voice');
const privacy = require('../config/privacy');
const { redactSensitive } = require('../privacy/redaction');
const { understandFreeText, understandInFlow } = require('../ai/understanding');
const { extractedStructuredFields } = require('../ai/messageUnderstanding');
const { downloadWhatsAppMedia } = require('../media/mediaHandler');
const { transcribeAudio } = require('../media/transcription');

function recordExtractedFields(session, understanding, source) {
  const fields = extractedStructuredFields(understanding);
  logger.audit('FIELDS_EXTRACTED_FROM_MESSAGE', {
    phone: session.phone,
    sessionId: session.phone,
    flow: session.currentFlow,
    step: session.currentStep,
    source,
    fields,
    fieldCount: fields.length,
    result: 'extracted',
  });
}

async function normalizeVoiceMessage(session, inbound) {
  const startedAt = Date.now();
  logger.audit('VOICE_RECEIVED', {
    phone: session.phone,
    sessionId: session.phone,
    flow: session.currentFlow,
    step: session.currentStep,
    source: 'voice',
    mediaId: inbound.mediaId,
    result: 'received',
  });
  logger.audit('VOICE_TRANSCRIPTION_REQUESTED', {
    phone: session.phone,
    result: 'requested',
    mediaId: inbound.mediaId,
  });
  let media;
  try {
    media = await downloadWhatsAppMedia(inbound.mediaId, {
      maxBytes: voiceConfig.VOICE_MAX_FILE_SIZE_BYTES,
    });
  } catch (error) {
    error.analyticsCategory = 'MEDIA_DOWNLOAD_ERROR';
    throw error;
  }
  const { buffer, mimeType } = media;
  let transcription;
  try {
    transcription = await transcribeAudio({
      buffer,
      mimeType: mimeType || inbound.mediaMimeType,
      languageHint: session.preferredLanguage,
    });
  } catch (error) {
    error.analyticsCategory = 'TRANSCRIPTION_ERROR';
    throw error;
  }
  if (transcription.confidence !== null && transcription.confidence < voiceConfig.VOICE_MIN_CONFIDENCE) {
    const error = new Error('Voice transcription confidence was below the configured threshold');
    error.code = 'VOICE_LOW_CONFIDENCE';
    throw error;
  }

  // Redact before the transcript reaches anything that stores or forwards
  // it (message log, AI provider, complaint text, staff handoff).
  const redacted = privacy.REDACT_SENSITIVE_DATA
    ? redactSensitive(transcription.text)
    : { text: transcription.text, redactions: [] };
  if (redacted.redactions.length > 0) {
    logger.audit('VOICE_TRANSCRIPT_REDACTED', {
      phone: session.phone,
      mediaId: inbound.mediaId,
      kinds: [...new Set(redacted.redactions)],
      count: redacted.redactions.length,
      result: 'redacted',
    });
  }
  const transcriptText = redacted.text;

  const voice = {
    source: 'voice',
    transcript: transcriptText,
    detectedLanguage: transcription.detectedLanguage,
    confidence: transcription.confidence,
    provider: transcription.provider,
    mediaId: inbound.mediaId,
    mimeType: transcription.mimeType || mimeType,
  };
  logger.audit('VOICE_TRANSCRIBED', {
    phone: session.phone,
    result: 'success',
    mediaId: inbound.mediaId,
    detectedLanguage: voice.detectedLanguage,
    confidence: voice.confidence,
    latencyMs: Date.now() - startedAt,
  });

  if (!testChannel.isCapturing() && inbound.waMessageId) {
    try {
      await db.patch('messages', `wa_message_id=eq.${encodeURIComponent(inbound.waMessageId)}`, {
        content: privacy.STORE_VOICE_TRANSCRIPTS ? transcriptText : '[voice note]',
        type: 'audio',
      });
    } catch (error) {
      logger.error('ROUTER', 'Failed to attach voice transcript to message log (non-fatal):', error.message);
    }
  }

  // Same cost policy as typed text: inside a flow the step parses the
  // transcript itself; outside one, rules first and AI only if needed.
  const ai = session.currentFlow && session.currentStep
    ? understandInFlow(transcriptText, { session })
    : await understandFreeText(transcriptText, { session });
  return { ...inbound, type: 'text', text: transcriptText, source: 'voice', voice, ai };
}

async function handleVoiceFailure(session, inbound, error) {
  logger.error('ROUTER', 'Voice note handling failed:', error.code || error.message);
  logger.audit('VOICE_TRANSCRIPTION_FAILED', {
    phone: session.phone,
    result: 'failed',
    mediaId: inbound.mediaId,
    reason: error.code || error.message,
    errorCategory: error.code || 'TRANSCRIPTION_ERROR',
  });
  logger.audit(error.analyticsCategory || (error.code && error.code.startsWith('MEDIA_') ? 'MEDIA_DOWNLOAD_ERROR' : 'TRANSCRIPTION_ERROR'), {
    phone: session.phone,
    sessionId: session.phone,
    flow: session.currentFlow,
    step: session.currentStep,
    source: 'voice',
    errorCategory: error.code || 'TRANSCRIPTION_ERROR',
    statusCode: error.response && error.response.status,
    result: 'failed',
  });
  await whatsapp.sendText(
    session.phone,
    "I wasn't able to understand that voice message clearly. Please try sending it again, or type the details here."
  );
}

// Builds the `input` object step handlers expect, attaching media references
// to an in-progress complaint's awaiting_media step where relevant.
async function resolveInput(session, inbound) {
  if (inbound.type === 'text') {
    // Each step parses the input it expects (dates, slots, addresses,
    // ratings) and calls a narrow AI task itself only when needed, so no
    // general intent call is made here.
    const ai = inbound.ai || understandInFlow(inbound.text, { session });
    recordExtractedFields(session, ai, inbound.source || 'text');
    return {
      text: inbound.text,
      source: inbound.source,
      voice: inbound.voice,
      mapsLink: inbound.mapsLink,
      ai,
    };
  }
  if (inbound.type === 'interactive') return { buttonId: inbound.buttonId, source: inbound.source || 'button' };
  if (['image', 'video'].includes(inbound.type)) {
    return { mediaId: inbound.mediaId, mediaType: inbound.type };
  }
  if (inbound.type === 'location') {
    return { location: inbound.location, source: 'whatsapp_location' };
  }
  if (inbound.type === 'audio') {
    try {
      const normalized = await normalizeVoiceMessage(session, inbound);
      recordExtractedFields(session, normalized.ai, 'voice');
      return {
        text: normalized.text,
        source: 'voice',
        voice: normalized.voice,
        ai: normalized.ai,
      };
    } catch (err) {
      await handleVoiceFailure(session, inbound, err);
      return null;
    }
  }
  return null;
}

module.exports = {
  recordExtractedFields,
  normalizeVoiceMessage,
  handleVoiceFailure,
  resolveInput,
};
