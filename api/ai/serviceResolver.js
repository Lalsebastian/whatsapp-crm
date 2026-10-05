const intentService = require('./intentService');
const { normalize, profileForService } = require('./serviceHints');
const { rankFamilies, clearFamily } = require('./serviceSynonyms');

// `namesOnly` ignores category words: "clean the ac" contains the category
// "ac" but is still ambiguous between AC and Cleaning.
function exactServiceMatch(text, services, { namesOnly = false } = {}) {
  const normalizedText = normalize(text);
  if (!normalizedText) return null;

  const matches = services.filter((service) => {
    const name = normalize(service.name);
    const category = normalize(service.category);
    return (name && (` ${normalizedText} `).includes(` ${name} `))
      || (!namesOnly && category && (` ${normalizedText} `).includes(` ${category} `));
  });
  return matches.length === 1 ? matches[0] : null;
}

function servicesForFamily(services, familyKey) {
  return services.filter((service) => {
    const profile = profileForService(service);
    return profile && profile.key === familyKey;
  });
}

// Synonym-dictionary match: only when the message clearly points at one
// family and the catalogue has exactly one service for it.
function semanticHintMatch(text, services) {
  const family = clearFamily(text);
  if (!family) return null;
  const candidates = servicesForFamily(services, family.key);
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Up to `limit` catalogue services the message plausibly refers to, best
 * first. Used for "It sounds like Plumbing or Electrical — which one?"
 * instead of a generic "I didn't understand".
 */
function rankServiceCandidates(text, services, limit = 3) {
  const ranked = [];
  for (const family of rankFamilies(text)) {
    for (const service of servicesForFamily(services, family.key)) {
      if (!ranked.some((item) => item.id === service.id)) ranked.push(service);
    }
  }
  return ranked.slice(0, limit);
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

module.exports = { resolveService, exactServiceMatch, semanticHintMatch, rankServiceCandidates };
