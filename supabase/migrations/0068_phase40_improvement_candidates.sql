-- GET TO IT — Phase 40: improvement proposals.
--
-- A candidate is a written proposal to change how the product is built or run:
-- a prompt revision, a routing rule, a tool policy, a procedure, a workflow, an
-- application patch or a new evaluation case. The record carries the problem,
-- its evidence, the change, the expected benefit, the risks, the affected
-- components, the evaluation plan, the cost, the security implications and the
-- rollback.
--
-- The state machine lives here, and so do the boundaries: success criteria are
-- frozen the moment evaluation starts, an evaluation is append-only and its
-- verdict is recomputed in SQL, approval requires a clean measured result, and
-- promotion needs a second, named human decision. Deployment is not in this
-- table at all — that stays in the existing deployment approvals.

create table if not exists public.improvement_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.app_projects (id) on delete set null,
  kind text not null check (kind in (
    'prompt_revision', 'model_routing', 'tool_policy', 'procedure',
    'workflow_change', 'code_patch', 'evaluation_case'
  )),
  title text not null check (char_length(btrim(title)) between 5 and 160),
  problem text not null check (char_length(btrim(problem)) between 20 and 2000),
  evidence text not null check (char_length(btrim(evidence)) between 20 and 4000),
  proposed_change text not null check (char_length(btrim(proposed_change)) between 20 and 3000),
  expected_benefit text not null check (char_length(btrim(expected_benefit)) between 10 and 1000),
  possible_regressions text not null check (char_length(btrim(possible_regressions)) between 10 and 2000),
  affected_components text[] not null check (cardinality(affected_components) between 1 and 8),
  evaluation_plan text not null check (char_length(btrim(evaluation_plan)) between 20 and 3000),
  cost_impact text not null check (char_length(btrim(cost_impact)) between 5 and 1000),
  security_implications text not null check (char_length(btrim(security_implications)) between 5 and 2000),
  rollback_plan text not null check (char_length(btrim(rollback_plan)) between 20 and 2000),

  -- The engine may not ask for any protected authority; the column is kept so an
  -- attempt can be named rather than merely rejected.
  requested_authorities text[] not null default '{}'
    check (cardinality(requested_authorities) = 0),

  sandbox_kind text not null default 'sandbox' check (sandbox_kind in ('branch', 'sandbox')),
  base_ref text not null check (char_length(btrim(base_ref)) between 1 and 200),
  candidate_ref text not null check (char_length(btrim(candidate_ref)) between 1 and 200),
  candidate_config jsonb not null default '{}'::jsonb,

  status text not null default 'draft' check (status in (
    'draft', 'evaluating', 'evaluated', 'approved', 'rejected', 'promoted', 'cancelled', 'blocked'
  )),

  suite_name text check (suite_name is null or char_length(suite_name) between 1 and 80),
  suite_version text check (suite_version is null or char_length(suite_version) between 1 and 40),
  suite_hash text check (suite_hash is null or suite_hash ~ '^[0-9a-f]{64}$'),
  criteria_hash text check (criteria_hash is null or criteria_hash ~ '^[0-9a-f]{64}$'),
  criteria_frozen_at timestamptz,

  verdict text check (verdict is null or verdict in ('better', 'equal', 'worse', 'inconclusive')),
  integrity text check (integrity is null or integrity in ('verified', 'mismatch')),
  security_findings integer not null default 0 check (security_findings >= 0),
  regressions integer not null default 0 check (regressions >= 0),
  cost_delta_ratio numeric(7, 4) not null default 0,

  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  promotion_approved_at timestamptz,
  promotion_approved_by uuid references auth.users (id) on delete set null,
  promotion_ref text check (promotion_ref is null or char_length(promotion_ref) between 1 and 200),
  promoted_at timestamptz,

  blocked_code text check (blocked_code is null or char_length(blocked_code) <= 60),
  blocked_reason text check (blocked_reason is null or char_length(blocked_reason) <= 500),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (btrim(base_ref) <> btrim(candidate_ref)),
  check (status <> 'evaluating' or criteria_frozen_at is not null),
  check (status not in ('evaluated', 'approved', 'promoted') or (verdict is not null and criteria_frozen_at is not null)),
  check (
    status not in ('approved', 'promoted')
    or (
      verdict in ('better', 'equal')
      and integrity = 'verified'
      and security_findings = 0
      and regressions = 0
      and cost_delta_ratio <= 0.25
      and reviewed_at is not null
      and reviewed_by is not null
      and reviewed_by <> user_id
      and char_length(btrim(coalesce(review_note, ''))) >= 20
    )
  ),
  check (
    status <> 'promoted'
    or (promotion_approved_at is not null and promotion_approved_by is not null and promotion_ref is not null and promoted_at is not null)
  )
);

