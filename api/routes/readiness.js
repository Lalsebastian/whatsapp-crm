const express = require('express');
const db = require('../db/supabaseClient');
const reliability = require('../config/reliability');
const { withTimeout } = require('../reliability/asyncPolicy');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    await withTimeout(
      () => db.get('sessions', 'select=phone&limit=1'),
      reliability.CRM_REQUEST_TIMEOUT_MS,
      'readiness.datastore'
    );
    return res.json({ status: 'ready', service: 'home-services-whatsapp-chatbot' });
  } catch (error) {
    return res.status(503).json({ status: 'not_ready', service: 'home-services-whatsapp-chatbot' });
  }
});

module.exports = router;
