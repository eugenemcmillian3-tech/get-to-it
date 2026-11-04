-- GET TO IT — Phase 27 Design Workspace
-- A design layer for an existing generated app. It stores tokens, a brief,
-- permitted raster references and append-only design snapshots. It does not
-- modify backend behavior or fetch third-party assets.
--
-- Ground rules:
--   * Owner-only under RLS; every row belongs to one app project.
--   * Only PNG, JPEG and WebP references are accepted. SVG/HTML are refused in
--     the app before storage because they can contain active content.
--   * Uploaded references are not executed or fetched from a URL.
--   * Design versions are append-only. Applying a design writes the normal
--     app_files snapshot separately, preserving all files outside the design
--     layer and the marked token block.

create table if not exists public.app_design_profiles (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  brief text not null default '' check (char_length(brief) <= 4000),
  config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object' and octet_length(config::text) <= 60000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.app_design_profiles is
  'One owner-scoped design brief and token configuration per app project. No credentials.';

drop trigger if exists app_design_profiles_set_updated_at on public.app_design_profiles;
create trigger app_design_profiles_set_updated_at before update on public.app_design_profiles
  for each row execute function public.set_updated_at();

create table if not exists public.app_design_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('screenshot', 'wireframe', 'asset')),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  mime text not null check (mime in ('image/png', 'image/jpeg', 'image/webp')),
  bytes integer not null check (bytes between 1 and 1500000),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  content_base64 text not null
    check (char_length(content_base64) between 1 and 2100000),
  attribution text not null default '' check (char_length(attribution) <= 500),
  license_note text not null default '' check (char_length(license_note) <= 500),
  permission_confirmed boolean not null default false check (permission_confirmed = true),
  created_at timestamptz not null default now()
);

comment on table public.app_design_assets is
  'Permitted raster screenshots, wireframes or design references. SVG and HTML are not accepted.';
comment on column public.app_design_assets.content_base64 is
  'The uploaded raster bytes, base64 encoded. Owner-only and never executed.';

create index if not exists app_design_assets_project_idx
  on public.app_design_assets (project_id, created_at desc);

create table if not exists public.app_design_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  version integer not null check (version >= 1),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  summary text not null check (char_length(btrim(summary)) between 3 and 500),
  diff text not null default '' check (char_length(diff) <= 30000),
  created_at timestamptz not null default now(),
  unique (project_id, version)
);

comment on table public.app_design_versions is
  'Append-only Design Workspace snapshots. Applying files is recorded in app_versions separately.';

create index if not exists app_design_versions_project_idx
  on public.app_design_versions (project_id, version desc);

alter table public.app_design_profiles enable row level security;
alter table public.app_design_assets enable row level security;
alter table public.app_design_versions enable row level security;

drop policy if exists "owners manage their design profile" on public.app_design_profiles;
create policy "owners manage their design profile" on public.app_design_profiles
  for all to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from public.app_projects p where p.id = project_id and p.user_id = (select auth.uid()))
  )
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.app_projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );

drop policy if exists "owners read their design assets" on public.app_design_assets;
create policy "owners read their design assets" on public.app_design_assets
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from public.app_projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );
drop policy if exists "owners add their design assets" on public.app_design_assets;
create policy "owners add their design assets" on public.app_design_assets
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.app_projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );
drop policy if exists "owners remove their design assets" on public.app_design_assets;
create policy "owners remove their design assets" on public.app_design_assets
  for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "owners read their design versions" on public.app_design_versions;
create policy "owners read their design versions" on public.app_design_versions
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from public.app_projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );
drop policy if exists "owners append their design versions" on public.app_design_versions;
create policy "owners append their design versions" on public.app_design_versions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.app_projects p where p.id = project_id and p.user_id = (select auth.uid()))
  );

grant select, insert, update, delete on public.app_design_profiles to authenticated;
grant select, insert, delete on public.app_design_assets to authenticated;
grant select, insert on public.app_design_versions to authenticated;

revoke all on public.app_design_profiles from anon;
revoke all on public.app_design_assets from anon;
revoke all on public.app_design_versions from anon;
