-- GET TO IT — Phase 32 schema
-- Evaluation workspace for bounded agent tasks, configuration comparison,
-- capability evidence and approval-gated routing recommendations.
--
-- Ground rules encoded here:
--   * A workspace is owner-only. It may use a synthetic fixture or a project
--     snapshot the owner explicitly confirmed they may evaluate.
--   * Acceptance material is fixed once the first run exists. There is no agent
--     path that can rewrite expected output, checks or the task category.
--   * Runs are append-only evidence. Failed and errored runs stay. Human review
--     may annotate a run but may not rewrite its deterministic results.
--   * Deterministic checks and AI-judged opinions are separate columns. There is
--     no universal intelligence score.
--   * Budget approval gates runs. Every configuration is fixture-only in this
--     phase, so no paid provider call is made and known cost is zero.
--   * Recommendations never change production routing or roles. They require a
--     human decision and retain a rollback snapshot.

create table if not exists public.app_eval_workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 3 and 80),
  description text not null default '' check (char_length(description) <= 1000),
  source_project_id uuid references public.app_projects (id) on delete set null,
  source_kind text not null default 'synthetic' check (source_kind in ('synthetic', 'project')),
  source_version integer not null default 0 check (source_version >= 0),
  permission_confirmed boolean not null default false,
  status text not null default 'active' check (status in ('draft', 'active')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_kind = 'synthetic' or permission_confirmed)
);

comment on table public.app_eval_workspaces is
  'Owner-scoped evaluation workspace. Project snapshots require explicit permission.';

create index if not exists app_eval_workspaces_user_idx
  on public.app_eval_workspaces (user_id, created_at desc);

drop trigger if exists app_eval_workspaces_set_updated_at on public.app_eval_workspaces;
create trigger app_eval_workspaces_set_updated_at before update on public.app_eval_workspaces
  for each row execute function public.set_updated_at();

create table if not exists public.app_eval_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_eval_workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null check (category in (
    'frontend_change', 'backend_validation', 'bug_repair', 'test_generation', 'explanation'
  )),
  split text not null check (split in ('development', 'held_out')),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  input_snapshot jsonb not null
    check (jsonb_typeof(input_snapshot) = 'array' and jsonb_array_length(input_snapshot) between 1 and 60),
  snapshot_version integer not null default 0 check (snapshot_version >= 0),
  expected_output text not null check (char_length(btrim(expected_output)) between 5 and 1000),
  acceptance_checks jsonb not null
    check (jsonb_typeof(acceptance_checks) = 'array' and jsonb_array_length(acceptance_checks) between 1 and 12),
  allowed_tools jsonb not null default '[]'::jsonb check (jsonb_typeof(allowed_tools) = 'array'),
  runtime_seconds integer not null default 60 check (runtime_seconds between 10 and 300),
  request_limit integer not null default 2 check (request_limit between 0 and 24),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, title, split)
);

comment on table public.app_eval_tasks is
  'One bounded evaluation task. Development and held-out tasks are separate.';

create index if not exists app_eval_tasks_workspace_idx
  on public.app_eval_tasks (workspace_id, split, created_at);

drop trigger if exists app_eval_tasks_set_updated_at on public.app_eval_tasks;
create trigger app_eval_tasks_set_updated_at before update on public.app_eval_tasks
  for each row execute function public.set_updated_at();

create table if not exists public.app_eval_configurations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_eval_workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 3 and 120),
  version integer not null default 1 check (version >= 1),
  prompt_version text not null check (char_length(btrim(prompt_version)) between 1 and 80),
  model_identifier text not null check (char_length(btrim(model_identifier)) between 1 and 120),
  agent_roles jsonb not null check (jsonb_typeof(agent_roles) = 'array' and jsonb_array_length(agent_roles) between 1 and 6),
  routing jsonb not null default '{}'::jsonb check (jsonb_typeof(routing) = 'object'),
  allowed_tools jsonb not null default '[]'::jsonb check (jsonb_typeof(allowed_tools) = 'array'),
  runtime_seconds integer not null default 60 check (runtime_seconds between 10 and 300),
  request_limit integer not null default 2 check (request_limit between 0 and 24),
  mode text not null default 'fixture' check (mode = 'fixture'),
  status text not null default 'active' check (status in ('draft', 'active', 'archived')),
  created_at timestamptz not null default now(),
  unique (workspace_id, label, version)
);

comment on table public.app_eval_configurations is
  'Configuration under test: roles, routing, model/prompt identifiers, tools and limits. Fixture-only in Phase 32.';

