-- GET TO IT — Phase 13 schema
-- Small shared workspaces: an owner, admins, members, shared goals, task
-- assignment, comments, an in-app notification inbox and an audit trail.
--
-- Ground rules encoded here (see WORKSPACES.md for the matrix):
--   * A workspace is its own data. No workspace function reads a personal goal,
--     task, saved result, reflection, learning record, focus session or AI
--     conversation. Sharing a personal goal is a copy the person confirmed,
--     recorded with source_goal_id for provenance only.
--   * Roles are written only by security-definer functions. Membership rows are
--     readable by members and writable by nobody in the browser, so a member
--     cannot promote themselves.
--   * Every read policy requires an ACTIVE membership. Removal therefore revokes
--     access on the next request, without waiting for a cache.
--   * Exactly one active owner per workspace: a partial unique index, plus a
--     transfer step that demotes the old owner in the same transaction.
--   * Notifications are created by the database, never by the browser, and each
--     one honours the recipient's own switches. The channel is the in-app inbox
--     only; there is no email, SMS or push in GET TO IT.
--   * No AI is added here. AI requests stay personal and metered by the existing
--     reserve_ai_request function; there is no workspace budget or unmetered path.

-- ---------------------------------------------------------------------------
-- 1. Workspaces and membership
-- ---------------------------------------------------------------------------

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  description text
    check (description is null or char_length(btrim(description)) between 1 and 500),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  status text not null default 'active'
    check (status in ('active', 'left', 'removed')),
  invited_by uuid references auth.users (id) on delete set null,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  removed_at timestamptz,
  removed_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- One active owner. A transfer demotes the current owner first, in the same
-- transaction, so this index can never be violated by a race.
create unique index if not exists workspace_members_one_owner_idx
  on public.workspace_members (workspace_id)
  where (role = 'owner' and status = 'active');

create index if not exists workspace_members_user_idx
  on public.workspace_members (user_id, status);
create index if not exists workspace_members_workspace_idx
  on public.workspace_members (workspace_id, status);

-- Invitations: single use, addressed to one email, seven days, token only. The
-- address is never looked up, so an invitation cannot be used to test whether an
-- account exists.
create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  inviter_id uuid references auth.users (id) on delete set null,
  invitee_email text not null
    check (char_length(btrim(invitee_email)) between 3 and 254),
  role text not null default 'member' check (role in ('admin', 'member')),
  token text not null unique
    default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  responded_at timestamptz
);

create unique index if not exists workspace_invitations_one_pending_idx
  on public.workspace_invitations (workspace_id, lower(invitee_email))
  where (status = 'pending');

-- Notification preferences, per member per workspace. Only the member reads
-- their row; only the function below writes it.
create table if not exists public.workspace_notification_prefs (
  workspace_id uuid not null,
  user_id uuid not null,
  notify_assignments boolean not null default true,
  notify_comments boolean not null default true,
  notify_membership boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  foreign key (workspace_id, user_id)
    references public.workspace_members (workspace_id, user_id) on delete cascade
);

-- Membership and permission audit. Kinds, roles and ids only: no titles, no
-- comment text, no private content of any kind.
create table if not exists public.workspace_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  kind text not null check (
    kind in (
      'workspace_created',
      'workspace_renamed',
      'member_invited',
      'invitation_cancelled',
      'member_joined',
      'role_changed',
      'member_removed',
      'member_left',
      'goal_created',
      'goal_shared'
    )
  ),
  subject_user_id uuid references auth.users (id) on delete set null,
  detail text check (detail is null or char_length(detail) <= 120),
  created_at timestamptz not null default now()
);

create index if not exists workspace_events_workspace_idx
  on public.workspace_events (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Shared goals and tasks
-- ---------------------------------------------------------------------------
-- These are workspace-owned rows. `source_goal_id` is provenance for a copy the
-- person explicitly confirmed; it grants no read access to the personal goal.

create table if not exists public.workspace_goals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  desired_outcome text not null
    check (char_length(btrim(desired_outcome)) between 1 and 2000),
  created_by uuid references auth.users (id) on delete set null,
  source_goal_id uuid references public.goals (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Needed so a task's goal can be constrained to the same workspace.
  unique (id, workspace_id)
);

create index if not exists workspace_goals_workspace_idx
  on public.workspace_goals (workspace_id, created_at desc);

create table if not exists public.workspace_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  goal_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  status public.task_status not null default 'todo',
  assignee_id uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The goal must belong to the same workspace. This is a database rule, not a
  -- convention, so a task can never bridge two workspaces.
  foreign key (goal_id, workspace_id)
    references public.workspace_goals (id, workspace_id) on delete cascade,
  unique (id, workspace_id)
);

