-- GET TO IT — Phase 16 schema
-- Future Paths: three plausible futures for one decision, kept separate from
-- predictions and labelled by where each line came from.
--
-- Ground rules encoded here:
--   * A path belongs to one person. An optional goal link disappears if the goal
--     is deleted; the path itself is theirs and stays.
--   * Exactly three scenarios per path, one of each kind, enforced by a unique
--     constraint rather than by the interface alone.
--   * Every list is a JSON array of items that carry an evidence label in the
--     application. No column can hold a probability or a ranked forecast.
--   * A converted action is recorded once per scenario and index, so a double
--     click cannot create two tasks. Deleting the task frees the slot; deleting
--     the path removes the record but never the task the person chose to keep.
--   * Rows are owner-only under RLS, and every write is also checked against the
--     session in the server action.

-- ---------------------------------------------------------------------------
-- 1. A sixth AI request kind
-- ---------------------------------------------------------------------------

do $$
begin
  alter table public.ai_requests drop constraint if exists ai_requests_kind_check;

  alter table public.ai_requests
    add constraint ai_requests_kind_check
    check (kind in (
      'unstuck', 'plan', 'task_help', 'learning', 'learning_help',
      'workflow_draft', 'future_paths'
    ));
end $$;

-- The reservation body is unchanged from Phase 14 apart from the accepted kind
-- list: free allowance first, then one credit, one request in flight at a time.
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

  if p_kind not in (
    'unstuck', 'plan', 'task_help', 'learning', 'learning_help',
    'workflow_draft', 'future_paths'
  ) then
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

