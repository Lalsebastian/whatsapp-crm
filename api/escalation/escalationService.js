// Central policy and payload builder for every human handoff. Flows provide
// the facts they have; this module assigns deterministic priority, gathers a
// bounded history, creates a concise summary, writes through the existing CRM
// adapter, and only then enables human takeover.
const sessionStore = require('../session/sessionStore');
const db = require('../db/supabaseClient');
const intentService = require('../ai/intentService');
const { urgentReason } = require('../ai/serviceSynonyms');
const { deterministicAssist, hasPlaybook } = require('./agentAssist');
const logger = require('../utils/logger');

const RE_URGENT_ELECTRICAL = /\b(burning smell|smoke|smoking|sparks?|electrical fire|electric shock|live wire)\b/i;
const RE_URGENT_WATER = /\b(flood|flooding|burst pipe|water (?:near|on) (?:a |the )?(?:socket|switch|wire|electric))\b/i;
const RE_URGENT_HAZARD = /\b(gas leak|active fire|immediate danger)\b/i;
const RE_GAS = /\bgas\b.{0,20}\b(?:smell|smelling|leak|leaking)\b|\b(?:smell|smells) (?:of|like) gas\b/i;
const RE_SAFETY = /\b(unsafe|dangerous|threat|harass|inappropriate|scared|afraid)\b/i;
const RE_PAYMENT = /\b(refund|overcharg|payment issue|money back|payment dispute|billing dispute|scam)\b/i;
const RE_DAMAGE = /\b(?:technician|worker|service).{0,30}\b(?:damage|damaged|broke)\b|\b(?:damage|damaged)\b.{0,30}\b(?:property|home|wall|floor|window|furniture|appliance)\b/i;
const RE_HUMAN = /\b(human|agent|representative|real person|talk to (?:a )?person|talk to (?:a )?human|speak to (?:an )?agent|speak to (someone|somebody))\b/i;

const LOW_CONFIDENCE_THRESHOLD = 0.4;
const STRUGGLE_STREAK_THRESHOLD = 3;
const HISTORY_LIMIT = 8;

function isStruggling({ intent, confidence }) {
  if (intent === 'UNKNOWN') return true;
  return typeof confidence === 'number' && confidence < LOW_CONFIDENCE_THRESHOLD;
}

function safetyReason(text) {
  if (RE_GAS.test(text)) return 'immediate_safety_concern';
  if (RE_URGENT_ELECTRICAL.test(text)) return 'electrical_safety_concern';
  if (RE_URGENT_WATER.test(text)) return 'flooding_safety_concern';
  if (RE_URGENT_HAZARD.test(text)) return 'immediate_safety_concern';
  if (RE_SAFETY.test(text)) return 'safety_concern';
  // The synonym dictionary's urgent phrases ("smell of gas", "sparking",
  // "water everywhere") catch wording the patterns above miss.
  return urgentReason(text);
}

// The local emergency number for safety guidance (112 in India and from
// mobiles in most countries; set 997 for UAE Civil Defence, etc.).
function emergencyNumber() {
  return String(process.env.EMERGENCY_PHONE_NUMBER || '112').trim();
}

function safetyGuidanceFor(text) {
  const dictionaryReason = urgentReason(text);
  if (RE_GAS.test(text)) {
    return `For your safety: please don’t switch any lights or appliances on or off, open the windows, and leave the area. If the smell is strong, call emergency services on ${emergencyNumber()}. I’m escalating this to our support team now.`;
  }
  if (RE_URGENT_ELECTRICAL.test(text) || dictionaryReason === 'electrical_safety_concern') {
    return 'For safety, please avoid using the affected switch, socket, or appliance and keep clear of the area. I’m escalating this to our support team now.';
  }
  if (RE_URGENT_WATER.test(text) || dictionaryReason === 'flooding_safety_concern') {
    return 'For safety, please keep clear of the affected area and avoid contact with any nearby electrical fittings. I’m escalating this to our support team now.';
  }
  if (RE_URGENT_HAZARD.test(text) || RE_SAFETY.test(text) || dictionaryReason) {
    return 'Please keep a safe distance from the affected area. I’m escalating this to our support team now.';
  }
  return null;
}

