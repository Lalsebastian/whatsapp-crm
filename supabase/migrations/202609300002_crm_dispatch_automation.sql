-- CRM Dispatch Automation
-- Run after 202609300001_crm_operations_intelligence.sql.

alter table public.complaints add column if not exists priority text not null default 'normal'
  check (priority in ('low', 'normal', 'high', 'urgent'));
alter table public.complaints add column if not exists sla_breached_at timestamptz;
alter table public.escalations add column if not exists priority text not null default 'normal'
  check (priority in ('low', 'normal', 'high', 'urgent'));
alter table public.escalations add column if not exists sla_breached_at timestamptz;

create or replace function private.crm_sla_sweep()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  complaint_count integer := 0;
  escalation_count integer := 0;
begin
  update public.complaints c
  set status = 'escalated', sla_breached_at = coalesce(c.sla_breached_at, now()), updated_at = now()
  from public.crm_sla_policies p
  where p.entity_type = 'complaint'
    and p.priority = c.priority
    and p.active
    and c.status in ('open', 'in_progress')
    and c.created_at + make_interval(mins => p.breach_minutes) <= now();
  get diagnostics complaint_count = row_count;

  update public.escalations e
  set priority = 'urgent', sla_breached_at = coalesce(e.sla_breached_at, now())
  from public.crm_sla_policies p
  where p.entity_type = 'escalation'
    and p.priority = e.priority
    and p.active
    and e.status <> 'resolved'
    and e.created_at + make_interval(mins => p.breach_minutes) <= now();
  get diagnostics escalation_count = row_count;

  return jsonb_build_object('complaints_escalated', complaint_count, 'escalations_prioritized', escalation_count, 'ran_at', now());
end;
$$;

revoke all on function private.crm_sla_sweep() from public, anon, authenticated;

-- Supabase Cron uses pg_cron. Scheduling is idempotent: replace the named job.
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'joboy-crm-sla-sweep' limit 1;
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
  perform cron.schedule('joboy-crm-sla-sweep', '*/15 * * * *', 'select private.crm_sla_sweep()');
end
$$;

create index if not exists complaints_sla_queue_idx
  on public.complaints (status, priority, created_at)
  where status in ('open', 'in_progress');
create index if not exists escalations_sla_queue_idx
  on public.escalations (status, priority, created_at)
  where status <> 'resolved';
