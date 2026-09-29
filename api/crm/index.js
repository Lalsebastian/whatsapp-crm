const env = require('../config/env');
const supabaseCrmAdapter = require('./supabaseCrmAdapter');
const httpCrmAdapter = require('./httpCrmAdapter');
const { wrapCrmAdapter } = require('./reliableCrmAdapter');

let reliableAdapter;

// Single switch point: flow code (api/flows/*) always calls getCrmAdapter()
// and never imports an adapter directly, so swapping in the client's real CRM
// later is a one-line env change (CRM_PROVIDER=http), not a code change.
function getCrmAdapter() {
  if (!reliableAdapter) {
    const adapter = env.CRM_PROVIDER === 'http' ? httpCrmAdapter : supabaseCrmAdapter;
    reliableAdapter = wrapCrmAdapter(adapter);
  }
  return reliableAdapter;
}

module.exports = { getCrmAdapter };
