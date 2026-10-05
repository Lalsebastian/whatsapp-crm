// Complaint flow: select_booking (optional) -> select_category -> awaiting_details
// (only for "other") -> awaiting_media -> confirm. Images/videos accumulate in
// session.context.attachments and are only persisted (as media_attachments rows)
// at the final crm.createComplaint() call, same "collect then commit" pattern
// as the booking flow.
const whatsapp = require('../whatsapp/client');
const sessionStore = require('../session/sessionStore');
const logger = require('../utils/logger');
const { getCrmAdapter } = require('../crm');
const { evaluateTriggers, triggerEscalation } = require('../escalation/escalationService');
const { classifyComplaintCategory } = require('../ai/intentService');
const AI_CONFIDENCE = require('../ai/confidence');
const { randomUUID } = require('node:crypto');
const { executeOnce } = require('../reliability/actionGuard');
const { invalidateCustomerProfile } = require('../customer/customerProfileService');
const { assessSeverity } = require('./complaintSeverity');
const messageBudget = require('../analytics/messageBudget');
const { reviewAttachment } = require('./attachments');
const complaintUpdate = require('./complaintUpdate');
const { formatDateForCustomer } = require('./dateUtils');
const { ACTIONS, actionId } = require('./quickActions');

const crm = getCrmAdapter();
const FLOW = 'complaint';

function withVoiceEvidence(context, input) {
  if (!input || !input.voice) return context;
  const attachment = { waMediaId: input.voice.mediaId, mediaType: 'audio' };
  const attachments = [...(context.attachments || [])];
  if (!attachments.some((item) => item.waMediaId === attachment.waMediaId)) attachments.push(attachment);
  const voiceNotes = [...(context.voiceNotes || [])];
  if (!voiceNotes.some((item) => item.mediaId === input.voice.mediaId)) {
    voiceNotes.push({
      mediaId: input.voice.mediaId,
      transcript: input.voice.transcript,
      detectedLanguage: input.voice.detectedLanguage,
      confidence: input.voice.confidence,
      mimeType: input.voice.mimeType,
    });
  }
  return { ...context, attachments, voiceNotes };
}

const CATEGORIES = [
  {
    id: 'service_not_completed',
    title: 'Service Not Completed',
    summaryLabel: 'Service not completed',
    empathy: "I'm sorry the service was not completed as expected. I'll help you register this so our team can follow up.",
  },
  {
    id: 'problem_returned',
    title: 'Problem Returned',
    summaryLabel: 'Problem returned',
    empathy: "I'm sorry the issue has returned after the service. I'll help you register this so our team can review it and arrange the appropriate follow-up.",
  },
  {
    id: 'technician_delayed',
    title: 'Technician Delayed',
    summaryLabel: 'Technician delay',
    empathy: "I'm sorry you had to wait for the technician. I'll help you register this so our team can review what happened.",
  },
  {
    id: 'technician_behaviour',
    title: 'Technician Behaviour',
    summaryLabel: 'Technician behaviour',
    empathy: "I'm sorry you had this experience. Thank you for bringing it to our attention. I'll help you record the details for our support team.",
  },
  {
    id: 'property_damage',
    title: 'Property Damage',
    summaryLabel: 'Property damage',
    empathy: "I'm sorry to hear about the damage. I understand this requires attention, and I'll help you register the complaint right away.",
  },
  {
    id: 'payment_issue',
    title: 'Payment Issue',
    summaryLabel: 'Payment issue',
    empathy: "I understand your concern regarding the payment. I'll help you get this recorded so our team can review it.",
  },
  {
    id: 'other',
    title: 'Other',
    summaryLabel: 'Other issue',
    empathy: "Of course. Please tell me what happened, and I'll make sure the details are recorded properly.",
  },
];

const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((category) => [category.id, category]));

