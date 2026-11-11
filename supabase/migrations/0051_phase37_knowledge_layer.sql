-- GET TO IT — Phase 37: an evidence-backed knowledge layer.
--
-- The layer links records that already exist (experiments, experiment reviews,
-- outcome reviews, learning records, goals, mission workspaces, orchestration
-- reviews, project models). It never copies them into a competing store: a
-- knowledge entry holds its own statement plus id references to its sources.
--
-- Rules enforced here rather than only in the interface:
--
--   * Seven kinds of statement stay separate, and an AI suggestion or a
--     hypothesis can never be marked "supported" as written.
--   * A person, a stated basis and at least one supporting item are required to
--     verify anything. No function accepts agent consensus as verification.
--   * A retraction invalidates the linked decisions that were built on it, keeps
--     the earlier wording in history and refuses to revive the entry.
--   * A transfer is a proposal until an owner/admin of the target workspace
--     approves it, and it carries no participant feedback or personal record.
--   * Retrieval reads only workspaces the caller is an active member of.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('claim', 'procedure')),
  claim_type text not null check (
    claim_type in (
      'user_preference',
      'project_fact',
      'participant_opinion',
      'measured_observation',
      'tested_procedure',
      'hypothesis',
      'ai_suggestion'
    )
  ),
  title text not null check (char_length(btrim(title)) between 5 and 200),
  statement text not null check (char_length(btrim(statement)) between 15 and 4000),
  domain text not null check (char_length(btrim(domain)) between 2 and 120),
  applies_when text not null default '' check (char_length(applies_when) <= 2000),
  limitations text not null default '' check (char_length(limitations) <= 2000),
  authorized_scope text not null
    default 'This workspace only; reuse elsewhere needs a transfer approval.'
    check (char_length(btrim(authorized_scope)) between 10 and 500),
  provenance text not null default '' check (char_length(provenance) <= 1000),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'supported', 'contradicted', 'retracted')),
  verification_note text not null default ''
    check (char_length(verification_note) <= 2000),
  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz,
  review_at date,
  last_reviewed_at timestamptz,
  version integer not null default 1 check (version between 1 and 1000),
  supersedes_id uuid references public.knowledge_entries (id) on delete set null,
  superseded_by_id uuid references public.knowledge_entries (id) on delete set null,
  transferred_from_id uuid references public.knowledge_entries (id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'superseded', 'retracted')),
  retention_note text not null default '' check (char_length(retention_note) <= 1000),
  delete_after date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (supersedes_id is null or supersedes_id <> id),
  check (superseded_by_id is null or superseded_by_id <> id),
  check (kind <> 'procedure' or claim_type <> 'project_fact'),
  check (verification_status <> 'supported' or verified_at is not null),
  check (claim_type <> 'ai_suggestion' or verification_status <> 'supported'),
  check (status <> 'superseded' or superseded_by_id is not null)
);

comment on table public.knowledge_entries is
  'One claim or reusable procedure with its sources, conditions, limitations and verification. Links existing records by id; it does not copy them.';
comment on column public.knowledge_entries.claim_type is
  'Separates a preference, a project fact, an opinion, a measurement, a tested procedure, a hypothesis and an AI suggestion. They are never merged.';
comment on column public.knowledge_entries.verification_status is
  'Only a person moves this. An AI suggestion or a hypothesis cannot be marked supported as written.';
comment on column public.knowledge_entries.status is
  'A superseded version stays readable for history and is never presented as current guidance.';
comment on column public.knowledge_entries.authorized_scope is
  'Who may reuse the statement. A transfer to another workspace needs its own approval.';
comment on column public.knowledge_entries.delete_after is
  'The retention date the owner set. Past it, an owner or admin can purge the entry; events survive without it.';

create index if not exists knowledge_entries_workspace_idx
  on public.knowledge_entries (workspace_id, updated_at desc);
create index if not exists knowledge_entries_domain_idx
  on public.knowledge_entries (workspace_id, domain);
create index if not exists knowledge_entries_supersedes_idx
  on public.knowledge_entries (supersedes_id);
create index if not exists knowledge_entries_delete_idx
  on public.knowledge_entries (workspace_id, delete_after);

create table if not exists public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  entry_id uuid not null references public.knowledge_entries (id) on delete cascade,
  source_kind text not null check (
    source_kind in (
      'experiment',
      'experiment_review',
      'outcome_review',
      'learning_record',
      'goal',
      'orchestration_review',
      'mission',
      'project_model',
      'user_note',
      'transfer'
    )
  ),
  source_id uuid,
  label text not null default '' check (char_length(label) <= 500),
  linked_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (source_kind in ('user_note', 'transfer') or source_id is not null)
);

comment on table public.knowledge_sources is
  'Where a statement came from. A link never grants access to the record it points at.';

