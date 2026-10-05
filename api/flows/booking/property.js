// Service-address selection: saved properties, typed addresses and WhatsApp
// location pins, followed by the serviceability check.
const whatsapp = require('../../whatsapp/client');
const sessionStore = require('../../session/sessionStore');
const logger = require('../../utils/logger');
const { withFieldDiagnostics } = require('../conversationFields');
const messageBudget = require('../../analytics/messageBudget');
const {
  crm,
  FLOW,
  propertyDisplay,
  propertyName,
  prioritizeProperties,
  noteAvoidedQuestion,
} = require('./shared');
const { promptServiceList } = require('./servicePrompts');
const { promptForDate, showAvailability } = require('./schedule');
const { propertyInput, pinLocation, promptGeocodedPin } = require('./locationPin');

async function promptPropertyList(session, service, context, properties) {
  const { suggestedPropertyId, suggestedPropertyLabel, ...cleanContext } = context;
  const ordered = prioritizeProperties(properties, (session.customerProfile && session.customerProfile.recentBookings) || []);
  const propertyOptions = {};
  const rows = ordered.slice(0, 9).map((property) => {
    propertyOptions[property.id] = propertyDisplay(property);
    return {
      id: `PROP_${property.id}`,
      title: property.label || property.addressLine.slice(0, 24),
      description: [property.addressLine, property.area, property.city].filter(Boolean).join(', ').slice(0, 72),
    };
  });
  rows.push({ id: 'PROP_NEW', title: 'Use Another Address', description: 'Enter a different service address' });
  await whatsapp.sendListMessage(session.phone, `Where would you like the ${service.name} professional to visit?`, 'Choose address', [
    { title: 'Saved Addresses', rows },
  ]);
  await sessionStore.setFlow(session.phone, FLOW, 'select_property', { ...cleanContext, propertyOptions });
}

async function promptPropertyConfirmation(session, service, context, property) {
  const name = propertyName(property);
  await whatsapp.sendButtons(
    session.phone,
    `Certainly. Would you like the ${service.name} service at your ${name} address?`,
    [
      { id: 'CONFIRM_DEFAULT_PROPERTY', title: `Yes, ${name}`.slice(0, 20) },
      { id: 'CHOOSE_ANOTHER_PROPERTY', title: 'Choose Another' },
    ]
  );
  await sessionStore.setFlow(session.phone, FLOW, 'confirm_default_property', {
    ...context,
    suggestedPropertyId: property.id,
    suggestedPropertyLabel: propertyDisplay(property),
  });
  logger.audit('DEFAULT_PROPERTY_OFFERED', {
    phone: session.phone,
    sessionId: session.phone,
    flow: FLOW,
    step: 'confirm_default_property',
    serviceId: service.id,
    propertyId: property.id,
    result: 'offered',
  });
}

async function handleConfirmDefaultProperty(session, customer, input) {
  const service = await crm.getServiceDetails(session.context.serviceId);
  const properties = await crm.getCustomerProperties(customer.id);
  if (!service) return promptServiceList(session, await crm.getServices(), session.context);

  if (input.buttonId === 'CHOOSE_ANOTHER_PROPERTY') {
    return promptPropertyList(session, service, session.context, properties);
  }
  if (input.buttonId !== 'CONFIRM_DEFAULT_PROPERTY') {
    await whatsapp.sendText(session.phone, 'Please confirm the suggested address or choose another address.');
    return;
  }

  const property = properties.find((item) => item.id === session.context.suggestedPropertyId);
  if (!property) {
    await whatsapp.sendText(session.phone, 'That saved address is no longer available. Please choose another address.');
    if (properties.length) return promptPropertyList(session, service, session.context, properties);
    await whatsapp.sendText(session.phone, 'Please send the full service address.');
    return sessionStore.setFlow(session.phone, FLOW, 'awaiting_new_property', session.context);
  }
  logger.audit('DEFAULT_PROPERTY_USED', {
    phone: session.phone,
    customerId: customer.id,
    propertyId: property.id,
    result: 'confirmed',
  });
  return advanceAfterProperty(session, {
    ...session.context,
    propertyId: property.id,
    propertyLabel: propertyDisplay(property),
    suggestedPropertyId: undefined,
    suggestedPropertyLabel: undefined,
  });
}

