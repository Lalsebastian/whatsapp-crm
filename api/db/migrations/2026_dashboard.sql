-- Dashboard migration — role-based operations console.
--
-- Additive and idempotent, same contract as schema.sql: every statement is
-- `if not exists` or `add column if not exists`, so this file is safe to re-run
-- against a project that already has part of it applied.
--
-- Run AFTER schema.sql. Nothing here drops or rewrites an existing column, so a
-- live deployment keeps working while the dashboard is being built against it.

create extension if not exists pgcrypto;

-- ── Technicians ──────────────────────────────────────────────────────────
-- There was no technician model at all: bookings had no owner and there was no
-- way to answer "who is free on Thursday". `bookings.technician_id` (added
-- below) and the utilisation KPI both hang off this table.
create table if not exists technicians (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text unique,
  email text,
  role text default 'technician',
  active boolean default true,
  -- Working hours drive the utilisation denominator. Stored as plain numbers of
  -- minutes so the dashboard can compute "assigned minutes / available minutes"
  -- without a calendar library on either side.
  shift_start_minute int default 480 check (shift_start_minute between 0 and 1439),
  shift_end_minute int default 1020 check (shift_end_minute between 0 and 1439),
  weekly_capacity_minutes int default 2400,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

comment on column technicians.shift_start_minute is 'Minutes from midnight, e.g. 480 = 08:00';

-- ── Bookings: field-ops columns ──────────────────────────────────────────
-- `technician_id` is what makes the technician view possible; `priority` and
-- `agent_notes` are what make the board sortable and the bulk actions useful.
alter table bookings add column if not exists technician_id uuid references technicians(id);
alter table bookings add column if not exists priority text default 'normal'
  check (priority in ('low', 'normal', 'high', 'urgent'));
alter table bookings add column if not exists agent_notes text;
alter table bookings add column if not exists started_at timestamptz;
alter table bookings add column if not exists completed_at timestamptz;
alter table bookings add column if not exists resolution_notes text;

-- ── Complaints: assignment columns ──────────────────────────────────────
alter table complaints add column if not exists priority text default 'normal'
  check (priority in ('low', 'normal', 'high', 'urgent'));
alter table complaints add column if not exists assigned_to uuid references technicians(id);
alter table complaints add column if not exists agent_notes text;
alter table complaints add column if not exists resolved_at timestamptz;

-- ── Escalations: the agent queue needs to know who owns one ─────────────
alter table escalations add column if not exists assigned_to uuid references technicians(id);
alter table escalations add column if not exists priority text default 'normal'
  check (priority in ('low', 'normal', 'high', 'urgent'));

-- ── Sessions: link a conversation to its customer and detect staleness ───
alter table sessions add column if not exists customer_id uuid references customers(id);

-- ── Messages: intent detection and session linkage are read by the Inbox ─
alter table messages add column if not exists session_state text;
alter table messages add column if not exists message_type text;
alter table messages add column if not exists error text;

-- ── Job assignments ─────────────────────────────────────────────────────
-- A separate table rather than columns on bookings, because the same booking
-- can gain and lose a technician over its life and each hand-off is worth
-- keeping. The dashboard reads the latest row per booking.
create table if not exists job_assignments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  technician_id uuid references technicians(id),
  assigned_by text,
  assigned_at timestamptz default now(),
  unassigned_at timestamptz,
  notes text
);

-- ── Job photos (technician evidence uploaded from the field) ─────────────
-- `storage_path` is the key inside the `job-media` bucket, not a public URL —
-- URLs are signed at read time so the anon key cannot list the bucket.
create table if not exists job_photos (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  technician_id uuid references technicians(id),
  storage_path text not null,
  caption text,
  captured_at timestamptz default now(),
  created_at timestamptz default now()
);

-- ── Job signatures ──────────────────────────────────────────────────────
-- The signature is stored as a data URL image. Storing the image rather than a
-- boolean keeps the evidence auditable, which matters because a disputed job is
-- exactly the case where "we have their signature" settles the argument.
create table if not exists job_signatures (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings(id) on delete cascade,
  technician_id uuid references technicians(id),
  signer_name text,
  signature_data text not null,
  signed_at timestamptz default now(),
  created_at timestamptz default now()
);

