-- GET TO IT — Phase 23 schema
-- Optional agent-team mode for an app project.
--
-- Ground rules encoded here:
--   * A run works from one immutable specification snapshot. There is no API
--     for a coordinator to append arbitrary scope.
--   * Tasks are durable: queued, running, blocked, awaiting review, completed,
--     failed or cancelled. Every budget is bounded.
--   * Task branches are logical full-file proposals, not files written directly
--     to the project. Only the explicit integration step writes app_files.
--   * File ownership is declared before a task runs. A later overlap becomes a
--     blocker, not a silent overwrite.
--   * No deployment, credential, external-action or recursive-spawn tool is
--     represented. Mode is fixture-only until a separately reviewed paid mode
--     exists.
--   * Owner-only under RLS. Projects and all child rows cascade on deletion.

create table if not exists public.app_team_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  spec_version integer not null check (spec_version >= 1),
  spec jsonb not null check (jsonb_typeof(spec) = 'object'),
  status text not null default 'running'
    check (status in ('queued', 'running', 'paused', 'awaiting_review', 'completed', 'failed', 'cancelled')),
  mode text not null default 'fixture' check (mode = 'fixture'),
  max_agents integer not null default 2 check (max_agents between 1 and 4),
  max_calls integer not null default 0 check (max_calls between 0 and 24),
  max_runtime_seconds integer not null default 600 check (max_runtime_seconds between 60 and 1800),
  calls_used integer not null default 0 check (calls_used between 0 and 24),
  runtime_seconds integer not null default 0 check (runtime_seconds >= 0),
  active_count integer not null default 0 check (active_count between 0 and 4),
  integration_status text not null default 'pending'
    check (integration_status in ('pending', 'merged', 'conflict', 'checks_failed')),
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.app_team_runs is
  'One bounded agent-team run per generated app. Holds the immutable specification snapshot and usage counters.';
comment on column public.app_team_runs.mode is
  'fixture only: deterministic controlled workers, no paid model calls.';

create index if not exists app_team_runs_user_idx
  on public.app_team_runs (user_id, updated_at desc);

drop trigger if exists app_team_runs_set_updated_at on public.app_team_runs;
create trigger app_team_runs_set_updated_at before update on public.app_team_runs
  for each row execute function public.set_updated_at();

create table if not exists public.app_team_tasks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.app_team_runs (id) on delete cascade,
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  position integer not null check (position between 0 and 23),
  role text not null check (role in ('coordinator', 'frontend', 'backend', 'data', 'qa', 'security')),
  objective text not null check (char_length(btrim(objective)) between 5 and 500),
  inputs jsonb not null default '[]'::jsonb check (jsonb_typeof(inputs) = 'array'),
  allowed_tools jsonb not null default '[]'::jsonb check (jsonb_typeof(allowed_tools) = 'array'),
  expected_artifacts jsonb not null default '[]'::jsonb check (jsonb_typeof(expected_artifacts) = 'array'),
  acceptance_checks jsonb not null default '[]'::jsonb check (jsonb_typeof(acceptance_checks) = 'array'),
  file_claims jsonb not null default '[]'::jsonb check (jsonb_typeof(file_claims) = 'array'),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'blocked', 'awaiting_review', 'completed', 'failed', 'cancelled')),
  budget_seconds integer not null default 120 check (budget_seconds between 10 and 300),
  budget_calls integer not null default 0 check (budget_calls between 0 and 4),
  calls_used integer not null default 0 check (calls_used between 0 and 4),
  attempts integer not null default 0 check (attempts between 0 and 3),
  branch_files jsonb not null default '[]'::jsonb check (jsonb_typeof(branch_files) = 'array'),
  changed_files jsonb not null default '[]'::jsonb check (jsonb_typeof(changed_files) = 'array'),
  output jsonb,
  blocker text check (blocker is null or char_length(blocker) <= 500),
  error text check (error is null or char_length(error) <= 1000),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, position)
);

