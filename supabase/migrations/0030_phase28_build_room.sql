-- GET TO IT — Phase 28 schema
-- Project Build Room: asynchronous collaboration over the existing app project.
--
-- Ground rules:
--   * Existing app_files/app_versions remain the source of truth. A changeset
--     is isolated until a maintainer merges it through a checked RPC.
--   * Project roles map from workspace roles where possible: workspace owner
--     and admin -> maintainer, workspace member -> contributor. Reviewers and
--     viewers are explicit project grants.
--   * Removing a project member overrides workspace fallback immediately.
--   * Approval stores the exact content digest. Any later content change clears
--     that digest, so an old approval cannot be reused.
--   * A merge is refused if a changed file no longer matches the changeset's
--     base, or if the integration checks are missing/failed.
--   * Agents never authenticate as reviewers. Agent-attributed changes are
--     reviewed by a human role, and self-review is refused.
--   * Shared links are expiring, read-only briefs. They contain no files,
--     comments, credentials, environment values or provider tokens.

create extension if not exists pgcrypto;

alter table public.app_projects
  add column if not exists workspace_id uuid references public.workspaces (id) on delete set null;

create index if not exists app_projects_workspace_idx
  on public.app_projects (workspace_id);

create table if not exists public.app_project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  workspace_id uuid references public.workspaces (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'maintainer', 'contributor', 'reviewer', 'viewer')),
  status text not null default 'active' check (status in ('active', 'removed')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, user_id)
);

comment on table public.app_project_members is
  'Project roles. A removed row blocks workspace-role fallback immediately. The project owner is always owner.';

create index if not exists app_project_members_project_idx
  on public.app_project_members (project_id, status);
create index if not exists app_project_members_user_idx
  on public.app_project_members (user_id, status);

drop trigger if exists app_project_members_set_updated_at on public.app_project_members;
create trigger app_project_members_set_updated_at before update on public.app_project_members
  for each row execute function public.set_updated_at();

create table if not exists public.app_build_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 200),
  description text not null default '' check (char_length(description) <= 2000),
  status text not null default 'queued'
    check (status in ('queued', 'active', 'blocked', 'review', 'done', 'cancelled')),
  assignee_kind text not null default 'human' check (assignee_kind in ('human', 'agent')),
  assignee_id uuid references auth.users (id) on delete set null,
  agent_role text check (agent_role is null or agent_role in (
    'coordinator', 'frontend', 'backend', 'data', 'qa', 'security'
  )),
  scope_paths jsonb not null default '[]'::jsonb check (
    jsonb_typeof(scope_paths) = 'array' and jsonb_array_length(scope_paths) <= 12
  ),
  source_task_id uuid references public.app_team_tasks (id) on delete set null,
  created_by uuid not null references auth.users (id) on delete cascade,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (assignee_kind = 'agent' or agent_role is null)
);

comment on table public.app_build_tasks is
  'Human and agent assignments on one board. Scope paths must already exist in the project.';

create index if not exists app_build_tasks_project_idx
  on public.app_build_tasks (project_id, created_at desc);

drop trigger if exists app_build_tasks_set_updated_at on public.app_build_tasks;
create trigger app_build_tasks_set_updated_at before update on public.app_build_tasks
  for each row execute function public.set_updated_at();

create table if not exists public.app_changesets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  author_kind text not null default 'human' check (author_kind in ('human', 'agent')),
  agent_role text check (agent_role is null or agent_role in (
    'coordinator', 'frontend', 'backend', 'data', 'qa', 'security'
  )),
  title text not null check (char_length(btrim(title)) between 3 and 200),
  description text not null default '' check (char_length(description) <= 2000),
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'approved', 'rejected', 'conflict', 'merged', 'cancelled')),
  base_version integer not null check (base_version >= 0),
  base_digest text not null check (base_digest ~ '^[a-f0-9]{32}$'),
  base_files jsonb not null check (
    jsonb_typeof(base_files) = 'array' and jsonb_array_length(base_files) between 1 and 60
  ),
  files jsonb not null check (
    jsonb_typeof(files) = 'array' and jsonb_array_length(files) between 1 and 60
  ),
  content_digest text generated always as (md5(files::text)) stored,
  diff text not null default '' check (char_length(diff) <= 200000),
  checks jsonb not null default '[]'::jsonb check (
    jsonb_typeof(checks) = 'array' and jsonb_array_length(checks) <= 20
  ),
  conflict_files jsonb not null default '[]'::jsonb check (jsonb_typeof(conflict_files) = 'array'),
  reviewed_digest text check (reviewed_digest is null or reviewed_digest ~ '^[a-f0-9]{32}$'),
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  merged_version integer check (merged_version is null or merged_version >= 1),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (author_kind = 'agent' or agent_role is null)
);

comment on table public.app_changesets is
  'An isolated change based on one project snapshot. Merge is refused after conflicting edits or stale review.';

create index if not exists app_changesets_project_idx
  on public.app_changesets (project_id, created_at desc);

drop trigger if exists app_changesets_set_updated_at on public.app_changesets;
create trigger app_changesets_set_updated_at before update on public.app_changesets
  for each row execute function public.set_updated_at();

