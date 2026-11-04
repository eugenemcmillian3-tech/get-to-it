-- GET TO IT — Composio connections milestone
--
-- Ground rules encoded here:
--   * A connection, a tool grant and an action belong to exactly one app
--     project owned by the signed-in user. Another account cannot see or use
--     them, and a forged connected-account id is rejected by ownership checks.
--   * The browser never supplies the Composio user id. The app derives it from
--     auth.uid() and stores only the provider's connected-account id.
--   * A tool is executable only after it was discovered from Composio, cached
--     for that connection, granted to a team role, proposed with exact
--     arguments and explicitly approved. Approval binds the SHA-256 hash of
--     those arguments; there is no update function, so changed arguments need
--     a new proposal and a new approval.
--   * Execution is claimed atomically. One user can have one in-flight call,
--     and a completion can never be replayed into a second provider call.
--   * Tool usage is counted separately from AI request accounting.
--   * No credential, provider token, session id or MCP URL is stored here.
--     Composio holds authorization; this schema stores only references.

-- ---------------------------------------------------------------------------
-- Authorization attempts (started server-side, completed only for the owner)
-- ---------------------------------------------------------------------------

create table if not exists public.app_composio_auth_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.app_projects (id) on delete cascade,
  toolkit text not null check (toolkit in ('github', 'notion')),
  state_hash text not null check (state_hash ~ '^[a-f0-9]{64}$'),
  return_path text not null check (char_length(return_path) <= 200),
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'cancelled', 'failed', 'expired')),
  connected_account_id text,
  error text check (error is null or char_length(error) <= 300),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz
);

comment on table public.app_composio_auth_attempts is
  'One short-lived Composio authorization attempt. The raw state is never stored, only its SHA-256 hash.';

create index if not exists app_composio_auth_attempts_user_idx
  on public.app_composio_auth_attempts (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Connected accounts
-- ---------------------------------------------------------------------------

create table if not exists public.app_composio_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.app_projects (id) on delete cascade,
  toolkit text not null check (toolkit in ('github', 'notion')),
  connected_account_id text not null
    check (connected_account_id ~ '^ca_[A-Za-z0-9_-]{3,80}$'),
  account_label text not null default '' check (char_length(account_label) <= 120),
  status text not null default 'active'
    check (status in ('active', 'expired', 'revoked', 'removed')),
  last_verified_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, toolkit, connected_account_id)
);

comment on table public.app_composio_connections is
  'A provider account a project may use. Removing a row is local; revoking means the provider authorization was revoked first.';

create index if not exists app_composio_connections_project_idx
  on public.app_composio_connections (project_id, toolkit, created_at desc);

-- ---------------------------------------------------------------------------
-- Session references (server-side sessions, never browser state)
-- ---------------------------------------------------------------------------

create table if not exists public.app_composio_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.app_projects (id) on delete cascade,
  toolkit text not null check (toolkit in ('github', 'notion')),
  session_id text not null check (session_id ~ '^[A-Za-z0-9_-]{8,200}$'),
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (project_id, toolkit)
);

comment on table public.app_composio_sessions is
  'Reusable Composio session references per project and toolkit. Session MCP URLs are never stored or shown.';

-- ---------------------------------------------------------------------------
-- Discovered tool catalogue (populated only from the provider response)
-- ---------------------------------------------------------------------------

create table if not exists public.app_composio_tools (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.app_projects (id) on delete cascade,
  connection_id uuid not null references public.app_composio_connections (id) on delete cascade,
  toolkit text not null check (toolkit in ('github', 'notion')),
  tool_slug text not null check (tool_slug ~ '^[A-Z][A-Z0-9_]{2,80}$'),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 800),
  created_at timestamptz not null default now(),
  unique (connection_id, tool_slug)
);

comment on table public.app_composio_tools is
  'Tools actually returned by Composio discovery. Nothing here is hand-invented; grants must reference one of these rows.';

create index if not exists app_composio_tools_connection_idx
  on public.app_composio_tools (connection_id, tool_slug);

-- ---------------------------------------------------------------------------
-- Agent tool grants (project + role + exact tool)
-- ---------------------------------------------------------------------------

