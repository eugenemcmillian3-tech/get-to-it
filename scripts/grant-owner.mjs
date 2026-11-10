#!/usr/bin/env node
/**
 * Grants or revokes the owner role in `public.app_owners`, addressed by email.
 *
 * `/owner` is gated in the database: `app_is_owner()` reads `app_owners`, and a
 * non-owner gets the same 404 as a page that does not exist. Nothing in the app
 * writes that table — there is no route and no server action for it, and the
 * browser roles have no grants on it — so granting access is deliberately an
 * operator action with the service-role key.
 *
 * Addressing it by email is the point: a user id pasted into SQL or code goes
 * stale as soon as the account is recreated, and a hardcoded id is a second
 * source of truth about who may see the dashboard. This script resolves the
 * account through the admin API, so the only thing a person supplies is the
 * address they sign in with.
 *
 * Usage:
 *   node scripts/grant-owner.mjs --list
 *   node scripts/grant-owner.mjs --email you@example.com
 *   node scripts/grant-owner.mjs --email you@example.com --revoke
 *
 * Environment:
 *   NEXT_PUBLIC_SUPABASE_URL    Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY   service-role key (E2E_SERVICE_ROLE_KEY also accepted)
 *   APP_ORIGIN                  optional; used only to print the dashboard link
 *
 * Idempotent: granting an existing owner reports "already an owner" and changes
 * nothing; revoking someone who is not an owner reports that too. Neither prints
 * the key, and the script exits non-zero when it cannot do what was asked.
 */

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.E2E_SERVICE_ROLE_KEY ?? "";
const APP_ORIGIN = (process.env.APP_ORIGIN ?? "").replace(/\/$/, "");

const PAGE_SIZE = 200;
const MAX_PAGES = 25;

function usage() {
  console.log(`Usage:
  node scripts/grant-owner.mjs --list
  node scripts/grant-owner.mjs --email you@example.com
  node scripts/grant-owner.mjs --email you@example.com --revoke

Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
Granting again is a no-op; so is revoking someone who is not an owner.`);
}

function parseArgs(argv) {
  const options = { email: null, list: false, revoke: false, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--list") options.list = true;
    else if (argument === "--revoke") options.revoke = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--email") {
      options.email = argv[index + 1] ?? null;
      index += 1;
    } else if (argument.startsWith("--email=")) {
      options.email = argument.slice("--email=".length);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function requireConfiguration() {
  const missing = [];
  if (!SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!SERVICE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length > 0) {
    console.error(`Cannot run: ${missing.join(" and ")} not set.`);
    process.exit(1);
  }
}

async function request(path, init = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  let body = null;
  if (text.trim().length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return { status: response.status, ok: response.ok, body };
}

/** Every account, one page at a time, keyed by lower-cased email. */
async function listAccounts() {
  const byEmail = new Map();

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { ok, status, body } = await request(
      `/auth/v1/admin/users?page=${page}&per_page=${PAGE_SIZE}`,
      { headers: { "content-type": "application/json" } },
    );

    if (!ok) {
      throw new Error(`The admin API refused the account list (HTTP ${status}).`);
    }

    const users = Array.isArray(body?.users) ? body.users : [];
    for (const user of users) {
      if (typeof user?.email === "string" && typeof user?.id === "string") {
        byEmail.set(user.email.toLowerCase(), { id: user.id, email: user.email });
      }
    }

    if (users.length < PAGE_SIZE) break;
  }

  return byEmail;
}

async function listOwners() {
  const accounts = await listAccounts();
  const { ok, status, body } = await request(
    "/rest/v1/app_owners?select=user_id,added_at&order=added_at",
  );

  if (!ok) {
    throw new Error(`app_owners could not be read (HTTP ${status}).`);
  }

  const owners = Array.isArray(body) ? body : [];
  if (owners.length === 0) {
    console.log("No owners yet. Nothing can open /owner until one is granted.");
    return;
  }

  console.log(`${owners.length} owner${owners.length === 1 ? "" : "s"}:`);
  for (const owner of owners) {
    const account = accounts.get(
      // The map is keyed by email, so resolve by id instead of printing a raw id.
      [...accounts.entries()].find(([, value]) => value.id === owner.user_id)?.[0] ?? "",
    );
    const label = account ? account.email : "account no longer exists";
    console.log(`  ${label}  (${owner.user_id})  added ${owner.added_at}`);
  }
}

async function resolveAccount(email) {
  const accounts = await listAccounts();
  const account = accounts.get(email.toLowerCase());
  if (!account) {
    console.error(
      `No account uses ${email}. The person has to sign up first; this script does not create accounts.`,
    );
    process.exit(1);
  }
  return account;
}

async function grant(email) {
  const account = await resolveAccount(email);

  // Read before writing: PostgREST returns the row for an upsert whether or not
  // it changed anything, so the only honest way to report "already an owner" is
  // to look first.
  const existing = await request(
    `/rest/v1/app_owners?select=user_id&user_id=eq.${account.id}`,
  );

  if (!existing.ok) {
    console.error(`app_owners could not be read (HTTP ${existing.status}).`);
    process.exit(1);
  }

  if (Array.isArray(existing.body) && existing.body.length > 0) {
    console.log(`${account.email} was already an owner. Nothing changed.`);
    printDashboard();
    return;
  }

  const { ok, status } = await request("/rest/v1/app_owners", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // A second run loses the race harmlessly instead of failing.
      prefer: "resolution=ignore-duplicates",
    },
    body: JSON.stringify([{ user_id: account.id }]),
  });

  if (!ok && status !== 409) {
    console.error(`Granting ownership failed (HTTP ${status}).`);
    process.exit(1);
  }

  console.log(
    status === 409
      ? `${account.email} was already an owner. Nothing changed.`
      : `${account.email} is now an owner.`,
  );
  printDashboard();
}

function printDashboard() {
  if (APP_ORIGIN) console.log(`Dashboard: ${APP_ORIGIN}/owner`);
  else console.log("Dashboard path: /owner (sign in as that account).");
}

async function revoke(email) {
  const account = await resolveAccount(email);
  const { ok, status, body } = await request(
    `/rest/v1/app_owners?user_id=eq.${account.id}`,
    { method: "DELETE", headers: { prefer: "return=representation" } },
  );

  if (!ok) {
    console.error(`Revoking ownership failed (HTTP ${status}).`);
    process.exit(1);
  }

  const removed = Array.isArray(body) ? body.length : 0;
  console.log(
    removed > 0
      ? `${account.email} is no longer an owner.`
      : `${account.email} was not an owner. Nothing changed.`,
  );
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    usage();
    process.exit(1);
  }

  if (options.help || (!options.list && !options.email)) {
    usage();
    return;
  }

  requireConfiguration();

  if (options.list) {
    await listOwners();
    return;
  }

  if (options.revoke) await revoke(options.email);
  else await grant(options.email);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
