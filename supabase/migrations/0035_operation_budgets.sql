-- GET TO IT — operation prices and hard credit budgets
--
-- The approved card prices each operation in credits and caps the multi-call
-- paths. Postgres remains authoritative: a browser cannot choose a cheaper
-- price, and a budget is locked and charged in the same transaction as the
-- reservation.
--
-- Live billing and deployment are still gated. Existing ledger rows are not
-- changed.

-- ---------------------------------------------------------------------------
-- 1. Budget columns
-- ---------------------------------------------------------------------------

alter table public.workflow_runs
  add column if not exists credit_budget integer not null default 10,
  add column if not exists credits_spent integer not null default 0;

alter table public.workflow_runs
  drop constraint if exists workflow_runs_credit_budget_range;
alter table public.workflow_runs
  add constraint workflow_runs_credit_budget_range
  check (credit_budget between 1 and 10 and credits_spent between 0 and credit_budget);

alter table public.app_workspaces
  add column if not exists credit_budget integer not null default 6,
  add column if not exists credits_spent integer not null default 0;

alter table public.app_workspaces
  drop constraint if exists app_workspaces_credit_budget_range;
alter table public.app_workspaces
  add constraint app_workspaces_credit_budget_range
  check (credit_budget between 0 and 6 and credits_spent between 0 and credit_budget);

-- Three repair attempts at two credits each. This replaces the old two-attempt
-- cap; the workspace page and action use the same number.
alter table public.app_workspaces
  drop constraint if exists app_workspaces_iterations_check;
alter table public.app_workspaces
  add constraint app_workspaces_iterations_check
  check (iterations between 0 and 3);

alter table public.app_workspaces
  drop constraint if exists app_workspaces_ai_requests_check;
alter table public.app_workspaces
  add constraint app_workspaces_ai_requests_check
  check (ai_requests between 0 and 3);

alter table public.app_workspace_runs
  drop constraint if exists app_workspace_runs_iteration_check;
alter table public.app_workspace_runs
  add constraint app_workspace_runs_iteration_check
  check (iteration between 0 and 3);

-- A fixture-only swarm makes no paid model calls. A future AI path needs a new
-- migration and a non-zero budget, not a silent bypass.
alter table public.app_team_runs
  add column if not exists credit_budget integer not null default 0,
  add column if not exists credits_spent integer not null default 0;

alter table public.app_team_runs
  drop constraint if exists app_team_runs_credit_budget_range;
alter table public.app_team_runs
  add constraint app_team_runs_credit_budget_range
  check (credit_budget = 0 and credits_spent = 0);

alter table public.ai_requests
  add column if not exists budget_kind text,
  add column if not exists budget_id uuid;

alter table public.ai_requests
  drop constraint if exists ai_requests_budget_kind_check;
alter table public.ai_requests
  add constraint ai_requests_budget_kind_check
  check (budget_kind is null or budget_kind in ('workflow', 'build', 'swarm'));

alter table public.ai_requests
  drop constraint if exists ai_requests_budget_pair_check;
alter table public.ai_requests
  add constraint ai_requests_budget_pair_check
  check ((budget_kind is null) = (budget_id is null));

create index if not exists ai_requests_budget_idx
  on public.ai_requests (budget_kind, budget_id);

-- ---------------------------------------------------------------------------
-- 2. Reservation: fixed operation price + optional locked budget
-- ---------------------------------------------------------------------------

