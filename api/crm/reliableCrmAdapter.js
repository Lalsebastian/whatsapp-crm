const reliability = require('../config/reliability');
const logger = require('../utils/logger');
const { withTimeout, retry, isTransientError, OperationTimeoutError } = require('../reliability/asyncPolicy');
const { activeScenario } = require('../simulation/scenarios');
const { CircuitBreaker } = require('../reliability/circuitBreaker');

const READ_METHODS = new Set([
  'findCustomerByPhone',
  'getCustomerById',
  'getCustomerProperties',
  'getCustomerPreferences',
  'getServices',
  'getServiceDetails',
  'checkServiceability',
  'getAvailability',
  'getAvailabilityRange',
  'getBookings',
  'getBookingStatus',
  'getBookingById',
  'getComplaintStatus',
  'getOpenComplaintForBooking',
  'getActiveComplaints',
  'getFeedbackForBooking',
]);

const WRITE_METHODS = new Set([
  'addProperty',
  'createBooking',
  'createBookings',
  'rescheduleBooking',
  'cancelBooking',
  'createComplaint',
  'addComplaintDetails',
  'escalateToHuman',
  'createFeedback',
  'markFeedbackFollowUp',
  'updateCustomerPreferences',
]);

// Test-console simulation (simulation/scenarios.js); always inactive for real
// traffic. Returns a promise to use instead of the real call, or null.
function simulated(method, isRead, timeoutMs) {
  const scenario = activeScenario();
  if (scenario === 'crm_timeout' && !isRead) {
    // Flagged so it never counts against the real CRM circuit breaker.
    return Promise.reject(Object.assign(new OperationTimeoutError(`CRM.${method}`, timeoutMs, { uncertain: true }), { simulated: true }));
  }
  if (scenario === 'service_unavailable') {
    if (method === 'checkServiceability') return Promise.resolve({ serviceable: false, source: 'simulation' });
    if (method === 'getAvailability' || method === 'getAvailabilityRange') return Promise.resolve([]);
  }
  return null;
}

function wrapCrmAdapter(adapter, options = {}) {
  const timeoutMs = options.timeoutMs || reliability.CRM_REQUEST_TIMEOUT_MS;
  const maxReadRetries = options.maxReadRetries ?? reliability.MAX_READ_RETRIES;
  const retryBaseDelayMs = options.retryBaseDelayMs || reliability.RETRY_BASE_DELAY_MS;
  const breaker = options.breaker || new CircuitBreaker('CRM', {
    failureThreshold: reliability.PROVIDER_FAILURE_THRESHOLD,
    cooldownMs: reliability.PROVIDER_COOLDOWN_MS,
  });

  const wrapped = {};
  for (const method of [...READ_METHODS, ...WRITE_METHODS]) {
    // Optional capabilities (e.g. getAvailabilityRange) are only exposed when
    // the underlying adapter implements them, so callers can feature-detect.
    if (typeof adapter[method] !== 'function') continue;
    wrapped[method] = async (...args) => {
      const startedAt = Date.now();
      const isRead = READ_METHODS.has(method);
      const call = () => withTimeout(
        () => simulated(method, isRead, timeoutMs) || adapter[method](...args),
        timeoutMs,
        `CRM.${method}`,
        { uncertain: !isRead }
      );

      try {
        breaker.assertAvailable();
        const value = isRead
          ? await retry(call, {
            retries: maxReadRetries,
            baseDelayMs: retryBaseDelayMs,
            shouldRetry: (error) => error.code === 'OPERATION_TIMEOUT' || isTransientError(error),
            onRetry: ({ error, attempt, delayMs }) => logger.warn('CRM_RETRY', {
              method, attempt, delayMs, reason: error.code || (error.response && error.response.status) || error.message,
            }),
          })
          : await call();
        breaker.recordSuccess();
        logger.audit(isRead ? 'CRM_READ_COMPLETED' : 'CRM_WRITE_COMPLETED', {
          operation: method,
          latencyMs: Date.now() - startedAt,
          result: 'success',
        });
        return value;
      } catch (error) {
        if (!isRead && (error.code === 'OPERATION_TIMEOUT' || isTransientError(error))) {
          error.uncertain = true;
        }
        if (!error.simulated && (error.code === 'OPERATION_TIMEOUT' || isTransientError(error))) breaker.recordFailure();
        logger.audit(isRead ? 'CRM_READ_ERROR' : 'CRM_WRITE_ERROR', {
          operation: method,
          latencyMs: Date.now() - startedAt,
          errorCategory: error.code || 'CRM_PROVIDER_ERROR',
          statusCode: error.response && error.response.status,
          result: error.uncertain ? 'uncertain' : 'failed',
        });
        throw error;
      }
    };
  }
  return wrapped;
}

module.exports = { wrapCrmAdapter, READ_METHODS, WRITE_METHODS };
