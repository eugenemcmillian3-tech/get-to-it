-- GET TO IT — model-backed agent teams and platform self-healing
--
-- Two related changes:
--   1. The six existing agent roles can use the six configured Ollama models.
--      Fixture mode remains free and unchanged; model mode reserves two credits
--      per task from a hard run budget.
--   2. A service-role-only recovery pass releases abandoned AI reservations and
--      re-queues (or fails) agent tasks whose worker disappeared.
--
-- This does not deploy, roll back production, call a model or bypass any owner
-- review or integration gate.

-- ---------------------------------------------------------------------------
-- 1. Agent-run mode, per-role models and a bounded paid budget
-- ---------------------------------------------------------------------------

alter table public.app_team_runs
  add column if not exists model_by_role jsonb not null default '{}'::jsonb;

alter table public.app_team_runs
  drop constraint if exists app_team_runs_model_by_role_check;
alter table public.app_team_runs
  add constraint app_team_runs_model_by_role_check
  check (jsonb_typeof(model_by_role) = 'object' and octet_length(model_by_role::text) <= 2000);

-- The original anonymous check only allowed the literal 'fixture'. Drop any
-- check that mentions both mode and fixture before adding the named one.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
      from pg_constraint
     where conrelid = 'public.app_team_runs'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%mode%'
       and pg_get_constraintdef(oid) like '%fixture%'
  loop
    execute format('alter table public.app_team_runs drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.app_team_runs
  add constraint app_team_runs_mode_check
  check (mode in ('fixture', 'model'));

alter table public.app_team_runs
  drop constraint if exists app_team_runs_credit_budget_range;
alter table public.app_team_runs
  add constraint app_team_runs_credit_budget_range
  check (
    (mode = 'fixture' and credit_budget = 0 and credits_spent = 0)
    or (
      mode = 'model'
      and credit_budget between 2 and 48
      and credits_spent between 0 and credit_budget
    )
  );

alter table public.app_team_tasks
  add column if not exists model text;

alter table public.app_team_tasks
  drop constraint if exists app_team_tasks_model_check;
alter table public.app_team_tasks
  add constraint app_team_tasks_model_check
  check (model is null or char_length(btrim(model)) between 1 and 80);

create index if not exists app_team_tasks_running_idx
  on public.app_team_tasks (status, started_at)
  where status = 'running';

comment on column public.app_team_runs.mode is
  'fixture = free deterministic workers; model = bounded paid Ollama calls.';
comment on column public.app_team_runs.model_by_role is
  'Role-to-Ollama-model snapshot for a model-backed run.';
comment on column public.app_team_tasks.model is
  'The exact Ollama model reserved for this task; null in fixture mode.';

-- ---------------------------------------------------------------------------
-- 2. Reservation accepts the new agent task operation
-- ---------------------------------------------------------------------------

do $$
begin
  alter table public.ai_requests drop constraint if exists ai_requests_kind_check;

  alter table public.ai_requests
    add constraint ai_requests_kind_check
    check (kind in (
      'unstuck', 'plan', 'task_help', 'learning', 'learning_help',
      'workflow_draft', 'future_paths', 'review', 'mission_assist',
      'app_repair', 'team_task'
    ));
end $$;

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
    when 'team_task' then 2
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
-- 3. Platform recovery: abandoned AI reservations and stale agent tasks
-- ---------------------------------------------------------------------------

create or replace function public.recover_stale_ai_requests()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limits public.ai_limits;
  v_stale record;
  v_recovered integer := 0;
  v_credits integer := 0;
  v_ledger_inserted boolean;
begin
  select * into v_limits from public.ai_limits where id = 1;
  if not found then
    v_limits.in_flight_seconds := 120;
  end if;

  for v_stale in
    select id, user_id, credits_charged, budget_kind, budget_id
      from public.ai_requests
     where status = 'in_flight'
       and started_at < now() - make_interval(secs => v_limits.in_flight_seconds)
     for update skip locked
  loop
    update public.ai_requests
       set status = 'failed',
           error_code = 'timeout',
           finished_at = now()
     where id = v_stale.id
       and status = 'in_flight';

    if not found then
      continue;
    end if;

    v_recovered := v_recovered + 1;

    if v_stale.credits_charged > 0 then
      insert into public.credit_ledger (user_id, delta, reason, request_id, note)
      values (
        v_stale.user_id,
        v_stale.credits_charged,
        'ai_release',
        v_stale.id,
        'released by the platform recovery pass'
      )
      on conflict do nothing;

      v_ledger_inserted := found;

      if v_ledger_inserted then
        v_credits := v_credits + v_stale.credits_charged;

        if v_stale.budget_kind = 'workflow' then
          update public.workflow_runs
             set credits_spent = greatest(credits_spent - v_stale.credits_charged, 0)
           where id = v_stale.budget_id and user_id = v_stale.user_id;
        elsif v_stale.budget_kind = 'build' then
          update public.app_workspaces
             set credits_spent = greatest(credits_spent - v_stale.credits_charged, 0)
           where id = v_stale.budget_id and user_id = v_stale.user_id;
        elsif v_stale.budget_kind = 'swarm' then
          update public.app_team_runs
             set credits_spent = greatest(credits_spent - v_stale.credits_charged, 0)
           where id = v_stale.budget_id and user_id = v_stale.user_id;
        end if;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'recovered', v_recovered,
    'credits_released', v_credits
  );
