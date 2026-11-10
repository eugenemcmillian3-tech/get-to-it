-- GET TO IT — Phase 36 schema
-- MAGI outcome orchestration: one approved intent carried through planning,
-- execution, verification and a human outcome review.
--
-- Ground rules encoded here:
--   * Orchestration references existing records by id. It copies no mission,
--     experiment, learning goal or opportunity into a competing store.
--   * Contracts are versioned. An approved version is immutable, and approval is
--     bound to that version and fingerprint. A material change needs a new
--     approval before anything runs.
--   * Lifecycle moves happen only through orchestration_transition(), which
--     repeats the application's transition table. Direct updates are not
--     granted to clients.
--   * Spending is integer micro-credits (1000000 = 1 credit = $0.10). A task
--     reserves atomically under a row lock, so two concurrent tasks cannot pass
--     the authorized maximum.
--   * Tasks, evidence, events and checkpoints are append-only, except for the
--     status fields moved by the security-definer functions below.
--   * No function here deploys, publishes, sends outreach or charges a card.
--     Those remain existing, separately approved production controls.
--
-- Nothing in this migration is applied to any environment by itself.

-- ---------------------------------------------------------------------------
-- 1. Orchestration record
-- ---------------------------------------------------------------------------

create table if not exists public.orchestrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  origin_kind text not null check (origin_kind in (
    'mission', 'experiment', 'learning_goal', 'radar_signal',
    'future_path', 'outcome_review', 'new_goal'
  )),
  mission_id uuid references public.missions (id) on delete set null,
  experiment_id uuid references public.experiments (id) on delete set null,
  learning_goal_id uuid references public.goals (id) on delete set null,
  radar_signal_id uuid references public.radar_signals (id) on delete set null,
  future_path_id uuid references public.future_paths (id) on delete set null,
  outcome_review_id uuid references public.outcome_reviews (id) on delete set null,
  prototype_project_id uuid references public.app_projects (id) on delete set null,
  goal text not null check (char_length(btrim(goal)) between 8 and 1000),
  status text not null default 'draft' check (status in (
    'draft', 'awaiting_approval', 'ready', 'running', 'paused',
    'awaiting_input', 'awaiting_action_approval', 'verifying',
    'awaiting_review', 'completed', 'needs_revision', 'stopped', 'failed',
    'cancellation_requested'
  )),
  current_contract_id uuid,
  approved_contract_id uuid,
  authorized_micros bigint not null default 0 check (authorized_micros >= 0),
  reserved_micros bigint not null default 0 check (reserved_micros >= 0),
  consumed_micros bigint not null default 0 check (consumed_micros >= 0),
  review_at date not null,
  high_stakes boolean not null default false check (not high_stakes),
  stop_condition_reached boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (consumed_micros + reserved_micros <= authorized_micros),
  check (
    (origin_kind = 'new_goal'
      and mission_id is not null and experiment_id is null and learning_goal_id is null
      and radar_signal_id is null and future_path_id is null and outcome_review_id is null)
    or
    (origin_kind = 'mission' and mission_id is not null)
    or
    (origin_kind = 'experiment' and experiment_id is not null)
    or
    (origin_kind = 'learning_goal' and learning_goal_id is not null)
    or
    (origin_kind = 'radar_signal' and radar_signal_id is not null)
    or
    (origin_kind = 'future_path' and future_path_id is not null)
    or
    (origin_kind = 'outcome_review' and outcome_review_id is not null)
  )
);

comment on table public.orchestrations is
  'One approved goal carried through planning, execution, verification and human review. Links existing records by id.';
comment on column public.orchestrations.high_stakes is
  'Always false. High-stakes medical, legal, financial, safety, crisis or work-with-minors activity is refused here.';
comment on column public.orchestrations.authorized_micros is
  'Integer micro-credits. 1000000 = one credit = $0.10 retail. No internal action is rounded up to a whole credit.';

create index if not exists orchestrations_workspace_idx
  on public.orchestrations (workspace_id, created_at desc);
create index if not exists orchestrations_review_idx
  on public.orchestrations (workspace_id, review_at);

drop trigger if exists orchestrations_set_updated_at on public.orchestrations;
create trigger orchestrations_set_updated_at before update on public.orchestrations
  for each row execute function public.set_updated_at();

-- A linked record must belong to the same workspace when it is a mission, and
-- must be one of the creator's own records otherwise. A link grants no access.
create or replace function public.orchestrations_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.high_stakes then
    raise exception 'high-stakes activity is not supported in this workflow';
  end if;

  if new.origin_kind in ('mission', 'new_goal') then
    if not exists (
      select 1 from public.missions m
       where m.id = new.mission_id and m.workspace_id = new.workspace_id
    ) then
      raise exception 'the mission must belong to the same workspace';
    end if;
  elsif new.origin_kind = 'experiment' then
    if not exists (
      select 1 from public.experiments e
       where e.id = new.experiment_id and e.workspace_id = new.workspace_id
    ) then
      raise exception 'the experiment must belong to the same workspace';
    end if;
  elsif new.origin_kind = 'learning_goal' then
    if not exists (
      select 1 from public.goals g
       where g.id = new.learning_goal_id and g.user_id = new.created_by
    ) then
      raise exception 'the learning goal must be one of the creator own goals';
    end if;
  elsif new.origin_kind = 'radar_signal' then
    if not exists (
      select 1 from public.radar_signals s
       where s.id = new.radar_signal_id and s.user_id = new.created_by
    ) then
      raise exception 'the radar signal must be one of the creator own records';
    end if;
  elsif new.origin_kind = 'future_path' then
    if not exists (
      select 1 from public.future_paths p
       where p.id = new.future_path_id and p.user_id = new.created_by
    ) then
      raise exception 'the scenario must be one of the creator own records';
    end if;
  elsif new.origin_kind = 'outcome_review' then
    if not exists (
      select 1 from public.outcome_reviews r
       where r.id = new.outcome_review_id and r.user_id = new.created_by
    ) then
      raise exception 'the outcome review must be one of the creator own reviews';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    if new.workspace_id is distinct from old.workspace_id
       or new.created_by is distinct from old.created_by
       or new.origin_kind is distinct from old.origin_kind then
      raise exception 'the owner, workspace and origin cannot be changed';
    end if;
    if new.consumed_micros < old.consumed_micros then
      raise exception 'consumed credits cannot decrease';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists orchestrations_guard_trigger on public.orchestrations;
