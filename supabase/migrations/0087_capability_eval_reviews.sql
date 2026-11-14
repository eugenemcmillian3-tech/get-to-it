-- GET TO IT — capability evaluation independent review
--
-- Ground rules encoded here:
--   * The evaluation owner requests a review of one measured version from a
--     different active member of the workspace the experiment belongs to.
--   * The reviewer reads a security-definer brief: counts, costs, latency and
--     failure categories for that version. It never returns answer keys,
--     submissions or scoring detail.
--   * Only the named reviewer can complete or decline, and only from the
--     requested state. The owner cannot complete their own review.
--   * A completed review records findings and limitations; a declined review
--     leaves room for a later request.
--   * A review is evidence about an evaluation. It grants no permission, runs
--     no task and changes no score.

create table if not exists public.capability_eval_reviews (
  id uuid primary key default gen_random_uuid(),
  eval_id uuid not null references public.capability_evals (id) on delete cascade,
  version_id uuid not null references public.capability_eval_versions (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete cascade,
  reviewer_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'requested'
    check (status in ('requested', 'completed', 'declined')),
  findings text check (findings is null or char_length(findings) <= 4000),
  limitations text check (limitations is null or char_length(limitations) <= 2000),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (reviewer_id <> requested_by),
  check (
    status <> 'completed'
    or (
      findings is not null
      and char_length(btrim(findings)) between 20 and 4000
      and limitations is not null
      and char_length(btrim(limitations)) between 10 and 2000
      and reviewed_at is not null
    )
  )
);

comment on table public.capability_eval_reviews is
  'One person outside the evaluation requesting and recording an independent review of a measured version. It is evidence, not a permission.';

create unique index if not exists capability_eval_reviews_version_idx
  on public.capability_eval_reviews (version_id)
  where status <> 'declined';

create index if not exists capability_eval_reviews_eval_idx
  on public.capability_eval_reviews (eval_id, created_at desc);
create index if not exists capability_eval_reviews_reviewer_idx
  on public.capability_eval_reviews (reviewer_id, status, created_at desc);

drop trigger if exists capability_eval_reviews_set_updated_at on public.capability_eval_reviews;
create trigger capability_eval_reviews_set_updated_at before update on public.capability_eval_reviews
  for each row execute function public.set_updated_at();

create or replace function public.capability_eval_reviews_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_eval public.capability_evals;
  v_version public.capability_eval_versions;
  v_workspace uuid;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'requested' then
      raise exception 'a review starts as requested';
    end if;

    select * into v_version from public.capability_eval_versions v where v.id = new.version_id;
    if not found then
      raise exception 'the version does not exist';
    end if;
    if v_version.eval_id is distinct from new.eval_id then
      raise exception 'the version does not belong to this evaluation';
    end if;

    select * into v_eval from public.capability_evals e where e.id = new.eval_id;
    if not found then
      raise exception 'the evaluation does not exist';
    end if;
    if v_eval.user_id is distinct from new.requested_by then
      raise exception 'only the evaluation owner can request a review';
    end if;
    if v_eval.linked_experiment_id is null then
      raise exception 'link the evaluation to an experiment before requesting a review';
    end if;

    select e.workspace_id into v_workspace
      from public.experiments e
     where e.id = v_eval.linked_experiment_id;
    if v_workspace is null or v_workspace is distinct from new.workspace_id then
      raise exception 'the review belongs to the experiment workspace';
    end if;

    if not exists (
      select 1 from public.workspace_members m
       where m.workspace_id = new.workspace_id
         and m.user_id = new.requested_by
         and m.status = 'active'
    ) then
      raise exception 'the requester is not an active workspace member';
    end if;

    if not exists (
      select 1 from public.workspace_members m
       where m.workspace_id = new.workspace_id
         and m.user_id = new.reviewer_id
         and m.status = 'active'
    ) then
      raise exception 'only an active workspace member can review this evaluation';
    end if;

    if new.reviewer_id = new.requested_by then
      raise exception 'the evaluation owner cannot independently review it';
    end if;

    return new;
  end if;

  -- Updates are the reviewer's decision only.
  if auth.uid() is distinct from old.reviewer_id then
    raise exception 'only the named reviewer can decide this review';
  end if;
  if new.eval_id is distinct from old.eval_id
     or new.version_id is distinct from old.version_id
     or new.workspace_id is distinct from old.workspace_id
     or new.requested_by is distinct from old.requested_by
     or new.reviewer_id is distinct from old.reviewer_id then
    raise exception 'the review request cannot be reassigned';
  end if;
  if old.status <> 'requested' then
    raise exception 'a decided review cannot be changed';
  end if;
  if new.status not in ('completed', 'declined') then
    raise exception 'a requested review can only be completed or declined';
  end if;
  if new.status = 'completed' then
    if new.findings is null or char_length(btrim(new.findings)) < 20 then
      raise exception 'record findings of at least 20 characters';
    end if;
    if new.limitations is null or char_length(btrim(new.limitations)) < 10 then
      raise exception 'record the limitations of the review';
    end if;
  end if;
  new.reviewed_at := now();
  return new;
end;
$$;

drop trigger if exists capability_eval_reviews_guard on public.capability_eval_reviews;
create trigger capability_eval_reviews_guard before insert or update on public.capability_eval_reviews
  for each row execute function public.capability_eval_reviews_guard();

alter table public.capability_eval_reviews enable row level security;

drop policy if exists "owners and reviewers read capability reviews" on public.capability_eval_reviews;
create policy "owners and reviewers read capability reviews" on public.capability_eval_reviews
  for select to authenticated
  using (
    requested_by = (select auth.uid())
    or reviewer_id = (select auth.uid())
  );

drop policy if exists "owners request capability reviews" on public.capability_eval_reviews;
create policy "owners request capability reviews" on public.capability_eval_reviews
  for insert to authenticated
  with check (requested_by = (select auth.uid()));

drop policy if exists "reviewers decide capability reviews" on public.capability_eval_reviews;
create policy "reviewers decide capability reviews" on public.capability_eval_reviews
  for update to authenticated
  using (reviewer_id = (select auth.uid()) and status = 'requested')
  with check (reviewer_id = (select auth.uid()));

revoke all on public.capability_eval_reviews from anon;

-- The brief is a summary of recorded evidence, never key or submission content.
create or replace function public.capability_eval_review_brief(p_review_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_me uuid := auth.uid();
  v_review public.capability_eval_reviews;
  v_eval public.capability_evals;
  v_version public.capability_eval_versions;
  v_experiment public.experiments;
  v_totals jsonb;
  v_splits jsonb;
  v_domains jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_review from public.capability_eval_reviews r where r.id = p_review_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;
  if v_me not in (v_review.reviewer_id, v_review.requested_by) then
    return jsonb_build_object('ok', false, 'code', 'not-allowed');
  end if;

  select * into v_eval from public.capability_evals e where e.id = v_review.eval_id;
  select * into v_version from public.capability_eval_versions v where v.id = v_review.version_id;
  select * into v_experiment from public.experiments e where e.id = v_eval.linked_experiment_id;

  select jsonb_build_object(
    'runs', count(*),
    'verified', count(*) filter (where verified_success),
    'partial', count(*) filter (where outcome = 'partial_success'),
    'failed', count(*) filter (where outcome = 'failed'),
    'errored', count(*) filter (where outcome = 'errored'),
    'contaminated', count(*) filter (where contaminated),
    'unsupported_claims', coalesce(sum(unsupported_claims), 0),
    'permission_violations', coalesce(sum(permission_violations), 0),
    'human_interventions', coalesce(sum(human_interventions), 0),
    'average_cost_cents', round(coalesce(avg(cost_cents), 0)::numeric, 2),
    'average_latency_ms', round(coalesce(avg(latency_ms), 0)::numeric, 2)
  )
  into v_totals
  from public.capability_eval_runs
  where version_id = v_review.version_id;

  select coalesce(
    jsonb_agg(entry order by entry->>'split'),
    '[]'::jsonb
  )
  into v_splits
  from (
    select jsonb_build_object(
      'split', split,
      'trials', count(*),
      'verified', count(*) filter (where verified_success),
      'contaminated', count(*) filter (where contaminated)
    ) as entry
    from public.capability_eval_runs
    where version_id = v_review.version_id
    group by split
  ) rows;

  select coalesce(
    jsonb_agg(entry order by entry->>'domain'),
    '[]'::jsonb
  )
  into v_domains
  from (
    select jsonb_build_object(
      'domain', r.domain,
      'trials', count(*),
      'verified', count(*) filter (where r.verified_success),
      'contaminated', count(*) filter (where r.contaminated),
      'failure_category', (
        select f.failure_category
        from public.capability_eval_runs f
        where f.version_id = v_review.version_id
          and f.domain = r.domain
          and not f.verified_success
          and f.failure_category is not null
        group by f.failure_category
        order by count(*) desc
        limit 1
      )
    ) as entry
    from public.capability_eval_runs r
    where r.version_id = v_review.version_id
    group by r.domain
  ) rows;

  return jsonb_build_object(
    'ok', true,
    'review', jsonb_build_object(
      'id', v_review.id,
      'status', v_review.status,
      'findings', v_review.findings,
      'limitations', v_review.limitations,
      'reviewed_at', v_review.reviewed_at,
      'requested_by', v_review.requested_by,
      'reviewer_id', v_review.reviewer_id
    ),
    'evaluation', jsonb_build_object(
      'id', v_eval.id,
      'name', v_eval.name,
      'description', v_eval.description,
      'dataset_version', v_eval.dataset_version,
      'experiment_question', v_experiment.question
    ),
    'version', jsonb_build_object(
      'id', v_version.id,
      'label', v_version.label,
      'number', v_version.version,
      'baseline_kind', v_version.baseline_kind,
      'model_version', v_version.model_version,
      'orchestration_version', v_version.orchestration_version,
      'prompt_version', v_version.prompt_version,
      'dataset_version', v_version.dataset_version,
      'human_assistance', v_version.human_assistance,
      'autonomy_permission', v_version.autonomy_permission
    ),
    'totals', v_totals,
    'splits', v_splits,
    'domains', v_domains
  );
end;
$$;

revoke all on function public.capability_eval_review_brief(uuid) from public;
grant execute on function public.capability_eval_review_brief(uuid) to authenticated;
