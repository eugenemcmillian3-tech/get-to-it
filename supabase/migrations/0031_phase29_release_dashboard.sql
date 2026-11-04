-- GET TO IT — Phase 29 schema
-- Release evidence, post-deployment checks, incident workflow and recovery controls.
--
-- Ground rules encoded here:
--   * A release record cites an existing app version and deployment; it never
--     creates or rewrites one.
--   * Test results are evidence, not proof that no defects exist.
--   * Incidents are written only through guarded functions. A root cause cannot
--     be recorded without non-empty evidence and support.
--   * Application, configuration and database recovery are distinct kinds.
--   * Automatic rollback is off by default. Enabling it requires explicit
--     conditions and known limitations, and every change is audited.
--   * Owner-only RLS; deleting the project cascades to all records.

create table if not exists public.app_releases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  version integer not null check (version >= 1),
  deployment_id uuid references public.app_deployments (id) on delete set null,
  source_revision text not null default 'unknown'
    check (char_length(source_revision) between 1 and 100),
  source_digest text not null check (source_digest ~ '^[a-f0-9]{64}$'),
  status text not null default 'review_ready'
    check (status in ('review_ready', 'reviewed', 'superseded')),
  changed_features jsonb not null default '[]'::jsonb
    check (jsonb_typeof(changed_features) = 'array'),
  test_results jsonb not null default '[]'::jsonb
    check (jsonb_typeof(test_results) = 'array'),
  dependency_changes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(dependency_changes) = 'array'),
  migration_requirements jsonb not null default '[]'::jsonb
    check (jsonb_typeof(migration_requirements) = 'array'),
  config_changes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(config_changes) = 'array'),
  known_issues jsonb not null default '[]'::jsonb
    check (jsonb_typeof(known_issues) = 'array'),
  rollback_limitations jsonb not null default '[]'::jsonb
    check (jsonb_typeof(rollback_limitations) = 'array'),
  review jsonb not null default '{}'::jsonb check (jsonb_typeof(review) = 'object'),
  review_generated_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, version)
);

comment on table public.app_releases is
  'A reviewable evidence record for one source version. Passing checks are not proof of no defects.';

create index if not exists app_releases_project_idx
  on public.app_releases (project_id, version desc);
create index if not exists app_releases_deployment_idx
  on public.app_releases (deployment_id);

drop trigger if exists app_releases_set_updated_at on public.app_releases;
create trigger app_releases_set_updated_at before update on public.app_releases
  for each row execute function public.set_updated_at();

create table if not exists public.app_release_check_configs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  kind text not null check (kind in ('health', 'route', 'error_rate', 'smoke')),
  target text not null default '' check (char_length(target) <= 1000),
  expected_status integer not null default 200 check (expected_status between 100 and 599),
  max_errors integer not null default 0 check (max_errors between 0 and 1000),
  instructions text not null default '' check (char_length(instructions) <= 4000),
  synthetic boolean not null default true,
  destructive boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.app_release_check_configs is
  'Configured health, route, error-rate and functional smoke checks. Destructive checks are opt-in and skipped on production.';

create index if not exists app_release_check_configs_project_idx
  on public.app_release_check_configs (project_id, enabled, created_at);

drop trigger if exists app_release_check_configs_set_updated_at on public.app_release_check_configs;
create trigger app_release_check_configs_set_updated_at before update on public.app_release_check_configs
  for each row execute function public.set_updated_at();

create table if not exists public.app_release_check_runs (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.app_releases (id) on delete cascade,
  config_id uuid references public.app_release_check_configs (id) on delete set null,
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 80),
  kind text not null check (kind in ('health', 'route', 'error_rate', 'smoke')),
  status text not null check (status in ('passed', 'failed', 'skipped', 'not_run')),
  observed jsonb not null default '{}'::jsonb check (jsonb_typeof(observed) = 'object'),
  detail text not null default '' check (char_length(detail) <= 2000),
  synthetic boolean not null default true,
  destructive boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.app_release_check_runs is
  'One actual observation for a release. Missing or unsafe checks are recorded as skipped, never passed.';

