-- GET TO IT — Phase 38 follow-up
-- A recorded run cannot exceed the spend or time ceiling of the configuration
-- and task it belongs to.
--
-- The limits were previously recorded, displayed and immutable, but nothing
-- compared them with the evidence, so a run could store any cost or latency.
-- The smaller of the configuration and task ceilings wins: a task may be
-- stricter than its configuration, never looser. A limit of 0 means the run
-- must be free, which is what every fixture-scored run is.

create or replace function public.capability_eval_runs_limits()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_version public.capability_eval_versions;
  v_task public.capability_eval_tasks;
  v_spend_limit integer;
  v_runtime_limit integer;
begin
  select * into v_version from public.capability_eval_versions where id = new.version_id;
  select * into v_task from public.capability_eval_tasks where id = new.task_id;

  if v_version.id is null or v_task.id is null then
    raise exception 'an evaluation run needs an existing configuration and task';
  end if;
  if v_version.eval_id <> new.eval_id or v_task.eval_id <> new.eval_id then
    raise exception 'an evaluation run cannot borrow another evaluation''s configuration or task';
  end if;

  v_spend_limit := least(v_version.spend_limit_cents, v_task.spend_limit_cents);
  v_runtime_limit := least(v_version.runtime_limit_seconds, v_task.runtime_seconds);

  if new.cost_cents > v_spend_limit then
    raise exception 'a run cannot spend more than its configuration allows (% cents)', v_spend_limit;
  end if;
  if new.latency_ms > v_runtime_limit * 1000 then
    raise exception 'a run cannot exceed its configuration time limit (% seconds)', v_runtime_limit;
  end if;

  return new;
end;
$$;

comment on function public.capability_eval_runs_limits() is
  'Refuses run evidence that exceeds the recorded spend or time ceiling. The stricter of the configuration and task limits applies.';

drop trigger if exists capability_eval_runs_limits on public.capability_eval_runs;
create trigger capability_eval_runs_limits before insert on public.capability_eval_runs
  for each row execute function public.capability_eval_runs_limits();
