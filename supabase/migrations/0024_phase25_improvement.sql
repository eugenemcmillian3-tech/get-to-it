-- GET TO IT — Phase 25 schema
-- Incremental project improvements, editable project memory, reusable skills,
-- selected error records and outcome evidence.
--
-- Ground rules:
--   * A change starts from a base source snapshot and never regenerates the app.
--   * Patch files stay in the change row until an explicit merge writes app_files.
--   * Memory, skills and errors never contain tokens or environment values.
--   * Repository text is data, never a permission grant.
--   * Owner-only RLS. Deleting the project removes all child rows.

create table if not exists public.app_project_memory (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in (
    'architecture', 'integration', 'convention', 'limitation',
    'test_command', 'deployment_config', 'procedure'
  )),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, kind, title)
);

comment on table public.app_project_memory is
  'Editable project facts. Never credentials or environment values.';

create index if not exists app_project_memory_project_idx
  on public.app_project_memory (project_id, kind, updated_at desc);

drop trigger if exists app_project_memory_set_updated_at on public.app_project_memory;
create trigger app_project_memory_set_updated_at before update on public.app_project_memory
  for each row execute function public.set_updated_at();

create table if not exists public.app_change_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in (
    'dashboard', 'bug', 'mobile_navigation', 'integration', 'dependency', 'other'
  )),
  request text not null check (char_length(btrim(request)) between 5 and 2000),
  answers text not null default '' check (char_length(answers) <= 2000),
  status text not null default 'clarifying'
    check (status in (
      'clarifying', 'proposed', 'approved', 'implemented', 'tested',
      'preview_ready', 'reviewed', 'merged', 'rejected', 'failed'
    )),
  automation_level integer not null default 2 check (automation_level between 1 and 3),
  base_version integer not null check (base_version >= 1),
  base_digest text not null check (base_digest ~ '^[a-f0-9]{64}$'),
  inspection jsonb not null default '{}'::jsonb check (jsonb_typeof(inspection) = 'object'),
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array'),
  plan jsonb not null default '{}'::jsonb check (jsonb_typeof(plan) = 'object'),
  base_files jsonb not null default '[]'::jsonb
    check (jsonb_typeof(base_files) = 'array' and jsonb_array_length(base_files) between 1 and 60),
  patch_files jsonb not null default '[]'::jsonb check (jsonb_typeof(patch_files) = 'array'),
  diff text not null default '' check (char_length(diff) <= 200000),
  checks jsonb not null default '[]'::jsonb check (jsonb_typeof(checks) = 'array'),
  preview_url text check (preview_url is null or char_length(preview_url) <= 2000),
  runner_key text check (runner_key is null or runner_key ~ '^[a-f0-9]{32}$'),
  error text check (error is null or char_length(error) <= 1000),
  merged_version integer check (merged_version is null or merged_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.app_change_requests is
  'One bounded incremental change. Patch files are isolated until merge.';

create index if not exists app_change_requests_project_idx
  on public.app_change_requests (project_id, created_at desc);

drop trigger if exists app_change_requests_set_updated_at on public.app_change_requests;
create trigger app_change_requests_set_updated_at before update on public.app_change_requests
  for each row execute function public.set_updated_at();

create table if not exists public.app_change_events (
  id uuid primary key default gen_random_uuid(),
  change_id uuid not null references public.app_change_requests (id) on delete cascade,
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (char_length(btrim(kind)) between 2 and 80),
  detail text not null check (char_length(detail) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists app_change_events_change_idx
  on public.app_change_events (change_id, created_at desc);

create table if not exists public.app_skills (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  source_change_id uuid references public.app_change_requests (id) on delete set null,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  version integer not null default 1 check (version >= 1),
  purpose text not null check (char_length(btrim(purpose)) between 5 and 500),
  stack text not null default 'nextjs-typescript-tailwind'
    check (stack = 'nextjs-typescript-tailwind'),
  required_permissions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(required_permissions) = 'array'),
  inputs jsonb not null default '[]'::jsonb check (jsonb_typeof(inputs) = 'array'),
  expected_outputs jsonb not null default '[]'::jsonb check (jsonb_typeof(expected_outputs) = 'array'),
  tests jsonb not null default '[]'::jsonb check (jsonb_typeof(tests) = 'array'),
  limitations jsonb not null default '[]'::jsonb check (jsonb_typeof(limitations) = 'array'),
  status text not null default 'verified' check (status in ('verified', 'archived')),
  created_at timestamptz not null default now(),
  unique (project_id, name, version)
);

comment on table public.app_skills is
  'A verified procedure, never a permission bypass or privileged installer.';

create table if not exists public.app_observability_settings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  release_label text not null default '' check (char_length(release_label) <= 160),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.app_observability_settings is
  'Explicit opt-in for selected error records. No automatic database export.';

drop trigger if exists app_observability_settings_set_updated_at on public.app_observability_settings;
create trigger app_observability_settings_set_updated_at before update on public.app_observability_settings
  for each row execute function public.set_updated_at();

create table if not exists public.app_error_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  release_label text not null check (char_length(release_label) between 1 and 160),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  message text not null check (char_length(message) between 1 and 2000),
  detail text not null default '' check (char_length(detail) <= 12000),
  redactions integer not null default 0 check (redactions >= 0),
  status text not null default 'new' check (status in ('new', 'repair_proposed', 'dismissed')),
  change_id uuid references public.app_change_requests (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.app_error_events is
  'Selected, app-side redacted errors. Never a full database or user record export.';

create index if not exists app_error_events_project_idx
  on public.app_error_events (project_id, created_at desc);

create table if not exists public.app_change_evaluations (
  change_id uuid primary key references public.app_change_requests (id) on delete cascade,
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  accepted boolean not null default false,
  rejected boolean not null default false,
  tests_passed boolean not null default false,
  regression_count integer not null default 0 check (regression_count >= 0),
  runtime_seconds integer not null default 0 check (runtime_seconds >= 0),
  ai_calls integer not null default 0 check (ai_calls between 0 and 2),
  created_at timestamptz not null default now(),
  check (not (accepted and rejected))
);

alter table public.app_project_memory enable row level security;
alter table public.app_change_requests enable row level security;
alter table public.app_change_events enable row level security;
alter table public.app_skills enable row level security;
alter table public.app_observability_settings enable row level security;
alter table public.app_error_events enable row level security;
alter table public.app_change_evaluations enable row level security;

drop policy if exists "owners manage project memory" on public.app_project_memory;
create policy "owners manage project memory" on public.app_project_memory for all to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.app_projects p where p.id = project_id and p.user_id = (select auth.uid())))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.app_projects p where p.id = project_id and p.user_id = (select auth.uid())));

