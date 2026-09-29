-- Home Services Booking & Complaint Management — Supabase schema additions.
-- Run this manually in the Supabase SQL editor. No migration tool is used in
-- this project; every statement here is additive/idempotent (safe to re-run).

create extension if not exists pgcrypto;

-- ── Customers ────────────────────────────────────────────────────────────
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  name text,
  preferred_language text default 'en',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Properties / service addresses per customer ─────────────────────────
create table if not exists properties (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete cascade,
  label text,
  address_line text not null,
  area text,
  city text default 'Dubai',
  is_default boolean default false,
  created_at timestamptz default now()
);

-- ── Service catalog ──────────────────────────────────────────────────────
create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  description text,
  base_price numeric,
  duration_minutes int,
  active boolean default true,
  created_at timestamptz default now()
);

-- ── Bookings ─────────────────────────────────────────────────────────────
create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  reference text unique not null,
  customer_id uuid references customers(id),
  property_id uuid references properties(id),
  service_id uuid references services(id),
  scheduled_date date,
  scheduled_time time,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'rescheduled')),
  price numeric,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Complaints ───────────────────────────────────────────────────────────
create table if not exists complaints (
  id uuid primary key default gen_random_uuid(),
  reference text unique not null,
  customer_id uuid references customers(id),
  booking_id uuid references bookings(id),
  category text not null
    check (category in (
      'service_not_completed', 'problem_returned', 'technician_delayed',
      'technician_behaviour', 'property_damage', 'payment_issue', 'other'
    )),
  description text,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'resolved', 'closed', 'escalated')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ── Media attachments (images/videos/voice notes on complaints/bookings) ─
create table if not exists media_attachments (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid references complaints(id),
  booking_id uuid references bookings(id),
  customer_id uuid references customers(id),
  wa_media_id text not null,
  media_type text check (media_type in ('image', 'video', 'audio', 'document')),
  storage_url text,
  created_at timestamptz default now()
);

-- ── Human escalations ────────────────────────────────────────────────────
create table if not exists escalations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id),
  phone text not null,
  reason text,
  conversation_summary text,
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  created_at timestamptz default now(),
  resolved_at timestamptz
);

-- ── Sessions (conversation state per phone number) ──────────────────────
-- Base shape matches the pre-refactor app's table; created here too so this
-- script works whether or not that app's tables already exist in this project.
create table if not exists sessions (
  phone text primary key,
  state text default 'IDLE',
  data jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table sessions add column if not exists customer_id uuid references customers(id);
alter table sessions add column if not exists current_flow text;
alter table sessions add column if not exists current_step text;
alter table sessions add column if not exists context jsonb default '{}'::jsonb;
alter table sessions add column if not exists preferred_language text;
alter table sessions add column if not exists human_takeover boolean default false;
alter table sessions add column if not exists last_activity_at timestamptz default now();

-- ── Messages (inbound/outbound log, feeds the dashboard's Live Messages tab) ─
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  type text,
  content text,
  created_at timestamptz default now()
);

alter table messages add column if not exists direction text default 'inbound' check (direction in ('inbound', 'outbound'));
alter table messages add column if not exists wa_message_id text;
alter table messages add column if not exists intent text;

-- ── Helpful indexes ──────────────────────────────────────────────────────
create index if not exists idx_bookings_customer on bookings(customer_id);
create index if not exists idx_complaints_customer on complaints(customer_id);
create index if not exists idx_media_complaint on media_attachments(complaint_id);
create index if not exists idx_messages_phone on messages(phone);

-- ── Seed a starter service catalog (edit/replace with the real one) ─────
insert into services (name, category, description, base_price, duration_minutes)
select * from (values
  ('AC Service & Repair', 'ac', 'General AC servicing, gas top-up, and repair', 150, 60),
  ('Plumbing', 'plumbing', 'Leak fixes, pipe/fitting repair and installation', 100, 60),
  ('Electrical', 'electrical', 'Wiring, switches, fixture installation and repair', 120, 60),
  ('Home Cleaning', 'cleaning', 'Deep cleaning for apartments and villas', 200, 120),
  ('Pest Control', 'pest_control', 'General pest treatment', 180, 90)
) as v(name, category, description, base_price, duration_minutes)
where not exists (select 1 from services);
