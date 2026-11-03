-- GET TO IT — Phase 21 schema
-- "Build an App": one supported stack (Next.js + TypeScript + Tailwind,
-- optionally Supabase), an approved specification, and real generated files.
--
-- Ground rules encoded here:
--   * Project files live in their own tables, never in tasks or task results.
--   * A generated version is a complete snapshot. Replacing or restoring files
--     happens in one function, so a failed generation cannot leave half a tree
--     and the last usable snapshot is kept.
--   * An approved specification cannot be edited. Revising creates a new draft
--     version, leaving the approved record intact.
--   * Paths are validated in the app and again here: relative, no traversal,
--     no absolute paths, no backslashes, no secret env files.
--   * Nothing is executed, installed, deployed or purchased. No credentials are
--     stored in project files or rows.
--   * Owner-only under RLS. No public gallery, sharing or publishing.

create table if not exists public.app_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 3 and 80),
  purpose text not null check (char_length(btrim(purpose)) between 10 and 1500),
  target_users text not null check (char_length(btrim(target_users)) between 5 and 600),
  workflows text not null check (char_length(btrim(workflows)) between 5 and 1500),
  required_pages text not null check (char_length(btrim(required_pages)) between 3 and 1000),
  entities text not null check (char_length(entities) <= 1000),
  auth_requirements text not null check (auth_requirements in ('supabase', 'none')),
  integrations text not null check (char_length(integrations) <= 800),
  design_preferences text not null default '' check (char_length(design_preferences) <= 800),
  definition_of_done text not null check (char_length(btrim(definition_of_done)) between 5 and 1000),
  stack text not null default 'nextjs-typescript-tailwind'
    check (stack = 'nextjs-typescript-tailwind'),
  status text not null default 'spec_draft'
    check (status in ('intake', 'spec_draft', 'spec_approved', 'generated')),
  current_version integer not null default 0 check (current_version >= 0),
  last_generation_status text not null default 'none'
    check (last_generation_status in ('none', 'succeeded', 'failed')),
  last_generation_note text check (last_generation_note is null or char_length(last_generation_note) <= 500),
  last_generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.app_projects is
  'One app intake and its build state. Files are stored separately in app_files and app_versions.';
comment on column public.app_projects.last_generation_note is
  'Why the last generation failed, or what it produced. Never contains secrets.';

create index if not exists app_projects_user_idx
  on public.app_projects (user_id, created_at desc);

drop trigger if exists app_projects_set_updated_at on public.app_projects;
create trigger app_projects_set_updated_at before update on public.app_projects
  for each row execute function public.set_updated_at();

create table if not exists public.app_specs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  version integer not null check (version >= 1),
  spec jsonb not null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, version)
);

comment on table public.app_specs is
  'Versioned app specifications. An approved version is immutable; revising creates a new draft.';

create index if not exists app_specs_project_idx
  on public.app_specs (project_id, version desc);

create or replace function public.app_specs_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.approved_at is not null then
    raise exception 'an approved specification cannot be changed; revise it into a new draft';
  end if;
  return new;
end;
$$;

drop trigger if exists app_specs_immutable on public.app_specs;
create trigger app_specs_immutable before update on public.app_specs
  for each row execute function public.app_specs_guard();

create table if not exists public.app_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  path text not null
    check (
      char_length(path) between 1 and 160
      and path ~ '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$'
      and path !~ '(^|/)\.\.(/|$)'
      and path not in ('.env', '.env.local', '.env.production')
    ),
  content text not null check (char_length(content) <= 60000),
  updated_at timestamptz not null default now(),
  unique (project_id, path)
);

comment on table public.app_files is
  'The current working tree for a generated app. Separate from tasks and task results.';

create index if not exists app_files_project_idx
  on public.app_files (project_id, path);

create table if not exists public.app_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  version integer not null check (version >= 1),
  summary text not null check (char_length(btrim(summary)) between 3 and 500),
  files jsonb not null check (
    jsonb_typeof(files) = 'array'
    and jsonb_array_length(files) between 1 and 60
  ),
  created_at timestamptz not null default now(),
  unique (project_id, version)
);

comment on table public.app_versions is
  'Append-only snapshots of the whole working tree. Generation and restore replace files from one snapshot.';