-- ── Satisfaction surveys (CSAT) ─────────────────────────────────────────
-- Created by the backend sweep, answered by the customer replying 1-5. One
-- outstanding survey per complaint is what gates the conversationRouter branch:
-- an answered survey has responded_at set, and the branch only fires on NULL.
create table if not exists satisfaction_surveys (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid references complaints(id) on delete cascade,
  booking_id uuid references bookings(id) on delete cascade,
  customer_id uuid references customers(id),
  phone text not null,
  rating int check (rating between 1 and 5),
  comment text,
  -- Set when the message was actually sent. A row with sent_at set but
  -- responded_at null is an unanswered survey, and is what the router checks.
  asked_at timestamptz default now(),
  sent_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz default now()
);

-- ── Conversation events (funnel metrics) ────────────────────────────────
-- Every funnel step the owner dashboard reports on is one row here. Metrics
-- are computed as distinct phones per event so a chatty customer is counted
-- once rather than once per message.
create table if not exists conversation_events (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  event text not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

comment on table conversation_events is 'Funnel steps: conversation_started, service_selected, booking_confirmed, complaint_submitted';

-- ── Indexes ──────────────────────────────────────────────────────────────
-- Every index here backs a filter, sort or FK the dashboard actually queries.
create index if not exists idx_bookings_technician on bookings(technician_id);
create index if not exists idx_bookings_status on bookings(status);
create index if not exists idx_bookings_scheduled on bookings(scheduled_date);
create index if not exists idx_bookings_created on bookings(created_at);
create index if not exists idx_complaints_status on complaints(status);
create index if not exists idx_complaints_priority on complaints(priority);
create index if not exists idx_complaints_assigned on complaints(assigned_to);
create index if not exists idx_complaints_resolved on complaints(resolved_at);
create index if not exists idx_escalations_status on escalations(status);
create index if not exists idx_technicians_active on technicians(active);
create index if not exists idx_job_assignments_booking on job_assignments(booking_id);
create index if not exists idx_job_assignments_technician on job_assignments(technician_id);
create index if not exists idx_job_photos_booking on job_photos(booking_id);
create index if not exists idx_job_signatures_booking on job_signatures(booking_id);
-- The CSAT sweep's hot query: outstanding surveys for a phone, newest first.
create index if not exists idx_surveys_phone_pending
  on satisfaction_surveys(phone, asked_at desc)
  where responded_at is null;
create index if not exists idx_surveys_complaint on satisfaction_surveys(complaint_id);
-- Funnel aggregation: distinct phones per event over a time window.
create index if not exists idx_conversation_events_event on conversation_events(event, created_at);
create index if not exists idx_conversation_events_phone on conversation_events(phone);

-- ── Row Level Security stays off, matching schema.sql ───────────────────
-- The dashboard reads with the anon key, so RLS-enabled tables with no policies
-- would render empty rather than error. Enabling RLS is a separate, later
-- change that must ship together with auth — see "Security debt" in the plan.
alter table technicians disable row level security;
alter table job_assignments disable row level security;
alter table job_photos disable row level security;
alter table job_signatures disable row level security;
alter table satisfaction_surveys disable row level security;
alter table conversation_events disable row level security;

-- ── Realtime publication ────────────────────────────────────────────────
-- Postgres Changes has no REST equivalent, so the dashboard cannot get live
-- updates without the tables being in the publication. Creating the
-- publication is idempotent; adding an existing table is not, which is why
-- each add is wrapped.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'messages', 'bookings', 'complaints', 'escalations',
    'job_photos', 'job_signatures', 'satisfaction_surveys'
  ] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

-- ── Storage: the job-media bucket ───────────────────────────────────────
-- Technician photos and signatures. Public read so `<img src>` works without
-- signing; the anon-key exposure is the same as the rest of the dashboard and
-- is called out in "Security debt". Tighten this with the auth work, not before.
insert into storage.buckets (id, name, public)
values ('job-media', 'job-media', true)
on conflict (id) do nothing;

-- Bucket-scoped policies. Written at all so uploads work once the table
-- exists — a missing policy fails with 42501 and would otherwise look like an
-- app bug during Phase 5 testing.
drop policy if exists "job-media public read" on storage.objects;
create policy "job-media public read"
  on storage.objects for select
  using (bucket_id = 'job-media');

drop policy if exists "job-media anon upload" on storage.objects;
create policy "job-media anon upload"
  on storage.objects for insert
  with check (bucket_id = 'job-media');

drop policy if exists "job-media anon update" on storage.objects;
create policy "job-media anon update"
  on storage.objects for update
  using (bucket_id = 'job-media')
  with check (bucket_id = 'job-media');

drop policy if exists "job-media anon delete" on storage.objects;
create policy "job-media anon delete"
  on storage.objects for delete
  using (bucket_id = 'job-media');
