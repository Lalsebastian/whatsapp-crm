// How customers actually describe problems, mapped to service families.
//
// This is data, not logic: add phrases here as real conversations show new
// wording (English, Manglish, Hinglish). It is used to understand messages
// without an AI call, to rank likely services when a message is ambiguous,
// and as vocabulary in AI prompts. It never creates services: a family only
// matters if the CRM catalogue has a service whose name/category matches one
// of its catalogTerms.
//
// Matching is phrase-based and longest-match-wins: "ac leaking" counts for AC
// and suppresses the shorter "leaking" (plumbing) inside it.
const SERVICE_FAMILIES = [
  {
    key: 'plumbing',
    label: 'Plumbing',
    catalogTerms: ['plumbing', 'plumber'],
    phrases: [
      'plumbing', 'plumber', 'pipe', 'pipes', 'pipe burst', 'tap', 'taps', 'faucet', 'leak', 'leaking', 'leakage',
      'water leak', 'water leaking', 'dripping tap', 'dripping', 'water dripping', 'seepage', 'damp wall', 'wet wall', 'toilet', 'toilet flush', 'flush not working', 'commode',
      'drain', 'drain blocked', 'blocked drain', 'clogged', 'blocked sink', 'sink', 'basin', 'shower',
      'no water', 'low water pressure', 'water pressure', 'water heater', 'geyser', 'water tank', 'water line',
      'paani leak', 'vellam leak', 'vellam pokunnilla', 'pipe potti', 'nal kharab',
    ],
  },
  {
    key: 'electrical',
    label: 'Electrical',
    catalogTerms: ['electrical', 'electrician'],
    phrases: [
      'electrical', 'electrician', 'electric', 'current problem', 'no current', 'current illa', 'current poyi',
      'power cut', 'no power', 'power problem', 'power', 'light', 'lights', 'light not working', 'bulb', 'tube light',
      'fan not working', 'ceiling fan', 'switch', 'switchboard', 'socket', 'plug point', 'short circuit',
      'tripping', 'keeps tripping', 'breaker', 'mcb', 'db box', 'wiring', 'light poyi', 'bijli', 'bijli nahi',
    ],
  },
  {
    key: 'ac',
    label: 'AC Service & Repair',
    catalogTerms: ['ac', 'air conditioning', 'air conditioner'],
    phrases: [
      'ac', 'a/c', 'aircon', 'air conditioner', 'air conditioning', 'split ac', 'window ac', 'ac not cooling',
      'ac not working', 'ac leaking', 'ac water leaking', 'ac water dripping', 'ac dripping', 'ac noise', 'ac smell', 'ac service',
      'ac gas', 'ac gas refill', 'ac cleaning', 'ac remote', 'cooling problem', 'not cooling',
    ],
  },
  {
    key: 'appliance_repair',
    label: 'Appliance Repair',
    catalogTerms: ['appliance', 'appliance repair', 'fridge repair', 'refrigerator repair'],
    phrases: [
      'appliance', 'appliances', 'washing machine', 'washing machine not spinning', 'washer', 'dryer',
      'fridge', 'fridge not cooling', 'refrigerator', 'freezer', 'dishwasher', 'oven', 'microwave', 'cooker',
      'stove', 'hob', 'water dispenser', 'tv repair',
    ],
  },
  {
    key: 'pest_control',
    label: 'Pest Control',
    catalogTerms: ['pest', 'pest control'],
    phrases: [
      'pest', 'pests', 'pest control', 'cockroach', 'cockroaches', 'roach', 'roaches', 'ant', 'ants', 'termite',
      'termites', 'bed bug', 'bed bugs', 'bedbugs', 'insect', 'insects', 'mosquito', 'mosquitoes', 'rat', 'rats',
      'mice', 'rodent', 'rodents', 'lizard', 'lizards', 'pattikal',
    ],
  },
  {
    key: 'home_cleaning',
    label: 'Cleaning',
    catalogTerms: ['cleaning', 'home cleaning', 'house cleaning', 'deep cleaning'],
    phrases: [
      'cleaning', 'clean', 'cleaner', 'dirty', 'deep cleaning', 'deep clean', 'house cleaning', 'home cleaning',
      'kitchen cleaning', 'bathroom cleaning', 'sofa cleaning', 'carpet cleaning', 'move in cleaning',
      'move out cleaning', 'maid', 'housekeeping',
    ],
  },
];

