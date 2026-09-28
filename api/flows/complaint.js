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

const crm = getCrmAdapter();
const FLOW = 'complaint';

const CATEGORIES = [
  { id: 'service_not_completed', title: 'Service Not Completed' },
  { id: 'problem_returned', title: 'Problem Returned' },
  { id: 'technician_delayed', title: 'Technician Delayed' },
  { id: 'technician_behaviour', title: 'Technician Behaviour' },
  { id: 'property_damage', title: 'Property Damage' },
  { id: 'payment_issue', title: 'Payment Issue' },
  { id: 'other', title: 'Other' },
];

async function startComplaint(session, customer) {
  const bookings = await crm.getBookings(customer.id, { limit: 5 });

  if (!bookings || bookings.length === 0) {
    return promptCategory(session, {});
  }

  const rows = bookings.map((b) => ({
    id: `BKC_${b.id}`,
    title: `${b.reference}`,
    description: `${b.scheduledDate || ''} — ${b.status}`.slice(0, 72),
  }));
  rows.push({ id: 'BKC_NONE', title: 'Not related to a booking', description: 'General complaint' });

  await whatsapp.sendListMessage(session.phone, 'Is this complaint about a specific booking?', 'Choose booking', [
    { title: 'Recent Bookings', rows },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'select_booking', {});
}

async function handleSelectBooking(session, customer, input) {
  if (!input.buttonId || !input.buttonId.startsWith('BKC_')) {
    await whatsapp.sendText(session.phone, 'Please choose an option from the list above.');
    return;
  }
  const bookingId = input.buttonId === 'BKC_NONE' ? null : input.buttonId.replace('BKC_', '');
  await promptCategory(session, { bookingId });
}

async function promptCategory(session, context) {
  await whatsapp.sendListMessage(session.phone, 'What is this complaint about?', 'Choose category', [
    { title: 'Complaint Category', rows: CATEGORIES.map((c) => ({ id: `CAT_${c.id}`, title: c.title })) },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'select_category', context);
}

async function handleSelectCategory(session, customer, input) {
  if (!input.buttonId || !input.buttonId.startsWith('CAT_')) {
    await whatsapp.sendText(session.phone, 'Please choose a category from the list above.');
    return;
  }
  const category = input.buttonId.replace('CAT_', '');
  const context = { ...session.context, category, attachments: [] };

  if (category === 'other') {
    await whatsapp.sendText(session.phone, 'Please describe the issue — you can type it or send a voice note.');
    await sessionStore.setFlow(session.phone, FLOW, 'awaiting_details', context);
    return;
  }

  await promptMedia(session, context);
}

async function handleAwaitingDetails(session, customer, input) {
  if (!input.text || input.text.trim().length === 0) {
    await whatsapp.sendText(session.phone, 'Please describe the issue in a message or voice note.');
    return;
  }
  await promptMedia(session, { ...session.context, description: input.text.trim() });
}

async function promptMedia(session, context) {
  await whatsapp.sendButtons(session.phone, '📷 You can attach photos or videos of the issue. Send them now, or tap Skip.', [
    { id: 'MEDIA_DONE', title: 'Skip / Done' },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'awaiting_media', context);
}

async function handleAwaitingMedia(session, customer, input) {
  if (input.mediaId && ['image', 'video'].includes(input.mediaType)) {
    const attachments = [...(session.context.attachments || []), { waMediaId: input.mediaId, mediaType: input.mediaType }];
    await whatsapp.sendText(session.phone, `Got it (${attachments.length} attachment${attachments.length > 1 ? 's' : ''}). Send more, or tap Skip/Done.`);
    await sessionStore.setFlow(session.phone, FLOW, 'awaiting_media', { ...session.context, attachments });
    return;
  }

  const isDone = input.buttonId === 'MEDIA_DONE' || (input.text && ['done', 'skip', 'no'].includes(input.text.trim().toLowerCase()));
  if (!isDone) {
    await whatsapp.sendText(session.phone, 'Send a photo/video, or tap Skip/Done to continue.');
    return;
  }

  const { category, description, bookingId, attachments = [] } = session.context;
  const summary = `Category: ${category}${description ? `\nDetails: ${description}` : ''}\nAttachments: ${attachments.length}`;
  await whatsapp.sendButtons(session.phone, `Please confirm this complaint:\n\n${summary}`, [
    { id: 'CONFIRM_COMPLAINT', title: '✓ Submit' },
    { id: 'CANCEL_FLOW', title: '✗ Cancel' },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'confirm', { category, description, bookingId, attachments });
}

async function handleConfirm(session, customer, input) {
  if (input.buttonId === 'CANCEL_FLOW') {
    await sessionStore.clearFlow(session.phone);
    await whatsapp.sendText(session.phone, 'No problem — complaint cancelled. Type "menu" anytime.');
    return;
  }
  if (input.buttonId !== 'CONFIRM_COMPLAINT') {
    await whatsapp.sendText(session.phone, 'Please tap Submit or Cancel.');
    return;
  }

  const { category, description, bookingId, attachments = [] } = session.context;
  if (!category) {
    logger.error('COMPLAINT', 'Missing category at confirm step', session.context);
    await whatsapp.sendText(session.phone, "Something went wrong — let's start over.");
    await sessionStore.clearFlow(session.phone);
    return;
  }

  try {
    const complaint = await crm.createComplaint({
      customerId: customer.id,
      bookingId: bookingId || undefined,
      category,
      description,
      attachments,
    });
    await sessionStore.clearFlow(session.phone);
    await whatsapp.sendText(
      session.phone,
      `✅ Complaint registered.\n\nReference: *${complaint.reference}*\nOur team will follow up shortly. You can check status anytime from the main menu.`
    );

    const trigger = evaluateTriggers({ category });
    if (trigger.escalate) {
      await triggerEscalation({
        crm,
        phone: session.phone,
        customerId: customer.id,
        reason: trigger.reason,
        summary: `Complaint ${complaint.reference}: ${category}${description ? ` — ${description}` : ''}`,
      });
    }
  } catch (err) {
    logger.error('COMPLAINT', 'createComplaint failed:', err.message);
    await whatsapp.sendText(session.phone, "Sorry, we couldn't submit your complaint due to a system error. Please try again shortly, or type \"support\" to talk to our team.");
  }
}

module.exports = {
  startComplaint,
  steps: {
    select_booking: handleSelectBooking,
    select_category: handleSelectCategory,
    awaiting_details: handleAwaitingDetails,
    awaiting_media: handleAwaitingMedia,
    confirm: handleConfirm,
  },
};