create table if not exists public.app_composio_tool_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.app_projects (id) on delete cascade,
  connection_id uuid not null references public.app_composio_connections (id) on delete cascade,
  tool_slug text not null check (tool_slug ~ '^[A-Z][A-Z0-9_]{2,80}$'),
  role text not null
    check (role in ('coordinator', 'frontend', 'backend', 'data', 'qa', 'security')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, tool_slug, role)
);

comment on table public.app_composio_tool_grants is
  'The small allow-list: which discovered tool a specific agent role may request for this project.';

create index if not exists app_composio_tool_grants_project_idx
  on public.app_composio_tool_grants (project_id, role);

-- ---------------------------------------------------------------------------
-- Action proposals, approvals and execution records
-- ---------------------------------------------------------------------------

create table if not exists public.app_composio_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.app_projects (id) on delete cascade,
  connection_id uuid not null references public.app_composio_connections (id) on delete restrict,
  grant_id uuid references public.app_composio_tool_grants (id) on delete set null,
  tool_slug text not null check (tool_slug ~ '^[A-Z][A-Z0-9_]{2,80}$'),
  tool_name text not null check (char_length(tool_name) <= 160),
  role text not null
    check (role in ('coordinator', 'frontend', 'backend', 'data', 'qa', 'security')),
  task_id uuid references public.app_team_tasks (id) on delete set null,
  arguments jsonb not null check (jsonb_typeof(arguments) = 'object'),
  arguments_hash text not null check (arguments_hash ~ '^[a-f0-9]{64}$'),
  preview text not null check (char_length(preview) <= 4000),
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'executing', 'succeeded', 'failed', 'uncertain', 'cancelled')),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  approval_hash text check (approval_hash is null or approval_hash ~ '^[a-f0-9]{64}$'),
  approved_at timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 3),
  result jsonb,
  provider_ref text check (provider_ref is null or char_length(provider_ref) <= 200),
  error_code text check (error_code is null or char_length(error_code) <= 80),
  error_message text check (error_message is null or char_length(error_message) <= 800),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, idempotency_key)
);

comment on table public.app_composio_actions is
  'Exact-content proposal and its one execution record. Argument changes cannot be applied to an existing row.';

create index if not exists app_composio_actions_project_idx
  on public.app_composio_actions (project_id, created_at desc);
create index if not exists app_composio_actions_status_idx
  on public.app_composio_actions (user_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- External-tool usage, separate from AI request accounting
-- ---------------------------------------------------------------------------

create table if not exists public.app_composio_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.app_projects (id) on delete cascade,
  day date not null default current_date,
  calls integer not null default 0 check (calls >= 0),
  writes integer not null default 0 check (writes >= 0),
  updated_at timestamptz not null default now(),
  unique (user_id, project_id, day)
);

comment on table public.app_composio_usage is
  'Per-user, per-project daily external-tool counts. Composio usage is not free and is never merged with AI credits.';

-- ---------------------------------------------------------------------------
-- Row Level Security: owner can read, only guarded functions can write
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'app_composio_auth_attempts',
    'app_composio_connections',
    'app_composio_sessions',
    'app_composio_tools',
    'app_composio_tool_grants',
    'app_composio_actions',
    'app_composio_usage'
  ]::text[]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_owner_select on public.%I', t, t);
    execute format(
      'create policy %I_owner_select on public.%I for select to authenticated using (user_id = auth.uid())',
      t, t
    );
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Begin an authorization attempt
-- ---------------------------------------------------------------------------

