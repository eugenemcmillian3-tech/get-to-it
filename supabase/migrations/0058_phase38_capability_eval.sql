-- GET TO IT — Phase 38 schema
-- Versioned capability evaluation workspace.
--
-- Ground rules encoded here:
--   * Two versioned configurations are compared (a single-model baseline and an
--     orchestrated system). Each row carries its own model, orchestration,
--     prompt and dataset versions, permitted tools, limits, rubric, human
--     assistance allowance and autonomy permission.
--   * Development, validation and held-out tasks are separate. Held-out answer
--     keys live in a table no client role can read; a security-definer function
--     scores a submission and returns counts, never key content.
--   * Repeated exposure of a held-out task to the same configuration is recorded
--     as contamination rather than hidden.
--   * Runs record verified success, partial success, unsupported claims,
--     permission violations, human interventions, recovery, cost and latency.
--     Failures stay.
--   * Capability and permission are separate. An evaluation can never widen
--     autonomy: the permission column is fixed when the version is created.
--   * There is no single score and no AGI claim. Human baselines are stored only
--     with a documented protocol; the app never synthesises one.

create table if not exists public.capability_evals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 3 and 80),
  description text not null default '' check (char_length(description) <= 1000),
  linked_experiment_id uuid references public.experiments (id) on delete set null,
  dataset_version text not null default 'dataset-v1'
    check (char_length(btrim(dataset_version)) between 1 and 80),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.capability_evals is
  'Owner-scoped capability evaluation. May point at an existing experiment; the experiment is not modified.';

create index if not exists capability_evals_user_idx
  on public.capability_evals (user_id, created_at desc);

drop trigger if exists capability_evals_set_updated_at on public.capability_evals;
create trigger capability_evals_set_updated_at before update on public.capability_evals
  for each row execute function public.set_updated_at();

create table if not exists public.capability_eval_versions (
  id uuid primary key default gen_random_uuid(),
  eval_id uuid not null references public.capability_evals (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 3 and 120),
  version integer not null default 1 check (version >= 1),
  baseline_kind text not null check (baseline_kind in ('single_model_baseline', 'orchestrated_system')),
  model_version text not null check (char_length(btrim(model_version)) between 1 and 120),
  orchestration_version text not null check (char_length(btrim(orchestration_version)) between 1 and 120),
  prompt_version text not null check (char_length(btrim(prompt_version)) between 1 and 80),
  dataset_version text not null check (char_length(btrim(dataset_version)) between 1 and 80),
  scoring_rubric jsonb not null default '{}'::jsonb
    check (jsonb_typeof(scoring_rubric) = 'object'),
  permitted_tools jsonb not null default '[]'::jsonb
    check (jsonb_typeof(permitted_tools) = 'array'),
  runtime_limit_seconds integer not null default 120
    check (runtime_limit_seconds between 10 and 900),
  spend_limit_cents integer not null default 0
    check (spend_limit_cents between 0 and 100000),
  human_assistance text not null default 'none'
    check (human_assistance in ('none', 'hints', 'review_only')),
  autonomy_permission text not null default 'none'
    check (autonomy_permission in ('none', 'suggest_only', 'acts_with_approval')),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  unique (eval_id, label, version),
  unique (eval_id, baseline_kind, version)
);

comment on table public.capability_eval_versions is
  'One versioned configuration under test. Autonomy permission is fixed at creation and never derived from a score.';

create index if not exists capability_eval_versions_eval_idx
  on public.capability_eval_versions (eval_id, baseline_kind, version desc);

