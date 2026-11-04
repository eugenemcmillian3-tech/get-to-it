-- GET TO IT — Phase 30 schema
-- A limited, versioned developer API over capabilities that already exist.
--
-- Ground rules encoded here:
--   * A credential is scoped to exactly one app project and a fixed list of
--     operations. It carries only a SHA-256 hash; the plaintext is shown once
--     by the app and never stored.
--   * Every operation re-verifies the hashed credential, the project owner and
--     the required scope inside a security-definer function. The browser's anon
--     key alone grants nothing.
--   * Rate windows and usage rows are written per key, so quotas and
--     attribution are per credential, not per account.
--   * A build job is queued and completed idempotently. Generation itself stays
--     in the app; this schema validates and stores the resulting snapshot.
--   * A deployment proposal is stored as a draft only. It cannot approve,
--     deploy, spend money or reach a provider.
--   * Webhook secrets are sealed by the app vault before they reach Postgres.
--     Deliveries have a stable id so a receiver can discard duplicates.

-- ---------------------------------------------------------------------------
-- Credentials
-- ---------------------------------------------------------------------------

create table if not exists public.app_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.app_projects (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  prefix text not null check (prefix ~ '^gti_[a-z0-9]{8}$'),
  key_hash text not null unique check (key_hash ~ '^[a-f0-9]{64}$'),
  scopes text[] not null
    check (
      array_length(scopes, 1) between 1 and 6
      and scopes <@ array[
        'projects:write', 'specs:write', 'builds:write',
        'builds:read', 'previews:read', 'deployments:propose'
      ]::text[]
    ),
  rate_limit_per_minute integer not null default 60
    check (rate_limit_per_minute between 1 and 600),
  expires_at timestamptz not null default (now() + interval '30 days'),
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.app_api_keys is
  'One project-scoped developer credential. Only a SHA-256 hash is stored; the token is shown once at creation.';
comment on column public.app_api_keys.prefix is
  'Public, non-secret identifier so a person can tell credentials apart.';

create index if not exists app_api_keys_project_idx
  on public.app_api_keys (project_id, created_at desc);
create index if not exists app_api_keys_hash_idx
  on public.app_api_keys (key_hash);

create table if not exists public.app_api_key_projects (
  key_id uuid not null references public.app_api_keys (id) on delete cascade,
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (key_id, project_id)
);

comment on table public.app_api_key_projects is
  'Projects a credential may operate on: its origin project plus any project the same key created. No other project is reachable.';

create table if not exists public.app_api_rate_windows (
  key_id uuid not null references public.app_api_keys (id) on delete cascade,
  window_start timestamptz not null,
  count integer not null default 1 check (count between 1 and 1000000),
  primary key (key_id, window_start)
);

comment on table public.app_api_rate_windows is
  'Per-minute request counts per credential. Rows are disposable; deleting a key removes its windows.';

create table if not exists public.app_api_usage (
  id uuid primary key default gen_random_uuid(),
  receipt uuid not null default gen_random_uuid(),
  key_id uuid not null references public.app_api_keys (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid not null references public.app_projects (id) on delete cascade,
  operation text not null check (char_length(btrim(operation)) between 2 and 80),
  status integer not null default 200 check (status between 100 and 599),
  error_code text check (error_code is null or char_length(error_code) <= 80),
  created_at timestamptz not null default now()
);

comment on table public.app_api_usage is
  'Append-only per-request attribution: which key called which operation and what the response status was.';

create index if not exists app_api_usage_key_idx
  on public.app_api_usage (key_id, created_at desc);
create index if not exists app_api_usage_project_idx
  on public.app_api_usage (project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Async jobs and idempotency
-- ---------------------------------------------------------------------------

create table if not exists public.app_api_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  key_id uuid not null references public.app_api_keys (id) on delete cascade,
  kind text not null default 'build' check (kind in ('build')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  spec_version integer not null check (spec_version >= 1),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  result_version integer check (result_version is null or result_version >= 1),
  file_count integer check (file_count is null or file_count between 0 and 60),
  summary text check (summary is null or char_length(summary) <= 500),
  error_code text check (error_code is null or char_length(error_code) <= 80),
  error_message text check (error_message is null or char_length(error_message) <= 1000),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, idempotency_key)
);

comment on table public.app_api_jobs is
  'A bounded deterministic build job. Polling drives completion; no shell, container or model runs here.';

create index if not exists app_api_jobs_project_idx
  on public.app_api_jobs (project_id, created_at desc);
create unique index if not exists app_api_jobs_one_active_idx
  on public.app_api_jobs (project_id)
  where status in ('queued', 'running');

drop trigger if exists app_api_jobs_set_updated_at on public.app_api_jobs;
create trigger app_api_jobs_set_updated_at before update on public.app_api_jobs
  for each row execute function public.set_updated_at();

create table if not exists public.app_api_idempotency (
  key_id uuid not null references public.app_api_keys (id) on delete cascade,
  endpoint text not null check (char_length(endpoint) between 2 and 80),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$'),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  status_code integer not null default 200 check (status_code between 100 and 599),
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  created_at timestamptz not null default now(),
  primary key (key_id, endpoint, idempotency_key)
);

comment on table public.app_api_idempotency is
  'Stored first response per credential, endpoint and Idempotency-Key. A reused key with a different body is a conflict.';

-- ---------------------------------------------------------------------------
-- Signed webhooks
-- ---------------------------------------------------------------------------

create table if not exists public.app_api_webhooks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  url text not null check (
    char_length(url) between 12 and 1000
    and (url like 'https://%' or url like 'http://localhost%' or url like 'http://127.0.0.1%')
  ),
  events text[] not null default array['build.completed', 'build.failed']::text[]
    check (
      array_length(events, 1) between 1 and 2
      and events <@ array['build.completed', 'build.failed']::text[]
    ),
  secret_sealed text not null check (char_length(secret_sealed) between 16 and 4000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, url)
);

comment on table public.app_api_webhooks is
  'A project webhook endpoint. The HMAC secret is sealed by the app vault before insertion and never returned by reads.';

drop trigger if exists app_api_webhooks_set_updated_at on public.app_api_webhooks;
create trigger app_api_webhooks_set_updated_at before update on public.app_api_webhooks
  for each row execute function public.set_updated_at();

create table if not exists public.app_api_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references public.app_api_webhooks (id) on delete cascade,
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null references public.app_api_jobs (id) on delete cascade,
  event text not null check (event in ('build.completed', 'build.failed')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'delivered', 'failed')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  last_error text check (last_error is null or char_length(last_error) <= 500),
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (webhook_id, event, job_id)
);

comment on table public.app_api_webhook_deliveries is
  'At-least-once delivery record. The stable id is the deduplication key for receivers; attempts are capped.';

create index if not exists app_api_webhook_deliveries_job_idx
  on public.app_api_webhook_deliveries (job_id, status);

-- ---------------------------------------------------------------------------
-- Internal helpers (not executable by API roles)
-- ---------------------------------------------------------------------------

