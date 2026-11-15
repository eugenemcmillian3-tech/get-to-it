-- Owner accounts do not pay AI credits and are not stopped by the shared daily
-- request cap. Every other account keeps the existing database-enforced limits.
--
-- The previous implementation is renamed instead of copied so there is exactly
-- one place where the paid limit rules live. The wrapper below delegates to it
-- for everyone who is not an owner.

alter function public.reserve_ai_request(text, text, text, uuid)
  rename to reserve_ai_request_limited;

revoke all on function public.reserve_ai_request_limited(text, text, text, uuid)
  from public, anon, authenticated;

create or replace function public.reserve_ai_request(
  p_kind text,
  p_model text,
  p_budget_kind text default null,
  p_budget_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_day date;
  v_in_flight integer;
  v_balance integer;
  v_request_id uuid;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if p_kind is null or p_kind not in (
    'unstuck', 'plan', 'task_help', 'learning', 'learning_help',
    'workflow_draft', 'future_paths', 'review', 'mission_assist',
    'app_repair', 'team_task'
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid-kind');
  end if;

  if (p_budget_kind is null) <> (p_budget_id is null) then
    return jsonb_build_object('ok', false, 'code', 'invalid-budget');
  end if;

  if p_budget_kind is not null
     and p_budget_kind not in ('workflow', 'build', 'swarm') then
    return jsonb_build_object('ok', false, 'code', 'invalid-budget');
  end if;

  if not public.app_is_owner() then
    return public.reserve_ai_request_limited(
      p_kind,
      p_model,
      p_budget_kind,
      p_budget_id
    );
  end if;

  -- An owner still gets one call at a time. This is what stops a double click
  -- from starting two paid provider calls; it is not a credit limit.
  update public.ai_requests
     set status = 'failed',
         error_code = 'timeout',
         finished_at = now()
   where user_id = v_user
     and status = 'in_flight'
     and started_at < now() - interval '120 seconds';

  select count(*) into v_in_flight
    from public.ai_requests
   where user_id = v_user and status = 'in_flight';

  if v_in_flight > 0 then
    return jsonb_build_object('ok', false, 'code', 'in-flight');
  end if;

  insert into public.ai_requests
    (user_id, kind, model, status, credits_charged, budget_kind, budget_id)
  values
    (v_user, p_kind, p_model, 'in_flight', 0, p_budget_kind, p_budget_id)
  returning id into v_request_id;

  v_day := (now() at time zone 'utc')::date;

  insert into public.ai_usage_daily (day, requests)
  values (v_day, 1)
  on conflict (day) do update
    set requests = public.ai_usage_daily.requests + 1,
        updated_at = now();

  select coalesce(sum(delta), 0) into v_balance
    from public.credit_ledger where user_id = v_user;

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request_id,
    'credits', 0,
    'remaining', 0,
    'free', true,
    'balance', v_balance,
    'budget_remaining', null
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'in-flight');
end;
$$;

revoke all on function public.reserve_ai_request(text, text, text, uuid)
  from public, anon;
grant execute on function public.reserve_ai_request(text, text, text, uuid)
  to authenticated;

comment on function public.reserve_ai_request(text, text, text, uuid) is
  'Reserves one AI call. Owners use it without credits or the shared daily cap; everyone else is delegated to reserve_ai_request_limited.';
