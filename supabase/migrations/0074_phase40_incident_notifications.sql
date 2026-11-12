-- A stale incident on a promoted deployment is worth telling someone about, and
-- nobody should have to refresh an audit page to find out. This pass writes one
-- in-app notification per workspace member per incident once that incident has
-- been open for a day, and never twice for the same incident.
--
-- Delivery stays in-app, matching the rest of the notification system: no email,
-- SMS or push is sent. Members can opt out with `notify_incidents`.

alter table public.workspace_notification_prefs
  add column if not exists notify_incidents boolean not null default true;

alter table public.workspace_notifications
  add column if not exists incident_id uuid
    references public.app_release_incidents (id) on delete cascade;

-- One notification per person per incident, no matter how often the pass runs.
create unique index if not exists workspace_notifications_one_per_incident_idx
  on public.workspace_notifications (user_id, incident_id)
  where incident_id is not null;

alter table public.workspace_notifications
  drop constraint if exists workspace_notifications_kind_check;
alter table public.workspace_notifications
  add constraint workspace_notifications_kind_check
  check (kind in ('assigned', 'comment', 'role_changed', 'member_joined', 'incident_stale'));

-- The opt-out has to be savable, so the preferences function carries it too.
drop function if exists public.set_workspace_notification_prefs(uuid, boolean, boolean, boolean);

create or replace function public.set_workspace_notification_prefs(
  p_workspace_id uuid,
  p_assignments boolean,
  p_comments boolean,
  p_membership boolean,
  p_incidents boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if public.workspace_role(p_workspace_id) is null then
    return jsonb_build_object('ok', false, 'code', 'no-workspace');
  end if;

  insert into public.workspace_notification_prefs (
    workspace_id, user_id, notify_assignments, notify_comments, notify_membership, notify_incidents
  )
  values (
    p_workspace_id,
    v_user,
    coalesce(p_assignments, true),
    coalesce(p_comments, true),
    coalesce(p_membership, true),
    coalesce(p_incidents, true)
  )
  on conflict (workspace_id, user_id) do update
    set notify_assignments = excluded.notify_assignments,
        notify_comments = excluded.notify_comments,
        notify_membership = excluded.notify_membership,
        notify_incidents = excluded.notify_incidents,
        updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.set_workspace_notification_prefs(uuid, boolean, boolean, boolean, boolean)
  from public, anon;
grant execute on function public.set_workspace_notification_prefs(uuid, boolean, boolean, boolean, boolean)
  to authenticated;

-- The scheduled pass. It has no session: it is called by the cron endpoint with
-- the service role, so no member can trigger notifications for someone else.
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
begin
  with stale as (
    select
      c.workspace_id,
      i.id as incident_id,
      i.title,
      i.severity,
      i.created_at,
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
      workspace_id, user_id, kind, incident_id, summary
    )
    select
      r.workspace_id,
      r.user_id,
      'incident_stale',
      r.incident_id,
      left(
        r.candidate_title || ': "' || r.title || '" has been open since '
        || to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI')
        || ' UTC (' || r.severity || ', ' || r.target || ' deployment).',
        300
      )
    from recipients r
    on conflict (user_id, incident_id) where incident_id is not null do nothing
    returning 1
  )
  select count(*) into v_delivered from inserted;

  return jsonb_build_object('ok', true, 'delivered', v_delivered);
end;
$$;

comment on function public.run_incident_notification_pass(timestamptz, uuid) is
  'One in-app notification per active member per promoted deployment incident that has been open for a day. Idempotent: a second run delivers nothing new.';

revoke all on function public.run_incident_notification_pass(timestamptz, uuid)
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.run_incident_notification_pass(timestamptz, uuid) to service_role;
  end if;
end;
$$;
