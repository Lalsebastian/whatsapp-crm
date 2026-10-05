const axios = require('axios');
const env = require('./config/env');
const logger = require('./utils/logger');
const { createApp } = require('./app');
const chatTestRoute = require('./routes/chatTest');
const retentionScheduler = require('./privacy/retentionScheduler');
const escalationSla = require('./escalation/slaMonitor');

if (env.CRM_PROVIDER === 'http') {
  try {
    require('./crm/httpCrmAdapter').validateConfiguration();
  } catch (error) {
    // Refuse to start rather than answer customers with errors.
    logger.error('SERVER', `Client CRM configuration invalid: ${error.message}`);
    process.exit(1);
  }
}

const app = createApp();

if (env.NODE_ENV === 'production' && !env.WHATSAPP_APP_SECRET) {
  logger.error(
    'SERVER',
    'WHATSAPP_APP_SECRET is not set. Webhook deliveries will be rejected (503) until it is configured.'
  );
}

app.listen(env.PORT, () => {
  logger.log('SERVER', `Running on port ${env.PORT}`);
  logger.log('SERVER', `Health check: http://localhost:${env.PORT}/health`);
  logger.log('SERVER', `Webhook: http://localhost:${env.PORT}/webhook`);
  logger.log(
    'SERVER',
    chatTestRoute.isTestChatEnabled()
      ? `Test chat enabled: http://localhost:${env.PORT}/test-chat.html`
      : 'Test chat disabled (set ENABLE_TEST_CHAT=true and TEST_CHAT_SECRET to enable)'
  );
});

retentionScheduler.start();
escalationSla.start();

// Keep-alive: ping self every 4 minutes to prevent Render free-tier spin-down.
// Render sets RENDER_EXTERNAL_URL automatically. Nothing is pinged when it is
// absent, so a self-hosted or local production run never calls another host.
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (env.NODE_ENV === 'production' && SELF_URL) {
  setInterval(async () => {
    try {
      await axios.get(`${SELF_URL}/health`);
      logger.log('KEEP-ALIVE', 'Ping successful');
    } catch (err) {
      logger.error('KEEP-ALIVE', 'Ping failed:', err.message);
    }
  }, 4 * 60 * 1000);
}