-- Verifies a presented token hash, scope and project, counts the request
-- against the key's minute window, and records the usage row.
create or replace function public.api_guard(
  p_key_hash text,
  p_scope text,
  p_operation text,
  p_project_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key public.app_api_keys;
  v_window timestamptz := date_trunc('minute', now());
  v_count integer;
  v_usage_id uuid;
  v_receipt uuid;
begin
  if p_key_hash is null or p_key_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select k.* into v_key
    from public.app_api_keys k
   where k.key_hash = p_key_hash;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;
  if v_key.revoked_at is not null then
    return jsonb_build_object('ok', false, 'code', 'revoked');
  end if;
  if v_key.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'expired');
  end if;
  if p_project_id is not null
     and p_project_id <> v_key.project_id
     and not exists (
       select 1 from public.app_api_key_projects m
        where m.key_id = v_key.id and m.project_id = p_project_id
     ) then
    -- Do not reveal whether another project exists.
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not (p_scope = any (v_key.scopes)) then
    return jsonb_build_object(
      'ok', false, 'code', 'scope_denied', 'required_scope', p_scope
    );
  end if;

  insert into public.app_api_rate_windows (key_id, window_start, count)
  values (v_key.id, v_window, 1)
  on conflict (key_id, window_start)
  do update set count = public.app_api_rate_windows.count + 1
  returning count into v_count;

  if v_count > v_key.rate_limit_per_minute then
    insert into public.app_api_usage
      (key_id, user_id, project_id, operation, status, error_code)
    values
      (v_key.id, v_key.user_id, coalesce(p_project_id, v_key.project_id),
       left(p_operation, 80), 429, 'rate_limited')
    returning id into v_usage_id;

    return jsonb_build_object(
      'ok', false, 'code', 'rate_limited', 'request_id', v_usage_id,
      'limit', v_key.rate_limit_per_minute, 'retry_after_seconds', 60
    );
  end if;

  update public.app_api_keys set last_used_at = now() where id = v_key.id;

  insert into public.app_api_usage (key_id, user_id, project_id, operation)
  values (v_key.id, v_key.user_id, coalesce(p_project_id, v_key.project_id),
          left(p_operation, 80))
  returning id, receipt into v_usage_id, v_receipt;

  return jsonb_build_object(
    'ok', true,
    'key_id', v_key.id,
    'user_id', v_key.user_id,
    'project_id', v_key.project_id,
    'request_id', v_usage_id,
    'receipt', v_receipt,
    'rate_limit', v_key.rate_limit_per_minute,
    'rate_remaining', greatest(v_key.rate_limit_per_minute - v_count, 0)
  );
end;
$$;

comment on function public.api_guard(text, text, text, uuid) is
  'Internal credential, scope, project and rate check. Called only by operation functions.';

