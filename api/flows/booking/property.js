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
const { reverseGeocode, geocodeAddress } = require('../../geo/geocoder');
const {
  ensureServiceable,
  locationFacts,
  pinCodeFromText,
  SHARE_LOCATION_HELP,
  SHOW_SAVED_ADDRESSES,
} = require('./serviceArea');

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


// Free text that is clearly an address rather than a reply to the list.
const RE_ADDRESS_WORD = /\b(?:villa|flat|apt|apartment|building|bldg|tower|floor|street|st|road|rd|block|house|plot|near|opposite|behind|area|community|lane|nagar|colony|layout|cross|main|sector|phase|jvc|jlt|marina)\b/i;
function looksLikeAddress(text) {
  const value = String(text || '').trim();
  return value.length >= 10 && (/\d/.test(value) || RE_ADDRESS_WORD.test(value)) && /[a-z]{3,}/i.test(value);
}

async function explainUnreadableLink(session, input) {
  const place = input.mapsLink && input.mapsLink.placeName;
  await whatsapp.sendText(
    session.phone,
    place
      ? `Thanks. That link shows "${place}" but not an exact point, so I can't use it as the address on its own. ${SHARE_LOCATION_HELP}`
      : `Sorry, I couldn't read a location from that link. ${SHARE_LOCATION_HELP}`
  );
  logger.audit('MAPS_LINK_UNREADABLE', { phone: session.phone, flow: FLOW, step: session.currentStep, placeNameOnly: !!place, result: 'asked_again' });
}

async function showSavedAddresses(session, customer) {
  const [service, properties] = await Promise.all([
    crm.getServiceDetails(session.context.serviceId),
    crm.getCustomerProperties(customer.id),
  ]);
  if (service && properties.length) return promptPropertyList(session, service, session.context, properties);
  await whatsapp.sendText(session.phone, `You don't have another saved address yet. ${SHARE_LOCATION_HELP}`);
  await sessionStore.setFlow(session.phone, FLOW, 'awaiting_new_property', session.context);
}

// A WhatsApp location pin or a Maps link. The area is checked first, so an
// out-of-area pin is never saved and the customer is not asked for flat
// details they don't need.
async function handleSharedLocation(session, customer, pin) {
  const geocoded = await reverseGeocode(pin);
  const address = pin.address || pin.label || null;
  const facts = locationFacts({ address, pin, geocoded, source: pin.via || 'whatsapp_location' });
  if (!(await ensureServiceable(session, session.context, facts, customer.id))) return;

  if (!address) {
    // A bare "current location" pin: suggest the geocoded address and ask
    // for unit details; without geocoding, ask for the address as text.
    if (await promptGeocodedPin(session, session.context, pin, 'booking', geocoded)) return;
    await whatsapp.sendText(session.phone, 'Thanks, I have your location pin, so our technician can navigate to it. Please reply with the building or villa name, flat/villa number and area.');
    await sessionStore.setFlow(session.phone, FLOW, 'awaiting_new_property', withFieldDiagnostics({
      ...session.context,
      location: { ...pin, source: 'whatsapp_location' },
      locationFacts: facts,
    }));
    return;
  }
  const property = await crm.addProperty(customer.id, propertyInput(address, pin, geocoded, pin.label || undefined));
  return advanceAfterProperty(session, withFieldDiagnostics({
    ...session.context,
    propertyId: property.id,
    propertyLabel: propertyDisplay(property),
    location: { ...pinLocation(property, pin, address), ...placeFields(facts) },
    serviceAreaChecked: property.id,
  }));
}

function placeFields(facts) {
  return { postalCode: facts.postalCode, city: facts.city, state: facts.state };
}

async function handleSelectProperty(session, customer, input) {
  if (input.mapsLink) return explainUnreadableLink(session, input);
  if (input.buttonId === SHOW_SAVED_ADDRESSES) return showSavedAddresses(session, customer);
  if (input.buttonId === 'PROP_NEW') {
    await whatsapp.sendText(session.phone, `Certainly. Please send the full service address. ${SHARE_LOCATION_HELP}`);
    await sessionStore.setFlow(session.phone, FLOW, 'awaiting_new_property', session.context);
    return;
  }
  if (input.location) return handleSharedLocation(session, customer, input.location);
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
  // A new address typed instead of picking from the list.
  if (!propertyId && looksLikeAddress(input.text)) {
    return handleAwaitingNewProperty(session, customer, input);
  }
  if (!propertyId) {
    await whatsapp.sendText(session.phone, `Please tap Choose address to pick a saved address, or send the new address. ${SHARE_LOCATION_HELP}`);
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
  if (input.location || input.mapsLink || input.buttonId) return handleSelectProperty(session, customer, input);
  if (!input.text || input.text.trim().length < 5) {
    await whatsapp.sendText(session.phone, `Please send the full service address so our technician can locate it. ${SHARE_LOCATION_HELP}`);
    return;
  }
  const text = input.text.trim();
  // A typed address that follows an un-geocoded pin keeps the pin's
  // coordinates, so dispatch can still navigate to the exact spot.
  const earlierPin = session.context.location && session.context.location.source === 'whatsapp_location'
    ? session.context.location
    : null;
  // The typed text is looked up only to find its PIN code/locality for the
  // area check; its approximate coordinates are never saved as the address.
  const geocoded = earlierPin ? null : await geocodeAddress(text);
  const facts = earlierPin && session.context.locationFacts
    ? { ...session.context.locationFacts, address: text, postalCode: pinCodeFromText(text) || session.context.locationFacts.postalCode }
    : locationFacts({ address: text, pin: earlierPin, geocoded, source: earlierPin ? 'whatsapp_location' : 'typed_address' });
  if (!(await ensureServiceable(session, session.context, facts, customer.id))) return;

  const property = await crm.addProperty(customer.id, {
    ...propertyInput(text, earlierPin),
    ...(facts.areaName ? { area: facts.areaName } : {}),
    ...(facts.city ? { city: facts.city } : {}),
    ...(facts.postalCode ? { postalCode: facts.postalCode } : {}),
    ...(facts.state ? { state: facts.state } : {}),
  });
  const { locationFacts: _facts, ...context } = session.context;
  await advanceAfterProperty(session, withFieldDiagnostics({
    ...context,
    propertyId: property.id,
    propertyLabel: propertyDisplay(property),
    serviceAreaChecked: property.id,
    location: {
      propertyId: property.id,
      label: property.label || null,
      address: property.addressLine,
      latitude: earlierPin ? earlierPin.latitude : null,
      longitude: earlierPin ? earlierPin.longitude : null,
      areaId: null,
      areaName: property.area || facts.areaName || null,
      ...placeFields(facts),
      source: earlierPin ? 'whatsapp_location' : 'typed_address',
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
  // New addresses were checked before they were saved; saved ones are
  // checked here (the CRM may have changed its coverage since).
  if (context.serviceAreaChecked !== context.propertyId) {
    const facts = context.location || { propertyId: context.propertyId, address: context.propertyLabel, source: 'saved_property' };
    if (!(await ensureServiceable(session, context, facts))) return;
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