drop function if exists public.reserve_ai_request(text, text);

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
  v_limits public.ai_limits;
  v_day_start timestamptz;
  v_day date;
  v_used_globally integer;
  v_in_flight integer;
  v_balance integer;
  v_cost integer;
  v_request_id uuid;
  v_stale record;
  v_budget_limit integer;
  v_budget_spent integer;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  v_cost := case p_kind
    when 'app_repair' then 2
    when 'unstuck' then 1
    when 'plan' then 1
    when 'task_help' then 1
    when 'learning' then 1
    when 'learning_help' then 1
    when 'workflow_draft' then 1
    when 'future_paths' then 1
    when 'review' then 1
    when 'mission_assist' then 1
    else null
  end;

  if v_cost is null then
    return jsonb_build_object('ok', false, 'code', 'invalid-kind');
  end if;

  if (p_budget_kind is null) <> (p_budget_id is null) then
    return jsonb_build_object('ok', false, 'code', 'invalid-budget');
  end if;

  select * into v_limits from public.ai_limits where id = 1;
  if not found then
    v_limits.per_user_daily := 0;
    v_limits.global_daily := 200;
    v_limits.in_flight_seconds := 120;
  end if;

  v_day := (now() at time zone 'utc')::date;
  v_day_start := v_day::timestamp at time zone 'utc';

  -- Close abandoned calls, return their credits, and release their budget.
  for v_stale in
    select id, credits_charged, budget_kind, budget_id
      from public.ai_requests
     where user_id = v_user
       and status = 'in_flight'
       and started_at < now() - make_interval(secs => v_limits.in_flight_seconds)
  loop
    update public.ai_requests
       set status = 'failed',
           error_code = 'timeout',
           finished_at = now()
     where id = v_stale.id;

    if v_stale.credits_charged > 0 then
      insert into public.credit_ledger (user_id, delta, reason, request_id, note)
      values (
        v_user,
        v_stale.credits_charged,
        'ai_release',
        v_stale.id,
        'released after an interrupted request'
      )
      on conflict do nothing;

      if found and v_stale.budget_kind is not null then
        if v_stale.budget_kind = 'workflow' then
          update public.workflow_runs
             set credits_spent = greatest(credits_spent - v_stale.credits_charged, 0)
           where id = v_stale.budget_id and user_id = v_user;
        elsif v_stale.budget_kind = 'build' then
          update public.app_workspaces
             set credits_spent = greatest(credits_spent - v_stale.credits_charged, 0)
           where id = v_stale.budget_id and user_id = v_user;
        elsif v_stale.budget_kind = 'swarm' then
          update public.app_team_runs
             set credits_spent = greatest(credits_spent - v_stale.credits_charged, 0)
           where id = v_stale.budget_id and user_id = v_user;
        end if;
      end if;
    end if;
  end loop;

  select coalesce(requests, 0) into v_used_globally
    from public.ai_usage_daily
   where day = v_day;

  select count(*) into v_in_flight
    from public.ai_requests
   where user_id = v_user and status = 'in_flight';

  if v_in_flight > 0 then
    return jsonb_build_object('ok', false, 'code', 'in-flight');
  end if;

  if v_used_globally >= v_limits.global_daily then
    return jsonb_build_object('ok', false, 'code', 'global-daily');
  end if;

  select coalesce(sum(delta), 0) into v_balance
    from public.credit_ledger where user_id = v_user;

  if v_balance < v_cost then
    return jsonb_build_object(
      'ok', false,
      'code', 'needs-credits',
      'credits', v_cost,
      'balance', greatest(v_balance, 0)
    );
  end if;

  -- Lock the budget row before charging it. A second tab cannot reserve past
  -- the cap even if it reached the same action at the same time.
  if p_budget_kind is not null then
    if p_budget_kind = 'workflow' then
      select credit_budget, credits_spent
        into v_budget_limit, v_budget_spent
        from public.workflow_runs
       where id = p_budget_id and user_id = v_user
       for update;
    elsif p_budget_kind = 'build' then
      select credit_budget, credits_spent
        into v_budget_limit, v_budget_spent
        from public.app_workspaces
       where id = p_budget_id and user_id = v_user
       for update;
    elsif p_budget_kind = 'swarm' then
      select credit_budget, credits_spent
        into v_budget_limit, v_budget_spent
        from public.app_team_runs
       where id = p_budget_id and user_id = v_user
       for update;
    else
      return jsonb_build_object('ok', false, 'code', 'invalid-budget');
    end if;

    if not found then
      return jsonb_build_object('ok', false, 'code', 'invalid-budget');
    end if;

    if v_budget_spent + v_cost > v_budget_limit then
      return jsonb_build_object(
        'ok', false,
        'code', 'budget-exhausted',
        'budget', v_budget_limit,
        'spent', v_budget_spent,
        'credits', v_cost
      );
    end if;

    if p_budget_kind = 'workflow' then
      update public.workflow_runs
         set credits_spent = credits_spent + v_cost
       where id = p_budget_id and user_id = v_user;
    elsif p_budget_kind = 'build' then
      update public.app_workspaces
         set credits_spent = credits_spent + v_cost
       where id = p_budget_id and user_id = v_user;
    else
      update public.app_team_runs
         set credits_spent = credits_spent + v_cost
       where id = p_budget_id and user_id = v_user;
    end if;
  end if;

  insert into public.ai_requests
    (user_id, kind, model, status, credits_charged, budget_kind, budget_id)
  values
    (v_user, p_kind, p_model, 'in_flight', v_cost, p_budget_kind, p_budget_id)
  returning id into v_request_id;

  insert into public.credit_ledger (user_id, delta, reason, request_id, note)
  values (
    v_user,
    -v_cost,
    'ai_charge',
    v_request_id,
    'reserved for ' || p_kind || ' (' || v_cost || ' credits)'
  );

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
    'credits', v_cost,
    'remaining', 0,
    'free', false,
    'balance', v_balance,
    'budget_remaining',
      case when p_budget_kind is null then null
           else v_budget_limit - v_budget_spent - v_cost
      end
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'in-flight');
  when check_violation then
    return jsonb_build_object('ok', false, 'code', 'needs-credits');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Closing a request: release the credit and the reserved budget on failure
