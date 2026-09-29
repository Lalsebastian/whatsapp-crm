// Interpretation-only vocabulary. These hints help map natural customer
// language to an existing CRM service; they never create services or supply
// business data such as pricing or availability.
const PROFILES = [
  {
    key: 'plumbing',
    catalogTerms: ['plumbing', 'plumber'],
    hints: ['plumbing', 'plumber', 'pipe', 'tap', 'faucet', 'leak', 'toilet', 'drain', 'sink', 'water line'],
  },
  {
    key: 'electrical',
    catalogTerms: ['electrical', 'electrician'],
    hints: ['electrical', 'electrician', 'light', 'bulb', 'switch', 'socket', 'power', 'wiring', 'breaker'],
  },
  {
    key: 'ac',
    catalogTerms: ['ac', 'air conditioning', 'air conditioner'],
    hints: ['ac', 'air conditioner', 'air conditioning', 'cooling', 'ac leak', 'ac noise'],
  },
  {
    key: 'pest_control',
    catalogTerms: ['pest', 'pest control'],
    hints: ['pest', 'cockroach', 'cockroaches', 'ant', 'ants', 'termite', 'termites', 'bed bug', 'bed bugs', 'insect', 'insects'],
  },
  {
    key: 'home_cleaning',
    catalogTerms: ['cleaning', 'home cleaning', 'house cleaning'],
    hints: ['cleaning', 'deep cleaning', 'house cleaning', 'home cleaning', 'maid'],
  },
];

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function containsTerm(text, term) {
  const normalizedText = ` ${normalize(text)} `;
  const normalizedTerm = normalize(term);
  return normalizedTerm && normalizedText.includes(` ${normalizedTerm} `);
}

function profileForService(service) {
  const catalogText = [service && service.name, service && service.category].filter(Boolean).join(' ');
  return PROFILES.find((profile) => profile.catalogTerms.some((term) => containsTerm(catalogText, term))) || null;
}

function hintsForService(service) {
  const profile = profileForService(service);
  return profile ? profile.hints : [];
}

module.exports = { PROFILES, normalize, containsTerm, profileForService, hintsForService };
