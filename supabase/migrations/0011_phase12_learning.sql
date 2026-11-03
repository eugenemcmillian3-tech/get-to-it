-- GET TO IT — Phase 12 schema
-- Optional learning mode on an existing goal: a generated path the person can
-- edit or skip, saved answers and AI feedback kept apart, and checkpoints that
-- only count once the person approves them.
--
-- Ground rules encoded here:
--   * A learning path belongs to one goal. Deleting the goal deletes the path,
--     its steps and its records; nothing survives as an orphan.
--   * The three kinds of evidence are separate columns: `feedback` is the
--     model's opinion, `confidence` is the person's own rating, `completed_at`
--     is their own "I finished this". None is derived from another.
--   * A checkpoint is only approved by the owner, through `approved_at`.
--   * Rows are owner-only under RLS, and every write is also checked by the
--     server action against the session.

-- ---------------------------------------------------------------------------
-- 1. Two new AI request kinds
-- ---------------------------------------------------------------------------
-- A learning path and a step-help answer are separate kinds so the usage log
-- says what was actually asked for.

do $$
begin
  alter table public.ai_requests drop constraint if exists ai_requests_kind_check;

  alter table public.ai_requests
    add constraint ai_requests_kind_check
    check (kind in ('unstuck', 'plan', 'task_help', 'learning', 'learning_help'));
end $$;

-- The reservation function validates the kind, so it has to learn the new ones.
-- Everything else is unchanged from Phase 10: free allowance first, then one
-- credit, and an interrupted request releases its credit.
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

  if p_kind not in ('unstuck', 'plan', 'task_help', 'learning', 'learning_help') then
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
-- 2. The learning path
-- ---------------------------------------------------------------------------

create table if not exists public.learning_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  goal_id uuid not null unique references public.goals (id) on delete cascade,
  what_to_learn text not null
    check (char_length(btrim(what_to_learn)) between 3 and 200),
  experience text not null
    check (experience in ('new', 'some', 'confident')),
  outcome text not null check (char_length(btrim(outcome)) between 5 and 500),
  minutes_per_week integer not null check (minutes_per_week between 15 and 2400),
  model text not null check (char_length(btrim(model)) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists learning_plans_user_idx
  on public.learning_plans (user_id, created_at desc);

drop trigger if exists learning_plans_set_updated_at on public.learning_plans;
create trigger learning_plans_set_updated_at
  before update on public.learning_plans
  for each row execute function public.set_updated_at();

create table if not exists public.learning_steps (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.learning_plans (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  position integer not null check (position between 1 and 50),
  kind text not null
    check (kind in ('explanation', 'practice', 'project', 'checkpoint')),
  title text not null check (char_length(btrim(title)) between 2 and 200),
  body text not null check (char_length(btrim(body)) between 10 and 4000),
  estimated_minutes integer not null default 15
    check (estimated_minutes between 5 and 120),
  status text not null default 'active'
    check (status in ('active', 'skipped')),
  -- Checkpoints are suggestions until the owner approves them.
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, position),
  constraint learning_steps_approval_only_checkpoints check (
    approved_at is null or kind = 'checkpoint'
  )
);

create index if not exists learning_steps_plan_idx
  on public.learning_steps (plan_id, position);

drop trigger if exists learning_steps_set_updated_at on public.learning_steps;
create trigger learning_steps_set_updated_at
  before update on public.learning_steps
  for each row execute function public.set_updated_at();

create table if not exists public.learning_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  goal_id uuid not null references public.goals (id) on delete cascade,
  step_id uuid not null unique references public.learning_steps (id) on delete cascade,
  prompt text check (prompt is null or char_length(prompt) <= 2000),
  answer text not null default '' check (char_length(answer) <= 4000),
  feedback text check (feedback is null or char_length(feedback) <= 6000),
  confidence smallint check (confidence is null or confidence between 1 and 5),
  revisit boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists learning_records_user_goal_idx
  on public.learning_records (user_id, goal_id, updated_at desc);

drop trigger if exists learning_records_set_updated_at on public.learning_records;
create trigger learning_records_set_updated_at
  before update on public.learning_records
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Row Level Security
-- ---------------------------------------------------------------------------

alter table public.learning_plans enable row level security;
alter table public.learning_steps enable row level security;
alter table public.learning_records enable row level security;

create policy "people manage their own learning plan"
  on public.learning_plans for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.goals g
       where g.id = learning_plans.goal_id
         and g.user_id = (select auth.uid())
    )
  );

create policy "people manage their own learning steps"
  on public.learning_steps for all to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.learning_plans p
       where p.id = learning_steps.plan_id
         and p.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.learning_plans p
       where p.id = learning_steps.plan_id
         and p.user_id = (select auth.uid())
    )
  );

create policy "people manage their own learning records"
  on public.learning_records for all to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
        from public.learning_steps s
        join public.learning_plans p on p.id = s.plan_id
       where s.id = learning_records.step_id
         and s.user_id = (select auth.uid())
         and p.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
        from public.learning_steps s
        join public.learning_plans p on p.id = s.plan_id
       where s.id = learning_records.step_id
         and s.user_id = (select auth.uid())
         and p.user_id = (select auth.uid())
    )
  );

revoke all on public.learning_plans from anon;
revoke all on public.learning_steps from anon;
revoke all on public.learning_records from anon;

grant select, insert, update, delete on public.learning_plans to authenticated;
grant select, insert, update, delete on public.learning_steps to authenticated;
grant select, insert, update, delete on public.learning_records to authenticated;
