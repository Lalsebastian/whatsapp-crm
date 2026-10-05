// POST /api/crm/events: booking lifecycle events pushed by the CRM.
//
// Authentication (either):
//   X-CRM-Signature: sha256=<hex HMAC-SHA256(CRM_WEBHOOK_SECRET, raw body)>
//   Authorization: Bearer <CRM_WEBHOOK_SECRET>   (for senders that cannot sign,
//                                                 e.g. Supabase Database Webhooks)
//
// Responses:
//   200 every event handled (each one reported as processed/skipped/duplicate)
//   400 nothing usable in the body
//   401 bad credentials, 404 endpoint disabled (no secret configured)
//   503 a transient failure: the event was not consumed, retry later
const express = require('express');
const env = require('../config/env');
const logger = require('../utils/logger');
const { isValidSignature, secretsMatch } = require('../utils/signature');
const { parseCrmEventBody } = require('../lifecycle/eventNormalizer');
const lifecycle = require('../lifecycle/bookingLifecycle');

const router = express.Router();

function isEnabled() {
  return Boolean(env.CRM_WEBHOOK_SECRET);
}

function bearerToken(req) {
  const header = req.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : null;
}

function requireCrmCredentials(req, res, next) {
  if (!isEnabled()) {
    return res.status(404).json({ error: 'CRM events are disabled on this deployment.', code: 'CRM_EVENTS_DISABLED' });
  }
  const signature = req.get('x-crm-signature');
  const authorized = signature
    ? isValidSignature({ secret: env.CRM_WEBHOOK_SECRET, rawBody: req.rawBody, header: signature })
    : secretsMatch(bearerToken(req), env.CRM_WEBHOOK_SECRET);
  if (!authorized) {
    logger.warn('CRM_EVENTS', 'Rejected CRM event with invalid credentials');
    logger.audit('CRM_EVENT_REJECTED', { result: 'unauthorized' });
    return res.status(401).json({ error: 'Invalid credentials', code: 'CRM_EVENTS_UNAUTHORIZED' });
  }
  return next();
}

router.post('/', requireCrmCredentials, async (req, res) => {
  const { events, rejected } = parseCrmEventBody(req.body);
  if (events.length === 0) {
    // A Supabase webhook for an update we do not act on (e.g. notes edited)
    // is valid and simply has nothing to do.
    if (rejected.length === 0) return res.json({ results: [] });
    return res.status(400).json({ error: 'No supported lifecycle events in request', rejected });
  }

  const results = [];
  let transientFailure = false;
  for (const event of events) {
    try {
      const outcome = await lifecycle.processLifecycleEvent(event);
      results.push({ id: event.id, type: event.type, ...outcome });
    } catch (error) {
      transientFailure = true;
      results.push({ id: event.id, type: event.type, status: 'failed' });
    }
  }
  return res.status(transientFailure ? 503 : 200).json({ results, rejected });
});

module.exports = router;
module.exports.isEnabled = isEnabled;
