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
    action,
    result: fields.result || null,
    timestamp: new Date().toISOString(),
    correlationId: context.correlationId || null,
    messageId: context.messageId || null,
    phone: fields.phone || context.phone || null,
    ...fields,
  });
}

module.exports = { log, warn, error, audit };