create table if not exists public.capability_eval_tasks (
  id uuid primary key default gen_random_uuid(),
  eval_id uuid not null references public.capability_evals (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  domain text not null check (domain in (
    'software_build_repair', 'research_synthesis', 'quantitative_reasoning',
    'document_analysis', 'planning_under_constraints', 'tool_selection_execution',
    'error_recovery', 'unfamiliar_formats'
  )),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  split text not null check (split in ('development', 'validation', 'held_out')),
  title text not null check (char_length(btrim(title)) between 3 and 160),
  task_spec jsonb not null check (jsonb_typeof(task_spec) = 'object'),
  dataset_version text not null check (char_length(btrim(dataset_version)) between 1 and 80),
  permitted_tools jsonb not null default '[]'::jsonb
    check (jsonb_typeof(permitted_tools) = 'array'),
  runtime_seconds integer not null default 120
    check (runtime_seconds between 10 and 900),
  spend_limit_cents integer not null default 0
    check (spend_limit_cents between 0 and 100000),
  scoring_rubric jsonb not null default '{}'::jsonb
    check (jsonb_typeof(scoring_rubric) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (eval_id, domain, difficulty, split, title)
);

comment on table public.capability_eval_tasks is
  'One bounded task. Development, validation and held-out splits are distinct rows.';

create index if not exists capability_eval_tasks_eval_idx
  on public.capability_eval_tasks (eval_id, split, domain, difficulty);

drop trigger if exists capability_eval_tasks_set_updated_at on public.capability_eval_tasks;
create trigger capability_eval_tasks_set_updated_at before update on public.capability_eval_tasks
  for each row execute function public.set_updated_at();

-- Answer keys are never readable by a client role. RLS with no policy plus a
-- revoke means the owner cannot select them either; only the scoring function,
-- which runs as the definer, reads them.
create table if not exists public.capability_eval_answer_keys (
  task_id uuid primary key references public.capability_eval_tasks (id) on delete cascade,
  eval_id uuid not null references public.capability_evals (id) on delete cascade,
  key jsonb not null check (jsonb_typeof(key) = 'object'),
  created_at timestamptz not null default now()
);

comment on table public.capability_eval_answer_keys is
  'Held-out answer keys. No policy and no client grant: scoring returns counts, never key content.';

alter table public.capability_eval_answer_keys enable row level security;
revoke all on public.capability_eval_answer_keys from authenticated;
revoke all on public.capability_eval_answer_keys from anon;

create table if not exists public.capability_eval_runs (
  id uuid primary key default gen_random_uuid(),
  eval_id uuid not null references public.capability_evals (id) on delete cascade,
  version_id uuid not null references public.capability_eval_versions (id) on delete cascade,
  task_id uuid not null references public.capability_eval_tasks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  domain text not null,
  difficulty text not null,
  split text not null,
  trial integer not null check (trial between 1 and 500),
  outcome text not null check (outcome in ('verified_success', 'partial_success', 'failed', 'errored')),
  verified_success boolean not null default false,
  unsupported_claims integer not null default 0 check (unsupported_claims >= 0),
  permission_violations integer not null default 0 check (permission_violations >= 0),
  human_interventions integer not null default 0 check (human_interventions >= 0),
  recovery_attempts integer not null default 0 check (recovery_attempts >= 0),
  recovery_succeeded boolean,
  cost_cents integer not null default 0 check (cost_cents >= 0),
  latency_ms integer not null default 0 check (latency_ms >= 0),
  failure_category text check (failure_category is null or char_length(failure_category) <= 120),
  scoring_detail jsonb not null default '{}'::jsonb
    check (jsonb_typeof(scoring_detail) = 'object'),
  exposure_count integer not null default 1 check (exposure_count >= 1),
  contaminated boolean not null default false,
  created_at timestamptz not null default now(),
  unique (task_id, version_id, trial)
);

comment on table public.capability_eval_runs is
  'Append-only run evidence. Repeated held-out exposure is flagged rather than silently repeated.';

create index if not exists capability_eval_runs_eval_idx
  on public.capability_eval_runs (eval_id, domain, difficulty, split, created_at desc);

create or replace function public.capability_eval_runs_exposure_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_prior integer;
begin
  select count(*) into v_prior
    from public.capability_eval_runs r
   where r.task_id = new.task_id and r.version_id = new.version_id;

  new.exposure_count := v_prior + 1;
  new.contaminated := new.split = 'held_out' and new.exposure_count > 1;
  return new;
end;
$$;

drop trigger if exists capability_eval_runs_exposure on public.capability_eval_runs;
create trigger capability_eval_runs_exposure before insert on public.capability_eval_runs
  for each row execute function public.capability_eval_runs_exposure_guard();

create or replace function public.capability_eval_runs_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'capability evaluation run evidence is append-only';
end;
$$;

drop trigger if exists capability_eval_runs_append_only on public.capability_eval_runs;
create trigger capability_eval_runs_append_only before update on public.capability_eval_runs
  for each row execute function public.capability_eval_runs_append_only();

-- Acceptance material cannot be rewritten once evidence exists.
create or replace function public.capability_eval_tasks_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.capability_eval_runs where task_id = old.id) then
    if new.domain is distinct from old.domain
       or new.difficulty is distinct from old.difficulty
       or new.split is distinct from old.split
       or new.title is distinct from old.title
       or new.task_spec is distinct from old.task_spec
       or new.dataset_version is distinct from old.dataset_version
       or new.permitted_tools is distinct from old.permitted_tools
       or new.runtime_seconds is distinct from old.runtime_seconds
       or new.spend_limit_cents is distinct from old.spend_limit_cents
       or new.scoring_rubric is distinct from old.scoring_rubric then
      raise exception 'capability evaluation task material is immutable after the first run';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists capability_eval_tasks_immutable on public.capability_eval_tasks;
create trigger capability_eval_tasks_immutable before update on public.capability_eval_tasks
  for each row execute function public.capability_eval_tasks_guard();

-- A version is a fixed record. Only its status may change, and autonomy
-- permission never changes at all.
create or replace function public.capability_eval_versions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.autonomy_permission is distinct from old.autonomy_permission then
    raise exception 'an evaluation cannot expand autonomy permission';
  end if;
  if new.label is distinct from old.label
     or new.baseline_kind is distinct from old.baseline_kind
     or new.model_version is distinct from old.model_version
     or new.orchestration_version is distinct from old.orchestration_version
     or new.prompt_version is distinct from old.prompt_version
     or new.dataset_version is distinct from old.dataset_version
     or new.scoring_rubric is distinct from old.scoring_rubric
     or new.permitted_tools is distinct from old.permitted_tools
     or new.runtime_limit_seconds is distinct from old.runtime_limit_seconds
     or new.spend_limit_cents is distinct from old.spend_limit_cents
     or new.human_assistance is distinct from old.human_assistance
     or new.eval_id is distinct from old.eval_id
     or new.user_id is distinct from old.user_id then
    raise exception 'a versioned evaluation configuration is immutable; add a new version';
  end if;
  return new;
end;
$$;

drop trigger if exists capability_eval_versions_immutable on public.capability_eval_versions;
create trigger capability_eval_versions_immutable before update on public.capability_eval_versions
  for each row execute function public.capability_eval_versions_guard();

create table if not exists public.capability_eval_human_baselines (
  id uuid primary key default gen_random_uuid(),
  eval_id uuid not null references public.capability_evals (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  domain text not null check (domain in (
    'software_build_repair', 'research_synthesis', 'quantitative_reasoning',
    'document_analysis', 'planning_under_constraints', 'tool_selection_execution',
    'error_recovery', 'unfamiliar_formats'
  )),
  protocol_document text not null
    check (char_length(btrim(protocol_document)) between 50 and 5000),
  collected_by text not null check (char_length(btrim(collected_by)) between 3 and 160),
  sample_size integer not null check (sample_size between 1 and 1000),
  results jsonb not null check (jsonb_typeof(results) = 'object'),
  status text not null default 'documented' check (status in ('documented', 'retracted')),
  created_at timestamptz not null default now()
);

comment on table public.capability_eval_human_baselines is
  'Human results are stored only with a documented collection protocol. Nothing is synthesised.';

create index if not exists capability_eval_human_baselines_eval_idx
  on public.capability_eval_human_baselines (eval_id, domain);

create or replace function public.capability_eval_human_baselines_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.protocol_document is distinct from old.protocol_document
     or new.collected_by is distinct from old.collected_by
     or new.sample_size is distinct from old.sample_size
     or new.results is distinct from old.results
     or new.domain is distinct from old.domain then
    raise exception 'a human baseline record is immutable; retract it and record a new one';
  end if;
  return new;
end;
$$;

drop trigger if exists capability_eval_human_baselines_immutable on public.capability_eval_human_baselines;
create trigger capability_eval_human_baselines_immutable before update on public.capability_eval_human_baselines
  for each row execute function public.capability_eval_human_baselines_guard();

-- Server-side scoring. The function reads the answer key, compares the
-- submission, and returns counts and a category. For held-out tasks the response
-- never names a required element, so a solving agent cannot learn the key from a
-- score.
create or replace function public.capability_eval_score_task(
  p_task_id uuid,
  p_submission jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.capability_eval_tasks;
  v_eval public.capability_evals;
  v_key jsonb;
  v_required text[];
  v_observed text[];
  v_matched text[] := '{}';
  v_missing text[] := '{}';
  v_element text;
  v_claim jsonb;
  v_unsupported integer := 0;
  v_outcome text;
  v_category text;
begin
  if auth.uid() is null then
    raise exception 'authentication is required';
  end if;

  select * into v_task from public.capability_eval_tasks where id = p_task_id;
  if v_task.id is null then
    raise exception 'unknown evaluation task';
  end if;
  select * into v_eval from public.capability_evals where id = v_task.eval_id;
  if v_eval.user_id is null or v_eval.user_id <> auth.uid() then
    raise exception 'unknown evaluation task';
  end if;

  select key into v_key from public.capability_eval_answer_keys where task_id = p_task_id;
  if v_key is null then
    raise exception 'this task has no answer key';
  end if;

  v_required := array(
    select jsonb_array_elements_text(coalesce(v_key -> 'required_elements', '[]'::jsonb))
  );
  v_observed := array(
    select jsonb_array_elements_text(coalesce(p_submission -> 'elements', '[]'::jsonb))
  );

  foreach v_element in array v_required loop
    if v_element = any(v_observed) then
      v_matched := array_append(v_matched, v_element);
    else
      v_missing := array_append(v_missing, v_element);
    end if;
  end loop;

  for v_claim in select * from jsonb_array_elements(coalesce(p_submission -> 'claims', '[]'::jsonb)) loop
    if coalesce((v_claim ->> 'supported')::boolean, false) is false then
      v_unsupported := v_unsupported + 1;
    end if;
  end loop;

  if cardinality(v_missing) = 0 and v_unsupported = 0 then
    v_outcome := 'verified_success';
    v_category := null;
  elsif v_unsupported > 0 then
    v_outcome := case when cardinality(v_matched) > 0 then 'partial_success' else 'failed' end;
    v_category := 'unsupported_claim';
  elsif cardinality(v_matched) > 0 then
    v_outcome := 'partial_success';
    v_category := 'missing_required_element';
  else
    v_outcome := 'failed';
    v_category := 'no_required_element';
  end if;

  return jsonb_build_object(
    'outcome', v_outcome,
    'verified_success', v_outcome = 'verified_success',
    'matched_count', cardinality(v_matched),
    'required_count', cardinality(v_required),
    'missing_count', cardinality(v_missing),
    'unsupported_claims', v_unsupported,
    'failure_category', v_category,
    'held_out', v_task.split = 'held_out',
    'scoring_detail', jsonb_build_object(
      'split', v_task.split,
      'difficulty', v_task.difficulty,
      'rubric', v_task.scoring_rubric,
      'required_count', cardinality(v_required),
      'matched_count', cardinality(v_matched),
      'missing_count', cardinality(v_missing),
      'key_exposed', false,
      'matched_elements', case
        when v_task.split = 'held_out' then '[]'::jsonb
        else to_jsonb(v_matched)
      end
    )
  );
end;
$$;

comment on function public.capability_eval_score_task(uuid, jsonb) is
  'Scores a submission against the stored key. Never returns held-out key content; counts only.';

revoke all on function public.capability_eval_score_task(uuid, jsonb) from public;
grant execute on function public.capability_eval_score_task(uuid, jsonb) to authenticated;

-- Seeding a key is an owner action, but the owner cannot read what was written.
create or replace function public.capability_eval_seed_keys(p_eval_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'authentication is required';
  end if;
  select user_id into v_owner from public.capability_evals where id = p_eval_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'unknown evaluation workspace';
  end if;

  insert into public.capability_eval_answer_keys (task_id, eval_id, key)
  select
    t.id,
    t.eval_id,
    jsonb_build_object(
      'required_elements',
      case t.domain
        when 'software_build_repair' then '["reproduce","patch","verify"]'::jsonb
        when 'research_synthesis' then '["sources","synthesis","uncertainty"]'::jsonb
        when 'quantitative_reasoning' then '["method","calculation","check"]'::jsonb
        when 'document_analysis' then '["citation","finding","scope"]'::jsonb
        when 'planning_under_constraints' then '["constraints","sequence","risks"]'::jsonb
        when 'tool_selection_execution' then '["tool_choice","arguments","result"]'::jsonb
        when 'error_recovery' then '["diagnosis","correction","confirmation"]'::jsonb
        else '["format_read","adaptation","validation"]'::jsonb
      end
    )
  from public.capability_eval_tasks t
  where t.eval_id = p_eval_id
  on conflict (task_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.capability_eval_seed_keys(uuid) from public;
grant execute on function public.capability_eval_seed_keys(uuid) to authenticated;

alter table public.capability_evals enable row level security;
alter table public.capability_eval_versions enable row level security;
alter table public.capability_eval_tasks enable row level security;
alter table public.capability_eval_runs enable row level security;
alter table public.capability_eval_human_baselines enable row level security;

drop policy if exists "owners manage capability evals" on public.capability_evals;
create policy "owners manage capability evals" on public.capability_evals
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "owners manage capability versions" on public.capability_eval_versions;
create policy "owners manage capability versions" on public.capability_eval_versions
  for all to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from public.capability_evals e where e.id = eval_id and e.user_id = (select auth.uid()))
  )
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.capability_evals e where e.id = eval_id and e.user_id = (select auth.uid()))
  );

drop policy if exists "owners manage capability tasks" on public.capability_eval_tasks;
create policy "owners manage capability tasks" on public.capability_eval_tasks
  for all to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from public.capability_evals e where e.id = eval_id and e.user_id = (select auth.uid()))
  )
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.capability_evals e where e.id = eval_id and e.user_id = (select auth.uid()))
  );

