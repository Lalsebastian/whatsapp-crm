// THE central pipeline every inbound WhatsApp message (and the /api/chat/test
// endpoint) goes through. Buttons and AI-detected free text both resolve to
// the same flow handlers via flowRegistry — there is exactly one code path
// per flow, satisfying the "no duplicate logic" requirement.
const { normalizeInboundMessage } = require('../whatsapp/parseInbound');
const { claimMessage } = require('./dedup');
const { isClearlyStale } = require('./messageOrder');
const { entryPoints, intentToEntryPoint, stepHandlers } = require('./flowRegistry');
const sessionStore = require('../session/sessionStore');
const whatsapp = require('../whatsapp/client');
const db = require('../db/supabaseClient');
const logger = require('../utils/logger');
const { getCrmAdapter } = require('../crm');
const { detectIntent } = require('../ai/intentService');
const { downloadWhatsAppMedia } = require('../media/mediaHandler');
const { transcribeAudio } = require('../media/transcription');
const { evaluateTriggers, triggerEscalation, isStruggling } = require('../escalation/escalationService');
const unknownStreak = require('./unknownStreak');
const testChannel = require('../whatsapp/testChannel');
const { withKeyLock } = require('../reliability/keyedLock');
const { runWithRequestContext, getRequestContext } = require('../reliability/requestContext');
const voiceConfig = require('../config/voice');

const crm = getCrmAdapter();
const MENU_KEYWORDS = ['menu', 'main menu', 'cancel', 'start', 'restart', 'start over', 'reset'];
const SUPPORT_KEYWORDS = ['support', 'human', 'agent', 'talk to support', 'human agent'];
const GREETING_KEYWORDS = ['hi', 'hello', 'hey', 'hii', 'start', 'menu'];

async function logMessage(phone, direction, type, content, extra = {}) {
  if (testChannel.isCapturing()) return; // /api/chat/test traffic shouldn't pollute real message history
  try {
    await db.insert(
      'messages',
      { phone, type, content, direction, ...extra },
      { returnRepresentation: false }
    );
  } catch (err) {
    logger.error('ROUTER', 'Failed to log message (non-fatal):', err.message);
  }
}

// Core handler shared by the real webhook and /api/chat/test.
// Returns a small summary object useful for the test endpoint's response.
async function processInboundMessage(inbound) {
  const { from } = inbound;

  const { correlationId } = getRequestContext();
  const claim = await claimMessage({
    messageId: inbound.waMessageId,
    phone: from,
    messageTimestamp: inbound.timestamp,
    correlationId,
  });
  if (claim.duplicate) {
    logger.audit('WEBHOOK_DUPLICATE_BLOCKED', { phone: from, result: 'ignored' });
    logger.log('DEDUP', `Duplicate message ignored — ${inbound.waMessageId}`);
    return { reply: null, duplicate: true };
  }

  if (isClearlyStale(from, inbound.timestamp)) {
    logger.warn('MESSAGE_ORDER', 'Clearly stale inbound message ignored', { timestamp: inbound.timestamp });
    logger.audit('STALE_MESSAGE_IGNORED', { phone: from, result: 'ignored' });
    return { reply: null, stale: true };
  }

  const session = await sessionStore.getOrCreateSession(from);
  const customer = await crm.findCustomerByPhone(from);

  if (customer && !session.customerId) {
    await sessionStore.updateSession(from, { customerId: customer.id });
    session.customerId = customer.id;
  }

  await logMessage(from, 'inbound', inbound.type, inbound.text || inbound.buttonId || `[${inbound.type}]`, {
    wa_message_id: inbound.waMessageId,
  });

  if (session.humanTakeover) {
    await sessionStore.touchActivity(from);
    logger.log('ROUTER', `Human takeover active for ${from} — suppressing auto-reply`);
    return { reply: null, flow: session.currentFlow, step: session.currentStep, humanTakeover: true };
  }

  if (sessionStore.isExpired(session)) {
    logger.audit('SESSION_EXPIRED', { phone: from, result: 'reset', previousFlow: session.currentFlow });
    await sessionStore.clearFlow(from);
    await whatsapp.sendText(from, 'Welcome back. Your previous booking session has expired. How can I help you today?');
    await entryPoints.MAIN_MENU({ ...session, currentFlow: null, currentStep: null, context: {} }, customer, inbound);
    return { reply: 'expired_session_menu', flow: 'main_menu', step: null };
  }

  const result = await route(session, customer, inbound);

  // Flow handlers persist state via sessionStore as they run, but never
  // mutate the local `session` object — re-read it so the returned
  // flow/step always reflect where the conversation actually ended up.
  const freshSession = await sessionStore.getOrCreateSession(from);
  return { ...result, flow: freshSession.currentFlow, step: freshSession.currentStep };
}