-- Records the real outcome against the request row. The per-request receipt
-- prevents one caller from rewriting another caller's usage.
create or replace function public.api_record_outcome(
  p_usage_id uuid,
  p_receipt uuid,
  p_status integer,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.app_api_usage
     set status = greatest(100, least(599, coalesce(p_status, 500))),
         error_code = left(nullif(btrim(coalesce(p_error_code, '')), ''), 80)
   where id = p_usage_id and receipt = p_receipt;
  return found;
end;
$$;

create or replace function public.api_idem_start(
  p_key_id uuid,
  p_endpoint text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.app_api_idempotency;
begin
  select * into v_row
    from public.app_api_idempotency
   where key_id = p_key_id
     and endpoint = p_endpoint
     and idempotency_key = p_idempotency_key;

  if not found then
    return jsonb_build_object('state', 'new');
  end if;
  if v_row.request_hash <> p_request_hash then
    return jsonb_build_object('state', 'conflict');
  end if;
  return jsonb_build_object(
    'state', 'replay',
    'response', v_row.response,
    'status', v_row.status_code
  );
end;
$$;

create or replace function public.api_idem_store(
  p_key_id uuid,
  p_endpoint text,
  p_idempotency_key text,
  p_request_hash text,
  p_response jsonb,
  p_status integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.app_api_idempotency
    (key_id, endpoint, idempotency_key, request_hash, response, status_code)
  values
    (p_key_id, p_endpoint, p_idempotency_key, p_request_hash, p_response, p_status)
  on conflict do nothing;
end;
$$;

-- Validates and stores a generated file set for a job. Mirrors the path and
-- size rules of replace_app_files(), but writes for the credential's owner
-- rather than auth.uid(), because an API request has no cookie session.
create or replace function public.api_write_snapshot(
  p_project_id uuid,
  p_user_id uuid,
  p_files jsonb,
  p_summary text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer;
  v_file jsonb;
begin
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
  values (p_project_id, p_user_id, v_version,
          left(coalesce(nullif(btrim(p_summary), ''), 'API build'), 500), p_files);

  delete from public.app_files where project_id = p_project_id;

  insert into public.app_files (project_id, user_id, path, content)
  select p_project_id, p_user_id, item ->> 'path', item ->> 'content'
    from jsonb_array_elements(p_files) as item;

  update public.app_projects
     set current_version = v_version,
         status = 'generated',
         last_generation_status = 'succeeded',
         last_generation_note = left(coalesce(p_summary, 'API build'), 500),
         last_generated_at = now()
   where id = p_project_id;

  delete from public.app_versions
   where project_id = p_project_id
     and version <= v_version - 20;

  return v_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- Operation: create a project
-- ---------------------------------------------------------------------------

create or replace function public.api_create_project(
  p_key_hash text,
  p_idempotency_key text,
  p_request_hash text,
  p_intake jsonb,
  p_spec jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guard jsonb;
  v_idem jsonb;
  v_project_id uuid;
  v_spec_id uuid;
  v_response jsonb;
begin
  v_guard := public.api_guard(p_key_hash, 'projects:write', 'projects.create', null);
  if not (v_guard ->> 'ok')::boolean then
    return v_guard;
  end if;

  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    return jsonb_build_object(
      'ok', false, 'code', 'idempotency_key_required',
      'message', 'Send an Idempotency-Key header of 8 to 128 letters, digits, underscores or dashes.',
      'request_id', v_guard ->> 'request_id'
    );
  end if;

  v_idem := public.api_idem_start(
    (v_guard ->> 'key_id')::uuid, 'projects.create', p_idempotency_key, p_request_hash
  );
  if v_idem ->> 'state' = 'conflict' then
    return jsonb_build_object(
      'ok', false, 'code', 'idempotency_conflict',
      'message', 'That Idempotency-Key was already used with a different request body.',
      'request_id', v_guard ->> 'request_id'
    );
  end if;
  if v_idem ->> 'state' = 'replay' then
    return (v_idem -> 'response') || jsonb_build_object(
      'replayed', true, 'request_id', v_guard ->> 'request_id'
    );
  end if;

  if jsonb_typeof(p_intake) <> 'object' or jsonb_typeof(p_spec) <> 'object' then
    return jsonb_build_object(
      'ok', false, 'code', 'invalid_request',
      'message', 'The intake and specification must be JSON objects.',
      'request_id', v_guard ->> 'request_id'
    );
  end if;

  begin
    insert into public.app_projects (
      user_id, name, purpose, target_users, workflows, required_pages,
      entities, auth_requirements, integrations, design_preferences,
      definition_of_done, status
    )
    values (
      (v_guard ->> 'user_id')::uuid,
      p_intake ->> 'name',
      p_intake ->> 'purpose',
      p_intake ->> 'target_users',
      p_intake ->> 'workflows',
      p_intake ->> 'required_pages',
      coalesce(p_intake ->> 'entities', ''),
      p_intake ->> 'auth_requirements',
      coalesce(p_intake ->> 'integrations', ''),
      coalesce(p_intake ->> 'design_preferences', ''),
      p_intake ->> 'definition_of_done',
      'spec_draft'
    )
    returning id into v_project_id;

    insert into public.app_specs (project_id, user_id, version, spec)
    values (v_project_id, (v_guard ->> 'user_id')::uuid, 1, p_spec)
    returning id into v_spec_id;

    -- The creating credential may continue with this project. This never grants
    -- access to a different existing project.
    insert into public.app_api_key_projects (key_id, project_id, user_id)
    values ((v_guard ->> 'key_id')::uuid, v_project_id, (v_guard ->> 'user_id')::uuid)
    on conflict do nothing;
  exception
    when others then
      return jsonb_build_object(
        'ok', false, 'code', 'invalid_request',
        'message', 'The project could not be created from that intake. Nothing was stored.',
        'request_id', v_guard ->> 'request_id'
      );
  end;

  v_response := jsonb_build_object(
    'ok', true,
    'project', jsonb_build_object(
      'id', v_project_id,
      'name', p_intake ->> 'name',
      'status', 'spec_draft',
      'current_version', 0
    ),
    'specification', jsonb_build_object(
      'id', v_spec_id, 'version', 1, 'approved', false
    ),
    'request_id', v_guard ->> 'request_id'
  );

  perform public.api_idem_store(
    (v_guard ->> 'key_id')::uuid, 'projects.create',
    p_idempotency_key, p_request_hash, v_response, 201
  );

  return v_response || jsonb_build_object('replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Operation: submit or update a specification
-- ---------------------------------------------------------------------------

create or replace function public.api_save_spec(
  p_key_hash text,
  p_project_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_spec jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guard jsonb;
  v_idem jsonb;
  v_version integer;
  v_spec_id uuid;
  v_response jsonb;
begin
  v_guard := public.api_guard(
    p_key_hash, 'specs:write', 'specs.write', p_project_id
  );
  if not (v_guard ->> 'ok')::boolean then
    return v_guard;
  end if;

  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    return jsonb_build_object(
      'ok', false, 'code', 'idempotency_key_required',
      'message', 'Send an Idempotency-Key header of 8 to 128 letters, digits, underscores or dashes.',
      'request_id', v_guard ->> 'request_id'
    );
  end if;

  v_idem := public.api_idem_start(
    (v_guard ->> 'key_id')::uuid, 'specs.write:' || p_project_id::text,
    p_idempotency_key, p_request_hash
  );
  if v_idem ->> 'state' = 'conflict' then
    return jsonb_build_object(
      'ok', false, 'code', 'idempotency_conflict',
      'message', 'That Idempotency-Key was already used with a different request body.',
      'request_id', v_guard ->> 'request_id'
    );
  end if;
  if v_idem ->> 'state' = 'replay' then
    return (v_idem -> 'response') || jsonb_build_object(
      'replayed', true, 'request_id', v_guard ->> 'request_id'
    );
  end if;

  if jsonb_typeof(p_spec) <> 'object' then
    return jsonb_build_object(
      'ok', false, 'code', 'invalid_request',
      'message', 'The specification must be a JSON object.',
      'request_id', v_guard ->> 'request_id'
    );
  end if;

  select coalesce(max(version), 0) + 1 into v_version
    from public.app_specs where project_id = p_project_id;

  insert into public.app_specs (project_id, user_id, version, spec)
  values (p_project_id, (v_guard ->> 'user_id')::uuid, v_version, p_spec)
  returning id into v_spec_id;

  -- A new draft never disturbs an existing approved version, but it does mean
  -- the project is no longer approved for generation until this one is approved.
  update public.app_projects
     set status = 'spec_draft'
   where id = p_project_id;

  v_response := jsonb_build_object(
    'ok', true,
    'specification', jsonb_build_object(
      'id', v_spec_id, 'version', v_version, 'approved', false
    ),
    'project', jsonb_build_object(
      'id', p_project_id, 'status', 'spec_draft'
    ),
    'request_id', v_guard ->> 'request_id'
  );

  perform public.api_idem_store(
    (v_guard ->> 'key_id')::uuid, 'specs.write:' || p_project_id::text,
    p_idempotency_key, p_request_hash, v_response, 201
  );

  return v_response || jsonb_build_object('replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Operation: start, read and cancel build jobs
-- ---------------------------------------------------------------------------

create or replace function public.api_start_build_job(
  p_key_hash text,
  p_project_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guard jsonb;
  v_idem jsonb;
  v_spec_version integer;
  v_job public.app_api_jobs;
  v_active public.app_api_jobs;
  v_response jsonb;
begin
  v_guard := public.api_guard(
    p_key_hash, 'builds:write', 'builds.start', p_project_id
  );
  if not (v_guard ->> 'ok')::boolean then
    return v_guard;
  end if;

  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    return jsonb_build_object(
      'ok', false, 'code', 'idempotency_key_required',
      'message', 'Send an Idempotency-Key header of 8 to 128 letters, digits, underscores or dashes.',
      'request_id', v_guard ->> 'request_id'
    );
  end if;

  v_idem := public.api_idem_start(
    (v_guard ->> 'key_id')::uuid, 'builds.start:' || p_project_id::text,
    p_idempotency_key, p_request_hash
  );
  if v_idem ->> 'state' = 'conflict' then
    return jsonb_build_object(
      'ok', false, 'code', 'idempotency_conflict',
      'message', 'That Idempotency-Key was already used with a different request body.',
      'request_id', v_guard ->> 'request_id'
    );
  end if;
  if v_idem ->> 'state' = 'replay' then
    return (v_idem -> 'response') || jsonb_build_object(
      'replayed', true, 'request_id', v_guard ->> 'request_id'
    );
  end if;

  select coalesce(max(version), 0) into v_spec_version
    from public.app_specs
   where project_id = p_project_id and approved_at is not null;

  if v_spec_version = 0 then
    return jsonb_build_object(
      'ok', false, 'code', 'spec_not_approved',
      'message', 'Approve a specification in the web app before starting a build job.',
      'request_id', v_guard ->> 'request_id'
    );
  end if;

  select * into v_active
    from public.app_api_jobs
   where project_id = p_project_id and status in ('queued', 'running')
   limit 1;

  if found then
    return jsonb_build_object(
      'ok', false, 'code', 'build_in_progress',
      'message', 'This project already has an active build job. Poll it before starting another.',
      'job', jsonb_build_object('id', v_active.id, 'status', v_active.status),
      'request_id', v_guard ->> 'request_id'
    );
  end if;

  begin
    insert into public.app_api_jobs
      (project_id, user_id, key_id, kind, status, spec_version,
       idempotency_key, request_hash)
    values
      (p_project_id, (v_guard ->> 'user_id')::uuid, (v_guard ->> 'key_id')::uuid,
       'build', 'queued', v_spec_version, p_idempotency_key, p_request_hash)
    returning * into v_job;
  exception
    when unique_violation then
      select * into v_active
        from public.app_api_jobs
       where project_id = p_project_id and status in ('queued', 'running')
       limit 1;
      return jsonb_build_object(
        'ok', false, 'code', 'build_in_progress',
        'message', 'This project already has an active build job. Poll it before starting another.',
        'job', case when v_active.id is null then null
          else jsonb_build_object('id', v_active.id, 'status', v_active.status) end,
        'request_id', v_guard ->> 'request_id'
      );
  end;

  v_response := jsonb_build_object(
    'ok', true,
    'job', jsonb_build_object(
      'id', v_job.id,
      'status', v_job.status,
      'kind', v_job.kind,
      'project_id', v_job.project_id,
      'spec_version', v_job.spec_version,
      'created_at', v_job.created_at
    ),
    'request_id', v_guard ->> 'request_id'
  );

  perform public.api_idem_store(
    (v_guard ->> 'key_id')::uuid, 'builds.start:' || p_project_id::text,
    p_idempotency_key, p_request_hash, v_response, 202
  );

  return v_response || jsonb_build_object('replayed', false);
end;
$$;

create or replace function public.api_claim_job(
  p_key_hash text,
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guard jsonb;
  v_project_id uuid;
  v_job public.app_api_jobs;
  v_spec jsonb;
  v_project_name text;
  v_purpose text;
begin
  select j.project_id into v_project_id
    from public.app_api_jobs j where j.id = p_job_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  v_guard := public.api_guard(
    p_key_hash, 'builds:write', 'jobs.claim', v_project_id
  );
  if not (v_guard ->> 'ok')::boolean then
    return v_guard;
  end if;

  select * into v_job
    from public.app_api_jobs
   where id = p_job_id
     for update;

  if v_job.status in ('succeeded', 'failed', 'canceled') then
    return jsonb_build_object(
      'ok', false, 'code', 'job_not_claimable',
      'job', jsonb_build_object('id', v_job.id, 'status', v_job.status),
      'request_id', v_guard ->> 'request_id'
    );
  end if;

  -- A run that never finished (for example a crashed request) is retried once
  -- the bounded window has passed. Deterministic generation makes that safe.
  if v_job.status = 'running' and v_job.started_at > now() - interval '2 minutes' then
    return jsonb_build_object(
      'ok', false, 'code', 'job_not_claimable',
      'job', jsonb_build_object('id', v_job.id, 'status', v_job.status),
      'request_id', v_guard ->> 'request_id'
    );
  end if;

  select p.name, p.purpose into v_project_name, v_purpose
    from public.app_projects p where p.id = v_job.project_id;

  select s.spec into v_spec
    from public.app_specs s
   where s.project_id = v_job.project_id
     and s.version = v_job.spec_version
     and s.approved_at is not null;

  if v_spec is null then
    update public.app_api_jobs
       set status = 'failed', error_code = 'spec_not_approved',
           error_message = 'The approved specification version no longer exists.',
           finished_at = now()
     where id = v_job.id;
    return jsonb_build_object(
      'ok', false, 'code', 'spec_not_approved',
      'request_id', v_guard ->> 'request_id'
    );
  end if;

  update public.app_api_jobs
     set status = 'running', started_at = now()
   where id = v_job.id;

  return jsonb_build_object(
    'ok', true,
    'job', jsonb_build_object(
      'id', v_job.id, 'status', 'running', 'spec_version', v_job.spec_version
    ),
    'project', jsonb_build_object(
      'id', v_job.project_id, 'name', v_project_name, 'purpose', v_purpose
    ),
    'spec', v_spec,
    'request_id', v_guard ->> 'request_id'
  );
end;
$$;

-- Fan out one delivery row per matching webhook. The payload is the same body
-- the app signs; the sealed secrets are returned to the server-side caller only.
create or replace function public.api_queue_webhook_deliveries(
  p_job public.app_api_jobs,
  p_event text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  insert into public.app_api_webhook_deliveries
    (webhook_id, project_id, user_id, job_id, event, payload)
  select w.id, w.project_id, w.user_id, p_job.id, p_event, p_payload
    from public.app_api_webhooks w
   where w.project_id = p_job.project_id
     and w.user_id = p_job.user_id
     and w.active
     and p_event = any (w.events)
  on conflict (webhook_id, event, job_id) do nothing;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id,
           'webhook_id', w.id,
           'event', d.event,
           'url', w.url,
           'secret_sealed', w.secret_sealed,
           'payload', d.payload,
           'attempts', d.attempts
         ) order by d.created_at), '[]'::jsonb)
    into v_result
    from public.app_api_webhook_deliveries d
    join public.app_api_webhooks w on w.id = d.webhook_id
   where d.job_id = p_job.id
     and d.event = p_event
     and d.status in ('pending', 'failed')
     and d.attempts < 5;

  return v_result;
end;
$$;

create or replace function public.api_complete_job(
  p_key_hash text,
  p_job_id uuid,
  p_files jsonb,
  p_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guard jsonb;
  v_project_id uuid;
  v_job public.app_api_jobs;
  v_version integer;
  v_file_count integer;
  v_payload jsonb;
  v_deliveries jsonb;
begin
  select j.project_id into v_project_id
    from public.app_api_jobs j where j.id = p_job_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  v_guard := public.api_guard(
    p_key_hash, 'builds:write', 'jobs.complete', v_project_id
  );
  if not (v_guard ->> 'ok')::boolean then
    return v_guard;
  end if;

  select * into v_job
    from public.app_api_jobs
   where id = p_job_id
   for update;

  if v_job.status = 'succeeded' then
    return jsonb_build_object(
      'ok', true, 'job', jsonb_build_object(
        'id', v_job.id, 'status', 'succeeded',
        'result_version', v_job.result_version, 'file_count', v_job.file_count
      ),
      'deliveries', '[]'::jsonb,
      'request_id', v_guard ->> 'request_id'
    );
  end if;
  if v_job.status not in ('queued', 'running') then
    return jsonb_build_object(
      'ok', false, 'code', 'job_not_completable',
      'job', jsonb_build_object('id', v_job.id, 'status', v_job.status),
      'request_id', v_guard ->> 'request_id'
    );
  end if;

  begin
    v_version := public.api_write_snapshot(
      v_job.project_id, v_job.user_id, p_files, p_summary
    );
  exception
    when others then
      update public.app_api_jobs
         set status = 'failed', error_code = 'invalid_artifacts',
             error_message = 'The generated file set was refused by validation.',
             finished_at = now()
       where id = v_job.id;
      v_payload := jsonb_build_object(
        'event', 'build.failed',
        'job_id', v_job.id,
        'project_id', v_job.project_id,
        'error', jsonb_build_object(
          'code', 'invalid_artifacts',
          'message', 'The generated file set was refused by validation.'
        )
      );
      v_deliveries := public.api_queue_webhook_deliveries(
        v_job, 'build.failed', v_payload
      );
      return jsonb_build_object(
        'ok', false, 'code', 'invalid_artifacts',
        'message', 'The generated file set was refused. The last usable snapshot was kept.',
        'deliveries', v_deliveries,
        'request_id', v_guard ->> 'request_id'
      );
  end;

  v_file_count := jsonb_array_length(p_files);

  update public.app_api_jobs
     set status = 'succeeded',
         result_version = v_version,
         file_count = v_file_count,
         summary = left(coalesce(p_summary, 'API build'), 500),
         error_code = null,
         error_message = null,
         finished_at = now()
   where id = v_job.id
  returning * into v_job;

  v_payload := jsonb_build_object(
    'event', 'build.completed',
    'job_id', v_job.id,
    'project_id', v_job.project_id,
    'specification_version', v_job.spec_version,
    'result_version', v_version,
    'file_count', v_file_count
  );

  v_deliveries := public.api_queue_webhook_deliveries(
    v_job, 'build.completed', v_payload
  );

  return jsonb_build_object(
    'ok', true,
    'job', jsonb_build_object(
      'id', v_job.id, 'status', 'succeeded',
      'spec_version', v_job.spec_version,
      'result_version', v_version, 'file_count', v_file_count
    ),
    'deliveries', v_deliveries,
    'request_id', v_guard ->> 'request_id'
  );
end;
$$;

create or replace function public.api_fail_job(
  p_key_hash text,
  p_job_id uuid,
  p_error_code text,
  p_error_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guard jsonb;
  v_project_id uuid;
  v_job public.app_api_jobs;
  v_payload jsonb;
  v_deliveries jsonb;
begin
  select j.project_id into v_project_id
    from public.app_api_jobs j where j.id = p_job_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  v_guard := public.api_guard(
    p_key_hash, 'builds:write', 'jobs.fail', v_project_id
  );
  if not (v_guard ->> 'ok')::boolean then
    return v_guard;
  end if;

  select * into v_job
    from public.app_api_jobs
   where id = p_job_id
   for update;

  if v_job.status = 'succeeded' then
    return jsonb_build_object(
      'ok', false, 'code', 'job_not_completable',
      'job', jsonb_build_object('id', v_job.id, 'status', v_job.status),
      'request_id', v_guard ->> 'request_id'
    );
  end if;

  if v_job.status in ('queued', 'running') then
    update public.app_api_jobs
       set status = 'failed',
           error_code = left(coalesce(nullif(btrim(p_error_code), ''), 'build_failed'), 80),
           error_message = left(coalesce(p_error_message, 'The build failed.'), 1000),
           finished_at = now()
     where id = v_job.id
    returning * into v_job;
  end if;

  v_payload := jsonb_build_object(
    'event', 'build.failed',
    'job_id', v_job.id,
    'project_id', v_job.project_id,
    'error', jsonb_build_object(
      'code', v_job.error_code,
      'message', v_job.error_message
    )
  );

  v_deliveries := public.api_queue_webhook_deliveries(
    v_job, 'build.failed', v_payload
  );

  return jsonb_build_object(
    'ok', true,
    'job', jsonb_build_object(
      'id', v_job.id, 'status', 'failed',
      'error', jsonb_build_object('code', v_job.error_code, 'message', v_job.error_message)
    ),
    'deliveries', v_deliveries,
    'request_id', v_guard ->> 'request_id'
  );
end;
$$;

create or replace function public.api_get_job(
  p_key_hash text,
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guard jsonb;
  v_project_id uuid;
  v_job public.app_api_jobs;
  v_deliveries jsonb;
begin
  select j.project_id into v_project_id
    from public.app_api_jobs j where j.id = p_job_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  v_guard := public.api_guard(
    p_key_hash, 'builds:read', 'jobs.read', v_project_id
  );
  if not (v_guard ->> 'ok')::boolean then
    return v_guard;
  end if;

  select * into v_job from public.app_api_jobs where id = p_job_id;

  -- A crashed run must not stay "running" forever. It is failed, not retried
  -- behind the caller's back; starting a new job is an explicit decision.
  if v_job.status = 'running' and v_job.started_at < now() - interval '2 minutes' then
    update public.app_api_jobs
       set status = 'failed', error_code = 'interrupted',
           error_message = 'The build run did not finish within two minutes. Start a new job.',
           finished_at = now()
     where id = v_job.id
    returning * into v_job;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'webhook_id', w.id, 'event', d.event, 'url', w.url,
           'secret_sealed', w.secret_sealed, 'payload', d.payload,
           'attempts', d.attempts
         ) order by d.created_at), '[]'::jsonb)
    into v_deliveries
    from public.app_api_webhook_deliveries d
    join public.app_api_webhooks w on w.id = d.webhook_id
   where d.job_id = v_job.id
     and d.status in ('pending', 'failed')
     and d.attempts < 5;

  return jsonb_build_object(
    'ok', true,
    'job', jsonb_build_object(
      'id', v_job.id,
      'status', v_job.status,
      'kind', v_job.kind,
      'project_id', v_job.project_id,
      'spec_version', v_job.spec_version,
      'result_version', v_job.result_version,
      'file_count', v_job.file_count,
      'summary', v_job.summary,
      'error', case when v_job.error_code is null then null
        else jsonb_build_object('code', v_job.error_code, 'message', v_job.error_message)
      end,
      'created_at', v_job.created_at,
      'started_at', v_job.started_at,
      'finished_at', v_job.finished_at
    ),
    'deliveries', v_deliveries,
    'request_id', v_guard ->> 'request_id'
  );
end;
$$;

create or replace function public.api_cancel_job(
  p_key_hash text,
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guard jsonb;
  v_project_id uuid;
  v_job public.app_api_jobs;
begin
  select j.project_id into v_project_id
    from public.app_api_jobs j where j.id = p_job_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  v_guard := public.api_guard(
    p_key_hash, 'builds:write', 'jobs.cancel', v_project_id
  );
  if not (v_guard ->> 'ok')::boolean then
    return v_guard;
  end if;

  select * into v_job from public.app_api_jobs where id = p_job_id for update;

  if v_job.status <> 'queued' then
    return jsonb_build_object(
      'ok', false, 'code', 'job_not_cancelable',
      'message', 'Only a queued job can be canceled. A running build is bounded and already finishing.',
      'job', jsonb_build_object('id', v_job.id, 'status', v_job.status),
      'request_id', v_guard ->> 'request_id'
    );
  end if;

  update public.app_api_jobs
     set status = 'canceled', finished_at = now(),
         error_code = 'canceled', error_message = 'Canceled by the API caller.'
   where id = v_job.id;

  return jsonb_build_object(
    'ok', true,
    'job', jsonb_build_object('id', v_job.id, 'status', 'canceled'),
    'request_id', v_guard ->> 'request_id'
  );
end;
$$;

create or replace function public.api_get_artifacts(
  p_key_hash text,
  p_job_id uuid,
  p_limit integer default 25,
  p_cursor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guard jsonb;
  v_project_id uuid;
  v_job public.app_api_jobs;
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 60));
  v_files jsonb;
  v_next text;
begin
  select j.project_id into v_project_id
    from public.app_api_jobs j where j.id = p_job_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  v_guard := public.api_guard(
    p_key_hash, 'builds:read', 'artifacts.read', v_project_id
  );
  if not (v_guard ->> 'ok')::boolean then
    return v_guard;
  end if;

  select * into v_job from public.app_api_jobs where id = p_job_id;

  if v_job.status <> 'succeeded' or v_job.result_version is null then
    return jsonb_build_object(
      'ok', false, 'code', 'artifacts_not_ready',
      'message', 'Artifacts exist only after a build job succeeds.',
      'job', jsonb_build_object('id', v_job.id, 'status', v_job.status),
      'request_id', v_guard ->> 'request_id'
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'path', item ->> 'path', 'content', item ->> 'content'
         ) order by item ->> 'path'), '[]'::jsonb)
    into v_files
    from (
      select item
        from public.app_versions v,
             jsonb_array_elements(v.files) as item
       where v.project_id = v_job.project_id
         and v.version = v_job.result_version
         and (p_cursor is null or (item ->> 'path') > p_cursor)
       order by item ->> 'path'
       limit v_limit + 1
    ) page;

  if jsonb_array_length(v_files) > v_limit then
    v_next := v_files -> (v_limit - 1) ->> 'path';
    v_files := (
      select coalesce(jsonb_agg(item order by item ->> 'path'), '[]'::jsonb)
        from (
          select item from jsonb_array_elements(v_files) as item limit v_limit
        ) kept
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'job_id', v_job.id,
    'version', v_job.result_version,
    'file_count', v_job.file_count,
    'files', v_files,
    'next_cursor', v_next,
    'request_id', v_guard ->> 'request_id'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Operation: read project context and list jobs
-- ---------------------------------------------------------------------------

create or replace function public.api_project_context(
  p_key_hash text,
  p_project_id uuid,
  p_scope text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guard jsonb;
  v_project public.app_projects;
  v_latest jsonb;
  v_approved jsonb;
begin
  v_guard := public.api_guard(
    p_key_hash, p_scope, 'project.context', p_project_id
  );
  if not (v_guard ->> 'ok')::boolean then
    return v_guard;
  end if;

  select * into v_project
    from public.app_projects
   where id = p_project_id and user_id = (v_guard ->> 'user_id')::uuid;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select jsonb_build_object(
           'id', s.id, 'version', s.version,
           'spec', s.spec, 'approved', s.approved_at is not null
         )
    into v_latest
    from public.app_specs s
   where s.project_id = p_project_id
   order by s.version desc
   limit 1;

  select jsonb_build_object(
           'id', s.id, 'version', s.version, 'spec', s.spec
         )
    into v_approved
    from public.app_specs s
   where s.project_id = p_project_id and s.approved_at is not null
   order by s.version desc
   limit 1;

  return jsonb_build_object(
    'ok', true,
    'project', jsonb_build_object(
      'id', v_project.id, 'name', v_project.name, 'status', v_project.status,
      'purpose', v_project.purpose, 'target_users', v_project.target_users,
      'workflows', v_project.workflows, 'required_pages', v_project.required_pages,
      'entities', v_project.entities,
      'auth_requirements', v_project.auth_requirements,
      'integrations', v_project.integrations,
      'design_preferences', v_project.design_preferences,
      'definition_of_done', v_project.definition_of_done,
      'current_version', v_project.current_version
    ),
    'latest_specification', v_latest,
    'approved_specification', v_approved,
    'request_id', v_guard ->> 'request_id'
  );
end;
$$;

create or replace function public.api_list_jobs(
  p_key_hash text,
  p_project_id uuid,
  p_limit integer default 20,
  p_cursor_created timestamptz default null,
  p_cursor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guard jsonb;
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
  v_rows jsonb;
  v_next_created timestamptz;
  v_next_id text;
  v_has_more boolean;
begin
  v_guard := public.api_guard(
    p_key_hash, 'builds:read', 'jobs.list', p_project_id
  );
  if not (v_guard ->> 'ok')::boolean then
    return v_guard;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'status', status, 'spec_version', spec_version,
           'result_version', result_version, 'file_count', file_count,
           'error_code', error_code, 'created_at', created_at,
           'finished_at', finished_at
         ) order by created_at desc, id desc) filter (where rn <= v_limit), '[]'::jsonb),
         max(created_at) filter (where rn = v_limit),
         max(id::text) filter (where rn = v_limit),
         bool_or(rn > v_limit)
    into v_rows, v_next_created, v_next_id, v_has_more
    from (
      select *, row_number() over (order by created_at desc, id desc) as rn
        from public.app_api_jobs
       where project_id = p_project_id
         and (p_cursor_created is null
              or (created_at, id) < (p_cursor_created, p_cursor_id))
       order by created_at desc, id desc
       limit v_limit + 1
    ) ranked;

  return jsonb_build_object(
    'ok', true,
    'jobs', v_rows,
    'next_cursor', case when v_has_more and v_next_created is not null then
      jsonb_build_object('created_at', v_next_created, 'id', v_next_id)
      else null end,
    'request_id', v_guard ->> 'request_id'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Operation: list previews
-- ---------------------------------------------------------------------------

create or replace function public.api_list_previews(
  p_key_hash text,
  p_project_id uuid,
  p_limit integer default 20,
  p_cursor_created timestamptz default null,
  p_cursor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guard jsonb;
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 50));
  v_rows jsonb;
  v_next_created timestamptz;
  v_next_id text;
  v_has_more boolean;
begin
  v_guard := public.api_guard(
    p_key_hash, 'previews:read', 'previews.list', p_project_id
  );
  if not (v_guard ->> 'ok')::boolean then
    return v_guard;
  end if;

  with combined as (
    select
      'workspace'::text as kind,
      w.id,
      w.status,
      w.updated_at as created_at,
      null::text as url,
      w.last_error as detail,
      null::integer as version
      from public.app_workspaces w
     where w.project_id = p_project_id
    union all
    select
      'deployment'::text,
      d.id,
      d.status,
      d.created_at,
      d.deployment_url,
      d.error,
      d.snapshot_version
      from public.app_deployments d
     where d.project_id = p_project_id
       and d.target = 'preview'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'kind', kind, 'status', status, 'created_at', created_at,
           'url', url, 'detail', detail, 'version', version
         ) order by created_at desc, id desc) filter (where rn <= v_limit), '[]'::jsonb),
         max(created_at) filter (where rn = v_limit),
         max(id::text) filter (where rn = v_limit),
         bool_or(rn > v_limit)
    into v_rows, v_next_created, v_next_id, v_has_more
    from (
      select *, row_number() over (order by created_at desc, id desc) as rn
        from combined
       where p_cursor_created is null
          or (created_at, id) < (p_cursor_created, p_cursor_id)
       order by created_at desc, id desc
       limit v_limit + 1
    ) ranked;

  return jsonb_build_object(
    'ok', true,
    'previews', v_rows,
    'next_cursor', case when v_has_more and v_next_created is not null then
      jsonb_build_object('created_at', v_next_created, 'id', v_next_id)
      else null end,
    'request_id', v_guard ->> 'request_id'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Operation: deployment proposal inputs and draft creation
-- ---------------------------------------------------------------------------

create or replace function public.api_deployment_inputs(
  p_key_hash text,
  p_project_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guard jsonb;
  v_project public.app_projects;
  v_files jsonb;
  v_connections jsonb;
  v_env jsonb;
begin
  v_guard := public.api_guard(
    p_key_hash, 'deployments:propose', 'deployments.inputs', p_project_id
  );
  if not (v_guard ->> 'ok')::boolean then
    return v_guard;
  end if;

  select * into v_project
    from public.app_projects
   where id = p_project_id and user_id = (v_guard ->> 'user_id')::uuid;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'path', f.path, 'content', f.content
         ) order by f.path), '[]'::jsonb)
    into v_files
    from public.app_files f
   where f.project_id = p_project_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'provider', c.provider,
           'account_label', c.account_label,
           'external_ref', c.external_ref,
           'metadata', c.metadata
         ) order by c.provider), '[]'::jsonb)
    into v_connections
    from public.app_provider_connections c
   where c.project_id = p_project_id
     and c.user_id = v_project.user_id
     and c.status = 'connected';

  select coalesce(jsonb_object_agg(environment, names), '{}'::jsonb)
    into v_env
    from (
      select environment, jsonb_agg(name order by name) as names
        from public.app_env_values
       where project_id = p_project_id
       group by environment
    ) grouped;

  return jsonb_build_object(
    'ok', true,
    'project', jsonb_build_object(
      'id', v_project.id, 'name', v_project.name,
      'current_version', v_project.current_version,
      'status', v_project.status
    ),
    'files', v_files,
    'connections', v_connections,
    'env_names', v_env,
    'request_id', v_guard ->> 'request_id'
  );