-- ---------------------------------------------------------------------------

create or replace function public.finish_ai_request(
  p_request_id uuid,
  p_status text,
  p_error text default null,
  p_tokens_in integer default null,
  p_tokens_out integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_charged integer;
  v_budget_kind text;
  v_budget_id uuid;
begin
  if v_user is null then
    return;
  end if;

  if p_status not in ('succeeded', 'failed') then
    raise exception 'finish_ai_request: unsupported status %', p_status;
  end if;

  update public.ai_requests
     set status = p_status,
         error_code = nullif(left(coalesce(p_error, ''), 120), ''),
         tokens_in = coalesce(p_tokens_in, tokens_in),
         tokens_out = coalesce(p_tokens_out, tokens_out),
         finished_at = now()
   where id = p_request_id
     and user_id = v_user
     and status = 'in_flight'
  returning credits_charged, budget_kind, budget_id
       into v_charged, v_budget_kind, v_budget_id;

  if v_charged is not null and v_charged > 0 and p_status = 'failed' then
    insert into public.credit_ledger (user_id, delta, reason, request_id, note)
    values (v_user, v_charged, 'ai_release', p_request_id, 'released after a failed request')
    on conflict do nothing;

    if found and v_budget_kind is not null then
      if v_budget_kind = 'workflow' then
        update public.workflow_runs
           set credits_spent = greatest(credits_spent - v_charged, 0)
         where id = v_budget_id and user_id = v_user;
      elsif v_budget_kind = 'build' then
        update public.app_workspaces
           set credits_spent = greatest(credits_spent - v_charged, 0)
         where id = v_budget_id and user_id = v_user;
      elsif v_budget_kind = 'swarm' then
        update public.app_team_runs
           set credits_spent = greatest(credits_spent - v_charged, 0)
         where id = v_budget_id and user_id = v_user;
      end if;
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------

revoke all on function public.reserve_ai_request(text, text, text, uuid) from public, anon;
revoke all on function public.finish_ai_request(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.reserve_ai_request(text, text, text, uuid) to authenticated;
grant execute on function public.finish_ai_request(uuid, text, text, integer, integer) to authenticated;
