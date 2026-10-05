// Service-area check for a booking address.
//
// Runs before a new address is saved (so out-of-area addresses never land in
// the CRM) and again for a chosen saved address. The CRM decides; the bot
// sends everything it knows about the location: coordinates, PIN/postal
// code, locality, city and state (from geocoding, the WhatsApp pin, or the
// typed text).
//
// When the address is not covered, the customer is told plainly which area
// was checked and asked for another address: a saved one, a shared location,
// or a typed one. A failed CRM read never blocks the booking (the CRM
// validates again when the booking is created).
const whatsapp = require('../../whatsapp/client');
const sessionStore = require('../../session/sessionStore');
const logger = require('../../utils/logger');
const { withFieldDiagnostics } = require('../conversationFields');
const { crm, FLOW } = require('./shared');

// Not "PROP_…": that prefix is reserved for saved-address ids.
const SHOW_SAVED_ADDRESSES = 'SHOW_SAVED_ADDRESSES';
const SHARE_LOCATION_HELP ='To share your location, tap 📎 (attach) → Location → Send your current location, or type the full address (building, flat/villa number, area and PIN code).';

// Indian PIN code: six digits, not starting with 0 ("682 030" allowed).
const RE_PIN_CODE = /\b([1-9]\d{2})\s?(\d{3})\b/;

function pinCodeFromText(text) {
  const match = String(text || '').match(RE_PIN_CODE);
  return match ? `${match[1]}${match[2]}` : null;
}

/**
 * The location sent to crm.checkServiceability.
 * @param {object} input
 * @param {string} [input.address] what the customer typed or the pin's address
 * @param {object} [input.pin] WhatsApp pin / Maps link coordinates
 * @param {object} [input.geocoded] geocoder result
 * @param {string} [input.source]
 */
function locationFacts({ address = null, pin = null, geocoded = null, source = 'typed_address' } = {}) {
  const hasPin = pin && Number.isFinite(pin.latitude) && Number.isFinite(pin.longitude);
  return {
    address: address || (geocoded && geocoded.formattedAddress) || null,
    latitude: hasPin ? pin.latitude : (geocoded && Number.isFinite(geocoded.latitude) ? geocoded.latitude : null),
    longitude: hasPin ? pin.longitude : (geocoded && Number.isFinite(geocoded.longitude) ? geocoded.longitude : null),
    postalCode: pinCodeFromText(address) || (geocoded && geocoded.postalCode) || null,
    areaName: (geocoded && geocoded.area) || null,
    city: (geocoded && geocoded.city) || null,
    state: (geocoded && geocoded.state) || null,
    country: (geocoded && geocoded.country) || null,
    source,
  };
}

function describePlace(facts) {
  const name = [facts.areaName, facts.city].filter(Boolean).filter((value, index, all) => all.indexOf(value) === index).join(', ');
  if (name && facts.postalCode) return `${name} (${facts.postalCode})`;
  return name || (facts.postalCode ? `PIN code ${facts.postalCode}` : null);
}

async function promptOutOfArea(session, context, facts, customerId = session.customerId) {
  const service = context.serviceName || 'this service';
  const place = describePlace(facts || {});
  const intro = place
    ? `Sorry, we don't offer ${service} in ${place} yet.`
    : `Sorry, that address is outside our service area for ${service}.`;
  // Offer saved addresses only when there is one other than the refused one.
  let hasSaved = false;
  try {
    hasSaved = customerId
      ? (await crm.getCustomerProperties(customerId)).some((property) => String(property.id) !== String(context.propertyId))
      : false;
  } catch {
    hasSaved = false;
  }
  await whatsapp.sendButtons(
    session.phone,
    `${intro}\n\nPlease use a different address. ${SHARE_LOCATION_HELP}`,
    [
      ...(hasSaved ? [{ id: SHOW_SAVED_ADDRESSES, title: 'Saved Addresses' }] : []),
      { id: 'MAIN_MENU', title: 'Main Menu' },
    ]
  );
  const { propertyId, propertyLabel, location, pendingLocation, serviceAreaChecked, ...rest } = context;
  await sessionStore.setFlow(session.phone, FLOW, 'awaiting_new_property', withFieldDiagnostics({
    ...rest,
    ambiguousFields: ['property'],
  }));
}

/**
 * @returns {Promise<boolean>} true when the booking may continue with this
 *   location; false when the customer was told it is out of area
 */
async function ensureServiceable(session, context, facts, customerId = session.customerId) {
  if (!context.serviceId || typeof crm.checkServiceability !== 'function') return true;
  let result;
  try {
    result = await crm.checkServiceability(context.serviceId, facts);
  } catch (error) {
    logger.warn('SERVICE_AREA', 'Serviceability check skipped:', error.code || error.message);
    logger.audit('SERVICEABILITY_CHECK_SKIPPED', { phone: session.phone, flow: FLOW, serviceId: context.serviceId, reason: error.code || 'read_failed', result: 'skipped' });
    return true;
  }
  if (!result || result.serviceable !== false) return true;
  logger.audit('LOCATION_NOT_SERVICEABLE', {
    phone: session.phone,
    flow: FLOW,
    serviceId: context.serviceId,
    postalCode: facts.postalCode || null,
    city: facts.city || null,
    area: facts.areaName || null,
    locationSource: facts.source,
    result: 'refused',
  });
  await promptOutOfArea(session, context, facts, customerId);
  return false;
}

module.exports = {
  ensureServiceable,
  promptOutOfArea,
  locationFacts,
  pinCodeFromText,
  describePlace,
  SHARE_LOCATION_HELP,
  SHOW_SAVED_ADDRESSES,
};
