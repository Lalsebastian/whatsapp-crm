// Optional add-on suggestions after a booking ("Kitchen cleaning booked —
// many customers add Pest Control"). Off unless the client wants
// cross-selling (SERVICE_BUNDLES_ENABLED=true).
//
// A suggestion is only made when the CRM catalogue really has the service,
// it is not already part of this booking, and the CRM says it is available
// at the booked address. Override the default pairs with SERVICE_BUNDLES, a
// JSON object of family key -> [family keys], e.g.
// {"home_cleaning": ["pest_control"]}. Family keys are in ai/serviceSynonyms.js.
const logger = require('../../utils/logger');
const { familyForService } = require('../../ai/serviceSynonyms');

const DEFAULT_BUNDLES = {
  home_cleaning: ['pest_control', 'appliance_repair', 'plumbing'],
  ac: ['home_cleaning'],
  plumbing: ['electrical'],
  pest_control: ['home_cleaning'],
  appliance_repair: ['electrical'],
};

const SHORT_LABELS = {
  ac: 'AC Service',
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  appliance_repair: 'Appliance Repair',
  pest_control: 'Pest Control',
  home_cleaning: 'Cleaning',
};

function config() {
  const enabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.SERVICE_BUNDLES_ENABLED || '').toLowerCase());
  let bundles = DEFAULT_BUNDLES;
  if (process.env.SERVICE_BUNDLES) {
    try {
      const parsed = JSON.parse(process.env.SERVICE_BUNDLES);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) bundles = parsed;
    } catch {
      logger.warn('BUNDLES', 'SERVICE_BUNDLES is not valid JSON; using the default pairs');
    }
  }
  return { enabled, bundles };
}

/**
 * @param {object} crm the CRM adapter
 * @param {Array<{serviceId, propertyId}>} bookedItems
 * @returns {Promise<{service: object, shortLabel: string, bookedLabel: string}|null>}
 */
async function suggestAddOn(crm, bookedItems) {
  const { enabled, bundles } = config();
  if (!enabled || !Array.isArray(bookedItems) || bookedItems.length === 0) return null;
  try {
    const catalogue = await crm.getServices();
    const bookedIds = new Set(bookedItems.map((item) => String(item.serviceId)));
    const bookedFamilies = bookedItems
      .map((item) => familyForService(catalogue.find((service) => String(service.id) === String(item.serviceId))))
      .filter(Boolean);
    for (const family of bookedFamilies) {
      for (const suggestedKey of bundles[family.key] || []) {
        const candidate = catalogue.find((service) => {
          const candidateFamily = familyForService(service);
          return candidateFamily && candidateFamily.key === suggestedKey && !bookedIds.has(String(service.id));
        });
        if (!candidate) continue;
        const location = { propertyId: bookedItems[0].propertyId, source: 'saved_property' };
        const serviceability = typeof crm.checkServiceability === 'function'
          ? await crm.checkServiceability(candidate.id, location)
          : { serviceable: true };
        if (serviceability && serviceability.serviceable === false) continue;
        return { service: candidate, shortLabel: SHORT_LABELS[suggestedKey] || candidate.name, bookedLabel: family.label };
      }
    }
  } catch (error) {
    logger.warn('BUNDLES', 'Add-on suggestion skipped:', error.message);
  }
  return null;
}

module.exports = { suggestAddOn, DEFAULT_BUNDLES };