create index if not exists app_eval_configurations_workspace_idx
  on public.app_eval_configurations (workspace_id, status, version desc);

create table if not exists public.app_eval_budgets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.app_eval_workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  approved_runs integer not null check (approved_runs between 5 and 200),
  used_runs integer not null default 0 check (used_runs >= 0 and used_runs <= approved_runs),
  status text not null default 'approved' check (status in ('approved', 'exhausted', 'revoked')),
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.app_eval_budgets is
  'Human-approved run budget. Runs are refused without an approved budget.';

drop trigger if exists app_eval_budgets_set_updated_at on public.app_eval_budgets;
create trigger app_eval_budgets_set_updated_at before update on public.app_eval_budgets
  for each row execute function public.set_updated_at();

create table if not exists public.app_eval_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_eval_workspaces (id) on delete cascade,
  task_id uuid not null references public.app_eval_tasks (id) on delete cascade,
  config_id uuid not null references public.app_eval_configurations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null check (category in (
    'frontend_change', 'backend_validation', 'bug_repair', 'test_generation', 'explanation'
  )),
  split text not null check (split in ('development', 'held_out')),
  trial integer not null check (trial between 1 and 500),
  status text not null check (status in ('passed', 'failed', 'errored')),
  completion_status text not null check (completion_status in ('completed', 'failed', 'not_started')),
  model_configured text not null check (char_length(btrim(model_configured)) between 1 and 120),
  model_reported text check (model_reported is null or char_length(model_reported) <= 120),
  prompt_version text not null check (char_length(btrim(prompt_version)) between 1 and 80),
  agent_roles jsonb not null check (jsonb_typeof(agent_roles) = 'array'),
  routing jsonb not null default '{}'::jsonb check (jsonb_typeof(routing) = 'object'),
  tool_calls jsonb not null default '[]'::jsonb check (jsonb_typeof(tool_calls) = 'array'),
  test_results jsonb not null default '[]'::jsonb check (jsonb_typeof(test_results) = 'array'),
  ai_judgements jsonb not null default '[]'::jsonb check (jsonb_typeof(ai_judgements) = 'array'),
  runtime_ms integer not null default 0 check (runtime_ms >= 0),
  tokens_reported jsonb not null default '{}'::jsonb check (jsonb_typeof(tokens_reported) = 'object'),
  cost_known_cents integer not null default 0 check (cost_known_cents >= 0),
  cost_estimated_cents integer not null default 0 check (cost_estimated_cents >= 0),
  cost_basis text not null default '' check (char_length(cost_basis) <= 500),
  human_review_status text not null default 'pending'
    check (human_review_status in ('pending', 'accepted', 'rejected', 'follow_up')),
  human_review_note text not null default '' check (char_length(human_review_note) <= 1000),
  reviewed_at timestamptz,
  error text check (error is null or char_length(error) <= 1000),
  created_at timestamptz not null default now(),
  unique (task_id, config_id, trial)
);

comment on table public.app_eval_runs is
  'One preserved run. Failed runs remain; human review annotates but never rewrites results.';

create index if not exists app_eval_runs_workspace_idx
  on public.app_eval_runs (workspace_id, created_at desc);
create index if not exists app_eval_runs_task_idx
  on public.app_eval_runs (task_id, config_id, trial);

-- The budget is enforced at insert time with a row lock, not just in the app.
-- A batch that would exceed the approved count aborts as a whole, so a double
-- submit or two tabs cannot silently overrun the budget.
create or replace function public.app_eval_runs_budget_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_budget public.app_eval_budgets%rowtype;
begin
  select * into v_budget
    from public.app_eval_budgets
   where workspace_id = new.workspace_id and user_id = new.user_id
   for update;

  if not found then
    raise exception 'an approved run budget is required before an evaluation run';
  end if;
  if v_budget.status = 'revoked' then
    raise exception 'the evaluation run budget is not approved';
  end if;
  if v_budget.status = 'exhausted' or v_budget.used_runs >= v_budget.approved_runs then
    raise exception 'the evaluation run budget is exhausted';
  end if;

  update public.app_eval_budgets
     set used_runs = used_runs + 1,
         status = case
           when used_runs + 1 >= approved_runs then 'exhausted'
           else 'approved'
         end
   where id = v_budget.id;

  return new;
end;
$$;

drop trigger if exists app_eval_runs_budget_guard_trigger on public.app_eval_runs;
create trigger app_eval_runs_budget_guard_trigger before insert on public.app_eval_runs
  for each row execute function public.app_eval_runs_budget_guard();

