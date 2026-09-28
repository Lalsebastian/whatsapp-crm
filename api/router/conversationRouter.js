// THE central pipeline every inbound WhatsApp message (and the /api/chat/test
// endpoint) goes through. Buttons and AI-detected free text both resolve to
// the same flow handlers via flowRegistry — there is exactly one code path
// per flow, satisfying the "no duplicate logic" requirement.
const { normalizeInboundMessage } = require('../whatsapp/parseInbound');
const { isDuplicate } = require('./dedup');
const { entryPoints, intentToEntryPoint, stepHandlers } = require('./flowRegistry');
const sessionStore = require('../session/sessionStore');
const whatsapp = require('../whatsapp/client');
const db = require('../db/supabaseClient');
const logger = require('../utils/logger');
const { getCrmAdapter } = require('../crm');
const { detectIntent } = require('../ai/intentService');
const { downloadWhatsAppMedia } = require('../media/mediaHandler');
const { transcribeAudio } = require('../media/transcription');
const { evaluateTriggers, triggerEscalation } = require('../escalation/escalationService');
const unknownStreak = require('./unknownStreak');
const testChannel = require('../whatsapp/testChannel');

const crm = getCrmAdapter();
const MENU_KEYWORDS = ['menu', 'main menu', 'cancel', 'start over', 'reset'];
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
async function handleInboundMessage(inbound) {
  const { from } = inbound;

  if (inbound.waMessageId && isDuplicate(inbound.waMessageId)) {
    logger.log('DEDUP', `Duplicate message ignored — ${inbound.waMessageId}`);
    return { reply: null, duplicate: true };
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
    logger.log('ROUTER', `Human takeover active for ${from} — suppressing auto-reply`);
    return { reply: null, flow: session.currentFlow, step: session.currentStep, humanTakeover: true };
  }

  const result = await route(session, customer, inbound);

  // Flow handlers persist state via sessionStore as they run, but never
  // mutate the local `session` object — re-read it so the returned
  // flow/step always reflect where the conversation actually ended up.
  const freshSession = await sessionStore.getOrCreateSession(from);
  return { ...result, flow: freshSession.currentFlow, step: freshSession.currentStep };
}

async function route(session, customer, inbound) {
  // Global escape hatch: "menu"/"cancel" always resets, even mid-flow.
  const lowerText = (inbound.text || '').trim().toLowerCase();
  if (inbound.buttonId === 'MAIN_MENU' || MENU_KEYWORDS.includes(lowerText)) {
    await entryPoints.MAIN_MENU(session, customer, inbound);
    return { reply: 'main_menu', intent: null, flow: 'main_menu', step: null };
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
  const intentResult = await detectIntent(inbound.text, {
    currentFlow: session.currentFlow,
    preferredLanguage: session.preferredLanguage,
  });

  if (intentResult.language && intentResult.language !== session.preferredLanguage) {
    await sessionStore.updateSession(session.phone, { preferredLanguage: intentResult.language });
  }

  let streak = 0;
  if (intentResult.intent === 'UNKNOWN') {
    streak = unknownStreak.increment(session.phone);
  } else {
    unknownStreak.reset(session.phone);
  }

  const trigger = evaluateTriggers({
    text: inbound.text,
    intent: intentResult.intent,
    confidence: intentResult.confidence,
    unknownStreak: streak,
  });

  if (trigger.escalate) {
    try {
      await triggerEscalation({
        crm,
        phone: session.phone,
        customerId: customer ? customer.id : null,
        reason: trigger.reason,
        summary: `Last message: "${inbound.text}" (intent=${intentResult.intent}, confidence=${intentResult.confidence})`,
      });
    } catch (err) {
      logger.error('ROUTER', 'triggerEscalation failed:', err.message);
    }
    await sessionStore.clearFlow(session.phone);
    await whatsapp.sendText(
      session.phone,
      "🙋 You're being connected to our support team. Someone will reply here shortly."
    );
    return { reply: 'escalated', intent: intentResult.intent, flow: null, step: null, escalationReason: trigger.reason };
  }

  const entryKey = intentToEntryPoint[intentResult.intent];
  if (!entryKey) {
    await whatsapp.sendText(session.phone, "I'm not sure I understood that. Here's what I can help with:");
    await entryPoints.MAIN_MENU(session, customer, inbound);
    return { reply: 'unknown_fallback_menu', intent: intentResult.intent, flow: 'main_menu', step: null };
  }

  await entryPoints[entryKey](session, customer, inbound);
  return { reply: 'handled', intent: intentResult.intent, flow: entryKey, step: null };
}

async function routeVoiceNote(session, customer, inbound) {
  try {
    const { buffer, mimeType } = await downloadWhatsAppMedia(inbound.mediaId);
    const transcript = await transcribeAudio(buffer, mimeType);
    return route(session, customer, { ...inbound, type: 'text', text: transcript });
  } catch (err) {
    logger.error('ROUTER', 'Voice note handling failed (likely: transcription not configured):', err.message);
    await whatsapp.sendText(
      session.phone,
      "I couldn't process that voice note yet — please type your message instead, or tap Main Menu."
    );
    return { reply: 'voice_note_unavailable', flow: session.currentFlow, step: session.currentStep };
  }
}

// Builds the `input` object step handlers expect, attaching media references
// to an in-progress complaint's awaiting_media step where relevant.
async function resolveInput(session, inbound) {
  if (inbound.type === 'text') return { text: inbound.text };
  if (inbound.type === 'interactive') return { buttonId: inbound.buttonId };
  if (['image', 'video'].includes(inbound.type)) {
    return { mediaId: inbound.mediaId, mediaType: inbound.type };
  }
  if (inbound.type === 'audio') {
    try {
      const { buffer, mimeType } = await downloadWhatsAppMedia(inbound.mediaId);
      const transcript = await transcribeAudio(buffer, mimeType);
      return { text: transcript };
    } catch (err) {
      await whatsapp.sendText(session.phone, "I couldn't process that voice note yet — please type your message instead.");
      return null;
    }
  }
  return null;
}

module.exports = { handleInboundMessage, normalizeInboundMessage };
