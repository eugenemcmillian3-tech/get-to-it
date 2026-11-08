-- GET TO IT — Phase 35 schema
-- Experiment workspace: a bounded, human-owned way to turn a future-facing
-- idea into a testable prototype and an honest outcome review.
--
-- Ground rules encoded here:
--   * An experiment belongs to one existing workspace. Links to future paths,
--     radar signals, learning goals, missions, outcome reviews and app projects
--     are explicit and optional; nothing is created by linking.
--   * The original question and hypothesis are immutable once saved. The review
--     records what was built, observed, failed and remains unknown, and keeps
--     participant opinions separate from measured observations.
--   * Participation is voluntary. Feedback requires recorded consent, and an
--     identifiable quote also requires explicit permission to quote it.
--   * High-stakes human-subject research is refused by the generic workflow.
--   * Outreach, publication, paid activity and deployment each need a separate
--     human approval. A requester cannot approve their own request and an agent
--     cannot decide one.
--   * Observations, feedback and events are append-only. There is no update or
--     delete policy for them.
--   * An approved prototype becomes a normal app-builder project. Nothing here
--     runs code, deploys, sends outreach, publishes or charges anyone.

-- ---------------------------------------------------------------------------
-- 1. The experiment record
-- ---------------------------------------------------------------------------

create table if not exists public.experiments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  mission_id uuid references public.missions (id) on delete set null,
  future_path_id uuid references public.future_paths (id) on delete set null,
  radar_signal_id uuid references public.radar_signals (id) on delete set null,
  learning_goal_id uuid references public.goals (id) on delete set null,
  outcome_review_id uuid references public.outcome_reviews (id) on delete set null,
  prototype_project_id uuid references public.app_projects (id) on delete set null,
  created_by uuid not null references auth.users (id) on delete cascade,
  question text not null check (char_length(btrim(question)) between 8 and 300),
  hypothesis text not null check (char_length(btrim(hypothesis)) between 8 and 2000),
  target_users text not null check (char_length(btrim(target_users)) between 5 and 1000),
  evidence_available text not null default ''
    check (char_length(evidence_available) <= 4000),
  assumptions text not null default ''
    check (char_length(assumptions) <= 4000),
  proposed_prototype text not null
    check (char_length(btrim(proposed_prototype)) between 5 and 2000),
  success_criteria text not null
    check (char_length(btrim(success_criteria)) between 5 and 2000),
  failure_criteria text not null
    check (char_length(btrim(failure_criteria)) between 5 and 2000),
  time_limit_minutes integer not null
    check (time_limit_minutes between 15 and 10080),
  resource_limit text not null default ''
    check (char_length(resource_limit) <= 1000),
  privacy_requirements text not null
    check (char_length(btrim(privacy_requirements)) between 5 and 2000),
  consent_requirements text not null
    check (char_length(btrim(consent_requirements)) between 5 and 2000),
  stop_conditions text not null
    check (char_length(btrim(stop_conditions)) between 5 and 2000),
  ai_disclosure text not null default
    'Tell participants which parts are AI-assisted and which are written by a person.'
    check (char_length(btrim(ai_disclosure)) between 10 and 1000),
  high_stakes boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft', 'ready', 'running', 'awaiting_review', 'completed', 'stopped')),
  review_at date not null,
  prototype_approved_by uuid references auth.users (id) on delete set null,
  prototype_approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not high_stakes),
  check (prototype_approved_at is null or prototype_approved_by is not null),
  check (prototype_project_id is null or prototype_approved_at is not null)
);

comment on table public.experiments is
  'One bounded experiment in a workspace. It links existing records, keeps the question and hypothesis, and records a human decision.';
comment on column public.experiments.high_stakes is
  'Always false in this build. High-stakes human-subject research is refused rather than run through a generic app workflow.';
comment on column public.experiments.ai_disclosure is
  'What participants are told about AI assistance. The interface must show this before any AI-assisted interaction.';

create index if not exists experiments_workspace_idx
  on public.experiments (workspace_id, created_at desc);
create index if not exists experiments_review_idx
  on public.experiments (workspace_id, review_at);