async function startComplaint(session, customer, input = {}) {
  messageBudget.start(session.phone, { initialCustomerMessages: 1 });
  logger.audit('COMPLAINT_STARTED', {
    phone: session.phone,
    sessionId: session.phone,
    customerId: customer && customer.id,
    flow: FLOW,
    source: input.source || (input.buttonId ? 'button' : 'text'),
    result: 'started',
  });
  // Keep what the customer already said (typed or spoken) so they never have
  // to describe the problem twice.
  const spoken = input.source === 'voice' || Boolean(input.ai);
  const description = spoken && input.text ? input.text.trim() : undefined;
  let initialContext = withVoiceEvidence({
    ...(input.initialContext || {}),
    ...(description ? { description } : {}),
  }, input);
  if (description && !initialContext.category) {
    const category = await inferCategory(session, description);
    if (category) initialContext = { ...initialContext, category };
  }
  const bookings = await crm.getBookings(customer.id, { limit: 5 });

  if (!bookings || bookings.length === 0) {
    if (initialContext.category) return continueWithComplaintContext(session, initialContext);
    return promptCategory(session, initialContext);
  }

  const rows = bookings.map((b) => ({
    id: `BKC_${b.id}`,
    title: `${b.reference}`,
    description: `${formatDateForCustomer(b.scheduledDate)} — ${String(b.status || '').replace(/_/g, ' ')}`.slice(0, 72),
  }));
  rows.push({ id: 'BKC_NONE', title: 'Not related to a booking', description: 'General complaint' });

  await whatsapp.sendListMessage(session.phone, "I'm sorry to hear about the issue. I'll help you register the complaint. Is it related to one of your recent bookings?", 'Choose booking', [
    { title: 'Recent Bookings', rows },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'select_booking', initialContext);
}

async function handleSelectBooking(session, customer, input) {
  if (!input.buttonId || !input.buttonId.startsWith('BKC_')) {
    await whatsapp.sendText(session.phone, 'Please select a booking from the list above, or select "Not related to a booking".');
    return;
  }
  const bookingId = input.buttonId === 'BKC_NONE' ? null : input.buttonId.replace('BKC_', '');
  if (bookingId) {
    logger.audit('COMPLAINT_LINKED_TO_BOOKING', {
      phone: session.phone,
      sessionId: session.phone,
      customerId: customer && customer.id,
      flow: FLOW,
      bookingId,
      source: 'list',
      result: 'linked',
    });
  }
  const context = { ...session.context, bookingId };
  if (bookingId && await offerExistingComplaint(session, customer, context)) return;
  if (context.category) return continueWithComplaintContext(session, context);
  await promptCategory(session, context);
}

// One open complaint per booking: if there already is one, adding to it keeps
// the whole case in one place for the support team.
async function offerExistingComplaint(session, customer, context) {
  let existing = null;
  try {
    existing = await crm.getOpenComplaintForBooking(customer.id, context.bookingId);
  } catch (error) {
    logger.warn('COMPLAINT', 'Open-complaint check unavailable:', error.message);
  }
  if (!existing) return false;
  const status = String(existing.status || 'open').replace(/_/g, ' ');
  await whatsapp.sendButtons(
    session.phone,
    `You already have an open complaint for this booking: ${existing.reference} (${status}). Would you like to add this to it, so our team sees everything in one place?`,
    [
      { id: 'DUP_ADD', title: `Add to ${existing.reference}`.slice(0, 20) },
      { id: 'DUP_NEW', title: 'New Complaint' },
      { id: 'HUMAN_SUPPORT', title: 'Talk to Support' },
    ]
  );
  await sessionStore.setFlow(session.phone, FLOW, 'duplicate_check', {
    ...context,
    duplicateComplaint: { id: existing.id, reference: existing.reference, status: existing.status, customerId: existing.customerId },
  });
  logger.audit('COMPLAINT_DUPLICATE_OFFERED', {
    phone: session.phone,
    customerId: customer.id,
    bookingId: context.bookingId,
    complaintReference: existing.reference,
    result: 'offered',
  });
  return true;
}

async function handleDuplicateCheck(session, customer, input) {
  const { duplicateComplaint, ...context } = session.context;
  if (input.buttonId === 'DUP_ADD' && duplicateComplaint) {
    return complaintUpdate.startComplaintUpdate(session, customer, duplicateComplaint, {
      text: context.description,
      attachments: context.attachments,
    });
  }
  if (input.buttonId === 'DUP_NEW') {
    if (context.category) return continueWithComplaintContext(session, context);
    return promptCategory(session, context);
  }
  await whatsapp.sendText(session.phone, `Please choose Add to ${duplicateComplaint ? duplicateComplaint.reference : 'Complaint'}, New Complaint, or Talk to Support.`);
}

/** A complaint that starts from a photo the customer already sent. */
async function startComplaintWithMedia(session, customer, { bookingId, attachments }) {
  logger.audit('COMPLAINT_STARTED', {
    phone: session.phone,
    sessionId: session.phone,
    customerId: customer && customer.id,
    flow: FLOW,
    source: 'media',
    result: 'started',
  });
  const context = { bookingId: bookingId || null, attachments: attachments || [] };
  if (bookingId) {
    if (await offerExistingComplaint(session, customer, context)) return;
    return promptCategory(session, context);
  }
  return startComplaint(session, customer, { initialContext: context });
}

async function continueWithComplaintContext(session, context) {
  const categoryConfig = CATEGORY_BY_ID[context.category];
  if (!categoryConfig) return promptCategory(session, context);
  await whatsapp.sendText(session.phone, categoryConfig.empathy);
  await promptMedia(session, context);
}

async function startComplaintFromFeedback(session, customer, input) {
  const context = {
    bookingId: input.bookingId,
    category: CATEGORY_BY_ID[input.category] ? input.category : 'other',
    description: input.description || undefined,
    attachments: input.attachments || [],
    feedbackId: input.feedbackId,
  };
  return continueWithComplaintContext(session, context);
}

// Clear wording maps to a category without an AI call.
const CATEGORY_RULES = [
  ['property_damage', /\b(?:damag\w*|scratch\w*|cracked|broke (?:my|the)|stain\w* (?:on|my))\b/i],
  ['payment_issue', /\b(?:refund|overcharg\w*|charged (?:twice|double|extra)|billing|invoice|payment)\b/i],
  ['technician_delayed', /\b(?:late|delay\w*|didn'?t come|did not come|no show|never came|not arrived|kept waiting)\b/i],
  ['technician_behaviour', /\b(?:rude|behaviou?r|unprofessional|attitude|misbehav\w*|shout\w*)\b/i],
  ['problem_returned', /\b(?:again|same (?:problem|issue)|came back|returned|still (?:not working|leaking|broken|dripping|not cooling)|not fixed)\b/i],
  ['service_not_completed', /\b(?:not (?:finished|completed)|didn'?t finish|did not finish|incomplete|half done|left without)\b/i],
];

function ruleCategory(text) {
  const found = CATEGORY_RULES.find(([, pattern]) => pattern.test(String(text || '')));
  return found ? found[0] : null;
}

/** Category from the customer's words: rules first, AI only for unclear text. */
async function inferCategory(session, text) {
  const value = String(text || '').trim();
  if (!value) return null;
  const byRule = ruleCategory(value);
  if (byRule) return byRule;
  if (value.split(/\s+/).length < 3) return null;
  const classification = await classifyComplaintCategory(value, { preferredLanguage: session.preferredLanguage });
  return classification.category && classification.confidence >= AI_CONFIDENCE.MEDIUM ? classification.category : null;
}

async function startComplaintForBooking(session, customer, input) {
  const context = {
    bookingId: input.bookingId,
    category: CATEGORY_BY_ID[input.category] ? input.category : undefined,
    description: input.description || undefined,
    voiceNotes: input.voice ? [input.voice] : [],
    attachments: input.attachments || [],
  };
  if (!context.category && input.description) {
    context.category = await inferCategory(session, input.description) || undefined;
  }
  if (context.bookingId && await offerExistingComplaint(session, customer, context)) return;
  return continueWithComplaintContext(session, context);
}

async function promptCategory(session, context) {
  await whatsapp.sendListMessage(session.phone, "I'll help you get this resolved. Please select the category that best describes the issue, or describe what happened in your own words.", 'Choose category', [
    { title: 'Complaint Category', rows: CATEGORIES.map((c) => ({ id: `CAT_${c.id}`, title: c.title })) },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'select_category', context);
}

async function handleSelectCategory(session, customer, input) {
  let category = null;
  let description;

  if (input.buttonId && input.buttonId.startsWith('CAT_')) {
    category = input.buttonId.replace('CAT_', '');
  } else if (input.text && input.text.trim()) {
    const classification = await classifyComplaintCategory(input.text.trim(), {
      preferredLanguage: session.preferredLanguage,
    });
    if (classification.confidence >= AI_CONFIDENCE.MEDIUM) {
      category = classification.category;
      description = input.text.trim();
    }
  }

  const categoryConfig = CATEGORY_BY_ID[category];
  if (!categoryConfig) {
    await whatsapp.sendText(session.phone, "I couldn't confidently identify the issue from your message. Please select the closest category from the list above.");
    return;
  }
  const context = withVoiceEvidence({
    ...session.context,
    category,
    description: description || session.context.description,
    attachments: session.context.attachments || [],
  }, input);
  logger.audit('COMPLAINT_CATEGORY_SELECTED', {
    phone: session.phone,
    sessionId: session.phone,
    customerId: customer && customer.id,
    flow: FLOW,
    step: 'select_category',
    category,
    source: input.source || (input.buttonId ? 'list' : 'text'),
    result: 'selected',
  });

  const empathy = category === 'other' && description
    ? "Thank you for explaining what happened. I'll make sure the details are recorded properly."
    : categoryConfig.empathy;
  await whatsapp.sendText(session.phone, empathy);

  if (category === 'other' && !description) {
    await sessionStore.setFlow(session.phone, FLOW, 'awaiting_details', context);
    return;
  }

  await promptMedia(session, context);
}

async function handleAwaitingDetails(session, customer, input) {
  if (!input.text || input.text.trim().length === 0) {
    await whatsapp.sendText(session.phone, 'Please describe the issue in a message or voice note so I can continue.');
    return;
  }
  await promptMedia(session, withVoiceEvidence({ ...session.context, description: input.text.trim() }, input));
}

async function promptMedia(session, context) {
  await whatsapp.sendButtons(session.phone, 'If you have any photos or videos that may help us understand the issue, please send them here. Otherwise, select Skip / Done to continue.', [
    { id: 'MEDIA_DONE', title: 'Skip / Done' },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'awaiting_media', context);
}

async function handleAwaitingMedia(session, customer, input) {
  if (input.mediaId && ['image', 'video', 'document'].includes(input.mediaType)) {
    const review = await reviewAttachment(session, input, { issue: session.context.description });
    if (!review.attach) {
      await whatsapp.sendButtons(session.phone, review.reply, [{ id: 'MEDIA_DONE', title: 'Skip / Done' }]);
      logger.audit('COMPLAINT_MEDIA_REJECTED', {
        phone: session.phone,
        customerId: customer && customer.id,
        flow: FLOW,
        reason: review.review && review.review.containsSensitiveDocument ? 'sensitive_document' : 'unrelated',
        result: 'rejected',
      });
      return;
    }
    const attachments = [...(session.context.attachments || []), { waMediaId: input.mediaId, mediaType: input.mediaType }];
    const received = attachments.length === 1 ? 'the attachment' : `${attachments.length} attachments`;
    const lead = review.reply || `Thank you, I've received ${received}.`;
    await whatsapp.sendButtons(session.phone, `${lead} You can send another one if needed, or select Skip / Done to continue.`, [
      { id: 'MEDIA_DONE', title: 'Skip / Done' },
    ]);
    await sessionStore.setFlow(session.phone, FLOW, 'awaiting_media', { ...session.context, attachments });
    logger.audit('COMPLAINT_MEDIA_RECEIVED', {
      phone: session.phone,
      sessionId: session.phone,
      customerId: customer && customer.id,
      flow: FLOW,
      step: 'awaiting_media',
      mediaType: input.mediaType,
      attachmentCount: attachments.length,
      result: 'received',
    });
    return;
  }

  const isDone = input.buttonId === 'MEDIA_DONE' || (input.text && ['done', 'skip', 'no'].includes(input.text.trim().toLowerCase()));
  if (!isDone) {
    await whatsapp.sendText(session.phone, 'Please send a photo or video, or select Skip / Done to continue.');
    return;
  }

  const { category, description, bookingId, attachments = [], voiceNotes = [], feedbackId } = session.context;
  const categoryLabel = CATEGORY_BY_ID[category]?.summaryLabel || 'Other issue';
  const summary = `Issue: ${categoryLabel}\nDetails: ${description || 'No additional details provided'}\nAttachments received: ${attachments.length}`;
  await whatsapp.sendButtons(session.phone, `Thank you. I've noted the details below. Please review them before I submit the complaint to our support team.\n\n${summary}`, [
    { id: 'CONFIRM_COMPLAINT', title: 'Submit Complaint' },
    { id: 'CANCEL_FLOW', title: 'Cancel Request' },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'confirm', {
    category,
    description,
    bookingId,
    attachments,
    voiceNotes,
    feedbackId,
    submissionNonce: randomUUID(),
  });
  logger.audit('COMPLAINT_REVIEW_SHOWN', {
    phone: session.phone,
    sessionId: session.phone,
    customerId: customer && customer.id,
    flow: FLOW,
    step: 'confirm',
    bookingId,
    category,
    attachmentCount: attachments.length,
    result: 'shown',
  });
}

async function handleConfirm(session, customer, input) {
  if (input.buttonId === 'CANCEL_FLOW') {
    await sessionStore.clearFlow(session.phone);
    await whatsapp.sendText(session.phone, 'Certainly. Your complaint request has been cancelled. Type "menu" if you need any further assistance.');
    return;
  }
  if (input.buttonId !== 'CONFIRM_COMPLAINT') {
    await whatsapp.sendText(session.phone, 'Please select Submit Complaint or Cancel Request to continue.');
    return;
  }

  const { category, description, bookingId, attachments = [], voiceNotes = [], feedbackId } = session.context;
  if (!category) {
    logger.error('COMPLAINT', 'Missing category at confirm step', session.context);
    await whatsapp.sendText(session.phone, 'I\'m sorry, some complaint details are missing, so I could not submit the request. Please type "menu" to start again.');
    await sessionStore.clearFlow(session.phone);
    return;
  }

  const severity = assessSeverity({
    category,
    description,
    openComplaintCount: ((customer.profile && customer.profile.activeComplaints) || []).length,
  });
  const submissionNonce = session.context.submissionNonce || randomUUID();
  session.context.submissionNonce = submissionNonce;
  const actionKey = `complaint:${customer.id}:${submissionNonce}`;
  logger.audit('COMPLAINT_CREATE_REQUESTED', {
    phone: session.phone,
    customerId: customer.id,
    sessionId: session.phone,
    result: 'requested',
    category,
  });
  let complaint;
  let duplicateSubmission = false;
  try {
    const outcome = await executeOnce(actionKey, () => crm.createComplaint({
        customerId: customer.id,
        bookingId: bookingId || undefined,
        category,
        description,
        priority: severity.priority,
        attachments,
      }));
    complaint = outcome.value;
    duplicateSubmission = outcome.duplicate;
    if (outcome.duplicate) {
      logger.audit('COMPLAINT_DUPLICATE_BLOCKED', {
        phone: session.phone,
        customerId: customer.id,
        sessionId: session.phone,
        result: 'existing_result_returned',
        complaintReference: complaint.reference,
      });
    }
    if (!outcome.duplicate) {
      logger.audit('COMPLAINT_CREATED', {
        phone: session.phone,
        customerId: customer.id,
        sessionId: session.phone,
        result: 'success',
        complaintReference: complaint.reference,
        complaintId: complaint.id,
        bookingId,
        category,
      });
    }
    logger.audit('CONVERSATION_COMPLETED', {
      phone: session.phone,
      sessionId: session.phone,
      customerId: customer.id,
      flow: FLOW,
      complaintId: complaint.id,
      outcome: 'complaint_created',
      result: 'completed',
    });

    if (feedbackId && complaint.id) {
      try {
        await crm.markFeedbackFollowUp(feedbackId, { complaintId: complaint.id });
        logger.audit('FEEDBACK_COMPLAINT_LINKED', {
          phone: session.phone,
          customerId: customer.id,
          bookingId,
          feedbackId,
          complaintReference: complaint.reference,
          result: 'success',
        });
      } catch (linkError) {
        logger.error('COMPLAINT', 'Feedback was saved but could not be linked to the complaint:', linkError.message);
      }
    }
  } catch (err) {
    logger.error('COMPLAINT', 'createComplaint failed:', err.message);
    logger.audit(err.duplicateBlocked ? 'COMPLAINT_DUPLICATE_BLOCKED' : 'COMPLAINT_CREATE_FAILED', {
      phone: session.phone,
      customerId: customer.id,
      sessionId: session.phone,
      result: err.uncertain ? 'uncertain' : 'failed',
      reason: err.code || err.message,
      bookingId,
      category,
    });
    if (err.uncertain) {
      let escalated = false;
      if (!err.duplicateBlocked) {
        try {
          await triggerEscalation({
            crm,
            phone: session.phone,
            customerId: customer.id,
            customer,
            session,
            reason: 'complaint_creation_uncertain',
            summary: 'A complaint creation request timed out. Please verify the CRM before resubmitting.',
            originalCustomerMessage: description,
            suggestedNextAction: 'Verify whether the complaint was created before attempting another submission.',
          });
          escalated = true;
        } catch (escalationError) {
          logger.error('COMPLAINT', 'Uncertain complaint escalation failed:', escalationError.message);
        }
      }
      const message = err.duplicateBlocked
        ? 'Your complaint request is already being checked. Please wait for our support team before submitting it again.'
        : `I'm sorry, I could not verify whether the complaint was registered. I have kept your details and ${escalated ? 'asked our support team to check the request' : 'recommend contacting support before submitting it again'} so that a duplicate complaint is not created.`;
      await whatsapp.sendText(session.phone, message);
      return;
    }
    await whatsapp.sendText(session.phone, "I'm sorry, I wasn't able to register the complaint just now. Your details are still saved in this conversation. Please try again by selecting Submit Complaint, or type \"menu\" and choose Talk to Support.");
    return;
  }

  if (duplicateSubmission) {
    await sessionStore.clearFlow(session.phone);
    await whatsapp.sendText(
      session.phone,
      `Your complaint has already been registered. Reference: *${complaint.reference}*`
    );
    return;
  }

  invalidateCustomerProfile(customer.id);
  const cost = messageBudget.complete(session.phone);
  logger.audit('COMPLAINT_COST_SUMMARY', {
    phone: session.phone,
    customerId: customer.id,
    complaintId: complaint.id,
    botMessages: cost.botMessages,
    templateMessages: cost.templateMessages,
    aiCalls: cost.aiCalls,
    aiCallsAvoided: cost.aiCallsAvoided,
    estimatedCost: cost.estimatedCost,
    currency: cost.currency,
    result: 'completed',
  });
  logger.audit('COMPLAINT_SEVERITY_ASSESSED', {
    phone: session.phone,
    customerId: customer.id,
    complaintReference: complaint.reference,
    severity: severity.level,
    priority: severity.priority,
    result: severity.escalate ? 'escalated' : 'standard',
  });
  let priorityReview = false;
  const trigger = severity.escalate ? { escalate: true, reason: severity.reason } : evaluateTriggers({ category, text: description || '' });
  if (trigger.escalate) {
    try {
      await triggerEscalation({
        crm,
        phone: session.phone,
        customerId: customer.id,
        customer,
        session,
        reason: trigger.reason,
        summary: `Complaint ${complaint.reference}: ${category}${description ? ` — ${description}` : ''}${voiceNotes.length ? ` Voice notes: ${voiceNotes.map((note) => `${note.mediaId} (${note.detectedLanguage || 'language unknown'})`).join(', ')}` : ''}`,
        originalCustomerMessage: description,
        complaint: {
          id: complaint.id,
          reference: complaint.reference,
          relatedBookingId: bookingId,
          category,
          description,
          status: complaint.status || 'open',
        },
        suggestedNextAction: 'Review the complaint and continue directly with the customer.',
      });
      priorityReview = true;
    } catch (err) {
      logger.error('COMPLAINT', 'triggerEscalation failed:', err.message);
    }
  }

  const registered = `Thank you. I've registered your complaint with our support team.\n\nReference: *${complaint.reference}*`;
  if (priorityReview) {
    // A person takes over now; no bot quick replies that would compete with them.
    const urgency = severity.priority === 'urgent' ? 'urgent' : 'high priority';
    await whatsapp.sendText(
      session.phone,
      `${registered}\n\nI've marked it as ${urgency} and shared everything you've told me with our support team, so you won't need to repeat it. A team member will continue with you here.`
    );
    return;
  }
  await sessionStore.clearFlow(session.phone);
  await whatsapp.sendButtons(
    session.phone,
    `${registered}\n\nOur team will review it and follow up with you here. You can check its status at any time.`,
    [
      { id: actionId(ACTIONS.COMPLAINT_STATUS, complaint.id), title: 'Complaint Status' },
      { id: 'MAIN_MENU', title: 'Main Menu' },
    ]
  );
}

module.exports = {
  startComplaint,
  startComplaintWithMedia,
  startComplaintFromFeedback,
  startComplaintForBooking,
  steps: {
    select_booking: handleSelectBooking,
    select_category: handleSelectCategory,
    duplicate_check: handleDuplicateCheck,
    awaiting_details: handleAwaitingDetails,
    awaiting_media: handleAwaitingMedia,
    confirm: handleConfirm,
  },
};
