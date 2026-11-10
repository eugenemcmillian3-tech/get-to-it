#!/usr/bin/env node
/**
 * Removes disposable E2E accounts that a killed run never got to delete.
 *
 * The three suites (e2e-http, e2e-functional, e2e-team-seats) each delete the
 * accounts they create in a `finally` block. That covers a failed assertion,
 * but not a run that is cancelled or killed before `finally` runs at all — a CI
 * timeout, a cancelled job, or a `kill -9`. Those accounts then stay forever.
 *
 * This sweep runs before the suites and removes leftovers, with two guards so
 * it can never touch real data:
 *
 *   - the address must end in `@get-to-it.test`, which only these suites use;
 *   - it must be at least MIN_AGE_MINUTES old, so a suite running right now
 *     (on another branch, or a second job) keeps its accounts.
 *
 * Environment:
 *   NEXT_PUBLIC_SUPABASE_URL   Supabase project URL
 *   E2E_SERVICE_ROLE_KEY       service-role key (SUPABASE_SERVICE_ROLE_KEY also accepted)
 *   E2E_CLEANUP_DRY_RUN=1      report what would go, delete nothing
 */

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const SERVICE_KEY =
  process.env.E2E_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const DRY_RUN = process.env.E2E_CLEANUP_DRY_RUN === "1";

const TEST_ADDRESS_SUFFIX = "@get-to-it.test";
const MIN_AGE_MINUTES = 60;
const PAGE_SIZE = 200;
const MAX_PAGES = 20;

function requireConfiguration() {
  const missing = [];
  if (!SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!SERVICE_KEY) missing.push("E2E_SERVICE_ROLE_KEY");
  if (missing.length > 0) {
    console.error(
      `Missing ${missing.join(", ")}. The sweep needs the same E2E Supabase configuration the suites use.`,
    );
    process.exit(1);
  }
}

async function admin(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/admin${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status}): ${String(text).slice(0, 300)}`);
  }
  return body;
}

/** Every user the project has, in creation order. */
async function listUsers() {
  const users = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const body = await admin(`/users?page=${page}&per_page=${PAGE_SIZE}`);
    const rows = Array.isArray(body?.users) ? body.users : [];
    users.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return users;
}

async function main() {
  requireConfiguration();

  const cutoff = Date.now() - MIN_AGE_MINUTES * 60_000;
  const users = await listUsers();
  const stale = users.filter((user) => {
    const email = String(user?.email ?? "");
    if (!email.endsWith(TEST_ADDRESS_SUFFIX)) return false;
    const created = Date.parse(user?.created_at ?? "");
    return !Number.isNaN(created) && created < cutoff;
  });

  const deleted = [];
  const failed = [];

  for (const user of stale) {
    const label = user.email ?? user.id;
    if (DRY_RUN) {
      deleted.push(label);
      continue;
    }
    try {
      await admin(`/users/${user.id}`, { method: "DELETE" });
      deleted.push(label);
    } catch (error) {
      // A 404 means something else removed it first, which is the goal anyway.
      if (/\(404\)/.test(error.message)) {
        deleted.push(label);
      } else {
        failed.push({ email: label, error: error.message });
      }
    }
  }

  const summary = {
    scanned: users.length,
    matched: stale.length,
    deleted: deleted.length,
    failed: failed.length,
    dry_run: DRY_RUN,
    min_age_minutes: MIN_AGE_MINUTES,
    removed: deleted,
    failures: failed,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Stale E2E account sweep failed: ${error.message}`);
  process.exitCode = 1;
});
