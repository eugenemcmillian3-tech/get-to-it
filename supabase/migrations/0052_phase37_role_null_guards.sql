-- GET TO IT — Phase 37 follow-up: a NULL role is not "some other role".
--
-- `v_role not in ('owner', 'admin')` evaluates to NULL, not false, when the
-- caller is not a member of the workspace at all, so `if ... then raise` never
-- fired. Two functions were affected:
--
--   * knowledge_decide_transfer let anyone who could read the proposal approve a
--     transfer into a workspace they do not belong to.
--   * knowledge_purge_expired let any authenticated caller delete entries past
--     their retention date in any workspace.
--
-- Both now test for a null role explicitly. knowledge_set_verification gets the
-- same treatment for a null status, which previously fell through and silently
-- reset the entry to unverified.

create or replace function public.knowledge_decide_transfer(
  p_transfer_id uuid,
  p_approve boolean,
  p_note text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_role text;
  v_transfer public.knowledge_transfers;
  v_entry public.knowledge_entries;
  v_source_name text;
  v_entry_id uuid;
  v_supporting integer;
  v_contradicting integer;
  v_participant integer;
  v_limitations text;
begin
  select * into v_transfer from public.knowledge_transfers
   where id = p_transfer_id for update;
  if v_transfer.id is null then
    raise exception 'that transfer proposal does not exist';
  end if;
  v_role := public.workspace_role(v_transfer.target_workspace_id);
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'only an owner or admin of the target workspace can decide a transfer';
  end if;
  if v_transfer.status <> 'proposed' then
    raise exception 'this transfer was already decided';
  end if;

  if not p_approve then
    update public.knowledge_transfers
       set status = 'declined', decided_by = v_user, decided_at = now(),
           decision_note = coalesce(p_note, '')
     where id = p_transfer_id;
    insert into public.knowledge_events (workspace_id, entry_id, actor_id, kind, detail)
    values (v_transfer.target_workspace_id, v_transfer.entry_id, v_user,
            'transfer_declined', coalesce(p_note, ''));
    return null;
  end if;

  select * into v_entry from public.knowledge_entries where id = v_transfer.entry_id;
  if v_entry.id is null then
    raise exception 'the source entry no longer exists';
  end if;
  if v_entry.status <> 'active' or v_entry.verification_status = 'retracted' then
    raise exception 'the source entry is no longer valid';
  end if;

  select count(*) filter (where stance = 'supports'),
         count(*) filter (where stance = 'contradicts'),
         count(*) filter (where evidence_kind = 'participant_opinion')
    into v_supporting, v_contradicting, v_participant
    from public.knowledge_evidence
   where entry_id = v_transfer.entry_id;

  select w.name into v_source_name from public.workspaces w
   where w.id = v_transfer.source_workspace_id;

  v_limitations := btrim(v_entry.limitations)
    || case when btrim(v_entry.limitations) = '' then '' else E'\n\n' end
    || 'Verified in ' || coalesce(v_source_name, 'the source workspace')
    || ' only. The evidence itself stayed there: ' || v_supporting
    || ' supporting and ' || v_contradicting || ' contradicting item(s) in the source workspace.'
    || case when v_participant = 0 then ''
            else ' ' || v_participant
                 || ' came from participant feedback, which was not transferred.' end
    || E'\n\nNot yet tested here. Assumption to test: ' || v_transfer.assumptions_to_test;

  insert into public.knowledge_entries (
    workspace_id, created_by, owner_id, kind, claim_type, title, statement, domain,
    applies_when, limitations, authorized_scope, provenance, verification_status,
    verification_note, verified_by, verified_at, review_at, transferred_from_id,
    retention_note
  ) values (
    v_transfer.target_workspace_id, v_user, v_user, v_entry.kind, v_entry.claim_type,
    v_entry.title, v_entry.statement, v_entry.domain, v_entry.applies_when,
    v_limitations,
    'This workspace only. Reuse outside it needs its own transfer approval.',
    'Transferred from ' || coalesce(v_source_name, 'another workspace')
      || ' with approval. Source entry ' || v_entry.id::text || '.',
    v_entry.verification_status,
    'Verified in ' || coalesce(v_source_name, 'the source workspace')
      || '; not re-tested here.',
    v_user, now(), null, v_entry.id, v_entry.retention_note
  )
  returning id into v_entry_id;

  insert into public.knowledge_sources (
    workspace_id, entry_id, source_kind, source_id, label, linked_by
  ) values (
    v_transfer.target_workspace_id, v_entry_id, 'transfer', v_entry.id,
    'Transferred from ' || coalesce(v_source_name, 'another workspace'), v_user
  );

  update public.knowledge_transfers
     set status = 'approved', decided_by = v_user, decided_at = now(),
         decision_note = coalesce(p_note, ''), created_entry_id = v_entry_id
   where id = p_transfer_id;

  insert into public.knowledge_events (workspace_id, entry_id, actor_id, kind, detail)
  values (v_transfer.target_workspace_id, v_entry_id, v_user, 'transfer_approved',
          'from workspace ' || v_transfer.source_workspace_id::text);

  insert into public.knowledge_events (workspace_id, entry_id, actor_id, kind, detail)
  values (v_transfer.source_workspace_id, v_transfer.entry_id, v_user, 'transfer_approved',
          'to workspace ' || v_transfer.target_workspace_id::text);

  return v_entry_id;
end;
$$;

create or replace function public.knowledge_purge_expired(p_workspace_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_role text := public.workspace_role(p_workspace_id);
  v_count integer;
begin
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'only an owner or admin can purge entries past their retention date';
  end if;

  insert into public.knowledge_events (workspace_id, entry_id, actor_id, kind, detail)
  select p_workspace_id, null, v_user, 'retention_purge',
         'deleted ' || count(*) || ' entry(ies) past their retention date'
    from public.knowledge_entries
   where workspace_id = p_workspace_id and delete_after is not null
     and delete_after <= current_date;

  delete from public.knowledge_entries
   where workspace_id = p_workspace_id and delete_after is not null
     and delete_after <= current_date;
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

create or replace function public.knowledge_set_verification(
  p_entry_id uuid,
  p_status text,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_role text;
  v_entry public.knowledge_entries;
  v_supporting integer;
  v_contradicting integer;
  v_sources integer;
begin
  select * into v_entry from public.knowledge_entries where id = p_entry_id for update;
  if v_entry.id is null then
    raise exception 'that knowledge entry does not exist';
  end if;

  v_role := public.workspace_role(v_entry.workspace_id);
  if v_role is null then
    raise exception 'you are not a member of this workspace';
  end if;
  if not (v_entry.owner_id = v_user or v_entry.created_by = v_user
          or v_role in ('owner', 'admin')) then
    raise exception 'only the entry owner or a workspace owner or admin can change verification';
  end if;
  if v_entry.status <> 'active' then
    raise exception 'only the current version can change status';
  end if;
  if p_status is null or p_status not in ('unverified', 'supported', 'contradicted') then
    raise exception 'choose unverified, supported or contradicted';
  end if;

  select count(*) filter (where stance = 'supports'),
         count(*) filter (where stance = 'contradicts')
    into v_supporting, v_contradicting
    from public.knowledge_evidence
   where entry_id = p_entry_id;

  if p_status = 'supported' then
    if v_entry.claim_type = 'ai_suggestion' then
      raise exception 'an AI suggestion is never promoted to verified knowledge; write the claim yourself as a new version';
    end if;
    if v_entry.claim_type = 'hypothesis' then
      raise exception 'a hypothesis is not supported by being restated; record the test and write the result as a measured observation or tested procedure';
    end if;
    if char_length(btrim(coalesce(p_note, ''))) < 10 then
      raise exception 'write the basis for this decision';
    end if;
    select count(*) into v_sources
      from public.knowledge_sources s
     where s.entry_id = p_entry_id;
    if v_supporting = 0 and v_sources = 0 then
      raise exception 'record at least one supporting item or source first';
    end if;
    update public.knowledge_entries
       set verification_status = 'supported',
           verification_note = btrim(p_note),
           verified_by = v_user,
           verified_at = now()
     where id = p_entry_id;
  elsif p_status = 'contradicted' then
    if char_length(btrim(coalesce(p_note, ''))) < 10 then
      raise exception 'write what contradicts it';
    end if;
    if v_contradicting = 0 then
      raise exception 'record the contradicting item first';
    end if;
    update public.knowledge_entries
       set verification_status = 'contradicted',
           verification_note = btrim(p_note),
           verified_by = v_user,
           verified_at = now()
     where id = p_entry_id;
  else
    update public.knowledge_entries
       set verification_status = 'unverified',
           verification_note = btrim(coalesce(p_note, '')),
           verified_by = null,
           verified_at = null
     where id = p_entry_id;
  end if;

  insert into public.knowledge_events (workspace_id, entry_id, actor_id, kind, detail)
  values (v_entry.workspace_id, p_entry_id, v_user, 'verification_changed', p_status);
end;
$$;

revoke all on function public.knowledge_decide_transfer(uuid, boolean, text) from public, anon;
grant execute on function public.knowledge_decide_transfer(uuid, boolean, text) to authenticated;
revoke all on function public.knowledge_purge_expired(uuid) from public, anon;
grant execute on function public.knowledge_purge_expired(uuid) to authenticated;
revoke all on function public.knowledge_set_verification(uuid, text, text) from public, anon;
grant execute on function public.knowledge_set_verification(uuid, text, text) to authenticated;
