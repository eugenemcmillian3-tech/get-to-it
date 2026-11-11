-- GET TO IT — Phase 37 follow-up: let a cascade clear the version links.
--
-- supersedes_id, superseded_by_id and transferred_from_id reference
-- knowledge_entries with ON DELETE SET NULL. Deleting an entry that another
-- entry points at therefore issues an UPDATE clearing that column, which the
-- identity guard refused. Retention purge and workspace deletion both failed for
-- any entry that had been superseded or transferred.
--
-- Clearing a link (cascade) and filling an empty one (supersede) are allowed;
-- rewiring a link that already points at a different entry is not.

create or replace function public.knowledge_entries_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.workspace_id is distinct from old.workspace_id
       or new.created_by is distinct from old.created_by
       or new.kind is distinct from old.kind
       or new.claim_type is distinct from old.claim_type
       or new.version is distinct from old.version then
      raise exception 'the identity of a knowledge entry cannot be changed';
    end if;

    -- The links are ON DELETE SET NULL, so a cascade clears one (id -> null).
    -- Superseding records the new version in superseded_by_id (null -> id).
    -- Both are legitimate. Only rewiring a link that already points somewhere,
    -- to point at a different entry, is refused.
    if (old.supersedes_id is not null and new.supersedes_id is not null
        and new.supersedes_id is distinct from old.supersedes_id)
       or (old.superseded_by_id is not null and new.superseded_by_id is not null
           and new.superseded_by_id is distinct from old.superseded_by_id)
       or (old.transferred_from_id is not null and new.transferred_from_id is not null
           and new.transferred_from_id is distinct from old.transferred_from_id) then
      raise exception 'the identity of a knowledge entry cannot be changed';
    end if;

    if old.status = 'retracted' and new.status <> 'retracted' then
      raise exception 'a retracted entry cannot be revived; record a new version';
    end if;

    -- Deleting an account nulls verified_by through the foreign key. That one
    -- change is allowed; the rest of a retracted or superseded version is not.
    if new.verified_by is null and old.verified_by is not null
       and new.statement is not distinct from old.statement
       and new.verification_status is not distinct from old.verification_status then
      return new;
    end if;

    if old.status in ('superseded', 'retracted')
       and new.statement is distinct from old.statement then
      raise exception 'a superseded or retracted version cannot be rewritten';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.knowledge_entries_guard() from public, anon, authenticated;
