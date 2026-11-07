-- Expand Composio from the original GitHub/Notion pair to a managed-auth
-- catalog. The app remains the allow-list used by the UI and adapter; the
-- database catalog keeps every stored toolkit valid and makes a future
-- addition a data change instead of four constraint rewrites.
create table if not exists public.composio_toolkit_catalog (
  slug text primary key
    check (slug ~ '^[a-z][a-z0-9_]{1,40}$'),
  label text not null
    check (char_length(label) between 1 and 80),
  category text not null
    check (char_length(category) between 1 and 60),
  auth_kind text not null
    check (auth_kind in ('oauth', 'oauth_or_api_key')),
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

alter table public.composio_toolkit_catalog enable row level security;
revoke all on table public.composio_toolkit_catalog from public, anon, authenticated;

insert into public.composio_toolkit_catalog (slug, label, category, auth_kind, sort_order)
values
  ('github', 'GitHub', 'Developer tools', 'oauth', 10),
  ('notion', 'Notion', 'Productivity', 'oauth_or_api_key', 20),
  ('slack', 'Slack', 'Communication', 'oauth', 30),
  ('gmail', 'Gmail', 'Communication', 'oauth', 40),
  ('googlecalendar', 'Google Calendar', 'Scheduling', 'oauth', 50),
  ('googledrive', 'Google Drive', 'Files', 'oauth', 60),
  ('googledocs', 'Google Docs', 'Documents', 'oauth', 70),
  ('googlesheets', 'Google Sheets', 'Data', 'oauth', 80),
  ('googletasks', 'Google Tasks', 'Productivity', 'oauth', 90),
  ('googlemeet', 'Google Meet', 'Communication', 'oauth', 100),
  ('googleslides', 'Google Slides', 'Documents', 'oauth', 110),
  ('linear', 'Linear', 'Project management', 'oauth_or_api_key', 120),
  ('jira', 'Jira', 'Project management', 'oauth_or_api_key', 130),
  ('asana', 'Asana', 'Project management', 'oauth', 140),
  ('trello', 'Trello', 'Project management', 'oauth', 150),
  ('clickup', 'ClickUp', 'Project management', 'oauth_or_api_key', 160),
  ('airtable', 'Airtable', 'Data', 'oauth_or_api_key', 170),
  ('hubspot', 'HubSpot', 'CRM', 'oauth_or_api_key', 180),
  ('salesforce', 'Salesforce', 'CRM', 'oauth', 190),
  ('zendesk', 'Zendesk', 'Support', 'oauth', 200),
  ('intercom', 'Intercom', 'Support', 'oauth', 210),
  ('gorgias', 'Gorgias', 'Support', 'oauth_or_api_key', 220),
  ('discord', 'Discord', 'Communication', 'oauth', 230),
  ('microsoft_teams', 'Microsoft Teams', 'Communication', 'oauth', 240),
  ('dropbox', 'Dropbox', 'Files', 'oauth', 250),
  ('box', 'Box', 'Files', 'oauth', 260),
  ('todoist', 'Todoist', 'Productivity', 'oauth', 270),
  ('onenote', 'Microsoft OneNote', 'Productivity', 'oauth', 280),
  ('stripe', 'Stripe', 'Commerce', 'oauth_or_api_key', 290),
  ('mailchimp', 'Mailchimp', 'Marketing', 'oauth', 300),
  ('calendly', 'Calendly', 'Scheduling', 'oauth', 310),
  ('figma', 'Figma', 'Design', 'oauth_or_api_key', 320),
  ('gitlab', 'GitLab', 'Developer tools', 'oauth_or_api_key', 330),
  ('confluence', 'Confluence', 'Documents', 'oauth_or_api_key', 340),
  ('quickbooks', 'QuickBooks', 'Finance', 'oauth', 350),
  ('linkedin', 'LinkedIn', 'Marketing', 'oauth', 360),
  ('youtube', 'YouTube', 'Marketing', 'oauth', 370),
  ('google_analytics', 'Google Analytics', 'Analytics', 'oauth', 380),
  ('google_search_console', 'Google Search Console', 'Analytics', 'oauth', 390),
  ('googleads', 'Google Ads', 'Marketing', 'oauth', 400),
  ('googlebigquery', 'Google BigQuery', 'Data', 'oauth', 410),
  ('zoho_invoice', 'Zoho Invoice', 'Finance', 'oauth', 420),
  ('ynab', 'YNAB', 'Finance', 'oauth', 430),
  ('shippo', 'Shippo', 'Commerce', 'oauth_or_api_key', 440),
  ('dub', 'Dub', 'Marketing', 'oauth_or_api_key', 450)
on conflict (slug) do update
set label = excluded.label,
    category = excluded.category,
    auth_kind = excluded.auth_kind,
    sort_order = excluded.sort_order;

-- Replace the pair-specific checks with foreign keys. Existing rows are all
-- GitHub/Notion, so this is safe to apply to an existing deployment.
alter table public.app_composio_auth_attempts
  drop constraint if exists app_composio_auth_attempts_toolkit_check;
alter table public.app_composio_connections
  drop constraint if exists app_composio_connections_toolkit_check;
alter table public.app_composio_sessions
  drop constraint if exists app_composio_sessions_toolkit_check;
alter table public.app_composio_tools
  drop constraint if exists app_composio_tools_toolkit_check;

alter table public.app_composio_auth_attempts
  drop constraint if exists app_composio_auth_attempts_toolkit_fkey;
alter table public.app_composio_connections
  drop constraint if exists app_composio_connections_toolkit_fkey;
alter table public.app_composio_sessions
  drop constraint if exists app_composio_sessions_toolkit_fkey;
alter table public.app_composio_tools
  drop constraint if exists app_composio_tools_toolkit_fkey;

alter table public.app_composio_auth_attempts
  add constraint app_composio_auth_attempts_toolkit_fkey
  foreign key (toolkit) references public.composio_toolkit_catalog (slug)
  on update cascade on delete restrict;
alter table public.app_composio_connections
  add constraint app_composio_connections_toolkit_fkey
  foreign key (toolkit) references public.composio_toolkit_catalog (slug)
  on update cascade on delete restrict;
alter table public.app_composio_sessions
  add constraint app_composio_sessions_toolkit_fkey
  foreign key (toolkit) references public.composio_toolkit_catalog (slug)
  on update cascade on delete restrict;
alter table public.app_composio_tools
  add constraint app_composio_tools_toolkit_fkey
  foreign key (toolkit) references public.composio_toolkit_catalog (slug)
  on update cascade on delete restrict;

-- These two RPCs previously hard-coded the pair. The server-side adapter still
-- checks the TypeScript allow-list; this database check protects direct RPC
-- calls and stays aligned with the catalog.
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

  if not exists (
    select 1 from public.composio_toolkit_catalog t where t.slug = p_toolkit
  ) then
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

  if not exists (
    select 1 from public.composio_toolkit_catalog t where t.slug = p_toolkit
  ) then
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
