// "Add Details" for an open complaint: the customer sends text, voice notes or
// photos, then taps Done, and everything is appended to the existing
// complaint in one CRM call. This replaces opening a duplicate complaint for
// the same problem.
const { randomUUID } = require('node:crypto');
const whatsapp = require('../whatsapp/client');
const sessionStore = require('../session/sessionStore');
const logger = require('../utils/logger');
const { getCrmAdapter } = require('../crm');
const { executeOnce } = require('../reliability/actionGuard');
const { invalidateCustomerProfile } = require('../customer/customerProfileService');
const { ACTIONS, actionId } = require('./quickActions');

const crm = getCrmAdapter();
const FLOW = 'complaint_update';
const MAX_NOTES = 10;
const MAX_ATTACHMENTS = 10;

const DONE_BUTTONS = [
  { id: 'UPDATE_DONE', title: 'Done' },
  { id: 'UPDATE_CANCEL', title: 'Cancel' },
];

async function startComplaintUpdate(session, customer, complaint, initial = {}) {
  const context = {
    complaintId: complaint.id,
    reference: complaint.reference,
    notes: initial.text ? [initial.text] : [],
    attachments: initial.attachments || [],
    nonce: randomUUID(),
  };
  const received = context.notes.length || context.attachments.length;
  await whatsapp.sendButtons(
    session.phone,
    received
      ? `Thanks, I've noted that for complaint ${complaint.reference}. Send anything else you'd like to add (a message, voice note or photo), then tap Done.`
      : `Please send the new details for complaint ${complaint.reference}: a message, a voice note, or photos. Tap Done when you've finished.`,
    DONE_BUTTONS
  );
  await sessionStore.setFlow(session.phone, FLOW, 'collecting', context);
  logger.audit('COMPLAINT_UPDATE_STARTED', { phone: session.phone, customerId: customer && customer.id, complaintReference: complaint.reference, result: 'started' });
}

async function submit(session, customer, context) {
  const text = context.notes.join('\n');
  const key = `complaint-update:${context.complaintId}:${context.nonce}`;
  try {
    await executeOnce(key, () => crm.addComplaintDetails(context.complaintId, {
      customerId: customer.id,
      text,
      attachments: context.attachments,
      idempotencyKey: key,
    }));
    invalidateCustomerProfile(customer.id);
    logger.audit('COMPLAINT_UPDATED', {
      phone: session.phone,
      customerId: customer.id,
      complaintReference: context.reference,
      noteCount: context.notes.length,
      attachmentCount: context.attachments.length,
      result: 'success',
    });
    await sessionStore.clearFlow(session.phone);
    await whatsapp.sendButtons(
      session.phone,
      `Thank you. I've added your update to complaint ${context.reference}, and our support team will see it with the rest of the case.`,
      [
        { id: actionId(ACTIONS.COMPLAINT_STATUS, context.complaintId), title: 'Complaint Status' },
        { id: 'MAIN_MENU', title: 'Main Menu' },
      ]
    );
  } catch (error) {
    logger.error('COMPLAINT_UPDATE', 'addComplaintDetails failed:', error.message);
    logger.audit('COMPLAINT_UPDATE_FAILED', {
      phone: session.phone,
      customerId: customer.id,
      complaintReference: context.reference,
      result: error.uncertain ? 'uncertain' : 'failed',
      reason: error.code || error.message,
    });
    const message = error.uncertain
      ? `I'm sorry, I couldn't confirm whether your update reached complaint ${context.reference}. Please don't resend it yet; type "support" and our team will check.`
      : `I'm sorry, I couldn't add your update to complaint ${context.reference} just now. Your details are still here, so please tap Done again in a moment.`;
    await whatsapp.sendButtons(session.phone, message, error.uncertain ? [{ id: 'HUMAN_SUPPORT', title: 'Talk to Support' }] : DONE_BUTTONS);
  }
}

async function handleCollecting(session, customer, input) {
  const context = { notes: [], attachments: [], ...session.context };
  if (input.buttonId === 'UPDATE_CANCEL') {
    await sessionStore.clearFlow(session.phone);
    await whatsapp.sendText(session.phone, `Okay, nothing has been added to complaint ${context.reference}.`);
    return;
  }
  if (input.buttonId === 'UPDATE_DONE' || (input.text && /^(?:done|finished|that'?s all|submit)$/i.test(input.text.trim()))) {
    if (context.notes.length === 0 && context.attachments.length === 0) {
      await whatsapp.sendButtons(session.phone, 'I haven\'t received any new details yet. Please send a message, voice note or photo, or tap Cancel.', DONE_BUTTONS);
      return;
    }
    return submit(session, customer, context);
  }

  if (input.mediaId && ['image', 'video'].includes(input.mediaType)) {
    if (context.attachments.length >= MAX_ATTACHMENTS) {
      await whatsapp.sendButtons(session.phone, `That's the maximum of ${MAX_ATTACHMENTS} files for one update. Please tap Done to send what you have.`, DONE_BUTTONS);
      return;
    }
    context.attachments = [...context.attachments, { waMediaId: input.mediaId, mediaType: input.mediaType }];
  } else if (input.text && input.text.trim()) {
    if (context.notes.length >= MAX_NOTES) {
      await whatsapp.sendButtons(session.phone, 'Please tap Done to send what you have so far.', DONE_BUTTONS);
      return;
    }
    context.notes = [...context.notes, input.text.trim()];
    if (input.voice && input.voice.mediaId) {
      context.attachments = [...context.attachments, { waMediaId: input.voice.mediaId, mediaType: 'audio' }];
    }
  } else {
    await whatsapp.sendButtons(session.phone, 'Please send a message, voice note or photo, or tap Done.', DONE_BUTTONS);
    return;
  }

  await sessionStore.setFlow(session.phone, FLOW, 'collecting', context);
  const total = context.notes.length + context.attachments.length;
  await whatsapp.sendButtons(session.phone, `Got it (${total} item${total === 1 ? '' : 's'} so far). Send more, or tap Done to add ${total === 1 ? 'it' : 'them'} to ${context.reference}.`, DONE_BUTTONS);
}

module.exports = { startComplaintUpdate, steps: { collecting: handleCollecting } };