create index if not exists workspace_tasks_workspace_idx
  on public.workspace_tasks (workspace_id, created_at asc);
create index if not exists workspace_tasks_goal_idx
  on public.workspace_tasks (goal_id, created_at asc);
create index if not exists workspace_tasks_assignee_idx
  on public.workspace_tasks (assignee_id)
  where (assignee_id is not null);

create table if not exists public.workspace_task_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null,
  author_id uuid references auth.users (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  foreign key (task_id, workspace_id)
    references public.workspace_tasks (id, workspace_id) on delete cascade
);

create index if not exists workspace_task_comments_task_idx
  on public.workspace_task_comments (task_id, created_at asc);

-- In-app notifications. The recipient is the only reader; rows are created by
-- triggers and functions, and marking one read is the only browser write.
create table if not exists public.workspace_notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('assigned', 'comment', 'role_changed', 'member_joined')),
  goal_id uuid,
  task_id uuid references public.workspace_tasks (id) on delete cascade,
  summary text not null check (char_length(btrim(summary)) between 1 and 300),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists workspace_notifications_inbox_idx
  on public.workspace_notifications (user_id, read_at, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Timestamps and triggers
-- ---------------------------------------------------------------------------

drop trigger if exists workspaces_set_updated_at on public.workspaces;
create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

drop trigger if exists workspace_members_set_updated_at on public.workspace_members;
create trigger workspace_members_set_updated_at
  before update on public.workspace_members
  for each row execute function public.set_updated_at();

drop trigger if exists workspace_notification_prefs_set_updated_at
  on public.workspace_notification_prefs;
create trigger workspace_notification_prefs_set_updated_at
  before update on public.workspace_notification_prefs
  for each row execute function public.set_updated_at();

drop trigger if exists workspace_goals_set_updated_at on public.workspace_goals;
create trigger workspace_goals_set_updated_at
  before update on public.workspace_goals
  for each row execute function public.set_updated_at();

drop trigger if exists workspace_tasks_set_updated_at on public.workspace_tasks;
create trigger workspace_tasks_set_updated_at
  before update on public.workspace_tasks
  for each row execute function public.set_updated_at();

-- Same rule as personal tasks: a completion mark and a completion time always
-- agree, and reopening clears the time.
drop trigger if exists workspace_tasks_sync_completed_at on public.workspace_tasks;
create trigger workspace_tasks_sync_completed_at
  before insert or update on public.workspace_tasks
  for each row execute function public.sync_task_completed_at();

-- Guard: the assignee must be an active member, and a plain member may only
-- assign themselves or leave the task unassigned.
create or replace function public.workspace_tasks_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
begin
  if tg_op = 'UPDATE' and new.workspace_id <> old.workspace_id then
    raise exception 'a task cannot move between workspaces'
      using errcode = 'check_violation';
  end if;

  -- Writes from the app always carry a session. A definer function repairing
  -- rows (member removal) runs with the owner's privileges and no actor, and is
  -- allowed through here because it is not changing ownership or assignment
  -- targets beyond clearing one.
  if v_actor is null then
    return new;
  end if;

  v_role := public.workspace_role(new.workspace_id);
  if v_role is null then
    raise exception 'not an active member of this workspace'
      using errcode = 'insufficient_privilege';
  end if;

  if new.assignee_id is not null then
    if not exists (
      select 1 from public.workspace_members m
       where m.workspace_id = new.workspace_id
         and m.user_id = new.assignee_id
         and m.status = 'active'
    ) then
      raise exception 'the assignee is not an active member of this workspace'
        using errcode = 'check_violation';
    end if;

    if v_role = 'member' and new.assignee_id <> v_actor then
      raise exception 'members may only assign tasks to themselves'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists workspace_tasks_guard_trigger on public.workspace_tasks;
create trigger workspace_tasks_guard_trigger
  before insert or update on public.workspace_tasks
  for each row execute function public.workspace_tasks_guard();

-- Notification on assignment. The person who assigned it is not notified, and
-- the recipient's own switch decides whether a row is created at all.
create or replace function public.workspace_task_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_enabled boolean;
begin
  if new.assignee_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then
    return new;
  end if;

  if v_actor is not null and new.assignee_id = v_actor then
    return new;
  end if;

  select coalesce(p.notify_assignments, true) into v_enabled
    from public.workspace_notification_prefs p
   where p.workspace_id = new.workspace_id
     and p.user_id = new.assignee_id;

  if not coalesce(v_enabled, true) then
    return new;
  end if;

  insert into public.workspace_notifications (
    workspace_id, user_id, kind, goal_id, task_id, summary
  )
  values (
    new.workspace_id,
    new.assignee_id,
    'assigned',
    new.goal_id,
    new.id,
    left('Assigned to you: ' || new.title, 300)
  );

  return new;
end;
$$;

drop trigger if exists workspace_tasks_notify_trigger on public.workspace_tasks;
create trigger workspace_tasks_notify_trigger
  after insert or update on public.workspace_tasks
  for each row execute function public.workspace_task_notify();

-- Notify the assignee and the task's creator about a new comment, each subject
-- to their own switch, never the author.
create or replace function public.workspace_comment_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_task public.workspace_tasks;
  v_recipient uuid;
begin
  select * into v_task
    from public.workspace_tasks
   where id = new.task_id;

  if not found then
    return new;
  end if;

  for v_recipient in
    select distinct candidate.user_id
      from (
        values (v_task.assignee_id), (v_task.created_by)
      ) as candidate (user_id)
     where candidate.user_id is not null
       and candidate.user_id is distinct from coalesce(v_actor, candidate.user_id)
       and coalesce((
         select p.notify_comments
           from public.workspace_notification_prefs p
          where p.workspace_id = new.workspace_id
            and p.user_id = candidate.user_id
       ), true)
  loop
    insert into public.workspace_notifications (
      workspace_id, user_id, kind, goal_id, task_id, summary
    )
    values (
      new.workspace_id,
      v_recipient,
      'comment',
      v_task.goal_id,
      v_task.id,
      left('New comment on ' || v_task.title, 300)
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists workspace_comments_notify_trigger on public.workspace_task_comments;
create trigger workspace_comments_notify_trigger
  after insert on public.workspace_task_comments
  for each row execute function public.workspace_comment_notify();

-- Audit trail for shared goals: a kind and an id, no content.
create or replace function public.workspace_goal_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.workspace_events (workspace_id, actor_id, kind)
  values (
    new.workspace_id,
    coalesce(auth.uid(), new.created_by),
    case when new.source_goal_id is null then 'goal_created' else 'goal_shared' end
  );
  return new;
end;
$$;

drop trigger if exists workspace_goals_audit_trigger on public.workspace_goals;
create trigger workspace_goals_audit_trigger
  after insert on public.workspace_goals
  for each row execute function public.workspace_goal_audit();

-- ---------------------------------------------------------------------------
-- 4. Role helpers
-- ---------------------------------------------------------------------------

create or replace function public.workspace_role(p_workspace_id uuid)
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select m.role
    from public.workspace_members m
   where m.workspace_id = p_workspace_id
     and m.user_id = auth.uid()
     and m.status = 'active';
$$;

-- Names for the member list and for attributing tasks and comments. Profiles are
-- private to their owner, so this is the only way a member sees a teammate's
-- display name — and only for people in the same workspace.
create or replace function public.workspace_member_directory(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_me uuid := auth.uid();
  v_rows jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if public.workspace_role(p_workspace_id) is null then
    return jsonb_build_object('ok', false, 'code', 'no-workspace');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', m.user_id,
        'display_name', coalesce(nullif(btrim(p.display_name), ''), 'Member'),
        'role', m.role,
        'status', m.status,
        'joined_at', m.joined_at
      )
      order by
        case m.role when 'owner' then 0 when 'admin' then 1 else 2 end,
        m.joined_at
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.workspace_members m
  left join public.profiles p on p.id = m.user_id
  where m.workspace_id = p_workspace_id;

  return jsonb_build_object('ok', true, 'members', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Workspace lifecycle
-- ---------------------------------------------------------------------------

create or replace function public.create_workspace(
  p_name text,
  p_description text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_id uuid;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    return jsonb_build_object('ok', false, 'code', 'invalid-name');
  end if;

  if v_description is not null and char_length(v_description) > 500 then
    return jsonb_build_object('ok', false, 'code', 'description-too-long');
  end if;

  insert into public.workspaces (name, description, created_by)
  values (v_name, v_description, v_user)
  returning id into v_id;

  insert into public.workspace_members (workspace_id, user_id, role, invited_by)
  values (v_id, v_user, 'owner', v_user);

  insert into public.workspace_notification_prefs (workspace_id, user_id)
  values (v_id, v_user);

  insert into public.workspace_events (workspace_id, actor_id, kind)
  values (v_id, v_user, 'workspace_created');

  return jsonb_build_object('ok', true, 'workspace_id', v_id);
end;
$$;

create or replace function public.update_workspace_settings(
  p_workspace_id uuid,
  p_name text,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if public.workspace_role(p_workspace_id) is distinct from 'owner' then
    return jsonb_build_object('ok', false, 'code', 'not-owner');
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    return jsonb_build_object('ok', false, 'code', 'invalid-name');
  end if;

  if v_description is not null and char_length(v_description) > 500 then
    return jsonb_build_object('ok', false, 'code', 'description-too-long');
  end if;

  update public.workspaces
     set name = v_name, description = v_description
   where id = p_workspace_id;

  insert into public.workspace_events (workspace_id, actor_id, kind)
  values (p_workspace_id, v_user, 'workspace_renamed');

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.delete_workspace(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_rows integer;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if public.workspace_role(p_workspace_id) is distinct from 'owner' then
    return jsonb_build_object('ok', false, 'code', 'not-owner');
  end if;

  -- One owner deleting their own workspace is the defined resolution for the
  -- last-owner rule. Everything workspace-owned cascades; personal rows cannot.
  delete from public.workspaces where id = p_workspace_id;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    return jsonb_build_object('ok', false, 'code', 'no-workspace');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Invitations
-- ---------------------------------------------------------------------------

create or replace function public.create_workspace_invitation(
  p_workspace_id uuid,
  p_email text,
  p_role text default 'member'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_role text := coalesce(p_role, 'member');
  v_own text;
  v_token text;
  v_expires timestamptz;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if public.workspace_role(p_workspace_id) is distinct from 'owner' then
    return jsonb_build_object('ok', false, 'code', 'not-owner');
  end if;

  if v_role not in ('admin', 'member') then
    return jsonb_build_object('ok', false, 'code', 'invalid-role');
  end if;

  if char_length(v_email) < 3
     or char_length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return jsonb_build_object('ok', false, 'code', 'invalid-email');
  end if;

  select lower(email) into v_own from auth.users where id = v_user;
  if v_email = v_own then
    return jsonb_build_object('ok', false, 'code', 'own-email');
  end if;

  if exists (
    select 1
      from public.workspace_members m
      join auth.users u on u.id = m.user_id
     where m.workspace_id = p_workspace_id
       and m.status = 'active'
       and lower(u.email) = v_email
  ) then
    return jsonb_build_object('ok', false, 'code', 'already-member');
  end if;

  update public.workspace_invitations
     set status = 'cancelled', responded_at = now()
   where workspace_id = p_workspace_id
     and status = 'pending'
     and expires_at <= now();

  if exists (
    select 1 from public.workspace_invitations
     where workspace_id = p_workspace_id
       and status = 'pending'
       and expires_at > now()
       and lower(invitee_email) = v_email
  ) then
    return jsonb_build_object('ok', false, 'code', 'already-invited');
  end if;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  insert into public.workspace_invitations (
    workspace_id, inviter_id, invitee_email, role, token
  )
  values (p_workspace_id, v_user, v_email, v_role, v_token)
  returning expires_at into v_expires;

  insert into public.workspace_events (workspace_id, actor_id, kind, detail)
  values (p_workspace_id, v_user, 'member_invited', v_role);

  return jsonb_build_object(
    'ok', true, 'token', v_token, 'expires_at', v_expires, 'role', v_role
  );
end;
$$;

-- One answer for unknown, used, expired, cancelled or wrong-account tokens: a
-- forwarded link reveals nothing about who it was for.
create or replace function public.workspace_invitation_preview(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_inv public.workspace_invitations;
  v_name text;
  v_inviter text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select lower(email) into v_email from auth.users where id = v_user;

  select * into v_inv
    from public.workspace_invitations
   where token = btrim(coalesce(p_token, ''))
     and status = 'pending'
     and expires_at > now();

  if not found or lower(v_inv.invitee_email) <> v_email then
    return jsonb_build_object('ok', false, 'code', 'invalid-invitation');
  end if;

  select w.name into v_name from public.workspaces w where w.id = v_inv.workspace_id;
  select coalesce(nullif(btrim(p.display_name), ''), 'A teammate')
    into v_inviter
    from public.profiles p where p.id = v_inv.inviter_id;

  return jsonb_build_object(
    'ok', true,
    'workspace_name', coalesce(v_name, 'a workspace'),
    'inviter_name', coalesce(v_inviter, 'A teammate'),
    'role', v_inv.role,
    'expires_at', v_inv.expires_at
  );
end;
$$;

create or replace function public.accept_workspace_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_inv public.workspace_invitations;
  v_existing public.workspace_members;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select lower(email) into v_email from auth.users where id = v_user;

  select * into v_inv
    from public.workspace_invitations
   where token = btrim(coalesce(p_token, ''))
     and status = 'pending'
     and expires_at > now();

  if not found or lower(v_inv.invitee_email) <> v_email then
    return jsonb_build_object('ok', false, 'code', 'invalid-invitation');
  end if;

  select * into v_existing
    from public.workspace_members
   where workspace_id = v_inv.workspace_id and user_id = v_user;

  if found and v_existing.status = 'active' then
    update public.workspace_invitations
       set status = 'accepted', responded_at = now()
     where id = v_inv.id;
    return jsonb_build_object(
      'ok', true, 'workspace_id', v_inv.workspace_id, 'already_member', true
    );
  end if;

  insert into public.workspace_members (
    workspace_id, user_id, role, status, invited_by
  )
  values (v_inv.workspace_id, v_user, v_inv.role, 'active', v_inv.inviter_id)
  on conflict (workspace_id, user_id) do update
    set role = excluded.role,
        status = 'active',
        invited_by = excluded.invited_by,
        joined_at = now(),
        left_at = null,
        removed_at = null,
        removed_by = null;

  insert into public.workspace_notification_prefs (workspace_id, user_id)
  values (v_inv.workspace_id, v_user)
  on conflict (workspace_id, user_id) do nothing;

  update public.workspace_invitations
     set status = 'accepted', responded_at = now()
   where id = v_inv.id;

  insert into public.workspace_events (workspace_id, actor_id, kind, subject_user_id, detail)
  values (v_inv.workspace_id, v_user, 'member_joined', v_user, v_inv.role);

  insert into public.workspace_notifications (
    workspace_id, user_id, kind, summary
  )
  select
    v_inv.workspace_id,
    m.user_id,
    'member_joined',
    'A new member joined this workspace'
    from public.workspace_members m
    left join public.workspace_notification_prefs p
      on p.workspace_id = m.workspace_id and p.user_id = m.user_id
   where m.workspace_id = v_inv.workspace_id
     and m.status = 'active'
     and m.role in ('owner', 'admin')
     and m.user_id <> v_user
     and coalesce(p.notify_membership, true);

  return jsonb_build_object('ok', true, 'workspace_id', v_inv.workspace_id);
end;
$$;

create or replace function public.decline_workspace_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_inv public.workspace_invitations;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select lower(email) into v_email from auth.users where id = v_user;

  select * into v_inv
    from public.workspace_invitations
   where token = btrim(coalesce(p_token, ''))
     and status = 'pending'
     and expires_at > now();

  if not found or lower(v_inv.invitee_email) <> v_email then
    return jsonb_build_object('ok', false, 'code', 'invalid-invitation');
  end if;

  update public.workspace_invitations
     set status = 'declined', responded_at = now()
   where id = v_inv.id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.cancel_workspace_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_inv public.workspace_invitations;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_inv
    from public.workspace_invitations
   where id = p_invitation_id and status = 'pending';

  if not found then
    return jsonb_build_object('ok', false, 'code', 'no-invitation');
  end if;

  if public.workspace_role(v_inv.workspace_id) is distinct from 'owner' then
    return jsonb_build_object('ok', false, 'code', 'not-owner');
  end if;

  update public.workspace_invitations
     set status = 'cancelled', responded_at = now()
   where id = v_inv.id;

  insert into public.workspace_events (workspace_id, actor_id, kind)
  values (v_inv.workspace_id, v_user, 'invitation_cancelled');

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Roles, removal and leaving
-- ---------------------------------------------------------------------------

create or replace function public.set_workspace_member_role(
  p_workspace_id uuid,
  p_user_id uuid,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_target public.workspace_members;
  v_notify boolean;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if public.workspace_role(p_workspace_id) is distinct from 'owner' then
    return jsonb_build_object('ok', false, 'code', 'not-owner');
  end if;

  if coalesce(p_role, '') not in ('owner', 'admin', 'member') then
    return jsonb_build_object('ok', false, 'code', 'invalid-role');
  end if;

  select * into v_target
    from public.workspace_members
   where workspace_id = p_workspace_id
     and user_id = p_user_id
     and status = 'active';

  if not found then
    return jsonb_build_object('ok', false, 'code', 'no-member');
  end if;

  -- The owner cannot demote themselves; ownership moves by promoting someone
  -- else, which demotes them in the same transaction.
  if p_user_id = v_user and p_role <> 'owner' then
    return jsonb_build_object('ok', false, 'code', 'last-owner');
  end if;

  if p_role = 'owner' then
    if v_target.role = 'owner' then
      return jsonb_build_object('ok', true);
    end if;

    update public.workspace_members
       set role = 'admin'
     where workspace_id = p_workspace_id
       and status = 'active'
       and role = 'owner';

    update public.workspace_members
       set role = 'owner'
     where workspace_id = p_workspace_id
       and user_id = p_user_id;

    insert into public.workspace_events (workspace_id, actor_id, kind, subject_user_id, detail)
    values (p_workspace_id, v_user, 'role_changed', p_user_id, 'ownership transferred');
  else
    update public.workspace_members
       set role = p_role
     where workspace_id = p_workspace_id
       and user_id = p_user_id;

    insert into public.workspace_events (workspace_id, actor_id, kind, subject_user_id, detail)
    values (p_workspace_id, v_user, 'role_changed', p_user_id, p_role);
  end if;

  select coalesce(p.notify_membership, true) into v_notify
    from public.workspace_notification_prefs p
   where p.workspace_id = p_workspace_id and p.user_id = p_user_id;

  if coalesce(v_notify, true) and p_user_id <> v_user then
    insert into public.workspace_notifications (
      workspace_id, user_id, kind, summary
    )
    values (
      p_workspace_id,
      p_user_id,
      'role_changed',
      case when p_role = 'owner'
        then 'You are now the owner of this workspace'
        else 'Your role in this workspace is now ' || p_role
      end
    );
  end if;

  return jsonb_build_object('ok', true, 'role', p_role);
end;
$$;

create or replace function public.remove_workspace_member(
  p_workspace_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_target public.workspace_members;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if public.workspace_role(p_workspace_id) is distinct from 'owner' then
    return jsonb_build_object('ok', false, 'code', 'not-owner');
  end if;

  if p_user_id = v_user then
    return jsonb_build_object('ok', false, 'code', 'use-leave');
  end if;

  select * into v_target
    from public.workspace_members
   where workspace_id = p_workspace_id
     and user_id = p_user_id
     and status = 'active';

  if not found then
    return jsonb_build_object('ok', false, 'code', 'no-member');
  end if;

  if v_target.role = 'owner' then
    return jsonb_build_object('ok', false, 'code', 'last-owner');
  end if;

  update public.workspace_members
     set status = 'removed',
         removed_at = now(),
         removed_by = v_user,
         left_at = null
   where workspace_id = p_workspace_id
     and user_id = p_user_id;

  -- Assignments are the only thing cleared. Their comments and anything they
  -- created stay with the workspace.
  update public.workspace_tasks
     set assignee_id = null
   where workspace_id = p_workspace_id
     and assignee_id = p_user_id;

  insert into public.workspace_events (workspace_id, actor_id, kind, subject_user_id, detail)
  values (p_workspace_id, v_user, 'member_removed', p_user_id, v_target.role);

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.leave_workspace(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_role text := public.workspace_role(p_workspace_id);
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if v_role is null then
    return jsonb_build_object('ok', false, 'code', 'no-member');
  end if;

  -- Defined resolution: the only owner transfers ownership first, or deletes
  -- the workspace. An owner never leaves a workspace without an owner.
  if v_role = 'owner' then
    return jsonb_build_object('ok', false, 'code', 'last-owner');
  end if;

  -- Assignments are cleared first, while the caller is still an active member:
  -- the task guard refuses writes from someone who has already left, which is
  -- exactly what should happen for a removed person.
  update public.workspace_tasks
     set assignee_id = null
   where workspace_id = p_workspace_id
     and assignee_id = v_user;

  update public.workspace_members
     set status = 'left',
         left_at = now(),
         removed_at = null,
         removed_by = null
   where workspace_id = p_workspace_id
     and user_id = v_user;

  insert into public.workspace_events (workspace_id, actor_id, kind, subject_user_id, detail)
  values (p_workspace_id, v_user, 'member_left', v_user, v_role);

  insert into public.workspace_notifications (
    workspace_id, user_id, kind, summary
  )
  select
    p_workspace_id,
    m.user_id,
    'member_joined',
    'A member left this workspace'
    from public.workspace_members m
    left join public.workspace_notification_prefs p
      on p.workspace_id = m.workspace_id and p.user_id = m.user_id
   where m.workspace_id = p_workspace_id
     and m.status = 'active'
     and m.role = 'owner'
     and m.user_id <> v_user
     and coalesce(p.notify_membership, true);

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.set_workspace_notification_prefs(
  p_workspace_id uuid,
  p_assignments boolean,
  p_comments boolean,
  p_membership boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if public.workspace_role(p_workspace_id) is null then
    return jsonb_build_object('ok', false, 'code', 'no-workspace');
  end if;

  insert into public.workspace_notification_prefs (
    workspace_id, user_id, notify_assignments, notify_comments, notify_membership
  )
  values (
    p_workspace_id,
    v_user,
    coalesce(p_assignments, true),
    coalesce(p_comments, true),
    coalesce(p_membership, true)
  )
  on conflict (workspace_id, user_id) do update
    set notify_assignments = excluded.notify_assignments,
        notify_comments = excluded.notify_comments,
        notify_membership = excluded.notify_membership,
        updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.mark_workspace_notifications_read(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  update public.workspace_notifications
     set read_at = now()
   where workspace_id = p_workspace_id
     and user_id = v_user
     and read_at is null;

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Row Level Security and grants
-- ---------------------------------------------------------------------------
-- Reads are policies. Membership writes are functions only, so a browser role
-- cannot insert a member, change a role or grant itself anything.

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invitations enable row level security;
alter table public.workspace_notification_prefs enable row level security;
alter table public.workspace_events enable row level security;
alter table public.workspace_goals enable row level security;
alter table public.workspace_tasks enable row level security;
alter table public.workspace_task_comments enable row level security;
alter table public.workspace_notifications enable row level security;

drop policy if exists "members read their workspaces" on public.workspaces;
create policy "members read their workspaces"
  on public.workspaces for select to authenticated
  using (public.workspace_role(id) is not null);

drop policy if exists "members read the member list" on public.workspace_members;
create policy "members read the member list"
  on public.workspace_members for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "owners read pending invitations" on public.workspace_invitations;
create policy "owners read pending invitations"
  on public.workspace_invitations for select to authenticated
  using (public.workspace_role(workspace_id) = 'owner');

drop policy if exists "members read their own notification prefs"
  on public.workspace_notification_prefs;
create policy "members read their own notification prefs"
  on public.workspace_notification_prefs for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "members read the activity log" on public.workspace_events;
create policy "members read the activity log"
  on public.workspace_events for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members read shared goals" on public.workspace_goals;
create policy "members read shared goals"
  on public.workspace_goals for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "admins create shared goals" on public.workspace_goals;
create policy "admins create shared goals"
  on public.workspace_goals for insert to authenticated
  with check (
    public.workspace_role(workspace_id) in ('owner', 'admin')
    and created_by = (select auth.uid())
  );

drop policy if exists "admins edit shared goals" on public.workspace_goals;
create policy "admins edit shared goals"
  on public.workspace_goals for update to authenticated
  using (public.workspace_role(workspace_id) in ('owner', 'admin'))
  with check (public.workspace_role(workspace_id) in ('owner', 'admin'));

drop policy if exists "admins delete shared goals" on public.workspace_goals;
create policy "admins delete shared goals"
  on public.workspace_goals for delete to authenticated
  using (public.workspace_role(workspace_id) in ('owner', 'admin'));

drop policy if exists "members read shared tasks" on public.workspace_tasks;
create policy "members read shared tasks"
  on public.workspace_tasks for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members add shared tasks" on public.workspace_tasks;
create policy "members add shared tasks"
  on public.workspace_tasks for insert to authenticated
  with check (
    public.workspace_role(workspace_id) is not null
    and created_by = (select auth.uid())
  );

-- Admins and owners may edit any task; a member only one assigned to them, and
-- only in a way that leaves it theirs or unassigned. The trigger above rejects a
-- member naming somebody else as assignee.
drop policy if exists "admins and assignees edit shared tasks" on public.workspace_tasks;
create policy "admins and assignees edit shared tasks"
  on public.workspace_tasks for update to authenticated
  using (
    public.workspace_role(workspace_id) in ('owner', 'admin')
    or assignee_id = (select auth.uid())
  )
  with check (
    public.workspace_role(workspace_id) in ('owner', 'admin')
    or assignee_id is null
    or assignee_id = (select auth.uid())
  );

drop policy if exists "admins delete shared tasks" on public.workspace_tasks;
create policy "admins delete shared tasks"
  on public.workspace_tasks for delete to authenticated
  using (public.workspace_role(workspace_id) in ('owner', 'admin'));

drop policy if exists "members read comments" on public.workspace_task_comments;
create policy "members read comments"
  on public.workspace_task_comments for select to authenticated
  using (public.workspace_role(workspace_id) is not null);

drop policy if exists "members write their own comments" on public.workspace_task_comments;
create policy "members write their own comments"
  on public.workspace_task_comments for insert to authenticated
  with check (
    public.workspace_role(workspace_id) is not null
    and author_id = (select auth.uid())
  );

drop policy if exists "authors and admins delete comments" on public.workspace_task_comments;
create policy "authors and admins delete comments"
  on public.workspace_task_comments for delete to authenticated
  using (
    author_id = (select auth.uid())
    or public.workspace_role(workspace_id) in ('owner', 'admin')
  );

drop policy if exists "people read their own workspace notifications"
  on public.workspace_notifications;
create policy "people read their own workspace notifications"
  on public.workspace_notifications for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "people mark their own notifications read"
  on public.workspace_notifications;
create policy "people mark their own notifications read"
  on public.workspace_notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.workspaces from anon, authenticated;
revoke all on public.workspace_members from anon, authenticated;
revoke all on public.workspace_invitations from anon, authenticated;
revoke all on public.workspace_notification_prefs from anon, authenticated;
revoke all on public.workspace_events from anon, authenticated;
revoke all on public.workspace_goals from anon, authenticated;
revoke all on public.workspace_tasks from anon, authenticated;
revoke all on public.workspace_task_comments from anon, authenticated;
revoke all on public.workspace_notifications from anon, authenticated;

grant select on public.workspaces to authenticated;
grant select on public.workspace_members to authenticated;
grant select on public.workspace_invitations to authenticated;
grant select on public.workspace_notification_prefs to authenticated;
grant select on public.workspace_events to authenticated;
grant select on public.workspace_goals to authenticated;
grant select on public.workspace_tasks to authenticated;
grant select on public.workspace_task_comments to authenticated;
grant select on public.workspace_notifications to authenticated;

-- Column grants, so a browser write cannot reach a column it has no business
-- setting (created_by, workspace_id, roles, authorship).
grant insert (workspace_id, title, desired_outcome, created_by, source_goal_id)
  on public.workspace_goals to authenticated;
grant update (title, desired_outcome, archived_at)
  on public.workspace_goals to authenticated;
grant delete on public.workspace_goals to authenticated;

grant insert (workspace_id, goal_id, title, assignee_id, created_by)
  on public.workspace_tasks to authenticated;
grant update (title, status, assignee_id)
  on public.workspace_tasks to authenticated;
grant delete on public.workspace_tasks to authenticated;

grant insert (workspace_id, task_id, author_id, body)
  on public.workspace_task_comments to authenticated;
grant delete on public.workspace_task_comments to authenticated;

grant update (read_at) on public.workspace_notifications to authenticated;

-- Functions. Every one of them re-checks the caller's role in the database.
revoke all on function public.workspace_role(uuid) from public, anon;
revoke all on function public.workspace_member_directory(uuid) from public, anon;
revoke all on function public.create_workspace(text, text) from public, anon;
revoke all on function public.update_workspace_settings(uuid, text, text) from public, anon;
revoke all on function public.delete_workspace(uuid) from public, anon;
revoke all on function public.create_workspace_invitation(uuid, text, text) from public, anon;
revoke all on function public.workspace_invitation_preview(text) from public, anon;
revoke all on function public.accept_workspace_invitation(text) from public, anon;
revoke all on function public.decline_workspace_invitation(text) from public, anon;
revoke all on function public.cancel_workspace_invitation(uuid) from public, anon;
revoke all on function public.set_workspace_member_role(uuid, uuid, text) from public, anon;
revoke all on function public.remove_workspace_member(uuid, uuid) from public, anon;
revoke all on function public.leave_workspace(uuid) from public, anon;
revoke all on function public.set_workspace_notification_prefs(uuid, boolean, boolean, boolean) from public, anon;
revoke all on function public.mark_workspace_notifications_read(uuid) from public, anon;

grant execute on function public.workspace_role(uuid) to authenticated;
grant execute on function public.workspace_member_directory(uuid) to authenticated;
grant execute on function public.create_workspace(text, text) to authenticated;
grant execute on function public.update_workspace_settings(uuid, text, text) to authenticated;
grant execute on function public.delete_workspace(uuid) to authenticated;
grant execute on function public.create_workspace_invitation(uuid, text, text) to authenticated;
grant execute on function public.workspace_invitation_preview(text) to authenticated;
grant execute on function public.accept_workspace_invitation(text) to authenticated;
grant execute on function public.decline_workspace_invitation(text) to authenticated;
grant execute on function public.cancel_workspace_invitation(uuid) to authenticated;
grant execute on function public.set_workspace_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_workspace_member(uuid, uuid) to authenticated;
grant execute on function public.leave_workspace(uuid) to authenticated;
grant execute on function public.set_workspace_notification_prefs(uuid, boolean, boolean, boolean) to authenticated;
grant execute on function public.mark_workspace_notifications_read(uuid) to authenticated;
