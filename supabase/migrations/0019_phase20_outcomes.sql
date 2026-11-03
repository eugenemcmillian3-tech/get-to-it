-- GET TO IT — Phase 20 schema
-- Outcomes and lessons over earlier expectations.
--
-- Ground rules encoded here:
--   * An expectation snapshot is captured once and is immutable. A trigger
--     refuses to change it, so no later observation can rewrite the original.
--     Observations are append-only: there is no update or delete policy.
--   * Four evaluation fields are separate columns, so "action completed" can
--     never be stored as "desired result occurred".
--   * Forecasts keep the stated probability; a trigger refuses to rewrite a
--     forecast after it is recorded, and a resolved forecast cannot be changed.
--     No aggregate score column exists, and none is computed across reviews.
--   * Improvement proposals need recorded consent and a scoped test set. An
--     approved proposal creates a version row; nothing changes shipped prompts,
--     permissions or safety rules at runtime, and no content is used for training.
--   * Owner-only under RLS. There are no shared or public outcome records.

-- A review keeps the captured expectation, the source it refers to, and the
-- four separated evaluation answers.
create table if not exists public.outcome_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_kind text not null check (source_kind in ('goal', 'future_path', 'review')),
  source_id uuid not null,
  title text not null check (char_length(btrim(title)) between 3 and 200),
  expectation_snapshot jsonb not null,
  review_at date,
  status text not null default 'open' check (status in ('open', 'completed')),
  action_completed text check (action_completed is null or action_completed in ('yes', 'partly', 'no', 'unknown')),
  desired_result text check (desired_result is null or desired_result in ('yes', 'partly', 'no', 'unknown')),
  expectation_accuracy text check (expectation_accuracy is null or expectation_accuracy in ('yes', 'partly', 'no', 'unknown')),
  external_conditions text check (external_conditions is null or external_conditions in ('changed', 'unchanged', 'unclear')),
  causation_note text check (causation_note is null or char_length(causation_note) <= 2000),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source_kind, source_id)
);

comment on table public.outcome_reviews is
  'One review of what was expected. The snapshot is immutable and observations are appended, never merged.';
comment on column public.outcome_reviews.expectation_snapshot is
  'Captured at creation and protected by a trigger. Never rewritten after the fact.';

create index if not exists outcome_reviews_user_idx
  on public.outcome_reviews (user_id, created_at desc);

drop trigger if exists outcome_reviews_set_updated_at on public.outcome_reviews;
create trigger outcome_reviews_set_updated_at before update on public.outcome_reviews
  for each row execute function public.set_updated_at();

create or replace function public.outcome_reviews_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.expectation_snapshot is distinct from old.expectation_snapshot then
    raise exception 'the expectation snapshot cannot be changed';
  end if;
  if new.source_kind is distinct from old.source_kind or new.source_id is distinct from old.source_id then
    raise exception 'the reviewed source cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists outcome_reviews_snapshot_guard on public.outcome_reviews;
create trigger outcome_reviews_snapshot_guard before update on public.outcome_reviews
  for each row execute function public.outcome_reviews_guard();

create table if not exists public.outcome_observations (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.outcome_reviews (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('observation', 'assumption', 'surprise', 'evidence', 'lesson', 'next_action')),
  text text not null check (char_length(btrim(text)) between 5 and 2000),
  verdict text check (verdict is null or verdict in ('held', 'partly', 'failed', 'unknown')),
  causation_note text check (causation_note is null or char_length(causation_note) <= 2000),
  created_at timestamptz not null default now(),
  check (kind <> 'assumption' or verdict is not null)
);

comment on table public.outcome_observations is
  'Append-only observations. No update or delete policy exists, so earlier notes cannot be rewritten.';

create index if not exists outcome_observations_review_idx
  on public.outcome_observations (review_id, created_at);

create table if not exists public.outcome_forecasts (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.outcome_reviews (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  statement text not null check (char_length(btrim(statement)) between 5 and 300),
  probability integer not null check (probability between 1 and 99),
  resolution text not null default 'pending' check (resolution in ('pending', 'occurred', 'did_not_occur')),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.outcome_forecasts is
  'A self-recorded numerical forecast. The Brier score is explained in the app; no combined score is stored.';

create index if not exists outcome_forecasts_review_idx
  on public.outcome_forecasts (review_id, created_at);

create or replace function public.outcome_forecasts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.statement is distinct from old.statement or new.probability is distinct from old.probability then
    raise exception 'a recorded forecast cannot be rewritten';
  end if;
  if old.resolution <> 'pending' and new.resolution is distinct from old.resolution then
    raise exception 'a resolved forecast cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists outcome_forecasts_guard on public.outcome_forecasts;
create trigger outcome_forecasts_guard before update on public.outcome_forecasts
  for each row execute function public.outcome_forecasts_guard();

create table if not exists public.improvement_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  area text not null check (area in ('planning_prompt', 'template_structure', 'clarification_questions', 'review_timing')),
  title text not null check (char_length(btrim(title)) between 5 and 160),
  rationale text not null check (char_length(btrim(rationale)) between 10 and 2000),
  change_text text not null check (char_length(btrim(change_text)) between 10 and 3000),
  consent_confirmed boolean not null default false,
  test_scope text not null default '' check (char_length(test_scope) <= 500),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'rolled_back')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not consent_confirmed or char_length(btrim(test_scope)) between 10 and 500)
);