function isExplicitHumanRequest(text) {
  return RE_HUMAN.test(String(text || ''));
}

function evaluateTriggers({ text = '', intent, confidence, category, repeatedComplaintCount = 0, struggleStreak = 0 } = {}) {
  if (intent === 'HUMAN_AGENT') return { escalate: true, reason: 'explicit_human_request' };
  if (category === 'property_damage') return { escalate: true, reason: 'property_damage' };
  if (category === 'technician_behaviour') return { escalate: true, reason: 'technician_behaviour' };
  if (category === 'payment_issue') return { escalate: true, reason: 'payment_dispute' };
  if (category === 'problem_returned') return { escalate: true, reason: 'repeat_service_failure' };
  const safety = safetyReason(text);
  if (safety) return { escalate: true, reason: safety };
  if (RE_PAYMENT.test(text)) return { escalate: true, reason: 'payment_dispute' };
  if (RE_DAMAGE.test(text)) return { escalate: true, reason: 'property_damage' };
  if (isExplicitHumanRequest(text)) return { escalate: true, reason: 'explicit_human_request' };
  if (repeatedComplaintCount >= 3) return { escalate: true, reason: 'repeated_unresolved_complaint' };
  if (isStruggling({ intent, confidence }) && struggleStreak >= STRUGGLE_STREAK_THRESHOLD) {
    return { escalate: true, reason: 'intent_undetermined' };
  }
  return { escalate: false, reason: null };
}

function priorityFor(reason, text = '') {
  const detectedSafety = safetyReason(text);
  const urgentReasons = ['electrical_safety_concern', 'flooding_safety_concern', 'immediate_safety_concern'];
  if (urgentReasons.includes(reason) || urgentReasons.includes(detectedSafety)) return 'URGENT';
  if ([
    'repeat_service_failure',
    'repeated_unresolved_complaint',
    'technician_behaviour',
    'payment_dispute',
    'property_damage',
    'booking_creation_uncertain',
    'complaint_creation_uncertain',
    'safety_concern',
  ].includes(reason) || detectedSafety === 'safety_concern') return 'HIGH';
  return 'NORMAL';
}

function compact(value) {
  if (Array.isArray(value)) return value.map(compact).filter((item) => item !== undefined);
  if (!value || typeof value !== 'object') return value;
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined && item !== null && item !== '')
    .map(([key, item]) => [key, compact(item)]);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function bookingContext(context = {}, supplied) {
  if (supplied) return compact(supplied);
  return compact({
    id: context.bookingId,
    reference: context.bookingReference || context.reference,
    service: context.serviceName,
    serviceId: context.serviceId,
    property: context.propertyLabel || context.locationHint,
    propertyId: context.propertyId,
    date: context.date,
    timePreference: context.preferredTime,
    selectedSlot: context.time,
    status: context.bookingStatus,
    issue: context.issue,
    cart: context.cart,
    currentItem: context.currentItem,
  });
}

function complaintContext(context = {}, supplied) {
  if (supplied) return compact(supplied);
  return compact({
    id: context.complaintId,
    reference: context.complaintReference,
    relatedBookingId: context.bookingId,
    category: context.category,
    description: context.description,
    status: context.complaintStatus,
  });
}

