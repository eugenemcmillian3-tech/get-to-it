-- A promotion can be live and still be shaky: an incident opened against its
-- deployment may not be resolved yet. The audit view reads the whole-workspace
-- evidence through this function, so the open incident travels with it.
--
-- An incident counts as open until it is resolved or dismissed. Severity orders
-- which one is worth showing first when several are open.

create or replace function public.improvement_promotion_liveness(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_me uuid := auth.uid();
  v_rows jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if public.workspace_role(p_workspace_id) is null then
    return jsonb_build_object('ok', false, 'code', 'no-workspace');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'candidate_id', c.id,
        'deployment_id', d.id,
        'project_id', d.project_id,
        'target', d.target,
        'status', d.status,
        'approval_at', d.approval_at,
        'deployment_url', d.deployment_url,
        'external_deployment_id', d.external_deployment_id,
        'created_at', d.created_at,
        'rollback_title', rollback.title,
        'rollback_kind', rollback.recovery_kind,
        'rollback_resolved_at', rollback.resolved_at,
        'later_target', later.target,
        'later_created_at', later.created_at,
        'open_incident_count', open_count.total,
        'open_incident_title', open_incident.title,
        'open_incident_severity', open_incident.severity,
        'open_incident_status', open_incident.status,
        'open_incident_opened_at', open_incident.created_at
      )
      order by c.promoted_at desc nulls last
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.improvement_candidates c
  join public.app_deployments d on d.id = c.deployment_id
  left join lateral (
    select i.title, i.recovery_kind, i.resolved_at
    from public.app_release_incidents i
    where i.deployment_id = d.id
      and i.recovery_kind in ('code_rollback', 'config_rollback')
      and i.status in ('resolved', 'approved')
    order by i.resolved_at desc nulls last
    limit 1
  ) rollback on true
  left join lateral (
    select l.target, l.created_at
    from public.app_deployments l
    where l.project_id = d.project_id
      and l.target = d.target
      and l.status = 'succeeded'
      and l.created_at > d.created_at
    order by l.created_at
    limit 1
  ) later on true
  left join lateral (
    select count(*)::int as total
    from public.app_release_incidents i
    where i.deployment_id = d.id
      and i.status not in ('resolved', 'dismissed')
  ) open_count on true
  left join lateral (
    select i.title, i.severity, i.status, i.created_at
    from public.app_release_incidents i
    where i.deployment_id = d.id
      and i.status not in ('resolved', 'dismissed')
    order by
      case i.severity
        when 'critical' then 0
        when 'high' then 1
        when 'medium' then 2
        else 3
      end,
      i.created_at desc
    limit 1
  ) open_incident on true
  where c.workspace_id = p_workspace_id
    and c.status = 'promoted';

  return jsonb_build_object('ok', true, 'deployments', v_rows);
end;
$$;

comment on function public.improvement_promotion_liveness(uuid) is
  'Deployment status, resolved rollback, any later ship and any open incident for the promoted candidates of one workspace, for members who cannot read the deployment rows directly.';

revoke all on function public.improvement_promotion_liveness(uuid) from public, anon;
grant execute on function public.improvement_promotion_liveness(uuid) to authenticated;
