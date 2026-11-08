-- GET TO IT — Phase 34 schema
-- Mission control: one human outcome coordinating existing projects,
-- deliverables, dependencies, people, bounded agent jobs and reviews.
--
-- Ground rules encoded here:
--   * A mission still belongs to one existing workspace. Membership and roles
--     remain the access rule; there is no public or anonymous surface.
--   * Projects are linked explicitly. Nothing is created automatically.
--   * Agent work is attached to the existing Build Room task/queue system and
--     adds mission-level limits on top of the project's own limits.
--   * A dependent job cannot start before its dependency completes. A failed
--     or cancelled dependency pauses or cancels downstream work. Completed
--     artifacts are never deleted by those transitions.
--   * External writes and deployments need a separate approval. A requester
--     cannot approve their own request, and an agent request can never be
--     approved by that same agent.
--   * The event trail is append-only. Nothing here ranks people or calculates a
--     productivity score.

-- ---------------------------------------------------------------------------
-- 1. Mission-level limits, in addition to each project's limits
-- ---------------------------------------------------------------------------

alter table public.missions
  add column if not exists max_parallel_jobs integer not null default 2,
  add column if not exists max_agent_jobs integer not null default 12,
  add column if not exists max_runtime_seconds integer not null default 900,
  add column if not exists max_agent_calls integer not null default 12;

alter table public.missions
  drop constraint if exists missions_max_parallel_jobs_check;
alter table public.missions
  add constraint missions_max_parallel_jobs_check
  check (max_parallel_jobs between 1 and 4);

alter table public.missions
  drop constraint if exists missions_max_agent_jobs_check;
alter table public.missions
  add constraint missions_max_agent_jobs_check
  check (max_agent_jobs between 1 and 24);

alter table public.missions
  drop constraint if exists missions_max_runtime_seconds_check;
alter table public.missions
  add constraint missions_max_runtime_seconds_check
  check (max_runtime_seconds between 60 and 1800);

alter table public.missions
  drop constraint if exists missions_max_agent_calls_check;
alter table public.missions
  add constraint missions_max_agent_calls_check
  check (max_agent_calls between 0 and 24);

-- ---------------------------------------------------------------------------
-- 2. Related projects, milestones and dependencies
-- ---------------------------------------------------------------------------

create table if not exists public.mission_projects (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.app_projects (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 160),
  linked_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (mission_id, project_id)
);

comment on table public.mission_projects is
  'An explicit link from a mission to one existing app project. Linking grants no project write access by itself.';

create index if not exists mission_projects_mission_idx
  on public.mission_projects (mission_id, created_at);
create index if not exists mission_projects_project_idx
  on public.mission_projects (project_id, mission_id);

create table if not exists public.mission_milestones (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 200),
  description text not null default '' check (char_length(description) <= 2000),
  owner_id uuid references auth.users (id) on delete set null,
  due_at date,
  review_at date,
  status text not null default 'planned'
    check (status in ('planned', 'in_progress', 'blocked', 'done', 'cancelled')),
  position integer not null default 0 check (position between 0 and 99),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.mission_milestones is
  'A deliverable in one mission, with an accountable human owner and a review date. Not a productivity score.';
comment on column public.mission_milestones.due_at is
  'A planning target only. It is not a guaranteed completion date.';

create index if not exists mission_milestones_mission_idx
  on public.mission_milestones (mission_id, position, created_at);
create index if not exists mission_milestones_owner_idx
  on public.mission_milestones (owner_id, status);

drop trigger if exists mission_milestones_set_updated_at on public.mission_milestones;
create trigger mission_milestones_set_updated_at before update on public.mission_milestones
  for each row execute function public.set_updated_at();