drop policy if exists "owners read capability runs" on public.capability_eval_runs;
create policy "owners read capability runs" on public.capability_eval_runs
  for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "owners record capability runs" on public.capability_eval_runs;
create policy "owners record capability runs" on public.capability_eval_runs
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.capability_evals e where e.id = eval_id and e.user_id = (select auth.uid()))
  );

drop policy if exists "owners read human baselines" on public.capability_eval_human_baselines;
create policy "owners read human baselines" on public.capability_eval_human_baselines
  for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "owners record human baselines" on public.capability_eval_human_baselines;
create policy "owners record human baselines" on public.capability_eval_human_baselines
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.capability_evals e where e.id = eval_id and e.user_id = (select auth.uid()))
  );

grant select, insert, update on public.capability_evals to authenticated;
grant select, insert, update on public.capability_eval_versions to authenticated;
grant select, insert, update on public.capability_eval_tasks to authenticated;
grant select, insert on public.capability_eval_runs to authenticated;
grant select, insert on public.capability_eval_human_baselines to authenticated;

revoke all on public.capability_evals from anon;
revoke all on public.capability_eval_versions from anon;
revoke all on public.capability_eval_tasks from anon;
revoke all on public.capability_eval_runs from anon;
revoke all on public.capability_eval_human_baselines from anon;
