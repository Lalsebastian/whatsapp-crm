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
    await whatsapp.sendText(session.phone, 'Sorry, no services are available to book right now. Please try again later or type "support" to talk to our team.');
    return;
  }

  await whatsapp.sendListMessage(
    session.phone,
    'Which service would you like to book?',
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

async function handleSelectService(session, customer, input) {
  if (!input.buttonId || !input.buttonId.startsWith('SVC_')) {
    await whatsapp.sendText(session.phone, 'Please pick a service from the list above.');
    return;
  }
  const serviceId = input.buttonId.replace('SVC_', '');
  const service = await crm.getServiceDetails(serviceId);
  if (!service) {
    await whatsapp.sendText(session.phone, "Sorry, that service isn't available anymore. Please choose another.");
    return startBooking(session, customer);
  }

  const properties = await crm.getCustomerProperties(customer.id);
  const context = { serviceId };

  if (properties.length === 0) {
    await whatsapp.sendText(session.phone, '📍 Which address should we visit? Please type the full address.');
    await sessionStore.setFlow(session.phone, FLOW, 'awaiting_new_property', context);
    return;
  }

  const rows = properties.slice(0, 9).map((p) => ({
    id: `PROP_${p.id}`,
    title: p.label || p.addressLine.slice(0, 24),
    description: p.addressLine.slice(0, 72),
  }));
  rows.push({ id: 'PROP_NEW', title: 'Add a new address', description: 'Enter a different address' });

  await whatsapp.sendListMessage(session.phone, '📍 Which address should we visit?', 'Choose address', [{ title: 'Your Addresses', rows }]);
  await sessionStore.setFlow(session.phone, FLOW, 'select_property', context);
}

async function handleSelectProperty(session, customer, input) {
  if (input.buttonId === 'PROP_NEW') {
    await whatsapp.sendText(session.phone, 'Please type the full address.');
    await sessionStore.setFlow(session.phone, FLOW, 'awaiting_new_property', session.context);
    return;
  }
  if (!input.buttonId || !input.buttonId.startsWith('PROP_')) {
    await whatsapp.sendText(session.phone, 'Please choose an address from the list above.');
    return;
  }
  const propertyId = input.buttonId.replace('PROP_', '');
  await promptForDate(session, { ...session.context, propertyId });
}

async function handleAwaitingNewProperty(session, customer, input) {
  if (!input.text || input.text.trim().length < 5) {
    await whatsapp.sendText(session.phone, 'That address looks too short — please type your full address.');
    return;
  }
  const property = await crm.addProperty(customer.id, { addressLine: input.text.trim() });
  await promptForDate(session, { ...session.context, propertyId: property.id });
}

async function promptForDate(session, context) {
  await whatsapp.sendButtons(session.phone, '📅 When would you like the service? Choose an option or type a date (YYYY-MM-DD).', [
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
    await whatsapp.sendText(session.phone, "I couldn't understand that date. Please type it as YYYY-MM-DD, or tap Today/Tomorrow.");
    return;
  }

  const slots = await crm.getAvailability(session.context.serviceId, date);
  if (!slots || slots.length === 0) {
    await whatsapp.sendText(session.phone, `Sorry, no time slots are available on ${date}. Please try another date.`);
    return;
  }

  await whatsapp.sendListMessage(session.phone, `🕒 Available times on ${date}:`, 'Choose time', [
    { title: 'Available Slots', rows: slots.map((s) => ({ id: `SLOT_${s}`, title: s })) },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'select_slot', { ...session.context, date });
}

async function handleSelectSlot(session, customer, input) {
  if (!input.buttonId || !input.buttonId.startsWith('SLOT_')) {
    await whatsapp.sendText(session.phone, 'Please choose a time slot from the list above.');
    return;
  }
  const time = input.buttonId.replace('SLOT_', '');
  const { serviceId } = session.context;
  const service = await crm.getServiceDetails(serviceId);

  const priceLine = service && service.basePrice ? `\n💰 Price: AED ${service.basePrice}` : '';
  await whatsapp.sendButtons(
    session.phone,
    `Please confirm your booking:\n\n🔧 ${service ? service.name : 'Service'}\n📅 ${session.context.date} at ${time}${priceLine}`,
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
    await whatsapp.sendText(session.phone, 'No problem — booking cancelled. Type "menu" anytime to start again.');
    return;
  }
  if (input.buttonId !== 'CONFIRM_BOOKING') {
    await whatsapp.sendText(session.phone, 'Please tap Confirm or Cancel.');
    return;
  }

  const { serviceId, propertyId, date, time } = session.context;
  if (!serviceId || !propertyId || !date || !time) {
    logger.error('BOOKING', 'Missing required fields at confirm step', session.context);
    await whatsapp.sendText(session.phone, "Something went wrong with your booking details — let's start over.");
    await sessionStore.clearFlow(session.phone);
    return;
  }

  try {
    const booking = await crm.createBooking({ customerId: customer.id, propertyId, serviceId, date, time });
    await sessionStore.clearFlow(session.phone);
    await whatsapp.sendText(
      session.phone,
      `✅ Booking confirmed!\n\nReference: *${booking.reference}*\n📅 ${booking.scheduledDate} at ${booking.scheduledTime}\n\nType "menu" for other options.`
    );
  } catch (err) {
    logger.error('BOOKING', 'createBooking failed:', err.message);
    await whatsapp.sendText(session.phone, "Sorry, we couldn't complete your booking due to a system error. Please try again shortly, or type \"support\" to talk to our team.");
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
