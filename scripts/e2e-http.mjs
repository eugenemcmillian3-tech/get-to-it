#!/usr/bin/env node
/**
 * Authenticated HTTP end-to-end crawl.
 *
 * Starts from the running app, creates a disposable confirmed account with the
 * Supabase Admin API, signs in, seeds one goal/task/app project, crawls every
 * route and API contract, and deletes the account in every exit path.
 *
 * Required environment:
 *   E2E_SERVICE_ROLE_KEY  Supabase service-role key, used only by this runner.
 *                         Pass it in the process environment; do not put it in
 *                         .env.local or any NEXT_PUBLIC_ variable.
 *
 * Optional:
 *   E2E_BASE_URL          Defaults to http://127.0.0.1:3100.
 *   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
 *                         Read from the process or .env.local.
 *
 * The test account is random per run. Its email is never printed and its
 * password is held only in memory.
 */

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const BASE = (process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const LOCAL_ENV = readLocalEnv();

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? LOCAL_ENV.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? LOCAL_ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = process.env.E2E_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const results = [];
const failures = [];
const created = { goal: null, task: null, project: null };

let session = null;
let testUser = null;

function readLocalEnv() {
  try {
    const text = readFileSync(".env.local", "utf8");
    const values = {};
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2").trim();
    }
    return values;
  } catch {
    return {};
  }
}

function requireConfiguration() {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error(
      "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in the environment or .env.local.",
    );
  }
  if (!SERVICE_KEY) {
    throw new Error(
      "Set E2E_SERVICE_ROLE_KEY in the process environment. It is used only to create and delete the disposable test account; never commit it or add it to .env.local.",
    );
  }
}

async function jsonRequest(url, options, label) {
  const response = await fetch(url, options);
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 500);
    }
  }
  if (!response.ok) {
    const detail = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`${label} failed (${response.status}): ${detail.slice(0, 500)}`);
  }
  return body;
}

async function createTestUser() {
  const email = `e2e.http.${Date.now()}.${randomBytes(4).toString("hex")}@get-to-it.test`;
  const password = `E2e-${randomBytes(24).toString("base64url")}`;
  const body = await jsonRequest(
    `${SUPABASE_URL}/auth/v1/admin/users`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email, password, email_confirm: true }),
    },
    "Creating the disposable test account",
  );
  if (!body?.id) throw new Error("The Admin API did not return a user id.");
  return { id: body.id, email, password };
}

async function signIn(user) {
  const body = await jsonRequest(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: ANON_KEY, "content-type": "application/json" },
      body: JSON.stringify({ email: user.email, password: user.password }),
    },
    "Signing in the disposable test account",
  );
  if (!body?.access_token || !body?.refresh_token || !body?.user?.id) {
    throw new Error("The sign-in response did not contain a complete session.");
  }
  return body;
}

function cookieHeader(current) {
  const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
  const value = `base64-${Buffer.from(JSON.stringify(current)).toString("base64url")}`;
  return `sb-${ref}-auth-token=${value}`;
}

async function rest(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
      "content-type": "application/json",
      Prefer: "return=representation",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 500);
    }
  }
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status}): ${JSON.stringify(body).slice(0, 500)}`);
  }
  return body;
}

async function seed() {
  const userId = session.user.id;
  const [goal] = await rest("goals", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      title: "E2E full project test",
      desired_outcome: "Prove the full project renders and persists real rows.",
      time_available_minutes: 30,
      blocker: "No blocker for this test.",
    }),
  });
  created.goal = goal.id;

  const [task] = await rest("tasks", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      goal_id: created.goal,
      title: "Check the task workspace",
      status: "todo",
    }),
  });
  created.task = task.id;

  const [project] = await rest("app_projects", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      name: "E2E Route Check",
      purpose: "Exercise the build workspace routes end to end.",
      target_users: "The signed-in owner",
      workflows: "Create a checklist and review it.",
      required_pages: "/releases | Releases | Review releases",
      entities: "release: title, status",
      auth_requirements: "none",
      integrations: "",
      design_preferences: "Plain",
      definition_of_done: "Every build route renders without an error.",
    }),
  });
  created.project = project.id;
}

async function page(path, expected = 200) {
  const response = await fetch(BASE + path, {
    headers: { cookie: cookieHeader(session) },
    redirect: "manual",
  });
  const html = await response.text();
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] ?? "";
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1]
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim() ?? "";
  const bad = /<h1[^>]*>[^<]*That didn[^<]*t load|Application error: a server-side exception/i.test(html);
  const ok = response.status === expected && !bad;
  const row = { path, status: response.status, expected, title: title.slice(0, 100), h1: h1.slice(0, 160), bytes: html.length, ok };
  results.push(row);
  if (!ok) failures.push(row);
  return row;
}

async function apiCheck(path, expected, options = {}) {
  const response = await fetch(BASE + path, {
    method: options.method ?? "GET",
    headers: {
      cookie: cookieHeader(session),
      "content-type": "application/json",
    },
    body: options.body,
    redirect: "manual",
  });
  const text = (await response.text()).slice(0, 400);
  const location = response.headers.get("location") ?? "";
  const locationOk = !options.locationIncludes || location.includes(options.locationIncludes);
  const row = { path, status: response.status, expected, location, ok: response.status === expected && locationOk, body: text };
  if (!row.ok) failures.push(row);
  return row;
}

async function cleanupRows() {
  for (const [table, id] of [
    ["tasks", created.task],
    ["goals", created.goal],
    ["app_projects", created.project],
  ]) {
    if (!id || !session) continue;
    try {
      await rest(`${table}?id=eq.${id}`, { method: "DELETE" });
    } catch (error) {
      console.error(`Could not delete seeded ${table} row: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

