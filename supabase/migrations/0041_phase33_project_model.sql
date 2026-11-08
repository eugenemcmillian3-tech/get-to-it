-- GET TO IT — Phase 33 schema
-- Versioned project architecture model, static change scenarios and bounded
-- experiments.
--
-- Ground rules encoded here:
--   * A model version is tied to the specification, app version and source
--     digest it was built from. New versions are appended; old versions stay.
--   * Scenario analysis is immutable and records only static evidence. It never
--     claims to prove runtime behavior or forecast performance or cost.
--   * Experiments are bounded, source-only and cannot target an external URL.
--   * A task can only be created from an approved experiment, and only once.
--   * All records are owner-only. A project member cannot infer another
--     account's model or experiment evidence through these tables.

create table if not exists public.app_project_models (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  version integer not null check (version >= 1),
  status text not null default 'current' check (status in ('current', 'superseded')),
  spec_version integer not null default 0 check (spec_version >= 0),
  app_version integer not null default 0 check (app_version >= 0),
  source_digest text not null check (source_digest ~ '^[a-f0-9]{64}$'),
  source_revision jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_revision) = 'object' and octet_length(source_revision::text) <= 200000),
  model jsonb not null
    check (jsonb_typeof(model) = 'object' and octet_length(model::text) <= 1500000),
  assumptions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(assumptions) = 'array' and jsonb_array_length(assumptions) <= 40),
  missing_information jsonb not null default '[]'::jsonb
    check (jsonb_typeof(missing_information) = 'array' and jsonb_array_length(missing_information) <= 40),
  created_at timestamptz not null default now(),
  unique (project_id, version)
);

comment on table public.app_project_models is
  'Immutable project-model versions. Each version records the source revision and digest it was derived from.';
comment on column public.app_project_models.model is
  'Static pages, journeys, dependencies, entities, integrations and environments. Not runtime telemetry.';

create index if not exists app_project_models_project_idx
  on public.app_project_models (project_id, version desc);
create index if not exists app_project_models_current_idx
  on public.app_project_models (project_id, status);
create unique index if not exists app_project_models_one_current_idx
  on public.app_project_models (project_id) where status = 'current';

create or replace function public.app_project_models_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.project_id is distinct from old.project_id
     or new.user_id is distinct from old.user_id
     or new.version is distinct from old.version
     or new.spec_version is distinct from old.spec_version
     or new.app_version is distinct from old.app_version
     or new.source_digest is distinct from old.source_digest
     or new.source_revision is distinct from old.source_revision
     or new.model is distinct from old.model
     or new.assumptions is distinct from old.assumptions
     or new.missing_information is distinct from old.missing_information then
    raise exception 'project model evidence is immutable; create a new version';
  end if;
  return new;
end;
$$;

drop trigger if exists app_project_models_guard_trigger on public.app_project_models;
create trigger app_project_models_guard_trigger before update on public.app_project_models
  for each row execute function public.app_project_models_guard();

create table if not exists public.app_change_scenarios (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  model_id uuid not null references public.app_project_models (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in (
    'api_change', 'new_user_role', 'background_job', 'database_field'
  )),
  question text not null check (char_length(btrim(question)) between 5 and 1000),
  target text not null check (char_length(btrim(target)) between 1 and 160),
  basis text not null default 'static_model' check (basis = 'static_model'),
  analysis jsonb not null
    check (jsonb_typeof(analysis) = 'object' and octet_length(analysis::text) <= 300000),
  created_at timestamptz not null default now()
);

comment on table public.app_change_scenarios is
  'One proposed change analysed against one immutable model version. Evidence is static, never runtime proof.';

create index if not exists app_change_scenarios_project_idx
  on public.app_change_scenarios (project_id, created_at desc);
create index if not exists app_change_scenarios_model_idx
  on public.app_change_scenarios (model_id, created_at desc);