// Phrases that mean "this is a safety situation, get a human now" whatever
// else the message says. Checked before any booking logic.
const URGENT_PHRASES = [
  { reason: 'immediate_safety_concern', phrases: ['gas smell', 'smell of gas', 'smelling gas', 'smells like gas', 'gas leak', 'gas leaking', 'gas cylinder leak'] },
  { reason: 'electrical_safety_concern', phrases: ['sparking', 'sparks', 'burning smell', 'smoke from', 'electric shock', 'got a shock', 'live wire', 'wire burning'] },
  { reason: 'flooding_safety_concern', phrases: ['flooding', 'flooded', 'burst pipe', 'pipe burst and flooding', 'water everywhere'] },
];

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/a\/c/g, 'ac')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenize(value) {
  const text = normalize(value);
  return text ? text.split(' ') : [];
}

// De-duplicated after normalisation ("a/c" and "ac" are the same phrase), so
// spelling variants never count twice.
const PHRASE_INDEX = [...new Map(SERVICE_FAMILIES.flatMap((family) =>
  family.phrases.map((phrase) => {
    const tokens = tokenize(phrase);
    return [`${family.key}:${tokens.join(' ')}`, { family: family.key, tokens }];
  })
)).values()].filter((entry) => entry.tokens.length > 0);

// All phrase occurrences as token spans, with spans contained in a longer
// match (from any family) removed.
function phraseMatches(text) {
  const tokens = tokenize(text);
  const matches = [];
  for (const entry of PHRASE_INDEX) {
    const length = entry.tokens.length;
    for (let start = 0; start + length <= tokens.length; start += 1) {
      let same = true;
      for (let offset = 0; offset < length; offset += 1) {
        if (tokens[start + offset] !== entry.tokens[offset]) { same = false; break; }
      }
      if (same) matches.push({ family: entry.family, start, end: start + length, length });
    }
  }
  return matches.filter((match) => !matches.some((other) =>
    other !== match && other.length > match.length && other.start <= match.start && other.end >= match.end
  ));
}

/**
 * Service families a message points to, best first.
 * @returns {Array<{key: string, label: string, score: number}>}
 */
function rankFamilies(text) {
  const scores = new Map();
  for (const match of phraseMatches(text)) {
    scores.set(match.family, (scores.get(match.family) || 0) + match.length);
  }
  return [...scores.entries()]
    .map(([key, score]) => {
      const family = SERVICE_FAMILIES.find((item) => item.key === key);
      return { key, label: family.label, score };
    })
    .sort((left, right) => right.score - left.score);
}

/** The single clear family, or null when none or more than one is plausible. */
function clearFamily(text) {
  const [first, second] = rankFamilies(text);
  if (!first) return null;
  if (second && second.score >= first.score) return null;
  return first;
}

/** Tokens covered by a service phrase (used to judge whether a message is fully explained). */
function coveredTokenIndexes(text) {
  const covered = new Set();
  for (const match of phraseMatches(text)) {
    for (let index = match.start; index < match.end; index += 1) covered.add(index);
  }
  return covered;
}

function urgentReason(text) {
  const normalized = ` ${normalize(text)} `;
  for (const group of URGENT_PHRASES) {
    if (group.phrases.some((phrase) => normalized.includes(` ${normalize(phrase)} `))) return group.reason;
  }
  return null;
}

function familyForService(service) {
  const catalog = ` ${normalize([service && service.name, service && service.category].filter(Boolean).join(' '))} `;
  return SERVICE_FAMILIES.find((family) => family.catalogTerms.some((term) => catalog.includes(` ${normalize(term)} `))) || null;
}

module.exports = {
  SERVICE_FAMILIES,
  URGENT_PHRASES,
  normalize,
  tokenize,
  rankFamilies,
  clearFamily,
  coveredTokenIndexes,
  urgentReason,
  familyForService,
};
