-- GET TO IT — Phase 24 schema
-- One deployment integration set per app project: GitHub, Vercel and Supabase.
--
-- Ground rules encoded here:
--   * A provider token or database URL is sealed with the server-only vault key
--     before it reaches Postgres. Browser roles cannot select the sealed column.
--   * A connection belongs to exactly one project. There is no shared token row.
--   * A deployment plan is an immutable JSON record with its source snapshot.
--     The approval stores a fingerprint of that exact plan.
--   * Preview deploys never apply production migrations.
--   * Events are append-only and never contain token or environment values.
--   * Owner-only under RLS; projects and all child rows cascade on deletion.

create table if not exists public.app_provider_connections (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('github', 'vercel', 'supabase')),
  status text not null default 'connected'
    check (status in ('connected', 'revoked', 'error')),
  account_label text not null check (char_length(btrim(account_label)) between 1 and 120),
  external_ref text not null check (char_length(btrim(external_ref)) between 1 and 240),
  scope_label text not null check (char_length(btrim(scope_label)) between 1 and 240),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  secret_sealed text check (secret_sealed is null or char_length(secret_sealed) <= 12000),
  connected_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, provider)
);

comment on table public.app_provider_connections is
  'One scoped provider connection per app project. Tokens are encrypted by the server before storage.';
comment on column public.app_provider_connections.secret_sealed is
  'AES-GCM ciphertext. Browser roles have no select grant on this column.';

create index if not exists app_provider_connections_user_idx
  on public.app_provider_connections (user_id, updated_at desc);

drop trigger if exists app_provider_connections_set_updated_at on public.app_provider_connections;
create trigger app_provider_connections_set_updated_at before update on public.app_provider_connections
  for each row execute function public.set_updated_at();

create table if not exists public.app_env_values (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  environment text not null check (environment in ('preview', 'production')),
  name text not null
    check (char_length(name) between 1 and 64 and name ~ '^[A-Z][A-Z0-9_]*$'),
  visibility text not null check (visibility in ('public', 'server')),
  secret_sealed text not null check (char_length(secret_sealed) between 1 and 12000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, environment, name)
);

comment on table public.app_env_values is
  'Encrypted environment values by project and environment. The UI and logs only receive requirement names.';

create index if not exists app_env_values_project_idx
  on public.app_env_values (project_id, environment, name);

drop trigger if exists app_env_values_set_updated_at on public.app_env_values;
create trigger app_env_values_set_updated_at before update on public.app_env_values
  for each row execute function public.set_updated_at();

create table if not exists public.app_deployments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  target text not null check (target in ('preview', 'production')),
  snapshot_version integer not null check (snapshot_version >= 1),
  snapshot_digest text not null check (snapshot_digest ~ '^[a-f0-9]{64}$'),
  snapshot jsonb not null
    check (jsonb_typeof(snapshot) = 'array' and jsonb_array_length(snapshot) between 1 and 60),
  plan jsonb not null check (jsonb_typeof(plan) = 'object'),
  plan_hash text not null check (plan_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'draft'
    check (status in (
      'draft', 'checks_ready', 'approved', 'repository', 'migrations',
      'infrastructure', 'deploying', 'succeeded', 'partial_failure', 'failed'
    )),
  checks jsonb not null default '[]'::jsonb check (jsonb_typeof(checks) = 'array'),
  approval_at timestamptz,
  source_commit text check (source_commit is null or char_length(source_commit) <= 100),
  external_deployment_id text
    check (external_deployment_id is null or char_length(external_deployment_id) <= 160),
  deployment_url text check (deployment_url is null or char_length(deployment_url) <= 1000),
  migration_state text not null default 'not_applied'
    check (char_length(migration_state) between 1 and 500),
  error text check (error is null or char_length(error) <= 1000),
  partial_failure text check (partial_failure is null or char_length(partial_failure) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.app_deployments is
  'An immutable source snapshot and approved plan, plus the external deployment evidence.';

create index if not exists app_deployments_project_idx
  on public.app_deployments (project_id, created_at desc);

drop trigger if exists app_deployments_set_updated_at on public.app_deployments;
create trigger app_deployments_set_updated_at before update on public.app_deployments
  for each row execute function public.set_updated_at();

create table if not exists public.app_deployment_events (
  id uuid primary key default gen_random_uuid(),
  deployment_id uuid not null references public.app_deployments (id) on delete cascade,
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (char_length(btrim(kind)) between 2 and 80),
  detail text not null check (char_length(detail) between 1 and 1000),
  created_at timestamptz not null default now()
);

comment on table public.app_deployment_events is
  'Append-only deployment audit. No tokens, environment values or provider request bodies.';

create index if not exists app_deployment_events_deployment_idx
  on public.app_deployment_events (deployment_id, created_at desc);

alter table public.app_provider_connections enable row level security;
alter table public.app_env_values enable row level security;
alter table public.app_deployments enable row level security;
alter table public.app_deployment_events enable row level security;

drop policy if exists "owners manage their provider connections" on public.app_provider_connections;
create policy "owners manage their provider connections" on public.app_provider_connections
  for all to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_projects p
       where p.id = project_id and p.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_projects p
       where p.id = project_id and p.user_id = (select auth.uid())
    )
  );

