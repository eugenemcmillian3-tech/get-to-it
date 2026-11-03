-- GET TO IT — Phase 26 Supabase OAuth
-- A signed-in person can connect their own Supabase account once, choose an
-- organization and attach two existing projects to a generated app.
--
-- Ground rules:
--   * OAuth access and refresh tokens are sealed with DEPLOYMENT_VAULT_KEY
--     before they reach Postgres. Browser roles can never select them.
--   * The OAuth state verifier is short-lived, single-use and owner-checked.
--   * An account connection belongs to one user; app provider connections still
--     belong to one project and record which account connection they used.
--   * Revoking the account connection also revokes project connections that
--     depend on it, so a plan cannot silently keep using a revoked grant.

create table if not exists public.supabase_account_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  status text not null default 'connected'
    check (status in ('connected', 'error', 'revoked')),
  account_label text not null
    check (char_length(btrim(account_label)) between 1 and 120),
  scopes text not null default ''
    check (char_length(scopes) <= 1000),
  access_token_sealed text
    check (access_token_sealed is null or char_length(access_token_sealed) <= 12000),
  refresh_token_sealed text
    check (refresh_token_sealed is null or char_length(refresh_token_sealed) <= 12000),
  expires_at timestamptz,
  connected_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    status <> 'connected'
    or (
      access_token_sealed is not null
      and refresh_token_sealed is not null
      and expires_at is not null
    )
  )
);

comment on table public.supabase_account_connections is
  'One Supabase OAuth Management API grant per user. Tokens are encrypted by the server before storage.';
comment on column public.supabase_account_connections.access_token_sealed is
  'AES-GCM ciphertext. Browser roles have no select grant on this column.';
comment on column public.supabase_account_connections.refresh_token_sealed is
  'AES-GCM ciphertext. Used only by server routes and actions to refresh access.';

drop trigger if exists supabase_account_connections_set_updated_at
  on public.supabase_account_connections;
create trigger supabase_account_connections_set_updated_at
  before update on public.supabase_account_connections
  for each row execute function public.set_updated_at();

create table if not exists public.supabase_oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.app_projects (id) on delete cascade,
  state_hash text not null unique
    check (state_hash ~ '^[a-f0-9]{64}$'),
  code_verifier_sealed text not null
    check (char_length(code_verifier_sealed) between 1 and 12000),
  redirect_uri text not null
    check (char_length(redirect_uri) between 8 and 2000),
  return_path text not null
    check (char_length(return_path) between 1 and 500),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

comment on table public.supabase_oauth_states is
  'Single-use OAuth state and PKCE verifier. Consumed atomically by the callback.';

create index if not exists supabase_oauth_states_expiry_idx
  on public.supabase_oauth_states (expires_at);

alter table public.supabase_account_connections enable row level security;
alter table public.supabase_oauth_states enable row level security;

drop policy if exists "owners read their supabase account" on public.supabase_account_connections;
create policy "owners read their supabase account" on public.supabase_account_connections
  for select to authenticated
  using (user_id = (select auth.uid()));

-- OAuth state is never read directly by a browser role. Only the security
-- definer functions below create and consume it.
revoke all on public.supabase_oauth_states from authenticated;

-- Remove any default table-wide grant and expose only non-secret columns. The
-- sealed token columns remain accessible solely through owner-checked RPCs.
revoke all on public.supabase_account_connections from authenticated;
grant select (
  id, user_id, status, account_label, scopes, expires_at,
  connected_at, revoked_at, created_at, updated_at
) on public.supabase_account_connections to authenticated;

create or replace view public.supabase_account_connections_safe
with (security_invoker = true) as
select
  id,
  user_id,
  status,
  account_label,
  scopes,
  expires_at,
  connected_at,
  revoked_at,
  created_at,
  updated_at
from public.supabase_account_connections;

revoke all on public.supabase_account_connections_safe from anon;
grant select on public.supabase_account_connections_safe to authenticated;

