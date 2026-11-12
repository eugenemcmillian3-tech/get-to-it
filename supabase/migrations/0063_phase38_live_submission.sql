-- GET TO IT — Phase 38 follow-up
-- A paid trial should keep what the model answered.
--
-- The run row recorded the grade but not the submission, so a trial could be
-- seen to be correct without any way to review what was actually sent for
-- grading. The parsed answer is the model's output, not the key: storing it
-- here exposes nothing that the expected value protects.

alter table public.capability_eval_runs
  add column if not exists submission jsonb;

alter table public.capability_eval_runs
  drop constraint if exists capability_eval_runs_submission_check;
alter table public.capability_eval_runs
  add constraint capability_eval_runs_submission_check
  check (submission is null or jsonb_typeof(submission) = 'object');

comment on column public.capability_eval_runs.submission is
  'The parsed answer the model submitted for grading. Never the expected value, which stays in the answer key.';
