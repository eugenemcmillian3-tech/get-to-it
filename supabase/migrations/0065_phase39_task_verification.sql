-- GET TO IT — Phase 39: a research task cannot be verified without evidence.
--
-- Phase 39 enqueues research work into the existing orchestration queue. That
-- left a hole: the queue could mark "re-check each source" verified while the
-- mission held no sources and nothing had been re-checked, which is exactly the
-- kind of unsupported completion this feature exists to prevent.
--
-- Verification now reads the mission's own records. A task is only verifiable
-- when the evidence it covers actually exists in research_sources or
-- research_findings.

create or replace function public.research_task_verification_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mission_id uuid;
begin
  if new.status <> 'verified' or old.status = 'verified' then
    return new;
  end if;
  if new.task_key not like 'research-%' then
    return new;
  end if;

  if new.input_refs !~ '^research_missions:[0-9a-f-]{36}$' then
    raise exception 'a research task must name its mission in input_refs';
  end if;
  v_mission_id := substring(new.input_refs from 19)::uuid;

  if not exists (select 1 from public.research_missions m where m.id = v_mission_id) then
    raise exception 'the research mission behind this task no longer exists';
  end if;

  if new.task_key = 'research-investigate' then
    if not exists (
      select 1 from public.research_sources s where s.mission_id = v_mission_id
    ) then
      raise exception 'no source has been recorded, so collecting sources cannot be verified';
    end if;
  elsif new.task_key = 'research-verify' then
    if not exists (
      select 1 from public.research_sources s
       where s.mission_id = v_mission_id and s.verified
    ) then
      raise exception 'no source has been re-checked, so evidence verification cannot be verified';
    end if;
  elsif new.task_key = 'research-competing' then
    if not exists (
      select 1
        from public.research_sources s
        join public.research_hypotheses h on h.id = s.hypothesis_id
       where s.mission_id = v_mission_id and h.role = 'competing'
    ) then
      raise exception 'no evidence is attached to the competing hypothesis, so that review cannot be verified';
    end if;
  elsif new.task_key = 'research-method' then
    if not exists (
      select 1 from public.research_findings f where f.mission_id = v_mission_id
    ) then
      raise exception 'no finding has been recorded, so the method review cannot be verified';
    end if;
  elsif new.task_key = 'research-synthesise' then
    if not exists (
      select 1 from public.research_findings f where f.mission_id = v_mission_id
    ) then
      raise exception 'the brief has no finding, so synthesis cannot be verified';
    end if;
  elsif new.task_key = 'research-prototype' then
    if not exists (
      select 1 from public.research_missions m
       where m.id = v_mission_id and m.proposed_experiment_id is not null
    ) then
      raise exception 'no experiment has been proposed, so the prototype task cannot be verified';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.research_task_verification_guard() is
  'Refuses to mark a research task verified unless the mission holds the evidence that task was meant to produce.';

drop trigger if exists research_task_verification_guard_trigger on public.orchestration_tasks;
create trigger research_task_verification_guard_trigger
  before update on public.orchestration_tasks
  for each row execute function public.research_task_verification_guard();

-- ---------------------------------------------------------------------------
-- Marking a source re-checked
-- ---------------------------------------------------------------------------
--
-- 0064 gave research_sources select and insert policies only, so a recorded
-- source could never be marked verified afterwards: the update silently touched
-- no rows. That is a real gap, not only a test problem, because verification is
-- what a discovery depends on.

drop policy if exists "members update research sources" on public.research_sources;
create policy "members update research sources" on public.research_sources
  for update to authenticated
  using (public.workspace_role(workspace_id) is not null)
  with check (public.workspace_role(workspace_id) is not null);

-- Once somebody has re-read the original, the record of what it says stops
-- changing. A correction is a new source, so the verification cannot drift away
-- from the text it was performed on.
create or replace function public.research_sources_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.verified then
    if new.stance is distinct from old.stance
       or new.statement_kind is distinct from old.statement_kind
       or new.source_tier is distinct from old.source_tier
       or new.source_kind is distinct from old.source_kind
       or new.title is distinct from old.title
       or new.locator is distinct from old.locator
       or new.excerpt is distinct from old.excerpt
       or new.hypothesis_id is distinct from old.hypothesis_id then
      raise exception 'a re-checked source cannot be rewritten; record a new source instead';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists research_sources_guard_trigger on public.research_sources;
create trigger research_sources_guard_trigger
  before update on public.research_sources
  for each row execute function public.research_sources_guard();