create table if not exists public.mission_milestone_dependencies (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  milestone_id uuid not null references public.mission_milestones (id) on delete cascade,
  depends_on_id uuid not null references public.mission_milestones (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (milestone_id, depends_on_id),
  check (milestone_id <> depends_on_id)
);

comment on table public.mission_milestone_dependencies is
  'Finish-to-start dependencies between deliverables in the same mission.';

create index if not exists mission_milestone_dependencies_mission_idx
  on public.mission_milestone_dependencies (mission_id, milestone_id);

create or replace function public.mission_milestone_dependencies_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.missions m
     where m.id = new.mission_id and m.workspace_id = new.workspace_id
  ) then
    raise exception 'mission and workspace do not match';
  end if;
  if not exists (
    select 1 from public.mission_milestones a
     where a.id = new.milestone_id
       and a.mission_id = new.mission_id
       and a.workspace_id = new.workspace_id
  ) or not exists (
    select 1 from public.mission_milestones b
     where b.id = new.depends_on_id
       and b.mission_id = new.mission_id
       and b.workspace_id = new.workspace_id
  ) then
    raise exception 'both milestones must belong to the same mission';
  end if;
  return new;
end;
$$;

drop trigger if exists mission_milestone_dependencies_guard_trigger
  on public.mission_milestone_dependencies;
create trigger mission_milestone_dependencies_guard_trigger
  before insert or update on public.mission_milestone_dependencies
  for each row execute function public.mission_milestone_dependencies_guard();

-- ---------------------------------------------------------------------------
-- 3. Bounded agent jobs attached to existing project work
-- ---------------------------------------------------------------------------

create table if not exists public.mission_agent_jobs (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid not null references public.app_projects (id) on delete cascade,
  milestone_id uuid references public.mission_milestones (id) on delete set null,
  source_task_id uuid references public.app_build_tasks (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 3 and 200),
  objective text not null check (char_length(btrim(objective)) between 5 and 1000),
  role text not null check (role in ('coordinator', 'frontend', 'backend', 'data', 'qa', 'security')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'blocked', 'awaiting_review', 'completed', 'failed', 'cancelled')),
  dedupe_key text not null check (char_length(btrim(dedupe_key)) between 1 and 160),
  budget_seconds integer not null default 120 check (budget_seconds between 10 and 300),
  budget_calls integer not null default 0 check (budget_calls between 0 and 4),
  calls_used integer not null default 0 check (calls_used between 0 and 4),
  runtime_seconds integer not null default 0 check (runtime_seconds >= 0),
  attempts integer not null default 0 check (attempts between 0 and 3),
  output jsonb,
  blocker text check (blocker is null or char_length(blocker) <= 500),
  error text check (error is null or char_length(error) <= 1000),
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.mission_agent_jobs is
  'Mission-level assignment over the existing Build Room task system. Adds mission limits, dependencies and cancellation without deleting completed artifacts.';

create index if not exists mission_agent_jobs_mission_idx
  on public.mission_agent_jobs (mission_id, created_at);
create index if not exists mission_agent_jobs_project_idx
  on public.mission_agent_jobs (project_id, status);
create index if not exists mission_agent_jobs_milestone_idx
  on public.mission_agent_jobs (milestone_id, status);

-- One live job per source task and per dedupe key. A cancelled job can be
-- replaced deliberately; a completed or running one cannot be duplicated.
create unique index if not exists mission_agent_jobs_live_source_idx
  on public.mission_agent_jobs (mission_id, source_task_id)
  where source_task_id is not null and status <> 'cancelled';
create unique index if not exists mission_agent_jobs_live_dedupe_idx
  on public.mission_agent_jobs (mission_id, project_id, dedupe_key)
  where status <> 'cancelled';

drop trigger if exists mission_agent_jobs_set_updated_at on public.mission_agent_jobs;
create trigger mission_agent_jobs_set_updated_at before update on public.mission_agent_jobs
  for each row execute function public.set_updated_at();

