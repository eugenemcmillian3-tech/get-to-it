-- GET TO IT — Slack milestone summaries.
--
-- The second connector, built on the same shape as the GitHub handoff: a person
-- previews one message for one channel, approves exactly that channel and text,
-- and the app posts it once through the user's own Composio connection.
--
-- The state machine lives here: approval is bound to a fingerprint of the
-- channel and the text, neither can change after approval, and the same record
-- cannot produce the same message twice.

create table if not exists public.slack_message_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  connection_id uuid not null references public.app_composio_connections (id) on delete cascade,
  project_id uuid not null references public.app_projects (id) on delete cascade,
  record_kind text not null
    check (record_kind in ('mission', 'experiment', 'outcome_review')),
  record_id uuid not null,
  channel text not null check (channel ~ '^[CG][A-Z0-9]{5,19}[0-9]$'),
  channel_label text not null default '' check (char_length(channel_label) <= 120),
  text text not null check (char_length(btrim(text)) between 10 and 3000),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'sending', 'sent', 'failed', 'cancelled')),
  approval_fingerprint text check (approval_fingerprint ~ '^[0-9a-f]{64}$'),
  approved_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  message_ts text check (message_ts is null or message_ts ~ '^[0-9]{10}\.[0-9]{6}$'),
  permalink text check (
    permalink is null or permalink ~ '^https://[A-Za-z0-9.-]+\.slack\.com/archives/'
  ),
  provider_ref text check (provider_ref is null or char_length(provider_ref) <= 200),
  error_code text check (error_code is null or char_length(error_code) <= 60),
  error_message text check (error_message is null or char_length(error_message) <= 500),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (approved_at is null or (approval_fingerprint is not null and approved_by is not null)),
  check (status <> 'approved' or (approval_fingerprint = fingerprint and approved_at is not null)),
  -- A sent message names where it landed.
  check (status <> 'sent' or message_ts is not null),
  unique (user_id, record_kind, record_id, fingerprint)
);

comment on table public.slack_message_requests is
  'One approved milestone summary for one Slack channel. Approval binds to the fingerprint of the exact channel and text that will be posted.';

create index if not exists slack_message_requests_workspace_idx
  on public.slack_message_requests (workspace_id, created_at desc);

drop trigger if exists slack_message_requests_set_updated_at on public.slack_message_requests;
create trigger slack_message_requests_set_updated_at before update on public.slack_message_requests
  for each row execute function public.set_updated_at();

-- Content cannot change once approved: that is what the approval was for.
create or replace function public.slack_message_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status in ('approved', 'sending', 'sent')
       and (
         new.channel is distinct from old.channel
         or new.channel_label is distinct from old.channel_label
         or new.text is distinct from old.text
         or new.fingerprint is distinct from old.fingerprint
         or new.record_kind is distinct from old.record_kind
         or new.record_id is distinct from old.record_id
         or new.connection_id is distinct from old.connection_id
       ) then
      raise exception 'an approved message cannot be rewritten; draft a new one';
    end if;

    if old.status = 'sent' and new.status <> 'sent' then
      raise exception 'a sent message is final; the message itself is in Slack';
    end if;

    if old.status = 'cancelled' and new.status <> 'cancelled' then
      raise exception 'a cancelled message cannot be reopened; draft a new one';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists slack_message_requests_guard_trigger on public.slack_message_requests;
create trigger slack_message_requests_guard_trigger
  before update on public.slack_message_requests
  for each row execute function public.slack_message_requests_guard();

-- ---------------------------------------------------------------------------
-- Append-only audit
-- ---------------------------------------------------------------------------

create table if not exists public.slack_message_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.slack_message_requests (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in (
    'drafted', 'approved', 'send_started', 'sent', 'failed', 'cancelled'
  )),
  detail text not null default '' check (char_length(detail) <= 500),
  created_at timestamptz not null default now()
);

comment on table public.slack_message_events is
  'What happened to a Slack message request, appended and never edited.';

create index if not exists slack_message_events_request_idx
  on public.slack_message_events (request_id, created_at);