-- Save or replace the signed-in person's OAuth grant. The caller has already
-- sealed both tokens; this function only checks ownership and stores them.
create or replace function public.save_supabase_account_connection(
  p_account_label text,
  p_scopes text,
  p_access_token_sealed text,
  p_refresh_token_sealed text,
  p_expires_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_account_label is null or char_length(btrim(p_account_label)) not between 1 and 120 then
    raise exception 'invalid account label';
  end if;
  if p_access_token_sealed is null or p_refresh_token_sealed is null then
    raise exception 'missing oauth tokens';
  end if;
  if p_expires_at is null then
    raise exception 'missing token expiry';
  end if;

  insert into public.supabase_account_connections (
    user_id, status, account_label, scopes, access_token_sealed,
    refresh_token_sealed, expires_at, connected_at, revoked_at
  ) values (
    auth.uid(), 'connected', btrim(p_account_label), coalesce(p_scopes, ''),
    p_access_token_sealed, p_refresh_token_sealed, p_expires_at, now(), null
  )
  on conflict (user_id) do update set
    status = 'connected',
    account_label = excluded.account_label,
    scopes = excluded.scopes,
    access_token_sealed = excluded.access_token_sealed,
    refresh_token_sealed = excluded.refresh_token_sealed,
    expires_at = excluded.expires_at,
    connected_at = excluded.connected_at,
    revoked_at = null,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.save_supabase_account_connection(
  text, text, text, text, timestamptz
) from public;
grant execute on function public.save_supabase_account_connection(
  text, text, text, text, timestamptz
) to authenticated;

-- Server-only token read for the signed-in owner. The ciphertext is returned;
-- the caller decrypts it with the server vault key.
create or replace function public.get_supabase_account_tokens(
  p_connection_id uuid default null
) returns table (
  id uuid,
  status text,
  account_label text,
  scopes text,
  access_token_sealed text,
  refresh_token_sealed text,
  expires_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select
    c.id,
    c.status,
    c.account_label,
    c.scopes,
    c.access_token_sealed,
    c.refresh_token_sealed,
    c.expires_at
  from public.supabase_account_connections c
  where c.user_id = (select auth.uid())
    and (p_connection_id is null or c.id = p_connection_id)
  limit 1;
$$;

revoke all on function public.get_supabase_account_tokens(uuid) from public;
grant execute on function public.get_supabase_account_tokens(uuid) to authenticated;

create or replace function public.update_supabase_account_tokens(
  p_connection_id uuid,
  p_access_token_sealed text,
  p_refresh_token_sealed text,
  p_expires_at timestamptz
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_access_token_sealed is null or p_refresh_token_sealed is null or p_expires_at is null then
    raise exception 'missing oauth tokens';
  end if;

  update public.supabase_account_connections
     set status = 'connected',
         access_token_sealed = p_access_token_sealed,
         refresh_token_sealed = p_refresh_token_sealed,
         expires_at = p_expires_at,
         revoked_at = null,
         updated_at = now()
   where id = p_connection_id
     and user_id = auth.uid();
  if not found then
    raise exception 'not allowed';
  end if;
end;
$$;

revoke all on function public.update_supabase_account_tokens(
  uuid, text, text, timestamptz
) from public;
grant execute on function public.update_supabase_account_tokens(
  uuid, text, text, timestamptz
) to authenticated;

create or replace function public.mark_supabase_account_error(
  p_connection_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update public.supabase_account_connections
     set status = 'error',
         updated_at = now()
   where id = p_connection_id
     and user_id = auth.uid();
end;
$$;

revoke all on function public.mark_supabase_account_error(uuid) from public;
grant execute on function public.mark_supabase_account_error(uuid) to authenticated;

create or replace function public.revoke_supabase_account(
  p_connection_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update public.supabase_account_connections
     set status = 'revoked',
         access_token_sealed = null,
         refresh_token_sealed = null,
         expires_at = null,
         revoked_at = now(),
         updated_at = now()
   where id = p_connection_id
     and user_id = auth.uid();

  -- A project connection that was attached through this grant cannot continue
  -- to claim it is connected after the grant is revoked.
  update public.app_provider_connections
     set status = 'revoked',
         secret_sealed = null,
         revoked_at = now(),
         updated_at = now()
   where user_id = auth.uid()
     and provider = 'supabase'
     and metadata ->> 'connection_id' = p_connection_id::text;
end;
$$;

revoke all on function public.revoke_supabase_account(uuid) from public;
grant execute on function public.revoke_supabase_account(uuid) to authenticated;

-- Create a short-lived state row. The state value itself is never stored; only
-- its SHA-256 hash is. The PKCE verifier is sealed before it reaches Postgres.
create or replace function public.create_supabase_oauth_state(
  p_state_hash text,
  p_project_id uuid,
  p_code_verifier_sealed text,
  p_redirect_uri text,
  p_return_path text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_state_hash is null or p_state_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid state';
  end if;
  if p_code_verifier_sealed is null or p_redirect_uri is null or p_return_path is null then
    raise exception 'missing oauth state fields';
  end if;
  if not exists (
    select 1
      from public.app_projects p
     where p.id = p_project_id
       and p.user_id = auth.uid()
  ) then
    raise exception 'not allowed';
  end if;

  delete from public.supabase_oauth_states
   where user_id = auth.uid()
     and expires_at <= now();

  insert into public.supabase_oauth_states (
    user_id, project_id, state_hash, code_verifier_sealed,
    redirect_uri, return_path, expires_at
  ) values (
    auth.uid(), p_project_id, p_state_hash, p_code_verifier_sealed,
    p_redirect_uri, p_return_path, now() + interval '10 minutes'
  );
end;
$$;

revoke all on function public.create_supabase_oauth_state(
  text, uuid, text, text, text
) from public;
grant execute on function public.create_supabase_oauth_state(
  text, uuid, text, text, text
) to authenticated;

-- Consume the row atomically. A second callback with the same state gets no
-- row and is refused rather than replaying the authorization code.
create or replace function public.consume_supabase_oauth_state(
  p_state_hash text
) returns table (
  project_id uuid,
  code_verifier_sealed text,
  redirect_uri text,
  return_path text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  return query
    delete from public.supabase_oauth_states s
     where s.state_hash = p_state_hash
       and s.user_id = auth.uid()
       and s.expires_at > now()
    returning s.project_id, s.code_verifier_sealed, s.redirect_uri, s.return_path;
end;
$$;

revoke all on function public.consume_supabase_oauth_state(text) from public;
grant execute on function public.consume_supabase_oauth_state(text) to authenticated;
