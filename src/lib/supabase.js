import { createClient } from '@supabase/supabase-js';

/*
 * Auth is deliberately deferred: this client is created with the anon key and
 * no session, which is why `auth` is left unconfigured for now. Everything in
 * the app reads role from `useCurrentUser()` rather than from a Supabase user.
 * When real auth lands, the only change here is passing a token/refresh pair.
 *
 * Realtime is the reason this file exists at all — Postgres Changes has no REST
 * equivalent, so the frontend needs the SDK even though the backend stays on
 * plain PostgREST + axios.
 */

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured) {
  console.error(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are not set. ' +
      'The dashboard will render empty states until they are configured.'
  );
}

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'public-anon-key', {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { params: { eventsPerSecond: 10 } },
});