drop trigger if exists experiments_set_updated_at on public.experiments;
create trigger experiments_set_updated_at before update on public.experiments
  for each row execute function public.set_updated_at();

-- A person may only link records they can already read. The optional mission
-- must be in the same workspace, and an approved prototype project must belong
-- to the person who created the experiment and, when it has one, the same
-- workspace. No link grants access by itself.
create or replace function public.experiments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.high_stakes then
    raise exception 'high-stakes human-subject experiments are not supported in this workflow';
  end if;

  if new.mission_id is not null and not exists (
    select 1 from public.missions m
     where m.id = new.mission_id and m.workspace_id = new.workspace_id
  ) then
    raise exception 'the mission must belong to the same workspace';
  end if;

  if new.future_path_id is not null and not exists (
    select 1 from public.future_paths p
     where p.id = new.future_path_id and p.user_id = new.created_by
  ) then
    raise exception 'the future path must be one of the creator own records';
  end if;

  if new.radar_signal_id is not null and not exists (
    select 1 from public.radar_signals s
     where s.id = new.radar_signal_id and s.user_id = new.created_by
  ) then
    raise exception 'the radar signal must be one of the creator own records';
  end if;

  if new.learning_goal_id is not null and not exists (
    select 1 from public.goals g
     where g.id = new.learning_goal_id and g.user_id = new.created_by
  ) then
    raise exception 'the learning goal must be one of the creator own goals';
  end if;

  if new.outcome_review_id is not null and not exists (
    select 1 from public.outcome_reviews r
     where r.id = new.outcome_review_id and r.user_id = new.created_by
  ) then
    raise exception 'the outcome review must be one of the creator own reviews';
  end if;

  if new.prototype_project_id is not null and not exists (
    select 1 from public.app_projects p
     where p.id = new.prototype_project_id
       and p.user_id = new.created_by
       and (p.workspace_id is null or p.workspace_id = new.workspace_id)
  ) then
    raise exception 'the prototype project must belong to the creator in this workspace';
  end if;

  if new.prototype_approved_at is not null
     and new.prototype_project_id is null then
    raise exception 'an approved prototype needs a project';
  end if;

  if tg_op = 'UPDATE' then
    if new.workspace_id is distinct from old.workspace_id
       or new.created_by is distinct from old.created_by then
      raise exception 'the experiment owner and workspace cannot be changed';
    end if;
    if new.question is distinct from old.question
       or new.hypothesis is distinct from old.hypothesis then
      raise exception 'the original question and hypothesis cannot be rewritten';
    end if;
    if old.prototype_approved_at is not null
       and new.prototype_approved_at is null then
      raise exception 'an approved prototype cannot be unapproved';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists experiments_guard_trigger on public.experiments;
create trigger experiments_guard_trigger
  before insert or update on public.experiments
  for each row execute function public.experiments_guard();

-- ---------------------------------------------------------------------------
-- 2. Append-only observations and consent-gated feedback
-- ---------------------------------------------------------------------------

create table if not exists public.experiment_observations (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  kind text not null
    check (kind in ('measured', 'participant_opinion', 'observation', 'failure', 'unknown')),
  text text not null check (char_length(btrim(text)) between 5 and 4000),
  source text not null default '' check (char_length(source) <= 300),
  created_at timestamptz not null default now()
);

comment on table public.experiment_observations is
  'What was observed, labelled as measured, participant opinion, failure or unknown. Append-only.';
comment on column public.experiment_observations.kind is
  'A participant opinion is never stored as a measured outcome.';

create index if not exists experiment_observations_experiment_idx
  on public.experiment_observations (experiment_id, created_at);

create table if not exists public.experiment_feedback (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('opinion', 'measured')),
  participant_reference text not null default ''
    check (char_length(participant_reference) <= 120),
  text text not null check (char_length(btrim(text)) between 5 and 2000),
  identifiable boolean not null default false,
  consent_confirmed boolean not null default false,
  consent_note text not null default '' check (char_length(consent_note) <= 1000),
  permission_to_quote boolean not null default false,
  created_at timestamptz not null default now(),
  check (consent_confirmed),
  check (not identifiable or char_length(btrim(consent_note)) >= 10),
  check (not identifiable or permission_to_quote)
);

