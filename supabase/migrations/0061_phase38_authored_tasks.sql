-- GET TO IT — Phase 38 follow-up
-- A live model trial must be graded on an answer the model never sees.
--
-- The seeded tasks are graded by matching named elements, and those names are
-- the verbs of the task prompt: a model asked what it did can repeat them and
-- score a pass for nothing. Tasks authored here carry a problem statement in
-- the prompt and an expected value only in the answer key, so a submission is
-- graded on a number the model had to compute.
--
-- Scoring returns counts and a failure category, never the expected value.

create or replace function public.capability_eval_seed_authored_key(
  p_task_id uuid,
  p_expected numeric,
  p_tolerance numeric default 0
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.capability_eval_tasks;
  v_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication is required';
  end if;

  select * into v_task from public.capability_eval_tasks where id = p_task_id;
  if v_task.id is null then
    raise exception 'unknown evaluation task';
  end if;
  select user_id into v_owner from public.capability_evals where id = v_task.eval_id;
  if v_owner is null or v_owner <> auth.uid() then
    raise exception 'unknown evaluation task';
  end if;

  if p_expected is null then
    raise exception 'an authored task needs an expected answer';
  end if;
  if p_tolerance is null or p_tolerance < 0 then
    raise exception 'an answer tolerance cannot be negative';
  end if;
  if exists (select 1 from public.capability_eval_answer_keys where task_id = p_task_id) then
    raise exception 'this task already has an answer key';
  end if;

  insert into public.capability_eval_answer_keys (task_id, eval_id, key)
  values (
    p_task_id,
    v_task.eval_id,
    jsonb_build_object('expected', p_expected, 'tolerance', p_tolerance)
  );
end;
$$;

comment on function public.capability_eval_seed_authored_key(uuid, numeric, numeric) is
  'Stores the expected answer for an authored task. The owner may write it once and can never read it back.';

revoke all on function public.capability_eval_seed_authored_key(uuid, numeric, numeric) from public, anon;
grant execute on function public.capability_eval_seed_authored_key(uuid, numeric, numeric) to authenticated;

create or replace function public.capability_eval_score_answer(
  p_task_id uuid,
  p_answer jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.capability_eval_tasks;
  v_eval public.capability_evals;
  v_key jsonb;
  v_expected numeric;
  v_tolerance numeric;
  v_answer numeric;
  v_ok boolean := false;
  v_readable boolean := false;
begin
  if auth.uid() is null then
    raise exception 'authentication is required';
  end if;

  select * into v_task from public.capability_eval_tasks where id = p_task_id;
  if v_task.id is null then
    raise exception 'unknown evaluation task';
  end if;
  select * into v_eval from public.capability_evals where id = v_task.eval_id;
  if v_eval.user_id is null or v_eval.user_id <> auth.uid() then
    raise exception 'unknown evaluation task';
  end if;

  select key into v_key from public.capability_eval_answer_keys where task_id = p_task_id;
  if v_key is null then
    raise exception 'this task has no answer key';
  end if;
  if jsonb_typeof(v_key -> 'expected') <> 'number' then
    raise exception 'this task is not graded on an exact answer';
  end if;

  v_expected := (v_key ->> 'expected')::numeric;
  v_tolerance := coalesce((v_key ->> 'tolerance')::numeric, 0);

  if p_answer is not null and jsonb_typeof(p_answer -> 'answer') = 'number' then
    v_answer := (p_answer ->> 'answer')::numeric;
    v_readable := true;
    v_ok := abs(v_answer - v_expected) <= v_tolerance;
  end if;

  return jsonb_build_object(
    'outcome', case when v_ok then 'verified_success' else 'failed' end,
    'verified_success', v_ok,
    'matched_count', case when v_ok then 1 else 0 end,
    'required_count', 1,
    'missing_count', case when v_ok then 0 else 1 end,
    'unsupported_claims', 0,
    'failure_category', case
      when v_ok then null
      when v_readable then 'wrong_answer'
      else 'unreadable_answer'
    end,
    'held_out', v_task.split = 'held_out',
    'scoring_detail', jsonb_build_object(
      'split', v_task.split,
      'difficulty', v_task.difficulty,
      'graded_by', 'exact_answer',
      'answer_readable', v_readable,
      'tolerance_applied', v_tolerance > 0,
      'key_exposed', false
    )
  );
end;
$$;

comment on function public.capability_eval_score_answer(uuid, jsonb) is
  'Scores a computed answer against the stored expected value. Returns counts and a category, never the expected value or the submitted number.';

revoke all on function public.capability_eval_score_answer(uuid, jsonb) from public, anon;
grant execute on function public.capability_eval_score_answer(uuid, jsonb) to authenticated;

-- The element scorer must refuse an authored task. Without this guard an empty
-- element list would satisfy an empty key and report a pass.
create or replace function public.capability_eval_score_task(
  p_task_id uuid,
  p_submission jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.capability_eval_tasks;
  v_eval public.capability_evals;
  v_key jsonb;
  v_required text[];
  v_observed text[];
  v_matched text[] := '{}';
  v_missing text[] := '{}';
  v_element text;
  v_claim jsonb;
  v_unsupported integer := 0;
  v_outcome text;
  v_category text;
begin
  if auth.uid() is null then
    raise exception 'authentication is required';
  end if;

  select * into v_task from public.capability_eval_tasks where id = p_task_id;
  if v_task.id is null then
    raise exception 'unknown evaluation task';
  end if;
  select * into v_eval from public.capability_evals where id = v_task.eval_id;
  if v_eval.user_id is null or v_eval.user_id <> auth.uid() then
    raise exception 'unknown evaluation task';
  end if;

  select key into v_key from public.capability_eval_answer_keys where task_id = p_task_id;
  if v_key is null then
    raise exception 'this task has no answer key';
  end if;

  -- A task graded on an exact answer must never be scored by named elements:
  -- with no element list every submission would look like a pass.
  -- jsonb_typeof(NULL) is NULL, so the null case must be named explicitly or
  -- the guard silently passes the very key it is meant to reject.
  if v_key -> 'required_elements' is null
     or jsonb_typeof(v_key -> 'required_elements') <> 'array' then
    raise exception 'this task is graded on an exact answer, not on named elements';
  end if;

  v_required := array(
    select jsonb_array_elements_text(coalesce(v_key -> 'required_elements', '[]'::jsonb))
  );
  v_observed := array(
    select jsonb_array_elements_text(coalesce(p_submission -> 'elements', '[]'::jsonb))
  );

  foreach v_element in array v_required loop
    if v_element = any(v_observed) then
      v_matched := array_append(v_matched, v_element);
    else
      v_missing := array_append(v_missing, v_element);
    end if;
  end loop;

  for v_claim in select * from jsonb_array_elements(coalesce(p_submission -> 'claims', '[]'::jsonb)) loop
    if coalesce((v_claim ->> 'supported')::boolean, false) is false then
      v_unsupported := v_unsupported + 1;
    end if;
  end loop;

  if cardinality(v_missing) = 0 and v_unsupported = 0 then
    v_outcome := 'verified_success';
    v_category := null;
  elsif v_unsupported > 0 then
    v_outcome := case when cardinality(v_matched) > 0 then 'partial_success' else 'failed' end;
    v_category := 'unsupported_claim';
  elsif cardinality(v_matched) > 0 then
    v_outcome := 'partial_success';
    v_category := 'missing_required_element';
  else
    v_outcome := 'failed';
    v_category := 'no_required_element';
  end if;

  return jsonb_build_object(
    'outcome', v_outcome,
    'verified_success', v_outcome = 'verified_success',
    'matched_count', cardinality(v_matched),
    'required_count', cardinality(v_required),
    'missing_count', cardinality(v_missing),
    'unsupported_claims', v_unsupported,
    'failure_category', v_category,
    'held_out', v_task.split = 'held_out',
    'scoring_detail', jsonb_build_object(
      'split', v_task.split,
      'difficulty', v_task.difficulty,
      'rubric', v_task.scoring_rubric,
      'required_count', cardinality(v_required),
      'matched_count', cardinality(v_matched),
      'missing_count', cardinality(v_missing),
      'key_exposed', false,
      'matched_elements', case
        when v_task.split = 'held_out' then '[]'::jsonb
        else to_jsonb(v_matched)
      end
    )
  );
end;
$$;

comment on function public.capability_eval_score_task(uuid, jsonb) is
  'Scores a submission against the stored key. Never returns held-out key content; counts only. Refuses tasks graded on an exact answer.';

revoke all on function public.capability_eval_score_task(uuid, jsonb) from public;
grant execute on function public.capability_eval_score_task(uuid, jsonb) to authenticated;
