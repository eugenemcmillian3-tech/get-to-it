-- GET TO IT — Phase 36 plan window
--
-- 0048 allowed a plan to be inserted only while the orchestration was `draft` or
-- `awaiting_approval`. The orchestration page offers "Draft the bounded plan" as
-- soon as a contract is approved, which is the `ready` state, so the ordinary
-- flow (create, submit, approve, then plan) always failed. This widens the window
-- to `ready` and stops at execution.
--
-- Nothing else loosens: the approved contract still bounds scope, acceptance
-- criteria and the credit ceiling; orchestration_tasks_guard still refuses to
-- widen an existing task's keys, dependencies, credits or permissions; and
-- orchestration_reserve_task still refuses to reserve past authorized_micros.
drop policy if exists "members plan tasks" on public.orchestration_tasks;
create policy "members plan tasks" on public.orchestration_tasks
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) is not null
    and attempts = 0
    and status = 'pending'
    and exists (
      select 1 from public.orchestrations o
       where o.id = orchestration_id
         and o.workspace_id = workspace_id
         and o.status in ('draft', 'awaiting_approval', 'ready')
    )
  );