comment on table public.app_team_tasks is
  'Durable role tasks. Branch files stay here until the owner runs controlled integration.';

create index if not exists app_team_tasks_run_idx
  on public.app_team_tasks (run_id, position);
create index if not exists app_team_tasks_project_idx
  on public.app_team_tasks (project_id, created_at desc);

drop trigger if exists app_team_tasks_set_updated_at on public.app_team_tasks;
create trigger app_team_tasks_set_updated_at before update on public.app_team_tasks
  for each row execute function public.set_updated_at();

create table if not exists public.app_team_integrations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.app_team_runs (id) on delete cascade,
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null check (status in ('merged', 'conflict', 'checks_failed')),
  contributors jsonb not null default '{}'::jsonb
    check (jsonb_typeof(contributors) = 'object'),
  conflict_files jsonb not null default '[]'::jsonb
    check (jsonb_typeof(conflict_files) = 'array'),
  checks jsonb not null default '[]'::jsonb check (jsonb_typeof(checks) = 'array'),
  log text not null default '' check (char_length(log) <= 200000),
  version integer check (version is null or version >= 1),
  error text check (error is null or char_length(error) <= 1000),
  created_at timestamptz not null default now()
);

comment on table public.app_team_integrations is
  'Controlled merge evidence: contributors per file, conflicts, checks and the resulting app version.';

create index if not exists app_team_integrations_run_idx
  on public.app_team_integrations (run_id, created_at desc);

create table if not exists public.app_team_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.app_team_runs (id) on delete cascade,
  task_id uuid references public.app_team_tasks (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  actor text not null check (actor in ('owner', 'system', 'coordinator')),
  kind text not null check (char_length(btrim(kind)) between 2 and 80),
  detail text not null check (char_length(detail) between 1 and 1000),
  created_at timestamptz not null default now()
);

comment on table public.app_team_events is
  'Append-only human-oversight trail: state changes, blocks, pauses, reassignment and integration.';

create index if not exists app_team_events_run_idx
  on public.app_team_events (run_id, created_at desc);

alter table public.app_team_runs enable row level security;
alter table public.app_team_tasks enable row level security;
alter table public.app_team_integrations enable row level security;
alter table public.app_team_events enable row level security;

drop policy if exists "owners manage their team runs" on public.app_team_runs;
create policy "owners manage their team runs" on public.app_team_runs
  for all to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_projects p
       where p.id = project_id and p.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_projects p
       where p.id = project_id and p.user_id = (select auth.uid())
    )
  );

drop policy if exists "owners manage their team tasks" on public.app_team_tasks;
create policy "owners manage their team tasks" on public.app_team_tasks
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_team_runs r
       where r.id = run_id and r.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.app_projects p
       where p.id = project_id and p.user_id = (select auth.uid())
    )
  );

drop policy if exists "owners read their team integrations" on public.app_team_integrations;
create policy "owners read their team integrations" on public.app_team_integrations
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "owners create their team integrations" on public.app_team_integrations;
create policy "owners create their team integrations" on public.app_team_integrations
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_team_runs r
       where r.id = run_id and r.user_id = (select auth.uid())
    )
  );

drop policy if exists "owners read their team events" on public.app_team_events;
create policy "owners read their team events" on public.app_team_events
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "owners append their team events" on public.app_team_events;
create policy "owners append their team events" on public.app_team_events
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_team_runs r
       where r.id = run_id and r.user_id = (select auth.uid())
    )
  );

grant select, insert, update, delete on public.app_team_runs to authenticated;
grant select, insert, update, delete on public.app_team_tasks to authenticated;
grant select, insert on public.app_team_integrations to authenticated;
grant select, insert on public.app_team_events to authenticated;
revoke all on public.app_team_runs from anon;
revoke all on public.app_team_tasks from anon;
revoke all on public.app_team_integrations from anon;
revoke all on public.app_team_events from anon;
