-- GET TO IT — Phase 40, second half: a promotion names the deployment that ships it.
--
-- Phase 40 recorded a promotion as a free-text reference. That is not enough to
-- act on: anyone can type a string. A promotion now points at a real
-- `app_deployments` row — the deployment approval flow built in Phase 24 — and
-- may only be recorded once that deployment has actually been approved with its
-- typed confirmation. This phase still does not deploy anything itself; it
-- hands the candidate to the flow that does.

alter table public.improvement_candidates
  add column if not exists deployment_id uuid
    references public.app_deployments (id) on delete set null;

comment on column public.improvement_candidates.deployment_id is
  'The approved deployment that ships this candidate. Promotion is refused without one.';

create unique index if not exists improvement_candidates_deployment_idx
  on public.improvement_candidates (deployment_id)
  where deployment_id is not null;

alter table public.improvement_candidates
  drop constraint if exists improvement_candidates_promoted_needs_deployment;
alter table public.improvement_candidates
  add constraint improvement_candidates_promoted_needs_deployment
  check (status <> 'promoted' or deployment_id is not null);

-- A promotion rides on a deployment that belongs to the same person and project
-- and has already been approved. Nothing here approves a deployment.
create or replace function public.improvement_candidates_deployment_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deployment public.app_deployments;
begin
  if tg_op = 'UPDATE' and old.status = 'promoted' and new.deployment_id is distinct from old.deployment_id then
    raise exception 'a promotion cannot be pointed at a different deployment' using errcode = '42501';
  end if;

  if new.status = 'promoted' then
    if new.deployment_id is null then
      raise exception 'a promotion has to name the deployment that ships it' using errcode = '42501';
    end if;

    select * into v_deployment from public.app_deployments where id = new.deployment_id;
    if not found then
      raise exception 'that deployment does not exist' using errcode = '23503';
    end if;
    if v_deployment.user_id <> new.user_id then
      raise exception 'that deployment belongs to someone else' using errcode = '42501';
    end if;
    if new.project_id is null or v_deployment.project_id <> new.project_id then
      raise exception 'that deployment is for a different project' using errcode = '42501';
    end if;
    if v_deployment.approval_at is null
       or v_deployment.status in ('draft', 'checks_ready', 'failed', 'partial_failure') then
      raise exception 'the deployment has not been approved; approve the exact plan first'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists improvement_candidates_deployment_guard_trigger on public.improvement_candidates;
create trigger improvement_candidates_deployment_guard_trigger
  before update on public.improvement_candidates
  for each row execute function public.improvement_candidates_deployment_guard();

-- Replace the free-text promotion with the deployment-bound one.
drop function if exists public.improvement_candidate_promote(uuid, text, text);

create or replace function public.improvement_candidate_promote(
  p_id uuid,
  p_deployment_id uuid,
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
  v_deployment public.app_deployments;
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
  if v_row.project_id is null then
    return jsonb_build_object('ok', false, 'code', 'project-required');
  end if;
  if p_deployment_id is null then
    return jsonb_build_object('ok', false, 'code', 'deployment-required');
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 20 then
    return jsonb_build_object('ok', false, 'code', 'note-required');
  end if;

  select * into v_deployment from public.app_deployments where id = p_deployment_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'deployment-not-found');
  end if;
  if v_deployment.user_id <> v_row.user_id or v_deployment.project_id <> v_row.project_id then
    return jsonb_build_object('ok', false, 'code', 'deployment-mismatch');
  end if;
  if v_deployment.approval_at is null
     or v_deployment.status in ('draft', 'checks_ready', 'failed', 'partial_failure') then
    return jsonb_build_object('ok', false, 'code', 'deployment-not-approved');
  end if;

  update public.improvement_candidates
     set status = 'promoted',
         deployment_id = p_deployment_id,
         promotion_approved_at = now(),
         promotion_approved_by = v_user,
         promotion_ref = left('deployment:' || p_deployment_id::text, 200),
         promoted_at = now(),
         review_note = left(p_note, 1000)
   where id = p_id;

  return jsonb_build_object(
    'ok', true,
    'status', 'promoted',
    'deployment_id', p_deployment_id,
    'deployment_status', v_deployment.status
  );
end;
$$;

revoke all on function public.improvement_candidate_promote(uuid, uuid, text) from public, anon;
grant execute on function public.improvement_candidate_promote(uuid, uuid, text) to authenticated;