function handleInboundMessage(inbound) {
  return runWithRequestContext(
    { correlationId: inbound.waMessageId, messageId: inbound.waMessageId, phone: inbound.from },
    () => withKeyLock(inbound.from, () => processInboundMessage(inbound))
  );
}

async function route(session, customer, inbound) {
  // Global escape hatch: "menu"/"cancel" always resets, even mid-flow.
  const lowerText = (inbound.text || '').trim().toLowerCase();
  if (inbound.buttonId === 'MAIN_MENU' || MENU_KEYWORDS.includes(lowerText)) {
    await entryPoints.MAIN_MENU(session, customer, inbound);
    return { reply: 'main_menu', intent: null, flow: 'main_menu', step: null };
  }

  if (inbound.buttonId === 'TALK_TO_SUPPORT' || SUPPORT_KEYWORDS.includes(lowerText)) {
    await entryPoints.TALK_TO_SUPPORT(session, customer, inbound);
    return { reply: 'escalated', intent: 'HUMAN_AGENT', flow: null, step: null };
  }

  if (session.currentFlow && session.currentStep && GREETING_KEYWORDS.includes(lowerText)) {
    await whatsapp.sendText(session.phone, 'Hello. We can continue from where we left off, or you can type "menu" to start again.');
    return { reply: 'active_flow_greeting', flow: session.currentFlow, step: session.currentStep };
  }

  // A structured flow already in progress wins over everything else.
  if (session.currentFlow && session.currentStep) {
    const handler = stepHandlers[session.currentFlow] && stepHandlers[session.currentFlow][session.currentStep];
    if (handler) {
      const input = await resolveInput(session, inbound);
      if (input) {
        await handler(session, customer, input);
        return { reply: 'handled', flow: session.currentFlow, step: session.currentStep };
      }
      return {
        reply: inbound.type === 'audio' ? 'voice_note_unavailable' : 'input_unavailable',
        flow: session.currentFlow,
        step: session.currentStep,
      };
    }
  }

  if (inbound.buttonId) {
    const entry = entryPoints[inbound.buttonId];
    if (entry) {
      await entry(session, customer, inbound);
      return { reply: 'handled', flow: inbound.buttonId, step: null };
    }
    await entryPoints.MAIN_MENU(session, customer, inbound);
    return { reply: 'unrecognized_button_fallback_menu', flow: 'main_menu', step: null };
  }

  if (inbound.type === 'text') {
    if (GREETING_KEYWORDS.includes(lowerText)) {
      await entryPoints.MAIN_MENU(session, customer, inbound);
      return { reply: 'main_menu', intent: null, flow: 'main_menu', step: null };
    }
    return routeFreeText(session, customer, inbound);
  }

  if (['image', 'video'].includes(inbound.type)) {
    await whatsapp.sendText(
      session.phone,
      "I've noted that attachment, but I'm not currently in a complaint — start one from the menu first, then send your photos/videos."
    );
    return { reply: 'media_without_flow', flow: null, step: null };
  }

  if (inbound.type === 'audio') {
    return routeVoiceNote(session, customer, inbound);
  }

  await whatsapp.sendText(session.phone, "Sorry, I can't handle that message type yet. Type \"menu\" to see what I can help with.");
  return { reply: 'unsupported_type', flow: null, step: null };
}

async function routeFreeText(session, customer, inbound) {
  const intentResult = inbound.ai || await detectIntent(inbound.text, {
      currentFlow: session.currentFlow,
      preferredLanguage: session.preferredLanguage,
    });

  if (intentResult.language && intentResult.language !== session.preferredLanguage) {
    await sessionStore.updateSession(session.phone, { preferredLanguage: intentResult.language });
  }

  let streak = 0;
  if (isStruggling(intentResult)) {
    streak = unknownStreak.increment(session.phone);
  } else {
    unknownStreak.reset(session.phone);
  }

  const trigger = evaluateTriggers({
    text: inbound.text,
    intent: intentResult.intent,
    confidence: intentResult.confidence,
    struggleStreak: streak,
  });

  if (trigger.escalate) {
    let escalationCreated = false;
    try {
      await triggerEscalation({
        crm,
        phone: session.phone,
        customerId: customer ? customer.id : null,
        reason: trigger.reason,
        summary: buildEscalationSummary(inbound, intentResult),
      });
      escalationCreated = true;
    } catch (err) {
      logger.error('ROUTER', 'triggerEscalation failed:', err.message);
    }
    await sessionStore.clearFlow(session.phone);
    const message = escalationCreated
      ? "I've shared your message and the available conversation details with our support team, so you won't need to explain everything again. A team member will reply here as soon as possible."
      : 'I\'m sorry, I could not connect you with our support team right now. Please try again shortly.';
    await whatsapp.sendText(session.phone, message);
    return {
      reply: escalationCreated ? 'escalated' : 'escalation_failed',
      intent: intentResult.intent,
      confidence: intentResult.confidence,
      flow: null,
      step: null,
      escalationReason: trigger.reason,
    };
  }

  const entryKey = intentToEntryPoint[intentResult.intent];
  if (!entryKey) {
    await whatsapp.sendText(session.phone, "I'm not sure I understood that. Here's what I can help with:");
    await entryPoints.MAIN_MENU(session, customer, inbound);
    return { reply: 'unknown_fallback_menu', intent: intentResult.intent, flow: 'main_menu', step: null, debugReason: intentResult.debugReason };
  }

  await entryPoints[entryKey](session, customer, { ...inbound, ai: intentResult });
  return {
    reply: 'handled',
    intent: intentResult.intent,
    confidence: intentResult.confidence,
    aiMatch: intentResult.service || null,
    flow: entryKey,
    step: null,
  };
}

