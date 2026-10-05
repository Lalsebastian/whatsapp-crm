// Interpretation-only vocabulary, derived from the synonym dictionary in
// serviceSynonyms.js. These hints help map natural customer language to an
// existing CRM service; they never create services or supply business data
// such as pricing or availability.
const { SERVICE_FAMILIES, normalize, familyForService } = require('./serviceSynonyms');

const PROFILES = SERVICE_FAMILIES.map((family) => ({
  key: family.key,
  label: family.label,
  catalogTerms: family.catalogTerms,
  hints: family.phrases,
}));

function containsTerm(text, term) {
  const normalizedText = ` ${normalize(text)} `;
  const normalizedTerm = normalize(term);
  return normalizedTerm && normalizedText.includes(` ${normalizedTerm} `);
}

function profileForService(service) {
  const family = familyForService(service);
  return family ? PROFILES.find((profile) => profile.key === family.key) : null;
}

function hintsForService(service) {
  const profile = profileForService(service);
  return profile ? profile.hints : [];
}

module.exports = { PROFILES, normalize, containsTerm, profileForService, hintsForService };
