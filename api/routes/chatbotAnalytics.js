const crypto = require('node:crypto');
const express = require('express');
const env = require('../config/env');
const logger = require('../utils/logger');
const dashboardService = require('../analytics/dashboardService');
const { VALID_RANGES } = require('../analytics/dashboardAggregator');

const router = express.Router();

function isEnabled() {
  return env.ENABLE_CHATBOT_ANALYTICS_DASHBOARD === true && Boolean(env.CHATBOT_ANALYTICS_SECRET);
}

function secretsMatch(provided, expected) {
  if (!provided || !expected) return false;
  const left = Buffer.from(String(provided));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requireAnalyticsAccess(req, res, next) {
  if (!isEnabled()) {
    return res.status(404).json({
      error: 'Chatbot analytics is disabled on this deployment.',
      code: 'CHATBOT_ANALYTICS_DISABLED',
    });
  }
  if (!secretsMatch(req.get('x-chatbot-analytics-secret'), env.CHATBOT_ANALYTICS_SECRET)) {
    return res.status(401).json({
      error: 'A valid analytics access key is required.',
      code: 'CHATBOT_ANALYTICS_UNAUTHORIZED',
    });
  }
  return next();
}

router.get('/status', (req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.json({ enabled: isEnabled(), requiresSecret: true });
});

router.get('/', requireAnalyticsAccess, async (req, res) => {
  const range = String(req.query.range || '7d').toLowerCase();
  if (!VALID_RANGES.has(range)) {
    return res.status(400).json({
      error: 'Range must be one of: today, 7d, 30d, 90d.',
      code: 'CHATBOT_ANALYTICS_INVALID_RANGE',
    });
  }
  logger.log('CHATBOT_ANALYTICS', `request range=${range}`);
  try {
    const analytics = await dashboardService.getChatbotAnalytics(range);
    res.set('Cache-Control', 'private, no-store');
    return res.json(analytics);
  } catch (error) {
    const dependencyFailure = error.isDependencyError || error.statusCode === 503;
    logger.error(
      'CHATBOT_ANALYTICS',
      `request failed range=${range}`,
      `stage=${error.stage || 'unknown'}`,
      `type=${dependencyFailure ? 'dependency' : 'internal'}`,
      `code=${error.code || 'CHATBOT_ANALYTICS_FAILED'}`
    );
    return res.status(dependencyFailure ? 503 : 500).json({
      error: dependencyFailure
        ? 'Chatbot analytics is temporarily unavailable.'
        : 'Unable to load chatbot analytics.',
      code: dependencyFailure
        ? 'CHATBOT_ANALYTICS_UNAVAILABLE'
        : 'CHATBOT_ANALYTICS_FAILED',
    });
  }
});

module.exports = router;
module.exports.isEnabled = isEnabled;
module.exports.requireAnalyticsAccess = requireAnalyticsAccess;
