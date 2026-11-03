-- PostgREST requires table-level SELECT for a relation, which would expose
-- app_provider_connections.secret_sealed. Read provider metadata through this
-- security-invoker view instead. The base table keeps insert/update/delete
-- grants only, and the ciphertext stays accessible solely to the owner-checked
-- get_provider_secret() function.
create or replace view public.app_provider_connections_safe
with (security_invoker = true) as
select
  id,
  project_id,
  user_id,
  provider,
  status,
  account_label,
  external_ref,
  scope_label,
  metadata,
  connected_at,
  revoked_at,
  created_at,
  updated_at
from public.app_provider_connections;

revoke all on public.app_provider_connections_safe from anon;
grant select on public.app_provider_connections_safe to authenticated;

-- The same rule applies to environment values: expose names and visibility,
-- never the sealed value itself.
create or replace view public.app_env_values_safe
with (security_invoker = true) as
select
  id,
  project_id,
  user_id,
  environment,
  name,
  visibility,
  created_at,
  updated_at
from public.app_env_values;

revoke all on public.app_env_values_safe from anon;
grant select on public.app_env_values_safe to authenticated;
