-- Chatbot reliability, atomic booking, lifecycle events, geocoded addresses
-- and voice-data retention.
--
-- Run after api/db/schema.sql, api/db/migrations/2026_dashboard.sql and the
-- 202609300001..3 migrations. Additive and idempotent: safe to re-run.
--
-- Every function is SECURITY INVOKER and callable only by service_role (the
-- key the chatbot backend uses). The browser's anon key cannot call them.

-- ════════════════════════════════════════════════════════════════════════
-- 1. Cross-instance coordination
-- ════════════════════════════════════════════════════════════════════════

-- Per-customer conversation lease. A row is a lock; it expires on its own so a
-- crashed instance can never block a customer for longer than the lease TTL.
-- (PostgREST runs each call in its own transaction on a pooled connection, so
-- pg_advisory_lock cannot be held across the several calls one message needs.)
create table if not exists public.chatbot_locks (
  lock_key text primary key,
  owner text not null,
  expires_at timestamptz not null,
  acquired_at timestamptz not null default now()
);

create or replace function public.chatbot_try_lock(p_key text, p_owner text, p_ttl_ms integer)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_owner text;
begin
  insert into public.chatbot_locks as l (lock_key, owner, expires_at)
  values (p_key, p_owner, now() + make_interval(secs => greatest(p_ttl_ms, 1000) / 1000.0))
  on conflict (lock_key) do update
    set owner = excluded.owner,
        expires_at = excluded.expires_at,
        acquired_at = case when l.owner = excluded.owner then l.acquired_at else now() end
    where l.expires_at < now() or l.owner = excluded.owner
  returning owner into v_owner;
  return coalesce(v_owner = p_owner, false);
end;
$$;

create or replace function public.chatbot_release_lock(p_key text, p_owner text)
returns void
language sql
set search_path = ''
as $$
  delete from public.chatbot_locks where lock_key = p_key and owner = p_owner;
$$;

-- Newest WhatsApp message timestamp processed per customer, shared by every
-- instance so a redelivered older message is recognised anywhere.
create table if not exists public.chatbot_message_order (
  phone text primary key,
  newest_timestamp bigint not null,
  updated_at timestamptz not null default now()
);

-- Returns true when p_timestamp is older than the newest one already seen.
create or replace function public.chatbot_record_message_timestamp(p_phone text, p_timestamp bigint)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_newest bigint;
begin
  insert into public.chatbot_message_order (phone, newest_timestamp)
  values (p_phone, p_timestamp)
  on conflict (phone) do nothing;
  if found then
    return false;
  end if;

  select newest_timestamp into v_newest
  from public.chatbot_message_order
  where phone = p_phone
  for update;

  if p_timestamp < v_newest then
    return true;
  end if;

  update public.chatbot_message_order
  set newest_timestamp = p_timestamp, updated_at = now()
  where phone = p_phone and newest_timestamp < p_timestamp;
  return false;
end;
$$;