drop policy if exists "owners manage change requests" on public.app_change_requests;
create policy "owners manage change requests" on public.app_change_requests for all to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.app_projects p where p.id = project_id and p.user_id = (select auth.uid())))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.app_projects p where p.id = project_id and p.user_id = (select auth.uid())));

drop policy if exists "owners read change events" on public.app_change_events;
create policy "owners read change events" on public.app_change_events for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "owners append change events" on public.app_change_events;
create policy "owners append change events" on public.app_change_events for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.app_change_requests c where c.id = change_id and c.user_id = (select auth.uid())));

drop policy if exists "owners manage skills" on public.app_skills;
create policy "owners manage skills" on public.app_skills for all to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.app_projects p where p.id = project_id and p.user_id = (select auth.uid())))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.app_projects p where p.id = project_id and p.user_id = (select auth.uid())));

drop policy if exists "owners manage observability" on public.app_observability_settings;
create policy "owners manage observability" on public.app_observability_settings for all to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.app_projects p where p.id = project_id and p.user_id = (select auth.uid())))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.app_projects p where p.id = project_id and p.user_id = (select auth.uid())));

drop policy if exists "owners read error events" on public.app_error_events;
create policy "owners read error events" on public.app_error_events for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "owners append error events" on public.app_error_events;
create policy "owners append error events" on public.app_error_events for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.app_projects p where p.id = project_id and p.user_id = (select auth.uid())));
drop policy if exists "owners update error events" on public.app_error_events;
create policy "owners update error events" on public.app_error_events for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "owners read evaluations" on public.app_change_evaluations;
create policy "owners read evaluations" on public.app_change_evaluations for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "owners write evaluations" on public.app_change_evaluations;
create policy "owners write evaluations" on public.app_change_evaluations for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.app_change_requests c where c.id = change_id and c.user_id = (select auth.uid())));

grant select, insert, update, delete on public.app_project_memory to authenticated;
grant select, insert, update, delete on public.app_change_requests to authenticated;
grant select, insert on public.app_change_events to authenticated;
grant select, insert, update, delete on public.app_skills to authenticated;
grant select, insert, update, delete on public.app_observability_settings to authenticated;
grant select, insert, update on public.app_error_events to authenticated;
grant select, insert, update, delete on public.app_change_evaluations to authenticated;

revoke all on public.app_project_memory from anon;
revoke all on public.app_change_requests from anon;
revoke all on public.app_change_events from anon;
revoke all on public.app_skills from anon;
revoke all on public.app_observability_settings from anon;
revoke all on public.app_error_events from anon;
revoke all on public.app_change_evaluations from anon;
