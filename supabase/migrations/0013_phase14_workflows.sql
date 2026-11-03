-- GET TO IT — Phase 14 schema
-- Small, explicit workflows: input, AI draft, human review, one approved
-- connector action, and a completion checkpoint.
--
-- Ground rules encoded here:
--   * A workflow is a sequence of five supported kinds. There is no code step, no
--     arbitrary HTTP step and no browser automation step, because there is no
--     column or branch where one could be stored.
--   * Edits create a new immutable version. A run copies its steps at start, so
--     editing a workflow never changes a run that is already going.
--   * Every external action needs its own approval row holding the EXACT content,
--     destination and connector that will be used. A trigger refuses to let an
--     action's content change once an approval exists, so an approval can never
--     silently authorize different content.
--   * At most one pending, approved, executing or succeeded action per run step,
--     plus a unique idempotency key per run, step, attempt and content. A retry
--     therefore needs a new approval and can never repeat a completed send.
--   * Runs keep their own snapshot of the workflow name and version, so deleting
--     a workflow leaves existing run records readable.
--   * Nothing here sends email, publishes anything, or executes generated text.
--     The only executor in the app is an explicitly simulated connector.

-- ---------------------------------------------------------------------------
-- 1. Workflows and immutable versions
-- ---------------------------------------------------------------------------

create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text
    check (description is null or char_length(btrim(description)) between 1 and 500),
  goal_id uuid references public.goals (id) on delete set null,
  current_version integer not null default 1 check (current_version >= 1),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workflows_user_idx
  on public.workflows (user_id, created_at desc);

create table if not exists public.workflow_versions (
  workflow_id uuid not null references public.workflows (id) on delete cascade,
  version integer not null check (version >= 1),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  description text,
  goal_id uuid references public.goals (id) on delete set null,
  steps jsonb not null
    check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) between 2 and 10),
  created_at timestamptz not null default now(),
  primary key (workflow_id, version)
);

-- A version is a snapshot. Only deleting the workflow removes versions.
create or replace function public.workflow_versions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'workflow versions are immutable';
end;
$$;

drop trigger if exists workflow_versions_immutable_trigger on public.workflow_versions;
create trigger workflow_versions_immutable_trigger
  before update on public.workflow_versions
  for each row execute function public.workflow_versions_immutable();

-- ---------------------------------------------------------------------------
-- 2. Runs and step records
-- ---------------------------------------------------------------------------

create table if not exists public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Deleting a workflow must not destroy run history.
  workflow_id uuid references public.workflows (id) on delete set null,
  workflow_name text not null,
  workflow_version integer not null check (workflow_version >= 1),
  goal_id uuid references public.goals (id) on delete set null,
  status text not null default 'waiting_for_input'
    check (status in (
      'waiting_for_input', 'running', 'waiting_for_approval',
      'succeeded', 'failed', 'cancelled', 'outcome_uncertain'
    )),
  current_position integer not null default 1 check (current_position >= 1),
  context jsonb not null default '{}'::jsonb,
  error_code text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workflow_runs_user_idx
  on public.workflow_runs (user_id, created_at desc);
create index if not exists workflow_runs_workflow_idx
  on public.workflow_runs (workflow_id, created_at desc);

create table if not exists public.workflow_run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.workflow_runs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  position integer not null check (position between 1 and 10),
  kind text not null
    check (kind in ('user_input', 'ai_draft', 'user_review', 'connector_action', 'checkpoint')),
  title text not null check (char_length(btrim(title)) between 2 and 120),
  instructions text
    check (instructions is null or char_length(instructions) <= 1000),
  config jsonb not null default '{}'::jsonb,
  retry_policy text not null default 'manual'
    check (retry_policy in ('manual', 'none')),
  status text not null default 'pending'
    check (status in (
      'pending', 'waiting_for_input', 'running', 'waiting_for_approval',
      'succeeded', 'failed', 'cancelled', 'outcome_uncertain'
    )),
  attempt integer not null default 0 check (attempt >= 0),
  output jsonb,
  error_code text,
  started_at timestamptz,
  finished_at timestamptz,
  unique (run_id, position)
);

create index if not exists workflow_run_steps_run_idx
  on public.workflow_run_steps (run_id, position);

-- ---------------------------------------------------------------------------
-- 3. Exact-content action approvals
-- ---------------------------------------------------------------------------
-- The action record holds what would be sent. The approval holds a copy of the
-- exact same content plus its hash: executing requires all of content, connector
-- and destination to match, so approving one update can never send another.

