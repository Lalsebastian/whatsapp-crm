const env = require('../config/env');
const supabaseCrmAdapter = require('./supabaseCrmAdapter');
const httpCrmAdapter = require('./httpCrmAdapter');

// Single switch point: flow code (api/flows/*) always calls getCrmAdapter()
// and never imports an adapter directly, so swapping in the client's real CRM
// later is a one-line env change (CRM_PROVIDER=http), not a code change.
function getCrmAdapter() {
  return env.CRM_PROVIDER === 'http' ? httpCrmAdapter : supabaseCrmAdapter;
}

module.exports = { getCrmAdapter };