comment on table public.improvement_candidates is
  'Phase 40 improvement proposals: the full written case, an immutable evaluation, and separate review and promotion decisions.';

create index if not exists improvement_candidates_workspace_idx
  on public.improvement_candidates (workspace_id, created_at desc);

drop trigger if exists improvement_candidates_set_updated_at on public.improvement_candidates;
create trigger improvement_candidates_set_updated_at before update on public.improvement_candidates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Boundaries and frozen criteria
-- ---------------------------------------------------------------------------

create or replace function public.improvement_candidates_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_protected text[] := array[
    'grant_permissions', 'remove_approval_gate', 'increase_spend_limit',
    'change_billing_price', 'disable_audit_log', 'alter_held_out_answers',
    'rewrite_success_criteria', 'deploy_own_change', 'write_production_data'
  ];
  v_asked text[];
begin
  if cardinality(new.requested_authorities) > 0 then
    v_asked := array(select unnest(new.requested_authorities) intersect select unnest(v_protected));
    if cardinality(v_asked) > 0 then
      raise exception 'refused: the improvement engine cannot %', array_to_string(v_asked, ', ')
        using errcode = '42501';
    end if;
    raise exception 'refused: a candidate cannot request additional authority'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'a candidate starts as a draft' using errcode = '42501';
    end if;
    if new.verdict is not null or new.reviewed_at is not null then
      raise exception 'a draft cannot carry a verdict or a review' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.criteria_frozen_at is not null and (
       new.evaluation_plan is distinct from old.evaluation_plan
       or new.expected_benefit is distinct from old.expected_benefit
       or new.suite_name is distinct from old.suite_name
       or new.suite_version is distinct from old.suite_version
       or new.suite_hash is distinct from old.suite_hash
       or new.criteria_hash is distinct from old.criteria_hash
       or new.base_ref is distinct from old.base_ref
       or new.candidate_ref is distinct from old.candidate_ref
     ) then
    raise exception 'the success criteria are frozen once evaluation starts; start a new candidate'
      using errcode = '42501';
  end if;

  if old.verdict is not null and new.verdict is distinct from old.verdict then
    raise exception 'a recorded verdict cannot be rewritten' using errcode = '42501';
  end if;

  if old.status in ('rejected', 'promoted', 'cancelled') and new.status <> old.status then
    raise exception 'a % candidate is final', old.status using errcode = '42501';
  end if;

  if new.requested_authorities is distinct from old.requested_authorities then
    raise exception 'the boundaries do not change for an existing candidate' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists improvement_candidates_guard_trigger on public.improvement_candidates;
create trigger improvement_candidates_guard_trigger
  before insert or update on public.improvement_candidates
  for each row execute function public.improvement_candidates_guard();

-- ---------------------------------------------------------------------------
-- Evaluations: append-only, verdict re-derived in SQL
-- ---------------------------------------------------------------------------

