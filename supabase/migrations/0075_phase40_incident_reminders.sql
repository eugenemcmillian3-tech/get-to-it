-- One notification about a stale incident is easy to miss, and an incident that
-- stays open for a week deserves more than a single ping. The scheduled pass now
-- adds at most one notification per person per incident per UTC day, so it acts
-- as a daily reminder that stops on its own the moment the incident is resolved
-- or dismissed.
--
-- Uniqueness moves from "one per incident, ever" to "one per incident per day".
-- A `reminder_day` column carries the day explicitly so the index needs no
-- timezone-dependent expression.

alter table public.workspace_notifications
  add column if not exists reminder_day date;

drop index if exists public.workspace_notifications_one_per_incident_idx;

create unique index if not exists workspace_notifications_one_per_incident_day_idx
  on public.workspace_notifications (user_id, incident_id, reminder_day)
  where incident_id is not null;

create or replace function public.run_incident_notification_pass(
  p_now timestamptz default now(),
  p_workspace_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivered integer := 0;
  v_day date := (p_now at time zone 'UTC')::date;
begin
  with stale as (
    select
      c.workspace_id,
      i.id as incident_id,
      i.title,
      i.severity,
      i.created_at,
      greatest(1, floor(extract(epoch from (p_now - i.created_at)) / 86400)::int) as days_open,
      c.title as candidate_title,
      d.target
    from public.improvement_candidates c
    join public.app_deployments d on d.id = c.deployment_id
    join public.app_release_incidents i on i.deployment_id = d.id
    where c.status = 'promoted'
      and i.status not in ('resolved', 'dismissed')
      and i.created_at <= p_now - interval '24 hours'
      and (p_workspace_id is null or c.workspace_id = p_workspace_id)
  ),
  recipients as (
    select s.*, m.user_id
    from stale s
    join public.workspace_members m
      on m.workspace_id = s.workspace_id
     and m.status = 'active'
    left join public.workspace_notification_prefs p
      on p.workspace_id = s.workspace_id
     and p.user_id = m.user_id
    where coalesce(p.notify_incidents, true)
  ),
  inserted as (
    insert into public.workspace_notifications (
      workspace_id, user_id, kind, incident_id, reminder_day, summary, created_at
    )
    select
      r.workspace_id,
      r.user_id,
      'incident_stale',
      r.incident_id,
      v_day,
      left(
        r.candidate_title || ': "' || r.title || '" has been open since '
        || to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI')
        || ' UTC, now ' || r.days_open::text || ' day' || case when r.days_open = 1 then '' else 's' end
        || ' (' || r.severity || ', ' || r.target || ' deployment).',
        300
      ),
      p_now
    from recipients r
    on conflict (user_id, incident_id, reminder_day) where incident_id is not null do nothing
    returning 1
  )
  select count(*) into v_delivered from inserted;

  return jsonb_build_object('ok', true, 'delivered', v_delivered, 'day', v_day);
end;
$$;

comment on function public.run_incident_notification_pass(timestamptz, uuid) is
  'At most one in-app notification per active member per promoted deployment incident per UTC day, while the incident stays open. Idempotent within a day.';

revoke all on function public.run_incident_notification_pass(timestamptz, uuid)
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.run_incident_notification_pass(timestamptz, uuid) to service_role;
  end if;
end;
$$;
