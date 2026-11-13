-- The history page has to stay usable after months of incidents. This adds
-- filtering and paging to the same read: severity, closing status, and a literal
-- text match on the incident or the promoted change it belongs to.
--
-- `total` is the number of incidents that match the filters, not the number on
-- the page, so the caller can render "showing 21-40 of 63" without a second call.
-- The filter values are validated here rather than trusted from the browser, and
-- the text match uses `position` so a `%` in the search is a literal character.

drop function if exists public.workspace_incident_history(uuid, integer);

create or replace function public.workspace_incident_history(
  p_workspace_id uuid,
  p_limit integer default 20,
  p_offset integer default 0,
  p_severity text default null,
  p_status text default null,
  p_query text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_me uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_query text := nullif(btrim(coalesce(p_query, '')), '');
  v_total integer := 0;
  v_rows jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if public.workspace_role(p_workspace_id) is null then
    return jsonb_build_object('ok', false, 'code', 'no-workspace');
  end if;

  -- Null means "no filter", so each value is checked against its allow-list rather
  -- than negated: anything outside the list is refused, and null passes by design.
  if not (p_severity is null or p_severity in ('low', 'medium', 'high', 'critical')) then
    return jsonb_build_object('ok', false, 'code', 'bad-filter');
  end if;

  if not (p_status is null or p_status in ('resolved', 'dismissed')) then
    return jsonb_build_object('ok', false, 'code', 'bad-filter');
  end if;

  select count(*)
  into v_total
  from public.improvement_candidates c
  join public.app_deployments d on d.id = c.deployment_id
  join public.app_release_incidents i on i.deployment_id = d.id
  where c.workspace_id = p_workspace_id
    and c.status = 'promoted'
    and i.status in ('resolved', 'dismissed')
    and (p_severity is null or i.severity = p_severity)
    and (p_status is null or i.status = p_status)
    and (
      v_query is null
      or position(lower(v_query) in lower(i.title || ' ' || c.title)) > 0
    );

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
      and (p_severity is null or i.severity = p_severity)
      and (p_status is null or i.status = p_status)
      and (
        v_query is null
        or position(lower(v_query) in lower(i.title || ' ' || c.title)) > 0
      )
    order by coalesce(i.resolved_at, i.updated_at) desc
    offset v_offset
    limit v_limit
  ) entry;

  return jsonb_build_object(
    'ok', true,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'incidents', v_rows
  );
end;
$$;

comment on function public.workspace_incident_history(uuid, integer, integer, text, text, text) is
  'Closed incidents on promoted deployments with the notifications delivered for each: filterable by severity, closing status and a literal text match, paged by limit and offset, with the total number of matches.';

revoke all on function public.workspace_incident_history(uuid, integer, integer, text, text, text)
  from public, anon;
grant execute on function public.workspace_incident_history(uuid, integer, integer, text, text, text)
  to authenticated;
