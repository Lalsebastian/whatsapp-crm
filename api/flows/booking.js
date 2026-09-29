// Booking flow: select_service -> select_property -> select_date -> select_slot -> confirm.
// The AI layer never touches any of this — it only ever gets us to `startBooking`;
// every field below is collected from the customer and validated here before the
// single crm.createBooking() call at the very end.
const whatsapp = require('../whatsapp/client');
const sessionStore = require('../session/sessionStore');
const logger = require('../utils/logger');
const { parseDateInput } = require('./dateUtils');
const { getCrmAdapter } = require('../crm');

const crm = getCrmAdapter();
const FLOW = 'booking';

async function startBooking(session, customer) {
  const services = await crm.getServices();
  if (!services || services.length === 0) {
    await whatsapp.sendText(session.phone, "I'm sorry, our services are not available for booking right now. Please try again shortly, or type \"support\" to speak with our team.");
    return;
  }

  await whatsapp.sendListMessage(
    session.phone,
    'Certainly. Which service would you like to book?',
    'Choose service',
    [
      {
        title: 'Services',
        rows: services.slice(0, 10).map((s) => ({
          id: `SVC_${s.id}`,
          title: s.name,
          description: s.basePrice ? `From AED ${s.basePrice}` : (s.description || ''),
        })),
      },
    ]
  );
  await sessionStore.setFlow(session.phone, FLOW, 'select_service', {});
}

// Being inside this step shouldn't mean only button taps work — a customer
// typing "ac service" or "enik ac service venam" instead of tapping the list
// should still land on the right service. Whole-word category match first
// (reliable for short codes like "ac"), then a same-language name substring.
async function matchServiceByText(text, services) {
  const lower = text.toLowerCase();
  const byCategory = services.filter((s) => s.category && new RegExp(`\\b${s.category}\\b`, 'i').test(lower));
  if (byCategory.length === 1) return byCategory[0];

  const byName = services.filter((s) => lower.includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(lower));
  if (byName.length === 1) return byName[0];

  return null;
}

async function handleSelectService(session, customer, input) {
  let service = null;

  if (input.buttonId && input.buttonId.startsWith('SVC_')) {
    service = await crm.getServiceDetails(input.buttonId.replace('SVC_', ''));
  } else if (input.text) {
    const services = await crm.getServices();
    service = await matchServiceByText(input.text, services);
  }

  if (!service) {
    if (input.buttonId) {
      await whatsapp.sendText(session.phone, "I'm sorry, that service is no longer available. Please select another service from the list.");
    } else {
      await whatsapp.sendText(session.phone, "I couldn't identify the service from your message. Please select the service you need from the list below.");
    }
    return startBooking(session, customer);
  }

  const properties = await crm.getCustomerProperties(customer.id);
  const context = { serviceId: service.id };

  if (properties.length === 0) {
    await whatsapp.sendText(session.phone, '📍 Thank you. Please send the full address where you need the service.');
    await sessionStore.setFlow(session.phone, FLOW, 'awaiting_new_property', context);
    return;
  }

  const rows = properties.slice(0, 9).map((p) => ({
    id: `PROP_${p.id}`,
    title: p.label || p.addressLine.slice(0, 24),
    description: p.addressLine.slice(0, 72),
  }));
  rows.push({ id: 'PROP_NEW', title: 'Add a new address', description: 'Enter a different address' });

  await whatsapp.sendListMessage(session.phone, '📍 Please select the address where you need the service.', 'Choose address', [{ title: 'Your Addresses', rows }]);
  await sessionStore.setFlow(session.phone, FLOW, 'select_property', context);
}

async function handleSelectProperty(session, customer, input) {
  if (input.buttonId === 'PROP_NEW') {
    await whatsapp.sendText(session.phone, 'Certainly. Please send the full service address.');
    await sessionStore.setFlow(session.phone, FLOW, 'awaiting_new_property', session.context);
    return;
  }
  if (!input.buttonId || !input.buttonId.startsWith('PROP_')) {
    await whatsapp.sendText(session.phone, 'Please select an address from the list above, or select "Add a new address".');
    return;
  }
  const propertyId = input.buttonId.replace('PROP_', '');
  await promptForDate(session, { ...session.context, propertyId });
}

async function handleAwaitingNewProperty(session, customer, input) {
  if (!input.text || input.text.trim().length < 5) {
    await whatsapp.sendText(session.phone, 'Please send the full service address so our technician can locate it.');
    return;
  }
  const property = await crm.addProperty(customer.id, { addressLine: input.text.trim() });
  await promptForDate(session, { ...session.context, propertyId: property.id });
}

