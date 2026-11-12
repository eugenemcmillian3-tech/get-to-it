-- Knowing an incident is open is not enough: one that has sat for a week is a
-- different problem from one opened an hour ago. The audit view lists every open
-- incident for a promoted deployment so it can show how long each has been open.
--
-- The list is capped at five per deployment, most severe first and oldest first
-- within a severity; the count stays the true total.

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
        'open_incident_count', open_info.total,
        'open_incidents', open_info.items
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
    with open_rows as (
      select
        i.title,
        i.severity,
        i.status,
        i.created_at,
        case i.severity
          when 'critical' then 0
          when 'high' then 1
          when 'medium' then 2
          else 3
        end as rank
      from public.app_release_incidents i
      where i.deployment_id = d.id
        and i.status not in ('resolved', 'dismissed')
    )
    select
      (select count(*)::int from open_rows) as total,
      (
        select jsonb_agg(
                 jsonb_build_object(
                   'title', o.title,
                   'severity', o.severity,
                   'status', o.status,
                   'opened_at', o.created_at
                 )
                 order by o.rank, o.created_at
               )
        from (select * from open_rows order by rank, created_at limit 5) o
      ) as items
  ) open_info on true
  where c.workspace_id = p_workspace_id
    and c.status = 'promoted';

  return jsonb_build_object('ok', true, 'deployments', v_rows);
end;
$$;

comment on function public.improvement_promotion_liveness(uuid) is
  'Deployment status, resolved rollback, any later ship and the open incidents for the promoted candidates of one workspace, for members who cannot read the deployment rows directly.';

revoke all on function public.improvement_promotion_liveness(uuid) from public, anon;
grant execute on function public.improvement_promotion_liveness(uuid) to authenticated;
