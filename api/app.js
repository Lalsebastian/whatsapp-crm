// Builds the Express application without binding a port or starting timers,
// so route-level tests can exercise the exact middleware stack production
// uses (raw-body capture, signature checks, error handling) via supertest.
const express = require('express');
const cors = require('cors');
const logger = require('./utils/logger');

const webhookRoute = require('./routes/webhook');
const healthRoute = require('./routes/health');
const readinessRoute = require('./routes/readiness');
const chatTestRoute = require('./routes/chatTest');
const chatbotAnalyticsRoute = require('./routes/chatbotAnalytics');
const crmEventsRoute = require('./routes/crmEvents');

// Signed webhooks (Meta, client CRM) are verified against the exact bytes
// that were sent. Re-serialising the parsed JSON would not reproduce them,
// so the raw body is kept for these routes only.
const SIGNED_PATHS = ['/webhook', '/api/crm/events'];

function captureRawBody(req, res, buffer) {
  if (SIGNED_PATHS.some((path) => req.originalUrl === path || req.originalUrl.startsWith(`${path}?`) || req.originalUrl.startsWith(`${path}/`))) {
    req.rawBody = Buffer.from(buffer);
  }
}

function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '1mb', verify: captureRawBody }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static('public'));

  app.use((req, res, next) => {
    logger.log('HTTP', `${req.method} ${req.path}`);
    next();
  });

  app.use('/webhook', webhookRoute);
  app.use('/health', healthRoute);
  app.use('/ready', readinessRoute);

  // Always mount the route so the browser console can report a clear disabled
  // state. The route itself fails closed unless the explicit feature flag and
  // developer secret are both configured.
  app.use('/api/chat/test', chatTestRoute);
  app.use('/api/analytics/chatbot', chatbotAnalyticsRoute);
  app.use('/api/crm/events', crmEventsRoute);

  app.get('/', (req, res) => {
    res.json({
      message: 'Home Services WhatsApp Chatbot API',
      endpoints: {
        webhook: '/webhook',
        health: '/health',
        readiness: '/ready',
        ...(chatTestRoute.isTestChatEnabled() ? { chatTest: '/api/chat/test' } : {}),
        ...(chatbotAnalyticsRoute.isEnabled() ? { chatbotAnalytics: '/api/analytics/chatbot' } : {}),
        ...(crmEventsRoute.isEnabled() ? { crmEvents: '/api/crm/events' } : {}),
      },
    });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Malformed JSON body' });
    }
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request body too large' });
    }
    logger.error('HTTP', 'Unhandled error:', err.message, err.stack);
    return res.status(500).json({ error: 'Internal server error' });
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}

module.exports = { createApp };