create or replace function public.mission_agent_jobs_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.missions m
     where m.id = new.mission_id and m.workspace_id = new.workspace_id
  ) then
    raise exception 'mission and workspace do not match';
  end if;

  if not exists (
    select 1 from public.mission_projects p
     where p.mission_id = new.mission_id
       and p.workspace_id = new.workspace_id
       and p.project_id = new.project_id
  ) then
    raise exception 'link the project to the mission before assigning work';
  end if;

  if new.milestone_id is not null and not exists (
    select 1 from public.mission_milestones ms
     where ms.id = new.milestone_id
       and ms.mission_id = new.mission_id
       and ms.workspace_id = new.workspace_id
  ) then
    raise exception 'the milestone must belong to the same mission';
  end if;

  if new.source_task_id is not null and not exists (
    select 1 from public.app_build_tasks t
     where t.id = new.source_task_id and t.project_id = new.project_id
  ) then
    raise exception 'the source task must belong to the linked project';
  end if;

  if new.status = 'running' and new.started_at is null then
    new.started_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists mission_agent_jobs_guard_trigger on public.mission_agent_jobs;
create trigger mission_agent_jobs_guard_trigger
  before insert or update on public.mission_agent_jobs
  for each row execute function public.mission_agent_jobs_guard();

create table if not exists public.mission_job_dependencies (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  job_id uuid not null references public.mission_agent_jobs (id) on delete cascade,
  depends_on_job_id uuid not null references public.mission_agent_jobs (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (job_id, depends_on_job_id),
  check (job_id <> depends_on_job_id)
);

create index if not exists mission_job_dependencies_mission_idx
  on public.mission_job_dependencies (mission_id, job_id);

create or replace function public.mission_job_dependencies_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.mission_agent_jobs a
     where a.id = new.job_id
       and a.mission_id = new.mission_id
       and a.workspace_id = new.workspace_id
  ) or not exists (
    select 1 from public.mission_agent_jobs b
     where b.id = new.depends_on_job_id
       and b.mission_id = new.mission_id
       and b.workspace_id = new.workspace_id
  ) then
    raise exception 'both jobs must belong to the same mission';
  end if;
  return new;
end;
$$;

drop trigger if exists mission_job_dependencies_guard_trigger
  on public.mission_job_dependencies;
create trigger mission_job_dependencies_guard_trigger
  before insert or update on public.mission_job_dependencies
  for each row execute function public.mission_job_dependencies_guard();

-- ---------------------------------------------------------------------------
-- 4. Human approvals, scope escalation and an append-only trail
-- ---------------------------------------------------------------------------

create table if not exists public.mission_approvals (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in (
    'scope_change', 'external_write', 'deployment', 'permission_increase'
  )),
  summary text not null check (char_length(btrim(summary)) between 5 and 500),
  scope text not null check (char_length(btrim(scope)) between 5 and 2000),
  requested_by uuid references auth.users (id) on delete set null,
  requested_by_kind text not null default 'human' check (requested_by_kind in ('human', 'agent')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  note text not null default '' check (char_length(note) <= 1000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (decided_by is null or requested_by is null or decided_by <> requested_by),
  check (
    (requested_by_kind = 'human' and requested_by is not null)
    or (requested_by_kind = 'agent' and requested_by is null)
  ),
  check (
    status <> 'approved'
    or (decided_by is not null and decided_at is not null)
  )
);

comment on table public.mission_approvals is
  'A separate human approval for scope, external writes, deployment or permission changes. Approval never performs the external action.';

create index if not exists mission_approvals_mission_idx
  on public.mission_approvals (mission_id, status, created_at desc);

create or replace function public.mission_approvals_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.mission_id is distinct from old.mission_id
     or new.workspace_id is distinct from old.workspace_id
     or new.kind is distinct from old.kind
     or new.summary is distinct from old.summary
     or new.scope is distinct from old.scope
     or new.requested_by is distinct from old.requested_by
     or new.requested_by_kind is distinct from old.requested_by_kind then
    raise exception 'approval scope and requester are immutable; create a new request';
  end if;

  if new.status <> old.status and new.status in ('approved', 'rejected') then
    if new.decided_by is null or new.decided_by <> (select auth.uid()) then
      raise exception 'the person deciding must be recorded as the decider';
    end if;
  end if;

  if old.status <> 'pending' and new.status <> old.status then
    raise exception 'a decided approval cannot be reopened';
  end if;
  return new;
end;
$$;

drop trigger if exists mission_approvals_guard_trigger on public.mission_approvals;
create trigger mission_approvals_guard_trigger
  before update on public.mission_approvals
  for each row execute function public.mission_approvals_guard();

create table if not exists public.mission_events (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  kind text not null check (char_length(btrim(kind)) between 2 and 80),
  detail text not null check (char_length(btrim(detail)) between 1 and 1000),
  created_at timestamptz not null default now()
);

comment on table public.mission_events is
  'Append-only human-oversight trail. No update or delete policy exists.';

create index if not exists mission_events_mission_idx
  on public.mission_events (mission_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5. Row-level security
-- ---------------------------------------------------------------------------

alter table public.mission_projects enable row level security;
alter table public.mission_milestones enable row level security;
alter table public.mission_milestone_dependencies enable row level security;
alter table public.mission_agent_jobs enable row level security;
alter table public.mission_job_dependencies enable row level security;
alter table public.mission_approvals enable row level security;
alter table public.mission_events enable row level security;

drop policy if exists "members read mission projects" on public.mission_projects;
create policy "members read mission projects" on public.mission_projects
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "managers link their projects" on public.mission_projects;
create policy "managers link their projects" on public.mission_projects
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) in ('owner', 'admin')
    and linked_by = (select auth.uid())
    and exists (
      select 1 from public.missions m
       where m.id = mission_id and m.workspace_id = mission_projects.workspace_id
    )
    and public.app_project_role(project_id) in ('owner', 'maintainer')
  );

