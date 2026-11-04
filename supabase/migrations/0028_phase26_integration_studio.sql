-- GET TO IT — Phase 26 Integration Studio
-- Two supported integration kinds: OpenAPI 3 HTTP APIs and PostgreSQL.
--
-- Ground rules:
--   * Credentials are sealed by the server with the existing
--     DEPLOYMENT_VAULT_KEY before they reach Postgres. Browser roles cannot
--     select the sealed columns.
--   * Integration rows are owner-only and belong to one app project.
--   * The browser writes through owner-checked, security-definer functions.
--   * The stored config contains operations/schema metadata, never credentials.
--   * No function applies a migration or writes to a connected database.

create table if not exists public.app_integrations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('openapi_http', 'postgres')),
  name text not null
    check (char_length(btrim(name)) between 3 and 80),
  status text not null default 'draft'
    check (status in ('draft', 'connected', 'error', 'disconnected')),
  config jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(config) = 'object'
      and octet_length(config::text) <= 300000
    ),
  allowed_operations jsonb not null default '[]'::jsonb
    check (
      jsonb_typeof(allowed_operations) = 'array'
      and jsonb_array_length(allowed_operations) <= 50
    ),
  mapping jsonb not null default '[]'::jsonb
    check (
      jsonb_typeof(mapping) = 'array'
      and jsonb_array_length(mapping) <= 20
    ),
  development_secret_sealed text
    check (development_secret_sealed is null or char_length(development_secret_sealed) <= 12000),
  production_secret_sealed text
    check (production_secret_sealed is null or char_length(production_secret_sealed) <= 12000),
  last_tested_at timestamptz,
  last_test_status text not null default 'never'
    check (last_test_status in ('never', 'passed', 'failed')),
  last_test_note text
    check (last_test_note is null or char_length(last_test_note) <= 500),
  connected_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name)
);

comment on table public.app_integrations is
  'One app-project integration. Credentials are encrypted by the server before storage.';
comment on column public.app_integrations.development_secret_sealed is
  'AES-GCM ciphertext for a development API key or database URL. Browser roles cannot select it.';
comment on column public.app_integrations.production_secret_sealed is
  'AES-GCM ciphertext for a production API key or database URL. Browser roles cannot select it.';
comment on column public.app_integrations.config is
  'Safe metadata: OpenAPI operations or PostgreSQL schema, labels and migration preview. No credentials.';

create index if not exists app_integrations_project_idx
  on public.app_integrations (project_id, created_at desc);

drop trigger if exists app_integrations_set_updated_at on public.app_integrations;
create trigger app_integrations_set_updated_at before update on public.app_integrations
  for each row execute function public.set_updated_at();

alter table public.app_integrations enable row level security;

drop policy if exists "owners read their app integrations" on public.app_integrations;
create policy "owners read their app integrations" on public.app_integrations
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_projects p
       where p.id = project_id and p.user_id = (select auth.uid())
    )
  );

-- All writes go through the owner-checked functions below. The browser never
-- receives insert/update/delete rights on the sealed columns.
revoke all on public.app_integrations from authenticated;
grant select (
  id, project_id, user_id, kind, name, status, config, allowed_operations,
  mapping, last_tested_at, last_test_status, last_test_note, connected_at,
  disconnected_at, created_at, updated_at
) on public.app_integrations to authenticated;

revoke all on public.app_integrations from anon;