end;
$$;

create or replace function public.api_create_deployment_proposal(
  p_key_hash text,
  p_project_id uuid,
  p_target text,
  p_plan jsonb,
  p_plan_hash text,
  p_snapshot_version integer,
  p_digest text,
  p_snapshot jsonb,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guard jsonb;
  v_idem jsonb;
  v_project public.app_projects;
  v_deployment_id uuid;
  v_response jsonb;
begin
  v_guard := public.api_guard(
    p_key_hash, 'deployments:propose', 'deployments.propose', p_project_id
  );
  if not (v_guard ->> 'ok')::boolean then
    return v_guard;
  end if;

  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$' then
    return jsonb_build_object(
      'ok', false, 'code', 'idempotency_key_required',
      'message', 'Send an Idempotency-Key header of 8 to 128 letters, digits, underscores or dashes.',
      'request_id', v_guard ->> 'request_id'
    );
  end if;

  v_idem := public.api_idem_start(
    (v_guard ->> 'key_id')::uuid,
    'deployments.propose:' || p_project_id::text,
    p_idempotency_key, p_request_hash
  );
  if v_idem ->> 'state' = 'conflict' then
    return jsonb_build_object(
      'ok', false, 'code', 'idempotency_conflict',
      'message', 'That Idempotency-Key was already used with a different request body.',
      'request_id', v_guard ->> 'request_id'
    );
  end if;
  if v_idem ->> 'state' = 'replay' then
    return (v_idem -> 'response') || jsonb_build_object(
      'replayed', true, 'request_id', v_guard ->> 'request_id'
    );
  end if;

  if p_target not in ('preview', 'production') then
    return jsonb_build_object(
      'ok', false, 'code', 'invalid_request',
      'message', 'Choose preview or production.',
      'request_id', v_guard ->> 'request_id'
    );
  end if;
  if jsonb_typeof(p_plan) <> 'object'
     or jsonb_typeof(p_snapshot) <> 'array'
     or jsonb_array_length(p_snapshot) not between 1 and 60 then
    return jsonb_build_object(
      'ok', false, 'code', 'invalid_request',
      'message', 'A proposal needs one source snapshot and the resolved plan.',
      'request_id', v_guard ->> 'request_id'
    );
  end if;
  if p_plan_hash is null or p_plan_hash !~ '^[a-f0-9]{64}$'
     or p_digest is null or p_digest !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object(
      'ok', false, 'code', 'invalid_request',
      'message', 'The plan and source fingerprints must be SHA-256 hex values.',
      'request_id', v_guard ->> 'request_id'
    );
  end if;

  select * into v_project
    from public.app_projects
   where id = p_project_id and user_id = (v_guard ->> 'user_id')::uuid;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  if p_snapshot_version <> v_project.current_version or v_project.current_version < 1 then
    return jsonb_build_object(
      'ok', false, 'code', 'stale_source',
      'message', 'The project changed after the plan inputs were read. Request the proposal again.',
      'request_id', v_guard ->> 'request_id'
    );
  end if;

  -- status is hard-coded to draft: the API can propose, never approve.
  insert into public.app_deployments (
    project_id, user_id, target, snapshot_version, snapshot_digest,
    snapshot, plan, plan_hash, status, checks, migration_state
  )
  values (
    p_project_id, v_project.user_id, p_target, p_snapshot_version, p_digest,
    p_snapshot, p_plan, p_plan_hash, 'draft', '[]'::jsonb, 'not_applied'
  )
  returning id into v_deployment_id;

  insert into public.app_deployment_events
    (deployment_id, project_id, user_id, kind, detail)
  values (
    v_deployment_id, p_project_id, v_project.user_id, 'proposal',
    'A developer API credential requested a draft deployment plan. No approval or deployment occurred.'
  );

  v_response := jsonb_build_object(
    'ok', true,
    'proposal', jsonb_build_object(
      'id', v_deployment_id,
      'project_id', p_project_id,
      'target', p_target,
      'status', 'draft',
      'approval_required', true,
      'approved', false,
      'snapshot_version', p_snapshot_version,
      'snapshot_digest', p_digest,
      'plan_hash', p_plan_hash,
      'plan', p_plan,
      'notice', 'This is a proposal only. It cannot deploy. The project owner must review it, run pre-deploy checks and type DEPLOY in the web app.'
    ),
    'request_id', v_guard ->> 'request_id'
  );

  perform public.api_idem_store(
    (v_guard ->> 'key_id')::uuid,
    'deployments.propose:' || p_project_id::text,
    p_idempotency_key, p_request_hash, v_response, 201
  );

  return v_response || jsonb_build_object('replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Operation: record a webhook delivery attempt
-- ---------------------------------------------------------------------------

create or replace function public.api_record_delivery(
  p_key_hash text,
  p_delivery_id uuid,
  p_delivered boolean,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guard jsonb;
  v_delivery public.app_api_webhook_deliveries;
begin
  select d.project_id into v_delivery.project_id
    from public.app_api_webhook_deliveries d where d.id = p_delivery_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  v_guard := public.api_guard(
    p_key_hash, 'builds:read', 'webhooks.delivery', v_delivery.project_id
  );
  if not (v_guard ->> 'ok')::boolean then
    return v_guard;
  end if;

  update public.app_api_webhook_deliveries
     set attempts = least(attempts + 1, 5),
         status = case
           when p_delivered then 'delivered'
           when attempts + 1 >= 5 then 'failed'
           else 'pending'
         end,
         delivered_at = case when p_delivered then now() else delivered_at end,
         last_error = case when p_delivered then null
           else left(coalesce(p_error, 'Delivery failed.'), 500)
         end
   where id = p_delivery_id
  returning * into v_delivery;

  return jsonb_build_object(
    'ok', true,
    'delivery', jsonb_build_object(
      'id', v_delivery.id, 'status', v_delivery.status,
      'attempts', v_delivery.attempts
    ),
    'request_id', v_guard ->> 'request_id'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Owner-only credential and webhook management (cookie session)
-- ---------------------------------------------------------------------------

create or replace function public.create_project_api_key(
  p_project_id uuid,
  p_name text,
  p_prefix text,
  p_key_hash text,
  p_scopes text[],
  p_rate_limit integer,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_key public.app_api_keys;
begin
  if v_user is null then
    raise exception 'not signed in';
  end if;
  if not exists (
    select 1 from public.app_projects p
     where p.id = p_project_id and p.user_id = v_user
  ) then
    raise exception 'project not found';
  end if;

  insert into public.app_api_keys
    (user_id, project_id, name, prefix, key_hash, scopes,
     rate_limit_per_minute, expires_at)
  values
    (v_user, p_project_id, btrim(p_name), p_prefix, p_key_hash, p_scopes,
     greatest(1, least(coalesce(p_rate_limit, 60), 600)),
     coalesce(p_expires_at, now() + interval '30 days'))
  returning * into v_key;

  insert into public.app_api_key_projects (key_id, project_id, user_id)
  values (v_key.id, p_project_id, v_user)
  on conflict do nothing;

  return jsonb_build_object(
    'id', v_key.id,
    'name', v_key.name,
    'prefix', v_key.prefix,
    'scopes', v_key.scopes,
    'rate_limit_per_minute', v_key.rate_limit_per_minute,
    'expires_at', v_key.expires_at,
    'created_at', v_key.created_at
  );
end;
$$;

create or replace function public.revoke_project_api_key(p_key_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not signed in';
  end if;

  update public.app_api_keys
     set revoked_at = coalesce(revoked_at, now())
   where id = p_key_id and user_id = v_user;

  return found;
end;
$$;

create or replace function public.create_api_webhook(
  p_webhook_id uuid,
  p_project_id uuid,
  p_url text,
  p_events text[],
  p_secret_sealed text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_hook public.app_api_webhooks;
begin
  if v_user is null then
    raise exception 'not signed in';
  end if;
  if not exists (
    select 1 from public.app_projects p
     where p.id = p_project_id and p.user_id = v_user
  ) then
    raise exception 'project not found';
  end if;

  insert into public.app_api_webhooks
    (id, project_id, user_id, url, events, secret_sealed)
  values
    (p_webhook_id, p_project_id, v_user, btrim(p_url), p_events, p_secret_sealed)
  returning * into v_hook;

  return jsonb_build_object(
    'id', v_hook.id,
    'url', v_hook.url,
    'events', v_hook.events,
    'active', v_hook.active,
    'created_at', v_hook.created_at
  );
end;
$$;

create or replace function public.revoke_api_webhook(p_webhook_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not signed in';
  end if;

  delete from public.app_api_webhooks
   where id = p_webhook_id and user_id = v_user;

  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security and grants
-- ---------------------------------------------------------------------------

alter table public.app_api_keys enable row level security;
alter table public.app_api_key_projects enable row level security;
alter table public.app_api_rate_windows enable row level security;
alter table public.app_api_usage enable row level security;
alter table public.app_api_jobs enable row level security;
alter table public.app_api_idempotency enable row level security;
alter table public.app_api_webhooks enable row level security;
alter table public.app_api_webhook_deliveries enable row level security;

drop policy if exists "owners read their api keys" on public.app_api_keys;
create policy "owners read their api keys" on public.app_api_keys
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "owners read their api key projects" on public.app_api_key_projects;
create policy "owners read their api key projects" on public.app_api_key_projects
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "owners read their api usage" on public.app_api_usage;
create policy "owners read their api usage" on public.app_api_usage
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "owners read their api jobs" on public.app_api_jobs;
create policy "owners read their api jobs" on public.app_api_jobs
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "owners read their api webhooks" on public.app_api_webhooks;
create policy "owners read their api webhooks" on public.app_api_webhooks
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "owners read their api deliveries" on public.app_api_webhook_deliveries;
create policy "owners read their api deliveries" on public.app_api_webhook_deliveries
  for select to authenticated using (user_id = (select auth.uid()));

-- Credential reads never expose the hash. The base tables keep no table-level
-- grants for API roles; only these security-invoker views are readable.
create or replace view public.app_api_keys_safe as
select
  id, user_id, project_id, name, prefix, scopes,
  rate_limit_per_minute, expires_at, revoked_at, last_used_at, created_at
from public.app_api_keys
where user_id = (select auth.uid());

create or replace view public.app_api_webhooks_safe as
select id, user_id, project_id, url, events, active, created_at, updated_at
from public.app_api_webhooks
where user_id = (select auth.uid());

revoke all on public.app_api_keys from anon, authenticated;
revoke all on public.app_api_key_projects from anon, authenticated;
revoke all on public.app_api_rate_windows from anon, authenticated;
revoke all on public.app_api_usage from anon, authenticated;
revoke all on public.app_api_jobs from anon, authenticated;
revoke all on public.app_api_idempotency from anon, authenticated;
revoke all on public.app_api_webhooks from anon, authenticated;
revoke all on public.app_api_webhook_deliveries from anon, authenticated;
revoke all on public.app_api_keys_safe from anon, authenticated;
revoke all on public.app_api_webhooks_safe from anon, authenticated;

grant select on public.app_api_keys_safe to authenticated;
grant select on public.app_api_key_projects to authenticated;
grant select on public.app_api_usage to authenticated;
grant select on public.app_api_jobs to authenticated;
grant select on public.app_api_webhooks_safe to authenticated;
grant select on public.app_api_webhook_deliveries to authenticated;

-- Internal helpers are not callable by API roles. Operation functions run as
-- the definer, so they can still use them.
revoke all on function public.api_guard(text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.api_idem_start(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.api_idem_store(uuid, text, text, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.api_write_snapshot(uuid, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.api_queue_webhook_deliveries(public.app_api_jobs, text, jsonb) from public, anon, authenticated;

-- API operations: callable with the anon key, and only useful with a valid,
-- unexpired, unrevoked, correctly scoped key hash.
revoke all on function public.api_record_outcome(uuid, uuid, integer, text) from public, authenticated;
revoke all on function public.api_create_project(text, text, text, jsonb, jsonb) from public, authenticated;
revoke all on function public.api_save_spec(text, uuid, text, text, jsonb) from public, authenticated;
revoke all on function public.api_start_build_job(text, uuid, text, text) from public, authenticated;
revoke all on function public.api_claim_job(text, uuid) from public, authenticated;
revoke all on function public.api_complete_job(text, uuid, jsonb, text) from public, authenticated;
revoke all on function public.api_fail_job(text, uuid, text, text) from public, authenticated;
revoke all on function public.api_get_job(text, uuid) from public, authenticated;
revoke all on function public.api_cancel_job(text, uuid) from public, authenticated;
revoke all on function public.api_project_context(text, uuid, text) from public, authenticated;
revoke all on function public.api_list_jobs(text, uuid, integer, timestamptz, uuid) from public, authenticated;
revoke all on function public.api_get_artifacts(text, uuid, integer, text) from public, authenticated;
revoke all on function public.api_list_previews(text, uuid, integer, timestamptz, uuid) from public, authenticated;
revoke all on function public.api_deployment_inputs(text, uuid) from public, authenticated;
revoke all on function public.api_create_deployment_proposal(text, uuid, text, jsonb, text, integer, text, jsonb, text, text) from public, authenticated;
revoke all on function public.api_record_delivery(text, uuid, boolean, text) from public, authenticated;

grant execute on function public.api_record_outcome(uuid, uuid, integer, text) to anon;
grant execute on function public.api_create_project(text, text, text, jsonb, jsonb) to anon;
grant execute on function public.api_save_spec(text, uuid, text, text, jsonb) to anon;
grant execute on function public.api_start_build_job(text, uuid, text, text) to anon;
grant execute on function public.api_claim_job(text, uuid) to anon;
grant execute on function public.api_complete_job(text, uuid, jsonb, text) to anon;
grant execute on function public.api_fail_job(text, uuid, text, text) to anon;
grant execute on function public.api_get_job(text, uuid) to anon;
grant execute on function public.api_cancel_job(text, uuid) to anon;
grant execute on function public.api_project_context(text, uuid, text) to anon;
grant execute on function public.api_list_jobs(text, uuid, integer, timestamptz, uuid) to anon;
grant execute on function public.api_get_artifacts(text, uuid, integer, text) to anon;
grant execute on function public.api_list_previews(text, uuid, integer, timestamptz, uuid) to anon;
grant execute on function public.api_deployment_inputs(text, uuid) to anon;
grant execute on function public.api_create_deployment_proposal(text, uuid, text, jsonb, text, integer, text, jsonb, text, text) to anon;
grant execute on function public.api_record_delivery(text, uuid, boolean, text) to anon;

-- Owner management functions require a signed-in cookie session.
revoke all on function public.create_project_api_key(uuid, text, text, text, text[], integer, timestamptz) from public, anon, authenticated;
revoke all on function public.revoke_project_api_key(uuid) from public, anon, authenticated;
revoke all on function public.create_api_webhook(uuid, uuid, text, text[], text) from public, anon, authenticated;
revoke all on function public.revoke_api_webhook(uuid) from public, anon, authenticated;

grant execute on function public.create_project_api_key(uuid, text, text, text, text[], integer, timestamptz) to authenticated;
grant execute on function public.revoke_project_api_key(uuid) to authenticated;
grant execute on function public.create_api_webhook(uuid, uuid, text, text[], text) to authenticated;
grant execute on function public.revoke_api_webhook(uuid) to authenticated;
