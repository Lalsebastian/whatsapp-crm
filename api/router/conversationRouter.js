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
const { normalizeCustomerMessage, extractedStructuredFields } = require('../ai/messageUnderstanding');
const { downloadWhatsAppMedia } = require('../media/mediaHandler');
const { transcribeAudio } = require('../media/transcription');
const {
  evaluateTriggers,
  triggerEscalation,
  isStruggling,
  isExplicitHumanRequest,
  safetyGuidanceFor,
} = require('../escalation/escalationService');
const unknownStreak = require('./unknownStreak');
const testChannel = require('../whatsapp/testChannel');
const { withKeyLock } = require('../reliability/keyedLock');
const { runWithRequestContext, getRequestContext } = require('../reliability/requestContext');
const voiceConfig = require('../config/voice');
const { loadCustomerProfile } = require('../customer/customerProfileService');
const { handlePreferenceCommand } = require('../customer/preferenceService');
const recentBookingContext = require('../flows/recentBookingContext');
const conversationLifecycle = require('../analytics/conversationLifecycle');
const { getTestEvents } = require('../analytics/eventWriter');
const messageBudget = require('../analytics/messageBudget');

const crm = getCrmAdapter();
const MENU_KEYWORDS = ['menu', 'main menu', 'cancel', 'start', 'restart', 'start over', 'reset'];
const SUPPORT_KEYWORDS = ['support', 'human', 'agent', 'talk to support', 'human agent', 'i need support'];
const GREETING_KEYWORDS = ['hi', 'hello', 'hey', 'hii', 'start', 'menu'];
const SERVICE_INFO_KEYWORDS = ['services', 'service information', 'what services do you offer'];
const FEEDBACK_PATTERNS = [
  /\brate my (?:service|booking)\b/i,
  /\bgive feedback\b/i,
  /\breview my (?:service|booking)\b/i,
  /\bleave (?:a )?(?:review|feedback)\b/i,
  /\bterrible service\b/i,
  /\btechnician was very professional\b/i,
  /\bjob (?:was )?done perfectly\b/i,
];

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
  const customerRecord = await crm.findCustomerByPhone(from);
  const profile = await loadCustomerProfile(customerRecord);
  const customer = customerRecord ? { ...customerRecord, profile } : customerRecord;
  session.customerProfile = profile;

  if (customer && !session.customerId) {
    await sessionStore.updateSession(from, { customerId: customer.id });
    session.customerId = customer.id;
  }
  if (profile && profile.preferredLanguage && profile.preferredLanguage !== session.preferredLanguage) {
    await sessionStore.updateSession(from, { preferredLanguage: profile.preferredLanguage });
    session.preferredLanguage = profile.preferredLanguage;
    logger.audit('LANGUAGE_PREFERENCE_USED', {
      customerId: customer.id,
      language: profile.preferredLanguage,
      result: 'success',
    });
  }

  const sessionExpired = sessionStore.isExpired(session);
  const lifecycleEvent = sessionExpired ? null : conversationLifecycle.noteActivity(session);
  if (lifecycleEvent) {
    logger.audit(lifecycleEvent, {
      phone: from,
      sessionId: from,
      customerId: customer && customer.id,
      flow: session.currentFlow,
      step: session.currentStep,
      language: session.preferredLanguage,
      source: inbound.source || (inbound.buttonId ? 'button' : (inbound.type === 'audio' ? 'voice' : inbound.type)),
      result: 'success',
    });
    logger.audit('CUSTOMER_IDENTIFIED', {
      phone: from,
      sessionId: from,
      customerId: customer && customer.id,
      result: 'success',
    });
    if (profile && profile.returningCustomer) {
      logger.audit('RETURNING_CUSTOMER_IDENTIFIED', {
        phone: from,
        sessionId: from,
        customerId: customer.id,
        result: 'success',
      });
    }
  }

  await logMessage(from, 'inbound', inbound.type, inbound.text || inbound.buttonId || `[${inbound.type}]`, {
    wa_message_id: inbound.waMessageId,
  });
  logger.audit('CUSTOMER_MESSAGE_RECEIVED', {
    phone: from,
    sessionId: from,
    flow: session.currentFlow,
    step: session.currentStep,
    source: inbound.source || (inbound.buttonId ? 'button' : inbound.type),
    result: 'received',
  });
  messageBudget.customerMessage(from);

  if (session.humanTakeover) {
    await sessionStore.touchActivity(from);
    logger.log('ROUTER', `Human takeover active for ${from} — suppressing auto-reply`);
    return {
      reply: null,
      flow: session.currentFlow,
      step: session.currentStep,
      humanTakeover: true,
      ...profileDiagnostics(profile),
    };
  }

  if (sessionExpired) {
    logger.audit('SESSION_EXPIRED', { phone: from, result: 'reset', previousFlow: session.currentFlow });
    logger.audit('CONVERSATION_EXPIRED', {
      phone: from,
      sessionId: from,
      customerId: customer && customer.id,
      flow: session.currentFlow,
      step: session.currentStep,
      result: 'expired',
    });
    if (session.currentFlow === 'booking') {
      logger.audit('BOOKING_ABANDONED', {
        phone: from,
        sessionId: from,
        customerId: customer && customer.id,
        flow: 'booking',
        step: session.currentStep,
        serviceId: session.context && session.context.serviceId,
        reason: 'session_expired',
        result: 'abandoned',
      });
    }
    conversationLifecycle.expire(from);
    await sessionStore.clearFlow(from);
    await whatsapp.sendText(from, 'Welcome back. Your previous booking session has expired. How can I help you today?');
    await entryPoints.MAIN_MENU({ ...session, currentFlow: null, currentStep: null, context: {} }, customer, inbound);
    return { reply: 'expired_session_menu', flow: 'main_menu', step: null, ...profileDiagnostics(profile) };
  }

  const result = await route(session, customer, inbound);

  // Flow handlers persist state via sessionStore as they run, but never
  // mutate the local `session` object — re-read it so the returned
  // flow/step always reflect where the conversation actually ended up.
  const freshSession = await sessionStore.getOrCreateSession(from);
  const context = freshSession.context || {};
  return {
    ...result,
    flow: freshSession.currentFlow,
    step: freshSession.currentStep,
    service: context.serviceName || context.inferredServiceName || null,
    matchSource: context.serviceMatchSource || null,
    serviceConfidence: context.serviceMatchConfidence ?? null,
    changedField: context.correctionDebug ? context.correctionDebug.changedField : null,
    previousValue: context.correctionDebug ? context.correctionDebug.previousValue : null,
    newValue: context.correctionDebug ? context.correctionDebug.newValue : null,
    rating: context.feedbackDebug ? context.feedbackDebug.rating : (context.rating ?? null),
    followUpRequired: context.feedbackDebug ? !!context.feedbackDebug.followUpRequired : !!context.followUpRequired,
    complaintLinked: context.feedbackDebug ? !!context.feedbackDebug.complaintLinked : !!context.complaintLinked,
    knownFields: context.knownFields || [],
    missingFields: context.missingFields || [],
    ambiguousFields: context.ambiguousFields || [],
    requiresRevalidation: context.requiresRevalidation || [],
    room: context.room || null,
    issue: context.issue || null,
    recommendedServices: context.recommendedServices || [],
    serviceabilityFiltered: !!context.serviceabilityFiltered,
    fastPathUsed: !!messageBudget.get(from).fastPathUsed,
    customerTurnCount: messageBudget.get(from).customerMessages,
    botTurnCount: messageBudget.get(from).botMessages,
    redundantQuestionsAvoided: messageBudget.get(from).redundantQuestionsAvoided,
    messageCount: messageBudget.get(from),
    ...profileDiagnostics(profile),
  };
}