create table if not exists public.action_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  run_id uuid not null references public.workflow_runs (id) on delete cascade,
  run_step_id uuid not null references public.workflow_run_steps (id) on delete cascade,
  connector text not null check (char_length(btrim(connector)) between 1 and 60),
  action_kind text not null check (action_kind in ('save_document')),
  destination text not null check (char_length(btrim(destination)) between 1 and 200),
  content text not null check (char_length(content) between 1 and 20000),
  content_hash text not null check (char_length(content_hash) between 8 and 64),
  status text not null default 'pending_approval'
    check (status in (
      'pending_approval', 'approved', 'executing', 'succeeded',
      'failed', 'outcome_uncertain', 'cancelled', 'declined'
    )),
  -- Derived from the run, the step and the exact content. A second attempt to
  -- start the same action cannot create a second row.
  idempotency_key text not null unique,
  attempts integer not null default 0 check (attempts >= 0),
  simulated boolean not null default true,
  external_ref text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one live or completed action per step. A failed attempt may be
-- superseded by a new, separately approved attempt without ever allowing two
-- pending or two successful sends for the same step.
create unique index if not exists action_records_one_live_per_step
  on public.action_records (run_step_id)
  where (status in ('pending_approval', 'approved', 'executing', 'succeeded'));

create index if not exists action_records_run_idx
  on public.action_records (run_id, created_at desc);

create table if not exists public.action_approvals (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null unique references public.action_records (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  connector text not null,
  destination text not null,
  approved_content text not null check (char_length(approved_content) between 1 and 20000),
  approved_hash text not null,
  approved_at timestamptz not null default now(),
  consumed_at timestamptz
);

-- An approval covers exactly the content it stored. Changing the action's
-- content, connector or destination after approval is refused outright.
create or replace function public.action_records_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.run_step_id <> old.run_step_id or new.run_id <> old.run_id then
      raise exception 'an action record cannot move between steps'
        using errcode = 'check_violation';
    end if;

    if exists (select 1 from public.action_approvals a where a.action_id = old.id)
       and (
         new.content is distinct from old.content
         or new.connector is distinct from old.connector
         or new.destination is distinct from old.destination
       ) then
      raise exception 'approved content cannot be changed; create a new action'
        using errcode = 'check_violation';
    end if;

    if old.status = 'succeeded' and new.status <> 'succeeded' then
      raise exception 'a completed action cannot be reopened'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists action_records_guard_trigger on public.action_records;
create trigger action_records_guard_trigger
  before update on public.action_records
  for each row execute function public.action_records_guard();

-- An approval is single use: the only allowed change is stamping consumption.
create or replace function public.action_approvals_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.approved_content is distinct from old.approved_content
       or new.approved_hash is distinct from old.approved_hash
       or new.destination is distinct from old.destination
       or new.connector is distinct from old.connector
       or new.action_id <> old.action_id then
      raise exception 'an approval is immutable except for its consumption stamp';
    end if;

    if old.consumed_at is not null then
      raise exception 'an approval can only be consumed once';
    end if;
  end if;

  -- Deletes are refused by grants and RLS rather than here: a BEFORE DELETE
  -- trigger would also fire on a cascade (deleting a run) and make that fail.
  return new;
end;
$$;

drop trigger if exists action_approvals_guard_trigger on public.action_approvals;
create trigger action_approvals_guard_trigger
  before update on public.action_approvals
  for each row execute function public.action_approvals_guard();

-- ---------------------------------------------------------------------------
-- 4. Timestamps
-- ---------------------------------------------------------------------------

drop trigger if exists workflows_set_updated_at on public.workflows;
create trigger workflows_set_updated_at
  before update on public.workflows
  for each row execute function public.set_updated_at();

drop trigger if exists workflow_runs_set_updated_at on public.workflow_runs;
create trigger workflow_runs_set_updated_at
  before update on public.workflow_runs
  for each row execute function public.set_updated_at();

drop trigger if exists action_records_set_updated_at on public.action_records;
create trigger action_records_set_updated_at
  before update on public.action_records
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Starting a run from the workflow's current version
-- ---------------------------------------------------------------------------
-- The snapshot happens in one statement: a run can never be half-created, and a
-- later edit to the workflow cannot reach into it.

create or replace function public.start_workflow_run(p_workflow_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_workflow public.workflows;
  v_version public.workflow_versions;
  v_run uuid;
  v_steps jsonb;
  v_step jsonb;
  v_position integer := 0;
  v_first_kind text;
  v_kind text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_workflow
    from public.workflows
   where id = p_workflow_id and user_id = v_user;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'no-workflow');
  end if;

  select * into v_version
    from public.workflow_versions
   where workflow_id = p_workflow_id and version = v_workflow.current_version;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'no-version');
  end if;

  v_steps := v_version.steps;

  if jsonb_typeof(v_steps) <> 'array'
     or jsonb_array_length(v_steps) < 2
     or jsonb_array_length(v_steps) > 10 then
    return jsonb_build_object('ok', false, 'code', 'invalid-steps');
  end if;

  insert into public.workflow_runs (
    user_id, workflow_id, workflow_name, workflow_version, goal_id, status
  )
  values (
    v_user, v_workflow.id, v_workflow.name, v_workflow.current_version,
    v_workflow.goal_id, 'waiting_for_input'
  )
  returning id into v_run;

  for v_step in select * from jsonb_array_elements(v_steps)
  loop
    v_position := v_position + 1;
    v_kind := v_step ->> 'kind';

    if v_kind not in ('user_input', 'ai_draft', 'user_review', 'connector_action', 'checkpoint') then
      raise exception 'unsupported workflow step kind: %', v_kind
        using errcode = 'check_violation';
    end if;

    insert into public.workflow_run_steps (
      run_id, user_id, position, kind, title, instructions, config, retry_policy, status
    )
    values (
      v_run,
      v_user,
      v_position,
      v_kind,
      coalesce(nullif(btrim(v_step ->> 'title'), ''), 'Step ' || v_position),
      nullif(btrim(coalesce(v_step ->> 'instructions', '')), ''),
      coalesce(v_step -> 'config', '{}'::jsonb),
      case when v_step ->> 'retry_policy' = 'none' then 'none' else 'manual' end,
      case when v_position = 1 then 'waiting_for_input' else 'pending' end
    );
  end loop;

  select kind into v_first_kind
    from public.workflow_run_steps
   where run_id = v_run and position = 1;

  update public.workflow_runs
     set current_position = 1,
         status = case
           when v_first_kind = 'user_input' then 'waiting_for_input'
           when v_first_kind = 'ai_draft' then 'running'
           else 'waiting_for_approval'
         end
   where id = v_run;

  return jsonb_build_object('ok', true, 'run_id', v_run);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. AI request kind
