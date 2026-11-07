-- GET TO IT — Phase 31 schema
-- Import an existing, supported app, keep an editable map, record a baseline,
-- and hold one bounded modernization proposal before handing it to the Phase 25
-- change review flow. No imported code is executed here.
--
-- Ground rules:
--   * Imported source lives in app_projects / app_files / app_versions.
--   * A map is a working document; facts and inferences carry a basis label.
--   * Baseline failures are recorded before any proposal and are never attributed
--     to a later change.
--   * A modernization proposal never writes app_files. Approval creates a Phase 25
--     change request, which still needs its own plan/patch/test/preview/review.
--   * Owner-only RLS. No credentials or environment values are stored in a map.

create table if not exists public.app_imports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  source_kind text not null check (source_kind in ('git', 'archive')),
  source_label text not null check (char_length(btrim(source_label)) between 1 and 300),
  source_ref text check (source_ref is null or char_length(source_ref) <= 400),
  source_connection_id uuid references public.app_provider_connections (id) on delete set null,
  framework text not null check (char_length(btrim(framework)) between 1 and 120),
  framework_version text check (framework_version is null or char_length(framework_version) <= 80),
  router text check (router is null or router = 'app'),
  package_manager text check (package_manager is null or char_length(package_manager) <= 40),
  file_count integer not null check (file_count between 1 and 60),
  archive_bytes integer not null check (archive_bytes between 0 and 10485760),
  expanded_bytes integer not null check (expanded_bytes between 0 and 20971520),
  skipped jsonb not null default '{}'::jsonb check (jsonb_typeof(skipped) = 'object'),
  map jsonb not null check (jsonb_typeof(map) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  status text not null default 'imported' check (status in ('imported', 'map_edited')),
  baseline_status text not null default 'not_run'
    check (baseline_status in ('not_run', 'passed', 'failed', 'blocked')),
  baseline_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.app_imports is
  'One imported source snapshot and its editable application map. Secret files and instruction files are never stored.';

create index if not exists app_imports_user_idx
  on public.app_imports (user_id, created_at desc);

drop trigger if exists app_imports_set_updated_at on public.app_imports;
create trigger app_imports_set_updated_at before update on public.app_imports
  for each row execute function public.set_updated_at();

create table if not exists public.app_import_baselines (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.app_imports (id) on delete cascade,
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null check (status in ('passed', 'failed', 'blocked')),
  summary text not null check (char_length(btrim(summary)) between 1 and 500),
  checks jsonb not null default '[]'::jsonb check (jsonb_typeof(checks) = 'array'),
  failures jsonb not null default '[]'::jsonb
    check (jsonb_typeof(failures) = 'array' and jsonb_array_length(failures) <= 20),
  log text not null default '' check (char_length(log) <= 200000),
  duration_ms integer not null default 0 check (duration_ms >= 0),
  created_at timestamptz not null default now()
);

comment on table public.app_import_baselines is
  'Baseline evidence captured before any modernization proposal. Failed checks are pre-existing by construction.';

create index if not exists app_import_baselines_import_idx
  on public.app_import_baselines (import_id, created_at desc);

create table if not exists public.app_modernizations (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.app_imports (id) on delete cascade,
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  objective text not null
    check (objective in ('bug', 'feature', 'mobile', 'dependency', 'test_coverage')),
  request text not null check (char_length(btrim(request)) between 5 and 2000),
  status text not null default 'proposed'
    check (status in ('proposed', 'change_created', 'rejected')),
  proposal jsonb not null check (jsonb_typeof(proposal) = 'object'),
  change_id uuid references public.app_change_requests (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.app_modernizations is
  'A bounded modernization proposal. Approval only creates a Phase 25 change request; it never writes app_files.';

create index if not exists app_modernizations_import_idx
  on public.app_modernizations (import_id, created_at desc);

drop trigger if exists app_modernizations_set_updated_at on public.app_modernizations;
create trigger app_modernizations_set_updated_at before update on public.app_modernizations
  for each row execute function public.set_updated_at();

alter table public.app_imports enable row level security;
alter table public.app_import_baselines enable row level security;
alter table public.app_modernizations enable row level security;

drop policy if exists "owners manage app imports" on public.app_imports;
create policy "owners manage app imports" on public.app_imports for all to authenticated
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

drop policy if exists "owners read baselines" on public.app_import_baselines;
create policy "owners read baselines" on public.app_import_baselines for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_imports i
      where i.id = import_id and i.user_id = (select auth.uid())
    )
  );
drop policy if exists "owners append baselines" on public.app_import_baselines;
create policy "owners append baselines" on public.app_import_baselines for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_projects p
      where p.id = project_id and p.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.app_imports i
      where i.id = import_id and i.project_id = project_id and i.user_id = (select auth.uid())
    )
  );

drop policy if exists "owners read modernizations" on public.app_modernizations;
create policy "owners read modernizations" on public.app_modernizations for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_imports i
      where i.id = import_id and i.user_id = (select auth.uid())
    )
  );
drop policy if exists "owners create modernizations" on public.app_modernizations;
create policy "owners create modernizations" on public.app_modernizations for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_projects p
      where p.id = project_id and p.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.app_imports i
      where i.id = import_id and i.project_id = project_id and i.user_id = (select auth.uid())
    )
  );
drop policy if exists "owners update modernizations" on public.app_modernizations;
create policy "owners update modernizations" on public.app_modernizations for update to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_imports i
      where i.id = import_id and i.user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_imports i
      where i.id = import_id and i.user_id = (select auth.uid())
    )
  );

grant select, insert, update, delete on public.app_imports to authenticated;
grant select, insert on public.app_import_baselines to authenticated;
grant select, insert, update on public.app_modernizations to authenticated;

revoke all on public.app_imports from anon;
revoke all on public.app_import_baselines from anon;
revoke all on public.app_modernizations from anon;
