-- GET TO IT — Phase 41: a controlled performance research program.
--
-- The rules this schema enforces:
--
--   * One narrowly defined task family, not "solve anything". The family is a
--     record (`performance_task_families`) naming the authored suite, its
--     version, its digest and its exact task keys. A program may only select
--     its tasks from that record, and a trial may only name one of them.
--   * The comparison is registered before testing. A program is a draft until
--     registration writes the fingerprint, the person and the time; registering
--     freezes every protocol field, and a trial cannot be recorded against a
--     draft or a closed program. There is no way to add a trial and then write
--     the method it satisfies.
--   * Only four claims can be registered: faster, lower cost, better on this
--     benchmark, or better on a documented real-world distribution. A broader
--     general-capability claim is refused at the check constraint, and claim
--     text may not contain AGI/superintelligence/singularity wording.
--   * Human comparisons are documented, never invented. A human reference row
--     carries the expertise, tool access, working conditions, consent basis and
--     collection method, plus measured numeric results.
--   * Independent review is separated from evidence. The person who recorded a
--     trial cannot review it, and the person who registered the comparison
--     cannot independently review it either.
--   * The claim verdict is derived in Postgres from the numbers each time it is
--     read, so it cannot drift from the evidence. When latency was not
--     measured, the speed claim is refused rather than assumed.

-- ---------------------------------------------------------------------------
-- The installed task family
-- ---------------------------------------------------------------------------

create table if not exists public.performance_task_families (
  key text primary key check (char_length(btrim(key)) between 3 and 60),
  version text not null check (char_length(btrim(version)) between 1 and 40),
  suite_digest text not null check (suite_digest ~ '^[0-9a-f]{64}$'),
  task_keys text[] not null check (cardinality(task_keys) between 1 and 200),
  description text not null check (char_length(btrim(description)) between 20 and 1000),
  installed_at timestamptz not null default now()
);

comment on table public.performance_task_families is
  'The one narrow task family this program can test: the authored tool-selection suite, pinned by digest and task keys.';

-- The digest is the same one `suiteDigest()` computes over the authored cases in
-- src/lib/improvement-eval.ts; a unit test keeps the two in step.
insert into public.performance_task_families (key, version, suite_digest, task_keys, description)
values (
  'tool_selection',
  '2026-11-12.1',
  'b9d7fa3b56324afe5089851287e7d24f537acfa4933bdf14a2143b58487bbb99',
  array[
    'issue-for-mission', 'repo-default-branch', 'post-by-id', 'post-by-name',
    'list-channels', 'resolve-general', 'delete-message', 'archive-channel',
    'invite-person', 'merge-pull-request', 'billing-price', 'grant-admin'
  ],
  'Choosing the connector tool for a short intent, including the six refusals that must not move. Twelve authored cases, scored pass or fail with no model call.'
)
on conflict (key) do update set
  version = excluded.version,
  suite_digest = excluded.suite_digest,
  task_keys = excluded.task_keys,
  description = excluded.description;

-- ---------------------------------------------------------------------------
-- The registered comparison
-- ---------------------------------------------------------------------------

