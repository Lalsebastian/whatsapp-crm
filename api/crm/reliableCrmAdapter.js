const reliability = require('../config/reliability');
const logger = require('../utils/logger');
const { withTimeout, retry, isTransientError } = require('../reliability/asyncPolicy');
const { CircuitBreaker } = require('../reliability/circuitBreaker');

const READ_METHODS = new Set([
  'findCustomerByPhone',
  'getCustomerProperties',
  'getServices',
  'getServiceDetails',
  'getAvailability',
  'getBookings',
  'getBookingStatus',
  'getComplaintStatus',
]);

const WRITE_METHODS = new Set([
  'addProperty',
  'createBooking',
  'rescheduleBooking',
  'cancelBooking',
  'createComplaint',
  'escalateToHuman',
]);

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
    wrapped[method] = async (...args) => {
      breaker.assertAvailable();
      const isRead = READ_METHODS.has(method);
      const call = () => withTimeout(
        () => adapter[method](...args),
        timeoutMs,
        `CRM.${method}`,
        { uncertain: !isRead }
      );

      try {
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
        return value;
      } catch (error) {
        if (!isRead && (error.code === 'OPERATION_TIMEOUT' || isTransientError(error))) {
          error.uncertain = true;
        }
        if (error.code === 'OPERATION_TIMEOUT' || isTransientError(error)) breaker.recordFailure();
        throw error;
      }
    };
  }
  return wrapped;
}

module.exports = { wrapCrmAdapter, READ_METHODS, WRITE_METHODS };
