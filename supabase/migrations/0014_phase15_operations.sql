-- GET TO IT — Phase 15 operations
--
-- One read-only probe for the health endpoint. It returns a timestamp and a
-- boolean: no table, no count, no user, no secret. Executing it is the whole
-- check, so a missing migration or an unreachable database is visible without
-- exposing anything about the data.

create or replace function public.health_probe()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object('ok', true, 'checked_at', now());
$$;

comment on function public.health_probe() is
  'Read-only liveness probe for /api/health. Returns no data beyond a timestamp.';

revoke all on function public.health_probe() from public;
grant execute on function public.health_probe() to anon, authenticated;
