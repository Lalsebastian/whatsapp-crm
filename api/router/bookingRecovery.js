// Abandoned-booking recovery.
//
// The bot never chases a customer who stops mid-booking. When they come back
// (a greeting mid-flow, or any message after the session expired) and the
// booking had real progress, it offers to continue with the details in plain
// words: "You were booking Plumbing at Home — Kakkanad for Thursday,
// 9 October. Would you like to continue?"
//
// The draft is kept in the session as flow "recovery" until the customer
// chooses. A clear new request ("cancel my booking", a different service)
// simply replaces it.
const whatsapp = require('../whatsapp/client');
const sessionStore = require('../session/sessionStore');
const logger = require('../utils/logger');
const { formatDateForCustomer } = require('../flows/dateUtils');
const { ACTIONS, actionId } = require('../flows/quickActions');
const booking = require('../flows/booking');
const mainMenu = require('../flows/mainMenu');

const RECOVERY_FLOW = 'recovery';
const DRAFT_RESUME_HOURS = Math.max(1, Number(process.env.DRAFT_RESUME_HOURS) || 72);

function bookingHasProgress(session) {
  // An unanswered resume prompt still holds its draft.
  if (session.currentFlow === RECOVERY_FLOW) {
    const draft = session.context && session.context.draft;
    return !!draft && bookingHasProgress({ currentFlow: draft.flow, context: draft.context });
  }
  const context = session.context || {};
  return session.currentFlow === 'booking'
    && Boolean(context.serviceId || context.inferredServiceId || (Array.isArray(context.cart) && context.cart.length) || context.currentItem);
}

function draftIsFresh(session, now = Date.now()) {
  const last = Date.parse(session.lastActivityAt);
  return !Number.isFinite(last) || now - last <= DRAFT_RESUME_HOURS * 60 * 60 * 1000;
}

/** Plain-language summary of what was already chosen. */
function describeDraft(context = {}) {
  const items = Array.isArray(context.cart) ? context.cart : [];
  const names = [...items.map((item) => item.serviceName), context.serviceName || context.inferredServiceName]
    .filter(Boolean);
  const unique = [...new Set(names)];
  const service = unique.length ? unique.join(' and ') : 'a service';
  const place = context.propertyLabel || (items[0] && items[0].propertyLabel);
  const date = context.date || (items[0] && items[0].date);
  return `${service}${place ? ` at ${place}` : ''}${date ? ` for ${formatDateForCustomer(date)}` : ''}`;
}

async function offerResume(session, { expired }) {
  const draft = session.currentFlow === RECOVERY_FLOW && session.context && session.context.draft
    ? session.context.draft
    : { flow: session.currentFlow, step: session.currentStep, context: session.context || {} };
  const summary = describeDraft(draft.context);
  await whatsapp.sendButtons(
    session.phone,
    `Welcome back. You were booking ${summary}. Would you like to continue where you left off?`,
    [
      { id: actionId(ACTIONS.RESUME_DRAFT, 'booking'), title: 'Continue Booking' },
      { id: actionId(ACTIONS.DISCARD_DRAFT, 'booking'), title: 'Start Over' },
    ]
  );
  await sessionStore.setFlow(session.phone, RECOVERY_FLOW, 'resume_prompt', { draft });
  logger.audit('BOOKING_RESUME_OFFERED', {
    phone: session.phone,
    sessionId: session.phone,
    flow: draft.flow,
    step: draft.step,
    serviceId: draft.context.serviceId,
    reason: expired ? 'returned_after_expiry' : 'greeting_mid_flow',
    result: 'offered',
  });
  return { reply: 'booking_resume_offered', flow: RECOVERY_FLOW, step: 'resume_prompt' };
}

async function resumeDraft(session, customer) {
  const draft = session.context && session.context.draft;
  if (!draft || draft.flow !== 'booking') {
    await whatsapp.sendText(session.phone, 'That booking can no longer be continued, so let\'s start a new one.');
    await booking.startBooking(session, customer, {});
    return { reply: 'booking_restarted', flow: 'booking' };
  }
  await booking.resumeBookingDraft(session, customer, draft);
  return { reply: 'booking_resumed', flow: 'booking' };
}

async function discardDraft(session, customer) {
  const draft = session.context && session.context.draft;
  logger.audit('BOOKING_ABANDONED', {
    phone: session.phone,
    sessionId: session.phone,
    customerId: customer && customer.id,
    flow: 'booking',
    step: draft && draft.step,
    serviceId: draft && draft.context && draft.context.serviceId,
    reason: 'customer_started_over',
    result: 'abandoned',
  });
  await mainMenu.sendMainMenu(session, customer);
  return { reply: 'main_menu', flow: 'main_menu' };
}

// Any reply in the resume prompt that isn't one of its buttons: treat it as a
// fresh message (the router handles it after the draft is dropped).
async function handleResumePrompt(session, customer, input) {
  await whatsapp.sendButtons(session.phone, `Would you like to continue booking ${describeDraft((session.context.draft || {}).context)}, or start over?`, [
    { id: actionId(ACTIONS.RESUME_DRAFT, 'booking'), title: 'Continue Booking' },
    { id: actionId(ACTIONS.DISCARD_DRAFT, 'booking'), title: 'Start Over' },
  ]);
  return input;
}

module.exports = {
  RECOVERY_FLOW,
  bookingHasProgress,
  draftIsFresh,
  describeDraft,
  offerResume,
  resumeDraft,
  discardDraft,
  steps: { resume_prompt: handleResumePrompt },
};
