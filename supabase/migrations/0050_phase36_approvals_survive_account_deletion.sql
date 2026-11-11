-- GET TO IT — Phase 36 approvals must survive account deletion
--
-- Deleting a user nulls approved_by / decided_by through the foreign keys. That
-- collided with two things: the checks that required the actor id, and the review
-- guard that refused any update to a recorded decision. Account deletion (and the
-- E2E sweep that relies on it) therefore failed with 23514 as soon as an
-- orchestration had been approved, decided or reviewed.
--
-- The record still proves who-and-when through approved_at / decided_at; only the
-- actor id is nulled, which is what the foreign keys already intend.

do $$
declare r record;
begin
  for r in select conname from pg_constraint
            where conrelid = 'public.orchestration_contracts'::regclass
              and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%approved_by is not null%'
  loop
    execute format('alter table public.orchestration_contracts drop constraint %I', r.conname);
  end loop;

  for r in select conname from pg_constraint
            where conrelid = 'public.orchestration_checkpoints'::regclass
              and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%decided_by is not null%'
  loop
    execute format('alter table public.orchestration_checkpoints drop constraint %I', r.conname);
  end loop;

  for r in select conname from pg_constraint
            where conrelid = 'public.orchestration_reviews'::regclass
              and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%decided_by is not null%'
  loop
    execute format('alter table public.orchestration_reviews drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.orchestration_contracts
  add constraint orchestration_contracts_approval_time_check
  check (status <> 'approved' or approved_at is not null);

alter table public.orchestration_checkpoints
  add constraint orchestration_checkpoints_decision_time_check
  check (status <> 'approved' or decided_at is not null);

alter table public.orchestration_reviews
  add constraint orchestration_reviews_decision_time_check
  check (decision = 'undecided' or decided_at is not null);

create or replace function public.orchestration_reviews_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.orchestration_id is distinct from old.orchestration_id
       or new.workspace_id is distinct from old.workspace_id then
      raise exception 'the reviewed orchestration cannot be changed';
    end if;
    if old.decision <> 'undecided' then
      -- A deleted account nulls decided_by through the foreign key. That is the
      -- only change a recorded decision accepts.
      if new.decision is not distinct from old.decision
         and old.decided_by is not null
         and new.decided_by is null
         and new.built is not distinct from old.built
         and new.verified is not distinct from old.verified
         and new.failed is not distinct from old.failed
         and new.unknown is not distinct from old.unknown
         and new.deviations is not distinct from old.deviations
         and new.next_steps is not distinct from old.next_steps
         and new.spent_micros is not distinct from old.spent_micros
         and new.decided_at is not distinct from old.decided_at then
        return new;
      end if;
      raise exception 'a recorded outcome decision cannot be rewritten';
    end if;
  end if;
  if new.decision <> 'undecided' then
    if new.decided_by is null or new.decided_by <> (select auth.uid()) then
      raise exception 'the person making the decision must be recorded';
    end if;
    new.decided_at := coalesce(new.decided_at, now());
  end if;
  return new;
end;
$$;
