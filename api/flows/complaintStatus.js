const whatsapp = require('../whatsapp/client');
const sessionStore = require('../session/sessionStore');
const { getCrmAdapter } = require('../crm');

const crm = getCrmAdapter();
const FLOW = 'complaint_status';

async function promptForReference(session) {
  await whatsapp.sendText(session.phone, 'Please enter your complaint reference number (e.g. CM-4H2M8X).');
  await sessionStore.setFlow(session.phone, FLOW, 'awaiting_reference', {});
}

async function handleAwaitingReference(session, customer, input) {
  const reference = (input.text || '').trim().toUpperCase();
  if (!reference) {
    await whatsapp.sendText(session.phone, 'Please type your complaint reference number.');
    return;
  }

  const complaint = await crm.getComplaintStatus(reference);
  await sessionStore.clearFlow(session.phone);

  if (!complaint) {
    await whatsapp.sendText(session.phone, `We couldn't find a complaint with reference ${reference}. Please check the reference and try again from the main menu.`);
    return;
  }

  await whatsapp.sendText(
    session.phone,
    `📋 Complaint ${complaint.reference}\nCategory: ${complaint.category}\nStatus: ${complaint.status}\n\nType "menu" for other options.`
  );
}

module.exports = { promptForReference, steps: { awaiting_reference: handleAwaitingReference } };