create index if not exists app_versions_project_idx
  on public.app_versions (project_id, version desc);

-- Shared guard: every function below refuses a project the caller does not own.
create or replace function public.app_assert_owner(p_project_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.app_projects p
     where p.id = p_project_id and p.user_id = (select auth.uid())
  ) then
    raise exception 'project not found';
  end if;
end;
$$;

-- Replaces the working tree from a fresh generation, atomically. The previous
-- snapshot stays in app_versions, so a later bad generation cannot erase it.
create or replace function public.replace_app_files(
  p_project_id uuid,
  p_files jsonb,
  p_summary text,
  p_note text default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_version integer;
  v_file jsonb;
begin
  perform public.app_assert_owner(p_project_id);

  if jsonb_typeof(p_files) <> 'array'
     or jsonb_array_length(p_files) not between 1 and 60 then
    raise exception 'a project needs between 1 and 60 files';
  end if;

  for v_file in select * from jsonb_array_elements(p_files)
  loop
    if jsonb_typeof(v_file -> 'path') <> 'string'
       or jsonb_typeof(v_file -> 'content') <> 'string' then
      raise exception 'every file needs a path and content';
    end if;
    if (v_file ->> 'path') !~ '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$'
       or (v_file ->> 'path') ~ '(^|/)\.\.(/|$)'
       or char_length(v_file ->> 'path') > 160
       or (v_file ->> 'path') in ('.env', '.env.local', '.env.production') then
      raise exception 'unsafe project path';
    end if;
    if char_length(v_file ->> 'content') > 60000 then
      raise exception 'a generated file is too large';
    end if;
  end loop;

  select coalesce(max(version), 0) + 1 into v_version
    from public.app_versions where project_id = p_project_id;

  insert into public.app_versions (project_id, user_id, version, summary, files)
  values (p_project_id, (select auth.uid()), v_version,
          left(coalesce(nullif(btrim(p_summary), ''), 'Generated project'), 500), p_files);

  delete from public.app_files where project_id = p_project_id;

  insert into public.app_files (project_id, user_id, path, content)
  select p_project_id, (select auth.uid()), item ->> 'path', item ->> 'content'
    from jsonb_array_elements(p_files) as item;

  update public.app_projects
     set current_version = v_version,
         status = 'generated',
         last_generation_status = 'succeeded',
         last_generation_note = left(coalesce(p_note, ''), 500),
         last_generated_at = now()
   where id = p_project_id;

  delete from public.app_versions
   where project_id = p_project_id
     and version <= v_version - 20;

  return v_version;
end;
$$;

-- Saves one edited file and snapshots the whole tree as a new version.
create or replace function public.save_app_file(
  p_project_id uuid,
  p_path text,
  p_content text
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_version integer;
  v_files jsonb;
begin
  perform public.app_assert_owner(p_project_id);

  if p_path !~ '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$'
     or p_path ~ '(^|/)\.\.(/|$)'
     or char_length(p_path) > 160
     or p_path in ('.env', '.env.local', '.env.production') then
    raise exception 'unsafe project path';
  end if;
  if char_length(p_content) > 60000 then
    raise exception 'that file is too large';
  end if;

  update public.app_files
     set content = p_content, updated_at = now()
   where project_id = p_project_id and path = p_path;

  if not found then
    raise exception 'file not found';
  end if;

  select jsonb_agg(jsonb_build_object('path', path, 'content', content) order by path)
    into v_files
    from public.app_files where project_id = p_project_id;

  select coalesce(max(version), 0) + 1 into v_version
    from public.app_versions where project_id = p_project_id;

  insert into public.app_versions (project_id, user_id, version, summary, files)
  values (p_project_id, (select auth.uid()), v_version, 'Edited ' || p_path, v_files);

  update public.app_projects
     set current_version = v_version,
         last_generation_note = 'Edited ' || p_path,
         last_generated_at = now()
   where id = p_project_id;

  delete from public.app_versions
   where project_id = p_project_id
     and version <= v_version - 20;

  return v_version;
end;
$$;

-- Restores a snapshot as a NEW version, so the restore itself is reversible.
create or replace function public.restore_app_version(
  p_project_id uuid,
  p_version integer
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_new integer;
  v_files jsonb;
begin
  perform public.app_assert_owner(p_project_id);

  select files into v_files
    from public.app_versions
   where project_id = p_project_id and version = p_version;

  if v_files is null then
    raise exception 'that version does not exist';
  end if;

  select coalesce(max(version), 0) + 1 into v_new
    from public.app_versions where project_id = p_project_id;

  insert into public.app_versions (project_id, user_id, version, summary, files)
  values (p_project_id, (select auth.uid()), v_new,
          'Restored version ' || p_version, v_files);

  delete from public.app_files where project_id = p_project_id;

  insert into public.app_files (project_id, user_id, path, content)
  select p_project_id, (select auth.uid()), item ->> 'path', item ->> 'content'
    from jsonb_array_elements(v_files) as item;

  update public.app_projects
     set current_version = v_new,
         status = 'generated',
         last_generation_status = 'succeeded',
         last_generation_note = 'Restored version ' || p_version,
         last_generated_at = now()
   where id = p_project_id;

  delete from public.app_versions
   where project_id = p_project_id
     and version <= v_new - 20;

  return v_new;
end;
$$;

alter table public.app_projects enable row level security;
alter table public.app_specs enable row level security;
alter table public.app_files enable row level security;
alter table public.app_versions enable row level security;

drop policy if exists "people read their own app projects" on public.app_projects;
create policy "people read their own app projects" on public.app_projects
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "people create their own app projects" on public.app_projects;
create policy "people create their own app projects" on public.app_projects
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "people update their own app projects" on public.app_projects;
create policy "people update their own app projects" on public.app_projects
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "people delete their own app projects" on public.app_projects;
create policy "people delete their own app projects" on public.app_projects
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "people read their own app specs" on public.app_specs;
create policy "people read their own app specs" on public.app_specs
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "people create their own app specs" on public.app_specs;
create policy "people create their own app specs" on public.app_specs
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_projects p
       where p.id = project_id and p.user_id = (select auth.uid())
    )
  );

drop policy if exists "people revise their own draft specs" on public.app_specs;
create policy "people revise their own draft specs" on public.app_specs
  for update to authenticated
  using (user_id = (select auth.uid()) and approved_at is null)
  with check (user_id = (select auth.uid()));

drop policy if exists "people read their own app files" on public.app_files;
create policy "people read their own app files" on public.app_files
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "people create their own app files" on public.app_files;
create policy "people create their own app files" on public.app_files
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_projects p
       where p.id = project_id and p.user_id = (select auth.uid())
    )
  );

