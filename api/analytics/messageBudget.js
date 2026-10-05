// Per-conversation message and AI-call accounting, used for the cost
// analytics: bot messages per booking/complaint, messages saved by fast
// paths, AI calls made and avoided, and an estimated cost per completed
// booking. Counting starts at the customer's first message and survives the
// start of a flow, so the AI call that recognised "book AC tomorrow" is
// charged to the booking it produced.
const costs = require('../config/costs');

const MAX_ENTRIES = 1000;
const counts = new Map();

function trim() {
  while (counts.size > MAX_ENTRIES) counts.delete(counts.keys().next().value);
}

function empty() {
  return {
    customerMessages: 0,
    botMessages: 0,
    templateMessages: 0,
    fieldsExtractedFirstMessage: 0,
    redundantQuestionsAvoided: 0,
    aiCalls: 0,
    aiCallsAvoided: 0,
    fastPathUsed: false,
  };
}

function entry(phone, create = false) {
  if (!phone) return null;
  const key = String(phone);
  if (!counts.has(key) && create) {
    counts.set(key, empty());
    trim();
  }
  return counts.get(key) || null;
}

// Starting a flow resets message counts but keeps AI accounting from the
// message that started it.
function start(phone, { initialCustomerMessages = 1, fieldsExtracted = [] } = {}) {
  const previous = entry(phone) || empty();
  counts.set(String(phone), {
    ...empty(),
    customerMessages: initialCustomerMessages,
    fieldsExtractedFirstMessage: new Set(fieldsExtracted).size,
    aiCalls: previous.aiCalls,
    aiCallsAvoided: previous.aiCallsAvoided,
  });
  trim();
  return get(phone);
}

function increment(phone, field, amount = 1, create = false) {
  const current = entry(phone, create);
  if (!current) return null;
  current[field] += amount;
  return { ...current };
}

function customerMessage(phone) {
  return increment(phone, 'customerMessages');
}

function botMessage(phone, messageType) {
  const result = increment(phone, 'botMessages');
  if (result && messageType === 'template') increment(phone, 'templateMessages');
  return result;
}

function aiCall(phone) {
  return increment(phone, 'aiCalls', 1, true);
}

function aiAvoided(phone) {
  return increment(phone, 'aiCallsAvoided', 1, true);
}

function avoidQuestion(phone, count = 1) {
  return increment(phone, 'redundantQuestionsAvoided', Math.max(0, Number(count) || 0));
}

function markFastPath(phone) {
  const current = entry(phone);
  if (!current) return null;
  current.fastPathUsed = true;
  return { ...current };
}

function get(phone) {
  const current = entry(phone);
  return current ? { ...current } : empty();
}

/** Estimated provider cost of a conversation (configure rates in config/costs.js). */
function estimateCost(value) {
  const sessionMessages = Math.max(0, value.botMessages - value.templateMessages);
  const amount = value.aiCalls * costs.AI_CALL
    + value.templateMessages * costs.TEMPLATE_MESSAGE
    + sessionMessages * costs.SESSION_MESSAGE;
  return Math.round(amount * 1e6) / 1e6;
}

function complete(phone) {
  const value = get(phone);
  counts.delete(String(phone));
  return { ...value, estimatedCost: estimateCost(value), currency: costs.CURRENCY };
}

function reset(phone) {
  if (phone) counts.delete(String(phone));
  else counts.clear();
}

module.exports = {
  start, customerMessage, botMessage, aiCall, aiAvoided, avoidQuestion, markFastPath, get, complete, reset, estimateCost,
};
