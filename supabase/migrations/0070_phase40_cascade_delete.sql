-- GET TO IT — Phase 40: let an evaluation disappear with its candidate.
--
-- The evaluation guard refused every DELETE, which is right for a client trying
-- to erase a result and wrong for a cascading delete: removing a workspace, a
-- candidate or an account deletes the evaluation as part of the parent row. That
-- made deleting a workspace that held an evaluated candidate fail outright.
--
-- A delete is now allowed only when its candidate is already gone, which is what
-- a cascade looks like. A direct delete against a live candidate is still
-- refused, and UPDATE stays refused outright.

create or replace function public.improvement_candidate_evaluations_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate public.improvement_candidates;
  v_parent_exists boolean;
begin
  if tg_op = 'UPDATE' then
    raise exception 'an evaluation is a record of what happened; run a new one'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    select exists (
      select 1 from public.improvement_candidates where id = old.candidate_id
    ) into v_parent_exists;
    if v_parent_exists then
      raise exception 'an evaluation is a record of what happened; run a new one'
        using errcode = '42501';
    end if;
    return old;
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