create table if not exists public.app_changeset_reviews (
  id uuid primary key default gen_random_uuid(),
  changeset_id uuid not null references public.app_changesets (id) on delete cascade,
  project_id uuid not null references public.app_projects (id) on delete cascade,
  requested_by uuid not null references auth.users (id) on delete cascade,
  reviewer_id uuid references auth.users (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'changes_requested', 'dismissed')),
  snapshot_digest text not null check (snapshot_digest ~ '^[a-f0-9]{32}$'),
  note text not null default '' check (char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index if not exists app_changeset_reviews_changeset_idx
  on public.app_changeset_reviews (changeset_id, created_at desc);

create table if not exists public.app_build_comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  changeset_id uuid references public.app_changesets (id) on delete cascade,
  file_path text check (file_path is null or char_length(file_path) between 1 and 160),
  author_id uuid not null references auth.users (id) on delete cascade,
  author_kind text not null default 'human' check (author_kind in ('human', 'agent')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists app_build_comments_project_idx
  on public.app_build_comments (project_id, created_at desc);

create table if not exists public.app_presence (
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'viewing' check (status in ('viewing', 'reviewing', 'coding')),
  last_seen_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists public.app_share_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  scope text not null default 'preview' check (scope = 'preview'),
  created_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index if not exists app_share_links_project_idx
  on public.app_share_links (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Role checks and membership
-- ---------------------------------------------------------------------------

create or replace function public.app_project_role(
  p_project_id uuid,
  p_user_id uuid default null
)
returns text
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_user uuid := coalesce(p_user_id, (select auth.uid()));
  v_role text;
  v_workspace_id uuid;
  v_workspace_role text;
begin
  if v_user is null then return null; end if;

  select case when p.user_id = v_user then 'owner' else null end,
         p.workspace_id
    into v_role, v_workspace_id
    from public.app_projects p
   where p.id = p_project_id;

  if v_role = 'owner' then return 'owner'; end if;

  select m.role, m.status into v_role, v_workspace_role
    from public.app_project_members m
   where m.project_id = p_project_id and m.user_id = v_user
   limit 1;

  if v_role = 'owner' then return 'owner'; end if;
  if v_role is not null and v_workspace_role = 'removed' then return null; end if;
  if v_role is not null and v_workspace_role = 'active' then return v_role; end if;

  if v_workspace_id is not null then
    select wm.role into v_workspace_role
      from public.workspace_members wm
     where wm.workspace_id = v_workspace_id
       and wm.user_id = v_user
       and wm.status = 'active';
    if v_workspace_role is not null then
      return case when v_workspace_role in ('owner', 'admin') then 'maintainer' else 'contributor' end;
    end if;
  end if;

  return null;
end;
$$;

create or replace function public.app_require_project_role(
  p_project_id uuid,
  p_roles text[]
)
returns text
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_role text := public.app_project_role(p_project_id);
begin
  if v_role is null or not (v_role = any (p_roles)) then
    raise exception 'project access denied';
  end if;
  return v_role;
end;
$$;

create or replace function public.link_app_workspace(
  p_project_id uuid,
  p_workspace_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_role text;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if public.app_project_role(p_project_id) <> 'owner' then
    raise exception 'project owner required';
  end if;

  select wm.role into v_role
    from public.workspace_members wm
   where wm.workspace_id = p_workspace_id
     and wm.user_id = v_user
     and wm.status = 'active';
  if v_role not in ('owner', 'admin') then
    raise exception 'workspace owner or admin required';
  end if;

  update public.app_projects
     set workspace_id = p_workspace_id
   where id = p_project_id;

  insert into public.app_project_members (project_id, workspace_id, user_id, role, status, invited_by)
  select p_project_id, p_workspace_id, m.user_id,
         case when m.role in ('owner', 'admin') then 'maintainer' else 'contributor' end,
         'active', v_user
    from public.workspace_members m
   where m.workspace_id = p_workspace_id and m.status = 'active'
  on conflict (project_id, user_id) do nothing;

  insert into public.app_project_members (project_id, workspace_id, user_id, role, status, invited_by)
  select p_project_id, p_workspace_id, p.user_id, 'owner', 'active', v_user
    from public.app_projects p where p.id = p_project_id
  on conflict (project_id, user_id) do update
    set role = 'owner', status = 'active', workspace_id = excluded.workspace_id;

  return jsonb_build_object('ok', true, 'workspace_id', p_workspace_id);
end;
$$;

create or replace function public.add_app_project_member(
  p_project_id uuid,
  p_user_id uuid,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_role text := public.app_project_role(p_project_id);
begin
  if v_actor_role not in ('owner', 'maintainer') then
    raise exception 'maintainer access required';
  end if;
  if p_role not in ('owner', 'maintainer', 'contributor', 'reviewer', 'viewer') then
    raise exception 'invalid project role';
  end if;
  if p_role = 'owner' then raise exception 'ownership transfer is not supported'; end if;
  if v_actor_role = 'maintainer' and p_role = 'maintainer' then
    raise exception 'only the owner can add another maintainer';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'that person does not have an account';
  end if;

  insert into public.app_project_members (project_id, user_id, role, status, invited_by)
  values (p_project_id, p_user_id, p_role, 'active', v_actor)
  on conflict (project_id, user_id) do update
    set role = excluded.role, status = 'active', invited_by = excluded.invited_by;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.remove_app_project_member(
  p_project_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_actor_role text := public.app_project_role(p_project_id);
begin
  if v_actor_role not in ('owner', 'maintainer') then
    raise exception 'maintainer access required';
  end if;
  if p_user_id = (select user_id from public.app_projects where id = p_project_id) then
    raise exception 'the project owner cannot be removed';
  end if;
  if p_user_id = v_actor and v_actor_role = 'maintainer' then
    raise exception 'ask the owner to remove your access';
  end if;

  update public.app_project_members
     set status = 'removed'
   where project_id = p_project_id and user_id = p_user_id;
  if not found then raise exception 'member not found'; end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Task board and comments
-- ---------------------------------------------------------------------------

create or replace function public.create_app_build_task(
  p_project_id uuid,
  p_title text,
  p_description text,
  p_assignee_kind text,
  p_assignee_id uuid,
  p_agent_role text,
  p_scope_paths jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role text := public.app_project_role(p_project_id);
  v_task uuid;
  v_path jsonb;
begin
  if v_role not in ('owner', 'maintainer', 'contributor') then
    raise exception 'contributor access required';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 3 and 200 then
    raise exception 'task title must be 3 to 200 characters';
  end if;
  if p_description is null or char_length(p_description) > 2000 then
    raise exception 'task description is too long';
  end if;
  if p_assignee_kind not in ('human', 'agent') then raise exception 'invalid assignee kind'; end if;
  if p_assignee_kind = 'agent' and v_role not in ('owner', 'maintainer') then
    raise exception 'only a maintainer or owner can assign an agent';
  end if;
  if p_assignee_kind = 'agent' and p_agent_role not in ('coordinator', 'frontend', 'backend', 'data', 'qa', 'security') then
    raise exception 'invalid agent role';
  end if;
  if p_assignee_kind = 'human' and p_assignee_id is not null
     and public.app_project_role(p_project_id, p_assignee_id) is null then
    raise exception 'the assignee is not a project member';
  end if;
  if jsonb_typeof(p_scope_paths) <> 'array' or jsonb_array_length(p_scope_paths) > 12 then
    raise exception 'invalid task scope';
  end if;
  for v_path in select * from jsonb_array_elements(p_scope_paths)
  loop
    if jsonb_typeof(v_path) <> 'string'
       or not exists (select 1 from public.app_files f where f.project_id = p_project_id and f.path = v_path #>> '{}') then
      raise exception 'task scope must reference existing project files';
    end if;
  end loop;

  insert into public.app_build_tasks
    (project_id, title, description, assignee_kind, assignee_id, agent_role, scope_paths, created_by)
  values
    (p_project_id, left(btrim(p_title), 200), left(coalesce(p_description, ''), 2000),
     p_assignee_kind, case when p_assignee_kind = 'human' then p_assignee_id else null end,
     case when p_assignee_kind = 'agent' then p_agent_role else null end,
     coalesce(p_scope_paths, '[]'::jsonb), v_actor)
  returning id into v_task;

  return v_task;
end;
$$;

create or replace function public.cancel_app_build_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_task public.app_build_tasks;
  v_role text;
begin
  select * into v_task from public.app_build_tasks where id = p_task_id;
  if not found then raise exception 'task not found'; end if;
  v_role := public.app_project_role(v_task.project_id);
  if v_role not in ('owner', 'maintainer', 'contributor') then raise exception 'project access denied'; end if;
  if v_role = 'contributor' and v_actor <> v_task.created_by and v_actor <> v_task.assignee_id then
    raise exception 'only the creator, assignee or a maintainer can cancel this task';
  end if;
  if v_task.status in ('done', 'cancelled') then raise exception 'task is already finished'; end if;

  update public.app_build_tasks
     set status = 'cancelled', cancelled_at = now()
   where id = p_task_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.add_app_build_comment(
  p_project_id uuid,
  p_changeset_id uuid,
  p_file_path text,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_id uuid;
begin
  if public.app_project_role(p_project_id) is null then raise exception 'project access denied'; end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 2000 then
    raise exception 'comment must be 1 to 2000 characters';
  end if;
  if p_body ~* '(api[_-]?key|secret|token|password)[[:space:]]*[:=][[:space:]]*[^[:space:]]{6,}' then
    raise exception 'comments cannot contain a secret value';
  end if;
  if p_changeset_id is not null and not exists (
    select 1 from public.app_changesets c where c.id = p_changeset_id and c.project_id = p_project_id
  ) then raise exception 'changeset not found'; end if;
  if p_file_path is not null and not exists (
    select 1 from public.app_files f where f.project_id = p_project_id and f.path = p_file_path
  ) and not exists (
    select 1 from public.app_changesets c, jsonb_array_elements(c.files) f
     where c.id = p_changeset_id and c.project_id = p_project_id and f->>'path' = p_file_path
  ) then raise exception 'file not found'; end if;

  insert into public.app_build_comments (project_id, changeset_id, file_path, author_id, body)
  values (p_project_id, p_changeset_id, nullif(btrim(p_file_path), ''), btrim(p_body), v_actor)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.touch_app_presence(p_project_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if public.app_project_role(p_project_id) is null then raise exception 'project access denied'; end if;
  insert into public.app_presence (project_id, user_id, status, last_seen_at)
  values (p_project_id, v_actor, 'viewing', now())
  on conflict (project_id, user_id) do update set last_seen_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Changesets, review and conflict-aware merge
-- ---------------------------------------------------------------------------

create or replace function public.create_app_changeset(
  p_project_id uuid,
  p_title text,
  p_description text,
  p_path text,
  p_content text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_base jsonb;
  v_version integer;
  v_id uuid;
begin
  if public.app_project_role(p_project_id) not in ('owner', 'maintainer', 'contributor') then
    raise exception 'contributor access required';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 3 and 200 then
    raise exception 'changeset title must be 3 to 200 characters';
  end if;
  if p_description is null or char_length(p_description) > 2000 then
    raise exception 'changeset description is too long';
  end if;
  if p_path is null or p_path !~ '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$'
     or p_path ~ '(^|/)\.\.(/|$)' or char_length(p_path) > 160
     or p_path in ('.env', '.env.local', '.env.production') then
    raise exception 'unsafe project path';
  end if;
  if p_content is null or char_length(p_content) > 60000 then
    raise exception 'file content is too large';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('path', path, 'content', content) order by path), '[]'::jsonb)
    into v_base
    from public.app_files where project_id = p_project_id;
  select coalesce(max(version), 0) into v_version
    from public.app_versions where project_id = p_project_id;

  if jsonb_array_length(v_base) = 0 then raise exception 'generate project files first'; end if;

  insert into public.app_changesets
    (project_id, author_id, author_kind, title, description, base_version, base_digest, base_files, files, diff)
  values
    (p_project_id, v_actor, 'human', left(btrim(p_title), 200), left(coalesce(p_description, ''), 2000),
     v_version, md5(v_base::text), v_base,
     jsonb_build_array(jsonb_build_object('path', p_path, 'content', p_content)),
     '--- a/' || p_path || E'\n+++ b/' || p_path || E'\n')
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.create_agent_changeset_from_task(p_task_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_task public.app_team_tasks;
  v_base jsonb;
  v_version integer;
  v_files jsonb;
  v_id uuid;
  v_role text;
begin
  select * into v_task from public.app_team_tasks where id = p_task_id;
  if not found then raise exception 'agent task not found'; end if;
  v_role := public.app_project_role(v_task.project_id);
  if v_role not in ('owner', 'maintainer') then raise exception 'maintainer access required'; end if;
  if v_task.status not in ('completed', 'awaiting_review') then
    raise exception 'the agent task has no reviewable output yet';
  end if;
  if jsonb_array_length(v_task.branch_files) = 0 then
    raise exception 'the agent task produced no branch files';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('path', path, 'content', content) order by path), '[]'::jsonb)
    into v_base from public.app_files where project_id = v_task.project_id;
  select coalesce(max(version), 0) into v_version
    from public.app_versions where project_id = v_task.project_id;
  if jsonb_array_length(v_base) = 0 then raise exception 'generate project files first'; end if;

  if exists (
    select 1 from jsonb_array_elements(v_task.branch_files) b
     where not exists (
       select 1 from jsonb_array_elements(v_task.file_claims) c where c #>> '{}' = b->>'path'
     )
  ) then
    raise exception 'agent output contains a path outside its declared file claims';
  end if;

  select jsonb_agg(jsonb_build_object('path', b->>'path', 'content', b->>'content') order by b->>'path')
    into v_files from jsonb_array_elements(v_task.branch_files) b;

  insert into public.app_changesets
    (project_id, author_id, author_kind, agent_role, title, description, base_version, base_digest, base_files, files, diff)
  values
    (v_task.project_id, v_actor, 'agent', v_task.role,
     left('Agent task: ' || v_task.objective, 200),
     left('Imported from the shared agent task board. Human review is required before merge.', 2000),
     v_version, md5(v_base::text), v_base, v_files,
     left('Agent branch files: ' || (select string_agg(b->>'path', ', ') from jsonb_array_elements(v_files) b), 200000))
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.update_app_changeset(
  p_changeset_id uuid,
  p_title text,
  p_description text,
  p_path text,
  p_content text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_changeset public.app_changesets;
  v_role text;
begin
  select * into v_changeset from public.app_changesets where id = p_changeset_id;
  if not found then raise exception 'changeset not found'; end if;
  v_role := public.app_project_role(v_changeset.project_id);
  if v_role not in ('owner', 'maintainer', 'contributor') then raise exception 'project access denied'; end if;
  if v_actor <> v_changeset.author_id and v_role not in ('owner', 'maintainer') then
    raise exception 'only the author or a maintainer can edit this changeset';
  end if;
  if v_changeset.status in ('merged', 'cancelled') then raise exception 'this changeset is closed'; end if;
  if p_path is null or p_path !~ '^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$'
     or p_path ~ '(^|/)\.\.(/|$)' or char_length(p_path) > 160
     or p_path in ('.env', '.env.local', '.env.production') then
    raise exception 'unsafe project path';
  end if;
  if p_content is null or char_length(p_content) > 60000 then raise exception 'file content is too large'; end if;

  update public.app_changesets
     set title = left(btrim(p_title), 200),
         description = left(coalesce(p_description, ''), 2000),
         files = jsonb_build_array(jsonb_build_object('path', p_path, 'content', p_content)),
         status = 'draft',
         checks = '[]'::jsonb,
         conflict_files = '[]'::jsonb,
         reviewed_digest = null,
         approved_by = null,
         approved_at = null,
         diff = '--- a/' || p_path || E'\n+++ b/' || p_path || E'\n'
   where id = p_changeset_id;

  return jsonb_build_object('ok', true, 'status', 'draft');
end;
$$;

create or replace function public.submit_app_changeset(p_changeset_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_changeset public.app_changesets;
  v_role text;
  v_review uuid;
begin
  select * into v_changeset from public.app_changesets where id = p_changeset_id;
  if not found then raise exception 'changeset not found'; end if;
  v_role := public.app_project_role(v_changeset.project_id);
  if v_actor <> v_changeset.author_id and v_role not in ('owner', 'maintainer') then
    raise exception 'only the author or a maintainer can submit this changeset';
  end if;
  if v_changeset.status not in ('draft', 'conflict') then raise exception 'this changeset is not a draft'; end if;

  update public.app_changesets
     set status = 'in_review', reviewed_digest = null
   where id = p_changeset_id;

  insert into public.app_changeset_reviews
    (changeset_id, project_id, requested_by, snapshot_digest)
  values (p_changeset_id, v_changeset.project_id, v_actor, v_changeset.content_digest)
  returning id into v_review;

  return v_review;
end;
$$;

create or replace function public.set_app_changeset_checks(
  p_changeset_id uuid,
  p_checks jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_changeset public.app_changesets;
  v_role text;
begin
  select * into v_changeset from public.app_changesets where id = p_changeset_id;
  if not found then raise exception 'changeset not found'; end if;
  v_role := public.app_project_role(v_changeset.project_id);
  if v_role not in ('owner', 'maintainer', 'contributor') then raise exception 'project access denied'; end if;
  if v_actor <> v_changeset.author_id and v_role not in ('owner', 'maintainer') then
    raise exception 'only the author or a maintainer can record checks';
  end if;
  if v_changeset.status in ('merged', 'cancelled') then raise exception 'this changeset is closed'; end if;
  if jsonb_typeof(p_checks) <> 'array' or jsonb_array_length(p_checks) not between 1 and 20 then
    raise exception 'checks must be a non-empty array';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_checks) c
     where c->>'status' not in ('passed', 'failed', 'skipped')
  ) then raise exception 'invalid check status'; end if;

  update public.app_changesets set checks = p_checks where id = p_changeset_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.review_app_changeset(
  p_changeset_id uuid,
  p_decision text,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_changeset public.app_changesets;
  v_role text;
begin
  select * into v_changeset from public.app_changesets where id = p_changeset_id;
  if not found then raise exception 'changeset not found'; end if;
  v_role := public.app_project_role(v_changeset.project_id);
  if v_role not in ('owner', 'maintainer', 'reviewer') then
    raise exception 'reviewer access required';
  end if;
  if v_actor = v_changeset.author_id then raise exception 'you cannot review your own changeset'; end if;
  if v_changeset.status <> 'in_review' then raise exception 'this changeset is not awaiting review'; end if;
  if p_decision not in ('approve', 'request_changes') then raise exception 'invalid review decision'; end if;
  if p_note is null or char_length(p_note) > 2000 then raise exception 'review note is too long'; end if;

  if p_decision = 'approve' then
    update public.app_changesets
       set status = 'approved', reviewed_digest = content_digest,
           approved_by = v_actor, approved_at = now()
     where id = p_changeset_id;
  else
    update public.app_changesets
       set status = 'rejected', reviewed_digest = null,
           approved_by = null, approved_at = null
     where id = p_changeset_id;
  end if;

  update public.app_changeset_reviews
     set status = case when p_decision = 'approve' then 'approved' else 'changes_requested' end,
         reviewer_id = v_actor,
         note = left(coalesce(p_note, ''), 2000),
         decided_at = now()
   where id = (
     select id from public.app_changeset_reviews
      where changeset_id = p_changeset_id and status = 'pending'
      order by created_at desc limit 1
   );

  return jsonb_build_object('ok', true, 'status', p_decision);
end;
$$;

create or replace function public.merge_app_changeset(p_changeset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_changeset public.app_changesets;
  v_role text;
  v_current jsonb;
  v_merged jsonb;
  v_base_found boolean;
  v_base_content text;
  v_current_found boolean;
  v_current_content text;
  v_file jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_version integer;
  v_new_version integer;
  v_new_summary text;
begin
  select * into v_changeset from public.app_changesets where id = p_changeset_id;
  if not found then raise exception 'changeset not found'; end if;
  v_role := public.app_project_role(v_changeset.project_id);
  if v_role not in ('owner', 'maintainer') then raise exception 'maintainer access required'; end if;
  if v_changeset.status <> 'approved' then raise exception 'changeset is not approved'; end if;
  if v_changeset.reviewed_digest is distinct from v_changeset.content_digest then
    raise exception 'approval is stale: the reviewed content changed';
  end if;
  if jsonb_array_length(v_changeset.checks) = 0
     or exists (select 1 from jsonb_array_elements(v_changeset.checks) c where c->>'status' <> 'passed') then
    raise exception 'integration checks must pass before merge';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('path', path, 'content', content) order by path), '[]'::jsonb)
    into v_current
    from public.app_files where project_id = v_changeset.project_id;
  if jsonb_array_length(v_current) = 0 then raise exception 'project files are missing'; end if;

  for v_file in select * from jsonb_array_elements(v_changeset.files)
  loop
    v_base_found := false;
    v_base_content := null;
    select true, b->>'content' into v_base_found, v_base_content
      from jsonb_array_elements(v_changeset.base_files) b
     where b->>'path' = v_file->>'path'
     limit 1;
    v_current_found := false;
    v_current_content := null;
    select true, c->>'content' into v_current_found, v_current_content
      from jsonb_array_elements(v_current) c
     where c->>'path' = v_file->>'path'
     limit 1;

    if v_base_found and (not v_current_found or v_current_content is distinct from v_base_content) then
      v_conflicts := v_conflicts || to_jsonb(v_file->>'path');
    elsif (not v_base_found) and v_current_found then
      v_conflicts := v_conflicts || to_jsonb(v_file->>'path');
    end if;
  end loop;

  if jsonb_array_length(v_conflicts) > 0 then
    update public.app_changesets
       set status = 'conflict', conflict_files = v_conflicts, reviewed_digest = null,
           approved_by = null, approved_at = null
     where id = p_changeset_id;
    return jsonb_build_object('ok', false, 'conflicts', v_conflicts);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('path', path, 'content', content) order by path), '[]'::jsonb)
    into v_merged
    from (
      select distinct on (path) path, content
      from (
        select value->>'path' as path, value->>'content' as content, 0 as priority
          from jsonb_array_elements(v_current) value
        union all
        select value->>'path' as path, value->>'content' as content, 1 as priority
          from jsonb_array_elements(v_changeset.files) value
      ) combined
      order by path, priority desc
    ) final_files;

  if jsonb_array_length(v_merged) not between 1 and 60 then
    raise exception 'merged project must contain 1 to 60 files';
  end if;

  select coalesce(max(version), 0) + 1 into v_new_version
    from public.app_versions where project_id = v_changeset.project_id;
  v_new_summary := left('Changeset: ' || v_changeset.title || ' — ' || v_changeset.author_kind || ' author', 500);

  insert into public.app_versions (project_id, user_id, version, summary, files)
  values (v_changeset.project_id, v_actor, v_new_version, v_new_summary, v_merged);

  delete from public.app_files where project_id = v_changeset.project_id;
  insert into public.app_files (project_id, user_id, path, content)
  select v_changeset.project_id, v_actor, item->>'path', item->>'content'
    from jsonb_array_elements(v_merged) item;

  update public.app_projects
     set current_version = v_new_version,
         status = 'generated',
         last_generation_status = 'succeeded',
         last_generation_note = left('Merged changeset: ' || v_changeset.title, 500),
         last_generated_at = now()
   where id = v_changeset.project_id;

  update public.app_changesets
     set status = 'merged', merged_version = v_new_version, conflict_files = '[]'::jsonb
   where id = p_changeset_id;

  delete from public.app_versions
   where project_id = v_changeset.project_id and version <= v_new_version - 20;

  return jsonb_build_object('ok', true, 'version', v_new_version, 'conflicts', '[]'::jsonb);
end;
$$;

create or replace function public.rebase_app_changeset(p_changeset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_changeset public.app_changesets;
  v_role text;
  v_current jsonb;
  v_version integer;
begin
  select * into v_changeset from public.app_changesets where id = p_changeset_id;
  if not found then raise exception 'changeset not found'; end if;
  v_role := public.app_project_role(v_changeset.project_id);
  if v_role not in ('owner', 'maintainer', 'contributor') then raise exception 'project access denied'; end if;
  if v_actor <> v_changeset.author_id and v_role not in ('owner', 'maintainer') then
    raise exception 'only the author or a maintainer can rebase this changeset';
  end if;
  if v_changeset.status <> 'conflict' then raise exception 'changeset is not in conflict'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('path', path, 'content', content) order by path), '[]'::jsonb)
    into v_current from public.app_files where project_id = v_changeset.project_id;
  select coalesce(max(version), 0) into v_version from public.app_versions where project_id = v_changeset.project_id;

  update public.app_changesets
     set base_files = v_current, base_version = v_version, base_digest = md5(v_current::text),
         status = 'draft', conflict_files = '[]'::jsonb, checks = '[]'::jsonb,
         reviewed_digest = null, approved_by = null, approved_at = null
   where id = p_changeset_id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.cancel_app_changeset(p_changeset_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_changeset public.app_changesets;
  v_role text;
begin
  select * into v_changeset from public.app_changesets where id = p_changeset_id;
  if not found then raise exception 'changeset not found'; end if;
  v_role := public.app_project_role(v_changeset.project_id);
  if v_actor <> v_changeset.author_id and v_role not in ('owner', 'maintainer') then
    raise exception 'only the author or a maintainer can cancel this changeset';
  end if;
  if v_changeset.status in ('merged', 'cancelled') then raise exception 'changeset is closed'; end if;

  update public.app_changesets
     set status = 'cancelled', cancelled_at = now(), reviewed_digest = null
   where id = p_changeset_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Sharing
-- ---------------------------------------------------------------------------

create or replace function public.create_app_share_link(
  p_project_id uuid,
  p_token_hash text,
  p_hours integer default 24
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_id uuid;
  v_expires timestamptz;
begin
  if public.app_project_role(p_project_id) not in ('owner', 'maintainer') then
    raise exception 'maintainer access required';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid token'; end if;
  if p_hours is null or p_hours not between 1 and 168 then raise exception 'share links last 1 to 168 hours'; end if;
  v_expires := now() + make_interval(hours => p_hours);
  insert into public.app_share_links (project_id, token_hash, created_by, expires_at)
  values (p_project_id, p_token_hash, v_actor, v_expires)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'expires_at', v_expires);
end;
$$;

create or replace function public.get_shared_app_preview(p_token_hash text)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_link public.app_share_links;
  v_spec jsonb;
  v_project public.app_projects;
begin
  select * into v_link from public.app_share_links
   where token_hash = p_token_hash and revoked_at is null and expires_at > now()
   limit 1;
  if not found then return jsonb_build_object('ok', false); end if;

  select * into v_project from public.app_projects where id = v_link.project_id;
  select s.spec into v_spec
    from public.app_specs s
   where s.project_id = v_link.project_id and s.approved_at is not null
   order by s.version desc limit 1;

  return jsonb_build_object(
    'ok', true,
    'name', v_project.name,
    'purpose', v_project.purpose,
    'version', v_project.current_version,
    'expires_at', v_link.expires_at,
    'spec', case when v_spec is null then null else jsonb_build_object(
      'purpose', v_spec->>'purpose',
      'pages', v_spec->'pages',
      'features', v_spec->'features',
      'auth', v_spec->'supabase'
    ) end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Build Room read
-- ---------------------------------------------------------------------------

create or replace function public.get_app_build_room(p_project_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_role text := public.app_project_role(p_project_id);
  v_project public.app_projects;
begin
  if v_role is null then raise exception 'project access denied'; end if;
  select * into v_project from public.app_projects where id = p_project_id;
  if not found then raise exception 'project not found'; end if;

  return jsonb_build_object(
    'role', v_role,
    'project', jsonb_build_object(
      'id', v_project.id, 'name', v_project.name, 'purpose', v_project.purpose,
      'status', v_project.status, 'current_version', v_project.current_version,
      'workspace_id', v_project.workspace_id, 'updated_at', v_project.updated_at
    ),
    'permissions', jsonb_build_object(
      'canCreateChanges', v_role in ('owner', 'maintainer', 'contributor'),
      'canReview', v_role in ('owner', 'maintainer', 'reviewer'),
      'canMerge', v_role in ('owner', 'maintainer'),
      'canManageMembers', v_role in ('owner', 'maintainer'),
      'canShare', v_role in ('owner', 'maintainer')
    ),
    'approvedSpec', (
      select jsonb_build_object('version', s.version, 'approved_at', s.approved_at, 'spec', s.spec)
        from public.app_specs s
       where s.project_id = p_project_id and s.approved_at is not null
       order by s.version desc limit 1
    ),
    'files', coalesce((
      select jsonb_agg(jsonb_build_object('path', path, 'content', content) order by path)
        from public.app_files where project_id = p_project_id
    ), '[]'::jsonb),
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object('version', version, 'summary', summary, 'created_at', created_at) order by version desc)
        from (select * from public.app_versions where project_id = p_project_id order by version desc limit 8) v
    ), '[]'::jsonb),
    'deployments', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'target', target, 'status', status, 'snapshot_version', snapshot_version, 'deployment_url', deployment_url, 'created_at', created_at) order by created_at desc)
        from (select * from public.app_deployments where project_id = p_project_id order by created_at desc limit 8) d
    ), '[]'::jsonb),
    'workspace', (
      select jsonb_build_object('status', w.status, 'expires_at', w.expires_at, 'last_error', w.last_error, 'updated_at', w.updated_at)
        from public.app_workspaces w where w.project_id = p_project_id limit 1
    ),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', x.user_id, 'role', x.role, 'status', x.status, 'display_name', x.display_name
      ) order by x.role, x.display_name)
      from (
        select p.user_id, 'owner'::text as role, 'active'::text as status,
               coalesce(pr.display_name, u.email, 'Project owner') as display_name
          from public.app_projects p
          join auth.users u on u.id = p.user_id
          left join public.profiles pr on pr.id = p.user_id
         where p.id = p_project_id
        union all
        select m.user_id, m.role, m.status,
               coalesce(pr.display_name, u.email, 'Member') as display_name
          from public.app_project_members m
          join auth.users u on u.id = m.user_id
          left join public.profiles pr on pr.id = m.user_id
         where m.project_id = p_project_id
      ) x
    ), '[]'::jsonb),
    'workspaceMembers', case when v_project.workspace_id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', x.user_id, 'role', x.role, 'display_name', x.display_name
      ) order by x.display_name)
      from (
        select wm.user_id, wm.role,
               coalesce(pr.display_name, u.email, 'Member') as display_name
          from public.workspace_members wm
          join auth.users u on u.id = wm.user_id
          left join public.profiles pr on pr.id = wm.user_id
         where wm.workspace_id = v_project.workspace_id and wm.status = 'active'
      ) x
    ), '[]'::jsonb) end,
    'tasks', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.created_at desc)
        from (select * from public.app_build_tasks where project_id = p_project_id order by created_at desc limit 60) t
    ), '[]'::jsonb),
    'agentTasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'role', role, 'objective', objective, 'status', status,
        'changed_files', changed_files, 'updated_at', updated_at
      ) order by created_at desc)
        from (select * from public.app_team_tasks where project_id = p_project_id order by created_at desc limit 40) t
    ), '[]'::jsonb),
    'changesets', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at desc)
        from (select * from public.app_changesets where project_id = p_project_id order by created_at desc limit 20) c
    ), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at desc)
        from (select * from public.app_changeset_reviews where project_id = p_project_id order by created_at desc limit 40) r
    ), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at desc)
        from (select * from public.app_build_comments where project_id = p_project_id order by created_at desc limit 60) c
    ), '[]'::jsonb),
    'presence', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', user_id, 'status', status, 'last_seen_at', last_seen_at) order by last_seen_at desc)
        from public.app_presence
       where project_id = p_project_id and last_seen_at > now() - interval '5 minutes'
    ), '[]'::jsonb),
    'shares', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'expires_at', expires_at, 'created_at', created_at) order by created_at desc)
        from public.app_share_links
       where project_id = p_project_id and revoked_at is null and expires_at > now()
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS and grants: reads only; writes go through the checked functions.
-- ---------------------------------------------------------------------------