drop policy if exists "managers unlink their projects" on public.mission_projects;
create policy "managers unlink their projects" on public.mission_projects
  for delete to authenticated
  using (
    public.workspace_role(workspace_id) in ('owner', 'admin')
    and public.app_project_role(project_id) in ('owner', 'maintainer')
  );

drop policy if exists "members read mission milestones" on public.mission_milestones;
create policy "members read mission milestones" on public.mission_milestones
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "managers create mission milestones" on public.mission_milestones;
create policy "managers create mission milestones" on public.mission_milestones
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) in ('owner', 'admin')
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.missions m
       where m.id = mission_id and m.workspace_id = mission_milestones.workspace_id
    )
    and (
      owner_id is null
      or exists (
        select 1 from public.workspace_members wm
         where wm.workspace_id = mission_milestones.workspace_id
           and wm.user_id = mission_milestones.owner_id
           and wm.status = 'active'
      )
    )
  );

drop policy if exists "managers update mission milestones" on public.mission_milestones;
create policy "managers update mission milestones" on public.mission_milestones
  for update to authenticated
  using (public.workspace_role(workspace_id) in ('owner', 'admin'))
  with check (
    public.workspace_role(workspace_id) in ('owner', 'admin')
    and (
      owner_id is null
      or exists (
        select 1 from public.workspace_members wm
         where wm.workspace_id = mission_milestones.workspace_id
           and wm.user_id = mission_milestones.owner_id
           and wm.status = 'active'
      )
    )
  );

drop policy if exists "managers delete mission milestones" on public.mission_milestones;
create policy "managers delete mission milestones" on public.mission_milestones
  for delete to authenticated
  using (public.workspace_role(workspace_id) in ('owner', 'admin'));

drop policy if exists "members read milestone dependencies" on public.mission_milestone_dependencies;
create policy "members read milestone dependencies" on public.mission_milestone_dependencies
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "managers write milestone dependencies" on public.mission_milestone_dependencies;
create policy "managers write milestone dependencies" on public.mission_milestone_dependencies
  for all to authenticated
  using (public.workspace_role(workspace_id) in ('owner', 'admin'))
  with check (
    public.workspace_role(workspace_id) in ('owner', 'admin')
    and created_by = (select auth.uid())
  );

drop policy if exists "members read mission jobs" on public.mission_agent_jobs;
create policy "members read mission jobs" on public.mission_agent_jobs
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "managers create mission jobs" on public.mission_agent_jobs;
create policy "managers create mission jobs" on public.mission_agent_jobs
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) in ('owner', 'admin')
    and created_by = (select auth.uid())
  );

