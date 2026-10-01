-- CRM Control Centre
-- Run after 202609300002_crm_dispatch_automation.sql.
--
-- Authentication is intentionally deferred. The temporary anon write policies
-- below keep the owner console usable with the publishable key. Replace them
-- with authenticated owner/admin policies before this CRM is internet-facing.

create extension if not exists pgcrypto;

create table if not exists public.crm_operational_targets (
  id uuid primary key default gen_random_uuid(),
  metric text not null unique,
  label text not null,
  target_value numeric not null check (target_value >= 0),
  unit text not null default 'number',
  period text not null default 'monthly' check (period in ('daily', 'weekly', 'monthly', 'quarterly')),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_automation_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  description text,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.crm_operational_targets (metric, label, target_value, unit, period)
values
  ('revenue', 'Revenue target', 100000, 'AED', 'monthly'),
  ('bookings', 'Booking target', 250, 'bookings', 'monthly'),
  ('completion_rate', 'Completion rate', 95, 'percent', 'monthly'),
  ('csat', 'Customer satisfaction', 4.7, 'score', 'monthly'),
  ('sla_compliance', 'SLA compliance', 95, 'percent', 'monthly')
on conflict (metric) do nothing;

insert into public.crm_automation_settings (key, label, description, enabled, config)
values
  ('sla_auto_escalation', 'SLA auto-escalation', 'Raise overdue complaints and escalations every 15 minutes.', true, '{"schedule":"*/15 * * * *"}'),
  ('overdue_booking_alerts', 'Overdue booking alerts', 'Surface scheduled work that has not progressed.', true, '{"grace_minutes":30}'),
  ('require_cancellation_notes', 'Cancellation notes', 'Require a reason before a booking is cancelled.', false, '{}'),
  ('require_closure_notes', 'Resolution notes', 'Require an internal note before closing a customer issue.', false, '{}')
on conflict (key) do nothing;

-- Technician capability fields are optional because the field-operations
-- migration may not be installed in every environment.
do $$
begin
  if to_regclass('public.technicians') is not null then
    alter table public.technicians add column if not exists skills text[] not null default '{}';
    alter table public.technicians add column if not exists service_areas text[] not null default '{}';
    alter table public.technicians add column if not exists leave_until date;
  end if;
end
$$;

alter table public.crm_operational_targets enable row level security;
alter table public.crm_automation_settings enable row level security;

revoke all on table public.crm_operational_targets from anon, authenticated;
revoke all on table public.crm_automation_settings from anon, authenticated;
grant select, insert, update on table public.crm_operational_targets to anon, authenticated;
grant select, insert, update on table public.crm_automation_settings to anon, authenticated;

drop policy if exists "control targets are readable" on public.crm_operational_targets;
create policy "control targets are readable" on public.crm_operational_targets
  for select to anon, authenticated using (true);
drop policy if exists "control targets are temporarily editable" on public.crm_operational_targets;
create policy "control targets are temporarily editable" on public.crm_operational_targets
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "automation settings are readable" on public.crm_automation_settings;
create policy "automation settings are readable" on public.crm_automation_settings
  for select to anon, authenticated using (true);
drop policy if exists "automation settings are temporarily editable" on public.crm_automation_settings;
create policy "automation settings are temporarily editable" on public.crm_automation_settings
  for all to anon, authenticated using (true) with check (true);

-- SLA policies were read-only in phase one. They are deliberately editable
-- here so an owner can operate the SLA configuration panel before auth lands.
grant update on table public.crm_sla_policies to anon, authenticated;
drop policy if exists "crm sla policies are temporarily editable" on public.crm_sla_policies;
create policy "crm sla policies are temporarily editable" on public.crm_sla_policies
  for update to anon, authenticated using (true) with check (breach_minutes > warning_minutes);

create index if not exists crm_operational_targets_active_idx on public.crm_operational_targets (active, metric);
create index if not exists crm_automation_settings_enabled_idx on public.crm_automation_settings (enabled, key);