async function handleSelectProperty(session, customer, input) {
  if (input.buttonId === 'PROP_NEW') {
    await whatsapp.sendText(session.phone, 'Certainly. Please send the full service address.');
    await sessionStore.setFlow(session.phone, FLOW, 'awaiting_new_property', session.context);
    return;
  }
  if (input.location) {
    const address = input.location.address || input.location.label;
    if (!address) {
      // A bare "current location" pin: suggest the geocoded address and ask
      // for unit details; without geocoding, ask for the address as before.
      if (await promptGeocodedPin(session, session.context, input.location, 'booking')) return;
      await whatsapp.sendText(session.phone, 'I received the location pin. Please also send the full address so our technician can locate the property.');
      await sessionStore.setFlow(session.phone, FLOW, 'awaiting_new_property', withFieldDiagnostics({
        ...session.context,
        location: { ...input.location, source: 'whatsapp_location' },
      }));
      return;
    }
    const property = await crm.addProperty(
      customer.id,
      propertyInput(address, input.location, null, input.location.label || undefined)
    );
    return advanceAfterProperty(session, withFieldDiagnostics({
      ...session.context,
      propertyId: property.id,
      propertyLabel: propertyDisplay(property),
      location: pinLocation(property, input.location, address),
    }));
  }
  let propertyId = input.buttonId && input.buttonId.startsWith('PROP_')
    ? input.buttonId.replace('PROP_', '')
    : null;
  if (!propertyId && input.text) {
    const words = input.text.toLowerCase().split(/\W+/).filter((word) => word.length > 2 && !['the', 'my', 'address'].includes(word));
    const matches = Object.entries(session.context.propertyOptions || {}).filter(([, label]) =>
      words.length > 0 && words.every((word) => String(label).toLowerCase().includes(word))
    );
    if (matches.length === 1) propertyId = matches[0][0];
  }
  if (!propertyId && input.text && session.context.correctionMode && input.text.trim().length >= 5) {
    return handleAwaitingNewProperty(session, customer, input);
  }
  if (!propertyId) {
    await whatsapp.sendText(session.phone, 'Please select a saved address or choose Use Another Address.');
    return;
  }
  const properties = await crm.getCustomerProperties(customer.id);
  const property = properties.find((item) => item.id === propertyId);
  if (!property) {
    const service = await crm.getServiceDetails(session.context.serviceId);
    await whatsapp.sendText(session.phone, 'That saved address is no longer available. Please choose another address.');
    if (service && properties.length) return promptPropertyList(session, service, session.context, properties);
    await sessionStore.setFlow(session.phone, FLOW, 'awaiting_new_property', session.context);
    return;
  }
  await advanceAfterProperty(session, {
    ...session.context,
    voiceNotes: input.voice ? [...(session.context.voiceNotes || []), input.voice] : session.context.voiceNotes,
    propertyId,
    propertyLabel: propertyDisplay(property),
    propertyOptions: undefined,
  });
}

async function handleAwaitingNewProperty(session, customer, input) {
  if (input.location) return handleSelectProperty(session, customer, input);
  if (!input.text || input.text.trim().length < 5) {
    await whatsapp.sendText(session.phone, 'Please send the full service address so our technician can locate it.');
    return;
  }
  // A typed address that follows an un-geocoded pin keeps the pin's
  // coordinates, so dispatch can still navigate to the exact spot.
  const earlierPin = session.context.location && session.context.location.source === 'whatsapp_location'
    ? session.context.location
    : null;
  const property = await crm.addProperty(customer.id, propertyInput(input.text.trim(), earlierPin));
  await advanceAfterProperty(session, withFieldDiagnostics({
    ...session.context,
    propertyId: property.id,
    propertyLabel: propertyDisplay(property),
    location: {
      propertyId: property.id,
      label: property.label || null,
      address: property.addressLine,
      latitude: session.context.location && session.context.location.latitude,
      longitude: session.context.location && session.context.location.longitude,
      areaId: null,
      areaName: property.area || null,
      source: session.context.location && session.context.location.source === 'whatsapp_location'
        ? 'whatsapp_location'
        : 'typed_address',
    },
  }));
}

async function advanceAfterProperty(session, context) {
  logger.audit('PROPERTY_SELECTED', {
    phone: session.phone,
    sessionId: session.phone,
    flow: FLOW,
    step: 'select_property',
    serviceId: context.serviceId,
    propertyId: context.propertyId,
    result: 'selected',
  });
  if (typeof crm.checkServiceability === 'function') {
    const serviceability = await crm.checkServiceability(context.serviceId, context.location || {
      propertyId: context.propertyId,
      label: context.propertyLabel,
      source: 'saved_property',
    });
    if (serviceability && serviceability.serviceable === false) {
      await whatsapp.sendText(
        session.phone,
        'That location is currently outside the service area for this service. Please send another address, or type "support" for assistance.'
      );
      await sessionStore.setFlow(session.phone, FLOW, 'awaiting_new_property', withFieldDiagnostics({
        ...context,
        propertyId: undefined,
        propertyLabel: undefined,
        ambiguousFields: ['property'],
      }));
      return;
    }
  }
  if (context.date) {
    const datedContext = noteAvoidedQuestion(session, context, 'date', 'date_extracted');
    if ((datedContext.firstMessageFields || []).length >= 3) messageBudget.markFastPath(session.phone);
    return showAvailability(session, datedContext, datedContext.date);
  }
  await promptForDate(session, context);
}

module.exports = {
  promptPropertyList,
  promptPropertyConfirmation,
  handleConfirmDefaultProperty,
  handleSelectProperty,
  handleAwaitingNewProperty,
  advanceAfterProperty,
};