revoke all on function public.reserve_ai_request(text, text) from public, anon;
grant execute on function public.reserve_ai_request(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Paths
-- ---------------------------------------------------------------------------

create table if not exists public.future_paths (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- A path is the person's own record. Deleting the goal keeps the thinking.
  goal_id uuid references public.goals (id) on delete set null,
  decision text not null
    check (char_length(btrim(decision)) between 3 and 200),
  horizon text not null
    check (horizon in ('3_months', '6_months', '1_year', '2_years', '5_years')),
  resources text not null default ''
    check (char_length(resources) <= 2000),
  constraints text not null default ''
    check (char_length(constraints) <= 2000),
  success_definition text not null
    check (char_length(btrim(success_definition)) between 3 and 1000),
  uncertainties text not null default ''
    check (char_length(uncertainties) <= 2000),
  model text not null,
  -- The person's own choice. Never inferred, never ranked by the app.
  chosen_kind text
    check (chosen_kind is null or chosen_kind in ('favorable', 'expected', 'difficult')),
  rationale text
    check (rationale is null or char_length(btrim(rationale)) between 1 and 4000),
  rationale_saved_at timestamptz,
  review_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists future_paths_user_idx
  on public.future_paths (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Three scenarios per path
-- ---------------------------------------------------------------------------

create table if not exists public.future_scenarios (
  id uuid primary key default gen_random_uuid(),
  path_id uuid not null references public.future_paths (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('favorable', 'expected', 'difficult')),
  title text not null check (char_length(btrim(title)) between 2 and 120),
  assumptions jsonb not null
    check (jsonb_typeof(assumptions) = 'array' and jsonb_array_length(assumptions) between 1 and 12),
  developments jsonb not null
    check (jsonb_typeof(developments) = 'array' and jsonb_array_length(developments) between 1 and 12),
  opportunities jsonb not null
    check (jsonb_typeof(opportunities) = 'array' and jsonb_array_length(opportunities) between 1 and 12),
  risks jsonb not null
    check (jsonb_typeof(risks) = 'array' and jsonb_array_length(risks) between 1 and 12),
  signals jsonb not null
    check (jsonb_typeof(signals) = 'array' and jsonb_array_length(signals) between 1 and 12),
  actions jsonb not null
    check (jsonb_typeof(actions) = 'array' and jsonb_array_length(actions) between 1 and 12),
  first_steps jsonb not null
    check (jsonb_typeof(first_steps) = 'array' and jsonb_array_length(first_steps) between 1 and 12),
  change_conditions jsonb not null
    check (jsonb_typeof(change_conditions) = 'array' and jsonb_array_length(change_conditions) between 1 and 12),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (path_id, kind)
);

create index if not exists future_scenarios_path_idx
  on public.future_scenarios (path_id);

-- ---------------------------------------------------------------------------
-- 4. Converted actions
-- ---------------------------------------------------------------------------

create table if not exists public.future_actions (
  id uuid primary key default gen_random_uuid(),
  path_id uuid not null references public.future_paths (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  scenario_kind text not null
    check (scenario_kind in ('favorable', 'expected', 'difficult')),
  action_index integer not null check (action_index between 0 and 11),
  action_text text not null check (char_length(btrim(action_text)) between 3 and 400),
  -- Deleting the task allows converting the same action again; nothing is lost.
  task_id uuid not null references public.tasks (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (path_id, scenario_kind, action_index)
);

create index if not exists future_actions_path_idx
  on public.future_actions (path_id);
create index if not exists future_actions_task_idx
  on public.future_actions (task_id);

-- ---------------------------------------------------------------------------
-- 5. Timestamps
-- ---------------------------------------------------------------------------

drop trigger if exists future_paths_set_updated_at on public.future_paths;
create trigger future_paths_set_updated_at
  before update on public.future_paths
  for each row execute function public.set_updated_at();

drop trigger if exists future_scenarios_set_updated_at on public.future_scenarios;
create trigger future_scenarios_set_updated_at
  before update on public.future_scenarios
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Row Level Security and grants
-- ---------------------------------------------------------------------------

alter table public.future_paths enable row level security;
alter table public.future_scenarios enable row level security;
alter table public.future_actions enable row level security;

drop policy if exists "people read their own future paths" on public.future_paths;
create policy "people read their own future paths"
  on public.future_paths for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "people create their own future paths" on public.future_paths;
create policy "people create their own future paths"
  on public.future_paths for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "people update their own future paths" on public.future_paths;
create policy "people update their own future paths"
  on public.future_paths for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "people delete their own future paths" on public.future_paths;
create policy "people delete their own future paths"
  on public.future_paths for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "people read their own scenarios" on public.future_scenarios;
create policy "people read their own scenarios"
  on public.future_scenarios for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.future_paths p
       where p.id = path_id and p.user_id = (select auth.uid())
    )
  );

drop policy if exists "people create their own scenarios" on public.future_scenarios;
create policy "people create their own scenarios"
  on public.future_scenarios for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.future_paths p
       where p.id = path_id and p.user_id = (select auth.uid())
    )
  );

drop policy if exists "people update their own scenarios" on public.future_scenarios;
create policy "people update their own scenarios"
  on public.future_scenarios for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.future_paths p
       where p.id = path_id and p.user_id = (select auth.uid())
    )
  );

drop policy if exists "people delete their own scenarios" on public.future_scenarios;
create policy "people delete their own scenarios"
  on public.future_scenarios for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "people read their own converted actions" on public.future_actions;
create policy "people read their own converted actions"
  on public.future_actions for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "people convert actions in their own paths" on public.future_actions;
create policy "people convert actions in their own paths"
  on public.future_actions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.future_paths p
       where p.id = path_id and p.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.tasks t
       where t.id = task_id and t.user_id = (select auth.uid())
    )
  );

drop policy if exists "people remove their own converted actions" on public.future_actions;
create policy "people remove their own converted actions"
  on public.future_actions for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.future_paths to authenticated;
grant select, insert, update, delete on public.future_scenarios to authenticated;
grant select, insert, delete on public.future_actions to authenticated;

revoke all on public.future_paths from anon;
revoke all on public.future_scenarios from anon;
revoke all on public.future_actions from anon;