alter table public.app_project_members enable row level security;
alter table public.app_build_tasks enable row level security;
alter table public.app_changesets enable row level security;
alter table public.app_changeset_reviews enable row level security;
alter table public.app_build_comments enable row level security;
alter table public.app_presence enable row level security;
alter table public.app_share_links enable row level security;

drop policy if exists "project members read members" on public.app_project_members;
create policy "project members read members" on public.app_project_members
  for select to authenticated using (public.app_project_role(project_id) is not null);

drop policy if exists "project members read tasks" on public.app_build_tasks;
create policy "project members read tasks" on public.app_build_tasks
  for select to authenticated using (public.app_project_role(project_id) is not null);

drop policy if exists "project members read changesets" on public.app_changesets;
create policy "project members read changesets" on public.app_changesets
  for select to authenticated using (public.app_project_role(project_id) is not null);

drop policy if exists "project members read reviews" on public.app_changeset_reviews;
create policy "project members read reviews" on public.app_changeset_reviews
  for select to authenticated using (public.app_project_role(project_id) is not null);

drop policy if exists "project members read comments" on public.app_build_comments;
create policy "project members read comments" on public.app_build_comments
  for select to authenticated using (public.app_project_role(project_id) is not null);

drop policy if exists "project members read presence" on public.app_presence;
create policy "project members read presence" on public.app_presence
  for select to authenticated using (public.app_project_role(project_id) is not null);

