// Admin simulation scenarios for the developer test console (test-chat.html).
//
// A scenario changes how the CRM, the customer profile or the AI behave for
// one test request, so edge cases can be exercised in seconds instead of
// staging them in the CRM. Scenarios only ever apply inside a captured
// test-console request (ENABLE_TEST_CHAT + developer secret); a real WhatsApp
// message can never run under one.
const { AsyncLocalStorage } = require('node:async_hooks');
const testChannel = require('../whatsapp/testChannel');

const SCENARIOS = Object.freeze({
  new_customer: {
    label: 'New customer',
    description: 'A first-time customer with no bookings or complaints (uses a fresh test number).',
    starter: 'hi',
    freshPhone: true,
  },
  returning_customer: {
    label: 'Returning customer',
    description: 'A customer with a completed visit last week, so the menu offers "Book … Again".',
    starter: 'hi',
  },
  service_unavailable: {
    label: 'Service unavailable',
    description: 'Every address is outside the service area and no slots are open.',
    starter: 'I need a plumber tomorrow',
  },
  crm_timeout: {
    label: 'CRM timeout',
    description: 'CRM writes time out, so booking/complaint creation has an uncertain outcome.',
    starter: 'I need a plumber tomorrow',
  },
  ai_low_confidence: {
    label: 'AI low confidence',
    description: 'Free text is understood with low confidence, showing the clarification path.',
    starter: 'something is wrong at home',
  },
  complaint_escalation: {
    label: 'Complaint escalation',
    description: 'A damage complaint that is registered and handed to a human with agent assist.',
    starter: 'The technician damaged my wall during the AC repair',
  },
});

const storage = new AsyncLocalStorage();

function runWithScenario(name, operation) {
  if (!name || !SCENARIOS[name]) return operation();
  return storage.run({ name }, operation);
}

/** The scenario for the current request, or null (always null outside the test console). */
function activeScenario() {
  if (!testChannel.isCapturing()) return null;
  const store = storage.getStore();
  return store ? store.name : null;
}

function describeScenarios() {
  return Object.entries(SCENARIOS).map(([id, scenario]) => ({ id, ...scenario }));
}

module.exports = { SCENARIOS, runWithScenario, activeScenario, describeScenarios };
