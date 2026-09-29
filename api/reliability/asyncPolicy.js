class OperationTimeoutError extends Error {
  constructor(operation, timeoutMs, { uncertain = false } = {}) {
    super(`${operation} timed out after ${timeoutMs}ms`);
    this.name = 'OperationTimeoutError';
    this.code = 'OPERATION_TIMEOUT';
    this.operation = operation;
    this.timeoutMs = timeoutMs;
    this.uncertain = uncertain;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(operation, timeoutMs, label, options = {}) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new OperationTimeoutError(label, timeoutMs, options)), timeoutMs);
  });
  return Promise.race([Promise.resolve().then(operation), timeout]).finally(() => clearTimeout(timer));
}

function statusOf(error) {
  return error && error.response && error.response.status;
}

function isTransientError(error) {
  const status = statusOf(error);
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  return ['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND'].includes(error && error.code);
}

async function retry(operation, {
  retries,
  baseDelayMs,
  shouldRetry = isTransientError,
  onRetry = () => {},
} = {}) {
  let attempt = 0;
  while (true) {
    try {
      return await operation(attempt + 1);
    } catch (error) {
      if (attempt >= retries || !shouldRetry(error)) throw error;
      attempt += 1;
      const delayMs = baseDelayMs * (2 ** (attempt - 1));
      onRetry({ error, attempt, delayMs });
      await sleep(delayMs);
    }
  }
}

module.exports = { OperationTimeoutError, withTimeout, retry, isTransientError, statusOf, sleep };