comment on table public.experiment_feedback is
  'Feedback supplied with recorded consent. Unconsented feedback cannot be stored, and identifiable quotes need explicit permission.';

create index if not exists experiment_feedback_experiment_idx
  on public.experiment_feedback (experiment_id, created_at);

create table if not exists public.experiment_approvals (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in (
    'outreach', 'publication', 'paid_activity', 'deployment', 'high_stakes'
  )),
  summary text not null check (char_length(btrim(summary)) between 5 and 500),
  scope text not null check (char_length(btrim(scope)) between 5 and 2000),
  requested_by uuid references auth.users (id) on delete set null,
  requested_by_kind text not null default 'human'
    check (requested_by_kind in ('human', 'agent')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  note text not null default '' check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  check (decided_by is null or requested_by is null or decided_by <> requested_by),
  check (
    (requested_by_kind = 'human' and requested_by is not null)
    or (requested_by_kind = 'agent' and requested_by is null)
  ),
  check (status <> 'approved' or (decided_by is not null and decided_at is not null))
);

comment on table public.experiment_approvals is
  'A separate approval for outreach, publication, paid activity or deployment. Approval never performs the action itself.';

create index if not exists experiment_approvals_experiment_idx
  on public.experiment_approvals (experiment_id, status, created_at desc);

create or replace function public.experiment_approvals_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.experiment_id is distinct from old.experiment_id
     or new.workspace_id is distinct from old.workspace_id
     or new.kind is distinct from old.kind
     or new.summary is distinct from old.summary
     or new.scope is distinct from old.scope
     or new.requested_by is distinct from old.requested_by
     or new.requested_by_kind is distinct from old.requested_by_kind then
    raise exception 'approval scope and requester are immutable; create a new request';
  end if;

  if old.status <> 'pending' and new.status <> old.status then
    raise exception 'a decided approval cannot be reopened';
  end if;

  if new.status in ('approved', 'rejected') then
    if new.decided_by is null or new.decided_by <> (select auth.uid()) then
      raise exception 'the decider must be recorded';
    end if;
    if new.requested_by is not null and new.decided_by = new.requested_by then
      raise exception 'a person cannot approve their own request';
    end if;
    if new.requested_by_kind = 'agent' and new.decided_by is null then
      raise exception 'a human must decide an agent request';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists experiment_approvals_guard_trigger on public.experiment_approvals;
create trigger experiment_approvals_guard_trigger
  before update on public.experiment_approvals
  for each row execute function public.experiment_approvals_guard();

-- ---------------------------------------------------------------------------
-- 3. Human outcome review and append-only event trail
-- ---------------------------------------------------------------------------