drop policy if exists "managers update mission jobs" on public.mission_agent_jobs;
create policy "managers update mission jobs" on public.mission_agent_jobs
  for update to authenticated
  using (public.workspace_role(workspace_id) in ('owner', 'admin'))
  with check (public.workspace_role(workspace_id) in ('owner', 'admin'));

drop policy if exists "managers delete mission jobs" on public.mission_agent_jobs;
create policy "managers delete mission jobs" on public.mission_agent_jobs
  for delete to authenticated
  using (public.workspace_role(workspace_id) in ('owner', 'admin'));

drop policy if exists "members read job dependencies" on public.mission_job_dependencies;
create policy "members read job dependencies" on public.mission_job_dependencies
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "managers write job dependencies" on public.mission_job_dependencies;
create policy "managers write job dependencies" on public.mission_job_dependencies
  for all to authenticated
  using (public.workspace_role(workspace_id) in ('owner', 'admin'))
  with check (
    public.workspace_role(workspace_id) in ('owner', 'admin')
    and created_by = (select auth.uid())
  );

drop policy if exists "members read mission approvals" on public.mission_approvals;
create policy "members read mission approvals" on public.mission_approvals
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members request mission approvals" on public.mission_approvals;
create policy "members request mission approvals" on public.mission_approvals
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) is not null
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.missions m
       where m.id = mission_id and m.workspace_id = mission_approvals.workspace_id
    )
    and (
      requested_by_kind = 'agent'
      or requested_by = (select auth.uid())
    )
  );

drop policy if exists "managers decide mission approvals" on public.mission_approvals;
create policy "managers decide mission approvals" on public.mission_approvals
  for update to authenticated
  using (public.workspace_role(workspace_id) in ('owner', 'admin'))
  with check (public.workspace_role(workspace_id) in ('owner', 'admin'));

drop policy if exists "members read mission events" on public.mission_events;
create policy "members read mission events" on public.mission_events
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members append mission events" on public.mission_events;
create policy "members append mission events" on public.mission_events
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) is not null
    and actor_id = (select auth.uid())
  );

-- No update or delete policy for mission_events: the trail is append-only.

-- ---------------------------------------------------------------------------
-- 6. Bounded job transitions
-- ---------------------------------------------------------------------------