create index if not exists app_release_check_runs_release_idx
  on public.app_release_check_runs (release_id, created_at desc);

create table if not exists public.app_release_incidents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  release_id uuid not null references public.app_releases (id) on delete cascade,
  deployment_id uuid references public.app_deployments (id) on delete set null,
  check_run_id uuid references public.app_release_check_runs (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 200),
  trigger text not null check (char_length(btrim(trigger)) between 3 and 500),
  severity text not null default 'medium'
    check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'evidence_collected'
    check (status in (
      'evidence_collected', 'diagnosed', 'recovery_prepared',
      'awaiting_approval', 'approved', 'resolved', 'dismissed'
    )),
  evidence jsonb not null default '[]'::jsonb
    check (jsonb_typeof(evidence) = 'array' and jsonb_array_length(evidence) >= 1),
  diagnosis_hypothesis text check (diagnosis_hypothesis is null or char_length(diagnosis_hypothesis) <= 2000),
  diagnosis_support text check (diagnosis_support is null or char_length(diagnosis_support) <= 2000),
  root_cause text check (root_cause is null or char_length(root_cause) <= 2000),
  root_cause_confirmed boolean not null default false,
  recovery_kind text check (recovery_kind is null or recovery_kind in ('patch', 'code_rollback', 'config_rollback', 'database_recovery')),
  recovery_plan jsonb check (recovery_plan is null or jsonb_typeof(recovery_plan) = 'object'),
  requested_at timestamptz,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not root_cause_confirmed or root_cause is not null),
  unique (check_run_id)
);

comment on table public.app_release_incidents is
  'A failure evidence record. A hypothesis is not a root cause until evidence supports it.';

create index if not exists app_release_incidents_project_idx
  on public.app_release_incidents (project_id, created_at desc);

drop trigger if exists app_release_incidents_set_updated_at on public.app_release_incidents;
create trigger app_release_incidents_set_updated_at before update on public.app_release_incidents
  for each row execute function public.set_updated_at();

create table if not exists public.app_incident_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.app_release_incidents (id) on delete cascade,
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (char_length(btrim(kind)) between 2 and 80),
  detail text not null check (char_length(detail) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists app_incident_events_incident_idx
  on public.app_incident_events (incident_id, created_at asc);

create table if not exists public.app_release_automation (
  project_id uuid primary key references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  auto_rollback_enabled boolean not null default false,
  conditions jsonb not null default '[]'::jsonb check (jsonb_typeof(conditions) = 'array'),
  limitations text not null default '' check (char_length(limitations) <= 4000),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.app_release_automation is
  'Automatic rollback is off by default. Enabling it records explicit conditions and limitations.';

drop trigger if exists app_release_automation_set_updated_at on public.app_release_automation;
create trigger app_release_automation_set_updated_at before update on public.app_release_automation
  for each row execute function public.set_updated_at();

create table if not exists public.app_release_automation_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.app_projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (char_length(btrim(kind)) between 2 and 80),
  detail text not null check (char_length(detail) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists app_release_automation_events_project_idx
  on public.app_release_automation_events (project_id, created_at desc);

alter table public.app_releases enable row level security;
alter table public.app_release_check_configs enable row level security;
alter table public.app_release_check_runs enable row level security;
alter table public.app_release_incidents enable row level security;
alter table public.app_incident_events enable row level security;
alter table public.app_release_automation enable row level security;
alter table public.app_release_automation_events enable row level security;

drop policy if exists "owners manage releases" on public.app_releases;
create policy "owners manage releases" on public.app_releases for all to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.app_projects p where p.id = project_id and p.user_id = (select auth.uid())))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.app_projects p where p.id = project_id and p.user_id = (select auth.uid())));

drop policy if exists "owners manage release check configs" on public.app_release_check_configs;
create policy "owners manage release check configs" on public.app_release_check_configs for all to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.app_projects p where p.id = project_id and p.user_id = (select auth.uid())))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.app_projects p where p.id = project_id and p.user_id = (select auth.uid())));

