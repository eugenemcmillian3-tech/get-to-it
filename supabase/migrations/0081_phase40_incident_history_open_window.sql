-- "What was open during October" is a different question from "what closed in
-- October": an incident can be opened before the period and closed after it, and a
-- review still has to see it. This adds an open-window filter with overlap
-- semantics: an incident matches when it was open at any point inside the range.
--
-- Overlap at day granularity, in UTC:
--   opened on or before the last day of the range
--   closed on or after the first day of the range
-- Both ends are inclusive. Either end may be omitted for an open-ended window. A
-- window whose start is after its end matches nothing: the page says so, and an
-- overlap query would otherwise quietly answer a different question ("open across
-- the whole span").

drop function if exists public.workspace_incident_history(
  uuid, integer, integer, text, text, text, date, date
);

create or replace function public.workspace_incident_history(
  p_workspace_id uuid,
  p_limit integer default 20,
  p_offset integer default 0,
  p_severity text default null,
  p_status text default null,
  p_query text default null,
  p_closed_from date default null,
  p_closed_to date default null,
  p_open_from date default null,
  p_open_to date default null
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

  if p_open_from is not null and p_open_to is not null and p_open_from > p_open_to then
    return jsonb_build_object(
      'ok', true,
      'total', 0,
      'limit', v_limit,
      'offset', v_offset,
      'incidents', '[]'::jsonb
    );
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
    )
    and (
      p_closed_from is null
      or (coalesce(i.resolved_at, i.updated_at) at time zone 'UTC')::date >= p_closed_from
    )
    and (
      p_closed_to is null
      or (coalesce(i.resolved_at, i.updated_at) at time zone 'UTC')::date <= p_closed_to
    )
    and (
      p_open_from is null
      or (coalesce(i.resolved_at, i.updated_at) at time zone 'UTC')::date >= p_open_from
    )
    and (
      p_open_to is null
      or (i.created_at at time zone 'UTC')::date <= p_open_to
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
      and (
        p_closed_from is null
        or (coalesce(i.resolved_at, i.updated_at) at time zone 'UTC')::date >= p_closed_from
      )
      and (
        p_closed_to is null
        or (coalesce(i.resolved_at, i.updated_at) at time zone 'UTC')::date <= p_closed_to
      )
      and (
        p_open_from is null
        or (coalesce(i.resolved_at, i.updated_at) at time zone 'UTC')::date >= p_open_from
      )
      and (
        p_open_to is null
        or (i.created_at at time zone 'UTC')::date <= p_open_to
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

comment on function public.workspace_incident_history(uuid, integer, integer, text, text, text, date, date, date, date) is
  'Closed incidents on promoted deployments with the notifications delivered for each: filterable by severity, closing status, literal text, an inclusive UTC closed-date range and an open window (incidents open at any point inside it), paged by limit and offset, with the total number of matches.';

revoke all on function public.workspace_incident_history(uuid, integer, integer, text, text, text, date, date, date, date)
  from public, anon;
grant execute on function public.workspace_incident_history(uuid, integer, integer, text, text, text, date, date, date, date)
  to authenticated;
