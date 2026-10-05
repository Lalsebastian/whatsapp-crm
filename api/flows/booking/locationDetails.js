// Step "awaiting_location_details": the customer has seen the address we
// geocoded from their pin and either adds building/flat details or accepts
// it as is. Continues to scheduling (booking) or to service suggestions
// (recommendation), depending on where the pin was sent.
const whatsapp = require('../../whatsapp/client');
const { crm, propertyDisplay } = require('./shared');
const { savePinAddress } = require('./locationPin');
const { advanceAfterProperty, handleSelectProperty } = require('./property');
const { promptRecommendedServices } = require('./serviceSelection');

async function handleAwaitingLocationDetails(session, customer, input) {
  const { pendingLocation, ...context } = session.context;
  if (!pendingLocation) {
    // Should not happen; recover by asking for an address normally.
    return handleSelectProperty(session, customer, { buttonId: 'PROP_NEW' });
  }
  if (input.location) {
    // A different pin replaces the suggestion.
    return handleSelectProperty(session, customer, input);
  }
  let details = null;
  if (input.buttonId !== 'USE_PIN_ADDRESS') {
    const text = input.text ? input.text.trim() : '';
    if (text.length < 2) {
      await whatsapp.sendText(session.phone, 'Please reply with your building or villa name and flat/villa number, or tap Use This Address.');
      return;
    }
    details = text;
  }

  const { property, location } = await savePinAddress(customer, pendingLocation, details);
  const nextContext = {
    ...context,
    propertyId: property.id,
    propertyLabel: propertyDisplay(property),
    location,
    ...(pendingLocation.serviceAreaChecked ? { serviceAreaChecked: property.id } : {}),
  };
  if (pendingLocation.purpose === 'recommendation') {
    return promptRecommendedServices(session, customer, await crm.getServices(), nextContext);
  }
  return advanceAfterProperty(session, nextContext);
}

module.exports = { handleAwaitingLocationDetails };
