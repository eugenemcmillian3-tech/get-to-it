-- GET TO IT — per-task model retry and failure telemetry
--
-- A model-backed task normally makes one call. A reply that breaks the schema
-- or the role's permissions is retried once, so `retries` records how many
-- replies that task had rejected and `retry_reason` keeps the redacted reason.
-- Until now that signal existed only inside the request, which meant a model
-- regression could only be found by re-running probes by hand.
--
-- The team page aggregates these rows per role and model, so a rising retry
-- count or a failure is visible in the app.
--
-- Nothing here changes task behaviour, permissions or limits.

alter table public.app_team_tasks
  add column if not exists retries integer not null default 0,
  add column if not exists retry_reason text;

alter table public.app_team_tasks
  drop constraint if exists app_team_tasks_retries_check;
alter table public.app_team_tasks
  add constraint app_team_tasks_retries_check
  check (retries between 0 and 4);

alter table public.app_team_tasks
  drop constraint if exists app_team_tasks_retry_reason_check;
alter table public.app_team_tasks
  add constraint app_team_tasks_retry_reason_check
  check (retry_reason is null or char_length(retry_reason) <= 400);

-- History is recoverable: a model task that spent more than one call was
-- retried, because one call is the only path a clean reply takes.
update public.app_team_tasks
   set retries = least(greatest(calls_used - 1, 0), 4)
 where model is not null
   and calls_used > 1
   and retries = 0;

-- The health summary reads the newest finished model tasks for one project.
create index if not exists app_team_tasks_model_health_idx
  on public.app_team_tasks (project_id, role, finished_at desc)
  where model is not null;

comment on column public.app_team_tasks.retries is
  'Replies rejected before this task produced its result. 0 means the first reply was accepted.';
comment on column public.app_team_tasks.retry_reason is
  'Redacted reason for the most recent rejected reply, if any.';
