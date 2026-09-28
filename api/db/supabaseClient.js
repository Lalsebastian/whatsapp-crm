// Thin wrapper around Supabase's PostgREST REST API via axios.
// No Supabase SDK is used, consistent with the rest of this project's dependency footprint.
const axios = require('axios');
const env = require('../config/env');

function headers(extra = {}) {
  return {
    apikey: env.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    ...extra,
  };
}

function buildUrl(table, query) {
  const qs = query ? (query.startsWith('?') ? query : `?${query}`) : '';
  return `${env.SUPABASE_URL}/rest/v1/${table}${qs}`;
}

async function get(table, query) {
  const res = await axios.get(buildUrl(table, query), { headers: headers() });
  return res.data;
}

async function insert(table, data, { returnRepresentation = true } = {}) {
  const prefer = returnRepresentation ? 'return=representation' : 'return=minimal';
  const res = await axios.post(buildUrl(table), data, {
    headers: headers({ 'Content-Type': 'application/json', Prefer: prefer }),
  });
  return res.data;
}

// Upsert keyed on a unique/primary-key column (e.g. phone for sessions/customers).
async function upsert(table, data, { onConflict } = {}) {
  const query = onConflict ? `on_conflict=${onConflict}` : '';
  const res = await axios.post(buildUrl(table, query), data, {
    headers: headers({
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    }),
  });
  return res.data;
}

async function patch(table, query, data) {
  const res = await axios.patch(buildUrl(table, query), data, {
    headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
  });
  return res.data;
}

module.exports = { get, insert, upsert, patch };
