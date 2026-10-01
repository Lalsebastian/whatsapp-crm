-- CRM Operations Intelligence
-- Apply in the Supabase SQL editor for project faadfckdtjkqeqfhtcgi.
-- Authentication is intentionally deferred, so audit/SLA reference data is
-- readable with the publishable key but can only be written by database
-- triggers or trusted server-side roles.

create extension if not exists pgcrypto;

alter table public.customers add column if not exists tags text[] not null default '{}';
alter table public.customers add column if not exists internal_notes text;

create table if not exists public.crm_activity_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('booking', 'complaint', 'escalation', 'assignment')),
  entity_id uuid not null,
  action text not null,
  changed_fields jsonb not null default '{}'::jsonb,
  previous_values jsonb not null default '{}'::jsonb,
  next_values jsonb not null default '{}'::jsonb,
  actor_id uuid,
  actor_label text,
  created_at timestamptz not null default now()
);

create index if not exists crm_activity_log_entity_idx
  on public.crm_activity_log (entity_type, entity_id, created_at desc);

create table if not exists public.crm_sla_policies (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  priority text not null default 'normal',
  warning_minutes integer not null check (warning_minutes > 0),
  breach_minutes integer not null check (breach_minutes > warning_minutes),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_type, priority)
);

insert into public.crm_sla_policies (entity_type, priority, warning_minutes, breach_minutes)
values
  ('complaint', 'normal', 1440, 4320),
  ('complaint', 'high', 480, 1440),
  ('complaint', 'urgent', 120, 480),
  ('escalation', 'normal', 60, 240),
  ('escalation', 'high', 30, 120),
  ('escalation', 'urgent', 15, 60)
on conflict (entity_type, priority) do nothing;

create schema if not exists private;

create or replace function private.crm_capture_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  new_row jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  entity_name text := case tg_table_name
    when 'bookings' then 'booking'
    when 'complaints' then 'complaint'
    when 'escalations' then 'escalation'
    else 'assignment'
  end;
  target_id uuid := coalesce(new.id, old.id);
begin
  if tg_op = 'UPDATE' and old_row = new_row then
    return new;
  end if;

  insert into public.crm_activity_log (
    entity_type, entity_id, action, changed_fields, previous_values, next_values, actor_id, actor_label
  ) values (
    entity_name,
    target_id,
    lower(tg_op),
    case when tg_op = 'UPDATE' then (
      select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
      from jsonb_each(new_row) n(key, value)
      where old_row -> key is distinct from value
    ) else new_row end,
    old_row,
    new_row,
    auth.uid(),
    coalesce(auth.jwt() ->> 'email', current_setting('request.jwt.claim.role', true), 'database')
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.crm_capture_activity() from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['bookings', 'complaints', 'escalations', 'job_assignments'] loop
    -- Field-operations tables are optional. Skip any table that has not been
    -- installed rather than failing the entire CRM intelligence migration.
    if to_regclass(format('public.%I', table_name)) is null then
      continue;
    end if;
    execute format('drop trigger if exists crm_activity_%I on public.%I', table_name, table_name);
    execute format(
      'create trigger crm_activity_%I after insert or update or delete on public.%I for each row execute function private.crm_capture_activity()',
      table_name,
      table_name
    );
  end loop;
end
$$;

alter table public.crm_activity_log enable row level security;
alter table public.crm_sla_policies enable row level security;

revoke all on table public.crm_activity_log from anon, authenticated;
revoke all on table public.crm_sla_policies from anon, authenticated;
grant select on table public.crm_activity_log to anon, authenticated;
grant select on table public.crm_sla_policies to anon, authenticated;

drop policy if exists "crm activity is readable by dashboard" on public.crm_activity_log;
create policy "crm activity is readable by dashboard"
  on public.crm_activity_log for select to anon, authenticated using (true);

drop policy if exists "crm sla policies are readable by dashboard" on public.crm_sla_policies;
create policy "crm sla policies are readable by dashboard"
  on public.crm_sla_policies for select to anon, authenticated using (active = true);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'crm_activity_log'
     ) then
    alter publication supabase_realtime add table public.crm_activity_log;
  end if;
end
$$;