create or replace function public.composio_begin_auth(
  p_project_id uuid,
  p_toolkit text,
  p_state text,
  p_return_path text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_attempt public.app_composio_auth_attempts;
  v_recent integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', 'Sign in again.');
  end if;

  if not exists (
    select 1 from public.app_projects p
     where p.id = p_project_id and p.user_id = v_uid
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That app project is not available.');
  end if;

  if p_toolkit not in ('github', 'notion') then
    return jsonb_build_object('ok', false, 'code', 'unsupported_toolkit', 'message', 'That integration is not supported.');
  end if;

  if p_state is null or p_state !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'message', 'A fresh authorization state is required.');
  end if;

  if p_return_path is null
     or p_return_path <> '/build/' || p_project_id::text || '/connections' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'message', 'That return destination is not allowed.');
  end if;

  update public.app_composio_auth_attempts
     set status = 'expired', completed_at = now()
   where user_id = v_uid and status = 'pending' and expires_at <= now();

  select count(*) into v_recent
    from public.app_composio_auth_attempts
   where user_id = v_uid and created_at > now() - interval '1 hour';

  if v_recent >= 10 then
    return jsonb_build_object('ok', false, 'code', 'rate_limited', 'message', 'Too many connection attempts. Wait an hour and try again.');
  end if;

  insert into public.app_composio_auth_attempts
    (user_id, project_id, toolkit, state_hash, return_path, expires_at)
  values
    (v_uid, p_project_id, p_toolkit,
     encode(sha256(convert_to(p_state, 'UTF8')), 'hex'),
     p_return_path, now() + interval '15 minutes')
  returning * into v_attempt;

  return jsonb_build_object(
    'ok', true,
    'attempt', jsonb_build_object(
      'id', v_attempt.id,
      'toolkit', v_attempt.toolkit,
      'expires_at', v_attempt.expires_at
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Finish an authorization attempt (only the authenticated owner)
-- ---------------------------------------------------------------------------

create or replace function public.composio_finish_auth(
  p_attempt_id uuid,
  p_state text,
  p_status text,
  p_connected_account_id text,
  p_account_label text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_attempt public.app_composio_auth_attempts;
  v_connection public.app_composio_connections;
  v_label text := left(btrim(coalesce(p_account_label, '')), 120);
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', 'Sign in again.');
  end if;

  select * into v_attempt
    from public.app_composio_auth_attempts
   where id = p_attempt_id and user_id = v_uid
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That authorization attempt is not available.');
  end if;

  if v_attempt.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'invalid_state', 'message', 'That authorization attempt was already used.');
  end if;

  if v_attempt.expires_at <= now() then
    update public.app_composio_auth_attempts
       set status = 'expired', completed_at = now()
     where id = v_attempt.id;
    return jsonb_build_object('ok', false, 'code', 'expired', 'message', 'That authorization attempt expired. Start again.');
  end if;

  if p_state is null or p_state !~ '^[a-f0-9]{64}$'
     or v_attempt.state_hash <> encode(sha256(convert_to(p_state, 'UTF8')), 'hex') then
    return jsonb_build_object('ok', false, 'code', 'invalid_state', 'message', 'That authorization response did not match this attempt.');
  end if;

  if p_status = 'cancelled' then
    update public.app_composio_auth_attempts
       set status = 'cancelled', completed_at = now()
     where id = v_attempt.id;
    return jsonb_build_object('ok', true, 'status', 'cancelled');
  end if;

  if p_status = 'failed' then
    update public.app_composio_auth_attempts
       set status = 'failed', completed_at = now(),
           error = left(coalesce(p_account_label, 'Authorization failed at the provider.'), 300)
     where id = v_attempt.id;
    return jsonb_build_object('ok', false, 'code', 'authorization_failed', 'message', 'The provider did not complete the connection.');
  end if;

  if p_status <> 'completed' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'message', 'Unknown authorization result.');
  end if;

  if p_connected_account_id is null
     or p_connected_account_id !~ '^ca_[A-Za-z0-9_-]{3,80}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'message', 'The provider returned no usable connected account.');
  end if;

  insert into public.app_composio_connections
    (user_id, project_id, toolkit, connected_account_id, account_label, status, last_verified_at)
  values
    (v_uid, v_attempt.project_id, v_attempt.toolkit, p_connected_account_id, v_label, 'active', now())
  on conflict (project_id, toolkit, connected_account_id) do update
    set account_label = excluded.account_label,
        status = 'active',
        last_verified_at = now(),
        revoked_at = null,
        updated_at = now()
    where app_composio_connections.user_id = v_uid
  returning * into v_connection;

  if v_connection.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That connected account is already linked to another account.');
  end if;

  update public.app_composio_auth_attempts
     set status = 'completed', connected_account_id = p_connected_account_id, completed_at = now()
   where id = v_attempt.id;

  return jsonb_build_object(
    'ok', true,
    'status', 'completed',
    'connection', jsonb_build_object(
      'id', v_connection.id,
      'project_id', v_connection.project_id,
      'toolkit', v_connection.toolkit,
      'account_label', v_connection.account_label,
      'status', v_connection.status,
      'connected_at', v_connection.created_at
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Read and maintain connections
-- ---------------------------------------------------------------------------

create or replace function public.composio_list_connections(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rows jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', 'Sign in again.');
  end if;

  if not exists (
    select 1 from public.app_projects p where p.id = p_project_id and p.user_id = v_uid
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That app project is not available.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'toolkit', c.toolkit,
    'account_label', c.account_label,
    'status', c.status,
    'last_verified_at', c.last_verified_at,
    'connected_at', c.created_at
  ) order by c.created_at desc), '[]'::jsonb) into v_rows
    from public.app_composio_connections c
   where c.project_id = p_project_id and c.user_id = v_uid;

  return jsonb_build_object('ok', true, 'connections', v_rows);
end;
$$;

create or replace function public.composio_update_connection(
  p_connection_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_connection public.app_composio_connections;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', 'Sign in again.');
  end if;

  if p_status not in ('active', 'expired') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'message', 'That connection status cannot be set directly.');
  end if;

  update public.app_composio_connections
     set status = p_status,
         last_verified_at = now(),
         revoked_at = case when p_status = 'expired' then now() else revoked_at end,
         updated_at = now()
   where id = p_connection_id and user_id = v_uid
  returning * into v_connection;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That connection is not available.');
  end if;

  return jsonb_build_object('ok', true, 'status', v_connection.status);
end;
$$;

create or replace function public.composio_disconnect(
  p_connection_id uuid,
  p_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_connection public.app_composio_connections;
  v_status text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', 'Sign in again.');
  end if;

  if p_mode not in ('revoke', 'remove') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'message', 'Choose revoke or remove.');
  end if;

  v_status := case when p_mode = 'revoke' then 'revoked' else 'removed' end;

  update public.app_composio_connections
     set status = v_status,
         revoked_at = now(),
         updated_at = now()
   where id = p_connection_id and user_id = v_uid
  returning * into v_connection;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That connection is not available.');
  end if;

  update public.app_composio_tool_grants
     set enabled = false, updated_at = now()
   where connection_id = v_connection.id and user_id = v_uid;

  update public.app_composio_actions
     set status = 'cancelled', finished_at = now(), updated_at = now()
   where connection_id = v_connection.id
     and user_id = v_uid
     and status in ('proposed', 'approved');

  return jsonb_build_object('ok', true, 'status', v_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- Session reference
-- ---------------------------------------------------------------------------

create or replace function public.composio_save_session(
  p_project_id uuid,
  p_toolkit text,
  p_session_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', 'Sign in again.');
  end if;

  if not exists (
    select 1 from public.app_projects p where p.id = p_project_id and p.user_id = v_uid
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That app project is not available.');
  end if;

  if p_toolkit not in ('github', 'notion') then
    return jsonb_build_object('ok', false, 'code', 'unsupported_toolkit', 'message', 'That integration is not supported.');
  end if;

  if p_session_id is null or p_session_id !~ '^[A-Za-z0-9_-]{8,200}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'message', 'The session reference is not valid.');
  end if;

  insert into public.app_composio_sessions
    (user_id, project_id, toolkit, session_id)
  values (v_uid, p_project_id, p_toolkit, p_session_id)
  on conflict (project_id, toolkit) do update
    set session_id = excluded.session_id,
        last_used_at = now()
    where app_composio_sessions.user_id = v_uid;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Tool discovery cache
-- ---------------------------------------------------------------------------

create or replace function public.composio_replace_tools(
  p_connection_id uuid,
  p_tools jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_connection public.app_composio_connections;
  v_tool jsonb;
  v_slug text;
  v_name text;
  v_description text;
  v_count integer := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', 'Sign in again.');
  end if;

  select * into v_connection
    from public.app_composio_connections
   where id = p_connection_id and user_id = v_uid;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That connection is not available.');
  end if;

  if v_connection.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'connection_inactive', 'message', 'Reconnect that account before discovering tools.');
  end if;

  if p_tools is null or jsonb_typeof(p_tools) <> 'array'
     or jsonb_array_length(p_tools) > 50 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'message', 'The tool list is not valid.');
  end if;

  delete from public.app_composio_tools where connection_id = v_connection.id;

  for v_tool in select * from jsonb_array_elements(p_tools)
  loop
    v_slug := v_tool ->> 'slug';
    v_name := left(btrim(coalesce(v_tool ->> 'name', '')), 160);
    v_description := left(btrim(coalesce(v_tool ->> 'description', '')), 800);

    if v_slug is null
       or v_slug !~ '^[A-Z][A-Z0-9_]{2,80}$'
       or left(v_slug, char_length(v_connection.toolkit) + 1) <> upper(v_connection.toolkit) || '_'
       or v_name = '' then
      continue;
    end if;

    insert into public.app_composio_tools
      (user_id, project_id, connection_id, toolkit, tool_slug, name, description)
    values
      (v_uid, v_connection.project_id, v_connection.id, v_connection.toolkit, v_slug, v_name, v_description)
    on conflict (connection_id, tool_slug) do update
      set name = excluded.name,
          description = excluded.description;

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'count', v_count);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

create or replace function public.composio_save_grant(
  p_project_id uuid,
  p_connection_id uuid,
  p_tool_slug text,
  p_role text,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_connection public.app_composio_connections;
  v_enabled_count integer;
  v_grant_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', 'Sign in again.');
  end if;

  if p_role not in ('coordinator', 'frontend', 'backend', 'data', 'qa', 'security') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'message', 'Unknown agent role.');
  end if;

  select * into v_connection
    from public.app_composio_connections
   where id = p_connection_id and project_id = p_project_id and user_id = v_uid;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That connection is not available.');
  end if;

  if coalesce(p_enabled, false) and v_connection.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'connection_inactive', 'message', 'Reconnect that account before granting tools.');
  end if;

  if not exists (
    select 1 from public.app_composio_tools t
     where t.connection_id = v_connection.id and t.tool_slug = p_tool_slug
  ) then
    return jsonb_build_object('ok', false, 'code', 'unknown_tool', 'message', 'Discover tools first, then grant one of them.');
  end if;

  if coalesce(p_enabled, false) then
    select count(*) into v_enabled_count
      from public.app_composio_tool_grants g
     where g.connection_id = v_connection.id
       and g.enabled
       and not (g.tool_slug = p_tool_slug and g.role = p_role);

    if v_enabled_count >= 5 then
      return jsonb_build_object('ok', false, 'code', 'grant_limit', 'message', 'A connection can have at most five enabled tools.');
    end if;
  end if;

  insert into public.app_composio_tool_grants
    (user_id, project_id, connection_id, tool_slug, role, enabled)
  values
    (v_uid, p_project_id, v_connection.id, p_tool_slug, p_role, coalesce(p_enabled, true))
  on conflict (connection_id, tool_slug, role) do update
    set enabled = excluded.enabled, updated_at = now()
  returning id into v_grant_id;

  return jsonb_build_object('ok', true, 'grant_id', v_grant_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Propose an exact action (agent role + real task)
-- ---------------------------------------------------------------------------

create or replace function public.composio_propose_action(
  p_project_id uuid,
  p_connection_id uuid,
  p_tool_slug text,
  p_role text,
  p_task_id uuid,
  p_arguments jsonb,
  p_preview text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_connection public.app_composio_connections;
  v_grant public.app_composio_tool_grants;
  v_tool public.app_composio_tools;
  v_existing public.app_composio_actions;
  v_hash text;
  v_action public.app_composio_actions;
  v_pending integer;
  v_recent integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', 'Sign in again.');
  end if;

  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'message', 'A stable idempotency key is required.');
  end if;

  if p_arguments is null or jsonb_typeof(p_arguments) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'message', 'Tool arguments must be a JSON object.');
  end if;

  if octet_length(p_arguments::text) > 16384 then
    return jsonb_build_object('ok', false, 'code', 'arguments_too_large', 'message', 'Tool arguments are limited to 16 KB.');
  end if;

  if p_preview is null or btrim(p_preview) = '' or char_length(p_preview) > 4000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'message', 'A complete preview is required.');
  end if;

  if p_role not in ('coordinator', 'frontend', 'backend', 'data', 'qa', 'security') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'message', 'Unknown agent role.');
  end if;

  if not exists (
    select 1 from public.app_projects p where p.id = p_project_id and p.user_id = v_uid
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That app project is not available.');
  end if;

  select * into v_connection
    from public.app_composio_connections
   where id = p_connection_id and project_id = p_project_id and user_id = v_uid;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That connection is not available.');
  end if;

  if v_connection.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'connection_inactive', 'message', 'That connection is not active. Reconnect it.');
  end if;

  select * into v_tool
    from public.app_composio_tools t
   where t.connection_id = v_connection.id and t.tool_slug = p_tool_slug;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'unknown_tool', 'message', 'That tool is not in the discovered catalogue.');
  end if;

  select * into v_grant
    from public.app_composio_tool_grants g
   where g.connection_id = v_connection.id
     and g.tool_slug = p_tool_slug
     and g.role = p_role
     and g.enabled;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_granted', 'message', 'That role is not allowed to request this tool.');
  end if;

  if p_task_id is null or not exists (
    select 1 from public.app_team_tasks t
     where t.id = p_task_id
       and t.project_id = p_project_id
       and t.user_id = v_uid
       and t.role = p_role
       and t.status in ('queued', 'running', 'blocked', 'awaiting_review', 'completed')
  ) then
    return jsonb_build_object('ok', false, 'code', 'task_not_found', 'message', 'Choose a current agent task for this role.');
  end if;

  v_hash := encode(sha256(convert_to(p_arguments::text, 'UTF8')), 'hex');

  select * into v_existing
    from public.app_composio_actions a
   where a.project_id = p_project_id and a.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.arguments_hash = v_hash
       and v_existing.tool_slug = p_tool_slug
       and v_existing.connection_id = p_connection_id then
      return jsonb_build_object('ok', true, 'replayed', true, 'action_id', v_existing.id, 'status', v_existing.status);
    end if;
    return jsonb_build_object('ok', false, 'code', 'idempotency_conflict', 'message', 'That idempotency key was already used with different arguments.');
  end if;

  select count(*) into v_pending
    from public.app_composio_actions a
   where a.project_id = p_project_id and a.status in ('proposed', 'approved');

  if v_pending >= 20 then
    return jsonb_build_object('ok', false, 'code', 'proposal_limit', 'message', 'Resolve pending proposals before creating more.');
  end if;

  select count(*) into v_recent
    from public.app_composio_actions a
   where a.user_id = v_uid and a.created_at > now() - interval '24 hours';

  if v_recent >= 50 then
    return jsonb_build_object('ok', false, 'code', 'rate_limited', 'message', 'The daily proposal limit has been reached.');
  end if;

  insert into public.app_composio_actions
    (user_id, project_id, connection_id, grant_id, tool_slug, tool_name,
     role, task_id, arguments, arguments_hash, preview, idempotency_key)
  values
    (v_uid, p_project_id, v_connection.id, v_grant.id, v_tool.tool_slug, v_tool.name,
     p_role, p_task_id, p_arguments, v_hash, p_preview, p_idempotency_key)
  returning * into v_action;

  return jsonb_build_object(
    'ok', true, 'replayed', false, 'action_id', v_action.id,
    'status', v_action.status, 'arguments_hash', v_action.arguments_hash
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Approve exactly the stored arguments
-- ---------------------------------------------------------------------------

create or replace function public.composio_approve_action(p_action_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_action public.app_composio_actions;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', 'Sign in again.');
  end if;

  update public.app_composio_actions
     set status = 'approved',
         approval_hash = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
         approved_at = now(),
         updated_at = now()
   where id = p_action_id and user_id = v_uid and status = 'proposed'
  returning * into v_action;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'invalid_state', 'message', 'That proposal is not waiting for approval.');
  end if;

  return jsonb_build_object(
    'ok', true, 'status', v_action.status,
    'arguments_hash', v_action.arguments_hash,
    'approval_hash', v_action.approval_hash
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Claim one execution (atomic, bounded, counted)
-- ---------------------------------------------------------------------------

create or replace function public.composio_claim_action(p_action_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_action public.app_composio_actions;
  v_usage public.app_composio_usage;
  v_tool public.app_composio_tools;
  v_connection public.app_composio_connections;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', 'Sign in again.');
  end if;

  if exists (
    select 1 from public.app_composio_actions a
     where a.id = p_action_id and a.user_id = v_uid and a.status = 'executing'
  ) then
    return jsonb_build_object('ok', false, 'code', 'busy', 'message', 'That action is already running.');
  end if;

  if not exists (
    select 1 from public.app_composio_actions a
     where a.id = p_action_id and a.user_id = v_uid and a.status = 'approved'
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_state', 'message', 'That action is not approved for execution.');
  end if;

  if exists (
    select 1 from public.app_composio_actions a
     where a.user_id = v_uid and a.status = 'executing'
  ) then
    return jsonb_build_object('ok', false, 'code', 'busy', 'message', 'Wait for the current tool call to finish.');
  end if;

  insert into public.app_composio_usage (user_id, project_id, day, calls, writes)
  select v_uid, a.project_id, current_date, 1, 1
    from public.app_composio_actions a
   where a.id = p_action_id and a.user_id = v_uid
  on conflict (user_id, project_id, day) do update
    set calls = public.app_composio_usage.calls + 1,
        writes = public.app_composio_usage.writes + 1,
        updated_at = now()
    where public.app_composio_usage.calls < 100
      and public.app_composio_usage.writes < 25
  returning * into v_usage;

  if v_usage.id is null then
    return jsonb_build_object('ok', false, 'code', 'quota_exceeded', 'message', 'The daily external-tool limit has been reached.');
  end if;

  update public.app_composio_actions a
     set status = 'executing',
         attempts = a.attempts + 1,
         started_at = now(),
         updated_at = now()
   where a.id = p_action_id
     and a.user_id = v_uid
     and a.status = 'approved'
     and exists (
       select 1 from public.app_composio_tool_grants g
        where g.id = a.grant_id and g.enabled
     )
     and exists (
       select 1 from public.app_composio_connections c
        where c.id = a.connection_id and c.status = 'active'
     )
  returning * into v_action;

  if not found then
    -- The claim did not execute, so the usage row above must not count it.
    update public.app_composio_usage u
       set calls = greatest(0, u.calls - 1),
           writes = greatest(0, u.writes - 1),
           updated_at = now()
     where u.id = v_usage.id;

    return jsonb_build_object('ok', false, 'code', 'invalid_state', 'message', 'That action is not approved for execution.');
  end if;

  select * into v_tool
    from public.app_composio_tools t
   where t.connection_id = v_action.connection_id and t.tool_slug = v_action.tool_slug;

  select * into v_connection
    from public.app_composio_connections c
   where c.id = v_action.connection_id;

  return jsonb_build_object(
    'ok', true,
    'action', jsonb_build_object(
      'id', v_action.id,
      'status', v_action.status,
      'project_id', v_action.project_id,
      'connection_id', v_action.connection_id,
      'toolkit', v_connection.toolkit,
      'connected_account_id', v_connection.connected_account_id,
      'tool_slug', v_action.tool_slug,
      'tool_name', v_action.tool_name,
      'arguments', v_action.arguments,
      'arguments_hash', v_action.arguments_hash,
      'attempts', v_action.attempts
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Complete (never retried automatically)
-- ---------------------------------------------------------------------------

create or replace function public.composio_complete_action(
  p_action_id uuid,
  p_status text,
  p_result jsonb,
  p_provider_ref text,
  p_error_code text,
  p_error_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_action public.app_composio_actions;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', 'Sign in again.');
  end if;

  if p_status not in ('succeeded', 'failed', 'uncertain') then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'message', 'Unknown completion status.');
  end if;

  if p_result is not null and octet_length(p_result::text) > 32768 then
    return jsonb_build_object('ok', false, 'code', 'result_too_large', 'message', 'That result is too large to store.');
  end if;

  update public.app_composio_actions
     set status = p_status,
         result = p_result,
         provider_ref = left(p_provider_ref, 200),
         error_code = left(p_error_code, 80),
         error_message = left(p_error_message, 800),
         finished_at = now(),
         updated_at = now()
   where id = p_action_id and user_id = v_uid and status = 'executing'
  returning * into v_action;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'invalid_state', 'message', 'That action is not executing.');
  end if;

  return jsonb_build_object('ok', true, 'status', v_action.status);
end;
$$;

create or replace function public.composio_cancel_action(p_action_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_action public.app_composio_actions;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', 'Sign in again.');
  end if;

  update public.app_composio_actions
     set status = 'cancelled', finished_at = now(), updated_at = now()
   where id = p_action_id
     and user_id = v_uid
     and status in ('proposed', 'approved')
  returning * into v_action;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'invalid_state', 'message', 'Only a proposal that has not started can be cancelled here.');
  end if;

  return jsonb_build_object('ok', true, 'status', 'cancelled');
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner reads
-- ---------------------------------------------------------------------------

create or replace function public.composio_list_actions(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rows jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', 'Sign in again.');
  end if;

  if not exists (
    select 1 from public.app_projects p where p.id = p_project_id and p.user_id = v_uid
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That app project is not available.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'connection_id', a.connection_id,
    'tool_slug', a.tool_slug,
    'tool_name', a.tool_name,
    'role', a.role,
    'task_id', a.task_id,
    'arguments', a.arguments,
    'arguments_hash', a.arguments_hash,
    'preview', a.preview,
    'status', a.status,
    'result', a.result,
    'provider_ref', a.provider_ref,
    'error_code', a.error_code,
    'error_message', a.error_message,
    'attempts', a.attempts,
    'created_at', a.created_at,
    'started_at', a.started_at,
    'finished_at', a.finished_at
  ) order by a.created_at desc), '[]'::jsonb) into v_rows
    from (
      select * from public.app_composio_actions
       where project_id = p_project_id and user_id = v_uid
       order by created_at desc
       limit 30
    ) a;

  return jsonb_build_object('ok', true, 'actions', v_rows);
end;
$$;

create or replace function public.composio_usage(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_usage public.app_composio_usage;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated', 'message', 'Sign in again.');
  end if;

  if not exists (
    select 1 from public.app_projects p where p.id = p_project_id and p.user_id = v_uid
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'That app project is not available.');
  end if;

  select * into v_usage
    from public.app_composio_usage u
   where u.user_id = v_uid and u.project_id = p_project_id and u.day = current_date;

  return jsonb_build_object(
    'ok', true,
    'calls', coalesce(v_usage.calls, 0),
    'writes', coalesce(v_usage.writes, 0),
    'calls_limit', 100,
    'writes_limit', 25
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges: only signed-in users can call the public operations
-- ---------------------------------------------------------------------------

revoke all on function public.composio_begin_auth(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.composio_finish_auth(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.composio_list_connections(uuid) from public, anon, authenticated;
revoke all on function public.composio_update_connection(uuid, text) from public, anon, authenticated;
revoke all on function public.composio_disconnect(uuid, text) from public, anon, authenticated;
revoke all on function public.composio_save_session(uuid, text, text) from public, anon, authenticated;
revoke all on function public.composio_replace_tools(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.composio_save_grant(uuid, uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.composio_propose_action(uuid, uuid, text, text, uuid, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.composio_approve_action(uuid) from public, anon, authenticated;
revoke all on function public.composio_claim_action(uuid) from public, anon, authenticated;
revoke all on function public.composio_complete_action(uuid, text, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function public.composio_cancel_action(uuid) from public, anon, authenticated;
revoke all on function public.composio_list_actions(uuid) from public, anon, authenticated;
revoke all on function public.composio_usage(uuid) from public, anon, authenticated;

grant execute on function public.composio_begin_auth(uuid, text, text, text) to authenticated;
grant execute on function public.composio_finish_auth(uuid, text, text, text, text) to authenticated;
grant execute on function public.composio_list_connections(uuid) to authenticated;
grant execute on function public.composio_update_connection(uuid, text) to authenticated;
grant execute on function public.composio_disconnect(uuid, text) to authenticated;
grant execute on function public.composio_save_session(uuid, text, text) to authenticated;
grant execute on function public.composio_replace_tools(uuid, jsonb) to authenticated;
grant execute on function public.composio_save_grant(uuid, uuid, text, text, boolean) to authenticated;
grant execute on function public.composio_propose_action(uuid, uuid, text, text, uuid, jsonb, text, text) to authenticated;
grant execute on function public.composio_approve_action(uuid) to authenticated;
grant execute on function public.composio_claim_action(uuid) to authenticated;
grant execute on function public.composio_complete_action(uuid, text, jsonb, text, text, text) to authenticated;
grant execute on function public.composio_cancel_action(uuid) to authenticated;
grant execute on function public.composio_list_actions(uuid) to authenticated;
grant execute on function public.composio_usage(uuid) to authenticated;
