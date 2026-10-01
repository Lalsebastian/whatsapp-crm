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

async function sendComplaintStatus(session, complaint) {
  await sessionStore.clearFlow(session.phone);
  await whatsapp.sendText(
    session.phone,
    `📋 Complaint ${complaint.reference}\nCategory: ${formatLabel(complaint.category)}\nStatus: ${formatLabel(complaint.status)}\n\nIf you need anything else, type "menu".`
  );
}

async function promptForReference(session, customer) {
  let active = [];
  try {
    active = customer && customer.id
      ? await crm.getActiveComplaints(customer.id, { limit: 5 })
      : [];
  } catch (_error) {
    active = [];
  }
  if (active.length === 1) {
    const complaint = active[0];
    await whatsapp.sendButtons(
      session.phone,
      `I found one active complaint (${complaint.reference}). Would you like to check its status?`,
      [
        { id: 'CHECK_ACTIVE_COMPLAINT', title: 'Check Status' },
        { id: 'ENTER_COMPLAINT_REFERENCE', title: 'Use Reference' },
      ]
    );
    await sessionStore.setFlow(session.phone, FLOW, 'confirm_active_complaint', {
      activeComplaintId: complaint.id,
    });
    return;
  }
  if (active.length > 1) {
    await whatsapp.sendListMessage(session.phone, 'Please select the active complaint you would like to check.', 'Choose complaint', [
      {
        title: 'Active Complaints',
        rows: active.map((complaint) => ({
          id: `ACTIVE_COMPLAINT_${complaint.id}`,
          title: complaint.reference,
          description: `${formatLabel(complaint.category)} — ${formatLabel(complaint.status)}`.slice(0, 72),
        })),
      },
    ]);
    await sessionStore.setFlow(session.phone, FLOW, 'select_active_complaint', {});
    return;
  }
  await whatsapp.sendText(session.phone, 'I can help you check your complaint status. Please enter your complaint reference number (for example, CM-4H2M8X).');
  await sessionStore.setFlow(session.phone, FLOW, 'awaiting_reference', {});
}

async function handleConfirmActiveComplaint(session, customer, input) {
  if (input.buttonId === 'ENTER_COMPLAINT_REFERENCE') return promptForReference({ ...session }, null);
  if (input.buttonId !== 'CHECK_ACTIVE_COMPLAINT') {
    await whatsapp.sendText(session.phone, 'Please choose Check Status or Use Reference.');
    return;
  }
  const active = await crm.getActiveComplaints(customer.id, { limit: 5 });
  const complaint = active.find((item) => item.id === session.context.activeComplaintId);
  if (!complaint || (customer && complaint.customerId && complaint.customerId !== customer.id)) {
    await whatsapp.sendText(session.phone, 'That complaint is no longer active. Please enter its reference number if you still need to check it.');
    await sessionStore.setFlow(session.phone, FLOW, 'awaiting_reference', {});
    return;
  }
  return sendComplaintStatus(session, complaint);
}

async function handleSelectActiveComplaint(session, customer, input) {
  const id = input.buttonId && input.buttonId.startsWith('ACTIVE_COMPLAINT_')
    ? input.buttonId.slice('ACTIVE_COMPLAINT_'.length)
    : null;
  if (!id) {
    await whatsapp.sendText(session.phone, 'Please select a complaint from the list.');
    return;
  }
  const active = await crm.getActiveComplaints(customer.id, { limit: 5 });
  const complaint = active.find((item) => item.id === id);
  if (!complaint) {
    await whatsapp.sendText(session.phone, 'That complaint is no longer active. Please choose another complaint or enter its reference number.');
    return promptForReference(session, customer);
  }
  return sendComplaintStatus(session, complaint);
}

async function handleAwaitingReference(session, customer, input) {
  const reference = (input.text || '').trim().toUpperCase();
  if (!reference) {
    await whatsapp.sendText(session.phone, 'Please enter your complaint reference number so I can check the status.');
    return;
  }

  const complaint = await crm.getComplaintStatus(reference);
  if (!complaint) {
    await sessionStore.clearFlow(session.phone);
    await whatsapp.sendText(session.phone, `I'm sorry, I couldn't find a complaint with reference ${reference}. Please check the reference and try again from the main menu.`);
    return;
  }
  return sendComplaintStatus(session, complaint);
}

module.exports = {
  promptForReference,
  steps: {
    awaiting_reference: handleAwaitingReference,
    confirm_active_complaint: handleConfirmActiveComplaint,
    select_active_complaint: handleSelectActiveComplaint,
  },
};
