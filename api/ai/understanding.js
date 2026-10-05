// Cost-aware message understanding.
//
// Gemini is only called when the deterministic layer (intent shortcuts,
// synonym dictionary, date/time/reference extraction) cannot fully explain a
// free-text message. Button taps, known commands, exact service mentions,
// simple dates and clear complaint/booking phrases never reach the model.
//
// Inside an active flow each step parses its own expected input (dates,
// slots, addresses, ratings) and calls a narrow AI task itself when it really
// needs one, so no general intent call is made there at all.
const intentService = require('./intentService');
const { normalizeCustomerMessage } = require('./messageUnderstanding');
const { tokenize, coveredTokenIndexes } = require('./serviceSynonyms');
const AI_CONFIDENCE = require('./confidence');
const logger = require('../utils/logger');
const messageBudget = require('../analytics/messageBudget');
const { activeScenario } = require('../simulation/scenarios');

// Words that carry no information beyond what the rules already extracted.
const FILLER = new Set([
  'i', 'im', 'me', 'my', 'we', 'our', 'us', 'you', 'your', 'a', 'an', 'the', 'is', 'am', 'are', 'was', 'be', 'it', 'its',
  'this', 'that', 'there', 'to', 'for', 'of', 'in', 'on', 'at', 'and', 'or', 'with', 'please', 'pls', 'plz', 'kindly',
  'need', 'needs', 'want', 'wanted', 'would', 'like', 'can', 'could', 'do', 'does', 'get', 'have', 'has', 'some', 'someone',
  'book', 'booking', 'schedule', 'send', 'arrange', 'fix', 'repair', 'service', 'services', 'help', 'urgent', 'urgently',
  'asap', 'now', 'today', 'tomorrow', 'tmrw', 'tmr', 'morning', 'afternoon', 'evening', 'night', 'after', 'before', 'am',
  'pm', 'next', 'week', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'day',
  'not', 'working', 'broken', 'problem', 'issue', 'again', 'same', 'still', 'hi', 'hello', 'hey', 'ok', 'okay', 'thanks',
  'thank', 'venam', 'venum', 'nale', 'naale', 'chahiye', 'karna', 'hai', 'please', 'kitchen', 'bathroom', 'bedroom',
  'room', 'hall', 'home', 'house', 'flat', 'apartment', 'villa', 'my', 'cancel', 'reschedule', 'status', 'where', 'complaint',
  'human', 'agent', 'talk', 'speak', 'support', 'very', 'too', 'just', 'also',
]);

/** Content words the rules could not account for (e.g. a place name or an unusual description). */
function unexplainedWords(text) {
  const tokens = tokenize(text);
  const covered = coveredTokenIndexes(text);
  return tokens.filter((token, index) =>
    !covered.has(index)
    && !FILLER.has(token)
    && !/^\d+$/.test(token)
    && !/^(?:bk|cm)$/.test(token)
    && token.length > 1);
}

function needsModel(rule, text) {
  if (!rule || rule.intent === 'UNKNOWN') return true;
  if (rule.ambiguousService) return false; // the customer will be asked which service; no model needed
  if (rule.confidence < AI_CONFIDENCE.HIGH) return true;
  // Clear commands carry everything needed.
  if (rule.intent !== 'NEW_BOOKING' && rule.intent !== 'COMPLAINT') return false;
  // A booking or complaint message is fully understood when nothing is left
  // over; leftover words may be a location or a detail worth extracting.
  return unexplainedWords(text).length > 0;
}

function phoneFrom(context) {
  return context && context.session && context.session.phone;
}

/**
 * Understanding for free text outside a flow (and voice transcripts).
 * @returns {Promise<object>} normalizeCustomerMessage() shape plus
 *   { aiUsed: boolean, understandingSource: 'rules'|'ai' }
 */
async function understandFreeText(text, context = {}) {
  const session = context.session || {};
  const rule = normalizeCustomerMessage(text, {});
  // Test-console scenario: force the low-confidence path (never for real traffic).
  if (activeScenario() === 'ai_low_confidence') {
    return { ...rule, intent: 'UNKNOWN', confidence: 0.3, aiUsed: false, understandingSource: 'simulation' };
  }
  if (!needsModel(rule, text)) {
    messageBudget.aiAvoided(phoneFrom(context));
    logger.audit('AI_CALL_AVOIDED', {
      phone: session.phone,
      intent: rule.intent,
      confidence: rule.confidence,
      reason: rule.ambiguousService ? 'ambiguous_service_question' : 'rules_sufficient',
      result: 'avoided',
    });
    return { ...rule, aiUsed: false, understandingSource: 'rules' };
  }
  const detected = await intentService.detectIntent(text, {
    currentFlow: session.currentFlow,
    preferredLanguage: session.preferredLanguage,
  });
  const merged = normalizeCustomerMessage(text, detected);
  return {
    ...merged,
    debugReason: detected.debugReason,
    aiUsed: true,
    understandingSource: detected.intent && detected.intent !== 'UNKNOWN' ? 'ai' : 'rules',
  };
}

/** Understanding inside an active flow step: deterministic only. */
function understandInFlow(text, context = {}) {
  messageBudget.aiAvoided(phoneFrom(context));
  return { ...normalizeCustomerMessage(text, {}), aiUsed: false, understandingSource: 'rules' };
}

module.exports = { understandFreeText, understandInFlow, needsModel, unexplainedWords };