create table if not exists public.experiment_reviews (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null unique references public.experiments (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  built text not null default '' check (char_length(built) <= 3000),
  observed text not null default '' check (char_length(observed) <= 3000),
  failed text not null default '' check (char_length(failed) <= 3000),
  unknown text not null default '' check (char_length(unknown) <= 3000),
  decision text not null default 'undecided'
    check (decision in ('undecided', 'continue', 'revise', 'stop')),
  decision_note text not null default '' check (char_length(decision_note) <= 3000),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (decision = 'undecided' or (decided_by is not null and decided_at is not null))
);

comment on table public.experiment_reviews is
  'A human review of what was built, observed, failed and remains unknown. The decision is continue, revise or stop.';

drop trigger if exists experiment_reviews_set_updated_at on public.experiment_reviews;
create trigger experiment_reviews_set_updated_at before update on public.experiment_reviews
  for each row execute function public.set_updated_at();

create or replace function public.experiment_reviews_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.experiment_id is distinct from old.experiment_id
       or new.workspace_id is distinct from old.workspace_id then
      raise exception 'the reviewed experiment cannot be changed';
    end if;
    if old.decision <> 'undecided' then
      raise exception 'a completed review decision cannot be rewritten';
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

drop trigger if exists experiment_reviews_guard_trigger on public.experiment_reviews;
create trigger experiment_reviews_guard_trigger
  before insert or update on public.experiment_reviews
  for each row execute function public.experiment_reviews_guard();

create table if not exists public.experiment_events (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references public.experiments (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  kind text not null check (char_length(btrim(kind)) between 2 and 80),
  detail text not null check (char_length(btrim(detail)) between 1 and 1000),
  created_at timestamptz not null default now()
);

comment on table public.experiment_events is
  'Append-only trail of experiment changes and decisions. No update or delete policy exists.';

create index if not exists experiment_events_experiment_idx
  on public.experiment_events (experiment_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. RPCs: approval decision and prototype promotion
-- ---------------------------------------------------------------------------

create or replace function public.experiment_decide_approval(
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
  v_user uuid := auth.uid();
  v_approval public.experiment_approvals;
  v_role text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;
  if p_decision not in ('approved', 'rejected') then
    return jsonb_build_object('ok', false, 'code', 'invalid-decision');
  end if;

  select * into v_approval
    from public.experiment_approvals
   where id = p_approval_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;

  v_role := public.workspace_role(v_approval.workspace_id);
  if v_role is null or v_role not in ('owner', 'admin') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_approval.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'not-pending');
  end if;
  if v_approval.requested_by = v_user then
    return jsonb_build_object('ok', false, 'code', 'self-approval');
  end if;

  update public.experiment_approvals
     set status = p_decision,
         decided_by = v_user,
         decided_at = now(),
         note = left(coalesce(p_note, ''), 1000)
   where id = p_approval_id;

  insert into public.experiment_events (experiment_id, workspace_id, actor_id, kind, detail)
  values (
    v_approval.experiment_id,
    v_approval.workspace_id,
    v_user,
    'approval_' || p_decision,
    v_approval.kind || ': ' || v_approval.summary
  );

  return jsonb_build_object('ok', true, 'status', p_decision);
end;
$$;

revoke all on function public.experiment_decide_approval(uuid, text, text)
  from public, anon;
grant execute on function public.experiment_decide_approval(uuid, text, text)
  to authenticated;

create or replace function public.experiment_approve_prototype(
  p_experiment_id uuid,
  p_project_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_experiment public.experiments;
  v_role text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_experiment
    from public.experiments
   where id = p_experiment_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;

  v_role := public.workspace_role(v_experiment.workspace_id);
  if v_role is null or v_role not in ('owner', 'admin') then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_experiment.prototype_project_id is not null then
    return jsonb_build_object('ok', false, 'code', 'already-approved');
  end if;
  if not exists (
    select 1 from public.app_projects p
     where p.id = p_project_id
       and p.user_id = v_experiment.created_by
       and (p.workspace_id is null or p.workspace_id = v_experiment.workspace_id)
  ) then
    return jsonb_build_object('ok', false, 'code', 'project-not-owned');
  end if;

  update public.experiments
     set prototype_project_id = p_project_id,
         prototype_approved_by = v_user,
         prototype_approved_at = now(),
         status = case when status = 'draft' then 'running' else status end
   where id = p_experiment_id;

  insert into public.experiment_events (experiment_id, workspace_id, actor_id, kind, detail)
  values (
    p_experiment_id,
    v_experiment.workspace_id,
    v_user,
    'prototype_approved',
    'A human approved the prototype project. Sandbox, test and deployment approvals still apply.'
  );

  return jsonb_build_object('ok', true, 'project_id', p_project_id);
end;
$$;

revoke all on function public.experiment_approve_prototype(uuid, uuid)
  from public, anon;
grant execute on function public.experiment_approve_prototype(uuid, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Row-level security and grants
-- ---------------------------------------------------------------------------

alter table public.experiments enable row level security;
alter table public.experiment_observations enable row level security;
alter table public.experiment_feedback enable row level security;
alter table public.experiment_approvals enable row level security;
alter table public.experiment_reviews enable row level security;
alter table public.experiment_events enable row level security;

drop policy if exists "members read experiments" on public.experiments;
create policy "members read experiments" on public.experiments
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members create their own experiments" on public.experiments;
create policy "members create their own experiments" on public.experiments
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) is not null
    and created_by = (select auth.uid())
  );

drop policy if exists "creators and managers update experiments" on public.experiments;
create policy "creators and managers update experiments" on public.experiments
  for update to authenticated
  using (
    public.workspace_role(workspace_id) in ('owner', 'admin')
    or created_by = (select auth.uid())
  )
  with check (
    public.workspace_role(workspace_id) in ('owner', 'admin')
    or created_by = (select auth.uid())
  );

drop policy if exists "creators and managers delete experiments" on public.experiments;
create policy "creators and managers delete experiments" on public.experiments
  for delete to authenticated
  using (
    public.workspace_role(workspace_id) in ('owner', 'admin')
    or created_by = (select auth.uid())
  );

drop policy if exists "members read experiment observations" on public.experiment_observations;
create policy "members read experiment observations" on public.experiment_observations
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members append experiment observations" on public.experiment_observations;
create policy "members append experiment observations" on public.experiment_observations
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) is not null
    and author_id = (select auth.uid())
    and exists (
      select 1 from public.experiments e
       where e.id = experiment_id and e.workspace_id = workspace_id
    )
  );

drop policy if exists "members read experiment feedback" on public.experiment_feedback;
create policy "members read experiment feedback" on public.experiment_feedback
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members add consented feedback" on public.experiment_feedback;
create policy "members add consented feedback" on public.experiment_feedback
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) is not null
    and author_id = (select auth.uid())
    and consent_confirmed
    and exists (
      select 1 from public.experiments e
       where e.id = experiment_id and e.workspace_id = workspace_id
    )
  );

