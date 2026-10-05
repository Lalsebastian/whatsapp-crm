// Decides which handler a message goes to, in this order of precedence:
//   menu keywords → targeted quick actions → safety → human support →
//   language preferences → resume-booking prompt → greeting mid-booking →
//   the active flow step → keyword shortcuts → buttons → free text / voice /
//   media.
const whatsapp = require('../whatsapp/client');
const sessionStore = require('../session/sessionStore');
const logger = require('../utils/logger');
const AI_CONFIDENCE = require('../ai/confidence');
const { detectShortcut } = require('../ai/shortcuts');
const { entryPoints, stepHandlers } = require('./flowRegistry');
const { handlePreferenceCommand } = require('../customer/preferenceService');
const recentBookingContext = require('../flows/recentBookingContext');
const {
  evaluateTriggers,
  isExplicitHumanRequest,
  safetyGuidanceFor,
} = require('../escalation/escalationService');
const { normalizeVoiceMessage, handleVoiceFailure, resolveInput } = require('./inboundInput');
const { createRouterHandoff } = require('./routerHandoff');
const freeText = require('./freeText');
const { handleGlobalAction } = require('./globalActions');
const recovery = require('./bookingRecovery');
const attachments = require('../flows/attachments');

const MENU_KEYWORDS = ['menu', 'main menu', 'cancel', 'start', 'restart', 'start over', 'reset'];
const SUPPORT_KEYWORDS = ['support', 'human', 'agent', 'talk to support', 'human agent', 'i need support'];
const GREETING_KEYWORDS = ['hi', 'hello', 'hey', 'hii', 'start', 'menu', 'hai', 'helo', 'good morning', 'good evening', 'good afternoon'];
const SERVICE_INFO_KEYWORDS = ['services', 'service information', 'what services do you offer'];
const RESUME_YES = /^(?:yes|yeah|yep|ok|okay|continue|resume|go on|carry on|sure)\b/i;
const RESUME_NO = /^(?:no|nope|start over|new booking|start again|forget it)\b/i;
const FEEDBACK_PATTERNS = [
  /\brate my (?:service|booking)\b/i,
  /\bgive feedback\b/i,
  /\breview my (?:service|booking)\b/i,
  /\bleave (?:a )?(?:review|feedback)\b/i,
  /\bterrible service\b/i,
  /\btechnician was very professional\b/i,
  /\bjob (?:was )?done perfectly\b/i,
];

// Router-owned steps (kept out of flowRegistry to avoid a require cycle).
const ROUTER_STEPS = {
  [freeText.INTENT_CONFIRM_FLOW]: freeText.steps,
  [recovery.RECOVERY_FLOW]: recovery.steps,
};

function idle(session) {
  return { ...session, currentFlow: null, currentStep: null, context: {} };
}

