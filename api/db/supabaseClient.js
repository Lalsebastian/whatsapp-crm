// Thin wrapper around Supabase's PostgREST REST API via axios.
// No Supabase SDK is used, consistent with the rest of this project's dependency
// footprint. Authenticates with the service-role key when present (see
// config/env.js) so RLS can be enabled later without breaking the webhook.
const axios = require('axios');
const env = require('../config/env');
const logger = require('../utils/logger');
const reliability = require('../config/reliability');

function headers(extra = {}) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

function buildUrl(table, query) {
  const qs = query ? (query.startsWith('?') ? query : `?${query}`) : '';
  return `${env.SUPABASE_URL}/rest/v1/${table}${qs}`;
}

// axios's own error.message is just "Request failed with status code 401" —
// useless for telling apart a bad API key from an RLS policy from a missing
// table. Log Supabase/PostgREST's actual response body and the request that
// triggered it, so Render logs are enough to diagnose without guesswork.
async function run(method, url, data, config) {
  try {
    return await axios({ method, url, data, timeout: reliability.CRM_REQUEST_TIMEOUT_MS, ...config });
  } catch (err) {
    logger.error(
      'SUPABASE',
      `${method.toUpperCase()} ${url} failed:`,
      `status=${err.response ? err.response.status : 'no response'}`,
      'body=', err.response ? JSON.stringify(err.response.data) : err.message
    );
    throw err;
  }
}

async function get(table, query) {
  const res = await run('get', buildUrl(table, query), undefined, { headers: headers() });
  return res.data;
}

async function insert(table, data, { returnRepresentation = true } = {}) {
  const prefer = returnRepresentation ? 'return=representation' : 'return=minimal';
  const res = await run('post', buildUrl(table), data, {
    headers: headers({ 'Content-Type': 'application/json', Prefer: prefer }),
  });
  return res.data;
}

// Upsert keyed on a unique/primary-key column (e.g. phone for sessions/customers).
async function upsert(table, data, { onConflict } = {}) {
  const query = onConflict ? `on_conflict=${onConflict}` : '';
  const res = await run('post', buildUrl(table, query), data, {
    headers: headers({
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    }),
  });
  return res.data;
}

async function patch(table, query, data) {
  const res = await run('patch', buildUrl(table, query), data, {
    headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
  });
  return res.data;
}

async function remove(table, query, { returnRepresentation = false } = {}) {
  if (!query) throw new Error(`Refusing to DELETE from ${table} without a filter`);
  const res = await run('delete', buildUrl(table, query), undefined, {
    headers: headers({ Prefer: returnRepresentation ? 'return=representation' : 'return=minimal' }),
  });
  return res.data;
}

// Calls a Postgres function exposed by PostgREST (POST /rest/v1/rpc/<fn>).
// Used where a single round trip must be atomic: multi-service booking,
// distributed lease locks, idempotency claims and retention cleanup.
async function rpc(fn, args = {}) {
  const res = await run('post', `${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, args, {
    headers: headers({ 'Content-Type': 'application/json' }),
  });
  return res.data;
}

// PostgREST answers PGRST202 (HTTP 404) when the function has not been
// created yet, i.e. the migration that defines it was never applied.
function isMissingFunction(error) {
  const data = error && error.response && error.response.data;
  return !!data && (data.code === 'PGRST202' || data.code === '42883');
}

// PGRST204: a column in the payload is not in the schema cache (an additive
// migration that adds the column has not been applied yet).
function isMissingColumn(error) {
  const data = error && error.response && error.response.data;
  return !!data && (data.code === 'PGRST204' || data.code === '42703');
}

module.exports = { get, insert, upsert, patch, remove, rpc, isMissingFunction, isMissingColumn };
