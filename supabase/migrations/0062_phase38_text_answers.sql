-- GET TO IT — Phase 38 follow-up
-- Machine-checkable answers are not always numbers.
--
-- The first authored set graded a computed number. Several domains are graded
-- on a short, exact piece of text instead: which required key is missing, which
-- tool should be called. The key now holds either an expected number or an
-- expected string, and scoring compares the same way for both: exactly, after
-- trimming and lower-casing, with no partial credit.
--
-- Neither the expected number nor the expected string is ever returned.

drop function if exists public.capability_eval_seed_authored_key(uuid, numeric, numeric);

create or replace function public.capability_eval_seed_authored_key(
  p_task_id uuid,
  p_expected numeric default null,
  p_expected_text text default null,
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
  v_key jsonb;
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

  if (p_expected is null) = (p_expected_text is null) then
    raise exception 'an authored task needs exactly one expected answer: a number or a string';
  end if;
  if p_tolerance is null or p_tolerance < 0 then
    raise exception 'an answer tolerance cannot be negative';
  end if;
  if exists (select 1 from public.capability_eval_answer_keys where task_id = p_task_id) then
    raise exception 'this task already has an answer key';
  end if;

  v_key := case
    when p_expected is not null then jsonb_build_object('expected', p_expected, 'tolerance', p_tolerance)
    else jsonb_build_object('expected_text', btrim(lower(p_expected_text)))
  end;

  insert into public.capability_eval_answer_keys (task_id, eval_id, key)
  values (p_task_id, v_task.eval_id, v_key);
end;
$$;

comment on function public.capability_eval_seed_authored_key(uuid, numeric, text, numeric) is
  'Stores the expected answer for an authored task, as a number or a short string. The owner may write it once and can never read it back.';

revoke all on function public.capability_eval_seed_authored_key(uuid, numeric, text, numeric) from public, anon;
grant execute on function public.capability_eval_seed_authored_key(uuid, numeric, text, numeric) to authenticated;

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
  v_expected_text text;
  v_tolerance numeric;
  v_answer numeric;
  v_text text;
  v_submitted boolean := false;
  v_ok boolean := false;
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
  if v_key -> 'expected' is null and v_key -> 'expected_text' is null then
    raise exception 'this task is not graded on an exact answer';
  end if;

  v_expected := (v_key ->> 'expected')::numeric;
  v_expected_text := v_key ->> 'expected_text';
  v_tolerance := coalesce((v_key ->> 'tolerance')::numeric, 0);

  -- A reply of the wrong kind is unreadable, not wrong: the shape was part of
  -- what the task asked for.
  if p_answer is not null
     and v_expected_text is null
     and jsonb_typeof(p_answer -> 'answer') = 'number' then
    v_answer := (p_answer ->> 'answer')::numeric;
    v_submitted := true;
    v_ok := abs(v_answer - v_expected) <= v_tolerance;
  elsif p_answer is not null
     and v_expected_text is not null
     and jsonb_typeof(p_answer -> 'answer') = 'string' then
    v_text := btrim(lower(p_answer ->> 'answer'));
    v_submitted := true;
    v_ok := v_text = v_expected_text;
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
      when v_submitted then 'wrong_answer'
      else 'unreadable_answer'
    end,
    'held_out', v_task.split = 'held_out',
    'scoring_detail', jsonb_build_object(
      'split', v_task.split,
      'difficulty', v_task.difficulty,
      'graded_by', case when v_expected_text is null then 'exact_number' else 'exact_text' end,
      'answer_readable', v_submitted,
      'tolerance_applied', v_tolerance > 0,
      'key_exposed', false
    )
  );
end;
$$;

comment on function public.capability_eval_score_answer(uuid, jsonb) is
  'Scores a computed answer (number or short string) against the stored expected value. Returns counts and a category, never the expected value or the submitted answer.';

revoke all on function public.capability_eval_score_answer(uuid, jsonb) from public, anon;
grant execute on function public.capability_eval_score_answer(uuid, jsonb) to authenticated;
