-- GET TO IT — Phase 39: research missions
--
-- A research mission is a bounded research contract. It is not a new agent
-- runtime: it executes through the Phase 36 orchestration layer (the mission
-- points at an orchestration and is cancelled through orchestration_cancel),
-- its sources follow the Phase 37 evidence conventions (a stance of supports
-- or contradicts, and an explicit statement kind), and a proposed experiment
-- is an ordinary Phase 35 experiment record.
--
-- Two rules are enforced here rather than described in prose:
--   * role labels alone do not establish independent verification, so a
--     conclusion cannot be verified by the specialist function that wrote it;
--   * nothing is labelled a discovery without a verified supporting source of
--     the required quality, or while a verified source contradicts it.

-- ---------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------

-- Which source tiers satisfy which requirement.
create or replace function public.research_source_rank(p_tier text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_tier
    when 'primary' then 2
    when 'reputable_secondary' then 1
    when 'unverified' then 0
    else -1
  end;
$$;

create or replace function public.research_tier_rank(p_required text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_required
    when 'primary' then 2
    when 'reputable_secondary' then 1
    when 'any' then 0
    else -1
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The mission contract
-- ---------------------------------------------------------------------------

create table if not exists public.research_missions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  orchestration_id uuid references public.orchestrations (id) on delete set null,
  question text not null check (char_length(btrim(question)) between 8 and 300),
  scope text not null check (char_length(btrim(scope)) between 5 and 2000),
  existing_evidence text not null default ''
    check (char_length(existing_evidence) <= 4000),
  required_source_tier text not null default 'primary'
    check (required_source_tier in ('primary', 'reputable_secondary', 'any')),
  allowed_tools text[] not null
    check (cardinality(allowed_tools) between 1 and 8),
  deliverables text[] not null
    check (cardinality(deliverables) between 1 and 6),
  task_budget integer not null default 6
    check (task_budget between 1 and 12),
  agent_budget integer not null default 4
    check (agent_budget between 1 and 6),
  retry_budget integer not null default 1
    check (retry_budget between 0 and 3),
  spend_ceiling_cents integer not null default 200
    check (spend_ceiling_cents between 10 and 20000),
  time_ceiling_minutes integer not null default 120
    check (time_ceiling_minutes between 15 and 10080),
  stop_conditions text[] not null
    check (cardinality(stop_conditions) between 1 and 6),
  checkpoints text[] not null
    check (cardinality(checkpoints) between 1 and 6),
  status text not null default 'draft'
    check (status in ('draft', 'ready', 'running', 'paused', 'complete', 'cancelled')),
  proposed_experiment_id uuid references public.experiments (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.research_missions is
  'One bounded research contract. It runs on the Phase 36 orchestration layer and proposes ordinary Phase 35 experiments; it is not a separate agent runtime.';
comment on column public.research_missions.checkpoints is
  'Human review checkpoints. Work stops and waits at each one; nothing publishes automatically.';
comment on column public.research_missions.proposed_experiment_id is
  'The Phase 35 experiment this mission proposed, once a person turned the proposal into a record.';

create index if not exists research_missions_workspace_idx
  on public.research_missions (workspace_id, created_at desc);

drop trigger if exists research_missions_set_updated_at on public.research_missions;
create trigger research_missions_set_updated_at before update on public.research_missions
  for each row execute function public.set_updated_at();

create or replace function public.research_missions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- No outreach and no publishing, whatever a caller puts in the tool list.
  if exists (
    select 1 from unnest(new.allowed_tools) as tool
     where tool in ('send_email', 'publish', 'outreach', 'post_message', 'contact_participant')
  ) then
    raise exception 'a research mission may not use outreach or publishing tools';
  end if;

  if tg_op = 'UPDATE' and old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception 'a cancelled research mission cannot be restarted; create a new one';
  end if;

  -- A mission only counts as complete when the brief has something to say.
  if new.status = 'complete' then
    if not exists (select 1 from public.research_hypotheses h where h.mission_id = new.id) then
      raise exception 'a complete mission needs at least one hypothesis';
    end if;
    if not exists (select 1 from public.research_sources s where s.mission_id = new.id) then
      raise exception 'a complete mission needs at least one recorded source';
    end if;
    if not exists (select 1 from public.research_findings f where f.mission_id = new.id) then
      raise exception 'a complete mission needs at least one finding';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists research_missions_guard_trigger on public.research_missions;
create trigger research_missions_guard_trigger
  before insert or update on public.research_missions
  for each row execute function public.research_missions_guard();

-- ---------------------------------------------------------------------------
-- 3. Competing hypotheses
-- ---------------------------------------------------------------------------

create table if not exists public.research_hypotheses (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.research_missions (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  statement text not null check (char_length(btrim(statement)) between 8 and 1000),
  role text not null default 'leading'
    check (role in ('leading', 'competing')),
  status text not null default 'open'
    check (status in ('open', 'supported', 'rejected', 'unresolved')),
  created_at timestamptz not null default now()
);

comment on table public.research_hypotheses is
  'The hypotheses a mission is testing, including the ones competing with the leading explanation. A mission with a single hypothesis is refused by the action layer.';

create index if not exists research_hypotheses_mission_idx
  on public.research_hypotheses (mission_id, created_at);

-- ---------------------------------------------------------------------------
-- 4. Sources with provenance
-- ---------------------------------------------------------------------------

create table if not exists public.research_sources (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.research_missions (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  hypothesis_id uuid references public.research_hypotheses (id) on delete set null,
  stance text not null check (stance in ('supports', 'contradicts')),
  statement_kind text not null
    check (statement_kind in ('quotation', 'observation', 'inference', 'proposal')),
  source_tier text not null check (source_tier in ('primary', 'reputable_secondary', 'unverified')),
  source_kind text not null
    check (source_kind in ('document', 'dataset', 'interview', 'observation', 'code', 'literature', 'internal_record', 'web_page')),
  title text not null check (char_length(btrim(title)) between 3 and 300),
  locator text not null default '' check (char_length(locator) <= 500),
  excerpt text not null default '' check (char_length(excerpt) <= 4000),
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  -- A quotation has to quote something.
  check (statement_kind <> 'quotation' or char_length(btrim(excerpt)) >= 10),
  -- Provenance means a pointer to where it came from.
  check (char_length(btrim(locator)) >= 3 or source_kind = 'observation')
);

comment on table public.research_sources is
  'One piece of evidence with its provenance, its stance and whether it is a quotation, an observation, an inference or a proposal.';
comment on column public.research_sources.excerpt is
  'The quoted or observed text. Never a conclusion: what the source says, in its own words where possible.';

create index if not exists research_sources_mission_idx
  on public.research_sources (mission_id, stance);

-- ---------------------------------------------------------------------------
-- 5. Findings, and the independence guard
-- ---------------------------------------------------------------------------

create table if not exists public.research_findings (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.research_missions (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  hypothesis_id uuid references public.research_hypotheses (id) on delete set null,
  claim text not null check (char_length(btrim(claim)) between 8 and 2000),
  label text not null default 'observation'
    check (label in ('observation', 'inference', 'proposal', 'discovery')),
  author_role text not null
    check (author_role in (
      'investigator', 'alternative_hypothesis_reviewer', 'methodology_reviewer',
      'prototype_builder', 'evidence_verifier', 'synthesis_writer'
    )),
  verifier_role text
    check (verifier_role is null or verifier_role in (
      'investigator', 'alternative_hypothesis_reviewer', 'methodology_reviewer',
      'prototype_builder', 'evidence_verifier', 'synthesis_writer'
    )),
  status text not null default 'pending'
    check (status in ('pending', 'supported', 'conflicted', 'unsupported')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  -- A verification names who did it and when.
  check (verified_at is null or verifier_role is not null)
);

comment on table public.research_findings is
  'What the mission concluded, and how strongly. A discovery label is only legal with independent verification and no verified contradicting source.';

create index if not exists research_findings_mission_idx
  on public.research_findings (mission_id, created_at);

create or replace function public.research_findings_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mission public.research_missions;
  v_support integer;
  v_contra integer;
begin
  select * into v_mission from public.research_missions where id = new.mission_id;
  if not found then
    raise exception 'the research mission does not exist';
  end if;

  if new.label = 'proposal' and new.status in ('supported', 'conflicted') then
    raise exception 'a proposal is not evidence; keep it pending until an experiment tests it';
  end if;

  if new.verified_at is not null then
    if new.verifier_role is null then
      raise exception 'a verification must name the specialist function that performed it';
    end if;
    if new.verifier_role = new.author_role then
      raise exception 'a conclusion cannot be verified by the same specialist function that produced it';
    end if;
  end if;

  if new.label = 'discovery' then
    if new.status <> 'supported' then
      raise exception 'a discovery must be recorded as supported';
    end if;
    if new.verified_at is null then
      raise exception 'label it an inference until an independent reviewer has verified it';
    end if;

    select count(*) into v_support
      from public.research_sources s
     where s.mission_id = new.mission_id
       and s.stance = 'supports'
       and s.verified
       and s.statement_kind in ('quotation', 'observation')
       and public.research_source_rank(s.source_tier)
           >= public.research_tier_rank(v_mission.required_source_tier);

    if v_support = 0 then
      raise exception 'no verified supporting source meets the required source quality, so this cannot be a discovery';
    end if;

    select count(*) into v_contra
      from public.research_sources s
     where s.mission_id = new.mission_id
       and s.stance = 'contradicts'
       and s.verified;

    if v_contra > 0 then
      raise exception 'a verified source contradicts this mission, so resolve the conflict before claiming a discovery';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists research_findings_guard_trigger on public.research_findings;
create trigger research_findings_guard_trigger
  before insert or update on public.research_findings
  for each row execute function public.research_findings_guard();

-- ---------------------------------------------------------------------------
-- 6. Child rows inherit the mission's workspace
-- ---------------------------------------------------------------------------

create or replace function public.research_scope_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  select m.workspace_id into v_workspace
    from public.research_missions m where m.id = new.mission_id;

  if v_workspace is null then
    raise exception 'the research mission does not exist';
  end if;
  if new.workspace_id is distinct from v_workspace then
    raise exception 'this record must belong to the mission''s workspace';
  end if;

  return new;
end;
$$;

drop trigger if exists research_hypotheses_scope on public.research_hypotheses;
create trigger research_hypotheses_scope
  before insert or update on public.research_hypotheses
  for each row execute function public.research_scope_guard();

drop trigger if exists research_sources_scope on public.research_sources;
create trigger research_sources_scope
  before insert or update on public.research_sources
  for each row execute function public.research_scope_guard();

drop trigger if exists research_findings_scope on public.research_findings;
create trigger research_findings_scope
  before insert or update on public.research_findings
  for each row execute function public.research_scope_guard();

-- ---------------------------------------------------------------------------
-- 7. Cancellation propagates into the orchestration
-- ---------------------------------------------------------------------------

create or replace function public.research_cancel(p_id uuid, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_mission public.research_missions;
  v_note text := coalesce(nullif(btrim(p_note), ''), 'Research mission cancelled.');
  v_orchestration jsonb := null;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_mission from public.research_missions where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;

  if public.workspace_role(v_mission.workspace_id) is null then
    return jsonb_build_object('ok', false, 'code', 'no-permission');
  end if;

  update public.research_missions
     set status = 'cancelled'
   where id = p_id and status <> 'cancelled';

  -- Cancelling a research mission stops the orchestration behind it. Leaving
  -- the orchestration running would let work continue after the contract ended.
  if v_mission.orchestration_id is not null then
    v_orchestration := public.orchestration_cancel(v_mission.orchestration_id, v_note);
  end if;

  return jsonb_build_object(
    'ok', true,
    'mission_id', p_id,
    'orchestration', v_orchestration
  );
end;
$$;

comment on function public.research_cancel(uuid, text) is
  'Cancels a research mission and the orchestration that runs it, so cancellation is not limited to the research tables.';

-- ---------------------------------------------------------------------------
-- 8. Row level security
-- ---------------------------------------------------------------------------

alter table public.research_missions enable row level security;
alter table public.research_hypotheses enable row level security;
alter table public.research_sources enable row level security;
alter table public.research_findings enable row level security;

drop policy if exists "members read research missions" on public.research_missions;
create policy "members read research missions" on public.research_missions
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members create their own research missions" on public.research_missions;
create policy "members create their own research missions" on public.research_missions
  for insert to authenticated
  with check (public.workspace_role(workspace_id) is not null and created_by = auth.uid());

drop policy if exists "members update research missions" on public.research_missions;
create policy "members update research missions" on public.research_missions
  for update to authenticated
  using (public.workspace_role(workspace_id) is not null)
  with check (public.workspace_role(workspace_id) is not null);

drop policy if exists "creators delete research missions" on public.research_missions;
create policy "creators delete research missions" on public.research_missions
  for delete to authenticated
  using (created_by = auth.uid());

drop policy if exists "members read research hypotheses" on public.research_hypotheses;
create policy "members read research hypotheses" on public.research_hypotheses
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members create research hypotheses" on public.research_hypotheses;
create policy "members create research hypotheses" on public.research_hypotheses
  for insert to authenticated
  with check (public.workspace_role(workspace_id) is not null and created_by = auth.uid());

drop policy if exists "members read research sources" on public.research_sources;
create policy "members read research sources" on public.research_sources
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members create research sources" on public.research_sources;
create policy "members create research sources" on public.research_sources
  for insert to authenticated
  with check (public.workspace_role(workspace_id) is not null and created_by = auth.uid());

drop policy if exists "members read research findings" on public.research_findings;
create policy "members read research findings" on public.research_findings
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members create research findings" on public.research_findings;
create policy "members create research findings" on public.research_findings
  for insert to authenticated
  with check (public.workspace_role(workspace_id) is not null and created_by = auth.uid());

drop policy if exists "members update research findings" on public.research_findings;
create policy "members update research findings" on public.research_findings
  for update to authenticated
  using (public.workspace_role(workspace_id) is not null)
  with check (public.workspace_role(workspace_id) is not null);