create table if not exists public.app_change_experiments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  scenario_id uuid not null references public.app_change_scenarios (id) on delete cascade,
  model_id uuid not null references public.app_project_models (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in (
    'contract_check', 'synthetic_requests', 'resource_observation', 'failure_injection'
  )),
  status text not null default 'proposed' check (status in (
    'proposed', 'approved', 'running', 'passed', 'failed', 'blocked', 'canceled'
  )),
  target text not null
    check (
      char_length(btrim(target)) between 1 and 160
      and target !~* '^[a-z][a-z0-9+.-]*://'
      and target !~* '^//'
    ),
  data_handling text not null default 'source_code_only'
    check (data_handling = 'source_code_only'),
  requested_requests integer not null default 1 check (requested_requests between 1 and 20),
  max_duration_ms integer not null default 15000 check (max_duration_ms between 1000 and 30000),
  plan jsonb not null
    check (jsonb_typeof(plan) = 'object' and octet_length(plan::text) <= 300000),
  observations jsonb not null default '[]'::jsonb
    check (jsonb_typeof(observations) = 'array' and jsonb_array_length(observations) <= 40),
  note text not null default '' check (char_length(note) <= 1000),
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  executed_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  task_title text not null check (char_length(btrim(task_title)) between 3 and 200),
  task_description text not null default '' check (char_length(task_description) <= 2000),
  scope_paths jsonb not null default '[]'::jsonb
    check (jsonb_typeof(scope_paths) = 'array' and jsonb_array_length(scope_paths) <= 12),
  task_id uuid references public.app_build_tasks (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scenario_id, kind, target)
);

comment on table public.app_change_experiments is
  'A bounded, source-only probe. No external URL, production data or live load test is permitted.';
comment on column public.app_change_experiments.data_handling is
  'Only source-code inspection is permitted in Phase 33; no production user data is accepted.';

create index if not exists app_change_experiments_scenario_idx
  on public.app_change_experiments (scenario_id, created_at desc);
create index if not exists app_change_experiments_project_idx
  on public.app_change_experiments (project_id, created_at desc);

drop trigger if exists app_change_experiments_set_updated_at on public.app_change_experiments;
create trigger app_change_experiments_set_updated_at before update on public.app_change_experiments
  for each row execute function public.set_updated_at();

create or replace function public.app_change_experiments_limit_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.app_change_experiments where scenario_id = new.scenario_id) >= 4 then
    raise exception 'an experiment limit of 4 per scenario was reached';
  end if;
  return new;
end;
$$;

drop trigger if exists app_change_experiments_limit_trigger on public.app_change_experiments;
create trigger app_change_experiments_limit_trigger before insert on public.app_change_experiments
  for each row execute function public.app_change_experiments_limit_guard();

create or replace function public.app_change_experiments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.project_id is distinct from old.project_id
     or new.scenario_id is distinct from old.scenario_id
     or new.model_id is distinct from old.model_id
     or new.user_id is distinct from old.user_id
     or new.kind is distinct from old.kind
     or new.target is distinct from old.target
     or new.data_handling is distinct from old.data_handling
     or new.requested_requests is distinct from old.requested_requests
     or new.max_duration_ms is distinct from old.max_duration_ms
     or new.plan is distinct from old.plan
     or new.task_title is distinct from old.task_title
     or new.task_description is distinct from old.task_description
     or new.scope_paths is distinct from old.scope_paths then
    raise exception 'experiment scope and plan are immutable';
  end if;
  if new.task_id is not null and new.approved_at is null then
    raise exception 'experiment approval is required before creating a project task';
  end if;
  return new;
end;
$$;

drop trigger if exists app_change_experiments_guard_trigger on public.app_change_experiments;
create trigger app_change_experiments_guard_trigger before update on public.app_change_experiments
  for each row execute function public.app_change_experiments_guard();