drop policy if exists "owners manage their env values" on public.app_env_values;
create policy "owners manage their env values" on public.app_env_values
  for all to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_projects p
       where p.id = project_id and p.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_projects p
       where p.id = project_id and p.user_id = (select auth.uid())
    )
  );

drop policy if exists "owners manage their deployments" on public.app_deployments;
create policy "owners manage their deployments" on public.app_deployments
  for all to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_projects p
       where p.id = project_id and p.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_projects p
       where p.id = project_id and p.user_id = (select auth.uid())
    )
  );

drop policy if exists "owners read their deployment events" on public.app_deployment_events;
create policy "owners read their deployment events" on public.app_deployment_events
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "owners append their deployment events" on public.app_deployment_events;
create policy "owners append their deployment events" on public.app_deployment_events
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_deployments d
       where d.id = deployment_id and d.user_id = (select auth.uid())
    )
  );

-- Sealed columns are server-only. Remove any default table-wide grant first,
-- then grant only the safe columns.
revoke all on public.app_provider_connections from authenticated;
revoke all on public.app_env_values from authenticated;

grant select (
  id, project_id, user_id, provider, status, account_label, external_ref,
  scope_label, metadata, connected_at, revoked_at, created_at, updated_at
) on public.app_provider_connections to authenticated;
grant insert, update, delete on public.app_provider_connections to authenticated;

grant select (
  id, project_id, user_id, environment, name, visibility, created_at, updated_at
) on public.app_env_values to authenticated;
grant insert, update, delete on public.app_env_values to authenticated;

grant select, insert, update, delete on public.app_deployments to authenticated;
grant select, insert on public.app_deployment_events to authenticated;

revoke all on public.app_provider_connections from anon;
revoke all on public.app_env_values from anon;
revoke all on public.app_deployments from anon;
revoke all on public.app_deployment_events from anon;

-- The server action needs the ciphertext, but the browser cannot select it.
-- The function is still owner-checked; the value it returns is encrypted.
create or replace function public.get_provider_secret(
  p_project_id uuid,
  p_provider text
)
returns text
language sql
security definer
set search_path = ''
as $$
  select c.secret_sealed
    from public.app_provider_connections c
   where c.project_id = p_project_id
     and c.provider = p_provider
     and c.user_id = (select auth.uid())
     and c.status = 'connected';
$$;

create or replace function public.get_project_env_values(
  p_project_id uuid,
  p_environment text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', e.name,
    'visibility', e.visibility,
    'sealed', e.secret_sealed
  ) order by e.name), '[]'::jsonb)
    from public.app_env_values e
   where e.project_id = p_project_id
     and e.environment = p_environment
     and e.user_id = (select auth.uid());
$$;

revoke all on function public.get_provider_secret(uuid, text) from public, anon;
revoke all on function public.get_project_env_values(uuid, text) from public, anon;
grant execute on function public.get_provider_secret(uuid, text) to authenticated;
grant execute on function public.get_project_env_values(uuid, text) to authenticated;