drop policy if exists "owners read release check runs" on public.app_release_check_runs;
create policy "owners read release check runs" on public.app_release_check_runs for select to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.app_projects p where p.id = project_id and p.user_id = (select auth.uid())));

drop policy if exists "owners record release check runs" on public.app_release_check_runs;
create policy "owners record release check runs" on public.app_release_check_runs for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.app_projects p where p.id = project_id and p.user_id = (select auth.uid())));

drop policy if exists "owners read release incidents" on public.app_release_incidents;
create policy "owners read release incidents" on public.app_release_incidents for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "owners read incident events" on public.app_incident_events;
create policy "owners read incident events" on public.app_incident_events for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "owners read release automation" on public.app_release_automation;
create policy "owners read release automation" on public.app_release_automation for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "owners read release automation events" on public.app_release_automation_events;
create policy "owners read release automation events" on public.app_release_automation_events for select to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.app_releases to authenticated;
grant select, insert, update, delete on public.app_release_check_configs to authenticated;
grant select, insert on public.app_release_check_runs to authenticated;
revoke update, delete on public.app_release_check_runs from authenticated;
grant select on public.app_release_incidents to authenticated;
grant select on public.app_incident_events to authenticated;
grant select on public.app_release_automation to authenticated;
grant select on public.app_release_automation_events to authenticated;

revoke all on public.app_releases from anon;
revoke all on public.app_release_check_configs from anon;
revoke all on public.app_release_check_runs from anon;
revoke all on public.app_release_incidents from anon;
revoke all on public.app_incident_events from anon;
revoke all on public.app_release_automation from anon;
revoke all on public.app_release_automation_events from anon;

-- ---------------------------------------------------------------------------
-- Incident workflow. These functions are the only write path for incidents.
-- ---------------------------------------------------------------------------

