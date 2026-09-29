class CircuitOpenError extends Error {
  constructor(provider) {
    super(`${provider} circuit is temporarily open`);
    this.name = 'CircuitOpenError';
    this.code = 'CIRCUIT_OPEN';
    this.provider = provider;
  }
}

class CircuitBreaker {
  constructor(provider, { failureThreshold = 5, cooldownMs = 30000 } = {}) {
    this.provider = provider;
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.failures = 0;
    this.openedAt = 0;
  }

  canRequest(now = Date.now()) {
    if (!this.openedAt) return true;
    if (now - this.openedAt >= this.cooldownMs) {
      this.openedAt = 0;
      this.failures = 0;
      return true;
    }
    return false;
  }

  assertAvailable() {
    if (!this.canRequest()) throw new CircuitOpenError(this.provider);
  }

  recordSuccess() {
    this.failures = 0;
    this.openedAt = 0;
  }

  recordFailure() {
    this.failures += 1;
    if (this.failures >= this.failureThreshold) this.openedAt = Date.now();
  }
}

module.exports = { CircuitBreaker, CircuitOpenError };