comment on table public.improvement_proposals is
  'A proposed change to prompts, templates, questions or review timing. A record for a person to approve; never applied at runtime.';

create index if not exists improvement_proposals_user_idx
  on public.improvement_proposals (user_id, created_at desc);

drop trigger if exists improvement_proposals_set_updated_at on public.improvement_proposals;
create trigger improvement_proposals_set_updated_at before update on public.improvement_proposals
  for each row execute function public.set_updated_at();

create table if not exists public.improvement_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  proposal_id uuid references public.improvement_proposals (id) on delete set null,
  area text not null check (area in ('planning_prompt', 'template_structure', 'clarification_questions', 'review_timing')),
  version integer not null check (version >= 1),
  content text not null check (char_length(btrim(content)) between 10 and 3000),
  status text not null default 'active' check (status in ('active', 'superseded', 'rolled_back')),
  created_at timestamptz not null default now(),
  rolled_back_at timestamptz,
  unique (user_id, area, version)
);

comment on table public.improvement_versions is
  'Approved change records, versioned per area. Rollback retires the active record and restores the previous one.';

create unique index if not exists improvement_versions_one_active
  on public.improvement_versions (user_id, area)
  where status = 'active';

create index if not exists improvement_versions_user_idx
  on public.improvement_versions (user_id, area, version desc);

alter table public.outcome_reviews enable row level security;
alter table public.outcome_observations enable row level security;
alter table public.outcome_forecasts enable row level security;
alter table public.improvement_proposals enable row level security;
alter table public.improvement_versions enable row level security;

drop policy if exists "people read their own outcome reviews" on public.outcome_reviews;
create policy "people read their own outcome reviews" on public.outcome_reviews
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "people create their own outcome reviews" on public.outcome_reviews;
create policy "people create their own outcome reviews" on public.outcome_reviews
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "people update their own outcome reviews" on public.outcome_reviews;
create policy "people update their own outcome reviews" on public.outcome_reviews
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "people delete their own outcome reviews" on public.outcome_reviews;
create policy "people delete their own outcome reviews" on public.outcome_reviews
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "people read their own observations" on public.outcome_observations;
create policy "people read their own observations" on public.outcome_observations
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "people append their own observations" on public.outcome_observations;
create policy "people append their own observations" on public.outcome_observations
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.outcome_reviews r
       where r.id = review_id and r.user_id = (select auth.uid())
    )
  );

drop policy if exists "people read their own forecasts" on public.outcome_forecasts;
create policy "people read their own forecasts" on public.outcome_forecasts
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "people record their own forecasts" on public.outcome_forecasts;
create policy "people record their own forecasts" on public.outcome_forecasts
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.outcome_reviews r
       where r.id = review_id and r.user_id = (select auth.uid())
    )
  );

drop policy if exists "people resolve their own forecasts" on public.outcome_forecasts;
create policy "people resolve their own forecasts" on public.outcome_forecasts
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "people read their own improvement proposals" on public.improvement_proposals;
create policy "people read their own improvement proposals" on public.improvement_proposals
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "people create their own improvement proposals" on public.improvement_proposals;
create policy "people create their own improvement proposals" on public.improvement_proposals
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "people update their own improvement proposals" on public.improvement_proposals;
create policy "people update their own improvement proposals" on public.improvement_proposals
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "people read their own improvement versions" on public.improvement_versions;
create policy "people read their own improvement versions" on public.improvement_versions
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "people record their own improvement versions" on public.improvement_versions;
create policy "people record their own improvement versions" on public.improvement_versions
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "people update their own improvement versions" on public.improvement_versions;
create policy "people update their own improvement versions" on public.improvement_versions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.outcome_reviews to authenticated;
grant select, insert on public.outcome_observations to authenticated;
grant select, insert, update on public.outcome_forecasts to authenticated;
grant select, insert, update on public.improvement_proposals to authenticated;
grant select, insert, update on public.improvement_versions to authenticated;

revoke all on public.outcome_reviews from anon;
revoke all on public.outcome_observations from anon;
revoke all on public.outcome_forecasts from anon;
revoke all on public.improvement_proposals from anon;
revoke all on public.improvement_versions from anon;