create or replace function public.detect_app_release_incident(
  p_check_run_id uuid,
  p_title text,
  p_severity text default 'medium'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_run public.app_release_check_runs;
  v_release public.app_releases;
  v_evidence jsonb;
  v_id uuid;
begin
  select * into v_run from public.app_release_check_runs where id = p_check_run_id;
  if not found then raise exception 'check run not found'; end if;
  if not exists (select 1 from public.app_projects p where p.id = v_run.project_id and p.user_id = v_actor) then
    raise exception 'project access denied';
  end if;
  if v_run.status <> 'failed' then raise exception 'only a failed check can open an incident'; end if;
  if p_severity not in ('low', 'medium', 'high', 'critical') then raise exception 'invalid severity'; end if;
  if p_title is null or char_length(btrim(p_title)) not between 3 and 200 then
    raise exception 'incident title must be 3 to 200 characters';
  end if;

  select * into v_release from public.app_releases where id = v_run.release_id;
  if not found then raise exception 'release not found'; end if;

  v_evidence := jsonb_build_array(jsonb_build_object(
    'check_run_id', v_run.id,
    'name', v_run.name,
    'kind', v_run.kind,
    'status', v_run.status,
    'observed', v_run.observed,
    'detail', v_run.detail,
    'release_version', v_release.version,
    'source_revision', v_release.source_revision
  ));

  insert into public.app_release_incidents
    (project_id, release_id, deployment_id, check_run_id, user_id, title, trigger, severity, evidence)
  values
    (v_run.project_id, v_run.release_id, v_release.deployment_id, v_run.id, v_actor,
     left(btrim(p_title), 200),
     left('Configured ' || v_run.kind || ' check failed: ' || v_run.name, 500),
     p_severity, v_evidence)
  returning id into v_id;

  insert into public.app_incident_events (incident_id, project_id, user_id, kind, detail)
  values (v_id, v_run.project_id, v_actor, 'detected',
          left('Failure of ' || v_run.kind || ' check "' || v_run.name || '" recorded with redacted evidence.', 1000));

  return v_id;
end;
$$;

create or replace function public.propose_app_incident_diagnosis(
  p_incident_id uuid,
  p_hypothesis text,
  p_support text,
  p_confirm_root boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_incident public.app_release_incidents;
begin
  select * into v_incident from public.app_release_incidents where id = p_incident_id;
  if not found then raise exception 'incident not found'; end if;
  if not exists (select 1 from public.app_projects p where p.id = v_incident.project_id and p.user_id = v_actor) then
    raise exception 'project access denied';
  end if;
  if v_incident.status not in ('evidence_collected', 'diagnosed') then
    raise exception 'this incident is not awaiting a diagnosis';
  end if;
  if jsonb_array_length(v_incident.evidence) = 0 then
    raise exception 'evidence is required before a diagnosis';
  end if;
  if p_hypothesis is null or char_length(btrim(p_hypothesis)) not between 5 and 2000 then
    raise exception 'a hypothesis must be 5 to 2000 characters';
  end if;
  if p_support is null or char_length(btrim(p_support)) not between 5 and 2000 then
    raise exception 'supporting evidence is required';
  end if;
  if p_confirm_root and char_length(btrim(p_support)) < 20 then
    raise exception 'a confirmed root cause needs substantive supporting evidence';
  end if;

  update public.app_release_incidents
     set status = 'diagnosed',
         diagnosis_hypothesis = left(btrim(p_hypothesis), 2000),
         diagnosis_support = left(btrim(p_support), 2000),
         root_cause = case when p_confirm_root then left(btrim(p_hypothesis), 2000) else null end,
         root_cause_confirmed = p_confirm_root
   where id = p_incident_id;

  insert into public.app_incident_events (incident_id, project_id, user_id, kind, detail)
  values (p_incident_id, v_incident.project_id, v_actor, 'diagnosis_proposed',
          case when p_confirm_root then 'Hypothesis recorded as a confirmed root cause with recorded support.'
               else 'Hypothesis recorded. Root cause remains unconfirmed.' end);

  return jsonb_build_object('ok', true, 'root_cause_confirmed', p_confirm_root);
end;
$$;

create or replace function public.prepare_app_incident_recovery(
  p_incident_id uuid,
  p_kind text,
  p_plan jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_incident public.app_release_incidents;
  v_steps jsonb;
  v_limitations jsonb;
  v_standard text;
begin
  select * into v_incident from public.app_release_incidents where id = p_incident_id;
  if not found then raise exception 'incident not found'; end if;
  if not exists (select 1 from public.app_projects p where p.id = v_incident.project_id and p.user_id = v_actor) then
    raise exception 'project access denied';
  end if;
  if v_incident.status <> 'diagnosed' then raise exception 'propose a diagnosis before preparing recovery'; end if;
  if p_kind not in ('patch', 'code_rollback', 'config_rollback', 'database_recovery') then
    raise exception 'invalid recovery kind';
  end if;
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' then raise exception 'a recovery plan is required'; end if;
  v_steps := coalesce(p_plan->'steps', '[]'::jsonb);
  v_limitations := coalesce(p_plan->'limitations', '[]'::jsonb);
  if jsonb_typeof(v_steps) <> 'array' or jsonb_array_length(v_steps) = 0 then
    raise exception 'a recovery plan needs at least one step';
  end if;
  if jsonb_typeof(v_limitations) <> 'array' or jsonb_array_length(v_limitations) = 0 then
    raise exception 'a recovery plan must state its limitations';
  end if;

  v_standard := case p_kind
    when 'patch' then 'A patch is prepared but not deployed; deployment remains a separate approval.'
    when 'code_rollback' then 'Application code rollback does not reverse a database migration or restore deleted data.'
    when 'config_rollback' then 'Configuration rollback changes only configuration; it does not undo a code or database change.'
    else 'Database recovery is a separate operation; restoring a backup or applying a forward fix may lose data written after the recovery point.'
  end;
  v_limitations := v_limitations || jsonb_build_array(v_standard);

  update public.app_release_incidents
     set recovery_kind = p_kind,
         recovery_plan = jsonb_set(p_plan, '{limitations}', v_limitations),
         status = 'awaiting_approval',
         requested_at = now()
   where id = p_incident_id;

  insert into public.app_incident_events (incident_id, project_id, user_id, kind, detail)
  values (p_incident_id, v_incident.project_id, v_actor, 'recovery_prepared',
          left('Prepared a ' || replace(p_kind, '_', ' ') || ' plan and requested approval. No action was executed.', 1000));

  return jsonb_build_object('ok', true, 'status', 'awaiting_approval');
end;
$$;

create or replace function public.approve_app_incident_action(
  p_incident_id uuid,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_incident public.app_release_incidents;
begin
  if p_confirmation is distinct from 'APPROVE' then raise exception 'type APPROVE to approve the prepared recovery action'; end if;
  select * into v_incident from public.app_release_incidents where id = p_incident_id;
  if not found then raise exception 'incident not found'; end if;
  if not exists (select 1 from public.app_projects p where p.id = v_incident.project_id and p.user_id = v_actor) then
    raise exception 'project access denied';
  end if;
  if v_incident.status <> 'awaiting_approval' then raise exception 'this incident has no recovery action awaiting approval'; end if;

  update public.app_release_incidents
     set status = 'approved', approved_by = v_actor, approved_at = now()
   where id = p_incident_id;

  insert into public.app_incident_events (incident_id, project_id, user_id, kind, detail)
  values (p_incident_id, v_incident.project_id, v_actor, 'recovery_approved',
          'A human approved the prepared recovery plan. No external action was executed by this function.');

  return jsonb_build_object('ok', true, 'status', 'approved');
end;
$$;

create or replace function public.save_app_release_automation(
  p_project_id uuid,
  p_enabled boolean,
  p_conditions jsonb default '[]'::jsonb,
  p_limitations text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if not exists (select 1 from public.app_projects p where p.id = p_project_id and p.user_id = v_actor) then
    raise exception 'project access denied';
  end if;
  if p_conditions is null or jsonb_typeof(p_conditions) <> 'array' then
    raise exception 'conditions must be a JSON array';
  end if;
  if p_enabled and jsonb_array_length(p_conditions) = 0 then
    raise exception 'automatic rollback needs at least one explicit condition';
  end if;
  if p_enabled and (p_limitations is null or char_length(btrim(p_limitations)) < 10) then
    raise exception 'automatic rollback needs known limitations';
  end if;

  insert into public.app_release_automation
    (project_id, user_id, auto_rollback_enabled, conditions, limitations, updated_by)
  values (p_project_id, v_actor, p_enabled, p_conditions, coalesce(p_limitations, ''), v_actor)
  on conflict (project_id) do update
    set auto_rollback_enabled = excluded.auto_rollback_enabled,
        conditions = excluded.conditions,
        limitations = excluded.limitations,
        updated_by = excluded.updated_by;

  insert into public.app_release_automation_events (project_id, user_id, kind, detail)
  values (p_project_id, v_actor, case when p_enabled then 'enabled' else 'disabled' end,
          case when p_enabled then 'Automatic rollback enabled with explicit conditions and limitations; execution still requires the separate recovery action approval.'
               else 'Automatic rollback disabled; recommendations remain available.' end);

  return jsonb_build_object('ok', true, 'enabled', p_enabled);
end;
$$;

create or replace function public.disable_app_release_automation(p_project_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.save_app_release_automation(p_project_id, false, '[]'::jsonb, 'Disabled by the project owner.');
$$;

grant execute on function public.detect_app_release_incident(uuid, text, text) to authenticated;
grant execute on function public.propose_app_incident_diagnosis(uuid, text, text, boolean) to authenticated;
grant execute on function public.prepare_app_incident_recovery(uuid, text, jsonb) to authenticated;
grant execute on function public.approve_app_incident_action(uuid, text) to authenticated;
grant execute on function public.save_app_release_automation(uuid, boolean, jsonb, text) to authenticated;
grant execute on function public.disable_app_release_automation(uuid) to authenticated;
