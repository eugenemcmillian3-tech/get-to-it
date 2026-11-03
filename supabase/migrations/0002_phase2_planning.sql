-- GET TO IT — Phase 2 schema
-- AI-assisted planning: structured task details, approved-plan records, and
-- database-backed AI request limits.
--
-- Two ideas hold this together:
--   1. A plan is previewed in the browser and only ever APPENDED to the task
--      list after the person approves it. Nothing here can replace completed
--      tasks or saved work.
--   2. AI allowances live in the database and are reserved by security definer
--      functions. Signed-in browsers cannot insert, update or delete these rows,
--      so limits cannot be raised or reset from the client.

-- Approved plans ---------------------------------------------------------
-- The id is supplied by the server as an idempotency key, so a repeated save
-- of the same preview cannot create duplicate tasks.

create table if not exists public.ai_plans (
  id uuid primary key,
  goal_id uuid not null references public.goals (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  model text not null check (char_length(btrim(model)) between 1 and 100),
  task_count integer not null check (task_count between 1 and 7),
  created_at timestamptz not null default now()
);

create index if not exists ai_plans_user_id_idx on public.ai_plans (user_id, created_at desc);
create index if not exists ai_plans_goal_id_idx on public.ai_plans (goal_id);

-- Task detail fields -----------------------------------------------------
-- Manual tasks leave these empty; planned tasks carry the model's guidance.

alter table public.tasks
  add column if not exists instructions text,
  add column if not exists first_action text,
  add column if not exists expected_deliverable text,
  add column if not exists estimated_minutes integer,
  add column if not exists origin text not null default 'manual',
  add column if not exists sort_order integer not null default 0,
  add column if not exists plan_id uuid references public.ai_plans (id) on delete set null;

do $$
begin
  alter table public.tasks
    add constraint tasks_instructions_length check (
      instructions is null or char_length(instructions) <= 2000
    );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.tasks
    add constraint tasks_first_action_length check (
      first_action is null or char_length(first_action) <= 300
    );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.tasks
    add constraint tasks_expected_deliverable_length check (
      expected_deliverable is null or char_length(expected_deliverable) <= 300
    );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.tasks
    add constraint tasks_estimated_minutes_range check (
      estimated_minutes is null or estimated_minutes between 5 and 240
    );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.tasks
    add constraint tasks_origin_allowed check (origin in ('manual', 'ai_plan'));
exception
  when duplicate_object then null;
end $$;

create index if not exists tasks_plan_id_idx on public.tasks (plan_id);

-- Request log ------------------------------------------------------------
-- One row per AI attempt. Daily allowances are counted from this table.

create table if not exists public.ai_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('unstuck', 'plan')),
  model text not null check (char_length(btrim(model)) between 1 and 100),
  status text not null default 'in_flight' check (status in ('in_flight', 'succeeded', 'failed')),
  error_code text check (error_code is null or char_length(error_code) <= 120),
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists ai_requests_user_started_idx
  on public.ai_requests (user_id, started_at desc);
create index if not exists ai_requests_started_idx on public.ai_requests (started_at);

-- A person can have at most one AI request in flight. This is what makes a
-- double click or a second browser tab fail instead of spending two requests.
create unique index if not exists ai_requests_one_in_flight_per_user
  on public.ai_requests (user_id)
  where status = 'in_flight';

-- Allowance configuration ------------------------------------------------
-- Deliberately not readable or writable from the browser: no policies, no
-- grants. Change these numbers with the SQL editor.

create table if not exists public.ai_limits (
  id integer primary key default 1 check (id = 1),
  per_user_daily integer not null default 15
    check (per_user_daily between 1 and 500),
  global_daily integer not null default 200
    check (global_daily between 1 and 100000),
  in_flight_seconds integer not null default 120
    check (in_flight_seconds between 30 and 900),
  updated_at timestamptz not null default now()
);

insert into public.ai_limits (id) values (1) on conflict (id) do nothing;

alter table public.ai_limits enable row level security;
revoke all on public.ai_limits from anon, authenticated;

-- These limits are request counts, not money. There is no billing here.

-- Row Level Security -----------------------------------------------------

alter table public.ai_plans enable row level security;
alter table public.ai_requests enable row level security;

create policy "plans are private to their owner"
  on public.ai_plans for select to authenticated
  using (user_id = (select auth.uid()));

create policy "users can record their own approved plans"
  on public.ai_plans for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.goals g
      where g.id = ai_plans.goal_id
        and g.user_id = (select auth.uid())
    )
  );

create policy "users can remove their own plan records"
  on public.ai_plans for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "requests are private to their owner"
  on public.ai_requests for select to authenticated
  using (user_id = (select auth.uid()));

-- Signed-in users can read their own request history (for the remaining-count
-- line) but cannot write it. Only the functions below write these rows, which
-- is what keeps allowances server-enforced.
revoke insert, update, delete on public.ai_requests from anon, authenticated;

-- Reserving a request ----------------------------------------------------
-- Runs as the function owner, so it can see the global counter. Returns a
-- small JSON object the server turns into a user-facing message.

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

  if p_kind not in ('unstuck', 'plan') then
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

create or replace function public.finish_ai_request(
  p_request_id uuid,
  p_status text,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  if p_status not in ('succeeded', 'failed') then
    raise exception 'finish_ai_request: unsupported status %', p_status;
  end if;

  update public.ai_requests
     set status = p_status,
         error_code = nullif(left(coalesce(p_error, ''), 120), ''),
         finished_at = now()
   where id = p_request_id
     and user_id = auth.uid()
     and status = 'in_flight';
end;
$$;

revoke all on function public.reserve_ai_request(text, text) from public, anon;
revoke all on function public.finish_ai_request(uuid, text, text) from public, anon;
grant execute on function public.reserve_ai_request(text, text) to authenticated;
grant execute on function public.finish_ai_request(uuid, text, text) to authenticated;
