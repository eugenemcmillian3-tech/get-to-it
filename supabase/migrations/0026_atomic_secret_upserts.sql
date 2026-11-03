-- PostgREST's INSERT ... ON CONFLICT DO UPDATE needs read access to every
-- updated column, including secret_sealed. Keep that column unreadable and
-- perform the atomic upsert inside an owner-checked security-definer function.
create or replace function public.save_provider_connection(
  p_project_id uuid,
  p_provider text,
  p_status text,
  p_account_label text,
  p_external_ref text,
  p_scope_label text,
  p_metadata jsonb,
  p_secret_sealed text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_provider not in ('github', 'vercel', 'supabase') then
    raise exception 'invalid provider';
  end if;
  if p_status <> 'connected' then
    raise exception 'invalid status';
  end if;
  if not exists (
    select 1
      from public.app_projects p
     where p.id = p_project_id
       and p.user_id = auth.uid()
  ) then
    raise exception 'not allowed';
  end if;

  insert into public.app_provider_connections (
    project_id, user_id, provider, status, account_label, external_ref,
    scope_label, metadata, secret_sealed, connected_at, revoked_at
  ) values (
    p_project_id, auth.uid(), p_provider, p_status, p_account_label,
    p_external_ref, p_scope_label, coalesce(p_metadata, '{}'::jsonb),
    p_secret_sealed, now(), null
  )
  on conflict (project_id, provider) do update set
    user_id = excluded.user_id,
    status = excluded.status,
    account_label = excluded.account_label,
    external_ref = excluded.external_ref,
    scope_label = excluded.scope_label,
    metadata = excluded.metadata,
    secret_sealed = excluded.secret_sealed,
    connected_at = excluded.connected_at,
    revoked_at = null,
    updated_at = now();
end;
$$;

revoke all on function public.save_provider_connection(
  uuid, text, text, text, text, text, jsonb, text
) from public;
grant execute on function public.save_provider_connection(
  uuid, text, text, text, text, text, jsonb, text
) to authenticated;

create or replace function public.save_env_value(
  p_project_id uuid,
  p_environment text,
  p_name text,
  p_visibility text,
  p_secret_sealed text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_environment not in ('preview', 'production') then
    raise exception 'invalid environment';
  end if;
  if p_visibility not in ('public', 'server') then
    raise exception 'invalid visibility';
  end if;
  if p_name !~ '^[A-Z][A-Z0-9_]{0,63}$' then
    raise exception 'invalid name';
  end if;
  if not exists (
    select 1
      from public.app_projects p
     where p.id = p_project_id
       and p.user_id = auth.uid()
  ) then
    raise exception 'not allowed';
  end if;

  insert into public.app_env_values (
    project_id, user_id, environment, name, visibility, secret_sealed
  ) values (
    p_project_id, auth.uid(), p_environment, p_name, p_visibility,
    p_secret_sealed
  )
  on conflict (project_id, environment, name) do update set
    visibility = excluded.visibility,
    secret_sealed = excluded.secret_sealed,
    updated_at = now();
end;
$$;

revoke all on function public.save_env_value(
  uuid, text, text, text, text
) from public;
grant execute on function public.save_env_value(
  uuid, text, text, text, text
) to authenticated;