create table if not exists public.app_eval_capability_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_eval_workspaces (id) on delete cascade,
  config_id uuid not null references public.app_eval_configurations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  profile_key text not null check (profile_key in ('ui_changes', 'bounded_bug_repair', 'database_changes')),
  version integer not null default 1 check (version >= 1),
  label text not null check (char_length(btrim(label)) between 3 and 160),
  summary text not null check (char_length(btrim(summary)) between 5 and 500),
  suitable_for jsonb not null default '[]'::jsonb check (jsonb_typeof(suitable_for) = 'array'),
  requires_review jsonb not null default '[]'::jsonb check (jsonb_typeof(requires_review) = 'array'),
  evidence_run_ids uuid[] not null default '{}',
  limitations jsonb not null default '[]'::jsonb check (jsonb_typeof(limitations) = 'array'),
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  unique (workspace_id, config_id, profile_key, version)
);

comment on table public.app_eval_capability_profiles is
  'Versioned capability evidence. Profiles cite runs and limitations; they are not a universal score.';

create index if not exists app_eval_capability_profiles_workspace_idx
  on public.app_eval_capability_profiles (workspace_id, config_id, profile_key, version desc);

create table if not exists public.app_eval_recommendations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_eval_workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected')),
  title text not null check (char_length(btrim(title)) between 5 and 180),
  rationale text not null check (char_length(btrim(rationale)) between 10 and 2000),
  config_diff jsonb not null default '{}'::jsonb check (jsonb_typeof(config_diff) = 'object'),
  evidence_run_ids uuid[] not null default '{}',
  rollback jsonb not null default '{}'::jsonb check (jsonb_typeof(rollback) = 'object'),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.app_eval_recommendations is
  'Approval-gated routing or role recommendation. Never changes production configuration automatically.';

create index if not exists app_eval_recommendations_workspace_idx
  on public.app_eval_recommendations (workspace_id, created_at desc);

drop trigger if exists app_eval_recommendations_set_updated_at on public.app_eval_recommendations;
create trigger app_eval_recommendations_set_updated_at before update on public.app_eval_recommendations
  for each row execute function public.set_updated_at();

-- Acceptance material cannot be changed once evidence exists.
create or replace function public.app_eval_tasks_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.app_eval_runs where task_id = old.id) then
    if new.category is distinct from old.category
       or new.split is distinct from old.split
       or new.title is distinct from old.title
       or new.input_snapshot is distinct from old.input_snapshot
       or new.snapshot_version is distinct from old.snapshot_version
       or new.expected_output is distinct from old.expected_output
       or new.acceptance_checks is distinct from old.acceptance_checks
       or new.allowed_tools is distinct from old.allowed_tools
       or new.runtime_seconds is distinct from old.runtime_seconds
       or new.request_limit is distinct from old.request_limit then
      raise exception 'evaluation acceptance material is immutable after the first run';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists app_eval_tasks_immutable_after_run on public.app_eval_tasks;
create trigger app_eval_tasks_immutable_after_run before update on public.app_eval_tasks
  for each row execute function public.app_eval_tasks_guard();

-- A run's result evidence cannot be edited. Human review is the only update.
create or replace function public.app_eval_runs_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from old.workspace_id
     or new.task_id is distinct from old.task_id
     or new.config_id is distinct from old.config_id
     or new.category is distinct from old.category
     or new.split is distinct from old.split
     or new.trial is distinct from old.trial
     or new.status is distinct from old.status
     or new.completion_status is distinct from old.completion_status
     or new.model_configured is distinct from old.model_configured
     or new.model_reported is distinct from old.model_reported
     or new.prompt_version is distinct from old.prompt_version
     or new.agent_roles is distinct from old.agent_roles
     or new.routing is distinct from old.routing
     or new.tool_calls is distinct from old.tool_calls
     or new.test_results is distinct from old.test_results
     or new.ai_judgements is distinct from old.ai_judgements
     or new.runtime_ms is distinct from old.runtime_ms
     or new.tokens_reported is distinct from old.tokens_reported
     or new.cost_known_cents is distinct from old.cost_known_cents
     or new.cost_estimated_cents is distinct from old.cost_estimated_cents
     or new.cost_basis is distinct from old.cost_basis
     or new.error is distinct from old.error then
    raise exception 'evaluation run evidence is append-only; only human review may change';
  end if;
  return new;
end;
$$;

drop trigger if exists app_eval_runs_guard_trigger on public.app_eval_runs;
create trigger app_eval_runs_guard_trigger before update on public.app_eval_runs
  for each row execute function public.app_eval_runs_guard();

