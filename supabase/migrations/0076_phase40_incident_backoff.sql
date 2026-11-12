-- Daily reminders forever turn a known issue into noise. The pass now follows a
-- fixed schedule instead:
--
--   day 1   first notification (also the first one for any incident that was
--           already stale before this schedule existed)
--   day 2   reminder
--   day 3   reminder
--   day 7   one escalation
--   after   silence until the incident is resolved or dismissed
--
-- `reminder_stage` records which of those a row is, so the inbox can tell an
-- escalation from an ordinary reminder.

alter table public.workspace_notifications
  add column if not exists reminder_stage text
    check (reminder_stage is null or reminder_stage in ('first', 'reminder', 'escalation'));

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
  v_escalated integer := 0;
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
  prior as (
    select n.user_id, n.incident_id
    from public.workspace_notifications n
    where n.incident_id is not null
    group by n.user_id, n.incident_id
  ),
  recipients as (
    select
      s.*,
      m.user_id,
      (prior_row.user_id is null) as never_notified
    from stale s
    join public.workspace_members m
      on m.workspace_id = s.workspace_id
     and m.status = 'active'
    left join public.workspace_notification_prefs prefs
      on prefs.workspace_id = s.workspace_id
     and prefs.user_id = m.user_id
    left join prior prior_row
      on prior_row.user_id = m.user_id
     and prior_row.incident_id = s.incident_id
    where coalesce(prefs.notify_incidents, true)
  ),
  staged as (
    select
      r.*,
      case
        when r.never_notified then 'first'
        when r.days_open in (2, 3) then 'reminder'
        when r.days_open = 7 then 'escalation'
      end as stage
    from recipients r
  ),
  inserted as (
    insert into public.workspace_notifications (
      workspace_id, user_id, kind, incident_id, reminder_day, reminder_stage, summary, created_at
    )
    select
      sel.workspace_id,
      sel.user_id,
      'incident_stale',
      sel.incident_id,
      v_day,
      sel.stage,
      left(
        case when sel.stage = 'escalation' then 'Escalation: ' else '' end
        || sel.candidate_title || ': "' || sel.title || '" has been open since '
        || to_char(sel.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI')
        || ' UTC, now ' || sel.days_open::text || ' day'
        || case when sel.days_open = 1 then '' else 's' end
        || ' (' || sel.severity || ', ' || sel.target || ' deployment).',
        300
      ),
      p_now
    from staged sel
    where sel.stage is not null
    on conflict (user_id, incident_id, reminder_day) where incident_id is not null do nothing
    returning reminder_stage
  )
  select
    count(*),
    count(*) filter (where reminder_stage = 'escalation')
  into v_delivered, v_escalated
  from inserted;

  return jsonb_build_object(
    'ok', true,
    'delivered', v_delivered,
    'escalated', v_escalated,
    'day', v_day
  );
end;
$$;

comment on function public.run_incident_notification_pass(timestamptz, uuid) is
  'In-app notifications for promoted deployment incidents open a day or more: first at day 1, reminders at days 2 and 3, one escalation at day 7, then silence until resolved.';

revoke all on function public.run_incident_notification_pass(timestamptz, uuid)
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.run_incident_notification_pass(timestamptz, uuid) to service_role;
  end if;
end;
$$;
