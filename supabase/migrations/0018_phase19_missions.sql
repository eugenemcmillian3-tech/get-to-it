-- GET TO IT — Phase 19 schema
-- Missions: shared problems inside an existing workspace.
--
-- Ground rules encoded here:
--   * A mission belongs to one workspace and reuses its membership and roles.
--     There is no public flag, no public link and no anonymous access.
--   * AI never governs. Suggesters are stored separately from decisions; there
--     is no vote table, no AI decision owner and no column where a model could
--     be recorded as an approver.
--   * Evidence and assumptions are separate labels. A personal story cannot be
--     stored without a recorded consent note, so it cannot reach a share
--     approval or AI input by accident.
--   * Outcomes are four separate kinds. A verified outcome requires a source and
--     a named verifier; work completed is never stored as impact.
--   * Sharing is an approval record only. There is no publishing, sending or
--     contacting mechanism in this schema.
--   * Owner-only under RLS, and every write is also checked against the session.

-- ---------------------------------------------------------------------------
-- 1. A new AI request kind for one mission-assistance suggestion
-- ---------------------------------------------------------------------------

do $$
begin
  alter table public.ai_requests drop constraint if exists ai_requests_kind_check;

  alter table public.ai_requests
    add constraint ai_requests_kind_check
    check (kind in (
      'unstuck', 'plan', 'task_help', 'learning', 'learning_help',
      'workflow_draft', 'future_paths', 'review', 'mission_assist'
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

  if p_kind not in ('unstuck', 'plan', 'task_help', 'learning', 'learning_help', 'workflow_draft', 'future_paths', 'review', 'mission_assist') then
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

-- ---------------------------------------------------------------------------
-- 2. Missions
-- ---------------------------------------------------------------------------

create table if not exists public.missions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 5 and 160),
  category text not null check (category in ('learning', 'community', 'accessibility', 'volunteer', 'environment', 'other')),
  problem text not null check (char_length(btrim(problem)) between 20 and 3000),
  stakeholders text not null check (char_length(btrim(stakeholders)) between 5 and 2000),
  desired_outcome text not null check (char_length(btrim(desired_outcome)) between 10 and 2000),
  constraints text not null default '' check (char_length(constraints) <= 2000),
  status text not null default 'draft' check (status in ('draft', 'active', 'closed')),
  decision_owner_id uuid references auth.users (id) on delete set null,
  review_at date,
  share_scope text check (share_scope is null or char_length(share_scope) <= 500),
  share_approved_by uuid references auth.users (id) on delete set null,
  share_approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.missions is
  'A shared problem inside one workspace. Private by default; there is no public flag.';
comment on column public.missions.share_approved_at is
  'A recorded approval only. Nothing is published or sent by this app.';

create index if not exists missions_workspace_idx
  on public.missions (workspace_id, created_at desc);

drop trigger if exists missions_set_updated_at on public.missions;
create trigger missions_set_updated_at before update on public.missions
  for each row execute function public.set_updated_at();

create table if not exists public.mission_evidence (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('evidence', 'assumption')),
  text text not null check (char_length(btrim(text)) between 5 and 2000),
  source_url text check (source_url is null or (source_url ~* '^https?://[^[:space:]]+$' and char_length(source_url) <= 500)),
  contains_personal_story boolean not null default false,
  consent_note text check (consent_note is null or char_length(consent_note) <= 500),
  consent_recorded_by uuid references auth.users (id) on delete set null,
  consent_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    not contains_personal_story
    or (consent_note is not null and char_length(btrim(consent_note)) >= 10 and consent_at is not null)
  )
);

comment on table public.mission_evidence is
  'Evidence and assumptions, each labelled. A personal story without recorded consent cannot be stored.';

create index if not exists mission_evidence_mission_idx
  on public.mission_evidence (mission_id, created_at);

create table if not exists public.mission_decisions (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 3 and 160),
  summary text not null check (char_length(btrim(summary)) between 10 and 2000),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz not null default now(),
  dissent text check (dissent is null or char_length(dissent) <= 2000),
  created_at timestamptz not null default now()
);

comment on table public.mission_decisions is
  'A human decision, who approved it, and any dissent in its own words. AI cannot be recorded here.';

create index if not exists mission_decisions_mission_idx
  on public.mission_decisions (mission_id, decided_at desc);

create table if not exists public.mission_tasks (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 2 and 200),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'completed')),
  assignee_id uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mission_tasks_mission_idx
  on public.mission_tasks (mission_id, created_at);

drop trigger if exists mission_tasks_set_updated_at on public.mission_tasks;
create trigger mission_tasks_set_updated_at before update on public.mission_tasks
  for each row execute function public.set_updated_at();

create table if not exists public.mission_outcomes (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  reported_by uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('work', 'output', 'participant', 'verified')),
  text text not null check (char_length(btrim(text)) between 5 and 3000),
  source_url text check (source_url is null or (source_url ~* '^https?://[^[:space:]]+$' and char_length(source_url) <= 500)),
  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  check (
    (kind = 'verified' and source_url is not null and verified_by is not null and verified_at is not null)
    or (kind <> 'verified' and verified_by is null and verified_at is null)
  )
);