-- A decision may change only its status and approval time. The proposed diff and
-- rollback snapshot stay exactly as recorded.
create or replace function public.app_eval_recommendations_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from old.workspace_id
     or new.title is distinct from old.title
     or new.rationale is distinct from old.rationale
     or new.config_diff is distinct from old.config_diff
     or new.evidence_run_ids is distinct from old.evidence_run_ids
     or new.rollback is distinct from old.rollback then
    raise exception 'recommendation evidence and rollback snapshot are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists app_eval_recommendations_guard_trigger on public.app_eval_recommendations;
create trigger app_eval_recommendations_guard_trigger before update on public.app_eval_recommendations
  for each row execute function public.app_eval_recommendations_guard();

alter table public.app_eval_workspaces enable row level security;
alter table public.app_eval_tasks enable row level security;
alter table public.app_eval_configurations enable row level security;
alter table public.app_eval_budgets enable row level security;
alter table public.app_eval_runs enable row level security;
alter table public.app_eval_capability_profiles enable row level security;
alter table public.app_eval_recommendations enable row level security;

drop policy if exists "owners manage evaluation workspaces" on public.app_eval_workspaces;
create policy "owners manage evaluation workspaces" on public.app_eval_workspaces
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "owners manage evaluation tasks" on public.app_eval_tasks;
create policy "owners manage evaluation tasks" on public.app_eval_tasks
  for all to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from public.app_eval_workspaces w where w.id = workspace_id and w.user_id = (select auth.uid()))
  )
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.app_eval_workspaces w where w.id = workspace_id and w.user_id = (select auth.uid()))
  );

drop policy if exists "owners manage evaluation configurations" on public.app_eval_configurations;
create policy "owners manage evaluation configurations" on public.app_eval_configurations
  for all to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from public.app_eval_workspaces w where w.id = workspace_id and w.user_id = (select auth.uid()))
  )
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.app_eval_workspaces w where w.id = workspace_id and w.user_id = (select auth.uid()))
  );

drop policy if exists "owners manage evaluation budgets" on public.app_eval_budgets;
create policy "owners manage evaluation budgets" on public.app_eval_budgets
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.app_eval_workspaces w where w.id = workspace_id and w.user_id = (select auth.uid()))
  );

drop policy if exists "owners manage evaluation runs" on public.app_eval_runs;
create policy "owners manage evaluation runs" on public.app_eval_runs
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.app_eval_workspaces w where w.id = workspace_id and w.user_id = (select auth.uid()))
  );

drop policy if exists "owners read evaluation profiles" on public.app_eval_capability_profiles;
create policy "owners read evaluation profiles" on public.app_eval_capability_profiles
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "owners create evaluation profiles" on public.app_eval_capability_profiles;
create policy "owners create evaluation profiles" on public.app_eval_capability_profiles
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.app_eval_workspaces w where w.id = workspace_id and w.user_id = (select auth.uid()))
    and exists (
      select 1 from public.app_eval_configurations c
       where c.id = config_id
         and c.workspace_id = workspace_id
         and c.user_id = (select auth.uid())
    )
  );

drop policy if exists "owners read evaluation recommendations" on public.app_eval_recommendations;
create policy "owners read evaluation recommendations" on public.app_eval_recommendations
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "owners create evaluation recommendations" on public.app_eval_recommendations;
create policy "owners create evaluation recommendations" on public.app_eval_recommendations
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.app_eval_workspaces w where w.id = workspace_id and w.user_id = (select auth.uid()))
  );
drop policy if exists "owners update evaluation recommendations" on public.app_eval_recommendations;
create policy "owners update evaluation recommendations" on public.app_eval_recommendations
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update on public.app_eval_workspaces to authenticated;
grant select, insert, update on public.app_eval_tasks to authenticated;
grant select, insert, update on public.app_eval_configurations to authenticated;
grant select, insert, update on public.app_eval_budgets to authenticated;
grant select, insert, update on public.app_eval_runs to authenticated;
grant select, insert on public.app_eval_capability_profiles to authenticated;
grant select, insert, update on public.app_eval_recommendations to authenticated;

revoke all on public.app_eval_workspaces from anon;
revoke all on public.app_eval_tasks from anon;
revoke all on public.app_eval_configurations from anon;
revoke all on public.app_eval_budgets from anon;
revoke all on public.app_eval_runs from anon;
revoke all on public.app_eval_capability_profiles from anon;
revoke all on public.app_eval_recommendations from anon;