create trigger orchestrations_guard_trigger
  before insert or update on public.orchestrations
  for each row execute function public.orchestrations_guard();

-- ---------------------------------------------------------------------------
-- 2. Versioned contracts
-- ---------------------------------------------------------------------------

create table if not exists public.orchestration_contracts (
  id uuid primary key default gen_random_uuid(),
  orchestration_id uuid not null references public.orchestrations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  version integer not null check (version between 1 and 200),
  content jsonb not null,
  fingerprint text not null check (char_length(fingerprint) = 64),
  max_credits integer not null check (max_credits between 1 and 200),
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'superseded', 'rejected')),
  approval_note text not null default '' check (char_length(approval_note) <= 1000),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (orchestration_id, version),
  check (status <> 'approved' or (approved_by is not null and approved_at is not null))
);

comment on table public.orchestration_contracts is
  'One immutable contract version. Approval binds to this version and fingerprint; a material change needs a new version and approval.';

create index if not exists orchestration_contracts_orchestration_idx
  on public.orchestration_contracts (orchestration_id, version desc);

alter table public.orchestrations
  drop constraint if exists orchestrations_current_contract_fk;
alter table public.orchestrations
  add constraint orchestrations_current_contract_fk
  foreign key (current_contract_id) references public.orchestration_contracts (id)
  on delete set null;
alter table public.orchestrations
  drop constraint if exists orchestrations_approved_contract_fk;
alter table public.orchestrations
  add constraint orchestrations_approved_contract_fk
  foreign key (approved_contract_id) references public.orchestration_contracts (id)
  on delete set null;

-- Version content, fingerprint and maximum are immutable. Only the approval
-- fields and the status may be moved, and only by the security-definer RPCs.
create or replace function public.orchestration_contracts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.orchestration_id is distinct from old.orchestration_id
       or new.version is distinct from old.version
       or new.content is distinct from old.content
       or new.fingerprint is distinct from old.fingerprint
       or new.max_credits is distinct from old.max_credits
       or new.created_by is distinct from old.created_by then
      raise exception 'an approved contract version cannot be rewritten; create a new version';
    end if;
    if old.status = 'approved' and new.status = 'draft' then
      raise exception 'an approved contract cannot be returned to draft';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists orchestration_contracts_guard_trigger on public.orchestration_contracts;
create trigger orchestration_contracts_guard_trigger
  before insert or update on public.orchestration_contracts
  for each row execute function public.orchestration_contracts_guard();

-- ---------------------------------------------------------------------------
-- 3. Bounded task graph
-- ---------------------------------------------------------------------------