function profileDiagnostics(profile) {
  return {
    customerId: profile ? profile.customerId : null,
    returningCustomer: !!(profile && profile.returningCustomer),
    preferredLanguage: profile ? profile.preferredLanguage : null,
    defaultProperty: profile && profile.defaultProperty
      ? (profile.defaultProperty.label || profile.defaultProperty.area || profile.defaultProperty.addressLine)
      : null,
    profileSource: profile ? profile.profileSource : null,
    analyticsEvents: testChannel.isCapturing() ? getTestEvents(getRequestContext().phone) : [],
  };
}

function handleInboundMessage(inbound) {
  return runWithRequestContext(
    { correlationId: inbound.waMessageId, messageId: inbound.waMessageId, phone: inbound.from },
    () => withKeyLock(inbound.from, async () => {
      const startedAt = Date.now();
      try {
        return await processInboundMessage(inbound);
      } catch (error) {
        logger.audit('SESSION_ERROR', {
          phone: inbound.from,
          errorCategory: error.code || 'UNHANDLED_ROUTER_ERROR',
          result: 'failed',
        });
        throw error;
      } finally {
        logger.audit('ROUTE_COMPLETED', {
          phone: inbound.from,
          latencyMs: Date.now() - startedAt,
          result: 'completed',
        });
      }
    })
  );
}