create or replace function public.mission_control_claim_job(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_job public.mission_agent_jobs;
  v_mission public.missions;
  v_running integer;
  v_total integer;
  v_calls integer;
  v_runtime integer;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_job from public.mission_agent_jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;

  if public.workspace_role(v_job.workspace_id) not in ('owner', 'admin') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  select * into v_mission from public.missions where id = v_job.mission_id;
  if not found or v_mission.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'mission-not-active');
  end if;

  if v_job.status not in ('queued', 'blocked') then
    return jsonb_build_object('ok', false, 'code', 'not-queued');
  end if;

  if v_job.milestone_id is not null and exists (
    select 1
      from public.mission_milestone_dependencies d
      join public.mission_milestones dep on dep.id = d.depends_on_id
     where d.milestone_id = v_job.milestone_id
       and dep.status in ('blocked', 'cancelled')
  ) then
    update public.mission_agent_jobs
       set status = 'blocked',
           blocker = 'A milestone dependency is blocked or cancelled.'
     where id = v_job.id;
    return jsonb_build_object('ok', false, 'code', 'dependency-failed');
  end if;

  if v_job.milestone_id is not null and exists (
    select 1
      from public.mission_milestone_dependencies d
      join public.mission_milestones dep on dep.id = d.depends_on_id
     where d.milestone_id = v_job.milestone_id
       and dep.status <> 'done'
  ) then
    return jsonb_build_object('ok', false, 'code', 'dependency-pending');
  end if;

  if exists (
    select 1
      from public.mission_job_dependencies d
      join public.mission_agent_jobs dep on dep.id = d.depends_on_job_id
     where d.job_id = v_job.id
       and dep.status in ('failed', 'cancelled')
  ) then
    update public.mission_agent_jobs
       set status = 'blocked',
           blocker = 'A job dependency failed or was cancelled.'
     where id = v_job.id;
    return jsonb_build_object('ok', false, 'code', 'dependency-failed');
  end if;

  if exists (
    select 1
      from public.mission_job_dependencies d
      join public.mission_agent_jobs dep on dep.id = d.depends_on_job_id
     where d.job_id = v_job.id
       and dep.status <> 'completed'
  ) then
    return jsonb_build_object('ok', false, 'code', 'dependency-pending');
  end if;

  if exists (
    select 1 from public.mission_agent_jobs j
     where j.mission_id = v_job.mission_id
       and j.project_id = v_job.project_id
       and j.dedupe_key = v_job.dedupe_key
       and j.id <> v_job.id
       and j.status in ('queued', 'running', 'blocked', 'awaiting_review')
  ) then
    return jsonb_build_object('ok', false, 'code', 'duplicate-work');
  end if;

  select count(*) into v_running
    from public.mission_agent_jobs
   where mission_id = v_job.mission_id and status = 'running';
  if v_running >= v_mission.max_parallel_jobs then
    return jsonb_build_object(
      'ok', false, 'code', 'mission-concurrency', 'limit', v_mission.max_parallel_jobs
    );
  end if;

  select count(*) into v_total
    from public.mission_agent_jobs
   where mission_id = v_job.mission_id and status <> 'cancelled';
  if v_total > v_mission.max_agent_jobs then
    return jsonb_build_object(
      'ok', false, 'code', 'mission-job-limit', 'limit', v_mission.max_agent_jobs
    );
  end if;

  select coalesce(sum(calls_used + budget_calls), 0) into v_calls
    from public.mission_agent_jobs
   where mission_id = v_job.mission_id and status <> 'cancelled';
  if v_calls + v_job.budget_calls > v_mission.max_agent_calls then
    return jsonb_build_object(
      'ok', false, 'code', 'mission-call-limit', 'limit', v_mission.max_agent_calls
    );
  end if;

  select coalesce(sum(runtime_seconds + case when status = 'running' then budget_seconds else 0 end), 0)
    into v_runtime
    from public.mission_agent_jobs
   where mission_id = v_job.mission_id and status <> 'cancelled';
  if v_runtime + v_job.budget_seconds > v_mission.max_runtime_seconds then
    return jsonb_build_object(
      'ok', false, 'code', 'mission-runtime-limit', 'limit', v_mission.max_runtime_seconds
    );
  end if;

  update public.mission_agent_jobs
     set status = 'running',
         started_at = now(),
         finished_at = null,
         blocker = null,
         error = null,
         attempts = attempts + 1
   where id = v_job.id;

  insert into public.mission_events (mission_id, workspace_id, actor_id, kind, detail)
  values (
    v_job.mission_id, v_job.workspace_id, v_actor, 'job.claimed',
    left('Started mission job: ' || v_job.title, 1000)
  );

  return jsonb_build_object('ok', true, 'status', 'running');
end;
$$;

