const { getRequestContext } = require('../reliability/requestContext');

function contextPrefix() {
  const { correlationId } = getRequestContext();
  return correlationId ? `[correlationId=${correlationId}]` : null;
}

function log(tag, ...args) {
  const prefix = contextPrefix();
  console.log(`[${tag}]`, ...(prefix ? [prefix, ...args] : args));
}

function warn(tag, ...args) {
  const prefix = contextPrefix();
  console.warn(`[${tag}]`, ...(prefix ? [prefix, ...args] : args));
}

function error(tag, ...args) {
  const prefix = contextPrefix();
  console.error(`[${tag}]`, ...(prefix ? [prefix, ...args] : args));
}

function audit(action, fields = {}) {
  const context = getRequestContext();
  log('AUDIT', {
    timestamp: new Date().toISOString(),
    correlationId: context.correlationId || null,
    messageId: context.messageId || null,
    phone: fields.phone || context.phone || null,
    ...fields,
    action,
    result: fields.result || null,
  });
  // Audit is the single event source for both operational logs and durable
  // analytics. The writer is deliberately fire-and-forget and never throws
  // into a customer conversation.
  try {
    const { trackEvent } = require('../analytics/eventWriter');
    void trackEvent(action, fields);
  } catch (err) {
    console.error('[ANALYTICS_DISPATCH_FAILED]', err.message);
  }
}

module.exports = { log, warn, error, audit };
