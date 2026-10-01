const { profileForService, normalize } = require('./serviceHints');

const ROOM_PRIORITIES = {
  kitchen: ['kitchen_cleaning', 'home_cleaning', 'plumbing', 'electrical', 'appliance_repair', 'pest_control'],
  bathroom: ['bathroom_cleaning', 'home_cleaning', 'plumbing', 'electrical', 'pest_control'],
  bedroom: ['home_cleaning', 'electrical', 'ac', 'pest_control'],
  'living room': ['home_cleaning', 'electrical', 'ac', 'pest_control'],
  'dining room': ['home_cleaning', 'electrical', 'pest_control'],
  balcony: ['home_cleaning', 'pest_control', 'electrical'],
  terrace: ['home_cleaning', 'pest_control', 'electrical'],
  garden: ['pest_control', 'home_cleaning', 'electrical'],
  garage: ['home_cleaning', 'electrical', 'pest_control'],
  office: ['home_cleaning', 'electrical', 'ac', 'pest_control'],
  'entire home': ['home_cleaning', 'pest_control', 'electrical', 'ac'],
};

function catalogKey(service) {
  const text = normalize(`${service && service.name} ${service && service.category}`);
  if (/kitchen.*clean|clean.*kitchen/.test(text)) return 'kitchen_cleaning';
  if (/bathroom.*clean|clean.*bathroom/.test(text)) return 'bathroom_cleaning';
  const profile = profileForService(service);
  return profile ? profile.key : null;
}

function recommendServices(understanding, services, { limit = 5 } = {}) {
  if (!Array.isArray(services)) return [];
  const priorities = ROOM_PRIORITIES[understanding && understanding.room] || [];
  const wantedService = normalize(understanding && understanding.service);
  return services
    .map((service, catalogIndex) => {
      const key = catalogKey(service);
      const roomIndex = priorities.indexOf(key);
      const serviceText = normalize(`${service.name} ${service.category}`);
      const direct = wantedService && (serviceText.includes(wantedService) || wantedService.includes(serviceText));
      const score = direct ? 1000 : (roomIndex >= 0 ? 500 - roomIndex * 25 : 0);
      return { service, score, catalogIndex };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.catalogIndex - right.catalogIndex)
    .slice(0, limit)
    .map((entry) => entry.service);
}

async function recommendServiceableServices(understanding, services, { location, checkServiceability, limit = 5 } = {}) {
  const ranked = recommendServices(understanding, services, { limit: Array.isArray(services) ? services.length : limit });
  if (!location || typeof checkServiceability !== 'function') {
    return { services: ranked.slice(0, limit), serviceabilityFiltered: false, excludedServiceIds: [] };
  }

  const decisions = await Promise.all(ranked.map(async (service) => {
    try {
      const result = await checkServiceability(service.id, location);
      return {
        service,
        serviceable: !result || result.serviceable !== false,
        determined: !!result && result.source !== 'crm_not_configured',
      };
    } catch (_error) {
      // An unavailable serviceability dependency must not falsely hide a CRM service.
      return { service, serviceable: true, determined: false };
    }
  }));
  const excludedServiceIds = decisions.filter((entry) => !entry.serviceable).map((entry) => entry.service.id);
  return {
    services: decisions.filter((entry) => entry.serviceable).map((entry) => entry.service).slice(0, limit),
    serviceabilityFiltered: decisions.some((entry) => entry.determined),
    excludedServiceIds,
  };
}

module.exports = { recommendServices, recommendServiceableServices, catalogKey, ROOM_PRIORITIES };