drop policy if exists "maintainers read share links" on public.app_share_links;
create policy "maintainers read share links" on public.app_share_links
  for select to authenticated using (public.app_project_role(project_id) in ('owner', 'maintainer'));

grant select on public.app_project_members to authenticated;
grant select on public.app_build_tasks to authenticated;
grant select on public.app_changesets to authenticated;
grant select on public.app_changeset_reviews to authenticated;
grant select on public.app_build_comments to authenticated;
grant select on public.app_presence to authenticated;
grant select on public.app_share_links to authenticated;

revoke all on public.app_project_members from anon;
revoke all on public.app_build_tasks from anon;
revoke all on public.app_changesets from anon;
revoke all on public.app_changeset_reviews from anon;
revoke all on public.app_build_comments from anon;
revoke all on public.app_presence from anon;
revoke all on public.app_share_links from anon;

revoke all on function public.app_project_role(uuid, uuid) from public, anon;
revoke all on function public.app_require_project_role(uuid, text[]) from public, anon;
grant execute on function public.app_project_role(uuid, uuid) to authenticated;
grant execute on function public.app_require_project_role(uuid, text[]) to authenticated;
grant execute on function public.link_app_workspace(uuid, uuid) to authenticated;
grant execute on function public.add_app_project_member(uuid, uuid, text) to authenticated;
grant execute on function public.remove_app_project_member(uuid, uuid) to authenticated;
grant execute on function public.create_app_build_task(uuid, text, text, text, uuid, text, jsonb) to authenticated;
grant execute on function public.cancel_app_build_task(uuid) to authenticated;
grant execute on function public.add_app_build_comment(uuid, uuid, text, text) to authenticated;
grant execute on function public.touch_app_presence(uuid) to authenticated;
grant execute on function public.create_app_changeset(uuid, text, text, text, text) to authenticated;
grant execute on function public.create_agent_changeset_from_task(uuid) to authenticated;
grant execute on function public.update_app_changeset(uuid, text, text, text, text) to authenticated;
grant execute on function public.submit_app_changeset(uuid) to authenticated;
grant execute on function public.set_app_changeset_checks(uuid, jsonb) to authenticated;
grant execute on function public.review_app_changeset(uuid, text, text) to authenticated;
grant execute on function public.merge_app_changeset(uuid) to authenticated;
grant execute on function public.rebase_app_changeset(uuid) to authenticated;
grant execute on function public.cancel_app_changeset(uuid) to authenticated;
grant execute on function public.create_app_share_link(uuid, text, integer) to authenticated;
grant execute on function public.get_shared_app_preview(text) to anon, authenticated;
grant execute on function public.get_app_build_room(uuid) to authenticated;
