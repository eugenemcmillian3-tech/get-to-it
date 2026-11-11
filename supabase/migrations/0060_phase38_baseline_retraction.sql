-- GET TO IT — Phase 38 follow-up
-- A recorded human baseline must be retractable, and never editable.
--
-- The workspace tells the owner to "retract it and record a new one", but the
-- table had no UPDATE policy, so an update matched no rows and the advice could
-- not be followed. Owners may now retract.
--
-- The immutability trigger is the real guard on every other field: this project's
-- default privileges already give authenticated table-level UPDATE, so a
-- column-level grant narrows nothing by itself. It is written as update(status)
-- to record the intent for any environment that only grants columns.

grant update (status) on public.capability_eval_human_baselines to authenticated;

drop policy if exists "owners retract human baselines" on public.capability_eval_human_baselines;
create policy "owners retract human baselines" on public.capability_eval_human_baselines
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
