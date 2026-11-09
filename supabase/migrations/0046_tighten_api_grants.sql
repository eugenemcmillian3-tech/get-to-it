-- Tighten the developer-API grants and let RLS back up the safe views.
--
-- app_projects carried the Supabase default grant for `authenticated`,
-- including TRUNCATE, which RLS does not filter. A signed-in user should not
-- hold privileges the owner UI never uses. The four DML privileges it does use
-- stay as they are.
revoke truncate, trigger, references, maintain on public.app_projects from authenticated;

-- The `*_safe` views are owned by postgres, so they bypassed RLS on their base
-- tables and depended entirely on the predicate written into their definition.
-- Running them as the caller means the owner-only policies apply underneath as
-- well, which makes the predicate a second layer instead of the only one.
--
-- A security-invoker view needs the caller to hold privileges on the columns it
-- reads, so grant exactly the columns each view exposes. `key_hash` and
-- `secret_sealed` are deliberately absent: neither view selects them, and
-- neither should become readable through the base table because of this change.
grant select (
  id, user_id, project_id, name, prefix, scopes, rate_limit_per_minute,
  expires_at, revoked_at, last_used_at, created_at
) on public.app_api_keys to authenticated;

grant select (
  id, project_id, user_id, url, events, active, created_at, updated_at
) on public.app_api_webhooks to authenticated;

alter view public.app_api_keys_safe set (security_invoker = true);
alter view public.app_api_webhooks_safe set (security_invoker = true);
