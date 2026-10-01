const { randomUUID } = require('node:crypto');
const whatsapp = require('../whatsapp/client');
const sessionStore = require('../session/sessionStore');
const logger = require('../utils/logger');
const env = require('../config/env');
const { getCrmAdapter } = require('../crm');
const { executeOnce } = require('../reliability/actionGuard');
const { triggerEscalation, safetyGuidanceFor } = require('../escalation/escalationService');
const complaintFlow = require('./complaint');

const crm = getCrmAdapter();
const FLOW = 'feedback';
const COMPLETED_STATUSES = new Set(['completed']);
const CANCELLED_STATUSES = new Set(['cancelled', 'canceled']);

const RECOVERY_PATTERNS = [
  { category: 'property_damage', re: /\b(damage|damaged|broke|broken).{0,30}\b(property|home|wall|floor|window|furniture|appliance)?\b/i, handoff: true },
  { category: 'payment_issue', re: /\b(overcharg|refund|payment|billing|money back|scam)\b/i, handoff: true },
  { category: 'technician_behaviour', re: /\b(rude|behavio[u]?r|threat|harass|inappropriate|unsafe|scared|afraid)\b/i, handoff: true },
  { category: 'service_not_completed', re: /\b(not finish|didn't finish|did not finish|not completed|incomplete|unfinished)\b/i, complaint: true },
  { category: 'problem_returned', re: /\b(returned|came back|again|still (?:not working|broken)|repeat problem)\b/i, complaint: true },
];

function normalizeText(input) {
  return String((input && input.text) || '').trim();
}

function parseRating(input) {
  if (input && /^RATING_[1-5]$/.test(input.buttonId || '')) return Number(input.buttonId.slice(-1));
  const text = normalizeText(input).toLowerCase().replace(/[.!?,]+$/g, '').trim();
  if (!text) return null;
  const direct = text.match(/^([1-5])(?:\s*(?:\/\s*5|stars?))?$/);
  if (direct) return Number(direct[1]);
  if (/^(?:five|5)\s*stars?$/.test(text) || /^(excellent|very good)$/.test(text)) return 5;
  if (/^(?:four|4)\s*stars?$/.test(text) || text === 'good') return 4;
  if (/^(?:three|3)\s*stars?$/.test(text) || /^(average|okay|ok)$/.test(text)) return 3;
  if (/^(?:two|2)\s*stars?$/.test(text) || /^(not good|poor)$/.test(text)) return 2;
  if (/^(?:one|1)\s*stars?$/.test(text) || /^(very poor|terrible)(?: service)?$/.test(text)) return 1;
  if (/\bterrible service\b/i.test(text)) return 1;
  return null;
}

function classifyRecovery(comment) {
  const text = String(comment || '');
  const safety = safetyGuidanceFor(text);
  if (safety) return { category: 'other', handoff: true, reason: 'feedback_safety_concern', safety };
  const match = RECOVERY_PATTERNS.find((item) => item.re.test(text));
  if (!match) return { category: null, handoff: false, complaint: false, reason: null };
  return {
    category: match.category,
    handoff: !!match.handoff,
    complaint: !!match.complaint,
    reason: `feedback_${match.category}`,
  };
}

function ratingLabel(rating) {
  return ({ 5: 'Excellent', 4: 'Good', 3: 'Average', 2: 'Poor', 1: 'Very Poor' })[rating];
}

async function preserveDebugAndFinish(session, details) {
  await sessionStore.updateSession(session.phone, {
    currentFlow: null,
    currentStep: null,
    context: { feedbackDebug: details },
  });
}

async function promptRating(session, customer, booking, service, initialComment) {
  const name = customer && customer.name ? ` ${customer.name}` : '';
  const serviceName = service && service.name ? service.name : 'recent';
  await whatsapp.sendButtons(
    session.phone,
    `Hi${name}, I hope everything went smoothly with your ${serviceName} service.\n\nHow would you rate your experience?`,
    [
      { id: 'RATING_5', title: 'Excellent' },
      { id: 'RATING_4', title: 'Good' },
      { id: 'RATING_MORE', title: 'More Ratings' },
    ]
  );
  await sessionStore.setFlow(session.phone, FLOW, 'select_rating', {
    booking,
    service: service || null,
    preRatingComment: initialComment || undefined,
    requestNonce: randomUUID(),
  });
  logger.audit('FEEDBACK_REQUESTED', {
    phone: session.phone,
    customerId: customer.id,
    bookingId: booking.id,
    bookingReference: booking.reference,
    serviceId: booking.serviceId,
    result: 'success',
  });
  return { started: true, booking };
}

async function startFeedbackForBooking({ session, customer, customerId, bookingId, allowUnverifiedCompletion = false, initialComment }) {
  const resolvedCustomerId = customerId || (customer && customer.id);
  if (!session || !resolvedCustomerId || !bookingId) throw new Error('session, customerId, and bookingId are required');
  const booking = await crm.getBookingById(bookingId);
  if (!booking || booking.customerId !== resolvedCustomerId) {
    await whatsapp.sendText(session.phone, "I'm sorry, I couldn't find that booking for this customer.");
    return { started: false, reason: 'invalid_booking' };
  }
  if (CANCELLED_STATUSES.has(String(booking.status || '').toLowerCase())) {
    await whatsapp.sendText(session.phone, 'Feedback cannot be submitted for a cancelled booking.');
    return { started: false, reason: 'cancelled_booking' };
  }
  if (!allowUnverifiedCompletion && !COMPLETED_STATUSES.has(String(booking.status || '').toLowerCase())) {
    await whatsapp.sendText(session.phone, 'Feedback is available after the service has been completed.');
    return { started: false, reason: 'not_completed' };
  }
  const existing = await crm.getFeedbackForBooking(resolvedCustomerId, booking.id);
  if (existing) {
    await preserveDebugAndFinish(session, { rating: existing.rating, followUpRequired: false, complaintLinked: !!existing.complaintId });
    await whatsapp.sendText(session.phone, "Thank you — we've already received your feedback for this service.");
    return { started: false, reason: 'duplicate_feedback', feedback: existing };
  }
  const service = booking.serviceId ? await crm.getServiceDetails(booking.serviceId) : null;
  return promptRating(session, customer || { id: resolvedCustomerId }, booking, service, initialComment);
}

async function startFeedback(session, customer, input = {}) {
  const inputText = normalizeText(input);
  const isGenericRequest = /^(?:please\s+)?(?:rate my (?:service|booking)|give feedback|review my (?:service|booking)|leave (?:a )?(?:review|feedback))$/i.test(inputText);
  const initialComment = inputText && !isGenericRequest ? inputText : undefined;
  if (input.bookingId) {
    return startFeedbackForBooking({
      session,
      customer,
      bookingId: input.bookingId,
      allowUnverifiedCompletion: !!input.allowUnverifiedCompletion,
      initialComment,
    });
  }
  const bookings = await crm.getBookings(customer.id, { limit: 5 });
  const eligible = (bookings || []).filter((booking) => COMPLETED_STATUSES.has(String(booking.status || '').toLowerCase()));
  if (eligible.length === 0) {
    await whatsapp.sendText(session.phone, "I couldn't find a completed booking that is eligible for feedback.");
    await sessionStore.clearFlow(session.phone);
    return { started: false, reason: 'no_completed_booking' };
  }
  if (eligible.length === 1) return startFeedbackForBooking({ session, customer, bookingId: eligible[0].id, initialComment });

  await whatsapp.sendListMessage(session.phone, 'Please select the completed service you would like to review.', 'Choose service', [{
    title: 'Completed Services',
    rows: eligible.map((booking) => ({
      id: `FDBK_${booking.id}`,
      title: booking.reference,
      description: `${booking.scheduledDate || ''} — Completed`.slice(0, 72),
    })),
  }]);
  await sessionStore.setFlow(session.phone, FLOW, 'select_booking', { eligibleBookings: eligible, initialComment });
  return { started: true };
}

async function handleSelectBooking(session, customer, input) {
  if (!input.buttonId || !input.buttonId.startsWith('FDBK_')) {
    await whatsapp.sendText(session.phone, 'Please select a completed service from the list above.');
    return;
  }
  return startFeedbackForBooking({
    session,
    customer,
    bookingId: input.buttonId.slice(5),
    initialComment: session.context.initialComment,
  });
}

async function handleSelectRating(session, customer, input) {
  if (input.buttonId === 'RATING_MORE') {
    await whatsapp.sendButtons(session.phone, 'Please select the rating that best describes your experience.', [
      { id: 'RATING_3', title: 'Average' },
      { id: 'RATING_2', title: 'Poor' },
      { id: 'RATING_1', title: 'Very Poor' },
    ]);
    return;
  }
  const rating = parseRating(input);
  if (!rating) {
    const possibleComment = normalizeText(input);
    const context = possibleComment ? { ...session.context, preRatingComment: possibleComment } : session.context;
    await sessionStore.setFlow(session.phone, FLOW, 'select_rating', context);
    await whatsapp.sendText(session.phone, 'Thank you. Please rate the service from 1 to 5, or select one of the rating options.');
    return;
  }
  logger.audit('FEEDBACK_RATING_RECEIVED', {
    phone: session.phone,
    customerId: customer.id,
    bookingId: session.context.booking && session.context.booking.id,
    serviceId: session.context.booking && session.context.booking.serviceId,
    rating,
    source: input.source || (input.buttonId ? 'button' : 'text'),
    result: 'success',
  });
  if (rating <= 3) {
    logger.audit('FEEDBACK_LOW_RATING', {
      phone: session.phone, customerId: customer.id,
      bookingId: session.context.booking && session.context.booking.id,
      serviceId: session.context.booking && session.context.booking.serviceId,
      rating, followUpRequired: true, result: 'received',
    });
    await whatsapp.sendButtons(
      session.phone,
      "I'm sorry the service didn't fully meet your expectations. Could you tell me what went wrong? I'll make sure the feedback is recorded properly.",
      [{ id: 'NO_COMMENT', title: 'No Comment' }]
    );
  } else {
    await whatsapp.sendButtons(
      session.phone,
      "Thank you — I'm glad to hear that. Is there anything you'd like to tell us about your experience?",
      [
        { id: 'ADD_COMMENT', title: 'Add Comment' },
        { id: 'NO_COMMENT', title: 'No, Thanks' },
      ]
    );
  }
  await sessionStore.setFlow(session.phone, FLOW, 'awaiting_comment', {
    ...session.context,
    rating,
    ratingLabel: ratingLabel(rating),
    ratingSource: input.source || (input.buttonId ? 'button' : 'text'),
  });
}

async function handleAwaitingComment(session, customer, input) {
  if (input.buttonId === 'ADD_COMMENT') {
    await whatsapp.sendText(session.phone, 'Please send your comment in a text or voice message.');
    await sessionStore.setFlow(session.phone, FLOW, 'awaiting_comment', { ...session.context, commentRequested: true });
    return;
  }
  if (input.mediaId && input.mediaType === 'image') {
    const media = [...(session.context.media || []), { type: 'image', mediaId: input.mediaId }];
    await whatsapp.sendText(session.phone, 'Thank you, I received the image. Please add a short description, or select No Comment to submit your rating.');
    await sessionStore.setFlow(session.phone, FLOW, 'awaiting_comment', { ...session.context, media });
    return;
  }
  if (input.buttonId === 'NO_COMMENT') return finalizeFeedback(session, customer, null);
  const comment = normalizeText(input);
  if (!comment) {
    await whatsapp.sendText(session.phone, 'Please send a comment, voice message, or select No Comment.');
    return;
  }
  return finalizeFeedback(session, customer, comment);
}

async function finalizeFeedback(session, customer, suppliedComment) {
  const { booking, service, rating, preRatingComment, media = [] } = session.context;
  const comment = suppliedComment || preRatingComment || null;
  if (!booking || !rating) {
    await whatsapp.sendText(session.phone, "I'm sorry, the feedback details are incomplete. Please type \"menu\" and try again.");
    return;
  }

  let feedback;
  try {
    const existing = await crm.getFeedbackForBooking(customer.id, booking.id);
    if (existing) {
      await preserveDebugAndFinish(session, { rating: existing.rating, followUpRequired: false, complaintLinked: !!existing.complaintId });
      await whatsapp.sendText(session.phone, "Thank you — we've already received your feedback for this service.");
      return;
    }
    const outcome = await executeOnce(`feedback:${customer.id}:${booking.id}`, () => crm.createFeedback({
      customerId: customer.id,
      bookingId: booking.id,
      phone: session.phone,
      rating,
      comment,
    }));
    feedback = outcome.value;
    if (outcome.duplicate || feedback.duplicate) {
      await preserveDebugAndFinish(session, { rating: feedback.rating, followUpRequired: false, complaintLinked: !!feedback.complaintId });
      await whatsapp.sendText(session.phone, "Thank you — we've already received your feedback for this service.");
      return;
    }
  } catch (error) {
    logger.error('FEEDBACK', 'createFeedback failed:', error.message);
    await whatsapp.sendText(session.phone, "I'm sorry, I wasn't able to save your feedback just now. Your details are still available in this conversation, so please try again.");
    return;
  }

  logger.audit('FEEDBACK_COMPLETED', {
    phone: session.phone, customerId: customer.id, bookingId: booking.id,
    serviceId: booking.serviceId, feedbackId: feedback.id, rating,
    followUpRequired: rating <= 3, result: 'success',
  });
  logger.audit('CONVERSATION_COMPLETED', {
    phone: session.phone, sessionId: session.phone, customerId: customer.id,
    flow: FLOW, bookingId: booking.id, feedbackId: feedback.id,
    outcome: 'feedback_completed', result: 'completed',
  });

  if (rating <= 3) return handleLowRating(session, customer, { feedback, booking, service, rating, comment, media });
  await preserveDebugAndFinish(session, { rating, followUpRequired: false, complaintLinked: false });
  await whatsapp.sendText(session.phone, "Thank you for your feedback. We're pleased to hear the service went well.");
  if (env.REVIEWS_ENABLED && env.PUBLIC_REVIEW_URL && rating >= env.REVIEW_MIN_RATING) {
    logger.audit('FEEDBACK_REVIEW_OFFERED', { phone: session.phone, customerId: customer.id, bookingId: booking.id, rating, result: 'offered' });
    await whatsapp.sendText(session.phone, `If you'd like, you can also share your experience publicly: ${env.PUBLIC_REVIEW_URL}`);
  }
}

async function handleLowRating(session, customer, details) {
  const { feedback, booking, service, rating, comment, media } = details;
  const recovery = classifyRecovery(comment);
  let existingComplaint = null;
  try {
    existingComplaint = await crm.getOpenComplaintForBooking(customer.id, booking.id);
  } catch (error) {
    logger.error('FEEDBACK', 'Unable to check existing complaints:', error.message);
  }
  if (existingComplaint) {
    try {
      await crm.markFeedbackFollowUp(feedback.id, { complaintId: existingComplaint.id });
    } catch (error) {
      logger.error('FEEDBACK', 'Unable to link existing complaint:', error.message);
    }
    logger.audit('FEEDBACK_COMPLAINT_LINKED', {
      phone: session.phone, customerId: customer.id, bookingId: booking.id,
      feedbackId: feedback.id, complaintReference: existingComplaint.reference, result: 'success',
    });
    await preserveDebugAndFinish(session, { rating, followUpRequired: true, complaintLinked: true });
    await whatsapp.sendText(session.phone, `Thank you for telling us. Your feedback has been recorded and linked to your existing complaint ${existingComplaint.reference}, so you won't need to submit the same issue again.`);
    return;
  }

  if (rating <= 2 && recovery.handoff) {
    if (recovery.safety) await whatsapp.sendText(session.phone, recovery.safety);
    try {
      const result = await triggerEscalation({
        crm,
        phone: session.phone,
        customerId: customer.id,
        customer,
        session,
        reason: recovery.reason,
        originalCustomerMessage: comment,
        booking: { ...booking, service: service && service.name, issue: comment },
        feedback: { id: feedback.id, rating, comment },
        media,
        botActions: ['Feedback recorded', `Customer rating: ${rating}/5`],
        suggestedNextAction: 'Review the poor service feedback and contact the customer directly.',
      });
      logger.audit('FEEDBACK_HANDOFF_CREATED', {
        phone: session.phone, customerId: customer.id, bookingId: booking.id,
        feedbackId: feedback.id, escalationId: result.id, rating, result: 'success',
      });
      await whatsapp.sendText(session.phone, "I'm sorry the experience didn't meet your expectations. Your feedback has been recorded and shared with our support team, including the details you've provided, so you won't need to repeat them.");
      return;
    } catch (error) {
      logger.error('FEEDBACK', 'Feedback handoff failed:', error.message);
      await preserveDebugAndFinish(session, { rating, followUpRequired: true, complaintLinked: false });
      await whatsapp.sendText(session.phone, "Your feedback has been recorded, but I wasn't able to connect it to our support team just now. Please type \"support\" if you would like us to try again.");
      return;
    }
  }

  const followUpSuggested = rating <= 2 || recovery.complaint || (rating === 3 && !!comment);
  if (followUpSuggested) {
    await whatsapp.sendButtons(session.phone, 'Thank you for explaining what happened. Your feedback has been recorded. Would you like further help with this issue?', [
      { id: 'START_COMPLAINT', title: 'Submit Complaint' },
      { id: 'TALK_TO_SUPPORT', title: 'Talk to Support' },
      { id: 'NO_FOLLOWUP', title: 'No, Thanks' },
    ]);
    await sessionStore.setFlow(session.phone, FLOW, 'low_rating_followup', {
      ...session.context,
      feedback,
      comment,
      recoveryCategory: recovery.category,
      followUpRequired: true,
    });
    return;
  }

  await preserveDebugAndFinish(session, { rating, followUpRequired: false, complaintLinked: false });
  await whatsapp.sendText(session.phone, "Thank you for your feedback. I'm sorry the service didn't fully meet your expectations. Your comments have been recorded for our team.");
}

async function handleLowRatingFollowup(session, customer, input) {
  const { feedback, booking, rating, comment, recoveryCategory, media = [] } = session.context;
  if (input.buttonId === 'NO_FOLLOWUP') {
    await preserveDebugAndFinish(session, { rating, followUpRequired: false, complaintLinked: false });
    await whatsapp.sendText(session.phone, 'Thank you. Your feedback has been recorded. Please let us know if you need any further assistance.');
    return;
  }
  if (input.buttonId === 'START_COMPLAINT') {
    return complaintFlow.startComplaintFromFeedback(session, customer, {
      bookingId: booking.id,
      category: recoveryCategory || 'other',
      description: comment,
      attachments: media.map((item) => ({ waMediaId: item.mediaId, mediaType: item.type })),
      feedbackId: feedback.id,
    });
  }
  if (input.buttonId === 'TALK_TO_SUPPORT') {
    try {
      const result = await triggerEscalation({
        crm, phone: session.phone, customerId: customer.id, customer, session,
        reason: 'feedback_support_requested', originalCustomerMessage: comment,
        booking: { ...booking, issue: comment }, feedback: { id: feedback.id, rating, comment }, media,
        botActions: ['Feedback recorded', 'Customer requested support'],
      });
      logger.audit('FEEDBACK_HANDOFF_CREATED', {
        phone: session.phone, customerId: customer.id, bookingId: booking.id,
        feedbackId: feedback.id, escalationId: result.id, rating, result: 'success',
      });
      await whatsapp.sendText(session.phone, "I've shared your feedback with our support team. A team member will continue from here, and you won't need to repeat the details.");
    } catch (error) {
      logger.error('FEEDBACK', 'Requested handoff failed:', error.message);
      await whatsapp.sendText(session.phone, "Your feedback is saved, but I couldn't connect you to support just now. Please try again in a moment.");
    }
    return;
  }
  await whatsapp.sendText(session.phone, 'Please select Submit Complaint, Talk to Support, or No, Thanks.');
}

async function onBookingCompleted({ session, customer, booking }) {
  if (!booking || String(booking.status || '').toLowerCase() !== 'completed') {
    return { started: false, reason: 'not_completed' };
  }
  return startFeedbackForBooking({ session, customer, bookingId: booking.id });
}

module.exports = {
  startFeedback,
  startFeedbackForBooking,
  onBookingCompleted,
  parseRating,
  classifyRecovery,
  steps: {
    select_booking: handleSelectBooking,
    select_rating: handleSelectRating,
    awaiting_comment: handleAwaitingComment,
    low_rating_followup: handleLowRatingFollowup,
  },
};