async function routeVoiceNote(session, customer, inbound) {
  try {
    const normalized = await normalizeVoiceMessage(session, inbound);
    return route(session, customer, normalized);
  } catch (err) {
    await handleVoiceFailure(session, inbound, err);
    return { reply: 'voice_note_unavailable', flow: session.currentFlow, step: session.currentStep };
  }
}

function buildEscalationSummary(inbound, intentResult) {
  const voiceDetails = inbound.voice
    ? ` Voice source: mediaId=${inbound.voice.mediaId}, language=${inbound.voice.detectedLanguage || 'unknown'}.`
    : '';
  return `Last message: "${inbound.text}" (intent=${intentResult.intent}, confidence=${intentResult.confidence}).${voiceDetails}`;
}

async function normalizeVoiceMessage(session, inbound) {
  logger.audit('VOICE_TRANSCRIPTION_REQUESTED', {
    phone: session.phone,
    result: 'requested',
    mediaId: inbound.mediaId,
  });
  const { buffer, mimeType } = await downloadWhatsAppMedia(inbound.mediaId, {
    maxBytes: voiceConfig.VOICE_MAX_FILE_SIZE_BYTES,
  });
  const transcription = await transcribeAudio({
    buffer,
    mimeType: mimeType || inbound.mediaMimeType,
    languageHint: session.preferredLanguage,
  });
  if (transcription.confidence !== null && transcription.confidence < voiceConfig.VOICE_MIN_CONFIDENCE) {
    const error = new Error('Voice transcription confidence was below the configured threshold');
    error.code = 'VOICE_LOW_CONFIDENCE';
    throw error;
  }

  const voice = {
    source: 'voice',
    transcript: transcription.text,
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
  });

  if (!testChannel.isCapturing() && inbound.waMessageId) {
    try {
      await db.patch('messages', `wa_message_id=eq.${encodeURIComponent(inbound.waMessageId)}`, {
        content: transcription.text,
        type: 'audio',
      });
    } catch (error) {
      logger.error('ROUTER', 'Failed to attach voice transcript to message log (non-fatal):', error.message);
    }
  }

  const needsFieldExtraction = !session.currentFlow || (
    session.currentFlow === 'booking' && ['select_date', 'select_slot'].includes(session.currentStep)
  );
  const ai = needsFieldExtraction
    ? await detectIntent(transcription.text, {
      currentFlow: session.currentFlow,
      preferredLanguage: session.preferredLanguage,
    })
    : null;
  return { ...inbound, type: 'text', text: transcription.text, source: 'voice', voice, ai };
}

async function handleVoiceFailure(session, inbound, error) {
  logger.error('ROUTER', 'Voice note handling failed:', error.code || error.message);
  logger.audit('VOICE_TRANSCRIPTION_FAILED', {
    phone: session.phone,
    result: 'failed',
    mediaId: inbound.mediaId,
    reason: error.code || error.message,
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
    return {
      text: inbound.text,
      source: inbound.source,
      voice: inbound.voice,
      ai: inbound.ai,
    };
  }
  if (inbound.type === 'interactive') return { buttonId: inbound.buttonId };
  if (['image', 'video'].includes(inbound.type)) {
    return { mediaId: inbound.mediaId, mediaType: inbound.type };
  }
  if (inbound.type === 'audio') {
    try {
      const normalized = await normalizeVoiceMessage(session, inbound);
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

module.exports = { handleInboundMessage, normalizeInboundMessage };
