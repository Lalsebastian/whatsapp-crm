// THE central pipeline every inbound WhatsApp message (and the /api/chat/test
// endpoint) goes through: dedup -> ordering -> session/customer load ->
// human-takeover and expiry checks -> route() -> diagnostics. Buttons and
// AI-detected free text both resolve to the same flow handlers via
// flowRegistry, so there is exactly one code path per flow.
//
// Split by responsibility:
//   route.js         which handler a message goes to
//   freeText.js      AI intent routing outside a flow
//   inboundInput.js  step-handler input, voice transcription
//   routerHandoff.js human handoff from the router
const { normalizeInboundMessage } = require('../whatsapp/parseInbound');
const { claimMessage } = require('./dedup');
const { isClearlyStale } = require('./messageOrder');
const { entryPoints } = require('./flowRegistry');
const sessionStore = require('../session/sessionStore');
const takeover = require('../escalation/takeover');
const mapsLink = require('../geo/mapsLink');
const whatsapp = require('../whatsapp/client');
const db = require('../db/supabaseClient');
const logger = require('../utils/logger');
const { getCrmAdapter } = require('../crm');
const testChannel = require('../whatsapp/testChannel');
const { withKeyLock } = require('../reliability/keyedLock');
const { runWithRequestContext, getRequestContext } = require('../reliability/requestContext');
const { loadCustomerProfile } = require('../customer/customerProfileService');
const conversationLifecycle = require('../analytics/conversationLifecycle');
const { getTestEvents } = require('../analytics/eventWriter');
const messageBudget = require('../analytics/messageBudget');
const { route, isStrongNewRequest, GREETING_KEYWORDS } = require('./route');
const recovery = require('./bookingRecovery');

const crm = getCrmAdapter();

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
async function processInboundMessage(originalInbound) {
  let inbound = originalInbound;
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

  if (await isClearlyStale(from, inbound.timestamp)) {
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

  if (session.humanTakeover && await takeover.releaseIfEnded(session, inbound)) {
    Object.assign(session, { humanTakeover: false, currentFlow: null, currentStep: null, context: {} });
  }
  // A pasted Google Maps link becomes a location pin, so address steps
  // accept it exactly like WhatsApp's own location share.
  if (!session.humanTakeover) inbound = await mapsLink.locationFromMapsText(inbound);
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
    conversationLifecycle.expire(from);
    // A returning customer with a half-finished booking is offered to
    // continue it, unless their message is itself a clear new request.
    const lowerText = String(inbound.text || '').trim().toLowerCase();
    const clearNewRequest = Boolean(inbound.buttonId)
      || (inbound.type === 'text' && !GREETING_KEYWORDS.includes(lowerText) && isStrongNewRequest(inbound.text));
    if (recovery.bookingHasProgress(session) && recovery.draftIsFresh(session) && !clearNewRequest) {
      const offered = await recovery.offerResume(session, { expired: true });
      return { ...offered, ...profileDiagnostics(profile) };
    }
    if (session.currentFlow === 'booking' || session.currentFlow === recovery.RECOVERY_FLOW) {
      logger.audit('BOOKING_ABANDONED', {
        phone: from,
        sessionId: from,
        customerId: customer && customer.id,
        flow: 'booking',
        step: session.currentStep,
        serviceId: session.context && session.context.serviceId,
        reason: clearNewRequest ? 'new_request_after_expiry' : 'session_expired',
        result: 'abandoned',
      });
    }
    await sessionStore.clearFlow(from);
    const idleSession = { ...session, currentFlow: null, currentStep: null, context: {} };
    if (clearNewRequest) {
      const fresh = await route(idleSession, customer, inbound);
      return { ...fresh, ...profileDiagnostics(profile) };
    }
    await whatsapp.sendText(from, 'Welcome back. Your previous booking session has expired. How can I help you today?');
    await entryPoints.MAIN_MENU(idleSession, customer, inbound);
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

module.exports = { handleInboundMessage, normalizeInboundMessage };