function mediaContext(context = {}, supplied = []) {
  const media = [...(supplied || [])];
  for (const item of context.attachments || []) {
    media.push({ type: item.mediaType, mediaId: item.waMediaId });
  }
  for (const note of context.voiceNotes || []) {
    media.push({
      type: 'audio',
      mediaId: note.mediaId,
      transcript: note.transcript,
      detectedLanguage: note.detectedLanguage,
      transcriptionConfidence: note.confidence,
    });
  }
  const unique = new Map();
  for (const raw of media) {
    const item = compact(raw);
    if (!item) continue;
    const key = `${item.type || ''}:${item.mediaId || ''}`;
    unique.set(key, { ...(unique.get(key) || {}), ...item });
  }
  return [...unique.values()];
}

function inferredBotActions({ customer, booking, complaint, media, reason }) {
  const actions = [];
  if (customer && customer.id) actions.push('Customer identified');
  if (booking && (booking.id || booking.reference)) actions.push('Booking found');
  if (booking && (booking.service || booking.serviceId)) actions.push('Service selected');
  if (booking && booking.date) actions.push('Booking date collected');
  if (booking && (booking.selectedSlot || booking.time)) actions.push('Availability checked and slot selected');
  if (complaint && complaint.category) actions.push('Complaint category selected');
  if (complaint && complaint.reference) actions.push('Complaint created');
  if (media.some((item) => item.type === 'audio' && item.transcript)) actions.push('Voice note transcribed');
  if (media.some((item) => ['image', 'video'].includes(item.type))) actions.push('Complaint media received');
  if (reason === 'booking_creation_uncertain') actions.push('CRM booking result could not be verified');
  if (reason === 'complaint_creation_uncertain') actions.push('CRM complaint result could not be verified');
  if (reason === 'explicit_human_request') actions.push('Customer requested human support');
  return actions;
}

async function recentConversation(phone) {
  try {
    const rows = await db.get(
      'messages',
      `phone=eq.${encodeURIComponent(phone)}&select=direction,type,content,created_at&order=created_at.desc&limit=${HISTORY_LIMIT}`
    );
    return (rows || []).slice(0, HISTORY_LIMIT).reverse().map((row) => compact({
      direction: row.direction,
      type: row.type,
      content: row.content,
      timestamp: row.created_at,
    }));
  } catch (error) {
    logger.error('HANDOFF', 'Unable to load recent conversation context:', error.message);
    return [];
  }
}

function deterministicSummary({ suppliedSummary, originalCustomerMessage, reason, booking, complaint, media }) {
  if (suppliedSummary) return suppliedSummary;
  const details = [];
  if (complaint && complaint.description) details.push(`Complaint: ${complaint.description}`);
  else if (booking && booking.issue) details.push(`Service issue: ${booking.issue}`);
  else if (originalCustomerMessage) details.push(`Customer said: ${originalCustomerMessage}`);
  if (complaint && complaint.category) details.push(`Category: ${complaint.category}`);
  if (booking && booking.service) details.push(`Service: ${booking.service}`);
  if (media.length) details.push(`${media.length} media item${media.length === 1 ? '' : 's'} supplied`);
  details.push(`Handoff reason: ${reason}`);
  return details.join('. ');
}