end;
$$;

create or replace function public.recover_stale_team_tasks()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task record;
  v_queued integer := 0;
  v_failed integer := 0;
  v_runs uuid[] := '{}';
begin
  for v_task in
    select t.id, t.run_id, t.user_id, t.attempts, t.budget_seconds
      from public.app_team_tasks t
     where t.status = 'running'
       and t.started_at < now() - make_interval(secs => t.budget_seconds + 60)
     for update skip locked
  loop
    v_runs := array_append(v_runs, v_task.run_id);

    if v_task.attempts < 3 then
      update public.app_team_tasks
         set status = 'queued',
             started_at = null,
             finished_at = null,
             error = null,
             blocker = null
       where id = v_task.id
         and status = 'running';

      insert into public.app_team_events (run_id, task_id, user_id, actor, kind, detail)
      values (
        v_task.run_id,
        v_task.id,
        v_task.user_id,
        'system',
        'task.recovered',
        'Platform recovery re-queued a task whose worker stopped before finishing.'
      );

      v_queued := v_queued + 1;
    else
      update public.app_team_tasks
         set status = 'failed',
             finished_at = now(),
             error = 'Platform recovery stopped a task that exceeded its retry limit.'
       where id = v_task.id
         and status = 'running';

      insert into public.app_team_events (run_id, task_id, user_id, actor, kind, detail)
      values (
        v_task.run_id,
        v_task.id,
        v_task.user_id,
        'system',
        'task.recovery_failed',
        'Platform recovery marked a stale task failed after three attempts.'
      );

      v_failed := v_failed + 1;
    end if;
  end loop;

  if array_length(v_runs, 1) is not null then
    update public.app_team_runs
       set active_count = 0
     where id = any(v_runs);

    update public.app_team_runs r
       set status = 'failed',
           finished_at = now(),
           last_error = 'Platform recovery found work that could not be recovered.'
     where r.id = any(v_runs)
       and r.status = 'running'
       and exists (
         select 1 from public.app_team_tasks t
          where t.run_id = r.id and t.status = 'failed'
       )
       and not exists (
         select 1 from public.app_team_tasks t
          where t.run_id = r.id
            and t.status in ('queued', 'running', 'awaiting_review', 'blocked')
       );
  end if;

  return jsonb_build_object(
    'ok', true,
    'queued', v_queued,
    'failed', v_failed
  );
end;
$$;

revoke all on function public.reserve_ai_request(text, text, text, uuid) from public, anon;
revoke all on function public.recover_stale_ai_requests() from public, anon, authenticated;
revoke all on function public.recover_stale_team_tasks() from public, anon, authenticated;
grant execute on function public.reserve_ai_request(text, text, text, uuid) to authenticated;
grant execute on function public.recover_stale_ai_requests() to service_role;
grant execute on function public.recover_stale_team_tasks() to service_role;
