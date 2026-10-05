// WhatsApp location pins: reverse-geocode the pin, show the customer the
// address we found, and ask for the building/flat details a technician needs.
// The pin's coordinates are saved with the property so dispatch can navigate
// to it.
const whatsapp = require('../../whatsapp/client');
const sessionStore = require('../../session/sessionStore');
const logger = require('../../utils/logger');
const { reverseGeocode } = require('../../geo/geocoder');
const { withFieldDiagnostics } = require('../conversationFields');
const { crm, FLOW } = require('./shared');

// Property payload for addProperty. Coordinates and geocoded parts are only
// included when present, so a typed address keeps the plain { addressLine }.
function propertyInput(addressLine, pin = null, geocoded = null, label = undefined) {
  const input = { addressLine };
  if (label) input.label = label;
  if (geocoded && geocoded.area) input.area = geocoded.area;
  if (geocoded && geocoded.city) input.city = geocoded.city;
  if (pin && Number.isFinite(pin.latitude) && Number.isFinite(pin.longitude)) {
    input.latitude = pin.latitude;
    input.longitude = pin.longitude;
    input.locationSource = 'whatsapp_location';
    if (geocoded && geocoded.placeId) input.placeId = geocoded.placeId;
  }
  return input;
}

// Booking-context location object for a property created from a pin.
function pinLocation(property, pin, address) {
  return {
    propertyId: property.id,
    label: (pin && pin.label) || property.label || null,
    address,
    latitude: pin ? pin.latitude : null,
    longitude: pin ? pin.longitude : null,
    areaId: null,
    areaName: property.area || null,
    source: 'whatsapp_location',
  };
}

/**
 * Geocodes a pin that arrived without an address and, when it resolves,
 * asks the customer to confirm it and add unit details.
 * @param {'booking'|'recommendation'} purpose where to continue afterwards
 * @returns {Promise<boolean>} true when the prompt was sent
 */
async function promptGeocodedPin(session, context, pin, purpose) {
  const geocoded = await reverseGeocode(pin);
  if (!geocoded) return false;
  await whatsapp.sendButtons(
    session.phone,
    `Thanks, I found this location:\n📍 ${geocoded.formattedAddress}\n\nPlease reply with your building or villa name and flat/villa number so our technician can find you. If this address is already complete, tap Use This Address.`,
    [{ id: 'USE_PIN_ADDRESS', title: 'Use This Address' }]
  );
  await sessionStore.setFlow(session.phone, FLOW, 'awaiting_location_details', withFieldDiagnostics({
    ...context,
    pendingLocation: {
      latitude: pin.latitude,
      longitude: pin.longitude,
      label: pin.label || null,
      formattedAddress: geocoded.formattedAddress,
      area: geocoded.area || null,
      city: geocoded.city || null,
      placeId: geocoded.placeId || null,
      purpose,
    },
  }));
  logger.audit('LOCATION_PIN_ADDRESS_SUGGESTED', {
    phone: session.phone,
    flow: FLOW,
    step: 'awaiting_location_details',
    provider: geocoded.provider,
    purpose,
    result: 'suggested',
  });
  return true;
}

/**
 * Saves the confirmed pin address. `details` is the customer's building/flat
 * text, or null when they accepted the geocoded address as is.
 * @returns {Promise<{property: object, location: object}>}
 */
async function savePinAddress(customer, pending, details) {
  const addressLine = details
    ? `${details.trim()}, ${pending.formattedAddress}`
    : pending.formattedAddress;
  const geocoded = { area: pending.area, city: pending.city, placeId: pending.placeId };
  const property = await crm.addProperty(
    customer.id,
    propertyInput(addressLine, pending, geocoded, pending.label || undefined)
  );
  return { property, location: pinLocation(property, pending, addressLine) };
}

module.exports = { propertyInput, pinLocation, promptGeocodedPin, savePinAddress };