create or replace function public.create_app_project_model_version(
  p_project_id uuid,
  p_spec_version integer,
  p_app_version integer,
  p_source_digest text,
  p_source_revision jsonb,
  p_model jsonb,
  p_assumptions jsonb,
  p_missing_information jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer;
begin
  perform public.app_assert_owner(p_project_id);
  if p_source_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid source digest';
  end if;
  if jsonb_typeof(p_model) <> 'object' or jsonb_typeof(p_source_revision) <> 'object' then
    raise exception 'invalid project model';
  end if;

  select coalesce(max(version), 0) + 1 into v_version
    from public.app_project_models where project_id = p_project_id;

  update public.app_project_models
     set status = 'superseded'
   where project_id = p_project_id and status = 'current';

  insert into public.app_project_models
    (project_id, user_id, version, status, spec_version, app_version,
     source_digest, source_revision, model, assumptions, missing_information)
  values
    (p_project_id, (select auth.uid()), v_version, 'current',
     coalesce(p_spec_version, 0), coalesce(p_app_version, 0),
     p_source_digest, coalesce(p_source_revision, '{}'::jsonb), p_model,
     coalesce(p_assumptions, '[]'::jsonb), coalesce(p_missing_information, '[]'::jsonb));

  return v_version;
end;
$$;

create or replace function public.create_app_build_task_from_experiment(p_experiment_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_exp public.app_change_experiments;
  v_task uuid;
  v_scope jsonb;
begin
  select * into v_exp from public.app_change_experiments
   where id = p_experiment_id for update;
  if not found then raise exception 'experiment not found'; end if;
  perform public.app_assert_owner(v_exp.project_id);
  if v_exp.approved_at is null or v_exp.status in ('proposed', 'running') then
    raise exception 'experiment approval is required before creating a project task';
  end if;
  if v_exp.status = 'canceled' then raise exception 'the experiment is canceled'; end if;
  if v_exp.task_id is not null then raise exception 'the experiment already created a project task'; end if;

  select coalesce(jsonb_agg(to_jsonb(p.value) order by p.value), '[]'::jsonb)
    into v_scope
    from jsonb_array_elements_text(v_exp.scope_paths) p
   where exists (
     select 1 from public.app_files f
      where f.project_id = v_exp.project_id and f.path = p.value
   );

  insert into public.app_build_tasks
    (project_id, title, description, assignee_kind, assignee_id, agent_role,
     scope_paths, created_by)
  values
    (v_exp.project_id, v_exp.task_title, v_exp.task_description, 'human', null, null,
     v_scope, v_actor)
  returning id into v_task;

  update public.app_change_experiments
     set task_id = v_task
   where id = p_experiment_id;

  return v_task;
end;
$$;

alter table public.app_project_models enable row level security;
alter table public.app_change_scenarios enable row level security;
alter table public.app_change_experiments enable row level security;

drop policy if exists "owners read project models" on public.app_project_models;
create policy "owners read project models" on public.app_project_models
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "owners create project models" on public.app_project_models;
create policy "owners create project models" on public.app_project_models
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_projects p
       where p.id = project_id and p.user_id = (select auth.uid())
    )
  );
drop policy if exists "owners update project model status" on public.app_project_models;
create policy "owners update project model status" on public.app_project_models
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "owners read change scenarios" on public.app_change_scenarios;
create policy "owners read change scenarios" on public.app_change_scenarios
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "owners create change scenarios" on public.app_change_scenarios;
create policy "owners create change scenarios" on public.app_change_scenarios
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_project_models m
       where m.id = model_id and m.project_id = project_id and m.user_id = (select auth.uid())
    )
  );

drop policy if exists "owners read change experiments" on public.app_change_experiments;
create policy "owners read change experiments" on public.app_change_experiments
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "owners create change experiments" on public.app_change_experiments;
create policy "owners create change experiments" on public.app_change_experiments
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_change_scenarios s
       where s.id = scenario_id and s.project_id = project_id and s.user_id = (select auth.uid())
    )
  );
drop policy if exists "owners update change experiments" on public.app_change_experiments;
create policy "owners update change experiments" on public.app_change_experiments
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update on public.app_project_models to authenticated;
grant select, insert on public.app_change_scenarios to authenticated;
grant select, insert, update on public.app_change_experiments to authenticated;

revoke all on public.app_project_models from anon;
revoke all on public.app_change_scenarios from anon;
revoke all on public.app_change_experiments from anon;

revoke all on function public.create_app_project_model_version(uuid, integer, integer, text, jsonb, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.create_app_build_task_from_experiment(uuid) from public, anon;
grant execute on function public.create_app_project_model_version(uuid, integer, integer, text, jsonb, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.create_app_build_task_from_experiment(uuid) to authenticated;