async function deleteTestUser() {
  if (!testUser) return;
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${testUser.id}`, {
      method: "DELETE",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Admin API returned ${response.status}`);
    }
  } catch (error) {
    console.error(`Could not delete the disposable test account: ${error.message}`);
    process.exitCode = 1;
  }
}

async function main() {
  requireConfiguration();

  const healthResponse = await fetch(`${BASE}/api/health`);
  if (!healthResponse.ok) throw new Error(`The app is not healthy at ${BASE} (${healthResponse.status}).`);
  const health = await healthResponse.json();
  if (health?.status !== "ok") throw new Error(`The app health check is not ok: ${JSON.stringify(health).slice(0, 300)}`);

  testUser = await createTestUser();
  session = await signIn(testUser);
  await seed();

  await page("/");
  await page("/dashboard");
  await page("/plan");
  await page("/templates");
  await page("/data");
  await page("/settings");
  await page("/reminders");
  await page("/partner");
  await page("/futures");
  await page("/reviews");
  await page("/radar");
  await page("/outcomes");
  await page("/workspace");
  await page("/build");
  await page("/credits");
  await page("/workflows");
  await page("/owner", 404);
  await page(`/goals/${created.goal}`);
  await page(`/goals/${created.goal}/tasks/${created.task}`);
  await page(`/goals/${created.goal}/learn`);
  await page(`/build/${created.project}`);
  await page(`/build/${created.project}/connections`);
  await page(`/build/${created.project}/integrations`);
  await page(`/build/${created.project}/api`);
  await page(`/build/${created.project}/design`);
  await page(`/build/${created.project}/room`);
  await page(`/build/${created.project}/team`);
  await page(`/build/${created.project}/workspace`);
  await page(`/build/${created.project}/deploy`);
  await page(`/build/${created.project}/releases`);
  await page(`/build/${created.project}/improve`);
  await page("/sign-in", 307);
  await page("/sign-up", 307);
  await page("/definitely-not-a-route", 404);
  await page("/docs/composio-connections.md");

  const apiChecks = [];
  for (const [path, expected, options] of [
    ["/api/health", 200, {}],
    ["/api/v1", 200, {}],
    ["/api/v1/projects", 401, { method: "POST", body: "{}" }],
    ["/api/mcp", 401, { method: "POST", body: "{}" }],
    ["/api/reminders/run", 503, { method: "POST" }],
    ["/auth/callback", 307, {}],
    ["/api/composio/callback?state=x&connected_account_id=ca_test", 307, { locationIncludes: "composio=" }],
  ]) {
    apiChecks.push(await apiCheck(path, expected, options));
  }

  const summary = {
    base: BASE,
    pages: results.length,
    pageFailures: failures.filter((row) => !row.path.startsWith("/api") && !row.path.startsWith("/auth")).length,
    failures,
    apiChecks,
    health,
    user: { id: session.user.id },
  };
  console.log(JSON.stringify(summary, null, 2));
  if (failures.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(`E2E failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanupRows();
    await deleteTestUser();
  });
