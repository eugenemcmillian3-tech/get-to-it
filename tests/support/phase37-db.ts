import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Client } from "pg";

/**
 * Bootstrap for the Phase 37 SQL harness.
 *
 * The harness replays the real migrations into a throwaway embedded Postgres, so
 * the functions, triggers, policies and cascades under test are the ones the
 * hosted project runs. Supabase normally supplies the `auth` schema, the API
 * roles and the default grants; this module stubs exactly those pieces and
 * nothing else.
 *
 * Nothing here reads a project URL or key: `assertIsolatedDatabase` refuses any
 * database that is not local and not named `knowledge_test`.
 */
export const HARNESS_DATABASE = "knowledge_test";

export async function assertIsolatedDatabase(client: Client): Promise<void> {
  const name = await client.query<{ name: string }>("select current_database() as name");
  const database = name.rows[0]?.name ?? "";
  if (!database.includes(HARNESS_DATABASE)) {
    throw new Error(
      `Refusing to run: KNOWLEDGE_TEST_DATABASE_URL must point at a database whose name contains ${HARNESS_DATABASE}.`,
    );
  }
  const host = await client.query<{ host: string }>(
    "select coalesce(inet_server_addr()::text, 'local') as host",
  );
  const address = host.rows[0]?.host ?? "local";
  if (address !== "local" && !address.startsWith("127.") && address !== "::1") {
    throw new Error(`Refusing to run against a non-local database host (${address}).`);
  }
}

export async function bootstrapSupabase(client: Client): Promise<void> {
  await client.query(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin bypassrls;
      end if;
    end $$;
  `);

  // Supabase grants the API roles default privileges on new objects in `public`;
  // the migrations then revoke what must stay server-only. Without this the
  // harness would test a stricter database than the hosted one and the
  // "clients can read but not write" checks would pass for the wrong reason.
  await client.query(`
    alter default privileges in schema public
      grant select, insert, update, delete on tables to authenticated;
    alter default privileges in schema public
      grant select on tables to anon;
    alter default privileges in schema public
      grant usage, select on sequences to authenticated;
    alter default privileges in schema public
      grant execute on functions to anon, authenticated;
  `);

  await client.query("create schema if not exists auth");
  await client.query(`
    create table if not exists auth.users (
      id uuid primary key default gen_random_uuid(),
      email text unique,
      instance_id uuid,
      aud text default 'authenticated',
      role text default 'authenticated',
      raw_user_meta_data jsonb default '{}'::jsonb,
      raw_app_meta_data jsonb default '{}'::jsonb,
      email_confirmed_at timestamptz,
      last_sign_in_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);
  await client.query(`
    create or replace function auth.uid()
    returns uuid
    language sql
    stable
    as $fn$
      select ((nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'sub')::uuid
    $fn$;
  `);
  await client.query(`
    create or replace function auth.role()
    returns text
    language sql
    stable
    as $fn$
      select coalesce(
        ((nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'role'),
        'authenticated'
      )
    $fn$;
  `);
  await client.query(`
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant execute on function auth.role() to anon, authenticated;
  `);
}

export async function replayMigrations(client: Client): Promise<string[]> {
  const directory = path.join(process.cwd(), "supabase/migrations");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = await readFile(path.join(directory, file), "utf8");
    try {
      await client.query(sql);
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  return files;
}

/** Runs `run` as a signed-in person, the way PostgREST does it. */
export async function asUser<T>(
  client: Client,
  userId: string,
  run: () => Promise<T>,
): Promise<T> {
  await client.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await client.query("set role authenticated");
  try {
    return await run();
  } finally {
    await client.query("reset role");
    await client.query("select set_config('request.jwt.claims', '', false)");
  }
}

/** Runs `run` as the anonymous API role. */
export async function asAnon<T>(client: Client, run: () => Promise<T>): Promise<T> {
  await client.query("select set_config('request.jwt.claims', '', false)");
  await client.query("set role anon");
  try {
    return await run();
  } finally {
    await client.query("reset role");
  }
}