drop policy if exists "members read experiment approvals" on public.experiment_approvals;
create policy "members read experiment approvals" on public.experiment_approvals
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members request experiment approvals" on public.experiment_approvals;
create policy "members request experiment approvals" on public.experiment_approvals
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) is not null
    and requested_by = (select auth.uid())
    and exists (
      select 1 from public.experiments e
       where e.id = experiment_id and e.workspace_id = workspace_id
    )
  );

drop policy if exists "members read experiment reviews" on public.experiment_reviews;
create policy "members read experiment reviews" on public.experiment_reviews
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "creators and managers write experiment reviews" on public.experiment_reviews;
create policy "creators and managers write experiment reviews" on public.experiment_reviews
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) is not null
    and exists (
      select 1 from public.experiments e
       where e.id = experiment_id
         and e.workspace_id = workspace_id
         and (
           e.created_by = (select auth.uid())
           or public.workspace_role(workspace_id) in ('owner', 'admin')
         )
    )
  );

drop policy if exists "creators and managers update experiment reviews" on public.experiment_reviews;
create policy "creators and managers update experiment reviews" on public.experiment_reviews
  for update to authenticated
  using (
    public.workspace_role(workspace_id) in ('owner', 'admin')
    or exists (
      select 1 from public.experiments e
       where e.id = experiment_id and e.created_by = (select auth.uid())
    )
  )
  with check (
    public.workspace_role(workspace_id) in ('owner', 'admin')
    or exists (
      select 1 from public.experiments e
       where e.id = experiment_id and e.created_by = (select auth.uid())
    )
  );

drop policy if exists "members read experiment events" on public.experiment_events;
create policy "members read experiment events" on public.experiment_events
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members append experiment events" on public.experiment_events;
create policy "members append experiment events" on public.experiment_events
  for insert to authenticated
  with check (public.workspace_role(workspace_id) is not null);

grant select, insert, update, delete on public.experiments to authenticated;
grant select, insert on public.experiment_observations to authenticated;
grant select, insert on public.experiment_feedback to authenticated;
grant select, insert on public.experiment_approvals to authenticated;
grant select, insert, update on public.experiment_reviews to authenticated;
grant select, insert on public.experiment_events to authenticated;

revoke all on public.experiments from anon;
revoke all on public.experiment_observations from anon;
revoke all on public.experiment_feedback from anon;
revoke all on public.experiment_approvals from anon;
revoke all on public.experiment_reviews from anon;
revoke all on public.experiment_events from anon;