create or replace function public.create_app_integration(
  p_project_id uuid,
  p_kind text,
  p_name text,
  p_config jsonb,
  p_allowed_operations jsonb,
  p_mapping jsonb,
  p_status text
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
  if not exists (
    select 1 from public.app_projects p
     where p.id = p_project_id and p.user_id = (select auth.uid())
  ) then
    raise exception 'project not found';
  end if;
  if p_kind not in ('openapi_http', 'postgres') then
    raise exception 'unsupported integration kind';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 3 and 80 then
    raise exception 'invalid integration name';
  end if;
  if p_config is null or jsonb_typeof(p_config) <> 'object'
     or octet_length(p_config::text) > 300000 then
    raise exception 'invalid integration config';
  end if;
  if p_allowed_operations is null or jsonb_typeof(p_allowed_operations) <> 'array'
     or jsonb_array_length(p_allowed_operations) > 50 then
    raise exception 'invalid allowed operations';
  end if;
  if p_mapping is null or jsonb_typeof(p_mapping) <> 'array'
     or jsonb_array_length(p_mapping) > 20 then
    raise exception 'invalid mapping';
  end if;
  if p_status not in ('draft', 'connected') then
    raise exception 'invalid integration status';
  end if;

  insert into public.app_integrations (
    project_id, user_id, kind, name, status, config, allowed_operations, mapping,
    connected_at
  ) values (
    p_project_id, auth.uid(), p_kind, btrim(p_name), p_status, p_config,
    p_allowed_operations, p_mapping,
    case when p_status = 'connected' then now() else null end
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.save_app_integration_secrets(
  p_id uuid,
  p_development_secret_sealed text,
  p_production_secret_sealed text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_development_secret_sealed is not null
     and char_length(p_development_secret_sealed) > 12000 then
    raise exception 'development secret is too large';
  end if;
  if p_production_secret_sealed is not null
     and char_length(p_production_secret_sealed) > 12000 then
    raise exception 'production secret is too large';
  end if;

  update public.app_integrations
     set development_secret_sealed = p_development_secret_sealed,
         production_secret_sealed = p_production_secret_sealed,
         updated_at = now()
   where id = p_id
     and user_id = (select auth.uid());
  if not found then
    raise exception 'not allowed';
  end if;
end;
$$;

create or replace function public.save_app_integration_selection(
  p_id uuid,
  p_allowed_operations jsonb,
  p_mapping jsonb,
  p_config jsonb,
  p_status text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_allowed_operations is null or jsonb_typeof(p_allowed_operations) <> 'array'
     or jsonb_array_length(p_allowed_operations) > 50 then
    raise exception 'invalid allowed operations';
  end if;
  if p_mapping is null or jsonb_typeof(p_mapping) <> 'array'
     or jsonb_array_length(p_mapping) > 20 then
    raise exception 'invalid mapping';
  end if;
  if p_config is null or jsonb_typeof(p_config) <> 'object'
     or octet_length(p_config::text) > 300000 then
    raise exception 'invalid integration config';
  end if;
  if p_status not in ('draft', 'connected') then
    raise exception 'invalid integration status';
  end if;

  update public.app_integrations
     set allowed_operations = p_allowed_operations,
         mapping = p_mapping,
         config = p_config,
         status = p_status,
         connected_at = case when p_status = 'connected' then coalesce(connected_at, now()) else connected_at end,
         disconnected_at = null,
         updated_at = now()
   where id = p_id
     and user_id = (select auth.uid());
  if not found then
    raise exception 'not allowed';
  end if;
end;
$$;

create or replace function public.record_app_integration_test(
  p_id uuid,
  p_status text,
  p_note text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_status not in ('passed', 'failed') then
    raise exception 'invalid test status';
  end if;

  update public.app_integrations
     set last_tested_at = now(),
         last_test_status = p_status,
         last_test_note = left(coalesce(p_note, ''), 500),
         status = case when p_status = 'failed' then 'error' else 'connected' end,
         updated_at = now()
   where id = p_id
     and user_id = (select auth.uid());
  if not found then
    raise exception 'not allowed';
  end if;
end;
$$;

create or replace function public.disconnect_app_integration(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update public.app_integrations
     set status = 'disconnected',
         development_secret_sealed = null,
         production_secret_sealed = null,
         disconnected_at = now(),
         updated_at = now()
   where id = p_id
     and user_id = (select auth.uid());
  if not found then
    raise exception 'not allowed';
  end if;
end;
$$;

create or replace function public.get_app_integration_secret(
  p_id uuid,
  p_environment text
) returns text
language sql
security definer
set search_path = ''
as $$
  select case
    when p_environment = 'development' then i.development_secret_sealed
    when p_environment = 'production' then i.production_secret_sealed
    else null
  end
    from public.app_integrations i
   where i.id = p_id
     and i.user_id = (select auth.uid())
     and i.status <> 'disconnected';
$$;

revoke all on function public.create_app_integration(
  uuid, text, text, jsonb, jsonb, jsonb, text
) from public, anon;
revoke all on function public.save_app_integration_secrets(uuid, text, text)
  from public, anon;
revoke all on function public.save_app_integration_selection(
  uuid, jsonb, jsonb, jsonb, text
) from public, anon;
revoke all on function public.record_app_integration_test(uuid, text, text)
  from public, anon;
revoke all on function public.disconnect_app_integration(uuid) from public, anon;
revoke all on function public.get_app_integration_secret(uuid, text) from public, anon;

grant execute on function public.create_app_integration(
  uuid, text, text, jsonb, jsonb, jsonb, text
) to authenticated;
grant execute on function public.save_app_integration_secrets(uuid, text, text)
  to authenticated;
grant execute on function public.save_app_integration_selection(
  uuid, jsonb, jsonb, jsonb, text
) to authenticated;
grant execute on function public.record_app_integration_test(uuid, text, text)
  to authenticated;
grant execute on function public.disconnect_app_integration(uuid) to authenticated;
grant execute on function public.get_app_integration_secret(uuid, text) to authenticated;
