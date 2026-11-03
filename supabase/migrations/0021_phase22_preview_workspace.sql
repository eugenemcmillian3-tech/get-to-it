-- GET TO IT — Phase 22 schema
-- An isolated build-and-preview workspace for a generated project.
--
-- Ground rules encoded here:
--   * A workspace belongs to one owner and one generated project.
--   * Runs are an append-only evidence trail: what check failed, what was
--     proposed, what changed and whether the rerun passed.
--   * The runner key is an opaque directory name. It is not a credential: the
--     runner control API is loopback-only and needs its own bearer token.
--   * No preview token is stored. Preview links are signed by the app with a
--     short expiry and verified by the runner.
--   * Owner-only under RLS. There is no shared or public workspace.

create table if not exists public.app_workspaces (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  runner_key text check (runner_key is null or runner_key ~ '^[a-f0-9]{32}$'),
  status text not null default 'stopped'
    check (status in (
      'stopped', 'checking', 'checks_passed', 'checks_failed',
      'preview', 'failed', 'canceled', 'expired'
    )),
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  iterations integer not null default 0 check (iterations between 0 and 2),
  ai_requests integer not null default 0 check (ai_requests between 0 and 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.app_workspaces is
  'One isolated preview workspace per generated app. Owner-only; the runner directory is disposable.';
comment on column public.app_workspaces.runner_key is
  'Opaque workspace directory key. Not a credential; the control API is loopback and bearer-protected.';

create index if not exists app_workspaces_user_idx
  on public.app_workspaces (user_id, updated_at desc);

drop trigger if exists app_workspaces_set_updated_at on public.app_workspaces;
create trigger app_workspaces_set_updated_at before update on public.app_workspaces
  for each row execute function public.set_updated_at();

create table if not exists public.app_workspace_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces (id) on delete cascade,
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('checks', 'repair', 'preview', 'stop')),
  status text not null check (status in ('passed', 'failed', 'timed_out', 'skipped', 'canceled', 'error')),
  iteration integer not null default 0 check (iteration between 0 and 2),
  checks jsonb not null default '[]'::jsonb check (jsonb_typeof(checks) = 'array'),
  log text not null default '' check (char_length(log) <= 200000),
  changed_files jsonb not null default '[]'::jsonb check (jsonb_typeof(changed_files) = 'array'),
  diff text not null default '' check (char_length(diff) <= 200000),
  ai_requests integer not null default 0 check (ai_requests between 0 and 1),
  error text check (error is null or char_length(error) <= 1000),
  created_at timestamptz not null default now()
);

comment on table public.app_workspace_runs is
  'Check and repair evidence. Logs and diffs are bounded; failures are never hidden.';

create index if not exists app_workspace_runs_workspace_idx
  on public.app_workspace_runs (workspace_id, created_at desc);
create index if not exists app_workspace_runs_project_idx
  on public.app_workspace_runs (project_id, created_at desc);

alter table public.app_workspaces enable row level security;
alter table public.app_workspace_runs enable row level security;

drop policy if exists "people read their own app workspace" on public.app_workspaces;
create policy "people read their own app workspace" on public.app_workspaces
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "people create their own app workspace" on public.app_workspaces;
create policy "people create their own app workspace" on public.app_workspaces
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_projects p
       where p.id = project_id and p.user_id = (select auth.uid())
    )
  );

drop policy if exists "people update their own app workspace" on public.app_workspaces;
create policy "people update their own app workspace" on public.app_workspaces
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "people delete their own app workspace" on public.app_workspaces;
create policy "people delete their own app workspace" on public.app_workspaces
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "people read their own workspace runs" on public.app_workspace_runs;
create policy "people read their own workspace runs" on public.app_workspace_runs
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "people create their own workspace runs" on public.app_workspace_runs;
create policy "people create their own workspace runs" on public.app_workspace_runs
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_workspaces w
       where w.id = workspace_id and w.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.app_projects p
       where p.id = project_id and p.user_id = (select auth.uid())
    )
  );

drop policy if exists "people update their own workspace runs" on public.app_workspace_runs;
create policy "people update their own workspace runs" on public.app_workspace_runs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "people delete their own workspace runs" on public.app_workspace_runs;
create policy "people delete their own workspace runs" on public.app_workspace_runs
  for delete to authenticated using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.app_workspaces to authenticated;
grant select, insert, update, delete on public.app_workspace_runs to authenticated;
revoke all on public.app_workspaces from anon;
revoke all on public.app_workspace_runs from anon;

-- One more AI request kind: a single bounded repair proposal. The existing
-- daily, global and one-in-flight limits apply unchanged.
do $$
begin
  alter table public.ai_requests drop constraint if exists ai_requests_kind_check;

  alter table public.ai_requests
    add constraint ai_requests_kind_check
    check (kind in (
      'unstuck', 'plan', 'task_help', 'learning', 'learning_help',
      'workflow_draft', 'future_paths', 'review', 'mission_assist',
      'app_repair'
    ));
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

  if p_kind not in (
    'unstuck', 'plan', 'task_help', 'learning', 'learning_help',
    'workflow_draft', 'future_paths', 'review', 'mission_assist', 'app_repair'
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
       set status = 'failed', error_code = 'timeout', finished_at = now()
     where id = v_stale.id;

    if v_stale.credits_charged > 0 then
      insert into public.credit_ledger (user_id, delta, reason, request_id, note)
      values (v_user, v_stale.credits_charged, 'ai_release', v_stale.id, 'released after an interrupted request')
      on conflict do nothing;
    end if;
  end loop;

  select count(*) into v_free_used
    from public.ai_requests
   where user_id = v_user and started_at >= v_day_start and credits_charged = 0;

  select coalesce(requests, 0) into v_used_globally
    from public.ai_usage_daily where day = v_day;

  select count(*) into v_in_flight
    from public.ai_requests where user_id = v_user and status = 'in_flight';

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
      return jsonb_build_object('ok', false, 'code', 'needs-credits', 'limit', v_limits.per_user_daily, 'remaining', 0, 'balance', 0);
    end if;

    v_use_credit := true;
  end if;

  insert into public.ai_requests (user_id, kind, model, status, credits_charged)
  values (v_user, p_kind, p_model, 'in_flight', case when v_use_credit then 1 else 0 end)
  returning id into v_request_id;

  if v_use_credit then
    insert into public.credit_ledger (user_id, delta, reason, request_id, note)
    values (v_user, -1, 'ai_charge', v_request_id, 'reserved for one AI request');
  end if;

  insert into public.ai_usage_daily (day, requests)
  values (v_day, 1)
  on conflict (day) do update
    set requests = public.ai_usage_daily.requests + 1, updated_at = now();

  select coalesce(sum(delta), 0) into v_balance
    from public.credit_ledger where user_id = v_user;

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request_id,
    'limit', v_limits.per_user_daily,
    'remaining', greatest(v_limits.per_user_daily - v_free_used - case when v_use_credit then 0 else 1 end, 0),
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