-- ---------------------------------------------------------------------------
-- Workflow drafting is its own kind, so usage is labelled honestly. The
-- reservation body is Phase 12's, with one more accepted kind; the free
-- allowance, credit ledger and global ceiling are untouched.

do $$
begin
  alter table public.ai_requests drop constraint if exists ai_requests_kind_check;

  alter table public.ai_requests
    add constraint ai_requests_kind_check
    check (kind in ('unstuck', 'plan', 'task_help', 'learning', 'learning_help', 'workflow_draft'));
end $$;

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
  v_day date;
  v_free_used integer;
  v_used_globally integer;
  v_in_flight integer;
  v_balance integer;
  v_use_credit boolean := false;
  v_request_id uuid;
  v_stale record;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if p_kind not in ('unstuck', 'plan', 'task_help', 'learning', 'learning_help', 'workflow_draft') then
    return jsonb_build_object('ok', false, 'code', 'invalid-kind');
  end if;

  select * into v_limits from public.ai_limits where id = 1;
  if not found then
    v_limits.per_user_daily := 15;
    v_limits.global_daily := 200;
    v_limits.in_flight_seconds := 120;
  end if;

  v_day := (now() at time zone 'utc')::date;
  v_day_start := v_day::timestamp at time zone 'utc';

  for v_stale in
    select id, credits_charged
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
    end if;
  end loop;

  select count(*) into v_free_used
    from public.ai_requests
   where user_id = v_user
     and started_at >= v_day_start
     and credits_charged = 0;

  select coalesce(requests, 0) into v_used_globally
    from public.ai_usage_daily
   where day = v_day;

  select count(*) into v_in_flight
    from public.ai_requests
   where user_id = v_user
     and status = 'in_flight';

  if v_in_flight > 0 then
    return jsonb_build_object('ok', false, 'code', 'in-flight');
  end if;

  if v_used_globally >= v_limits.global_daily then
    return jsonb_build_object('ok', false, 'code', 'global-daily');
  end if;

  if v_free_used >= v_limits.per_user_daily then
    select coalesce(sum(delta), 0) into v_balance
      from public.credit_ledger where user_id = v_user;

    if v_balance <= 0 then
      return jsonb_build_object(
        'ok', false,
        'code', 'needs-credits',
        'limit', v_limits.per_user_daily,
        'remaining', 0,
        'balance', 0
      );
    end if;

    v_use_credit := true;
  end if;

  insert into public.ai_requests (user_id, kind, model, status, credits_charged)
  values (
    v_user,
    p_kind,
    p_model,
    'in_flight',
    case when v_use_credit then 1 else 0 end
  )
  returning id into v_request_id;

  if v_use_credit then
    insert into public.credit_ledger (user_id, delta, reason, request_id, note)
    values (v_user, -1, 'ai_charge', v_request_id, 'reserved for one AI request');
  end if;

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
    'limit', v_limits.per_user_daily,
    'remaining', greatest(
      v_limits.per_user_daily - v_free_used - case when v_use_credit then 0 else 1 end,
      0
    ),
    'free', not v_use_credit,
    'balance', v_balance
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'in-flight');
  when check_violation then
    return jsonb_build_object('ok', false, 'code', 'needs-credits');
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Row Level Security and grants
-- ---------------------------------------------------------------------------