comment on table public.mission_outcomes is
  'Four separate outcome kinds. Work completed is stored as work, never as social impact.';

create index if not exists mission_outcomes_mission_idx
  on public.mission_outcomes (mission_id, kind, created_at);

create table if not exists public.mission_suggestions (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  requested_by uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('summary', 'questions', 'plan', 'materials', 'conflicts', 'simplify', 'measures')),
  body text not null check (char_length(btrim(body)) between 40 and 2500),
  model text not null,
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'rejected', 'challenged')),
  challenge_note text check (challenge_note is null or char_length(challenge_note) <= 2000),
  challenged_by uuid references auth.users (id) on delete set null,
  challenged_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (status <> 'challenged' or challenge_note is not null)
);

comment on table public.mission_suggestions is
  'One labelled AI suggestion per explicit request. Never a vote, decision, participant view or approval.';

create index if not exists mission_suggestions_mission_idx
  on public.mission_suggestions (mission_id, created_at desc);

create table if not exists public.mission_reports (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  reported_by uuid references auth.users (id) on delete set null,
  reason text not null check (char_length(btrim(reason)) between 10 and 1000),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists mission_reports_mission_idx
  on public.mission_reports (mission_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Row-level security
-- ---------------------------------------------------------------------------

alter table public.missions enable row level security;
alter table public.mission_evidence enable row level security;
alter table public.mission_decisions enable row level security;
alter table public.mission_tasks enable row level security;
alter table public.mission_outcomes enable row level security;
alter table public.mission_suggestions enable row level security;
alter table public.mission_reports enable row level security;

drop policy if exists "members read missions" on public.missions;
create policy "members read missions" on public.missions
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "admins create missions" on public.missions;
create policy "admins create missions" on public.missions
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) in ('owner', 'admin')
    and created_by = (select auth.uid())
    and (
      decision_owner_id is null
      or exists (
        select 1 from public.workspace_members m
         where m.workspace_id = missions.workspace_id
           and m.user_id = missions.decision_owner_id
           and m.status = 'active'
      )
    )
  );

drop policy if exists "admins update missions" on public.missions;
create policy "admins update missions" on public.missions
  for update to authenticated
  using (public.workspace_role(workspace_id) in ('owner', 'admin'))
  with check (
    public.workspace_role(workspace_id) in ('owner', 'admin')
    and (
      decision_owner_id is null
      or exists (
        select 1 from public.workspace_members m
         where m.workspace_id = missions.workspace_id
           and m.user_id = missions.decision_owner_id
           and m.status = 'active'
      )
    )
  );

drop policy if exists "owners delete missions" on public.missions;
create policy "owners delete missions" on public.missions
  for delete to authenticated
  using (public.workspace_role(workspace_id) = 'owner');

drop policy if exists "members read mission evidence" on public.mission_evidence;
create policy "members read mission evidence" on public.mission_evidence
  for select to authenticated
  using (
    public.workspace_role(workspace_id) is not null
    and exists (
      select 1 from public.missions m
       where m.id = mission_id and m.workspace_id = mission_evidence.workspace_id
    )
  );

drop policy if exists "members add mission evidence" on public.mission_evidence;
create policy "members add mission evidence" on public.mission_evidence
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) is not null
    and author_id = (select auth.uid())
    and exists (
      select 1 from public.missions m
       where m.id = mission_id and m.workspace_id = mission_evidence.workspace_id
    )
  );

drop policy if exists "authors and admins edit mission evidence" on public.mission_evidence;
create policy "authors and admins edit mission evidence" on public.mission_evidence
  for update to authenticated
  using (
    public.workspace_role(workspace_id) in ('owner', 'admin')
    or author_id = (select auth.uid())
  )
  with check (
    public.workspace_role(workspace_id) is not null
    and exists (
      select 1 from public.missions m
       where m.id = mission_id and m.workspace_id = mission_evidence.workspace_id
    )
  );

drop policy if exists "authors and admins remove mission evidence" on public.mission_evidence;
create policy "authors and admins remove mission evidence" on public.mission_evidence
  for delete to authenticated
  using (
    public.workspace_role(workspace_id) in ('owner', 'admin')
    or author_id = (select auth.uid())
  );

drop policy if exists "members read mission decisions" on public.mission_decisions;
create policy "members read mission decisions" on public.mission_decisions
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "admins record mission decisions" on public.mission_decisions;
create policy "admins record mission decisions" on public.mission_decisions
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) in ('owner', 'admin')
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.workspace_members m
       where m.workspace_id = mission_decisions.workspace_id
         and m.user_id = mission_decisions.decided_by
         and m.status = 'active'
    )
    and exists (
      select 1 from public.missions mi
       where mi.id = mission_id and mi.workspace_id = mission_decisions.workspace_id
    )
  );