create table if not exists public.orchestration_tasks (
  id uuid primary key default gen_random_uuid(),
  orchestration_id uuid not null references public.orchestrations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_key text not null check (task_key ~ '^[a-z][a-z0-9_-]{1,39}$'),
  position integer not null default 0,
  title text not null check (char_length(btrim(title)) between 3 and 200),
  purpose text not null check (char_length(btrim(purpose)) between 10 and 1000),
  capability text not null check (capability in (
    'scenario_planning', 'opportunity_radar', 'learning_goal', 'app_builder',
    'mission_workspace', 'experiment_workspace', 'outcome_review', 'research',
    'verification'
  )),
  depends_on text[] not null default '{}',
  covers text[] not null default '{}',
  input_refs text not null default '' check (char_length(input_refs) <= 2000),
  expected_output text not null check (char_length(btrim(expected_output)) between 5 and 2000),
  verification_method text not null check (verification_method in (
    'automated_test', 'direct_observation', 'human_review', 'document_review'
  )),
  credits_micros bigint not null check (credits_micros > 0),
  permissions text[] not null default '{}',
  retry_limit integer not null default 1 check (retry_limit between 0 and 3),
  attempts integer not null default 0 check (attempts >= 0),
  status text not null default 'pending' check (status in (
    'pending', 'ready', 'running', 'awaiting_approval', 'produced',
    'verified', 'failed', 'cancelled', 'skipped'
  )),
  external_action_kind text check (external_action_kind is null or external_action_kind in (
    'outreach', 'publication', 'paid_activity', 'deployment'
  )),
  idempotency_key text,
  last_error text not null default '' check (char_length(last_error) <= 1000),
  settlement_micros bigint not null default 0 check (settlement_micros >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (orchestration_id, task_key),
  check (attempts <= retry_limit + 1),
  check (status <> 'verified' or verification_method is not null)
);

comment on table public.orchestration_tasks is
  'One bounded task in the approved plan. Dependencies are satisfied only by a verified dependency.';

create index if not exists orchestration_tasks_orchestration_idx
  on public.orchestration_tasks (orchestration_id, position);

drop trigger if exists orchestration_tasks_set_updated_at on public.orchestration_tasks;
create trigger orchestration_tasks_set_updated_at before update on public.orchestration_tasks
  for each row execute function public.set_updated_at();

-- Plan fields are immutable once inserted. Dependencies, keys and the reserved
-- amount cannot be widened after approval.
create or replace function public.orchestration_tasks_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.orchestration_id is distinct from old.orchestration_id
       or new.workspace_id is distinct from old.workspace_id
       or new.task_key is distinct from old.task_key
       or new.depends_on is distinct from old.depends_on
       or new.covers is distinct from old.covers
       or new.credits_micros is distinct from old.credits_micros
       or new.permissions is distinct from old.permissions
       or new.retry_limit is distinct from old.retry_limit
       or new.external_action_kind is distinct from old.external_action_kind then
      raise exception 'an approved task cannot be widened; create a new contract version and plan';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists orchestration_tasks_guard_trigger on public.orchestration_tasks;
create trigger orchestration_tasks_guard_trigger
  before update on public.orchestration_tasks
  for each row execute function public.orchestration_tasks_guard();

-- ---------------------------------------------------------------------------
-- 4. Evidence, checkpoints, events and the human outcome review
-- ---------------------------------------------------------------------------

create table if not exists public.orchestration_evidence (
  id uuid primary key default gen_random_uuid(),
  orchestration_id uuid not null references public.orchestrations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid references public.orchestration_tasks (id) on delete cascade,
  criterion_key text check (criterion_key is null or char_length(criterion_key) <= 40),
  kind text not null check (kind in (
    'ai_proposal', 'participant_opinion', 'direct_observation',
    'automated_test', 'human_judgment', 'unverified_claim'
  )),
  source_ref text not null check (char_length(btrim(source_ref)) between 1 and 500),
  artifact_version text not null default '' check (char_length(artifact_version) <= 120),
  method text not null check (char_length(btrim(method)) between 1 and 300),
  result text not null check (result in ('pass', 'fail', 'inconclusive')),
  limitations text not null default '' check (char_length(limitations) <= 2000),
  verifier text not null check (char_length(btrim(verifier)) between 1 and 300),
  observed_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.orchestration_evidence is
  'Append-only evidence for a task or an acceptance criterion. An AI proposal or participant opinion is stored as itself and never as proof.';

create index if not exists orchestration_evidence_orchestration_idx
  on public.orchestration_evidence (orchestration_id, created_at desc);

create table if not exists public.orchestration_checkpoints (
  id uuid primary key default gen_random_uuid(),
  orchestration_id uuid not null references public.orchestrations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in (
    'missing_information', 'consent_missing', 'budget_shortfall',
    'external_action_approval', 'stop_condition', 'contradicted_assumption',
    'outside_scope', 'high_stakes'
  )),
  title text not null check (char_length(btrim(title)) between 3 and 300),
  what_happened text not null check (char_length(btrim(what_happened)) between 5 and 2000),
  evidence text not null default '' check (char_length(evidence) <= 2000),
  decision text not null check (char_length(btrim(decision)) between 5 and 1000),
  implication text not null default '' check (char_length(implication) <= 1000),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by uuid references auth.users (id) on delete set null,
  requested_by_kind text not null default 'human'
    check (requested_by_kind in ('human', 'agent')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  note text not null default '' check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  check (decided_by is null or requested_by is null or decided_by <> requested_by),
  check (status <> 'approved' or (decided_by is not null and decided_at is not null))
);

comment on table public.orchestration_checkpoints is
  'A human decision point. Approval records a decision; it never performs the external action itself.';

create index if not exists orchestration_checkpoints_idx
  on public.orchestration_checkpoints (orchestration_id, status, created_at desc);

create table if not exists public.orchestration_events (
  id uuid primary key default gen_random_uuid(),
  orchestration_id uuid not null references public.orchestrations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  kind text not null check (char_length(btrim(kind)) between 2 and 80),
  detail text not null check (char_length(btrim(detail)) between 1 and 1000),
  created_at timestamptz not null default now()
);

comment on table public.orchestration_events is
  'Append-only trail. No update or delete policy exists.';

create index if not exists orchestration_events_idx
  on public.orchestration_events (orchestration_id, created_at desc);

create table if not exists public.orchestration_reviews (
  id uuid primary key default gen_random_uuid(),
  orchestration_id uuid not null unique references public.orchestrations (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  decision text not null default 'undecided'
    check (decision in ('undecided', 'accept', 'revise', 'new_contract', 'stop')),
  built text not null default '' check (char_length(built) <= 3000),
  verified text not null default '' check (char_length(verified) <= 3000),
  failed text not null default '' check (char_length(failed) <= 3000),
  unknown text not null default '' check (char_length(unknown) <= 3000),
  deviations text not null default '' check (char_length(deviations) <= 3000),
  next_steps text not null default '' check (char_length(next_steps) <= 3000),
  spent_micros bigint not null default 0 check (spent_micros >= 0),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (decision = 'undecided' or (decided_by is not null and decided_at is not null))
);

comment on table public.orchestration_reviews is
  'The human outcome review. Only a person records the decision; an agent cannot complete the orchestration.';

drop trigger if exists orchestration_reviews_set_updated_at on public.orchestration_reviews;
create trigger orchestration_reviews_set_updated_at before update on public.orchestration_reviews
  for each row execute function public.set_updated_at();

create or replace function public.orchestration_reviews_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.orchestration_id is distinct from old.orchestration_id
       or new.workspace_id is distinct from old.workspace_id then
      raise exception 'the reviewed orchestration cannot be changed';
    end if;
    if old.decision <> 'undecided' then
      raise exception 'a recorded outcome decision cannot be rewritten';
    end if;
  end if;
  if new.decision <> 'undecided' then
    if new.decided_by is null or new.decided_by <> (select auth.uid()) then
      raise exception 'the person making the decision must be recorded';
    end if;
    new.decided_at := coalesce(new.decided_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists orchestration_reviews_guard_trigger on public.orchestration_reviews;
create trigger orchestration_reviews_guard_trigger
  before insert or update on public.orchestration_reviews
  for each row execute function public.orchestration_reviews_guard();

-- ---------------------------------------------------------------------------
-- 5. Lifecycle RPC
-- ---------------------------------------------------------------------------

create or replace function public.orchestration_transition(
  p_id uuid,
  p_to text,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.orchestrations;
  v_role text;
  v_contract public.orchestration_contracts;
  v_allowed boolean := false;
  v_tasks_left integer;
  v_criteria_left integer;
  v_review text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_row from public.orchestrations where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;

  v_role := public.workspace_role(v_row.workspace_id);
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  -- The transition table is repeated here so a direct API call cannot skip it.
  v_allowed := case v_row.status
    when 'draft' then p_to in ('awaiting_approval', 'stopped')
    when 'awaiting_approval' then p_to in ('draft', 'ready', 'stopped')
    when 'ready' then p_to in ('running', 'awaiting_approval', 'stopped')
    when 'running' then p_to in (
      'paused', 'awaiting_input', 'awaiting_action_approval', 'verifying',
      'failed', 'cancellation_requested'
    )
    when 'paused' then p_to in ('running', 'cancellation_requested', 'stopped')
    when 'awaiting_input' then p_to in ('running', 'cancellation_requested', 'stopped')
    when 'awaiting_action_approval' then p_to in ('running', 'cancellation_requested', 'stopped')
    when 'cancellation_requested' then p_to in ('stopped', 'failed')
    when 'verifying' then p_to in ('running', 'awaiting_review', 'failed', 'stopped')
    when 'awaiting_review' then p_to in ('completed', 'needs_revision', 'stopped')
    when 'needs_revision' then p_to in ('awaiting_approval', 'stopped')
    when 'failed' then p_to in ('needs_revision', 'stopped')
    else false
  end;

  if not v_allowed then
    return jsonb_build_object('ok', false, 'code', 'invalid-transition');
  end if;

  if p_to = 'ready' then
    if v_role not in ('owner', 'admin') then
      return jsonb_build_object('ok', false, 'code', 'forbidden');
    end if;
    select * into v_contract
      from public.orchestration_contracts
     where id = v_row.approved_contract_id;
    if not found or v_contract.status <> 'approved' then
      return jsonb_build_object('ok', false, 'code', 'contract-not-approved');
    end if;
    if v_row.current_contract_id is distinct from v_contract.id then
      return jsonb_build_object('ok', false, 'code', 'contract-stale');
    end if;
  end if;

  if p_to = 'running' and v_row.stop_condition_reached then
    return jsonb_build_object('ok', false, 'code', 'stop-condition');
  end if;

  if p_to = 'awaiting_review' then
    select count(*) into v_tasks_left
      from public.orchestration_tasks t
     where t.orchestration_id = p_id and t.status not in ('verified', 'skipped');
    if v_tasks_left > 0 then
      return jsonb_build_object('ok', false, 'code', 'tasks-incomplete');
    end if;

    select * into v_contract
      from public.orchestration_contracts
     where id = v_row.current_contract_id;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'contract-not-approved');
    end if;

    select count(*) into v_criteria_left
      from jsonb_array_elements(v_contract.content->'acceptance_criteria') c
     where not exists (
       select 1 from public.orchestration_evidence e
        where e.orchestration_id = p_id
          and e.criterion_key = c->>'key'
          and e.result = 'pass'
          and e.kind not in ('ai_proposal', 'participant_opinion', 'unverified_claim')
     );
    if v_criteria_left > 0 then
      return jsonb_build_object('ok', false, 'code', 'verification-incomplete');
    end if;
  end if;

  if p_to = 'completed' then
    select decision into v_review
      from public.orchestration_reviews
     where orchestration_id = p_id;
    if v_review is distinct from 'accept' then
      return jsonb_build_object('ok', false, 'code', 'review-missing');
    end if;
  end if;

  update public.orchestrations
     set status = p_to
   where id = p_id;

  insert into public.orchestration_events (orchestration_id, workspace_id, actor_id, kind, detail)
  values (p_id, v_row.workspace_id, v_user, 'status_' || p_to, left(coalesce(p_note, ''), 1000));

  return jsonb_build_object('ok', true, 'status', p_to);
end;
$$;

revoke all on function public.orchestration_transition(uuid, text, text) from public, anon;
grant execute on function public.orchestration_transition(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Contract approval (bound to version and fingerprint)
-- ---------------------------------------------------------------------------

create or replace function public.orchestration_approve_contract(
  p_contract_id uuid,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_contract public.orchestration_contracts;
  v_row public.orchestrations;
  v_role text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_contract
    from public.orchestration_contracts
   where id = p_contract_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;

  select * into v_row
    from public.orchestrations
   where id = v_contract.orchestration_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;

  v_role := public.workspace_role(v_row.workspace_id);
  if v_role is null or v_role not in ('owner', 'admin') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_row.status <> 'awaiting_approval' then
    return jsonb_build_object('ok', false, 'code', 'not-awaiting-approval');
  end if;
  if v_contract.status <> 'draft' then
    return jsonb_build_object('ok', false, 'code', 'already-decided');
  end if;
  if v_contract.id is distinct from v_row.current_contract_id then
    return jsonb_build_object('ok', false, 'code', 'contract-stale');
  end if;

  update public.orchestration_contracts
     set status = 'approved',
         approved_by = v_user,
         approved_at = now(),
         approval_note = left(coalesce(p_note, ''), 1000)
   where id = p_contract_id;

  update public.orchestration_contracts
     set status = 'superseded'
   where orchestration_id = v_contract.orchestration_id
     and id <> p_contract_id
     and status = 'approved';

  update public.orchestrations
     set approved_contract_id = p_contract_id,
         authorized_micros = v_contract.max_credits::bigint * 1000000,
         status = 'ready'
   where id = v_row.id
     and status = 'awaiting_approval';

  insert into public.orchestration_events (orchestration_id, workspace_id, actor_id, kind, detail)
  values (
    v_row.id, v_row.workspace_id, v_user, 'contract_approved',
    'Contract version ' || v_contract.version || ' approved. Separate action approvals still apply.'
  );

  return jsonb_build_object('ok', true, 'version', v_contract.version);
end;
$$;

revoke all on function public.orchestration_approve_contract(uuid, text) from public, anon;
grant execute on function public.orchestration_approve_contract(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Atomic task reservation and settlement
-- ---------------------------------------------------------------------------

create or replace function public.orchestration_reserve_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_task public.orchestration_tasks;
  v_row public.orchestrations;
  v_role text;
  v_unmet text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_task from public.orchestration_tasks where id = p_task_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;

  v_role := public.workspace_role(v_task.workspace_id);
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  -- Lock the budget row. A second concurrent task waits here and then sees the
  -- reservation made by the first.
  select * into v_row from public.orchestrations where id = v_task.orchestration_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;

  if v_row.status <> 'running' and v_row.status <> 'ready' then
    return jsonb_build_object('ok', false, 'code', 'not-running');
  end if;
  if v_row.approved_contract_id is null
     or v_row.current_contract_id is distinct from v_row.approved_contract_id then
    return jsonb_build_object('ok', false, 'code', 'contract-stale');
  end if;

  select string_agg(d, ',') into v_unmet
    from unnest(v_task.depends_on) d
   where not exists (
     select 1 from public.orchestration_tasks t
      where t.orchestration_id = v_task.orchestration_id
        and t.task_key = d
        and t.status = 'verified'
   );
  if v_unmet is not null then
    return jsonb_build_object('ok', false, 'code', 'dependency-unmet', 'unmet', v_unmet);
  end if;

  if v_task.status <> 'pending' and v_task.status <> 'ready' then
    return jsonb_build_object('ok', false, 'code', 'not-pending');
  end if;
  if v_task.attempts >= v_task.retry_limit + 1 then
    return jsonb_build_object('ok', false, 'code', 'retry-limit');
  end if;
  if v_task.external_action_kind is not null and not exists (
    select 1 from public.orchestration_checkpoints c
     where c.orchestration_id = v_task.orchestration_id
       and c.kind = 'external_action_approval'
       and c.status = 'approved'
       and c.what_happened like '%' || v_task.task_key || '%'
  ) then
    return jsonb_build_object('ok', false, 'code', 'action-approval-required');
  end if;

  if v_row.consumed_micros + v_row.reserved_micros + v_task.credits_micros
     > v_row.authorized_micros then
    return jsonb_build_object('ok', false, 'code', 'budget-exhausted');
  end if;

  update public.orchestrations
     set reserved_micros = reserved_micros + v_task.credits_micros
   where id = v_row.id;

  update public.orchestration_tasks
     set status = 'running',
         attempts = attempts + 1,
         idempotency_key = md5(v_task.orchestration_id::text || ':' || v_task.task_key || ':' || (v_task.attempts + 1)::text),
         last_error = ''
   where id = p_task_id;

  insert into public.orchestration_events (orchestration_id, workspace_id, actor_id, kind, detail)
  values (
    v_task.orchestration_id, v_task.workspace_id, v_user, 'task_reserved',
    v_task.task_key || ' reserved ' || v_task.credits_micros || ' micro-credits'
  );

  return jsonb_build_object(
    'ok', true,
    'idempotency_key', md5(v_task.orchestration_id::text || ':' || v_task.task_key || ':' || (v_task.attempts + 1)::text),
    'credits_micros', v_task.credits_micros
  );
end;
$$;

revoke all on function public.orchestration_reserve_task(uuid) from public, anon;
grant execute on function public.orchestration_reserve_task(uuid) to authenticated;

create or replace function public.orchestration_settle_task(
  p_task_id uuid,
  p_ok boolean,
  p_actual_micros bigint default 0,
  p_error text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_task public.orchestration_tasks;
  v_consumed bigint;
  v_released bigint;
  v_role text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_task from public.orchestration_tasks where id = p_task_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;

  v_role := public.workspace_role(v_task.workspace_id);
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_task.status <> 'running' then
    return jsonb_build_object('ok', false, 'code', 'not-running');
  end if;

  if p_ok then
    v_consumed := least(v_task.credits_micros, greatest(coalesce(p_actual_micros, 0), 0));
    v_released := v_task.credits_micros - v_consumed;
  else
    v_consumed := 0;
    v_released := v_task.credits_micros;
  end if;

  update public.orchestrations
     set reserved_micros = greatest(reserved_micros - v_task.credits_micros, 0),
         consumed_micros = consumed_micros + v_consumed
   where id = v_task.orchestration_id;

  update public.orchestration_tasks
     set status = case when p_ok then 'produced' else 'failed' end,
         settlement_micros = v_consumed,
         last_error = case when p_ok then '' else left(coalesce(p_error, ''), 1000) end
   where id = p_task_id;

  insert into public.orchestration_events (orchestration_id, workspace_id, actor_id, kind, detail)
  values (
    v_task.orchestration_id, v_task.workspace_id, v_user,
    case when p_ok then 'task_produced' else 'task_failed' end,
    v_task.task_key || ': consumed ' || v_consumed || ', released ' || v_released || ' micro-credits'
  );

  return jsonb_build_object(
    'ok', true,
    'status', case when p_ok then 'produced' else 'failed' end,
    'consumed_micros', v_consumed,
    'released_micros', v_released
  );
end;
$$;

revoke all on function public.orchestration_settle_task(uuid, boolean, bigint, text) from public, anon;
grant execute on function public.orchestration_settle_task(uuid, boolean, bigint, text) to authenticated;

-- A task is verified only by matching, passing evidence. An AI proposal, an
-- opinion or an unverified claim cannot verify anything.
create or replace function public.orchestration_verify_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_task public.orchestration_tasks;
  v_ok boolean;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_task from public.orchestration_tasks where id = p_task_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;
  if public.workspace_role(v_task.workspace_id) is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_task.status <> 'produced' then
    return jsonb_build_object('ok', false, 'code', 'not-produced');
  end if;

  select exists (
    select 1 from public.orchestration_evidence e
     where e.orchestration_id = v_task.orchestration_id
       and e.task_id = v_task.id
       and e.result = 'pass'
       and e.kind not in ('ai_proposal', 'participant_opinion', 'unverified_claim')
  ) into v_ok;

  if not v_ok then
    return jsonb_build_object('ok', false, 'code', 'no-verifying-evidence');
  end if;

  update public.orchestration_tasks set status = 'verified' where id = p_task_id;

  insert into public.orchestration_events (orchestration_id, workspace_id, actor_id, kind, detail)
  values (v_task.orchestration_id, v_task.workspace_id, v_user, 'task_verified', v_task.task_key);

  return jsonb_build_object('ok', true, 'status', 'verified');
end;
$$;

revoke all on function public.orchestration_verify_task(uuid) from public, anon;
grant execute on function public.orchestration_verify_task(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Checkpoint decision and cancellation
-- ---------------------------------------------------------------------------

create or replace function public.orchestration_decide_checkpoint(
  p_checkpoint_id uuid,
  p_decision text,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.orchestration_checkpoints;
  v_role text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;
  if p_decision not in ('approved', 'rejected') then
    return jsonb_build_object('ok', false, 'code', 'invalid-decision');
  end if;

  select * into v_row from public.orchestration_checkpoints where id = p_checkpoint_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;

  v_role := public.workspace_role(v_row.workspace_id);
  if v_role is null or v_role not in ('owner', 'admin') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_row.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'not-pending');
  end if;
  if v_row.requested_by = v_user then
    return jsonb_build_object('ok', false, 'code', 'self-approval');
  end if;

  update public.orchestration_checkpoints
     set status = p_decision,
         decided_by = v_user,
         decided_at = now(),
         note = left(coalesce(p_note, ''), 1000)
   where id = p_checkpoint_id;

  insert into public.orchestration_events (orchestration_id, workspace_id, actor_id, kind, detail)
  values (
    v_row.orchestration_id, v_row.workspace_id, v_user,
    'checkpoint_' || p_decision, v_row.kind || ': ' || v_row.title
  );

  return jsonb_build_object('ok', true, 'status', p_decision);
end;
$$;

revoke all on function public.orchestration_decide_checkpoint(uuid, text, text) from public, anon;
grant execute on function public.orchestration_decide_checkpoint(uuid, text, text) to authenticated;

create or replace function public.orchestration_cancel(p_id uuid, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.orchestrations;
  v_role text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_row from public.orchestrations where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;

  v_role := public.workspace_role(v_row.workspace_id);
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_row.status not in ('running', 'paused', 'awaiting_input', 'awaiting_action_approval') then
    return jsonb_build_object('ok', false, 'code', 'not-running');
  end if;

  update public.orchestrations set status = 'cancellation_requested' where id = p_id;

  insert into public.orchestration_events (orchestration_id, workspace_id, actor_id, kind, detail)
  values (
    p_id, v_row.workspace_id, v_user, 'cancellation_requested',
    coalesce(nullif(left(btrim(p_note), 1000), ''), 'No further work will be scheduled. Performed external effects are not reversed.')
  );

  return jsonb_build_object('ok', true, 'status', 'cancellation_requested');
end;
$$;

revoke all on function public.orchestration_cancel(uuid, text) from public, anon;
grant execute on function public.orchestration_cancel(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Outcome review recorded by a person
-- ---------------------------------------------------------------------------

create or replace function public.orchestration_record_review(
  p_id uuid,
  p_decision text,
  p_built text default '',
  p_verified text default '',
  p_failed text default '',
  p_unknown text default '',
  p_deviations text default '',
  p_next_steps text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.orchestrations;
  v_role text;
  v_contract public.orchestration_contracts;
  v_unverified integer;
  v_failed integer;
  v_existing text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;
  if p_decision not in ('accept', 'revise', 'new_contract', 'stop') then
    return jsonb_build_object('ok', false, 'code', 'invalid-decision');
  end if;

  select * into v_row from public.orchestrations where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;

  v_role := public.workspace_role(v_row.workspace_id);
  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  select decision into v_existing
    from public.orchestration_reviews where orchestration_id = p_id;
  if v_existing is not null and v_existing <> 'undecided' then
    return jsonb_build_object('ok', false, 'code', 'already-decided');
  end if;

  select * into v_contract from public.orchestration_contracts
   where id = v_row.current_contract_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'contract-not-approved');
  end if;

  select count(*) into v_unverified
    from jsonb_array_elements(v_contract.content->'acceptance_criteria') c
   where not exists (
     select 1 from public.orchestration_evidence e
      where e.orchestration_id = p_id
        and e.criterion_key = c->>'key'
        and e.result = 'pass'
        and e.kind not in ('ai_proposal', 'participant_opinion', 'unverified_claim')
   );

  select count(*) into v_failed
    from public.orchestration_evidence e
   where e.orchestration_id = p_id and e.result = 'fail';

  if p_decision = 'accept' then
    if v_unverified > 0 then
      return jsonb_build_object('ok', false, 'code', 'unverified');
    end if;
    if v_failed > 0 then
      return jsonb_build_object('ok', false, 'code', 'failure-unresolved');
    end if;
    if char_length(btrim(coalesce(p_verified, ''))) < 5 then
      return jsonb_build_object('ok', false, 'code', 'missing-verified');
    end if;
  end if;

  if char_length(btrim(coalesce(p_unknown, ''))) < 5 then
    return jsonb_build_object('ok', false, 'code', 'missing-unknowns');
  end if;

  insert into public.orchestration_reviews (
    orchestration_id, workspace_id, decision, built, verified, failed, unknown,
    deviations, next_steps, spent_micros, decided_by, decided_at
  ) values (
    p_id, v_row.workspace_id, p_decision,
    left(coalesce(p_built, ''), 3000),
    left(coalesce(p_verified, ''), 3000),
    left(coalesce(p_failed, ''), 3000),
    left(coalesce(p_unknown, ''), 3000),
    left(coalesce(p_deviations, ''), 3000),
    left(coalesce(p_next_steps, ''), 3000),
    v_row.consumed_micros, v_user, now()
  )
  on conflict (orchestration_id) do update
    set decision = excluded.decision,
        built = excluded.built,
        verified = excluded.verified,
        failed = excluded.failed,
        unknown = excluded.unknown,
        deviations = excluded.deviations,
        next_steps = excluded.next_steps,
        spent_micros = excluded.spent_micros,
        decided_by = excluded.decided_by,
        decided_at = excluded.decided_at
    where public.orchestration_reviews.decision = 'undecided';

  update public.orchestrations
     set status = case p_decision
       when 'accept' then 'completed'
       when 'stop' then 'stopped'
       else 'needs_revision'
     end
   where id = p_id;

  insert into public.orchestration_events (orchestration_id, workspace_id, actor_id, kind, detail)
  values (p_id, v_row.workspace_id, v_user, 'review_' || p_decision, 'A person recorded the outcome decision.');

  return jsonb_build_object('ok', true, 'status', p_decision);
end;
$$;

revoke all on function public.orchestration_record_review(uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.orchestration_record_review(uuid, text, text, text, text, text, text, text) to authenticated;

create or replace function public.orchestration_append_event(
  p_id uuid,
  p_kind text,
  p_detail text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.orchestrations;
begin
  if v_user is null then
    return;
  end if;
  select * into v_row from public.orchestrations where id = p_id;
  if not found or public.workspace_role(v_row.workspace_id) is null then
    return;
  end if;
  insert into public.orchestration_events (orchestration_id, workspace_id, actor_id, kind, detail)
  values (p_id, v_row.workspace_id, v_user, left(p_kind, 80), left(p_detail, 1000));
end;
$$;

revoke all on function public.orchestration_append_event(uuid, text, text) from public, anon;
grant execute on function public.orchestration_append_event(uuid, text, text) to authenticated;

-- Links a normal app-builder project that already belongs to the caller in this
-- workspace. It grants no access to the project and deploys nothing.
create or replace function public.orchestration_link_prototype(
  p_id uuid,
  p_project_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.orchestrations;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_row from public.orchestrations where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;
  if public.workspace_role(v_row.workspace_id) is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_row.prototype_project_id is not null then
    return jsonb_build_object('ok', false, 'code', 'already-linked');
  end if;
  if not exists (
    select 1 from public.app_projects p
     where p.id = p_project_id
       and p.user_id = v_user
       and (p.workspace_id is null or p.workspace_id = v_row.workspace_id)
  ) then
    return jsonb_build_object('ok', false, 'code', 'project-not-owned');
  end if;

  update public.orchestrations
     set prototype_project_id = p_project_id
   where id = p_id;

  insert into public.orchestration_events (orchestration_id, workspace_id, actor_id, kind, detail)
  values (
    p_id, v_row.workspace_id, v_user, 'prototype_linked',
    'A normal app-builder project was linked. Its sandbox, test and deployment approvals are unchanged.'
  );

  return jsonb_build_object('ok', true, 'project_id', p_project_id);
end;
$$;

revoke all on function public.orchestration_link_prototype(uuid, uuid) from public, anon;
grant execute on function public.orchestration_link_prototype(uuid, uuid) to authenticated;

-- Points a draft orchestration at the contract version just written. Client
-- roles have no update grant on the table, so this is the only path.
create or replace function public.orchestration_attach_contract(
  p_id uuid,
  p_contract_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.orchestrations;
  v_contract public.orchestration_contracts;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_row from public.orchestrations where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;
  if public.workspace_role(v_row.workspace_id) is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;

  select * into v_contract
    from public.orchestration_contracts
   where id = p_contract_id and orchestration_id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;
  if v_row.status not in ('draft', 'awaiting_approval', 'needs_revision') then
    return jsonb_build_object('ok', false, 'code', 'not-editable');
  end if;

  update public.orchestrations
     set current_contract_id = p_contract_id,
         status = case when status = 'needs_revision' then 'draft' else status end
   where id = p_id;

  return jsonb_build_object('ok', true, 'version', v_contract.version);
end;
$$;

revoke all on function public.orchestration_attach_contract(uuid, uuid) from public, anon;
grant execute on function public.orchestration_attach_contract(uuid, uuid) to authenticated;

-- Removes a draft that never got an approved contract or any evidence. It is a
-- cleanup for a failed create, not a way to erase a run.
create or replace function public.orchestration_discard_draft(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.orchestrations;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_row from public.orchestrations where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;
  if v_row.created_by <> v_user then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_row.status <> 'draft'
     or v_row.approved_contract_id is not null
     or v_row.consumed_micros > 0 then
    return jsonb_build_object('ok', false, 'code', 'not-draft');
  end if;

  delete from public.orchestrations where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.orchestration_discard_draft(uuid) from public, anon;
grant execute on function public.orchestration_discard_draft(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Row-level security and grants
-- ---------------------------------------------------------------------------

alter table public.orchestrations enable row level security;
alter table public.orchestration_contracts enable row level security;
alter table public.orchestration_tasks enable row level security;
alter table public.orchestration_evidence enable row level security;
alter table public.orchestration_checkpoints enable row level security;
alter table public.orchestration_events enable row level security;
alter table public.orchestration_reviews enable row level security;

drop policy if exists "members read orchestrations" on public.orchestrations;
create policy "members read orchestrations" on public.orchestrations
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members create their own orchestrations" on public.orchestrations;
create policy "members create their own orchestrations" on public.orchestrations
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) is not null
    and created_by = (select auth.uid())
    and status = 'draft'
    and authorized_micros = 0
    and reserved_micros = 0
    and consumed_micros = 0
  );

drop policy if exists "members read contracts" on public.orchestration_contracts;
create policy "members read contracts" on public.orchestration_contracts
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members draft contracts" on public.orchestration_contracts;
create policy "members draft contracts" on public.orchestration_contracts
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) is not null
    and created_by = (select auth.uid())
    and status = 'draft'
    and approved_by is null
    and exists (
      select 1 from public.orchestrations o
       where o.id = orchestration_id and o.workspace_id = workspace_id
    )
  );

drop policy if exists "members read tasks" on public.orchestration_tasks;
create policy "members read tasks" on public.orchestration_tasks
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members plan tasks" on public.orchestration_tasks;
create policy "members plan tasks" on public.orchestration_tasks
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) is not null
    and attempts = 0
    and status = 'pending'
    and exists (
      select 1 from public.orchestrations o
       where o.id = orchestration_id
         and o.workspace_id = workspace_id
         and o.status in ('draft', 'awaiting_approval')
    )
  );

drop policy if exists "members read evidence" on public.orchestration_evidence;
create policy "members read evidence" on public.orchestration_evidence
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members append evidence" on public.orchestration_evidence;
create policy "members append evidence" on public.orchestration_evidence
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) is not null
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.orchestrations o
       where o.id = orchestration_id and o.workspace_id = workspace_id
    )
  );

drop policy if exists "members read checkpoints" on public.orchestration_checkpoints;
create policy "members read checkpoints" on public.orchestration_checkpoints
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members request checkpoints" on public.orchestration_checkpoints;
create policy "members request checkpoints" on public.orchestration_checkpoints
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) is not null
    and requested_by = (select auth.uid())
    and exists (
      select 1 from public.orchestrations o
       where o.id = orchestration_id and o.workspace_id = workspace_id
    )
  );

drop policy if exists "members read orchestration events" on public.orchestration_events;
create policy "members read orchestration events" on public.orchestration_events
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members append orchestration events" on public.orchestration_events;
create policy "members append orchestration events" on public.orchestration_events
  for insert to authenticated
  with check (public.workspace_role(workspace_id) is not null);

drop policy if exists "members read orchestration reviews" on public.orchestration_reviews;
create policy "members read orchestration reviews" on public.orchestration_reviews
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

-- Client grants deliberately exclude update and delete on the lifecycle tables.
-- The security-definer functions above are the only way to move a status,
-- charge a reservation, mark a task verified or record the outcome decision.
grant select, insert on public.orchestrations to authenticated;
grant select, insert on public.orchestration_contracts to authenticated;
grant select, insert on public.orchestration_tasks to authenticated;
grant select, insert on public.orchestration_evidence to authenticated;
grant select, insert on public.orchestration_checkpoints to authenticated;
grant select, insert on public.orchestration_events to authenticated;
grant select on public.orchestration_reviews to authenticated;

-- Supabase's default privileges for new tables in this schema grant ALL to
-- `authenticated`, so the grants above are not a ceiling on their own. Remove
-- what the app never uses: the security-definer functions are the only writers
-- of status, reservations, verification and the outcome decision. 0046 removed
-- the same privileges from app_projects for the same reason.
revoke update, delete, truncate, trigger, references, maintain
  on public.orchestrations from authenticated;
revoke update, delete, truncate, trigger, references, maintain
  on public.orchestration_contracts from authenticated;
revoke update, delete, truncate, trigger, references, maintain
  on public.orchestration_tasks from authenticated;
revoke update, delete, truncate, trigger, references, maintain
  on public.orchestration_evidence from authenticated;
revoke update, delete, truncate, trigger, references, maintain
  on public.orchestration_checkpoints from authenticated;
revoke update, delete, truncate, trigger, references, maintain
  on public.orchestration_events from authenticated;
revoke insert, update, delete, truncate, trigger, references, maintain
  on public.orchestration_reviews from authenticated;

revoke all on public.orchestrations from anon;
revoke all on public.orchestration_contracts from anon;
revoke all on public.orchestration_tasks from anon;
revoke all on public.orchestration_evidence from anon;
revoke all on public.orchestration_checkpoints from anon;
revoke all on public.orchestration_events from anon;
revoke all on public.orchestration_reviews from anon;
