// Free text outside an active flow.
//
//   1. Understand it cheaply (rules first, AI only when needed).
//   2. Escalate when the customer is stuck or the situation requires a human.
//   3. Act on confidence:
//        high    -> go straight to the flow (with the booking targeted when
//                   "cancel / reschedule / where is my technician" is clear)
//        medium  -> one-tap confirmation ("Just to check: reschedule your booking?")
//        low     -> a focused question built from what the message does
//                   suggest, never a bare "I didn't understand"
const whatsapp = require('../whatsapp/client');
const sessionStore = require('../session/sessionStore');
const logger = require('../utils/logger');
const AI_CONFIDENCE = require('../ai/confidence');
const { normalizeCustomerMessage } = require('../ai/messageUnderstanding');
const { understandFreeText } = require('../ai/understanding');
const { evaluateTriggers, isStruggling } = require('../escalation/escalationService');
const unknownStreak = require('./unknownStreak');
const { entryPoints, intentToEntryPoint } = require('./flowRegistry');
const { recordExtractedFields } = require('./inboundInput');
const { createRouterHandoff } = require('./routerHandoff');
const { menuFor } = require('../flows/quickActions');

const INTENT_CONFIRM_FLOW = 'intent_confirm';

const INTENT_LABELS = {
  NEW_BOOKING: 'book a service',
  MY_BOOKINGS: 'see your bookings',
  BOOKING_STATUS: 'check on your booking',
  RESCHEDULE_BOOKING: 'reschedule your booking',
  CANCEL_BOOKING: 'cancel your booking',
  COMPLAINT: 'report a problem with a service',
  COMPLAINT_STATUS: 'check your complaint status',
  GENERAL_QUERY: 'see our services and prices',
  FEEDBACK: 'rate a recent service',
};

// The booking an intent acts on, so My Bookings can skip the list.
const BOOKING_ACTIONS = {
  BOOKING_STATUS: 'status',
  RESCHEDULE_BOOKING: 'reschedule',
  CANCEL_BOOKING: 'cancel',
};

async function dispatchIntent(session, customer, inbound, understanding) {
  const entryKey = intentToEntryPoint[understanding.intent];
  await entryPoints[entryKey](session, customer, {
    ...inbound,
    ai: understanding,
    intendedAction: BOOKING_ACTIONS[understanding.intent],
  });
  logger.audit('MAIN_MENU_ACTION_SELECTED', {
    phone: session.phone,
    customerId: customer && customer.id,
    action: entryKey,
    source: inbound.source || 'text',
    confidence: understanding.confidence,
    understandingSource: understanding.understandingSource,
    result: 'selected',
  });
  return {
    reply: 'handled',
    intent: understanding.intent,
    confidence: understanding.confidence,
    aiMatch: understanding.service || null,
    aiUsed: !!understanding.aiUsed,
    flow: entryKey,
    step: null,
  };
}

async function confirmIntent(session, understanding, text) {
  await whatsapp.sendButtons(session.phone, `Just to check: would you like to ${INTENT_LABELS[understanding.intent]}?`, [
    { id: 'CONFIRM_INTENT', title: 'Yes' },
    { id: 'INTENT_SOMETHING_ELSE', title: 'Something Else' },
  ]);
  await sessionStore.setFlow(session.phone, INTENT_CONFIRM_FLOW, 'confirm', {
    intent: understanding.intent,
    understanding,
    text,
  });
  logger.audit('INTENT_CONFIRMATION_ASKED', {
    phone: session.phone,
    intent: understanding.intent,
    confidence: understanding.confidence,
    result: 'asked',
  });
  return { reply: 'intent_confirmation', intent: understanding.intent, confidence: understanding.confidence, flow: INTENT_CONFIRM_FLOW, step: 'confirm' };
}

// Low confidence: offer the customer's most likely actions instead of a
// generic failure message.
async function clarify(session, customer, understanding) {
  const menu = await menuFor(customer && customer.profile);
  await sessionStore.clearFlow(session.phone);
  await whatsapp.sendButtons(
    session.phone,
    'I want to make sure I help with the right thing. Is it one of these? You can also describe the problem in a few words, for example "kitchen tap leaking", or type "support" to reach our team.',
    menu.buttons
  );
  logger.audit('CLARIFICATION_OFFERED', {
    phone: session.phone,
    intent: understanding.intent,
    confidence: understanding.confidence,
    situation: menu.situation,
    result: 'offered',
  });
  return {
    reply: 'clarification_offered',
    intent: understanding.intent,
    confidence: understanding.confidence,
    flow: 'main_menu',
    step: null,
    debugReason: understanding.debugReason,
  };
}

async function routeFreeText(session, customer, inbound) {
  const understanding = inbound.ai
    ? { ...normalizeCustomerMessage(inbound.text, inbound.ai), aiUsed: false, understandingSource: 'pre_understood' }
    : await understandFreeText(inbound.text, { session });
  recordExtractedFields(session, understanding, inbound.source || 'text');

  if (understanding.language && understanding.language !== session.preferredLanguage) {
    await sessionStore.updateSession(session.phone, { preferredLanguage: understanding.language });
  }

  let streak = 0;
  if (isStruggling(understanding)) {
    streak = unknownStreak.increment(session.phone);
  } else {
    unknownStreak.reset(session.phone);
  }

  const trigger = evaluateTriggers({
    text: inbound.text,
    intent: understanding.intent,
    confidence: understanding.confidence,
    struggleStreak: streak,
  });
  if (trigger.escalate) {
    return createRouterHandoff(session, customer, inbound, trigger, understanding);
  }

  const known = Boolean(intentToEntryPoint[understanding.intent]);
  // A booking with several plausible services goes straight to the booking
  // flow, which asks "Plumbing or Electrical?": that question already
  // confirms the intent.
  if (known && (understanding.confidence >= AI_CONFIDENCE.HIGH || understanding.ambiguousService)) {
    return dispatchIntent(session, customer, inbound, understanding);
  }
  if (known && understanding.confidence >= AI_CONFIDENCE.MEDIUM) {
    return confirmIntent(session, understanding, inbound.text);
  }
  return clarify(session, customer, understanding);
}

// Step handler for the one-tap intent confirmation.
async function handleIntentConfirm(session, customer, input) {
  const { understanding, text } = session.context || {};
  if (input.buttonId === 'CONFIRM_INTENT' && understanding) {
    await sessionStore.clearFlow(session.phone);
    logger.audit('INTENT_CONFIRMED', { phone: session.phone, intent: understanding.intent, result: 'confirmed' });
    return dispatchIntent(session, customer, { type: 'text', text, from: session.phone }, { ...understanding, confidence: AI_CONFIDENCE.HIGH });
  }
  if (input.buttonId === 'INTENT_SOMETHING_ELSE') {
    logger.audit('INTENT_REJECTED', { phone: session.phone, intent: understanding && understanding.intent, result: 'rejected' });
    return clarify(session, customer, understanding || { intent: 'UNKNOWN', confidence: 0 });
  }
  // A fresh message instead of a tap: understand it from scratch.
  await sessionStore.clearFlow(session.phone);
  if (input.text) {
    return routeFreeText({ ...session, currentFlow: null, currentStep: null, context: {} }, customer, { type: 'text', text: input.text, from: session.phone, source: input.source });
  }
  return clarify(session, customer, understanding || { intent: 'UNKNOWN', confidence: 0 });
}

module.exports = {
  routeFreeText,
  dispatchIntent,
  INTENT_CONFIRM_FLOW,
  steps: { confirm: handleIntentConfirm },
};