create table if not exists public.improvement_candidate_evaluations (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.improvement_candidates (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  suite_name text not null check (char_length(suite_name) between 1 and 80),
  suite_version text not null check (char_length(suite_version) between 1 and 40),
  suite_hash text not null check (suite_hash ~ '^[0-9a-f]{64}$'),
  total_cases integer not null check (total_cases between 1 and 200),
  baseline_passed integer not null check (baseline_passed between 0 and 200),
  candidate_passed integer not null check (candidate_passed between 0 and 200),
  security_findings integer not null default 0 check (security_findings >= 0),
  regressions integer not null default 0 check (regressions >= 0),
  baseline_cost_units integer not null check (baseline_cost_units >= 0),
  candidate_cost_units integer not null check (candidate_cost_units >= 0),
  cost_delta_ratio numeric(7, 4) not null,
  verdict text not null check (verdict in ('better', 'equal', 'worse', 'inconclusive')),
  integrity text not null default 'verified' check (integrity = 'verified'),
  case_results jsonb not null default '[]'::jsonb,
  comparison jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (baseline_passed <= total_cases),
  check (candidate_passed <= total_cases)
);

comment on table public.improvement_candidate_evaluations is
  'One measured run of a candidate against the baseline. Append-only; the verdict is re-derived in SQL so a client cannot claim success.';

create index if not exists improvement_candidate_evaluations_candidate_idx
  on public.improvement_candidate_evaluations (candidate_id, created_at);

create or replace function public.improvement_candidate_evaluations_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate public.improvement_candidates;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'an evaluation is a record of what happened; run a new one'
      using errcode = '42501';
  end if;

  select * into v_candidate from public.improvement_candidates where id = new.candidate_id;
  if not found then
    raise exception 'unknown candidate' using errcode = '23503';
  end if;
  if v_candidate.suite_hash is distinct from new.suite_hash then
    raise exception 'the suite does not match the one frozen for this candidate'
      using errcode = '42501';
  end if;
  if v_candidate.status <> 'evaluating' then
    raise exception 'the candidate is not accepting an evaluation' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists improvement_candidate_evaluations_guard_trigger on public.improvement_candidate_evaluations;
create trigger improvement_candidate_evaluations_guard_trigger
  before insert or update or delete on public.improvement_candidate_evaluations
  for each row execute function public.improvement_candidate_evaluations_guard();

create or replace function public.improvement_candidate_evaluations_settle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected text;
  v_ratio numeric(7, 4);
begin
  v_ratio := round(
    (new.candidate_cost_units - greatest(1, new.baseline_cost_units))::numeric
      / greatest(1, new.baseline_cost_units),
    4
  );

  if new.candidate_passed < new.baseline_passed
     or new.security_findings > 0
     or new.regressions > 0
     or v_ratio > 0.25 then
    v_expected := 'worse';
  elsif new.candidate_passed > new.baseline_passed then
    v_expected := 'better';
  else
    v_expected := 'equal';
  end if;

  if new.verdict <> v_expected then
    raise exception 'the recorded verdict (%) does not match the numbers (%)', new.verdict, v_expected
      using errcode = '42501';
  end if;
  if new.cost_delta_ratio is distinct from v_ratio then
    raise exception 'a recorded cost delta must match the measured cost' using errcode = '42501';
  end if;

  update public.improvement_candidates
     set status = 'evaluated',
         verdict = new.verdict,
         integrity = new.integrity,
         security_findings = new.security_findings,
         regressions = new.regressions,
         cost_delta_ratio = v_ratio
   where id = new.candidate_id;

  return new;
end;
$$;

drop trigger if exists improvement_candidate_evaluations_settle_trigger on public.improvement_candidate_evaluations;
create trigger improvement_candidate_evaluations_settle_trigger
  after insert on public.improvement_candidate_evaluations
  for each row execute function public.improvement_candidate_evaluations_settle();

-- ---------------------------------------------------------------------------
-- Append-only audit and visible refusals
-- ---------------------------------------------------------------------------

create table if not exists public.improvement_candidate_events (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.improvement_candidates (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in (
    'drafted', 'evaluation_started', 'evaluated', 'approved', 'rejected',
    'promoted', 'cancelled', 'blocked'
  )),
  detail text not null default '' check (char_length(detail) <= 500),
  created_at timestamptz not null default now()
);

comment on table public.improvement_candidate_events is
  'What happened to an improvement candidate, appended and never edited.';

create index if not exists improvement_candidate_events_candidate_idx
  on public.improvement_candidate_events (candidate_id, created_at);

create or replace function public.improvement_candidates_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
begin
  if tg_op = 'INSERT' then
    v_kind := 'drafted';
  elsif new.status is distinct from old.status then
    v_kind := case new.status
      when 'evaluating' then 'evaluation_started'
      when 'evaluated' then 'evaluated'
      when 'approved' then 'approved'
      when 'rejected' then 'rejected'
      when 'promoted' then 'promoted'
      when 'cancelled' then 'cancelled'
      when 'blocked' then 'blocked'
      else null
    end;
  end if;

  if v_kind is not null then
    insert into public.improvement_candidate_events (candidate_id, workspace_id, actor_id, kind, detail)
    values (
      new.id,
      new.workspace_id,
      auth.uid(),
      v_kind,
      left(coalesce(new.review_note, new.blocked_reason, ''), 500)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists improvement_candidates_audit_trigger on public.improvement_candidates;
create trigger improvement_candidates_audit_trigger
  after insert or update on public.improvement_candidates
  for each row execute function public.improvement_candidates_audit();

create table if not exists public.improvement_boundary_blocks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  candidate_id uuid references public.improvement_candidates (id) on delete set null,
  attempted_action text not null check (char_length(attempted_action) between 2 and 120),
  reason text not null check (char_length(reason) between 2 and 500),
  created_at timestamptz not null default now()
);

comment on table public.improvement_boundary_blocks is
  'A refused attempt to cross a Phase 40 boundary, kept so the refusal is visible rather than silent.';

-- ---------------------------------------------------------------------------
-- The state machine
-- ---------------------------------------------------------------------------

create or replace function public.improvement_candidate_begin_evaluation(
  p_id uuid,
  p_suite_name text,
  p_suite_version text,
  p_suite_hash text,
  p_criteria_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.improvement_candidates;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_row from public.improvement_candidates where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;
  if public.workspace_role(v_row.workspace_id) is null or v_row.user_id <> v_user then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_row.status <> 'draft' then
    return jsonb_build_object('ok', false, 'code', 'not-draft');
  end if;
  if p_suite_hash is null or p_suite_hash !~ '^[0-9a-f]{64}$'
     or p_criteria_hash is null or p_criteria_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'bad-hash');
  end if;

  update public.improvement_candidates
     set status = 'evaluating',
         suite_name = left(p_suite_name, 80),
         suite_version = left(p_suite_version, 40),
         suite_hash = p_suite_hash,
         criteria_hash = p_criteria_hash,
         criteria_frozen_at = now()
   where id = p_id;

  return jsonb_build_object('ok', true, 'suite_hash', p_suite_hash, 'criteria_hash', p_criteria_hash);
end;
$$;

create or replace function public.improvement_candidate_record_evaluation(
  p_id uuid,
  p_suite_hash text,
  p_totals jsonb,
  p_case_results jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.improvement_candidates;
  v_total integer := coalesce((p_totals ->> 'totalCases')::integer, 0);
  v_baseline integer := coalesce((p_totals ->> 'baselinePassed')::integer, 0);
  v_candidate integer := coalesce((p_totals ->> 'candidatePassed')::integer, 0);
  v_security integer := coalesce((p_totals ->> 'securityFindings')::integer, 0);
  v_regressions integer := coalesce((p_totals ->> 'regressions')::integer, 0);
  v_base_cost integer := coalesce((p_totals ->> 'baselineCostUnits')::integer, 0);
  v_cand_cost integer := coalesce((p_totals ->> 'candidateCostUnits')::integer, 0);
  v_ratio numeric(7, 4);
  v_verdict text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_row from public.improvement_candidates where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;
  if public.workspace_role(v_row.workspace_id) is null or v_row.user_id <> v_user then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_row.status <> 'evaluating' then
    return jsonb_build_object('ok', false, 'code', 'not-evaluating');
  end if;
  if v_row.suite_hash is distinct from p_suite_hash then
    return jsonb_build_object('ok', false, 'code', 'suite-mismatch');
  end if;
  if v_total < 1 or v_baseline > v_total or v_candidate > v_total then
    return jsonb_build_object('ok', false, 'code', 'bad-totals');
  end if;

  v_ratio := round(
    (v_cand_cost - greatest(1, v_base_cost))::numeric / greatest(1, v_base_cost),
    4
  );
  if v_candidate < v_baseline or v_security > 0 or v_regressions > 0 or v_ratio > 0.25 then
    v_verdict := 'worse';
  elsif v_candidate > v_baseline then
    v_verdict := 'better';
  else
    v_verdict := 'equal';
  end if;

  insert into public.improvement_candidate_evaluations (
    candidate_id, workspace_id, user_id, suite_name, suite_version, suite_hash,
    total_cases, baseline_passed, candidate_passed, security_findings, regressions,
    baseline_cost_units, candidate_cost_units, cost_delta_ratio, verdict, integrity,
    case_results, comparison
  ) values (
    p_id, v_row.workspace_id, v_user, v_row.suite_name, v_row.suite_version, p_suite_hash,
    v_total, v_baseline, v_candidate, v_security, v_regressions,
    v_base_cost, v_cand_cost, v_ratio, v_verdict, 'verified',
    coalesce(p_case_results, '[]'::jsonb),
    jsonb_build_object('verdict', v_verdict, 'costDeltaRatio', v_ratio)
  );

  return jsonb_build_object('ok', true, 'verdict', v_verdict, 'cost_delta_ratio', v_ratio);
end;
$$;

create or replace function public.improvement_candidate_approve(p_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.improvement_candidates;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_row from public.improvement_candidates where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;
  if public.workspace_role(v_row.workspace_id) is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_row.user_id = v_user then
    return jsonb_build_object('ok', false, 'code', 'self-review');
  end if;
  if v_row.status <> 'evaluated' then
    return jsonb_build_object('ok', false, 'code', 'not-evaluated');
  end if;
  if v_row.verdict not in ('better', 'equal') then
    return jsonb_build_object('ok', false, 'code', 'result-worse');
  end if;
  if v_row.integrity <> 'verified' then
    return jsonb_build_object('ok', false, 'code', 'suite-mismatch');
  end if;
  if v_row.security_findings > 0 then
    return jsonb_build_object('ok', false, 'code', 'security-findings');
  end if;
  if v_row.regressions > 0 then
    return jsonb_build_object('ok', false, 'code', 'regressions');
  end if;
  if v_row.cost_delta_ratio > 0.25 then
    return jsonb_build_object('ok', false, 'code', 'cost');
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 20 then
    return jsonb_build_object('ok', false, 'code', 'note-required');
  end if;

  update public.improvement_candidates
     set status = 'approved',
         reviewed_at = now(),
         reviewed_by = v_user,
         review_note = left(p_note, 1000)
   where id = p_id;

  return jsonb_build_object('ok', true, 'status', 'approved');
end;
$$;

create or replace function public.improvement_candidate_reject(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.improvement_candidates;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_row from public.improvement_candidates where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;
  if public.workspace_role(v_row.workspace_id) is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_row.status in ('approved', 'promoted', 'rejected', 'cancelled') then
    return jsonb_build_object('ok', false, 'code', 'final');
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    return jsonb_build_object('ok', false, 'code', 'reason-required');
  end if;

  update public.improvement_candidates
     set status = 'rejected',
         reviewed_at = now(),
         reviewed_by = v_user,
         review_note = left(p_reason, 1000)
   where id = p_id;

  return jsonb_build_object('ok', true, 'status', 'rejected');
end;
$$;

create or replace function public.improvement_candidate_promote(
  p_id uuid,
  p_reference text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.improvement_candidates;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_row from public.improvement_candidates where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;
  if public.workspace_role(v_row.workspace_id) is null then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_row.status <> 'approved' then
    return jsonb_build_object('ok', false, 'code', 'not-approved');
  end if;
  if v_row.user_id = v_user then
    return jsonb_build_object('ok', false, 'code', 'self-review');
  end if;
  if p_reference is null or char_length(btrim(p_reference)) < 2 then
    return jsonb_build_object('ok', false, 'code', 'reference-required');
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 20 then
    return jsonb_build_object('ok', false, 'code', 'note-required');
  end if;

  update public.improvement_candidates
     set status = 'promoted',
         promotion_approved_at = now(),
         promotion_approved_by = v_user,
         promotion_ref = left(p_reference, 200),
         promoted_at = now(),
         review_note = left(p_note, 1000)
   where id = p_id;

  return jsonb_build_object('ok', true, 'status', 'promoted', 'reference', p_reference);
end;
$$;

create or replace function public.improvement_candidate_cancel(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.improvement_candidates;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_row from public.improvement_candidates where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;
  if public.workspace_role(v_row.workspace_id) is null or v_row.user_id <> v_user then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_row.status in ('promoted', 'cancelled') then
    return jsonb_build_object('ok', false, 'code', 'final');
  end if;

  update public.improvement_candidates set status = 'cancelled' where id = p_id;
  return jsonb_build_object('ok', true, 'status', 'cancelled');
end;
$$;

revoke all on function public.improvement_candidate_begin_evaluation(uuid, text, text, text, text) from public, anon;
revoke all on function public.improvement_candidate_record_evaluation(uuid, text, jsonb, jsonb) from public, anon;
revoke all on function public.improvement_candidate_approve(uuid, text) from public, anon;
revoke all on function public.improvement_candidate_reject(uuid, text) from public, anon;
revoke all on function public.improvement_candidate_promote(uuid, text, text) from public, anon;
revoke all on function public.improvement_candidate_cancel(uuid) from public, anon;
grant execute on function public.improvement_candidate_begin_evaluation(uuid, text, text, text, text) to authenticated;
grant execute on function public.improvement_candidate_record_evaluation(uuid, text, jsonb, jsonb) to authenticated;
grant execute on function public.improvement_candidate_approve(uuid, text) to authenticated;
grant execute on function public.improvement_candidate_reject(uuid, text) to authenticated;
grant execute on function public.improvement_candidate_promote(uuid, text, text) to authenticated;
grant execute on function public.improvement_candidate_cancel(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.improvement_candidates enable row level security;
alter table public.improvement_candidate_evaluations enable row level security;
alter table public.improvement_candidate_events enable row level security;
alter table public.improvement_boundary_blocks enable row level security;

drop policy if exists "members read improvement candidates" on public.improvement_candidates;
create policy "members read improvement candidates" on public.improvement_candidates
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "owners draft improvement candidates" on public.improvement_candidates;
create policy "owners draft improvement candidates" on public.improvement_candidates
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) is not null
    and user_id = auth.uid()
    and status = 'draft'
  );

drop policy if exists "members read improvement evaluations" on public.improvement_candidate_evaluations;
create policy "members read improvement evaluations" on public.improvement_candidate_evaluations
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members read improvement events" on public.improvement_candidate_events;
create policy "members read improvement events" on public.improvement_candidate_events
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "owners append improvement events" on public.improvement_candidate_events;
create policy "owners append improvement events" on public.improvement_candidate_events
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) is not null
    and exists (
      select 1 from public.improvement_candidates c
       where c.id = candidate_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "members read boundary blocks" on public.improvement_boundary_blocks;
create policy "members read boundary blocks" on public.improvement_boundary_blocks
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members record boundary blocks" on public.improvement_boundary_blocks;
create policy "members record boundary blocks" on public.improvement_boundary_blocks
  for insert to authenticated
  with check (public.workspace_role(workspace_id) is not null and user_id = auth.uid());
