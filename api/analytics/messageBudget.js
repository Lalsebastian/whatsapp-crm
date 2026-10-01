const MAX_ENTRIES = 1000;
const counts = new Map();

function trim() {
  while (counts.size > MAX_ENTRIES) counts.delete(counts.keys().next().value);
}

function empty() {
  return {
    customerMessages: 0,
    botMessages: 0,
    fieldsExtractedFirstMessage: 0,
    redundantQuestionsAvoided: 0,
    fastPathUsed: false,
  };
}

function start(phone, { initialCustomerMessages = 1, fieldsExtracted = [] } = {}) {
  const key = String(phone);
  counts.set(key, {
    ...empty(),
    customerMessages: initialCustomerMessages,
    fieldsExtractedFirstMessage: new Set(fieldsExtracted).size,
  });
  trim();
  return get(phone);
}

function increment(phone, field) {
  const key = String(phone);
  const current = counts.get(key);
  if (!current) return null;
  current[field] += 1;
  return { ...current };
}

function customerMessage(phone) {
  return increment(phone, 'customerMessages');
}

function botMessage(phone) {
  return increment(phone, 'botMessages');
}

function avoidQuestion(phone, count = 1) {
  const key = String(phone);
  const current = counts.get(key);
  if (!current) return null;
  current.redundantQuestionsAvoided += Math.max(0, Number(count) || 0);
  return { ...current };
}

function markFastPath(phone) {
  const current = counts.get(String(phone));
  if (!current) return null;
  current.fastPathUsed = true;
  return { ...current };
}

function get(phone) {
  const current = counts.get(String(phone));
  return current ? { ...current } : empty();
}

function complete(phone) {
  const value = get(phone);
  counts.delete(String(phone));
  return value;
}

function reset(phone) {
  if (phone) counts.delete(String(phone));
  else counts.clear();
}

module.exports = { start, customerMessage, botMessage, avoidQuestion, markFastPath, get, complete, reset };
