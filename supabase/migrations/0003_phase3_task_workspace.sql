-- GET TO IT — Phase 3 schema
-- Task workspace AI help.
--
-- Phase 3 adds no new tables. Task-workspace help is another AI entry point, so
-- it reuses the request log, the allowances and the one-at-a-time rule from
-- Phase 2. All this migration does is let the log record the new kind.
--
-- Nothing here stores model output: suggestions live in the browser until the
-- person adds them to their notes, and the notes are saved by the same
-- task_results upsert as before. A task's status is only ever changed by the
-- person themselves.

-- Allow the new request kind ------------------------------------------------
-- The check constraint was created inline in 0002 with Postgres' default name.

do $$
begin
  alter table public.ai_requests
    drop constraint if exists ai_requests_kind_check;

  alter table public.ai_requests
    add constraint ai_requests_kind_check
    check (kind in ('unstuck', 'plan', 'task_help'));
end $$;

-- Reservation function ------------------------------------------------------
-- Same body as Phase 2, with 'task_help' accepted. Daily counting, the global
-- ceiling and the in-flight rule are unchanged, so a person cannot get extra
-- requests by opening a task instead of a goal.

create or replace function public.reserve_ai_request(
  p_kind text,
  p_model text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_limits public.ai_limits;
  v_day_start timestamptz;
  v_used_by_user integer;
  v_used_globally integer;
  v_in_flight integer;
  v_request_id uuid;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if p_kind not in ('unstuck', 'plan', 'task_help') then
    return jsonb_build_object('ok', false, 'code', 'invalid-kind');
  end if;

  select * into v_limits from public.ai_limits where id = 1;
  if not found then
    v_limits.per_user_daily := 15;
    v_limits.global_daily := 200;
    v_limits.in_flight_seconds := 120;
  end if;

  v_day_start := ((now() at time zone 'utc')::date)::timestamp at time zone 'utc';

  -- A crashed or abandoned call must not lock someone out for the whole day.
  update public.ai_requests
     set status = 'failed',
         error_code = 'timeout',
         finished_at = now()
   where user_id = v_user
     and status = 'in_flight'
     and started_at < now() - make_interval(secs => v_limits.in_flight_seconds);

  select count(*) into v_used_by_user
    from public.ai_requests
   where user_id = v_user
     and started_at >= v_day_start;

  select count(*) into v_used_globally
    from public.ai_requests
   where started_at >= v_day_start;

  select count(*) into v_in_flight
    from public.ai_requests
   where user_id = v_user
     and status = 'in_flight';

  if v_in_flight > 0 then
    return jsonb_build_object('ok', false, 'code', 'in-flight');
  end if;

  if v_used_by_user >= v_limits.per_user_daily then
    return jsonb_build_object(
      'ok', false,
      'code', 'user-daily',
      'limit', v_limits.per_user_daily,
      'remaining', 0
    );
  end if;

  if v_used_globally >= v_limits.global_daily then
    return jsonb_build_object(
      'ok', false,
      'code', 'global-daily',
      'limit', v_limits.global_daily
    );
  end if;

  insert into public.ai_requests (user_id, kind, model, status)
  values (v_user, p_kind, p_model, 'in_flight')
  returning id into v_request_id;

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request_id,
    'limit', v_limits.per_user_daily,
    'remaining', v_limits.per_user_daily - v_used_by_user - 1
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'in-flight');
end;
$$;

revoke all on function public.reserve_ai_request(text, text) from public, anon;
grant execute on function public.reserve_ai_request(text, text) to authenticated;