async function route(session, customer, inbound) {
  // Global escape hatch: "menu"/"cancel" always resets, even mid-flow.
  const lowerText = (inbound.text || '').trim().toLowerCase();
  if (inbound.buttonId === 'MAIN_MENU' || MENU_KEYWORDS.includes(lowerText)) {
    logger.audit('MAIN_MENU_ACTION_SELECTED', {
      phone: session.phone,
      customerId: customer && customer.id,
      action: inbound.buttonId || lowerText,
      source: inbound.source || (inbound.buttonId ? 'button' : 'text'),
      result: 'selected',
    });
    if (session.currentFlow === 'booking' && ['cancel', 'restart', 'start over', 'reset'].includes(lowerText)) {
      logger.audit('BOOKING_ABANDONED', {
        phone: session.phone,
        sessionId: session.phone,
        customerId: customer && customer.id,
        flow: 'booking',
        step: session.currentStep,
        serviceId: session.context && session.context.serviceId,
        reason: 'explicit_reset',
        result: 'abandoned',
      });
    }
    await entryPoints.MAIN_MENU(session, customer, inbound);
    return { reply: 'main_menu', intent: null, flow: 'main_menu', step: null };
  }

  const safetyGuidance = safetyGuidanceFor(inbound.text || '');
  if (safetyGuidance) {
    const trigger = evaluateTriggers({ text: inbound.text });
    return createRouterHandoff(session, customer, inbound, trigger, null, safetyGuidance);
  }

  if (['HUMAN_SUPPORT', 'TALK_TO_SUPPORT'].includes(inbound.buttonId) || SUPPORT_KEYWORDS.includes(lowerText) || isExplicitHumanRequest(lowerText)) {
    const outcome = await entryPoints.HUMAN_SUPPORT(session, customer, inbound);
    return {
      reply: outcome && outcome.handoff ? 'escalated' : 'escalation_failed',
      intent: 'HUMAN_AGENT',
      handoff: !!(outcome && outcome.handoff),
      priority: outcome && outcome.priority,
      handoffReason: (outcome && outcome.reason) || 'explicit_human_request',
    };
  }

  if (inbound.type === 'text') {
    const preference = await handlePreferenceCommand(session, customer, inbound.text);
    if (preference.handled) {
      return { reply: 'preference_updated', intent: 'CUSTOMER_PREFERENCE', ...preference };
    }
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

  if (SERVICE_INFO_KEYWORDS.includes(lowerText)) {
    await entryPoints.SERVICE_INFO(session, customer, inbound);
    return { reply: 'handled', intent: 'GENERAL_QUERY', flow: 'SERVICE_INFO', step: null };
  }

  if (FEEDBACK_PATTERNS.some((pattern) => pattern.test(lowerText))) {
    await entryPoints.GIVE_FEEDBACK(session, customer, inbound);
    return { reply: 'handled', intent: 'FEEDBACK', flow: 'feedback', step: null };
  }

  if (inbound.type === 'text' && await recentBookingContext.tryStartRecentBookingContext(session, customer, inbound)) {
    return { reply: 'recent_booking_confirmation', intent: 'COMPLAINT', flow: 'recent_booking_context', step: 'confirm_booking' };
  }

  if (inbound.buttonId) {
    const entry = entryPoints[inbound.buttonId];
    if (entry) {
      logger.audit('MAIN_MENU_ACTION_SELECTED', {
        phone: session.phone,
        customerId: customer && customer.id,
        action: inbound.buttonId,
        source: inbound.source || 'button',
        result: 'selected',
      });
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
  const detected = inbound.ai || await detectIntent(inbound.text, {
      currentFlow: session.currentFlow,
      preferredLanguage: session.preferredLanguage,
    });
  const intentResult = normalizeCustomerMessage(inbound.text, detected);
  recordExtractedFields(session, intentResult, inbound.source || 'text');

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
    return createRouterHandoff(session, customer, inbound, trigger, intentResult);
  }

  const entryKey = intentToEntryPoint[intentResult.intent];
  if (!entryKey) {
    await whatsapp.sendText(session.phone, "I'm not sure I understood that. Here's what I can help with:");
    await entryPoints.MAIN_MENU(session, customer, inbound);
    return { reply: 'unknown_fallback_menu', intent: intentResult.intent, flow: 'main_menu', step: null, debugReason: intentResult.debugReason };
  }

  await entryPoints[entryKey](session, customer, { ...inbound, ai: intentResult });
  logger.audit('MAIN_MENU_ACTION_SELECTED', {
    phone: session.phone,
    customerId: customer && customer.id,
    action: entryKey,
    source: inbound.source || 'text',
    confidence: intentResult.confidence,
    result: 'selected',
  });
  return {
    reply: 'handled',
    intent: intentResult.intent,
    confidence: intentResult.confidence,
    aiMatch: intentResult.service || null,
    flow: entryKey,
    step: null,
  };
}

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

async function createRouterHandoff(session, customer, inbound, trigger, intentResult, safetyMessage) {
  if (safetyMessage) await whatsapp.sendText(session.phone, safetyMessage);
  try {
    const result = await triggerEscalation({
      crm,
      phone: session.phone,
      customerId: customer ? customer.id : null,
      customer,
      session,
      reason: trigger.reason,
      originalCustomerMessage: inbound.text,
      media: inbound.voice ? [{
        type: 'audio',
        mediaId: inbound.voice.mediaId,
        transcript: inbound.voice.transcript,
        detectedLanguage: inbound.voice.detectedLanguage,
        transcriptionConfidence: inbound.voice.confidence,
      }] : [],
      botActions: safetyMessage ? ['Safety guidance provided'] : [],
      suggestedNextAction: safetyMessage
        ? 'Review the safety concern immediately and contact the customer.'
        : 'Review the customer request and continue the conversation.',
    });
    await whatsapp.sendText(
      session.phone,
      "I've shared the details with our support team, including the information you've already provided, so you won't need to explain everything again. A team member will continue from here."
    );
    return {
      reply: 'escalated',
      intent: intentResult && intentResult.intent,
      confidence: intentResult && intentResult.confidence,
      handoff: true,
      priority: result.priority,
      handoffReason: trigger.reason,
    };
  } catch (err) {
    logger.error('ROUTER', 'triggerEscalation failed:', err.message);
    await whatsapp.sendText(session.phone, "I'm sorry, I wasn't able to connect this to our support team just now. Please try again in a moment.");
    return {
      reply: 'escalation_failed',
      intent: intentResult && intentResult.intent,
      confidence: intentResult && intentResult.confidence,
      handoff: false,
      priority: null,
      handoffReason: trigger.reason,
    };
  }
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
    latencyMs: Date.now() - startedAt,
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

  const detected = await detectIntent(transcription.text, {
    currentFlow: session.currentFlow,
    preferredLanguage: session.preferredLanguage,
  });
  const ai = normalizeCustomerMessage(transcription.text, detected);
  return { ...inbound, type: 'text', text: transcription.text, source: 'voice', voice, ai };
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
    const detected = inbound.ai || await detectIntent(inbound.text, {
      currentFlow: session.currentFlow,
      preferredLanguage: session.preferredLanguage,
    });
    const ai = normalizeCustomerMessage(inbound.text, detected);
    recordExtractedFields(session, ai, inbound.source || 'text');
    return {
      text: inbound.text,
      source: inbound.source,
      voice: inbound.voice,
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

module.exports = { handleInboundMessage, normalizeInboundMessage };