async function promptForDate(session, context) {
  await whatsapp.sendButtons(session.phone, '📅 What date would you prefer? Select an option below, or enter a date in YYYY-MM-DD format.', [
    { id: 'DATE_TODAY', title: 'Today' },
    { id: 'DATE_TOMORROW', title: 'Tomorrow' },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'select_date', context);
}

async function handleSelectDate(session, customer, input) {
  let date = null;
  if (input.buttonId === 'DATE_TODAY') date = parseDateInput('today');
  else if (input.buttonId === 'DATE_TOMORROW') date = parseDateInput('tomorrow');
  else if (input.text) date = parseDateInput(input.text);

  if (!date) {
    await whatsapp.sendText(session.phone, "I couldn't identify that date. Please enter it in YYYY-MM-DD format, or select Today or Tomorrow.");
    return;
  }

  const slots = await crm.getAvailability(session.context.serviceId, date);
  if (!slots || slots.length === 0) {
    await whatsapp.sendText(session.phone, `I'm sorry, we don't have any available times on ${date}. Please select another date.`);
    return;
  }

  await whatsapp.sendListMessage(session.phone, `🕒 These times are available on ${date}:`, 'Choose time', [
    { title: 'Available Slots', rows: slots.map((s) => ({ id: `SLOT_${s}`, title: s })) },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'select_slot', { ...session.context, date });
}

async function handleSelectSlot(session, customer, input) {
  if (!input.buttonId || !input.buttonId.startsWith('SLOT_')) {
    await whatsapp.sendText(session.phone, 'Please select one of the available times from the list above.');
    return;
  }
  const time = input.buttonId.replace('SLOT_', '');
  const { serviceId } = session.context;
  const service = await crm.getServiceDetails(serviceId);

  const priceLine = service && service.basePrice ? `\n💰 Price: AED ${service.basePrice}` : '';
  await whatsapp.sendButtons(
    session.phone,
    `Please review your booking details:\n\n🔧 ${service ? service.name : 'Service'}\n📅 ${session.context.date} at ${time}${priceLine}`,
    [
      { id: 'CONFIRM_BOOKING', title: '✓ Confirm' },
      { id: 'CANCEL_FLOW', title: '✗ Cancel' },
    ]
  );
  await sessionStore.setFlow(session.phone, FLOW, 'confirm', { ...session.context, time });
}

async function handleConfirm(session, customer, input) {
  if (input.buttonId === 'CANCEL_FLOW') {
    await sessionStore.clearFlow(session.phone);
    await whatsapp.sendText(session.phone, 'Certainly. Your booking request has been cancelled. Type "menu" whenever you would like to start again.');
    return;
  }
  if (input.buttonId !== 'CONFIRM_BOOKING') {
    await whatsapp.sendText(session.phone, 'Please select Confirm or Cancel to continue.');
    return;
  }

  const { serviceId, propertyId, date, time } = session.context;
  if (!serviceId || !propertyId || !date || !time) {
    logger.error('BOOKING', 'Missing required fields at confirm step', session.context);
    await whatsapp.sendText(session.phone, 'I\'m sorry, some booking details are missing, so I could not complete the request. Please type "menu" to start again.');
    await sessionStore.clearFlow(session.phone);
    return;
  }

  try {
    const booking = await crm.createBooking({ customerId: customer.id, propertyId, serviceId, date, time });
    await sessionStore.clearFlow(session.phone);
    await whatsapp.sendText(
      session.phone,
      `✅ Your booking has been confirmed successfully.\n\nReference: *${booking.reference}*\n📅 ${booking.scheduledDate} at ${booking.scheduledTime}\n\nIf you need anything else, type "menu".`
    );
  } catch (err) {
    logger.error('BOOKING', 'createBooking failed:', err.message);
    await whatsapp.sendText(session.phone, "I'm sorry, I couldn't confirm your booking because of a system error. Please try again shortly, or type \"support\" to speak with our team.");
  }
}

module.exports = {
  startBooking,
  steps: {
    select_service: handleSelectService,
    select_property: handleSelectProperty,
    awaiting_new_property: handleAwaitingNewProperty,
    select_date: handleSelectDate,
    select_slot: handleSelectSlot,
    confirm: handleConfirm,
  },
};
