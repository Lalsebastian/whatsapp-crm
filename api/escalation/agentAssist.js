// Human-agent assist: what a support agent needs to take over a case in
// seconds, without reading the whole history.
//
//   summary                internal, three sentences at most
//   suggestedReply         a first WhatsApp message the agent can edit and send
//   recommendedNextAction  what to check or do first
//
// The AI drafts these from the handoff facts; these deterministic versions
// are used whenever the AI is unavailable or returns nothing usable. Neither
// may promise times, refunds, fault or outcomes.

function firstName(handoff) {
  const name = handoff && handoff.customer && handoff.customer.name;
  return name ? String(name).trim().split(/\s+/)[0] : null;
}

function reference(handoff) {
  return (handoff.complaint && handoff.complaint.reference) || (handoff.booking && handoff.booking.reference) || null;
}

function serviceName(handoff) {
  return (handoff.booking && handoff.booking.service) || null;
}

const REPLIES = {
  explicit_human_request: (h) => `this is the Joboy support team. I've read your conversation with our assistant${serviceName(h) ? ` about ${serviceName(h)}` : ''}, so there's no need to repeat anything. How can I help?`,
  repeat_service_failure: (h) => `I'm sorry the problem has come back${reference(h) ? ` after visit ${reference(h)}` : ''}. I have the details you shared. When would suit you for us to take another look?`,
  repeated_unresolved_complaint: (h) => `I can see you've raised this more than once${reference(h) ? ` (${reference(h)})` : ''}, and I'm sorry it's still not resolved. I'm taking this over personally now.`,
  property_damage: (h) => `I'm sorry to hear about the damage${reference(h) ? ` (complaint ${reference(h)})` : ''}. Could you send a clear photo of it if you haven't already? I'll review it with the team and update you here.`,
  payment_dispute: (h) => `I've got your message about the payment${reference(h) ? ` for ${reference(h)}` : ''}. I'm checking the details now and will update you here.`,
  technician_behaviour: () => 'thank you for telling us about this, and I\'m sorry for the experience. I\'m looking into it now. Is there anything else you\'d like me to know?',
  electrical_safety_concern: () => 'please stay away from the affected switch or socket and don\'t use it. Is everyone safe right now?',
  flooding_safety_concern: () => 'please keep clear of the water and any nearby electrical points. Is everyone safe right now?',
  immediate_safety_concern: () => 'please make sure everyone is safe and away from the area first. If there is any immediate danger, call 997. Is everyone safe right now?',
  safety_concern: () => 'your safety comes first. Are you safe right now? I\'m here to help.',
  booking_creation_uncertain: () => 'I\'m checking whether your booking went through so you don\'t end up with a duplicate. I\'ll confirm here shortly.',
  complaint_creation_uncertain: () => 'I\'m checking whether your complaint was registered so it isn\'t duplicated. I\'ll confirm here shortly.',
  intent_undetermined: () => 'I\'m sorry our assistant couldn\'t help with that. Could you tell me in a few words what you need?',
};

const NEXT_ACTIONS = {
  explicit_human_request: 'Read the summary and continue from where the assistant left off.',
  repeat_service_failure: 'Review the previous job notes and arrange a revisit with the customer.',
  repeated_unresolved_complaint: 'Review the earlier complaints for this customer and agree a resolution owner.',
  property_damage: 'Collect photos and job details, then follow the damage-claim process.',
  payment_dispute: 'Check the invoice and payment record for this booking before replying with figures.',
  technician_behaviour: 'Get the customer\'s account, then inform the technician\'s supervisor.',
  electrical_safety_concern: 'Confirm the customer is safe; arrange an urgent electrician visit if needed.',
  flooding_safety_concern: 'Confirm the customer is safe; arrange an urgent plumber visit if needed.',
  immediate_safety_concern: 'Confirm the customer is safe; direct them to emergency services if there is danger.',
  safety_concern: 'Confirm the customer is safe before anything else.',
  booking_creation_uncertain: 'Check the CRM for a booking from this customer created in the last few minutes before rebooking.',
  complaint_creation_uncertain: 'Check the CRM for a complaint from this customer created in the last few minutes before re-registering.',
  intent_undetermined: 'Read the recent messages to understand what the customer needs.',
};

function deterministicAssist(handoff, reason, summary) {
  const reply = (REPLIES[reason] || REPLIES.explicit_human_request)(handoff);
  const name = firstName(handoff);
  return {
    summary,
    suggestedReply: `${name ? `Hi ${name}, ` : 'Hi, '}${reply}`,
    recommendedNextAction: NEXT_ACTIONS[reason] || 'Review the collected context and continue assisting the customer.',
  };
}

function hasPlaybook(reason) {
  return Object.prototype.hasOwnProperty.call(NEXT_ACTIONS, reason);
}

module.exports = { deterministicAssist, hasPlaybook };
