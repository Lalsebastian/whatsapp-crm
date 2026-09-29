const express = require('express');
const cors = require('cors');
const axios = require('axios');
const env = require('./config/env');
const logger = require('./utils/logger');

const webhookRoute = require('./routes/webhook');
const healthRoute = require('./routes/health');
const readinessRoute = require('./routes/readiness');
const chatTestRoute = require('./routes/chatTest');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use((req, res, next) => {
  logger.log('HTTP', `${req.method} ${req.path}`);
  next();
});

app.use('/webhook', webhookRoute);
app.use('/health', healthRoute);
app.use('/ready', readinessRoute);

// The chat-test route drives the REAL conversationRouter, so leaving it mounted
// in production lets anyone with the API URL inject fake inbound WhatsApp
// messages for any phone number: create bookings, burn Gemini quota, and set
// human_takeover on real customers (which silently mutes the bot). It exists
// for local development only.
if (env.NODE_ENV !== 'production') {
  app.use('/api/chat/test', chatTestRoute);
} else {
  logger.log('SERVER', 'chatTest route disabled (NODE_ENV=production)');
}

app.get('/', (req, res) => {
  res.json({
    message: 'Home Services WhatsApp Chatbot API',
    endpoints: {
      webhook: '/webhook',
      health: '/health',
      readiness: '/ready',
      ...(env.NODE_ENV !== 'production' ? { chatTest: '/api/chat/test' } : {}),
    },
  });
});

app.use((err, req, res, next) => {
  logger.error('HTTP', 'Unhandled error:', err.message, err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(env.PORT, () => {
  logger.log('SERVER', `Running on port ${env.PORT}`);
  logger.log('SERVER', `Health check: http://localhost:${env.PORT}/health`);
  logger.log('SERVER', `Webhook: http://localhost:${env.PORT}/webhook`);
  logger.log('SERVER', `Test chat: http://localhost:${env.PORT}/api/chat/test`);
});

// Keep-alive: ping self every 4 minutes to prevent Render free-tier spin-down.
// Render sets RENDER_EXTERNAL_URL automatically; falls back to the URL this
// project has historically deployed to.
const SELF_URL = process.env.RENDER_EXTERNAL_URL || 'https://whatsapp-bot-95ry.onrender.com';
if (env.NODE_ENV === 'production') {
  setInterval(async () => {
    try {
      await axios.get(`${SELF_URL}/health`);
      logger.log('KEEP-ALIVE', 'Ping successful');
    } catch (err) {
      logger.error('KEEP-ALIVE', 'Ping failed:', err.message);
    }
  }, 4 * 60 * 1000);
}