create or replace function public.mission_control_finish_job(
  p_job_id uuid,
  p_status text,
  p_note text default '',
  p_output jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_job public.mission_agent_jobs;
  v_terminal boolean;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_job from public.mission_agent_jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;
  if public.workspace_role(v_job.workspace_id) not in ('owner', 'admin') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if p_status not in ('completed', 'failed', 'cancelled') then
    return jsonb_build_object('ok', false, 'code', 'invalid-status');
  end if;
  if v_job.status in ('completed', 'cancelled') then
    return jsonb_build_object('ok', false, 'code', 'already-terminal', 'status', v_job.status);
  end if;

  update public.mission_agent_jobs
     set status = p_status,
         output = coalesce(p_output, output),
         error = case when p_status = 'failed' then left(coalesce(nullif(btrim(p_note), ''), 'The job failed.'), 1000) else null end,
         blocker = case when p_status = 'failed' then left(coalesce(nullif(btrim(p_note), ''), 'The job failed.'), 500) else null end,
         runtime_seconds = greatest(
           runtime_seconds,
           case when started_at is null then runtime_seconds
                else floor(extract(epoch from now() - started_at))::integer end
         ),
         finished_at = now()
   where id = v_job.id;

  if p_status = 'failed' then
    with recursive downstream(id) as (
      select d.job_id
        from public.mission_job_dependencies d
       where d.depends_on_job_id = v_job.id
      union
      select d.job_id
        from public.mission_job_dependencies d
        join downstream x on d.depends_on_job_id = x.id
    )
    update public.mission_agent_jobs j
       set status = 'blocked',
           blocker = left('Paused because dependency "' || v_job.title || '" failed.', 500),
           finished_at = null
     where j.id in (select id from downstream)
       and j.status in ('queued', 'blocked', 'running', 'awaiting_review');
  elsif p_status = 'cancelled' then
    with recursive downstream(id) as (
      select d.job_id
        from public.mission_job_dependencies d
       where d.depends_on_job_id = v_job.id
      union
      select d.job_id
        from public.mission_job_dependencies d
        join downstream x on d.depends_on_job_id = x.id
    )
    update public.mission_agent_jobs j
       set status = 'cancelled',
           error = 'Cancelled because an upstream job was cancelled.',
           finished_at = now()
     where j.id in (select id from downstream)
       and j.status in ('queued', 'blocked', 'running', 'awaiting_review');
  end if;

  insert into public.mission_events (mission_id, workspace_id, actor_id, kind, detail)
  values (
    v_job.mission_id, v_job.workspace_id, v_actor,
    'job.' || p_status,
    left('Job ' || p_status || ': ' || v_job.title ||
         case when btrim(coalesce(p_note, '')) = '' then '' else ' — ' || btrim(p_note) end, 1000)
  );

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

create or replace function public.mission_control_cancel_job(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_job public.mission_agent_jobs;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_job from public.mission_agent_jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;
  if public.workspace_role(v_job.workspace_id) not in ('owner', 'admin') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_job.status = 'completed' then
    return jsonb_build_object('ok', false, 'code', 'completed-artifact-preserved');
  end if;

  update public.mission_agent_jobs
     set status = 'cancelled',
         error = 'Cancelled by a mission manager.',
         finished_at = now()
   where id = v_job.id;

  with recursive downstream(id) as (
    select d.job_id
      from public.mission_job_dependencies d
     where d.depends_on_job_id = v_job.id
    union
    select d.job_id
      from public.mission_job_dependencies d
      join downstream x on d.depends_on_job_id = x.id
  )
  update public.mission_agent_jobs j
     set status = 'cancelled',
         error = 'Cancelled because an upstream job was cancelled.',
         finished_at = now()
   where j.id in (select id from downstream)
     and j.status in ('queued', 'blocked', 'running', 'awaiting_review');

  insert into public.mission_events (mission_id, workspace_id, actor_id, kind, detail)
  values (
    v_job.mission_id, v_job.workspace_id, v_actor, 'job.cancelled',
    left('Cancelled mission job and downstream work: ' || v_job.title, 1000)
  );

  return jsonb_build_object('ok', true, 'status', 'cancelled');
end;
$$;

create or replace function public.mission_control_cancel_mission(p_mission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_mission public.missions;
  v_count integer;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_mission from public.missions where id = p_mission_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;
  if public.workspace_role(v_mission.workspace_id) not in ('owner', 'admin') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  update public.mission_agent_jobs
     set status = 'cancelled',
         error = 'Mission control was cancelled by a manager.',
         finished_at = now()
   where mission_id = p_mission_id
     and status in ('queued', 'running', 'blocked', 'awaiting_review');
  get diagnostics v_count = row_count;

  insert into public.mission_events (mission_id, workspace_id, actor_id, kind, detail)
  values (
    p_mission_id, v_mission.workspace_id, v_actor, 'mission.cancelled',
    left('Cancelled ' || v_count || ' unfinished job(s); completed artifacts were kept.', 1000)
  );

  return jsonb_build_object('ok', true, 'cancelled', v_count);
end;
$$;

create or replace function public.mission_control_recover(p_mission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_mission public.missions;
  v_count integer;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_mission from public.missions where id = p_mission_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;
  if public.workspace_role(v_mission.workspace_id) not in ('owner', 'admin') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  update public.mission_agent_jobs
     set status = 'blocked',
         blocker = 'Recovered after exceeding the mission runtime limit. Inspect before retrying.',
         runtime_seconds = greatest(runtime_seconds, v_mission.max_runtime_seconds),
         finished_at = now()
   where mission_id = p_mission_id
     and status = 'running'
     and started_at is not null
     and started_at < now() - make_interval(secs => v_mission.max_runtime_seconds);
  get diagnostics v_count = row_count;

  if v_count > 0 then
    insert into public.mission_events (mission_id, workspace_id, actor_id, kind, detail)
    values (
      p_mission_id, v_mission.workspace_id, v_actor, 'jobs.recovered',
      left('Recovered ' || v_count || ' stale running job(s). Outputs were preserved.', 1000)
    );
  end if;

  return jsonb_build_object('ok', true, 'recovered', v_count);
end;
$$;

create or replace function public.mission_control_decide_approval(
  p_approval_id uuid,
  p_decision text,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_approval public.mission_approvals;
begin
  if v_actor is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_approval from public.mission_approvals
   where id = p_approval_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;
  if public.workspace_role(v_approval.workspace_id) not in ('owner', 'admin') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_approval.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'already-decided');
  end if;
  if p_decision not in ('approved', 'rejected') then
    return jsonb_build_object('ok', false, 'code', 'invalid-decision');
  end if;
  if v_approval.requested_by is not null and v_approval.requested_by = v_actor then
    return jsonb_build_object('ok', false, 'code', 'self-approval');
  end if;

  update public.mission_approvals
     set status = p_decision,
         decided_by = v_actor,
         decided_at = now(),
         note = left(coalesce(p_note, ''), 1000)
   where id = p_approval_id;

  insert into public.mission_events (mission_id, workspace_id, actor_id, kind, detail)
  values (
    v_approval.mission_id, v_approval.workspace_id, v_actor,
    'approval.' || p_decision,
    left(v_approval.kind || ': ' || v_approval.summary, 1000)
  );

  return jsonb_build_object('ok', true, 'status', p_decision);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants and function visibility
-- ---------------------------------------------------------------------------

grant select, insert, delete on public.mission_projects to authenticated;
grant select, insert, update, delete on public.mission_milestones to authenticated;
grant select, insert, delete on public.mission_milestone_dependencies to authenticated;
grant select, insert, update, delete on public.mission_agent_jobs to authenticated;
grant select, insert, delete on public.mission_job_dependencies to authenticated;
grant select, insert, update on public.mission_approvals to authenticated;
grant select, insert on public.mission_events to authenticated;
revoke all on public.mission_projects from anon;
revoke all on public.mission_milestones from anon;
revoke all on public.mission_milestone_dependencies from anon;
revoke all on public.mission_agent_jobs from anon;
revoke all on public.mission_job_dependencies from anon;
revoke all on public.mission_approvals from anon;
revoke all on public.mission_events from anon;

revoke all on function public.mission_control_claim_job(uuid) from public, anon;
revoke all on function public.mission_control_finish_job(uuid, text, text, jsonb) from public, anon;
revoke all on function public.mission_control_cancel_job(uuid) from public, anon;
revoke all on function public.mission_control_cancel_mission(uuid) from public, anon;
revoke all on function public.mission_control_recover(uuid) from public, anon;
revoke all on function public.mission_control_decide_approval(uuid, text, text) from public, anon;
grant execute on function public.mission_control_claim_job(uuid) to authenticated;
grant execute on function public.mission_control_finish_job(uuid, text, text, jsonb) to authenticated;
grant execute on function public.mission_control_cancel_job(uuid) to authenticated;
grant execute on function public.mission_control_cancel_mission(uuid) to authenticated;
grant execute on function public.mission_control_recover(uuid) to authenticated;
grant execute on function public.mission_control_decide_approval(uuid, text, text) to authenticated;
