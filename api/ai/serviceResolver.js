const intentService = require('./intentService');
const { PROFILES, normalize, containsTerm, profileForService } = require('./serviceHints');

function exactServiceMatch(text, services) {
  const normalizedText = normalize(text);
  if (!normalizedText) return null;

  const matches = services.filter((service) => {
    const name = normalize(service.name);
    const category = normalize(service.category);
    return (name && (` ${normalizedText} `).includes(` ${name} `))
      || (category && (` ${normalizedText} `).includes(` ${category} `));
  });
  return matches.length === 1 ? matches[0] : null;
}

function semanticHintMatch(text, services) {
  const matchingProfiles = PROFILES.filter((profile) => profile.hints.some((hint) => containsTerm(text, hint)));
  if (matchingProfiles.length !== 1) return null;

  const servicesForProfile = services.filter((service) => {
    const profile = profileForService(service);
    return profile && profile.key === matchingProfiles[0].key;
  });
  return servicesForProfile.length === 1 ? servicesForProfile[0] : null;
}

async function resolveService(text, services, context = {}) {
  if (!text || !Array.isArray(services) || services.length === 0) return null;

  const exact = exactServiceMatch(text, services);
  if (exact) return { service: exact, confidence: 1, source: 'deterministic' };

  const hinted = semanticHintMatch(text, services);
  if (hinted) return { service: hinted, confidence: 0.95, source: 'semantic_hint' };

  const ai = await intentService.matchServiceToCatalog(text, services, context);
  if (!ai.serviceId) return null;
  const service = services.find((item) => String(item.id) === String(ai.serviceId));
  return service ? { service, confidence: ai.confidence, source: 'ai' } : null;
}

module.exports = { resolveService, exactServiceMatch, semanticHintMatch };