create unique index if not exists knowledge_sources_once_idx
  on public.knowledge_sources (
    entry_id,
    source_kind,
    coalesce(source_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create table if not exists public.knowledge_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  entry_id uuid not null references public.knowledge_entries (id) on delete cascade,
  stance text not null check (stance in ('supports', 'contradicts')),
  evidence_kind text not null check (
    evidence_kind in (
      'user_preference',
      'project_fact',
      'participant_opinion',
      'measured_observation',
      'tested_procedure',
      'hypothesis',
      'ai_suggestion'
    )
  ),
  detail text not null check (char_length(btrim(detail)) between 5 and 2000),
  source_kind text check (
    source_kind is null
    or source_kind in (
      'experiment',
      'experiment_review',
      'outcome_review',
      'learning_record',
      'goal',
      'orchestration_review',
      'mission',
      'project_model',
      'user_note'
    )
  ),
  source_id uuid,
  observed_at date,
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (source_kind is null or source_kind = 'user_note' or source_id is not null)
);

comment on table public.knowledge_evidence is
  'Supporting and contradicting items, appended and never edited. An opinion stays an opinion here.';

create index if not exists knowledge_evidence_entry_idx
  on public.knowledge_evidence (entry_id, stance);

create table if not exists public.knowledge_impacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  entry_id uuid not null references public.knowledge_entries (id) on delete cascade,
  target_kind text not null check (
    target_kind in (
      'recommendation',
      'contract_criterion',
      'plan_task',
      'improvement',
      'app_change',
      'other'
    )
  ),
  target_id uuid,
  target_label text not null check (char_length(btrim(target_label)) between 3 and 300),
  note text not null default '' check (char_length(note) <= 1000),
  invalidated_at timestamptz,
  invalidated_reason text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.knowledge_impacts is
  'Decisions and recommendations built on an entry. A retraction marks them invalidated so they can be revisited; nothing is rewritten automatically.';

create index if not exists knowledge_impacts_entry_idx
  on public.knowledge_impacts (entry_id);

create table if not exists public.knowledge_corrections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  entry_id uuid not null references public.knowledge_entries (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('correction', 'dispute')),
  detail text not null check (char_length(btrim(detail)) between 10 and 4000),
  proposed_statement text not null default ''
    check (char_length(proposed_statement) <= 4000),
  status text not null default 'open'
    check (status in ('open', 'accepted', 'rejected')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text not null default '' check (char_length(decision_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    kind <> 'correction'
    or status <> 'accepted'
    or char_length(btrim(proposed_statement)) >= 15
  ),
  check (status = 'open' or decided_at is not null)
);

comment on table public.knowledge_corrections is
  'A correction proposes replacement wording; a dispute asks for the claim to be withdrawn. Deciding one supersedes or retracts the entry rather than editing it.';

create index if not exists knowledge_corrections_entry_idx
  on public.knowledge_corrections (entry_id, status);

create table if not exists public.knowledge_transfers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  entry_id uuid not null references public.knowledge_entries (id) on delete cascade,
  source_workspace_id uuid not null references public.workspaces (id) on delete cascade,
  target_workspace_id uuid not null references public.workspaces (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete cascade,
  similarities text not null check (char_length(btrim(similarities)) between 10 and 4000),
  differences text not null check (char_length(btrim(differences)) between 10 and 4000),
  evidence_summary text not null default ''
    check (char_length(evidence_summary) <= 4000),
  assumptions_to_test text not null
    check (char_length(btrim(assumptions_to_test)) between 10 and 4000),
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'declined', 'withdrawn')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text not null default '' check (char_length(decision_note) <= 2000),
  created_entry_id uuid references public.knowledge_entries (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_workspace_id <> target_workspace_id),
  check (status <> 'approved' or (decided_at is not null and created_entry_id is not null)),
  check (status <> 'declined' or decided_at is not null)
);

comment on table public.knowledge_transfers is
  'A proposal to reuse a lesson in another workspace. Only an owner/admin there can approve it, and only the statement, conditions and limitations cross over.';

create index if not exists knowledge_transfers_target_idx
  on public.knowledge_transfers (target_workspace_id, status);

create table if not exists public.knowledge_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  entry_id uuid references public.knowledge_entries (id) on delete set null,
  actor_id uuid references auth.users (id) on delete set null,
  kind text not null check (char_length(btrim(kind)) between 2 and 60),
  detail text not null default '' check (char_length(detail) <= 2000),
  created_at timestamptz not null default now()
);

comment on table public.knowledge_events is
  'Append-only history of a knowledge entry, including decisions, transfers and purges.';