async function buildHandoff({
  phone,
  customerId,
  customer,
  session = {},
  reason,
  summary,
  originalCustomerMessage,
  booking: suppliedBooking,
  complaint: suppliedComplaint,
  feedback: suppliedFeedback,
  media: suppliedMedia,
  botActions = [],
  suggestedNextAction,
}) {
  const context = session.context || {};
  const booking = bookingContext(context, suppliedBooking);
  const complaint = complaintContext(context, suppliedComplaint);
  const media = mediaContext(context, suppliedMedia);
  const priority = priorityFor(reason, originalCustomerMessage);
  const recentMessages = await recentConversation(phone);
  const base = compact({
    customer: {
      id: (customer && customer.id) || customerId,
      name: customer && customer.name,
      phone,
    },
    context: {
      flow: session.currentFlow,
      step: session.currentStep,
      preferredLanguage: session.preferredLanguage || (customer && customer.preferredLanguage),
    },
    preferences: customer && customer.profile ? {
      preferredLanguage: customer.profile.preferredLanguage,
      defaultProperty: customer.profile.defaultProperty && {
        id: customer.profile.defaultProperty.id,
        label: customer.profile.defaultProperty.label,
        area: customer.profile.defaultProperty.area,
      },
    } : undefined,
    booking,
    complaint,
    feedback: suppliedFeedback,
    issue: {
      originalCustomerMessage,
      urgency: priority,
      reasonForEscalation: reason,
    },
    media: media.length ? media : undefined,
    botActions: [...new Set([...inferredBotActions({ customer: customer || { id: customerId }, booking, complaint, media, reason }), ...botActions])],
    suggestedNextAction: suggestedNextAction || 'Review the collected context and continue assisting the customer.',
    recentMessages: recentMessages.length ? recentMessages : undefined,
  });
  const fallback = deterministicSummary({
    suppliedSummary: summary,
    originalCustomerMessage,
    reason,
    booking,
    complaint,
    media,
  });
  // One AI call drafts the staff summary, a suggested first reply and the
  // next action; deterministic drafts fill anything the AI did not return.
  const ai = await intentService.assistHandoff(base);
  const drafted = deterministicAssist(base, reason, fallback);
  const assist = {
    summary: (ai && ai.summary) || drafted.summary,
    suggestedReply: (ai && ai.suggestedReply) || drafted.suggestedReply,
    recommendedNextAction: (ai && ai.nextAction) || (hasPlaybook(reason) ? drafted.recommendedNextAction : (suggestedNextAction || drafted.recommendedNextAction)),
    source: ai ? 'ai' : 'rules',
  };
  return {
    ...base,
    issue: { ...base.issue, summary: assist.summary },
    suggestedNextAction: assist.recommendedNextAction,
    assist,
  };
}

async function triggerEscalation(input) {
  const { crm, phone, customerId, reason } = input;
  const handoff = await buildHandoff(input);
  const priority = handoff.issue.urgency;
  const references = compact({
    bookingReference: handoff.booking && handoff.booking.reference,
    complaintReference: handoff.complaint && handoff.complaint.reference,
  }) || {};
  const analyticsContext = {
    phone,
    customerId,
    sessionId: (input.session && input.session.phone) || phone,
    flow: handoff.context && handoff.context.flow,
    step: handoff.context && handoff.context.step,
    bookingId: handoff.booking && handoff.booking.id,
    complaintId: handoff.complaint && handoff.complaint.id,
    bookingLinked: !!(handoff.booking && (handoff.booking.id || handoff.booking.reference)),
    complaintLinked: !!(handoff.complaint && (handoff.complaint.id || handoff.complaint.reference)),
  };
  logger.audit('HANDOFF_REQUESTED', { ...analyticsContext, reason, priority, result: 'requested', ...references });
  try {
    const escalation = await crm.escalateToHuman({
      customerId,
      phone,
      reason,
      summary: handoff.issue.summary,
      handoff,
    });
    await sessionStore.setHumanTakeover(phone, true);
    logger.audit('HANDOFF_CREATED', {
      ...analyticsContext, reason, priority, result: 'success',
      escalationId: escalation && escalation.id, ...references,
    });
    logger.audit('HUMAN_TAKEOVER_STARTED', {
      ...analyticsContext, reason, priority, result: 'success',
      escalationId: escalation && escalation.id, ...references,
    });
    return { ...escalation, handoff, priority, reason };
  } catch (error) {
    logger.audit('HANDOFF_FAILED', {
      ...analyticsContext, reason, priority,
      result: error.uncertain ? 'uncertain' : 'failed',
      error: error.code || error.message, ...references,
    });
    throw error;
  }
}

module.exports = {
  evaluateTriggers,
  triggerEscalation,
  isStruggling,
  isExplicitHumanRequest,
  priorityFor,
  safetyGuidanceFor,
  buildHandoff,
  HISTORY_LIMIT,
};