-- Durable idempotency claims for customer-visible writes.
create table if not exists public.chatbot_action_claims (
  action_key text primary key,
  state text not null check (state in ('pending', 'succeeded', 'uncertain')),
  owner text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chatbot_action_claims_created_idx
  on public.chatbot_action_claims (created_at);

-- Claims p_key for p_owner. When another owner already holds it, returns that
-- claim's state/result instead. A claim left pending past p_stale_after_ms
-- belonged to an instance that died mid-write: its outcome is unknown, so it
-- is converted to 'uncertain' (never re-run).
create or replace function public.chatbot_claim_action(p_key text, p_owner text, p_stale_after_ms integer)
returns table (claimed boolean, state text, result jsonb)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_row public.chatbot_action_claims%rowtype;
begin
  insert into public.chatbot_action_claims (action_key, state, owner)
  values (p_key, 'pending', p_owner)
  on conflict (action_key) do nothing;
  if found then
    return query select true, 'pending'::text, null::jsonb;
    return;
  end if;

  select * into v_row
  from public.chatbot_action_claims c
  where c.action_key = p_key
  for update;

  if v_row.state = 'pending'
     and v_row.updated_at < now() - make_interval(secs => greatest(p_stale_after_ms, 1000) / 1000.0) then
    update public.chatbot_action_claims c
    set state = 'uncertain', updated_at = now()
    where c.action_key = p_key;
    v_row.state := 'uncertain';
  end if;

  return query select false, v_row.state, v_row.result;
end;
$$;

create or replace function public.chatbot_complete_action(p_key text, p_owner text, p_state text, p_result jsonb)
returns void
language sql
set search_path = ''
as $$
  update public.chatbot_action_claims
  set state = p_state, result = p_result, updated_at = now()
  where action_key = p_key and owner = p_owner and p_state in ('succeeded', 'uncertain');
$$;

create or replace function public.chatbot_release_action(p_key text, p_owner text)
returns void
language sql
set search_path = ''
as $$
  delete from public.chatbot_action_claims
  where action_key = p_key and owner = p_owner and state = 'pending';
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 2. Atomic multi-service booking
-- ════════════════════════════════════════════════════════════════════════

-- One row per idempotency key, so a retried request returns the bookings the
-- first attempt created instead of creating them again.
create table if not exists public.chatbot_booking_requests (
  idempotency_key text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  booking_ids uuid[] not null,
  created_at timestamptz not null default now()
);

-- Same format as api/utils/reference.js: BK-XXXXXX without 0/O/1/I/L.
create or replace function public.chatbot_generate_reference(p_prefix text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_candidate text;
begin
  loop
    v_candidate := p_prefix || '-';
    for i in 1..6 loop
      v_candidate := v_candidate || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::integer, 1);
    end loop;
    exit when not exists (select 1 from public.bookings where reference = v_candidate);
  end loop;
  return v_candidate;
end;
$$;

-- Creates every item or none (the whole function is one transaction).
-- Raises P0001 with a machine-readable message the backend maps to a
-- definitive, non-retryable error:
--   INVALID_ITEMS, INVALID_PROPERTY:<n>, INVALID_SERVICE:<n>, SLOT_UNAVAILABLE:<n>
create or replace function public.chatbot_create_bookings(
  p_customer_id uuid,
  p_items jsonb,
  p_idempotency_key text default null
)
returns setof public.bookings
language plpgsql
set search_path = ''
as $$
declare
  v_existing uuid[];
  v_item jsonb;
  v_index integer := 0;
  v_ids uuid[] := '{}';
  v_booking_id uuid;
  v_service public.services%rowtype;
  v_property_id uuid;
  v_date date;
  v_time time;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'INVALID_ITEMS' using errcode = 'P0001';
  end if;

  if p_idempotency_key is not null then
    -- Serialize concurrent calls that share a key, then replay if done.
    perform pg_advisory_xact_lock(hashtextextended('chatbot_booking_request:' || p_idempotency_key, 0));
    select booking_ids into v_existing
    from public.chatbot_booking_requests
    where idempotency_key = p_idempotency_key and customer_id = p_customer_id;
    if found then
      return query
        select b.* from unnest(v_existing) with ordinality as k(id, ord)
        join public.bookings b on b.id = k.id
        order by k.ord;
      return;
    end if;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_index := v_index + 1;
    v_property_id := (v_item->>'property_id')::uuid;
    v_date := (v_item->>'scheduled_date')::date;
    v_time := (v_item->>'scheduled_time')::time;

    if not exists (
      select 1 from public.properties p where p.id = v_property_id and p.customer_id = p_customer_id
    ) then
      raise exception 'INVALID_PROPERTY:%', v_index using errcode = 'P0001';
    end if;

    select * into v_service from public.services s
    where s.id = (v_item->>'service_id')::uuid and coalesce(s.active, true);
    if not found then
      raise exception 'INVALID_SERVICE:%', v_index using errcode = 'P0001';
    end if;

    -- Two customers confirming the same slot at once: the second waits here,
    -- then sees the first booking and fails cleanly.
    perform pg_advisory_xact_lock(hashtextextended(
      'chatbot_slot:' || v_service.id::text || ':' || v_date::text || ':' || v_time::text, 0));
    if exists (
      select 1 from public.bookings b
      where b.service_id = v_service.id
        and b.scheduled_date = v_date
        and b.scheduled_time = v_time
        and b.status <> 'cancelled'
    ) then
      raise exception 'SLOT_UNAVAILABLE:%', v_index using errcode = 'P0001';
    end if;

    insert into public.bookings (
      reference, customer_id, property_id, service_id,
      scheduled_date, scheduled_time, status, price, notes
    ) values (
      public.chatbot_generate_reference('BK'), p_customer_id, v_property_id, v_service.id,
      v_date, v_time, 'confirmed', v_service.base_price, nullif(v_item->>'notes', '')
    )
    returning id into v_booking_id;
    v_ids := v_ids || v_booking_id;
  end loop;

  if p_idempotency_key is not null then
    insert into public.chatbot_booking_requests (idempotency_key, customer_id, booking_ids)
    values (p_idempotency_key, p_customer_id, v_ids);
  end if;

  return query
    select b.* from unnest(v_ids) with ordinality as k(id, ord)
    join public.bookings b on b.id = k.id
    order by k.ord;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 3. Booking lifecycle events (POST /api/crm/events)
-- ════════════════════════════════════════════════════════════════════════

-- One row per CRM event id: a redelivered event is recognised and ignored, so
-- a customer is never notified twice for the same change.
create table if not exists public.chatbot_crm_events (
  event_id text primary key,
  event_type text not null,
  booking_id text,
  status text not null default 'processing'
    check (status in ('processing', 'processed', 'skipped', 'duplicate')),
  reason text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists chatbot_crm_events_received_idx
  on public.chatbot_crm_events (received_at);

-- ════════════════════════════════════════════════════════════════════════
-- 4. Geocoded service addresses (WhatsApp location pins)
-- ════════════════════════════════════════════════════════════════════════

alter table public.properties add column if not exists latitude double precision;
alter table public.properties add column if not exists longitude double precision;
alter table public.properties add column if not exists location_source text;
alter table public.properties add column if not exists place_id text;

-- ════════════════════════════════════════════════════════════════════════
-- 5. Voice-data retention and bookkeeping purge
-- ════════════════════════════════════════════════════════════════════════

-- Called daily by the backend (privacy/retentionScheduler.js).
--   * Stored voice-note transcripts older than p_transcript_days are replaced
--     with a placeholder (the message row itself is kept for the inbox).
--   * Voice-note media references older than p_media_days are deleted.
--   * Dedupe/ordering/idempotency/event bookkeeping older than p_state_days is
--     purged, and expired locks are removed.
create or replace function public.chatbot_apply_retention(
  p_transcript_days integer,
  p_media_days integer,
  p_state_days integer
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_transcripts integer := 0;
  v_media integer := 0;
  v_state integer := 0;
  v_rows integer := 0;
begin
  if p_transcript_days < 1 or p_media_days < 1 or p_state_days < 2 then
    raise exception 'INVALID_RETENTION_WINDOW' using errcode = 'P0001';
  end if;

  update public.messages
  set content = '[voice note transcript removed under retention policy]'
  where type = 'audio'
    and created_at < now() - make_interval(days => p_transcript_days)
    and content is distinct from '[voice note transcript removed under retention policy]';
  get diagnostics v_transcripts = row_count;

  delete from public.media_attachments
  where media_type = 'audio'
    and created_at < now() - make_interval(days => p_media_days);
  get diagnostics v_media = row_count;

  delete from public.processed_webhook_events
  where processed_at < now() - make_interval(days => p_state_days);
  get diagnostics v_rows = row_count; v_state := v_state + v_rows;

  delete from public.chatbot_message_order
  where updated_at < now() - make_interval(days => p_state_days);
  get diagnostics v_rows = row_count; v_state := v_state + v_rows;

  delete from public.chatbot_action_claims
  where state <> 'pending' and updated_at < now() - make_interval(days => p_state_days);
  get diagnostics v_rows = row_count; v_state := v_state + v_rows;

  delete from public.chatbot_crm_events
  where received_at < now() - make_interval(days => p_state_days);
  get diagnostics v_rows = row_count; v_state := v_state + v_rows;

  delete from public.chatbot_booking_requests
  where created_at < now() - make_interval(days => p_state_days);
  get diagnostics v_rows = row_count; v_state := v_state + v_rows;

  delete from public.chatbot_locks where expires_at < now() - interval '1 hour';
  get diagnostics v_rows = row_count; v_state := v_state + v_rows;

  return jsonb_build_object(
    'transcriptsRedacted', v_transcripts,
    'voiceMediaDeleted', v_media,
    'bookkeepingRowsPurged', v_state,
    'ranAt', now()
  );
end;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 6. Access: backend (service_role) only
-- ════════════════════════════════════════════════════════════════════════
-- These are internal bookkeeping tables. RLS with no policies plus revoked
-- grants keeps them unreachable with the browser's anon/publishable key;
-- service_role bypasses RLS. The backend must therefore run with
-- SUPABASE_SERVICE_ROLE_KEY set (it falls back to process-local protection
-- with a warning otherwise).

alter table public.chatbot_locks enable row level security;
alter table public.chatbot_message_order enable row level security;
alter table public.chatbot_action_claims enable row level security;
alter table public.chatbot_booking_requests enable row level security;
alter table public.chatbot_crm_events enable row level security;

revoke all on table
  public.chatbot_locks,
  public.chatbot_message_order,
  public.chatbot_action_claims,
  public.chatbot_booking_requests,
  public.chatbot_crm_events
from anon, authenticated;

grant select, insert, update, delete on table
  public.chatbot_locks,
  public.chatbot_message_order,
  public.chatbot_action_claims,
  public.chatbot_booking_requests,
  public.chatbot_crm_events
to service_role;

revoke all on function public.chatbot_try_lock(text, text, integer) from public, anon, authenticated;
revoke all on function public.chatbot_release_lock(text, text) from public, anon, authenticated;
revoke all on function public.chatbot_record_message_timestamp(text, bigint) from public, anon, authenticated;
revoke all on function public.chatbot_claim_action(text, text, integer) from public, anon, authenticated;
revoke all on function public.chatbot_complete_action(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.chatbot_release_action(text, text) from public, anon, authenticated;
revoke all on function public.chatbot_generate_reference(text) from public, anon, authenticated;
revoke all on function public.chatbot_create_bookings(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.chatbot_apply_retention(integer, integer, integer) from public, anon, authenticated;

grant execute on function public.chatbot_try_lock(text, text, integer) to service_role;
grant execute on function public.chatbot_release_lock(text, text) to service_role;
grant execute on function public.chatbot_record_message_timestamp(text, bigint) to service_role;
grant execute on function public.chatbot_claim_action(text, text, integer) to service_role;
grant execute on function public.chatbot_complete_action(text, text, text, jsonb) to service_role;
grant execute on function public.chatbot_release_action(text, text) to service_role;
grant execute on function public.chatbot_generate_reference(text) to service_role;
grant execute on function public.chatbot_create_bookings(uuid, jsonb, text) to service_role;
grant execute on function public.chatbot_apply_retention(integer, integer, integer) to service_role;

-- Make the new functions visible to PostgREST immediately.
notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- 7. Escalation SLA tracking and complaint priority (added 2026-10-05)
-- ════════════════════════════════════════════════════════════════════════
-- sla_breached_at / priority may already exist from the dashboard and
-- dispatch-automation migrations; "if not exists" keeps this safe.
alter table public.escalations add column if not exists priority text not null default 'normal';
alter table public.escalations add column if not exists sla_breached_at timestamptz;
-- Set once when the bot has reassured a waiting customer, so it never
-- repeats the message.
alter table public.escalations add column if not exists customer_notified_at timestamptz;
alter table public.complaints add column if not exists priority text not null default 'normal';

create index if not exists escalations_open_created_idx
  on public.escalations (created_at)
  where status = 'open';