create index if not exists knowledge_events_workspace_idx
  on public.knowledge_events (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

drop trigger if exists knowledge_entries_set_updated_at on public.knowledge_entries;
create trigger knowledge_entries_set_updated_at before update on public.knowledge_entries
  for each row execute function public.set_updated_at();

drop trigger if exists knowledge_corrections_set_updated_at on public.knowledge_corrections;
create trigger knowledge_corrections_set_updated_at before update on public.knowledge_corrections
  for each row execute function public.set_updated_at();

drop trigger if exists knowledge_transfers_set_updated_at on public.knowledge_transfers;
create trigger knowledge_transfers_set_updated_at before update on public.knowledge_transfers
  for each row execute function public.set_updated_at();

create or replace function public.knowledge_entries_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.workspace_id is distinct from old.workspace_id
       or new.created_by is distinct from old.created_by
       or new.kind is distinct from old.kind
       or new.claim_type is distinct from old.claim_type
       or new.version is distinct from old.version
       or new.supersedes_id is distinct from old.supersedes_id
       or new.transferred_from_id is distinct from old.transferred_from_id then
      raise exception 'the identity of a knowledge entry cannot be changed';
    end if;

    if old.status = 'retracted' and new.status <> 'retracted' then
      raise exception 'a retracted entry cannot be revived; record a new version';
    end if;

    -- Deleting an account nulls verified_by through the foreign key. That one
    -- change is allowed; the rest of a retracted or superseded version is not.
    if new.verified_by is null and old.verified_by is not null
       and new.statement is not distinct from old.statement
       and new.verification_status is not distinct from old.verification_status then
      return new;
    end if;

    if old.status in ('superseded', 'retracted')
       and new.statement is distinct from old.statement then
      raise exception 'a superseded or retracted version cannot be rewritten';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists knowledge_entries_guard_trigger on public.knowledge_entries;
create trigger knowledge_entries_guard_trigger before update on public.knowledge_entries
  for each row execute function public.knowledge_entries_guard();

create or replace function public.knowledge_evidence_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- A cascade from knowledge_entries (a retention purge, or a deleted
    -- workspace) removes the evidence with its entry. That is not the same as
    -- someone deleting a single recorded item to make a claim look better.
    if not exists (
      select 1 from public.knowledge_entries e where e.id = old.entry_id
    ) then
      return old;
    end if;
    raise exception 'recorded evidence cannot be deleted; retract the entry instead';
  end if;
  if new.added_by is null and old.added_by is not null
     and new.stance is not distinct from old.stance
     and new.evidence_kind is not distinct from old.evidence_kind
     and new.detail is not distinct from old.detail
     and new.source_kind is not distinct from old.source_kind
     and new.source_id is not distinct from old.source_id
     and new.observed_at is not distinct from old.observed_at then
    return new;
  end if;
  raise exception 'recorded evidence is append-only';
end;
$$;

drop trigger if exists knowledge_evidence_guard_trigger on public.knowledge_evidence;
create trigger knowledge_evidence_guard_trigger before update or delete
  on public.knowledge_evidence
  for each row execute function public.knowledge_evidence_guard();

-- ---------------------------------------------------------------------------
-- Source authorization
-- ---------------------------------------------------------------------------

-- True only when the caller may already read the record being linked. A link
-- never grants access, and personal records can only be linked by their owner.
create or replace function public.knowledge_source_allowed(
  p_workspace_id uuid,
  p_source_kind text,
  p_source_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if public.workspace_role(p_workspace_id) is null then
    return false;
  end if;

  if p_source_kind = 'user_note' then
    return p_source_id is null;
  end if;

  if p_source_id is null then
    return false;
  end if;

  if p_source_kind = 'experiment' then
    return exists (
      select 1 from public.experiments e
       where e.id = p_source_id and e.workspace_id = p_workspace_id
    );
  end if;

  if p_source_kind = 'experiment_review' then
    return exists (
      select 1
        from public.experiment_reviews r
        join public.experiments e on e.id = r.experiment_id
       where r.id = p_source_id and e.workspace_id = p_workspace_id
    );
  end if;

  if p_source_kind = 'orchestration_review' then
    return exists (
      select 1 from public.orchestration_reviews r
       where r.id = p_source_id and r.workspace_id = p_workspace_id
    );
  end if;

  if p_source_kind = 'mission' then
    return exists (
      select 1 from public.missions m
       where m.id = p_source_id and m.workspace_id = p_workspace_id
    );
  end if;

  if p_source_kind = 'outcome_review' then
    return exists (
      select 1 from public.outcome_reviews r
       where r.id = p_source_id and r.user_id = v_user
    );
  end if;

  if p_source_kind = 'learning_record' then
    return exists (
      select 1 from public.learning_records r
       where r.id = p_source_id and r.user_id = v_user
    );
  end if;

  if p_source_kind = 'goal' then
    return exists (
      select 1 from public.goals g
       where g.id = p_source_id and g.user_id = v_user
    );
  end if;

  if p_source_kind = 'project_model' then
    return exists (
      select 1 from public.app_projects p
       where p.id = p_source_id
         and p.user_id = v_user
         and (p.workspace_id is null or p.workspace_id = p_workspace_id)
    );
  end if;

  return false;
end;
$$;

revoke all on function public.knowledge_source_allowed(uuid, text, uuid) from public, anon;
grant execute on function public.knowledge_source_allowed(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Entry, source and evidence functions
-- ---------------------------------------------------------------------------

create or replace function public.knowledge_create_entry(
  p_workspace_id uuid,
  p_kind text,
  p_claim_type text,
  p_title text,
  p_statement text,
  p_domain text,
  p_applies_when text default '',
  p_limitations text default '',
  p_authorized_scope text default 'This workspace only; reuse elsewhere needs a transfer approval.',
  p_retention_note text default '',
  p_review_at date default null,
  p_delete_after date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
begin
  if public.workspace_role(p_workspace_id) is null then
    raise exception 'you are not a member of this workspace';
  end if;
  if p_kind not in ('claim', 'procedure') then
    raise exception 'choose claim or procedure';
  end if;
  if p_claim_type not in (
    'user_preference', 'project_fact', 'participant_opinion',
    'measured_observation', 'tested_procedure', 'hypothesis', 'ai_suggestion'
  ) then
    raise exception 'choose a recorded kind of statement';
  end if;
  if p_kind = 'procedure' and p_claim_type = 'project_fact' then
    raise exception 'a reusable procedure is not a project fact';
  end if;

  insert into public.knowledge_entries (
    workspace_id, created_by, owner_id, kind, claim_type, title, statement,
    domain, applies_when, limitations, authorized_scope, retention_note,
    review_at, delete_after
  ) values (
    p_workspace_id, v_user, v_user, p_kind, p_claim_type, btrim(p_title),
    btrim(p_statement), btrim(p_domain), coalesce(p_applies_when, ''),
    coalesce(p_limitations, ''), p_authorized_scope, coalesce(p_retention_note, ''),
    p_review_at, p_delete_after
  )
  returning id into v_id;

  insert into public.knowledge_events (workspace_id, entry_id, actor_id, kind, detail)
  values (p_workspace_id, v_id, v_user, 'entry_created', p_claim_type);

  return v_id;
end;
$$;

revoke all on function public.knowledge_create_entry(
  uuid, text, text, text, text, text, text, text, text, text, date, date
) from public, anon;
grant execute on function public.knowledge_create_entry(
  uuid, text, text, text, text, text, text, text, text, text, date, date
) to authenticated;

create or replace function public.knowledge_add_source(
  p_entry_id uuid,
  p_source_kind text,
  p_source_id uuid,
  p_label text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_entry public.knowledge_entries;
  v_id uuid;
begin
  select * into v_entry from public.knowledge_entries where id = p_entry_id;
  if v_entry.id is null then
    raise exception 'that knowledge entry does not exist';
  end if;
  if public.workspace_role(v_entry.workspace_id) is null then
    raise exception 'you are not a member of this workspace';
  end if;
  if v_entry.status <> 'active' then
    raise exception 'only the current version accepts new sources';
  end if;
  if p_source_kind = 'transfer' then
    raise exception 'a transfer source is recorded only by an approved transfer';
  end if;
  if not public.knowledge_source_allowed(v_entry.workspace_id, p_source_kind, p_source_id) then
    raise exception 'you cannot link that record here';
  end if;

  insert into public.knowledge_sources (
    workspace_id, entry_id, source_kind, source_id, label, linked_by
  ) values (
    v_entry.workspace_id, p_entry_id, p_source_kind, p_source_id, coalesce(p_label, ''), v_user
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
      from public.knowledge_sources
     where entry_id = p_entry_id
       and source_kind = p_source_kind
       and coalesce(source_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_source_id, '00000000-0000-0000-0000-000000000000'::uuid);
  else
    insert into public.knowledge_events (workspace_id, entry_id, actor_id, kind, detail)
    values (v_entry.workspace_id, p_entry_id, v_user, 'source_linked', p_source_kind);
  end if;

  return v_id;
end;
$$;

revoke all on function public.knowledge_add_source(uuid, text, uuid, text) from public, anon;
grant execute on function public.knowledge_add_source(uuid, text, uuid, text) to authenticated;

create or replace function public.knowledge_add_evidence(
  p_entry_id uuid,
  p_stance text,
  p_evidence_kind text,
  p_detail text,
  p_source_kind text default null,
  p_source_id uuid default null,
  p_observed_at date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_entry public.knowledge_entries;
  v_id uuid;
begin
  select * into v_entry from public.knowledge_entries where id = p_entry_id;
  if v_entry.id is null then
    raise exception 'that knowledge entry does not exist';
  end if;
  if public.workspace_role(v_entry.workspace_id) is null then
    raise exception 'you are not a member of this workspace';
  end if;
  if v_entry.status <> 'active' then
    raise exception 'only the current version accepts new evidence';
  end if;
  if p_stance not in ('supports', 'contradicts') then
    raise exception 'evidence either supports or contradicts';
  end if;
  if p_source_kind is not null
     and not public.knowledge_source_allowed(v_entry.workspace_id, p_source_kind, p_source_id) then
    raise exception 'you cannot link that record here';
  end if;

  insert into public.knowledge_evidence (
    workspace_id, entry_id, stance, evidence_kind, detail, source_kind, source_id,
    observed_at, added_by
  ) values (
    v_entry.workspace_id, p_entry_id, p_stance, p_evidence_kind, btrim(p_detail),
    p_source_kind, p_source_id, p_observed_at, v_user
  )
  returning id into v_id;

  insert into public.knowledge_events (workspace_id, entry_id, actor_id, kind, detail)
  values (v_entry.workspace_id, p_entry_id, v_user, 'evidence_recorded',
          p_stance || ':' || p_evidence_kind);

  return v_id;
end;
$$;

revoke all on function public.knowledge_add_evidence(uuid, text, text, text, text, uuid, date)
  from public, anon;
grant execute on function public.knowledge_add_evidence(uuid, text, text, text, text, uuid, date)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Verification, review and versions
-- ---------------------------------------------------------------------------

create or replace function public.knowledge_set_verification(
  p_entry_id uuid,
  p_status text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_role text;
  v_entry public.knowledge_entries;
  v_supporting integer;
  v_contradicting integer;
  v_sources integer;
begin
  select * into v_entry from public.knowledge_entries where id = p_entry_id for update;
  if v_entry.id is null then
    raise exception 'that knowledge entry does not exist';
  end if;

  v_role := public.workspace_role(v_entry.workspace_id);
  if v_role is null then
    raise exception 'you are not a member of this workspace';
  end if;
  if not (v_entry.owner_id = v_user or v_entry.created_by = v_user
          or v_role in ('owner', 'admin')) then
    raise exception 'only the entry owner or a workspace owner or admin can change verification';
  end if;
  if v_entry.status <> 'active' then
    raise exception 'only the current version can change status';
  end if;
  if p_status not in ('unverified', 'supported', 'contradicted') then
    raise exception 'choose unverified, supported or contradicted';
  end if;

  select count(*) filter (where stance = 'supports'),
         count(*) filter (where stance = 'contradicts')
    into v_supporting, v_contradicting
    from public.knowledge_evidence
   where entry_id = p_entry_id;

  if p_status = 'supported' then
    if v_entry.claim_type = 'ai_suggestion' then
      raise exception 'an AI suggestion is never promoted to verified knowledge; write the claim yourself as a new version';
    end if;
    if v_entry.claim_type = 'hypothesis' then
      raise exception 'a hypothesis is not supported by being restated; record the test and write the result as a measured observation or tested procedure';
    end if;
    if char_length(btrim(coalesce(p_note, ''))) < 10 then
      raise exception 'write the basis for this decision';
    end if;
    select count(*) into v_sources
      from public.knowledge_sources s
     where s.entry_id = p_entry_id;
    if v_supporting = 0 and v_sources = 0 then
      raise exception 'record at least one supporting item or source first';
    end if;
    update public.knowledge_entries
       set verification_status = 'supported',
           verification_note = btrim(p_note),
           verified_by = v_user,
           verified_at = now()
     where id = p_entry_id;
  elsif p_status = 'contradicted' then
    if char_length(btrim(coalesce(p_note, ''))) < 10 then
      raise exception 'write what contradicts it';
    end if;
    if v_contradicting = 0 then
      raise exception 'record the contradicting item first';
    end if;
    update public.knowledge_entries
       set verification_status = 'contradicted',
           verification_note = btrim(p_note),
           verified_by = v_user,
           verified_at = now()
     where id = p_entry_id;
  else
    update public.knowledge_entries
       set verification_status = 'unverified',
           verification_note = btrim(coalesce(p_note, '')),
           verified_by = null,
           verified_at = null
     where id = p_entry_id;
  end if;

  insert into public.knowledge_events (workspace_id, entry_id, actor_id, kind, detail)
  values (v_entry.workspace_id, p_entry_id, v_user, 'verification_changed', p_status);
end;
$$;

revoke all on function public.knowledge_set_verification(uuid, text, text) from public, anon;
grant execute on function public.knowledge_set_verification(uuid, text, text) to authenticated;

create or replace function public.knowledge_confirm_review(
  p_entry_id uuid,
  p_next_review_at date,
  p_note text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_entry public.knowledge_entries;
begin
  select * into v_entry from public.knowledge_entries where id = p_entry_id;
  if v_entry.id is null then
    raise exception 'that knowledge entry does not exist';
  end if;
  if public.workspace_role(v_entry.workspace_id) is null then
    raise exception 'you are not a member of this workspace';
  end if;
  if v_entry.status <> 'active' then
    raise exception 'only the current version can be reviewed';
  end if;

  update public.knowledge_entries
     set last_reviewed_at = now(),
         review_at = p_next_review_at
   where id = p_entry_id;

  insert into public.knowledge_events (workspace_id, entry_id, actor_id, kind, detail)
  values (v_entry.workspace_id, p_entry_id, v_user, 'reviewed', coalesce(p_note, ''));
end;
$$;

revoke all on function public.knowledge_confirm_review(uuid, date, text) from public, anon;
grant execute on function public.knowledge_confirm_review(uuid, date, text) to authenticated;

-- Creates the next version. The earlier wording, its evidence and its own
-- verification stay exactly as they were; the new version starts unverified.
create or replace function public.knowledge_supersede_entry(
  p_entry_id uuid,
  p_title text,
  p_statement text,
  p_limitations text,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_role text;
  v_old public.knowledge_entries;
  v_new uuid;
begin
  select * into v_old from public.knowledge_entries where id = p_entry_id for update;
  if v_old.id is null then
    raise exception 'that knowledge entry does not exist';
  end if;
  v_role := public.workspace_role(v_old.workspace_id);
  if v_role is null then
    raise exception 'you are not a member of this workspace';
  end if;
  if not (v_old.owner_id = v_user or v_old.created_by = v_user
          or v_role in ('owner', 'admin')) then
    raise exception 'only the entry owner or a workspace owner or admin can supersede it';
  end if;
  if v_old.status <> 'active' then
    raise exception 'only the current version can be superseded';
  end if;
  if char_length(btrim(coalesce(p_statement, ''))) < 15 then
    raise exception 'write the replacement wording';
  end if;

  insert into public.knowledge_entries (
    workspace_id, created_by, owner_id, kind, claim_type, title, statement, domain,
    applies_when, limitations, authorized_scope, provenance, review_at,
    last_reviewed_at, version, supersedes_id, retention_note, delete_after
  ) values (
    v_old.workspace_id, v_user, v_old.owner_id, v_old.kind, v_old.claim_type,
    btrim(coalesce(nullif(p_title, ''), v_old.title)), btrim(p_statement),
    v_old.domain, v_old.applies_when, coalesce(p_limitations, v_old.limitations),
    v_old.authorized_scope,
    btrim(v_old.provenance || ' Supersedes version ' || v_old.version || '.'),
    v_old.review_at, now(), v_old.version + 1, v_old.id, v_old.retention_note,
    v_old.delete_after
  )
  returning id into v_new;

  update public.knowledge_entries
     set status = 'superseded', superseded_by_id = v_new
   where id = p_entry_id;

  insert into public.knowledge_events (workspace_id, entry_id, actor_id, kind, detail)
  values (v_old.workspace_id, p_entry_id, v_user, 'superseded',
          'version ' || v_old.version || ' -> ' || (v_old.version + 1) || ': '
          || coalesce(p_note, ''));

  return v_new;
end;
$$;

revoke all on function public.knowledge_supersede_entry(uuid, text, text, text, text)
  from public, anon;
grant execute on function public.knowledge_supersede_entry(uuid, text, text, text, text)
  to authenticated;

-- Withdraws the entry and marks the decisions that were built on it.
create or replace function public.knowledge_retract_entry(
  p_entry_id uuid,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_role text;
  v_entry public.knowledge_entries;
  v_impacts integer;
begin
  select * into v_entry from public.knowledge_entries where id = p_entry_id for update;
  if v_entry.id is null then
    raise exception 'that knowledge entry does not exist';
  end if;
  v_role := public.workspace_role(v_entry.workspace_id);
  if v_role is null then
    raise exception 'you are not a member of this workspace';
  end if;
  if not (v_entry.owner_id = v_user or v_entry.created_by = v_user
          or v_role in ('owner', 'admin')) then
    raise exception 'only the entry owner or a workspace owner or admin can retract it';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'write why it is being withdrawn';
  end if;
  if v_entry.status = 'retracted' then
    return 0;
  end if;

  update public.knowledge_entries
     set status = 'retracted',
         verification_status = 'retracted',
         verification_note = btrim(p_reason),
         verified_by = v_user,
         verified_at = now()
   where id = p_entry_id;

  update public.knowledge_impacts
     set invalidated_at = now(), invalidated_reason = btrim(p_reason)
   where entry_id = p_entry_id and invalidated_at is null;
  get diagnostics v_impacts = row_count;

  insert into public.knowledge_events (workspace_id, entry_id, actor_id, kind, detail)
  values (v_entry.workspace_id, p_entry_id, v_user, 'retracted',
          btrim(p_reason) || ' (' || v_impacts || ' linked decision(s) marked invalid)');

  return v_impacts;
end;
$$;

revoke all on function public.knowledge_retract_entry(uuid, text) from public, anon;
grant execute on function public.knowledge_retract_entry(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Corrections
-- ---------------------------------------------------------------------------

create or replace function public.knowledge_record_correction(
  p_entry_id uuid,
  p_kind text,
  p_detail text,
  p_proposed_statement text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_entry public.knowledge_entries;
  v_id uuid;
begin
  select * into v_entry from public.knowledge_entries where id = p_entry_id;
  if v_entry.id is null then
    raise exception 'that knowledge entry does not exist';
  end if;
  if public.workspace_role(v_entry.workspace_id) is null then
    raise exception 'you are not a member of this workspace';
  end if;
  if p_kind not in ('correction', 'dispute') then
    raise exception 'choose correction or dispute';
  end if;
  if char_length(btrim(coalesce(p_detail, ''))) < 10 then
    raise exception 'explain what is wrong';
  end if;
  if p_kind = 'correction'
     and char_length(btrim(coalesce(p_proposed_statement, ''))) < 15 then
    raise exception 'a correction proposes the replacement wording';
  end if;

  insert into public.knowledge_corrections (
    workspace_id, entry_id, requested_by, kind, detail, proposed_statement
  ) values (
    v_entry.workspace_id, p_entry_id, v_user, p_kind, btrim(p_detail),
    coalesce(p_proposed_statement, '')
  )
  returning id into v_id;

  insert into public.knowledge_events (workspace_id, entry_id, actor_id, kind, detail)
  values (v_entry.workspace_id, p_entry_id, v_user, 'correction_' || p_kind, '');

  return v_id;
end;
$$;

revoke all on function public.knowledge_record_correction(uuid, text, text, text)
  from public, anon;
grant execute on function public.knowledge_record_correction(uuid, text, text, text)
  to authenticated;

create or replace function public.knowledge_decide_correction(
  p_correction_id uuid,
  p_accept boolean,
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_role text;
  v_correction public.knowledge_corrections;
  v_entry public.knowledge_entries;
  v_new uuid;
begin
  select * into v_correction from public.knowledge_corrections
   where id = p_correction_id for update;
  if v_correction.id is null then
    raise exception 'that correction does not exist';
  end if;
  select * into v_entry from public.knowledge_entries where id = v_correction.entry_id;
  v_role := public.workspace_role(v_correction.workspace_id);
  if v_role is null then
    raise exception 'you are not a member of this workspace';
  end if;
  if not (v_entry.owner_id = v_user or v_entry.created_by = v_user
          or v_role in ('owner', 'admin')) then
    raise exception 'only the entry owner or a workspace owner or admin can decide a correction';
  end if;
  if v_correction.status <> 'open' then
    raise exception 'this correction was already decided';
  end if;

  if not p_accept then
    update public.knowledge_corrections
       set status = 'rejected', decided_by = v_user, decided_at = now(),
           decision_note = coalesce(p_note, '')
     where id = p_correction_id;
    insert into public.knowledge_events (workspace_id, entry_id, actor_id, kind, detail)
    values (v_correction.workspace_id, v_correction.entry_id, v_user,
            'correction_rejected', coalesce(p_note, ''));
    return null;
  end if;

  if v_entry.status <> 'active' then
    raise exception 'that entry is no longer the current version';
  end if;

  if v_correction.kind = 'correction' then
    v_new := public.knowledge_supersede_entry(
      v_correction.entry_id,
      v_entry.title,
      v_correction.proposed_statement,
      v_entry.limitations,
      coalesce(nullif(btrim(p_note), ''), 'accepted correction')
    );
  else
    perform public.knowledge_retract_entry(
      v_correction.entry_id,
      coalesce(nullif(btrim(p_note), ''), 'upheld dispute')
    );
    v_new := null;
  end if;

  update public.knowledge_corrections
     set status = 'accepted', decided_by = v_user, decided_at = now(),
         decision_note = coalesce(p_note, '')
   where id = p_correction_id;

  insert into public.knowledge_events (workspace_id, entry_id, actor_id, kind, detail)
  values (v_correction.workspace_id, v_correction.entry_id, v_user,
          'correction_accepted', v_correction.kind);

  return v_new;
end;
$$;

revoke all on function public.knowledge_decide_correction(uuid, boolean, text)
  from public, anon;
grant execute on function public.knowledge_decide_correction(uuid, boolean, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Transfers between workspaces
-- ---------------------------------------------------------------------------

create or replace function public.knowledge_propose_transfer(
  p_entry_id uuid,
  p_target_workspace_id uuid,
  p_similarities text,
  p_differences text,
  p_evidence_summary text,
  p_assumptions_to_test text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_entry public.knowledge_entries;
  v_id uuid;
begin
  select * into v_entry from public.knowledge_entries where id = p_entry_id;
  if v_entry.id is null then
    raise exception 'that knowledge entry does not exist';
  end if;
  if public.workspace_role(v_entry.workspace_id) is null then
    raise exception 'you are not a member of the workspace that holds this entry';
  end if;
  if p_target_workspace_id = v_entry.workspace_id then
    raise exception 'choose a different workspace';
  end if;
  if not exists (select 1 from public.workspaces w where w.id = p_target_workspace_id) then
    raise exception 'that workspace does not exist';
  end if;
  if v_entry.status <> 'active' or v_entry.verification_status = 'retracted' then
    raise exception 'only a current, non-retracted entry can be proposed';
  end if;
  if char_length(btrim(coalesce(p_similarities, ''))) < 10
     or char_length(btrim(coalesce(p_differences, ''))) < 10
     or char_length(btrim(coalesce(p_assumptions_to_test, ''))) < 10 then
    raise exception 'describe the similarities, the differences and the assumption that needs a new test';
  end if;

  insert into public.knowledge_transfers (
    workspace_id, entry_id, source_workspace_id, target_workspace_id, requested_by,
    similarities, differences, evidence_summary, assumptions_to_test
  ) values (
    v_entry.workspace_id, p_entry_id, v_entry.workspace_id, p_target_workspace_id, v_user,
    btrim(p_similarities), btrim(p_differences),
    coalesce(p_evidence_summary, ''), btrim(p_assumptions_to_test)
  )
  returning id into v_id;

  insert into public.knowledge_events (workspace_id, entry_id, actor_id, kind, detail)
  values (v_entry.workspace_id, p_entry_id, v_user, 'transfer_proposed', p_target_workspace_id::text);

  return v_id;
end;
$$;

revoke all on function public.knowledge_propose_transfer(uuid, uuid, text, text, text, text)
  from public, anon;
grant execute on function public.knowledge_propose_transfer(uuid, uuid, text, text, text, text)
  to authenticated;

-- Approval happens in the target workspace. The statement, its conditions and
-- its limitations cross over; the evidence text, the people and the artifacts
-- stay where they were.
create or replace function public.knowledge_decide_transfer(
  p_transfer_id uuid,
  p_approve boolean,
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_role text;
  v_transfer public.knowledge_transfers;
  v_entry public.knowledge_entries;
  v_source_name text;
  v_entry_id uuid;
  v_supporting integer;
  v_contradicting integer;
  v_participant integer;
  v_limitations text;
begin
  select * into v_transfer from public.knowledge_transfers
   where id = p_transfer_id for update;
  if v_transfer.id is null then
    raise exception 'that transfer proposal does not exist';
  end if;
  v_role := public.workspace_role(v_transfer.target_workspace_id);
  if v_role not in ('owner', 'admin') then
    raise exception 'only an owner or admin of the target workspace can decide a transfer';
  end if;
  if v_transfer.status <> 'proposed' then
    raise exception 'this transfer was already decided';
  end if;

  if not p_approve then
    update public.knowledge_transfers
       set status = 'declined', decided_by = v_user, decided_at = now(),
           decision_note = coalesce(p_note, '')
     where id = p_transfer_id;
    insert into public.knowledge_events (workspace_id, entry_id, actor_id, kind, detail)
    values (v_transfer.target_workspace_id, v_transfer.entry_id, v_user,
            'transfer_declined', coalesce(p_note, ''));
    return null;
  end if;

  select * into v_entry from public.knowledge_entries where id = v_transfer.entry_id;
  if v_entry.id is null then
    raise exception 'the source entry no longer exists';
  end if;
  if v_entry.status <> 'active' or v_entry.verification_status = 'retracted' then
    raise exception 'the source entry is no longer valid';
  end if;

  select count(*) filter (where stance = 'supports'),
         count(*) filter (where stance = 'contradicts'),
         count(*) filter (where evidence_kind = 'participant_opinion')
    into v_supporting, v_contradicting, v_participant
    from public.knowledge_evidence
   where entry_id = v_transfer.entry_id;

  select w.name into v_source_name from public.workspaces w
   where w.id = v_transfer.source_workspace_id;

  v_limitations := btrim(v_entry.limitations)
    || case when btrim(v_entry.limitations) = '' then '' else E'\n\n' end
    || 'Verified in ' || coalesce(v_source_name, 'the source workspace')
    || ' only. The evidence itself stayed there: ' || v_supporting
    || ' supporting and ' || v_contradicting || ' contradicting item(s) in the source workspace.'
    || case when v_participant = 0 then ''
            else ' ' || v_participant
                 || ' came from participant feedback, which was not transferred.' end
    || E'\n\nNot yet tested here. Assumption to test: ' || v_transfer.assumptions_to_test;

  insert into public.knowledge_entries (
    workspace_id, created_by, owner_id, kind, claim_type, title, statement, domain,
    applies_when, limitations, authorized_scope, provenance, verification_status,
    verification_note, verified_by, verified_at, review_at, transferred_from_id,
    retention_note
  ) values (
    v_transfer.target_workspace_id, v_user, v_user, v_entry.kind, v_entry.claim_type,
    v_entry.title, v_entry.statement, v_entry.domain, v_entry.applies_when,
    v_limitations,
    'This workspace only. Reuse outside it needs its own transfer approval.',
    'Transferred from ' || coalesce(v_source_name, 'another workspace')
      || ' with approval. Source entry ' || v_entry.id::text || '.',
    v_entry.verification_status,
    'Verified in ' || coalesce(v_source_name, 'the source workspace')
      || '; not re-tested here.',
    v_user, now(), null, v_entry.id, v_entry.retention_note
  )
  returning id into v_entry_id;

  insert into public.knowledge_sources (
    workspace_id, entry_id, source_kind, source_id, label, linked_by
  ) values (
    v_transfer.target_workspace_id, v_entry_id, 'transfer', v_entry.id,
    'Transferred from ' || coalesce(v_source_name, 'another workspace'), v_user
  );

  update public.knowledge_transfers
     set status = 'approved', decided_by = v_user, decided_at = now(),
         decision_note = coalesce(p_note, ''), created_entry_id = v_entry_id
   where id = p_transfer_id;

  insert into public.knowledge_events (workspace_id, entry_id, actor_id, kind, detail)
  values (v_transfer.target_workspace_id, v_entry_id, v_user, 'transfer_approved',
          'from workspace ' || v_transfer.source_workspace_id::text);

  insert into public.knowledge_events (workspace_id, entry_id, actor_id, kind, detail)
  values (v_transfer.source_workspace_id, v_transfer.entry_id, v_user, 'transfer_approved',
          'to workspace ' || v_transfer.target_workspace_id::text);

  return v_entry_id;
end;
$$;

revoke all on function public.knowledge_decide_transfer(uuid, boolean, text)
  from public, anon;
grant execute on function public.knowledge_decide_transfer(uuid, boolean, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Impacts and retention
-- ---------------------------------------------------------------------------

create or replace function public.knowledge_mark_impact(
  p_entry_id uuid,
  p_target_kind text,
  p_target_id uuid,
  p_target_label text,
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_entry public.knowledge_entries;
  v_id uuid;
begin
  select * into v_entry from public.knowledge_entries where id = p_entry_id;
  if v_entry.id is null then
    raise exception 'that knowledge entry does not exist';
  end if;
  if public.workspace_role(v_entry.workspace_id) is null then
    raise exception 'you are not a member of this workspace';
  end if;
  if p_target_kind not in (
    'recommendation', 'contract_criterion', 'plan_task', 'improvement', 'app_change', 'other'
  ) then
    raise exception 'choose what was built on this entry';
  end if;

  insert into public.knowledge_impacts (
    workspace_id, entry_id, target_kind, target_id, target_label, note, created_by,
    invalidated_at, invalidated_reason
  ) values (
    v_entry.workspace_id, p_entry_id, p_target_kind, p_target_id, btrim(p_target_label),
    coalesce(p_note, ''), v_user,
    case when v_entry.status = 'retracted' or v_entry.verification_status = 'retracted'
         then now() else null end,
    case when v_entry.status = 'retracted' or v_entry.verification_status = 'retracted'
         then 'linked to an entry that is no longer valid' else null end
  )
  returning id into v_id;

  insert into public.knowledge_events (workspace_id, entry_id, actor_id, kind, detail)
  values (v_entry.workspace_id, p_entry_id, v_user, 'impact_linked', p_target_kind);

  return v_id;
end;
$$;

revoke all on function public.knowledge_mark_impact(uuid, text, uuid, text, text)
  from public, anon;
grant execute on function public.knowledge_mark_impact(uuid, text, uuid, text, text)
  to authenticated;

create or replace function public.knowledge_purge_expired(p_workspace_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_role text := public.workspace_role(p_workspace_id);
  v_count integer;
begin
  if v_role not in ('owner', 'admin') then
    raise exception 'only an owner or admin can purge entries past their retention date';
  end if;

  insert into public.knowledge_events (workspace_id, entry_id, actor_id, kind, detail)
  select p_workspace_id, null, v_user, 'retention_purge',
         'deleted ' || count(*) || ' entry(ies) past their retention date'
    from public.knowledge_entries
   where workspace_id = p_workspace_id and delete_after is not null
     and delete_after <= current_date;

  delete from public.knowledge_entries
   where workspace_id = p_workspace_id and delete_after is not null
     and delete_after <= current_date;
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

revoke all on function public.knowledge_purge_expired(uuid) from public, anon;
grant execute on function public.knowledge_purge_expired(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Retrieval
-- ---------------------------------------------------------------------------

-- Security invoker on purpose: RLS still applies, and the membership check is
-- repeated so an unauthorized workspace returns nothing rather than an error.
create or replace function public.knowledge_retrieve(
  p_workspace_id uuid,
  p_query text default '',
  p_domain text default ''
)
returns setof public.knowledge_entries
language sql
stable
set search_path = ''
as $$
  select e.*
    from public.knowledge_entries e
   where e.workspace_id = p_workspace_id
     and public.workspace_role(p_workspace_id) is not null
     and e.status = 'active'
     and e.verification_status <> 'retracted'
     and (p_domain = '' or e.domain = p_domain)
     and (
       coalesce(p_query, '') = ''
       or e.title ilike '%' || p_query || '%'
       or e.statement ilike '%' || p_query || '%'
       or e.domain ilike '%' || p_query || '%'
     )
   order by e.updated_at desc
   limit 100;
$$;

revoke all on function public.knowledge_retrieve(uuid, text, text) from public, anon;
grant execute on function public.knowledge_retrieve(uuid, text, text) to authenticated;
grant select on public.knowledge_entries to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.knowledge_entries enable row level security;
alter table public.knowledge_sources enable row level security;
alter table public.knowledge_evidence enable row level security;
alter table public.knowledge_impacts enable row level security;
alter table public.knowledge_corrections enable row level security;
alter table public.knowledge_transfers enable row level security;
alter table public.knowledge_events enable row level security;

drop policy if exists "members read knowledge entries" on public.knowledge_entries;
create policy "members read knowledge entries" on public.knowledge_entries
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members read knowledge sources" on public.knowledge_sources;
create policy "members read knowledge sources" on public.knowledge_sources
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members read knowledge evidence" on public.knowledge_evidence;
create policy "members read knowledge evidence" on public.knowledge_evidence
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members read knowledge impacts" on public.knowledge_impacts;
create policy "members read knowledge impacts" on public.knowledge_impacts
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members read knowledge corrections" on public.knowledge_corrections;
create policy "members read knowledge corrections" on public.knowledge_corrections
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

-- A transfer request is visible to the source workspace and to the target
-- workspace only; both are the point of the proposal.
drop policy if exists "members read knowledge transfers" on public.knowledge_transfers;
create policy "members read knowledge transfers" on public.knowledge_transfers
  for select to authenticated
  using (
    public.workspace_role(source_workspace_id) is not null
    or public.workspace_role(target_workspace_id) is not null
  );

drop policy if exists "members read knowledge events" on public.knowledge_events;
create policy "members read knowledge events" on public.knowledge_events
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

-- Every write goes through a security-definer function above, so the client
-- roles get read access only. Supabase grants ALL by default on new tables,
-- which is why the write privileges are revoked explicitly as well.
grant select on public.knowledge_entries to authenticated;
grant select on public.knowledge_sources to authenticated;
grant select on public.knowledge_evidence to authenticated;
grant select on public.knowledge_impacts to authenticated;
grant select on public.knowledge_corrections to authenticated;
grant select on public.knowledge_transfers to authenticated;
grant select on public.knowledge_events to authenticated;

revoke insert, update, delete, truncate, trigger, references, maintain
  on public.knowledge_entries from authenticated;
revoke insert, update, delete, truncate, trigger, references, maintain
  on public.knowledge_sources from authenticated;
revoke insert, update, delete, truncate, trigger, references, maintain
  on public.knowledge_evidence from authenticated;
revoke insert, update, delete, truncate, trigger, references, maintain
  on public.knowledge_impacts from authenticated;
revoke insert, update, delete, truncate, trigger, references, maintain
  on public.knowledge_corrections from authenticated;
revoke insert, update, delete, truncate, trigger, references, maintain
  on public.knowledge_transfers from authenticated;
revoke insert, update, delete, truncate, trigger, references, maintain
  on public.knowledge_events from authenticated;

revoke all on public.knowledge_entries from anon;
revoke all on public.knowledge_sources from anon;
revoke all on public.knowledge_evidence from anon;
revoke all on public.knowledge_impacts from anon;
revoke all on public.knowledge_corrections from anon;
revoke all on public.knowledge_transfers from anon;
revoke all on public.knowledge_events from anon;
