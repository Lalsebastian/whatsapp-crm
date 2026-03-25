const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Import the webhook handler
const webhookHandler = require('./webhook');

// Request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// WhatsApp webhook endpoint
app.all('/webhook', webhookHandler);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'WhatsApp CRM API',
    version: '1.0.0',
    endpoints: {
      webhook: '/webhook',
      health: '/health'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`WhatsApp CRM API running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Webhook endpoint: http://localhost:${PORT}/webhook`);
});

// Keep-alive: ping self every 4 minutes to prevent Render free tier spin-down
const SELF_URL = 'https://whatsapp-bot-95ry.onrender.com/health';
setInterval(async () => {
  try {
    await axios.get(SELF_URL);
    console.log(`[KEEP-ALIVE] Ping successful — ${new Date().toISOString()}`);
  } catch (err) {
    console.error(`[KEEP-ALIVE] Ping failed — ${err.message}`);
  }
}, 4 * 60 * 1000);