// Text typed while the resume prompt is open.
async function handleRecoveryText(session, customer, inbound, lowerText) {
  if (RESUME_YES.test(lowerText)) return recovery.resumeDraft(session, customer);
  if (RESUME_NO.test(lowerText)) return recovery.discardDraft(session, customer);
  if (GREETING_KEYWORDS.includes(lowerText)) {
    await recovery.steps.resume_prompt(session, customer, inbound);
    return { reply: 'booking_resume_offered', flow: recovery.RECOVERY_FLOW, step: 'resume_prompt' };
  }
  // Anything else is a new request: the draft is dropped, not forced on them.
  logger.audit('BOOKING_ABANDONED', {
    phone: session.phone,
    sessionId: session.phone,
    customerId: customer && customer.id,
    flow: 'booking',
    reason: 'new_request_instead_of_resume',
    result: 'abandoned',
  });
  await sessionStore.clearFlow(session.phone);
  return null;
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

  // A tap on a targeted quick reply is an explicit request, whatever step is active.
  if (inbound.buttonId) {
    const actionResult = await handleGlobalAction(session, customer, inbound);
    if (actionResult) return actionResult;
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

  let current = session;
  if (current.currentFlow === recovery.RECOVERY_FLOW && inbound.type === 'text') {
    const result = await handleRecoveryText(current, customer, inbound, lowerText);
    if (result) return result;
    current = idle(current);
  }

  if (current.currentFlow && current.currentStep && GREETING_KEYWORDS.includes(lowerText)) {
    if (recovery.bookingHasProgress(current)) return recovery.offerResume(current, { expired: false });
    await whatsapp.sendText(current.phone, 'Hello. We can continue from where we left off, or you can type "menu" to start again.');
    return { reply: 'active_flow_greeting', flow: current.currentFlow, step: current.currentStep };
  }

  // A structured flow already in progress wins over everything else.
  if (current.currentFlow && current.currentStep) {
    const handlers = ROUTER_STEPS[current.currentFlow] || stepHandlers[current.currentFlow];
    const handler = handlers && handlers[current.currentStep];
    if (handler) {
      const input = await resolveInput(current, inbound);
      if (input) {
        const outcome = await handler(current, customer, input);
        if (outcome && outcome.reply) return outcome;
        return { reply: 'handled', flow: current.currentFlow, step: current.currentStep };
      }
      return {
        reply: inbound.type === 'audio' ? 'voice_note_unavailable' : 'input_unavailable',
        flow: current.currentFlow,
        step: current.currentStep,
      };
    }
  }

  if (SERVICE_INFO_KEYWORDS.includes(lowerText)) {
    await entryPoints.SERVICE_INFO(current, customer, inbound);
    return { reply: 'handled', intent: 'GENERAL_QUERY', flow: 'SERVICE_INFO', step: null };
  }

  if (FEEDBACK_PATTERNS.some((pattern) => pattern.test(lowerText))) {
    await entryPoints.GIVE_FEEDBACK(current, customer, inbound);
    return { reply: 'handled', intent: 'FEEDBACK', flow: 'feedback', step: null };
  }

  if (inbound.type === 'text' && await recentBookingContext.tryStartRecentBookingContext(current, customer, inbound)) {
    return { reply: 'recent_booking_confirmation', intent: 'COMPLAINT', flow: 'recent_booking_context', step: 'confirm_booking' };
  }

  if (inbound.buttonId) {
    const entry = entryPoints[inbound.buttonId];
    if (entry) {
      logger.audit('MAIN_MENU_ACTION_SELECTED', {
        phone: current.phone,
        customerId: customer && customer.id,
        action: inbound.buttonId,
        source: inbound.source || 'button',
        result: 'selected',
      });
      await entry(current, customer, inbound);
      return { reply: 'handled', flow: inbound.buttonId, step: null };
    }
    await entryPoints.MAIN_MENU(current, customer, inbound);
    return { reply: 'unrecognized_button_fallback_menu', flow: 'main_menu', step: null };
  }

  if (inbound.type === 'text') {
    if (GREETING_KEYWORDS.includes(lowerText)) {
      await entryPoints.MAIN_MENU(current, customer, inbound);
      return { reply: 'main_menu', intent: null, flow: 'main_menu', step: null };
    }
    return freeText.routeFreeText(current, customer, inbound);
  }

  if (['image', 'video', 'document'].includes(inbound.type)) {
    return attachments.handleUnsolicitedMedia(current, customer, inbound);
  }

  if (inbound.type === 'audio') {
    return routeVoiceNote(current, customer, inbound);
  }

  if (inbound.type === 'location') {
    await whatsapp.sendButtons(current.phone, 'Thanks for sharing your location. Would you like to book a service there?', [
      { id: 'BOOK_SERVICE', title: 'Book a Service' },
      { id: 'MAIN_MENU', title: 'Main Menu' },
    ]);
    return { reply: 'location_without_flow', flow: null, step: null };
  }

  await whatsapp.sendText(current.phone, "Sorry, I can't handle that message type yet. Type \"menu\" to see what I can help with.");
  return { reply: 'unsupported_type', flow: null, step: null };
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

// Exposed for the session-expiry path in conversationRouter.
function isStrongNewRequest(text) {
  const shortcut = detectShortcut(text);
  return !!shortcut && shortcut.confidence >= AI_CONFIDENCE.HIGH;
}

module.exports = {
  route,
  isStrongNewRequest,
  GREETING_KEYWORDS,
};