drop policy if exists "people update their own app files" on public.app_files;
create policy "people update their own app files" on public.app_files
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "people delete their own app files" on public.app_files;
create policy "people delete their own app files" on public.app_files
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "people read their own app versions" on public.app_versions;
create policy "people read their own app versions" on public.app_versions
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "people create their own app versions" on public.app_versions;
create policy "people create their own app versions" on public.app_versions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.app_projects p
       where p.id = project_id and p.user_id = (select auth.uid())
    )
  );

drop policy if exists "people prune their own app versions" on public.app_versions;
create policy "people prune their own app versions" on public.app_versions
  for delete to authenticated using (user_id = (select auth.uid()));

grant execute on function public.app_assert_owner(uuid) to authenticated;
grant select, insert, update, delete on public.app_projects to authenticated;
grant select, insert, update on public.app_specs to authenticated;
grant select, insert, update, delete on public.app_files to authenticated;
grant select, insert, delete on public.app_versions to authenticated;
grant execute on function public.replace_app_files(uuid, jsonb, text, text) to authenticated;
grant execute on function public.save_app_file(uuid, text, text) to authenticated;
grant execute on function public.restore_app_version(uuid, integer) to authenticated;

revoke all on public.app_projects from anon;
revoke all on public.app_specs from anon;
revoke all on public.app_files from anon;
revoke all on public.app_versions from anon;
revoke all on function public.app_assert_owner(uuid) from anon;
revoke all on function public.replace_app_files(uuid, jsonb, text, text) from anon;
revoke all on function public.save_app_file(uuid, text, text) from anon;
revoke all on function public.restore_app_version(uuid, integer) from anon;