create table if not exists public.performance_programs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.app_projects (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 5 and 160),
  question text not null check (char_length(btrim(question)) between 20 and 1000),
  task_family text not null references public.performance_task_families (key),

  -- The registered distribution: suite, version, digest and the exact task keys.
  distribution jsonb not null check (jsonb_typeof(distribution) = 'object'),

  inclusion_rules text not null check (char_length(btrim(inclusion_rules)) between 20 and 2000),
  exclusion_rules text not null check (char_length(btrim(exclusion_rules)) between 10 and 2000),
  scoring_method text not null check (char_length(btrim(scoring_method)) between 20 and 2000),
  baseline_label text not null check (char_length(btrim(baseline_label)) between 3 and 160),
  baseline_config jsonb not null check (jsonb_typeof(baseline_config) = 'object'),
  candidate_label text not null check (char_length(btrim(candidate_label)) between 3 and 160),
  candidate_config jsonb not null check (jsonb_typeof(candidate_config) = 'object'),
  permitted_tools text[] not null check (cardinality(permitted_tools) between 1 and 8),
  time_limit_seconds integer not null check (time_limit_seconds between 10 and 3600),
  cost_limit_cents integer not null check (cost_limit_cents between 0 and 100000),
  trials integer not null check (trials between 1 and 20),
  human_assistance_policy text not null
    check (char_length(btrim(human_assistance_policy)) between 20 and 1000),
  failure_criteria text not null check (char_length(btrim(failure_criteria)) between 20 and 2000),

  supported_claim text not null check (supported_claim in (
    'faster', 'lower_cost', 'benchmark', 'distribution'
  )),
  claim_text text not null check (char_length(btrim(claim_text)) between 20 and 500),
  -- The minimum effect is read in the registered claim's own unit: score points
  -- for a benchmark or distribution claim, percentage points for faster or
  -- lower cost.
  minimum_effect numeric(7, 4) not null check (minimum_effect between 0 and 100),
  -- How much the candidate may lose on the score while still being compared on
  -- speed or cost.
  noninferiority_margin numeric(5, 4) not null default 0
    check (noninferiority_margin between 0 and 1),
  max_disagreements integer not null default 0 check (max_disagreements between 0 and 100),

  status text not null default 'draft' check (status in ('draft', 'registered', 'closed')),
  fingerprint text check (fingerprint ~ '^[0-9a-f]{64}$'),
  registered_at timestamptz,
  registered_by uuid references auth.users (id) on delete set null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (lower(claim_text) !~ '(^|[^a-z])(agi|artificial general intelligence|superintelligence|singularity)([^a-z]|$)'),
  check ((distribution ->> 'suite') = task_family),
  check (jsonb_array_length(coalesce(distribution -> 'task_keys', '[]'::jsonb)) between 1 and 200),
  check (status = 'draft' or (fingerprint is not null and registered_at is not null and registered_by is not null)),
  check (status <> 'closed' or closed_at is not null)
);

comment on table public.performance_programs is
  'One pre-registered comparison: task distribution, inclusion/exclusion, scoring, baseline, tools, limits, trials, assistance policy, failure criteria and the single claim it could support.';

create index if not exists performance_programs_workspace_idx
  on public.performance_programs (workspace_id, created_at desc);

drop trigger if exists performance_programs_set_updated_at on public.performance_programs;
create trigger performance_programs_set_updated_at before update on public.performance_programs
  for each row execute function public.set_updated_at();

-- Registration is a one-way door: the protocol is fixed when the comparison is
-- registered, and the only later change is closing it.
create or replace function public.performance_programs_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_family public.performance_task_families;
  v_keys jsonb;
begin
  select * into v_family from public.performance_task_families f where f.key = new.task_family;
  if not found then
    raise exception 'the task family is not installed';
  end if;

  if (new.distribution ->> 'digest') is distinct from v_family.suite_digest then
    raise exception 'the registered suite digest does not match the installed task family';
  end if;
  if (new.distribution ->> 'version') is distinct from v_family.version then
    raise exception 'the registered suite version does not match the installed task family';
  end if;

  v_keys := coalesce(new.distribution -> 'task_keys', '[]'::jsonb);
  if jsonb_typeof(v_keys) <> 'array' then
    raise exception 'the task distribution must list its task keys';
  end if;
  if exists (
    select 1
      from jsonb_array_elements_text(v_keys) as key
     where not (key = any (v_family.task_keys))
  ) then
    raise exception 'a registered task is not part of the installed task family';
  end if;
  if (select count(distinct value) from jsonb_array_elements_text(v_keys)) <> jsonb_array_length(v_keys) then
    raise exception 'the task distribution lists the same task twice';
  end if;
  if jsonb_array_length(v_keys) * new.trials > 1200 then
    raise exception 'the registered trial plan is larger than one comparison may hold';
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'closed' then
      raise exception 'a comparison cannot be inserted as closed';
    end if;
    if new.status = 'registered'
       and (new.fingerprint is null or new.registered_at is null or new.registered_by is null) then
      raise exception 'registration records the fingerprint, the person and the time';
    end if;
    return new;
  end if;

  if old.status = 'closed' then
    raise exception 'a closed comparison cannot be changed';
  end if;

  if old.status = 'registered' then
    if new.status = 'closed' then
      if new.closed_at is null then
        raise exception 'closing a comparison records when it closed';
      end if;
      if new.title is distinct from old.title
         or new.question is distinct from old.question
         or new.task_family is distinct from old.task_family
         or new.distribution is distinct from old.distribution
         or new.inclusion_rules is distinct from old.inclusion_rules
         or new.exclusion_rules is distinct from old.exclusion_rules
         or new.scoring_method is distinct from old.scoring_method
         or new.baseline_label is distinct from old.baseline_label
         or new.baseline_config is distinct from old.baseline_config
         or new.candidate_label is distinct from old.candidate_label
         or new.candidate_config is distinct from old.candidate_config
         or new.permitted_tools is distinct from old.permitted_tools
         or new.time_limit_seconds is distinct from old.time_limit_seconds
         or new.cost_limit_cents is distinct from old.cost_limit_cents
         or new.trials is distinct from old.trials
         or new.human_assistance_policy is distinct from old.human_assistance_policy
         or new.failure_criteria is distinct from old.failure_criteria
         or new.supported_claim is distinct from old.supported_claim
         or new.claim_text is distinct from old.claim_text
         or new.minimum_effect is distinct from old.minimum_effect
         or new.noninferiority_margin is distinct from old.noninferiority_margin
         or new.max_disagreements is distinct from old.max_disagreements
         or new.fingerprint is distinct from old.fingerprint
         or new.registered_at is distinct from old.registered_at
         or new.registered_by is distinct from old.registered_by then
        raise exception 'the registered comparison is frozen; record a new program instead';
      end if;
      return new;
    end if;
    raise exception 'the registered comparison is frozen; record a new program instead';
  end if;

  -- Drafts may be edited, but not made to look registered without the rest of
  -- the registration.
  if new.status = 'registered' then
    if new.fingerprint is null or new.registered_at is null or new.registered_by is null then
      raise exception 'registration records the fingerprint, the person and the time';
    end if;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists performance_programs_guard on public.performance_programs;