drop policy if exists "admins remove mission decisions" on public.mission_decisions;
create policy "admins remove mission decisions" on public.mission_decisions
  for delete to authenticated
  using (public.workspace_role(workspace_id) in ('owner', 'admin'));

drop policy if exists "members read mission tasks" on public.mission_tasks;
create policy "members read mission tasks" on public.mission_tasks
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members add mission tasks" on public.mission_tasks;
create policy "members add mission tasks" on public.mission_tasks
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) is not null
    and created_by = (select auth.uid())
    and (
      assignee_id is null
      or exists (
        select 1 from public.workspace_members m
         where m.workspace_id = mission_tasks.workspace_id
           and m.user_id = mission_tasks.assignee_id
           and m.status = 'active'
      )
    )
  );

drop policy if exists "assignees and admins update mission tasks" on public.mission_tasks;
create policy "assignees and admins update mission tasks" on public.mission_tasks
  for update to authenticated
  using (
    public.workspace_role(workspace_id) in ('owner', 'admin')
    or assignee_id = (select auth.uid())
  )
  with check (public.workspace_role(workspace_id) is not null);

drop policy if exists "admins remove mission tasks" on public.mission_tasks;
create policy "admins remove mission tasks" on public.mission_tasks
  for delete to authenticated
  using (public.workspace_role(workspace_id) in ('owner', 'admin'));

drop policy if exists "members read mission outcomes" on public.mission_outcomes;
create policy "members read mission outcomes" on public.mission_outcomes
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members add mission outcomes" on public.mission_outcomes;
create policy "members add mission outcomes" on public.mission_outcomes
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) is not null
    and reported_by = (select auth.uid())
    and exists (
      select 1 from public.missions m
       where m.id = mission_id and m.workspace_id = mission_outcomes.workspace_id
    )
    and (
      kind <> 'verified'
      or (source_url is not null and verified_by = (select auth.uid()) and verified_at is not null)
    )
  );

drop policy if exists "reporters and admins remove mission outcomes" on public.mission_outcomes;
create policy "reporters and admins remove mission outcomes" on public.mission_outcomes
  for delete to authenticated
  using (
    public.workspace_role(workspace_id) in ('owner', 'admin')
    or reported_by = (select auth.uid())
  );

drop policy if exists "members read mission suggestions" on public.mission_suggestions;
create policy "members read mission suggestions" on public.mission_suggestions
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members request mission suggestions" on public.mission_suggestions;
create policy "members request mission suggestions" on public.mission_suggestions
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) is not null
    and requested_by = (select auth.uid())
    and status = 'proposed'
    and exists (
      select 1 from public.missions m
       where m.id = mission_id and m.workspace_id = mission_suggestions.workspace_id
    )
  );

drop policy if exists "admins review mission suggestions" on public.mission_suggestions;
create policy "admins review mission suggestions" on public.mission_suggestions
  for update to authenticated
  using (public.workspace_role(workspace_id) in ('owner', 'admin'))
  with check (public.workspace_role(workspace_id) in ('owner', 'admin'));

drop policy if exists "members challenge mission suggestions" on public.mission_suggestions;
create policy "members challenge mission suggestions" on public.mission_suggestions
  for update to authenticated
  using (challenged_by = (select auth.uid()))
  with check (
    public.workspace_role(workspace_id) is not null
    and status = 'challenged'
    and challenged_by = (select auth.uid())
  );

drop policy if exists "admins read mission reports" on public.mission_reports;
create policy "admins read mission reports" on public.mission_reports
  for select to authenticated
  using (public.workspace_role(workspace_id) in ('owner', 'admin'));

drop policy if exists "members record mission reports" on public.mission_reports;
create policy "members record mission reports" on public.mission_reports
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) is not null
    and reported_by = (select auth.uid())
    and exists (
      select 1 from public.missions m
       where m.id = mission_id and m.workspace_id = mission_reports.workspace_id
    )
  );

drop policy if exists "admins resolve mission reports" on public.mission_reports;
create policy "admins resolve mission reports" on public.mission_reports
  for update to authenticated
  using (public.workspace_role(workspace_id) in ('owner', 'admin'))
  with check (public.workspace_role(workspace_id) in ('owner', 'admin'));

-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.missions to authenticated;
grant select, insert, update, delete on public.mission_evidence to authenticated;
grant select, insert, delete on public.mission_decisions to authenticated;
grant select, insert, update, delete on public.mission_tasks to authenticated;
grant select, insert, delete on public.mission_outcomes to authenticated;
grant select, insert, update on public.mission_suggestions to authenticated;
grant select, insert, update on public.mission_reports to authenticated;

revoke all on public.missions from anon;
revoke all on public.mission_evidence from anon;
revoke all on public.mission_decisions from anon;
revoke all on public.mission_tasks from anon;
revoke all on public.mission_outcomes from anon;
revoke all on public.mission_suggestions from anon;
revoke all on public.mission_reports from anon;