alter table public.workflows enable row level security;
alter table public.workflow_versions enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.workflow_run_steps enable row level security;
alter table public.action_records enable row level security;
alter table public.action_approvals enable row level security;

drop policy if exists "people read their own workflows" on public.workflows;
create policy "people read their own workflows"
  on public.workflows for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "people create their own workflows" on public.workflows;
create policy "people create their own workflows"
  on public.workflows for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "people update their own workflows" on public.workflows;
create policy "people update their own workflows"
  on public.workflows for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "people delete their own workflows" on public.workflows;
create policy "people delete their own workflows"
  on public.workflows for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "people read their own workflow versions" on public.workflow_versions;
create policy "people read their own workflow versions"
  on public.workflow_versions for select to authenticated
  using (
    exists (
      select 1 from public.workflows w
       where w.id = workflow_versions.workflow_id
         and w.user_id = (select auth.uid())
    )
  );

drop policy if exists "people add their own workflow versions" on public.workflow_versions;
create policy "people add their own workflow versions"
  on public.workflow_versions for insert to authenticated
  with check (
    exists (
      select 1 from public.workflows w
       where w.id = workflow_versions.workflow_id
         and w.user_id = (select auth.uid())
    )
  );

drop policy if exists "people read their own runs" on public.workflow_runs;
create policy "people read their own runs"
  on public.workflow_runs for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "people update their own runs" on public.workflow_runs;
create policy "people update their own runs"
  on public.workflow_runs for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "people read their own run steps" on public.workflow_run_steps;
create policy "people read their own run steps"
  on public.workflow_run_steps for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "people update their own run steps" on public.workflow_run_steps;
create policy "people update their own run steps"
  on public.workflow_run_steps for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "people read their own action records" on public.action_records;
create policy "people read their own action records"
  on public.action_records for select to authenticated
  using (user_id = (select auth.uid()));

-- An action may only be created against your own run and step: owning the row
-- is not enough, because that would let someone attach an action to another
-- person's step.
drop policy if exists "people create their own action records" on public.action_records;
create policy "people create their own action records"
  on public.action_records for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.workflow_runs r
       where r.id = action_records.run_id
         and r.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.workflow_run_steps s
       where s.id = action_records.run_step_id
         and s.user_id = (select auth.uid())
    )
  );

drop policy if exists "people update their own action records" on public.action_records;
create policy "people update their own action records"
  on public.action_records for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.workflow_runs r
       where r.id = action_records.run_id
         and r.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.workflow_run_steps s
       where s.id = action_records.run_step_id
         and s.user_id = (select auth.uid())
    )
  );

drop policy if exists "people read their own approvals" on public.action_approvals;
create policy "people read their own approvals"
  on public.action_approvals for select to authenticated
  using (user_id = (select auth.uid()));

-- An approval must belong to your own action record, so nobody can approve (or
-- attach an approval to) someone else's pending action.
drop policy if exists "people create their own approvals" on public.action_approvals;
create policy "people create their own approvals"
  on public.action_approvals for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.action_records a
       where a.id = action_approvals.action_id
         and a.user_id = (select auth.uid())
    )
  );

drop policy if exists "people consume their own approvals" on public.action_approvals;
create policy "people consume their own approvals"
  on public.action_approvals for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.action_records a
       where a.id = action_approvals.action_id
         and a.user_id = (select auth.uid())
    )
  );

revoke all on public.workflows from anon, authenticated;
revoke all on public.workflow_versions from anon, authenticated;
revoke all on public.workflow_runs from anon, authenticated;
revoke all on public.workflow_run_steps from anon, authenticated;
revoke all on public.action_records from anon, authenticated;
revoke all on public.action_approvals from anon, authenticated;

grant select, insert, update, delete on public.workflows to authenticated;
grant select, insert on public.workflow_versions to authenticated;
grant select, update on public.workflow_runs to authenticated;
grant select, update on public.workflow_run_steps to authenticated;
grant select, insert, update on public.action_records to authenticated;
grant select, insert, update on public.action_approvals to authenticated;

revoke all on function public.start_workflow_run(uuid) from public, anon;
grant execute on function public.start_workflow_run(uuid) to authenticated;

revoke all on function public.reserve_ai_request(text, text) from public, anon;
grant execute on function public.reserve_ai_request(text, text) to authenticated;
