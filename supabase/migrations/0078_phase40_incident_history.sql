-- The days after an incident closes, the only trace is its notifications. This
-- read gathers every closed incident that was opened against the deployment of a
-- promoted change, together with the notifications the scheduled pass delivered
-- for it, so the trail can be reviewed after the fact without opening each
-- deployment.
--
-- Closed means resolved or dismissed. Only the notification rows are evidence of
-- delivery: an incident closed before it had been open for a day has none, and
-- that is shown as itself rather than inferred.

create or replace function public.workspace_incident_history(
  p_workspace_id uuid,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_me uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_rows jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if public.workspace_role(p_workspace_id) is null then
    return jsonb_build_object('ok', false, 'code', 'no-workspace');
  end if;

  select coalesce(jsonb_agg(entry.body order by entry.closed_at desc), '[]'::jsonb)
  into v_rows
  from (
    select
      coalesce(i.resolved_at, i.updated_at) as closed_at,
      jsonb_build_object(
        'id', i.id,
        'title', i.title,
        'severity', i.severity,
        'status', i.status,
        'trigger', i."trigger",
        'opened_at', i.created_at,
        'closed_at', coalesce(i.resolved_at, i.updated_at),
        'recovery_kind', i.recovery_kind,
        'candidate_id', c.id,
        'candidate_title', c.title,
        'deployment_id', d.id,
        'target', d.target,
        'notifications', coalesce(
          (
            select jsonb_agg(
                     jsonb_build_object(
                       'user_id', n.user_id,
                       'stage', n.reminder_stage,
                       'day', n.reminder_day,
                       'sent_at', n.created_at,
                       'read_at', n.read_at,
                       'summary', n.summary
                     )
                     order by n.created_at
                   )
            from public.workspace_notifications n
            where n.incident_id = i.id
              and n.workspace_id = c.workspace_id
          ),
          '[]'::jsonb
        )
      ) as body
    from public.improvement_candidates c
    join public.app_deployments d on d.id = c.deployment_id
    join public.app_release_incidents i on i.deployment_id = d.id
    where c.workspace_id = p_workspace_id
      and c.status = 'promoted'
      and i.status in ('resolved', 'dismissed')
    order by coalesce(i.resolved_at, i.updated_at) desc
    limit v_limit
  ) entry;

  return jsonb_build_object('ok', true, 'incidents', v_rows);
end;
$$;

comment on function public.workspace_incident_history(uuid, integer) is
  'Closed incidents on promoted deployments with the notifications delivered for each, for any member of the workspace.';

revoke all on function public.workspace_incident_history(uuid, integer) from public, anon;
grant execute on function public.workspace_incident_history(uuid, integer) to authenticated;
