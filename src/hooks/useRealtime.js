import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { queryKeys } from '@/lib/api';

/*
 * Supabase Realtime → React Query invalidation.
 *
 * The dashboard polls nothing: this hook is what makes the Inbox and the board
 * live. Postgres Changes emits a callback per changed row, so a chatty customer
 * can fire a burst — every callback is coalesced into one invalidation per table
 * per INCREMENT_MS instead.
 *
 * The contract with the migration: the tables listed here must be in the
 * supabase_realtime publication or no event ever arrives.
 */

const INCREMENT_MS = 750;

/** Which query key groups a changed table should invalidate. */
const TABLE_TO_KEYS = {
  messages: [queryKeys.messages.all],
  bookings: [queryKeys.bookings.all, queryKeys.analytics.all],
  complaints: [queryKeys.complaints.all, queryKeys.analytics.all],
  escalations: [queryKeys.escalations.all],
  job_photos: [queryKeys.jobs.all],
  job_signatures: [queryKeys.jobs.all],
  satisfaction_surveys: [queryKeys.surveys.all, queryKeys.analytics.all],
  conversation_events: [queryKeys.analytics.all],
};

/**
 * Subscribes to Postgres Changes on `tables` and invalidates the matching
 * queries.
 *
 * `tables` is compared by value, not identity, so a view can pass an inline
 * array literal without tearing down and re-opening the websocket on every
 * render — the usual way an inline dependency silently breaks a subscription.
 */
export function useRealtime(tables) {
  const queryClient = useQueryClient();
  const timers = useRef(new Map());
  const [status, setStatus] = useState(isSupabaseConfigured ? 'connecting' : 'unavailable');
  const tableKey = (tables ?? []).join(',');

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return undefined;
    }

    const active = tableKey.split(',').filter((table) => table && TABLE_TO_KEYS[table]);
    if (!active.length) return undefined;

    const channel = supabase.channel(`dashboard:${tableKey}`);

    // Captured once per subscription so cleanup clears the timers this effect
    // created, not whatever the ref happens to hold when it runs.
    const pending = new Map();
    timers.current = pending;

    const scheduleInvalidate = (table) => {
      // Already queued for this table — let the existing timer absorb this one.
      if (pending.has(table)) return;

      const timer = setTimeout(() => {
        pending.delete(table);
        for (const key of TABLE_TO_KEYS[table] ?? []) {
          queryClient.invalidateQueries({ queryKey: key });
        }
      }, INCREMENT_MS);

      pending.set(table, timer);
    };

    for (const table of active) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        scheduleInvalidate(table);
      });
    }

    channel.subscribe((nextStatus) => {
      if (nextStatus === 'SUBSCRIBED') setStatus('connected');
      if (nextStatus === 'CHANNEL_ERROR' || nextStatus === 'TIMED_OUT' || nextStatus === 'CLOSED') {
        setStatus('unavailable');
      }
    });

    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
      supabase.removeChannel(channel);
    };
  }, [queryClient, tableKey]);

  return status;
}

/**
 * Polling fallback for when Realtime is unavailable (misconfigured env, a
 * blocked websocket, or a table missing from the publication).
 *
 * Returns the interval to poll at, or null when Realtime is configured and
 * therefore polling would just duplicate the subscription.
 */
export function usePollingFallback(enabled, intervalMs = 60000, tables = []) {
  const queryClient = useQueryClient();
  const tableKey = tables.join(',');

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = setInterval(() => {
      for (const table of tableKey.split(',').filter(Boolean)) {
        for (const key of TABLE_TO_KEYS[table] ?? []) queryClient.invalidateQueries({ queryKey: key });
      }
    }, intervalMs);

    return () => clearInterval(timer);
  }, [enabled, intervalMs, queryClient, tableKey]);
}

/**
 * Convenience for the views that need live data and cannot afford to be wrong
 * about it: realtime when configured, polling when not.
 */
export function useLiveUpdates(tables, { enabled = true, pollInterval = 60000 } = {}) {
  const status = useRealtime(tables);
  usePollingFallback(enabled && status === 'unavailable', pollInterval, tables);
  return status;
}