create or replace function public.slack_message_requests_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
begin
  if tg_op = 'INSERT' then
    v_kind := 'drafted';
  elsif new.status is distinct from old.status then
    v_kind := case new.status
      when 'approved' then 'approved'
      when 'sending' then 'send_started'
      when 'sent' then 'sent'
      when 'failed' then 'failed'
      when 'cancelled' then 'cancelled'
      else null
    end;
  end if;

  if v_kind is not null then
    insert into public.slack_message_events (request_id, workspace_id, actor_id, kind, detail)
    values (
      new.id,
      new.workspace_id,
      auth.uid(),
      v_kind,
      left(coalesce(new.error_message, ''), 500)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists slack_message_requests_audit_trigger on public.slack_message_requests;
create trigger slack_message_requests_audit_trigger
  after insert or update on public.slack_message_requests
  for each row execute function public.slack_message_requests_audit();

-- ---------------------------------------------------------------------------
-- The state machine
-- ---------------------------------------------------------------------------

create or replace function public.slack_message_approve(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.slack_message_requests;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_row from public.slack_message_requests where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;
  if public.workspace_role(v_row.workspace_id) is null or v_row.user_id <> v_user then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_row.status <> 'draft' then
    return jsonb_build_object('ok', false, 'code', 'not-draft');
  end if;

  update public.slack_message_requests
     set status = 'approved',
         approval_fingerprint = fingerprint,
         approved_at = now(),
         approved_by = v_user
   where id = p_id;

  return jsonb_build_object('ok', true, 'fingerprint', v_row.fingerprint);
end;
$$;

create or replace function public.slack_message_claim(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.slack_message_requests;
  v_connection public.app_composio_connections;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_row from public.slack_message_requests where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;
  if public.workspace_role(v_row.workspace_id) is null or v_row.user_id <> v_user then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_row.status = 'sending' then
    return jsonb_build_object('ok', false, 'code', 'already-sending');
  end if;
  if v_row.status = 'sent' then
    return jsonb_build_object('ok', false, 'code', 'already-sent');
  end if;
  if v_row.status not in ('approved', 'failed') then
    return jsonb_build_object('ok', false, 'code', 'approval-required');
  end if;
  if v_row.approval_fingerprint is distinct from v_row.fingerprint then
    return jsonb_build_object('ok', false, 'code', 'approval-required');
  end if;

  select * into v_connection from public.app_composio_connections
   where id = v_row.connection_id;
  if not found or v_connection.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'connection-inactive');
  end if;

  update public.slack_message_requests
     set status = 'sending',
         attempt_count = attempt_count + 1,
         error_code = null,
         error_message = null
   where id = p_id;

  return jsonb_build_object(
    'ok', true,
    'channel', v_row.channel,
    'text', v_row.text,
    'connection_id', v_row.connection_id,
    'project_id', v_row.project_id,
    'attempt', v_row.attempt_count + 1
  );
end;
$$;

create or replace function public.slack_message_complete(
  p_id uuid,
  p_succeeded boolean,
  p_message_ts text default null,
  p_permalink text default null,
  p_provider_ref text default null,
  p_error_code text default null,
  p_error_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.slack_message_requests;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_row from public.slack_message_requests where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;
  if v_row.user_id <> v_user then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_row.status <> 'sending' then
    return jsonb_build_object('ok', false, 'code', 'not-sending');
  end if;

  if p_succeeded then
    if p_message_ts is null or p_message_ts !~ '^[0-9]{10}\.[0-9]{6}$' then
      return jsonb_build_object('ok', false, 'code', 'missing-message');
    end if;
    if p_permalink is not null
       and p_permalink !~ '^https://[A-Za-z0-9.-]+\.slack\.com/archives/' then
      return jsonb_build_object('ok', false, 'code', 'bad-permalink');
    end if;

    update public.slack_message_requests
       set status = 'sent',
           message_ts = p_message_ts,
           permalink = p_permalink,
           provider_ref = nullif(left(coalesce(p_provider_ref, ''), 200), '')
     where id = p_id;
    return jsonb_build_object('ok', true, 'status', 'sent');
  end if;

  update public.slack_message_requests
     set status = 'failed',
         error_code = nullif(left(coalesce(p_error_code, 'unknown'), 60), ''),
         error_message = nullif(left(coalesce(p_error_message, ''), 500), ''),
         provider_ref = nullif(left(coalesce(p_provider_ref, ''), 200), '')
   where id = p_id;

  return jsonb_build_object('ok', true, 'status', 'failed');
end;
$$;

create or replace function public.slack_message_cancel(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_row public.slack_message_requests;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_row from public.slack_message_requests where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;
  if public.workspace_role(v_row.workspace_id) is null or v_row.user_id <> v_user then
    return jsonb_build_object('ok', false, 'code', 'forbidden');
  end if;
  if v_row.status in ('sending', 'sent') then
    return jsonb_build_object('ok', false, 'code', 'not-cancellable');
  end if;

  update public.slack_message_requests set status = 'cancelled' where id = p_id;
  return jsonb_build_object('ok', true, 'status', 'cancelled');
end;
$$;

revoke all on function public.slack_message_approve(uuid) from public, anon;
revoke all on function public.slack_message_claim(uuid) from public, anon;
revoke all on function public.slack_message_complete(uuid, boolean, text, text, text, text, text) from public, anon;
revoke all on function public.slack_message_cancel(uuid) from public, anon;
grant execute on function public.slack_message_approve(uuid) to authenticated;
grant execute on function public.slack_message_claim(uuid) to authenticated;
grant execute on function public.slack_message_complete(uuid, boolean, text, text, text, text, text) to authenticated;
grant execute on function public.slack_message_cancel(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.slack_message_requests enable row level security;
alter table public.slack_message_events enable row level security;

drop policy if exists "members read slack message requests" on public.slack_message_requests;
create policy "members read slack message requests" on public.slack_message_requests
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "owners draft slack message requests" on public.slack_message_requests;
create policy "owners draft slack message requests" on public.slack_message_requests
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) is not null
    and user_id = auth.uid()
    and status = 'draft'
  );

drop policy if exists "members read slack message events" on public.slack_message_events;
create policy "members read slack message events" on public.slack_message_events
  for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "owners append slack message events" on public.slack_message_events;
create policy "owners append slack message events" on public.slack_message_events
  for insert to authenticated
  with check (
    public.workspace_role(workspace_id) is not null
    and exists (
      select 1 from public.slack_message_requests r
       where r.id = request_id and r.user_id = auth.uid()
    )
  );
