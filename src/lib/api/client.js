import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { mutateRows } from '@/lib/api/mutations';

/*
 * The single place Supabase is spoken to.
 *
 * Every domain module in src/lib/api/ builds its queries from these helpers, so
 * components never call `supabase.from()` themselves. That containment is the
 * whole point: swapping the dashboard to the authenticated Node API later means
 * rewriting this file and the domain modules, not the views.
 */

/**
 * Supabase returns `{ data, error }` instead of throwing, and PostgREST failures
 * arrive as a plain object that stringifies to "[object Object]". Normalising
 * here means a failed query surfaces a real message in the console and in an
 * error toast, instead of silently rendering an empty table.
 */
export function unwrap({ data, error }, context) {
  if (error) {
    const message = error.message || String(error.code || 'Unknown Supabase error');
    console.error(`[api] ${context} failed:`, message, error);
    throw new Error(`${context}: ${message}`);
  }
  return data;
}

export function assertSupabaseConfigured() {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in the frontend environment.'
    );
  }
}

export function select(table, columns = '*') {
  assertSupabaseConfigured();
  return supabase.from(table).select(columns);
}

export async function fetchRows(table, { columns = '*', filters = {}, order, limit } = {}) {
  let query = select(table, columns);
  query = applyFilters(query, filters);
  if (order) query = query.order(order.column, { ascending: order.ascending ?? true });
  if (limit) query = query.limit(limit);
  return unwrap(await query, `select ${table}`);
}

export function applyFilters(query, filters = {}) {
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      query = query.in(key, value);
    } else {
      query = query.eq(key, value);
    }
  }
  return query;
}

export async function insertRow(table, values) {
  assertSupabaseConfigured();
  return unwrap(await supabase.from(table).insert(values).select().single(), `insert ${table}`);
}

export async function updateRows(table, values, filters) {
  assertSupabaseConfigured();
  return unwrap(await mutateRows(supabase, table, values, filters), `update ${table}`);
}

export async function updateRow(table, values, filters) {
  assertSupabaseConfigured();
  return unwrap(await mutateRows(supabase, table, values, filters, { single: true }), `update ${table}`);
}

/**
 * PostgREST filters on a nullable column return `null` rather than omitting the
 * row, which breaks `.map()` in the views. Dropping null keys keeps every row
 * shaped the same way regardless of which optional columns were populated.
 */
export function compact(row) {
  if (!row || typeof row !== 'object') return row;
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== undefined));
}

/** Builds a lookup keyed by id, for views that need to resolve FKs in one pass. */
export function indexBy(rows, key = 'id') {
  return new Map((rows ?? []).map((row) => [row[key], row]));
}

/**
 * Rows carry snake_case column names; views want camelCase props. Mapping here
 * rather than aliasing in every query keeps the SQL readable and the mapping
 * greppable.
 */
export function mapRow(row, fields) {
  if (!row) return null;
  const out = {};
  for (const [to, from] of Object.entries(fields)) {
    out[to] = row[from];
  }
  return out;
}
