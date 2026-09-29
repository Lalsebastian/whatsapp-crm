const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');

const storage = new AsyncLocalStorage();

function runWithRequestContext(values, operation) {
  const context = {
    correlationId: values.correlationId || values.messageId || randomUUID(),
    messageId: values.messageId || null,
    phone: values.phone || null,
  };
  return storage.run(context, operation);
}

function getRequestContext() {
  return storage.getStore() || {};
}

module.exports = { runWithRequestContext, getRequestContext };
