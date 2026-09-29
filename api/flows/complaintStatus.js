const whatsapp = require('../whatsapp/client');
const sessionStore = require('../session/sessionStore');
const { getCrmAdapter } = require('../crm');

const crm = getCrmAdapter();
const FLOW = 'complaint_status';

function formatLabel(value) {
  return value
    ? value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
    : 'Not available';
}

async function promptForReference(session) {
  await whatsapp.sendText(session.phone, 'I can help you check your complaint status. Please enter your complaint reference number (for example, CM-4H2M8X).');
  await sessionStore.setFlow(session.phone, FLOW, 'awaiting_reference', {});
}

async function handleAwaitingReference(session, customer, input) {
  const reference = (input.text || '').trim().toUpperCase();
  if (!reference) {
    await whatsapp.sendText(session.phone, 'Please enter your complaint reference number so I can check the status.');
    return;
  }

  const complaint = await crm.getComplaintStatus(reference);
  await sessionStore.clearFlow(session.phone);

  if (!complaint) {
    await whatsapp.sendText(session.phone, `I'm sorry, I couldn't find a complaint with reference ${reference}. Please check the reference and try again from the main menu.`);
    return;
  }

  await whatsapp.sendText(
    session.phone,
    `📋 Complaint ${complaint.reference}\nCategory: ${formatLabel(complaint.category)}\nStatus: ${formatLabel(complaint.status)}\n\nIf you need anything else, type "menu".`
  );
}

module.exports = { promptForReference, steps: { awaiting_reference: handleAwaitingReference } };