create trigger performance_programs_guard before insert or update on public.performance_programs
  for each row execute function public.performance_programs_guard();

-- ---------------------------------------------------------------------------
-- Trials (append-only evidence)
-- ---------------------------------------------------------------------------

create table if not exists public.performance_trials (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.performance_programs (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  config text not null check (config in ('baseline', 'candidate')),
  task_key text not null check (char_length(btrim(task_key)) between 1 and 80),
  trial integer not null check (trial between 1 and 20),
  outcome text not null check (outcome in ('pass', 'partial', 'fail')),
  score numeric(5, 4) not null check (score between 0 and 1),
  cost_cents integer not null default 0 check (cost_cents >= 0),
  cost_units integer not null default 0 check (cost_units >= 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  human_assisted boolean not null default false,
  source text not null default 'authored_suite'
    check (source in ('authored_suite', 'capability_run', 'manual')),
  source_id uuid,
  recorded_by uuid not null references auth.users (id) on delete cascade,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (program_id, config, task_key, trial),
  check (
    (outcome = 'pass' and score = 1)
    or (outcome = 'fail' and score = 0)
    or (outcome = 'partial' and score > 0 and score < 1)
  ),
  check (source <> 'authored_suite' or source_id is null),
  check (source <> 'capability_run' or source_id is not null)
);

comment on table public.performance_trials is
  'One recorded attempt: configuration, task, trial number, outcome, cost, latency (null when unmeasured) and whether a person helped.';

create index if not exists performance_trials_program_idx
  on public.performance_trials (program_id, config, task_key, trial);

create or replace function public.performance_trials_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_program public.performance_programs;
  v_family public.performance_task_families;
begin
  select * into v_program from public.performance_programs p where p.id = new.program_id;
  if not found then
    raise exception 'the comparison does not exist';
  end if;
  if v_program.status = 'draft' then
    raise exception 'register the comparison before recording a trial';
  end if;
  if v_program.status = 'closed' then
    raise exception 'this comparison is closed';
  end if;
  if new.workspace_id is distinct from v_program.workspace_id then
    raise exception 'a trial belongs to the workspace of its comparison';
  end if;
  if new.trial > v_program.trials then
    raise exception 'the registered plan allows % trials', v_program.trials;
  end if;

  select * into v_family from public.performance_task_families f where f.key = v_program.task_family;
  if not (new.task_key = any (v_family.task_keys)) then
    raise exception 'that task is outside the registered distribution';
  end if;
  if not ((v_program.distribution -> 'task_keys') ? new.task_key) then
    raise exception 'that task was not part of this comparison''s registered distribution';
  end if;
  if (v_program.distribution ->> 'digest') is distinct from v_family.suite_digest then
    raise exception 'the registered suite digest no longer matches the installed task family';
  end if;

  if not exists (
    select 1 from public.workspace_members m
     where m.workspace_id = v_program.workspace_id
       and m.user_id = new.recorded_by
       and m.status = 'active'
  ) then
    raise exception 'only a member of the workspace can record a trial';
  end if;

  if new.source = 'capability_run' and not exists (
    select 1
      from public.capability_eval_runs r
      join public.capability_evals e on e.id = r.eval_id
      join public.workspace_members m on m.user_id = e.user_id
     where r.id = new.source_id
       and m.workspace_id = v_program.workspace_id
       and m.status = 'active'
  ) then
    raise exception 'that capability run does not belong to a member of this workspace';
  end if;

  return new;
end;
$$;

drop trigger if exists performance_trials_guard on public.performance_trials;
create trigger performance_trials_guard before insert on public.performance_trials
  for each row execute function public.performance_trials_guard();

-- Append-only means a recorded trial cannot be rewritten. Deleting the workspace is
-- a different act: its evidence goes with it, so a delete is allowed to cascade.
create or replace function public.performance_trials_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'performance trial evidence is append-only';
end;
$$;

drop trigger if exists performance_trials_append_only on public.performance_trials;
create trigger performance_trials_append_only before update on public.performance_trials
  for each row execute function public.performance_trials_append_only();

-- ---------------------------------------------------------------------------
-- Human references: documented, measured, never fabricated
-- ---------------------------------------------------------------------------

create table if not exists public.performance_human_references (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.performance_programs (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  expertise text not null check (char_length(btrim(expertise)) between 20 and 1000),
  tool_access text not null check (char_length(btrim(tool_access)) between 20 and 1000),
  conditions text not null check (char_length(btrim(conditions)) between 20 and 1000),
  consent_basis text not null check (char_length(btrim(consent_basis)) between 20 and 1000),
  collection_method text not null check (char_length(btrim(collection_method)) between 30 and 2000),
  participants integer not null check (participants between 1 and 1000),
  task_count integer not null check (task_count between 1 and 1000),
  passed integer not null check (passed >= 0),
  mean_score numeric(5, 4) not null check (mean_score between 0 and 1),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  check (passed <= task_count)
);

comment on table public.performance_human_references is
  'A legitimately collected human result with its protocol, expertise, tools, conditions and consent basis. Nothing here is synthesised.';

create index if not exists performance_human_references_program_idx
  on public.performance_human_references (program_id, created_at desc);

create or replace function public.performance_human_references_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_program public.performance_programs;
begin
  select * into v_program from public.performance_programs p where p.id = new.program_id;
  if not found then
    raise exception 'the comparison does not exist';
  end if;
  if v_program.status = 'draft' then
    raise exception 'register the comparison before documenting a human reference';
  end if;
  if new.workspace_id is distinct from v_program.workspace_id then
    raise exception 'a human reference belongs to the workspace of its comparison';
  end if;
  if not exists (
    select 1 from public.workspace_members m
     where m.workspace_id = v_program.workspace_id
       and m.user_id = new.user_id
       and m.status = 'active'
  ) then
    raise exception 'only a member of the workspace can document a human reference';
  end if;
  return new;
end;
$$;

drop trigger if exists performance_human_references_guard on public.performance_human_references;
create trigger performance_human_references_guard before insert on public.performance_human_references
  for each row execute function public.performance_human_references_guard();

-- ---------------------------------------------------------------------------
-- Independent review marks
-- ---------------------------------------------------------------------------

create table if not exists public.performance_review_marks (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.performance_programs (id) on delete cascade,
  trial_id uuid not null references public.performance_trials (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  reviewer_id uuid not null references auth.users (id) on delete cascade,
  verdict text not null check (verdict in ('agree', 'disagree')),
  note text not null check (char_length(btrim(note)) between 10 and 500),
  created_at timestamptz not null default now(),
  unique (trial_id, reviewer_id)
);

comment on table public.performance_review_marks is
  'A second person rescoring a recorded trial. The recorder and the registrar cannot mark their own work.';

create index if not exists performance_review_marks_program_idx
  on public.performance_review_marks (program_id, verdict);

create or replace function public.performance_review_marks_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_program public.performance_programs;
  v_trial public.performance_trials;
begin
  select * into v_trial from public.performance_trials t where t.id = new.trial_id;
  if not found then
    raise exception 'the trial does not exist';
  end if;
  select * into v_program from public.performance_programs p where p.id = v_trial.program_id;
  if new.program_id is distinct from v_trial.program_id then
    raise exception 'a review mark belongs to the trial''s comparison';
  end if;
  if new.reviewer_id = v_trial.recorded_by then
    raise exception 'the person who recorded a trial cannot review it';
  end if;
  if new.reviewer_id = v_program.registered_by then
    raise exception 'the person who registered the comparison cannot independently review it';
  end if;
  if not exists (
    select 1 from public.workspace_members m
     where m.workspace_id = v_trial.workspace_id
       and m.user_id = new.reviewer_id
       and m.status = 'active'
  ) then
    raise exception 'only a member of the workspace can review a trial';
  end if;
  if new.workspace_id is distinct from v_trial.workspace_id then
    raise exception 'a review mark belongs to the trial''s workspace';
  end if;
  return new;
end;
$$;

drop trigger if exists performance_review_marks_guard on public.performance_review_marks;
create trigger performance_review_marks_guard before insert on public.performance_review_marks
  for each row execute function public.performance_review_marks_guard();

create or replace function public.performance_review_marks_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'a review mark is a record of what a reviewer decided; add another mark instead';
end;
$$;

drop trigger if exists performance_review_marks_immutable on public.performance_review_marks;
create trigger performance_review_marks_immutable before update on public.performance_review_marks
  for each row execute function public.performance_review_marks_immutable();

-- ---------------------------------------------------------------------------
-- Closing a program is its own small decision
-- ---------------------------------------------------------------------------

create or replace function public.performance_program_close(p_program_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_program public.performance_programs;
  v_role text;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_program from public.performance_programs p where p.id = p_program_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;

  v_role := public.workspace_role(v_program.workspace_id);
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'no-workspace');
  end if;

  if v_program.status <> 'registered' then
    return jsonb_build_object('ok', false, 'code', 'not-registered');
  end if;

  if v_program.user_id <> v_me and v_role not in ('owner', 'admin') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  update public.performance_programs
     set status = 'closed', closed_at = now()
   where id = p_program_id;

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.performance_program_close(uuid) is
  'Closes a registered comparison so no further trials can be recorded. Only the registrar or a workspace owner/admin may close it.';

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

create or replace function public.workspace_performance_programs(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_me uuid := auth.uid();
  v_rows jsonb;
  v_total integer;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;
  if public.workspace_role(p_workspace_id) is null then
    return jsonb_build_object('ok', false, 'code', 'no-workspace');
  end if;

  select count(*) into v_total
    from public.performance_programs p
   where p.workspace_id = p_workspace_id;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', p.id,
               'title', p.title,
               'status', p.status,
               'task_family', p.task_family,
               'supported_claim', p.supported_claim,
               'claim_text', p.claim_text,
               'baseline_label', p.baseline_label,
               'candidate_label', p.candidate_label,
               'trials', p.trials,
               'tasks', jsonb_array_length(p.distribution -> 'task_keys'),
               'expected_rows', jsonb_array_length(p.distribution -> 'task_keys') * p.trials * 2,
               'registered_at', p.registered_at,
               'created_at', p.created_at,
               'trial_rows', (
                 select count(*) from public.performance_trials t where t.program_id = p.id
               ),
               'baseline_rows', (
                 select count(*) from public.performance_trials t
                  where t.program_id = p.id and t.config = 'baseline'
               ),
               'candidate_rows', (
                 select count(*) from public.performance_trials t
                  where t.program_id = p.id and t.config = 'candidate'
               ),
               'human_references', (
                 select count(*) from public.performance_human_references h where h.program_id = p.id
               ),
               'disagreements', (
                 select count(*) from public.performance_review_marks m
                  where m.program_id = p.id and m.verdict = 'disagree'
               )
             )
             order by p.created_at desc
           ),
           '[]'::jsonb
         )
    into v_rows
    from public.performance_programs p
   where p.workspace_id = p_workspace_id;

  return jsonb_build_object('ok', true, 'total', v_total, 'programs', v_rows);
end;
$$;

create or replace function public.workspace_performance_report(p_program_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_me uuid := auth.uid();
  v_program public.performance_programs;
  v_family public.performance_task_families;
  v_tasks integer;
  v_expected integer;

  v_b_rows integer := 0;
  v_b_tasks integer := 0;
  v_b_passes integer := 0;
  v_b_partials integer := 0;
  v_b_fails integer := 0;
  v_b_mean numeric := 0;
  v_b_cost_cents numeric := 0;
  v_b_cost_units numeric := 0;
  v_b_median numeric;
  v_b_max_cost integer := 0;
  v_b_max_duration integer := 0;
  v_b_human integer := 0;

  v_c_rows integer := 0;
  v_c_tasks integer := 0;
  v_c_passes integer := 0;
  v_c_partials integer := 0;
  v_c_fails integer := 0;
  v_c_mean numeric := 0;
  v_c_cost_cents numeric := 0;
  v_c_cost_units numeric := 0;
  v_c_median numeric;
  v_c_max_cost integer := 0;
  v_c_max_duration integer := 0;
  v_c_human integer := 0;

  v_reviewed integer := 0;
  v_disagreements integer := 0;
  v_refs integer := 0;
  v_participants integer := 0;

  v_complete boolean;
  v_gain numeric;
  v_cost_pct numeric;
  v_duration_pct numeric;
  v_noninf boolean;
  v_assist_ok boolean;
  v_limits_ok boolean;
  v_reviews_ok boolean;
  v_supported boolean := false;
  v_verdict text;
  v_reasons text[] := '{}';
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_program from public.performance_programs p where p.id = p_program_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;
  if public.workspace_role(v_program.workspace_id) is null then
    return jsonb_build_object('ok', false, 'code', 'no-workspace');
  end if;

  select * into v_family from public.performance_task_families f where f.key = v_program.task_family;
  v_tasks := jsonb_array_length(v_program.distribution -> 'task_keys');
  v_expected := v_tasks * v_program.trials;

  select
    count(*),
    count(distinct task_key),
    count(*) filter (where outcome = 'pass'),
    count(*) filter (where outcome = 'partial'),
    count(*) filter (where outcome = 'fail'),
    coalesce(avg(score), 0),
    coalesce(avg(cost_cents), 0),
    coalesce(avg(cost_units), 0),
    percentile_cont(0.5) within group (order by duration_ms),
    coalesce(max(cost_cents), 0),
    coalesce(max(duration_ms), 0),
    count(*) filter (where human_assisted)
  into
    v_b_rows, v_b_tasks, v_b_passes, v_b_partials, v_b_fails, v_b_mean,
    v_b_cost_cents, v_b_cost_units, v_b_median, v_b_max_cost, v_b_max_duration, v_b_human
  from public.performance_trials t
  where t.program_id = p_program_id and t.config = 'baseline';

  select
    count(*),
    count(distinct task_key),
    count(*) filter (where outcome = 'pass'),
    count(*) filter (where outcome = 'partial'),
    count(*) filter (where outcome = 'fail'),
    coalesce(avg(score), 0),
    coalesce(avg(cost_cents), 0),
    coalesce(avg(cost_units), 0),
    percentile_cont(0.5) within group (order by duration_ms),
    coalesce(max(cost_cents), 0),
    coalesce(max(duration_ms), 0),
    count(*) filter (where human_assisted)
  into
    v_c_rows, v_c_tasks, v_c_passes, v_c_partials, v_c_fails, v_c_mean,
    v_c_cost_cents, v_c_cost_units, v_c_median, v_c_max_cost, v_c_max_duration, v_c_human
  from public.performance_trials t
  where t.program_id = p_program_id and t.config = 'candidate';

  select count(*) into v_reviewed
    from public.performance_review_marks m
   where m.program_id = p_program_id;
  select count(*) into v_disagreements
    from public.performance_review_marks m
   where m.program_id = p_program_id and m.verdict = 'disagree';

  select count(*), coalesce(sum(h.participants), 0)
    into v_refs, v_participants
    from public.performance_human_references h
   where h.program_id = p_program_id;

  v_complete := v_b_rows = v_expected and v_c_rows = v_expected;
  v_gain := round(v_c_mean - v_b_mean, 4);
  v_cost_pct := case
    when v_b_cost_cents > 0 then round((v_b_cost_cents - v_c_cost_cents) / v_b_cost_cents * 100, 2)
    else null
  end;
  v_duration_pct := case
    when v_b_median is not null and v_b_median > 0 and v_c_median is not null
      then round((v_b_median - v_c_median) / v_b_median * 100, 2)
    else null
  end;
  v_noninf := v_c_mean + v_program.noninferiority_margin >= v_b_mean;
  v_assist_ok := v_c_human <= v_b_human;
  v_limits_ok := v_b_max_cost <= v_program.cost_limit_cents
    and v_c_max_cost <= v_program.cost_limit_cents
    and v_b_max_duration <= v_program.time_limit_seconds * 1000
    and v_c_max_duration <= v_program.time_limit_seconds * 1000;
  v_reviews_ok := v_disagreements <= v_program.max_disagreements;

  if not v_complete then
    v_reasons := array_append(
      v_reasons,
      format(
        'The comparison is incomplete: %s of %s planned trials are recorded for the baseline and %s of %s for the candidate.',
        v_b_rows, v_expected, v_c_rows, v_expected
      )
    );
  end if;

  if not v_limits_ok then
    v_reasons := array_append(
      v_reasons,
      format(
        'A trial exceeded the registered cost or time limit (%s cents, %s seconds), so the run is not a clean measurement.',
        v_program.cost_limit_cents, v_program.time_limit_seconds
      )
    );
  end if;

  if not v_reviews_ok then
    v_reasons := array_append(
      v_reasons,
      format(
        'Independent review disagrees on %s of %s marked trials, above the registered allowance of %s.',
        v_disagreements, v_reviewed, v_program.max_disagreements
      )
    );
  end if;

  if not v_assist_ok then
    v_reasons := array_append(
      v_reasons,
      format(
        'The candidate needed human assistance in %s trials versus %s for the baseline, so the comparison is confounded.',
        v_c_human, v_b_human
      )
    );
  end if;

  if not v_noninf then
    v_reasons := array_append(
      v_reasons,
      format(
        'The candidate scored %s below the baseline, more than the allowed margin of %s.',
        round(v_b_mean - v_c_mean, 4), v_program.noninferiority_margin
      )
    );
  end if;

  if v_program.supported_claim in ('benchmark', 'distribution') then
    if v_gain < v_program.minimum_effect then
      v_reasons := array_append(
        v_reasons,
        format(
          'Mean score improved by %s points, below the registered minimum effect of %s.',
          v_gain, v_program.minimum_effect
        )
      );
    end if;
    if v_program.supported_claim = 'distribution' and v_refs = 0 then
      v_reasons := array_append(
        v_reasons,
        'No documented human reference exists for the real-world distribution, so the result stays a benchmark result on the authored family.'
      );
    end if;
  elsif v_program.supported_claim = 'faster' then
    if v_b_median is null or v_c_median is null then
      v_reasons := array_append(
        v_reasons,
        'Latency was not recorded for both configurations, so no speed claim is available from this program.'
      );
    elsif v_duration_pct < v_program.minimum_effect then
      v_reasons := array_append(
        v_reasons,
        format(
          'Median latency fell by %s percent, below the registered minimum effect of %s percent.',
          v_duration_pct, v_program.minimum_effect
        )
      );
    end if;
  elsif v_program.supported_claim = 'lower_cost' then
    if v_cost_pct is null then
      v_reasons := array_append(
        v_reasons,
        'Neither configuration recorded a measured cost, so a lower-cost claim has no evidence here.'
      );
    elsif v_cost_pct < v_program.minimum_effect then
      v_reasons := array_append(
        v_reasons,
        format(
          'Mean cost fell by %s percent, below the registered minimum effect of %s percent.',
          v_cost_pct, v_program.minimum_effect
        )
      );
    end if;
  end if;

  v_supported := v_complete and cardinality(v_reasons) = 0;
  v_verdict := case
    when not v_complete then 'awaiting_evidence'
    when v_supported then 'supported'
    else 'not_supported'
  end;

  return jsonb_build_object(
    'ok', true,
    'program', to_jsonb(v_program),
    'family', jsonb_build_object(
      'key', v_family.key,
      'version', v_family.version,
      'suite_digest', v_family.suite_digest,
      'task_keys', to_jsonb(v_family.task_keys),
      'description', v_family.description
    ),
    'plan', jsonb_build_object(
      'tasks', v_tasks,
      'trials', v_program.trials,
      'expected_rows', v_expected
    ),
    'baseline', jsonb_build_object(
      'rows', v_b_rows,
      'tasks', v_b_tasks,
      'passes', v_b_passes,
      'partials', v_b_partials,
      'fails', v_b_fails,
      'mean_score', round(v_b_mean, 4),
      'mean_cost_cents', round(v_b_cost_cents, 2),
      'mean_cost_units', round(v_b_cost_units, 2),
      'median_duration_ms', v_b_median,
      'max_cost_cents', v_b_max_cost,
      'max_duration_ms', v_b_max_duration,
      'human_assisted', v_b_human
    ),
    'candidate', jsonb_build_object(
      'rows', v_c_rows,
      'tasks', v_c_tasks,
      'passes', v_c_passes,
      'partials', v_c_partials,
      'fails', v_c_fails,
      'mean_score', round(v_c_mean, 4),
      'mean_cost_cents', round(v_c_cost_cents, 2),
      'mean_cost_units', round(v_c_cost_units, 2),
      'median_duration_ms', v_c_median,
      'max_cost_cents', v_c_max_cost,
      'max_duration_ms', v_c_max_duration,
      'human_assisted', v_c_human
    ),
    'effect', jsonb_build_object(
      'score_gain', v_gain,
      'cost_reduction_pct', v_cost_pct,
      'latency_reduction_pct', v_duration_pct,
      'within_noninferiority', v_noninf,
      'assistance_matched', v_assist_ok,
      'within_limits', v_limits_ok
    ),
    'reviews', jsonb_build_object(
      'reviewed', v_reviewed,
      'marked_trials', v_reviewed,
      'disagreements', v_disagreements,
      'max_disagreements', v_program.max_disagreements,
      'separated_from_recorder', true
    ),
    'human_references', jsonb_build_object(
      'count', v_refs,
      'participants', v_participants
    ),
    'claims', jsonb_build_object(
      'registered', v_program.supported_claim,
      'supported', v_supported,
      'verdict', v_verdict,
      'complete', v_complete,
      'reasons', to_jsonb(v_reasons),
      'refused', jsonb_build_array(
        jsonb_build_object(
          'claim', 'general_capability',
          'reason', 'One authored task family cannot support a broader general-capability claim, whatever the score on it.'
        ),
        jsonb_build_object(
          'claim', case when v_program.supported_claim = 'faster' then 'lower_cost' else 'faster' end,
          'reason', 'This program registered one claim only; the other comparison is not supported by evidence it did not collect.'
        ),
        jsonb_build_object(
          'claim', 'distribution',
          'reason', case
            when v_program.supported_claim = 'distribution' then 'Registered as this program''s claim; supported only with a documented human reference.'
            else 'The tasks are an authored benchmark, not a sample of a real-world task distribution.'
          end
        )
      )
    )
  );
end;
$$;

comment on function public.workspace_performance_report(uuid) is
  'The registered comparison plus the numbers recorded against it, with the single claim it supports and the claims it refuses, re-derived from the rows on every read.';

revoke all on function public.workspace_performance_programs(uuid) from public, anon;
revoke all on function public.workspace_performance_report(uuid) from public, anon;
revoke all on function public.performance_program_close(uuid) from public, anon;
grant execute on function public.workspace_performance_programs(uuid) to authenticated;
grant execute on function public.workspace_performance_report(uuid) to authenticated;
grant execute on function public.performance_program_close(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.performance_task_families enable row level security;
alter table public.performance_programs enable row level security;
alter table public.performance_trials enable row level security;
alter table public.performance_human_references enable row level security;
alter table public.performance_review_marks enable row level security;

revoke all on public.performance_task_families from anon;
revoke all on public.performance_programs from anon;
revoke all on public.performance_trials from anon;
revoke all on public.performance_human_references from anon;
revoke all on public.performance_review_marks from anon;

grant select on public.performance_task_families to authenticated;
grant select, insert on public.performance_programs to authenticated;
grant select, insert on public.performance_trials to authenticated;
grant select, insert on public.performance_human_references to authenticated;
grant select, insert on public.performance_review_marks to authenticated;

drop policy if exists "members read task families" on public.performance_task_families;
create policy "members read task families" on public.performance_task_families
  for select to authenticated
  using (true);

drop policy if exists "members read performance programs" on public.performance_programs;
create policy "members read performance programs" on public.performance_programs
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members register performance programs" on public.performance_programs;
create policy "members register performance programs" on public.performance_programs
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.workspace_role(workspace_id) is not null
  );

-- The registrar may edit a draft and close a registered comparison; the trigger
-- is what refuses any other change, so a privileged write cannot bypass it.
drop policy if exists "registrars update performance programs" on public.performance_programs;
create policy "registrars update performance programs" on public.performance_programs
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and public.workspace_role(workspace_id) is not null
  )
  with check (
    user_id = (select auth.uid())
    and public.workspace_role(workspace_id) is not null
  );

drop policy if exists "members read performance trials" on public.performance_trials;
create policy "members read performance trials" on public.performance_trials
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members record performance trials" on public.performance_trials;
create policy "members record performance trials" on public.performance_trials
  for insert to authenticated
  with check (
    recorded_by = (select auth.uid())
    and public.workspace_role(workspace_id) is not null
  );

drop policy if exists "members read human references" on public.performance_human_references;
create policy "members read human references" on public.performance_human_references
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members document human references" on public.performance_human_references;
create policy "members document human references" on public.performance_human_references
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.workspace_role(workspace_id) is not null
  );

drop policy if exists "members read review marks" on public.performance_review_marks;
create policy "members read review marks" on public.performance_review_marks
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members mark reviews" on public.performance_review_marks;
create policy "members mark reviews" on public.performance_review_marks
  for insert to authenticated
  with check (
    reviewer_id = (select auth.uid())
    and public.workspace_role(workspace_id) is not null
  );
