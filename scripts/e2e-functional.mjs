#!/usr/bin/env node
/**
 * Authenticated functional smoke test.
 *
 * Exercises the browser path that unit tests and an HTTP crawl cannot:
 * saving a workflow step through a server action, downloading an export, and
 * importing it into a second account. It deliberately stops before the AI
 * draft, so it needs no provider key and spends no AI request.
 *
 * Required environment:
 *   E2E_SERVICE_ROLE_KEY  Supabase service-role key, used only to create and
 *                         delete the two disposable accounts. Never put it in
 *                         .env.local or a NEXT_PUBLIC_ variable.
 *
 * Optional:
 *   E2E_BASE_URL          Defaults to http://127.0.0.1:3100.
 *   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
 *                         Read from the process or .env.local.
 *
 * Accounts and their rows are removed in every exit path. Emails, passwords,
 * tokens and keys are never printed.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = (process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");
const LOCAL_ENV = readLocalEnv();

const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  LOCAL_ENV.NEXT_PUBLIC_SUPABASE_URL ??
  ""
).replace(/\/$/, "");
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? LOCAL_ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY =
  process.env.E2E_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const stamp = `${Date.now()}.${randomBytes(3).toString("hex")}`;
const goalTitle = `Functional export goal ${stamp}`;
const checks = [];
const accounts = [];
let browser = null;
let pageA = null;
let pageB = null;
let workDir = null;

function readLocalEnv() {
  try {
    const values = {};
    const text = readFileSync(".env.local", "utf8");
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
      "Set E2E_SERVICE_ROLE_KEY in the process environment. It is used only to create and delete the disposable accounts; never commit it or add it to .env.local.",
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

async function admin(path, options = {}) {
  return jsonRequest(
    `${SUPABASE_URL}/auth/v1/admin${path}`,
    {
      ...options,
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "content-type": "application/json",
        ...(options.headers ?? {}),
      },
    },
    `Admin request ${path}`,
  );
}

async function createAccount(label) {
  const email = `functional.${label}.${stamp}@get-to-it.test`;
  const password = `Functional-${randomBytes(24).toString("base64url")}`;
  const body = await admin("/users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!body?.id) throw new Error(`The Admin API did not return an id for account ${label}.`);
  const account = { id: body.id, email, password, label };
  accounts.push(account);
  return account;
}

async function signIn(account) {
  const body = await jsonRequest(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: { apikey: ANON_KEY, "content-type": "application/json" },
      body: JSON.stringify({ email: account.email, password: account.password }),
    },
    `Signing in account ${account.label}`,
  );
  if (!body?.access_token || !body?.user?.id) {
    throw new Error(`The sign-in response for account ${account.label} was incomplete.`);
  }
  return body;
}

async function rest(session, path, options = {}) {
  return jsonRequest(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      ...options,
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
        "content-type": "application/json",
        Prefer: "return=representation",
        ...(options.headers ?? {}),
      },
    },
    `REST ${path}`,
  );
}

async function uiLogin(page, account) {
  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
  await page.locator("#email").fill(account.email);
  await page.locator("#password").fill(account.password);
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/dashboard", { timeout: 20_000 }),
    page.getByRole("button", { name: /^Sign in$/ }).click(),
  ]);
}

function check(name, condition, detail = {}) {
  if (!condition) throw new Error(`${name} failed.`);
  checks.push({ name, ...detail });
  console.log(`ok - ${name}`);
}

async function seedGoal(sessionA, accountA) {
  const [goal] = await rest(sessionA, "goals", {
    method: "POST",
    body: JSON.stringify({
      user_id: accountA.id,
      title: goalTitle,
      desired_outcome: "Prove the workflow action, export and cross-account import paths.",
      time_available_minutes: 30,
      blocker: "No blocker for this functional smoke test.",
    }),
  });
  const [task] = await rest(sessionA, "tasks", {
    method: "POST",
    body: JSON.stringify({
      user_id: accountA.id,
      goal_id: goal.id,
      title: "Functional export task",
      status: "completed",
      completed_at: new Date().toISOString(),
    }),
  });
  check("seed account has one goal and one completed task", Boolean(goal?.id && task?.id));
  return goal;
}

async function runWorkflowInput(sessionA, accountA, page) {
  const steps = [
    { kind: "user_input", title: "Collect input", instructions: "", retry_policy: "manual", config: {} },
    {
      kind: "ai_draft",
      title: "Draft the update",
      instructions: "Write a short update from the notes.",
      retry_policy: "manual",
      config: {},
    },
    { kind: "user_review", title: "Review the draft", instructions: "", retry_policy: "manual", config: {} },
    { kind: "checkpoint", title: "Confirm completion", instructions: "", retry_policy: "manual", config: {} },
  ];
  const [workflow] = await rest(sessionA, "workflows", {
    method: "POST",
    body: JSON.stringify({
      user_id: accountA.id,
      name: `Functional workflow ${stamp}`,
      description: "Created for the functional smoke test.",
      goal_id: null,
      current_version: 1,
    }),
  });
  await rest(sessionA, "workflow_versions", {
    method: "POST",
    body: JSON.stringify({
      workflow_id: workflow.id,
      version: 1,
      name: `Functional workflow ${stamp}`,
      description: "Created for the functional smoke test.",
      goal_id: null,
      steps,
    }),
  });

  await page.goto(`${BASE}/workflows/${workflow.id}`, { waitUntil: "domcontentloaded" });
  await Promise.all([
    page.waitForURL(/\/workflows\/runs\/[0-9a-f-]{36}$/, { timeout: 20_000 }),
    page.getByRole("button", { name: "Start a run" }).click(),
  ]);
  check("workflow run starts from the detail page", true);

  await page
    .locator("#workflow-notes")
    .fill("Functional smoke test: save this input through the server action.");
  await page.getByRole("button", { name: "Save input and continue" }).click();

  try {
    await page.getByRole("button", { name: "Generate the draft" }).waitFor({ timeout: 20_000 });
  } catch {
    const alerts = await page
      .locator('[role="alert"]')
      .allTextContents()
      .catch(() => []);
    const detail = alerts.filter(Boolean).join(" | ").slice(0, 500);
    throw new Error(`Saving workflow input did not advance the run.${detail ? ` ${detail}` : ""}`);
  }
  check("workflow input server action advances to the draft step", true);
}

async function exportGoal(page) {
  const exportPath = join(workDir, "export.json");
  await page.goto(`${BASE}/data`, { waitUntil: "domcontentloaded" });
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByRole("button", { name: "Download JSON export" }).click(),
  ]);
  await download.saveAs(exportPath);
  const parsed = JSON.parse(readFileSync(exportPath, "utf8"));
  check(
    "download is a valid export with one goal and one task",
    parsed.format === "get-to-it.export" &&
      parsed.counts?.goals === 1 &&
      parsed.counts?.tasks === 1,
    { goals: parsed.counts?.goals, tasks: parsed.counts?.tasks },
  );
  return exportPath;
}

async function importGoal(page, exportPath) {
  await page.goto(`${BASE}/data`, { waitUntil: "domcontentloaded" });
  await page.locator("#import-file").setInputFiles(exportPath);
  await page.getByRole("button", { name: "Preview import" }).click();
  await page.locator("#import-confirm").waitFor({ timeout: 20_000 });
  await page.locator("#import-confirm").fill("IMPORT");
  await Promise.all([
    page.getByRole("link", { name: "Open your goals" }).waitFor({ timeout: 30_000 }),
    page.getByRole("button", { name: "Import this data" }).click(),
  ]);
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.getByText(goalTitle, { exact: true }).first().waitFor({ timeout: 20_000 });
  check("second account imports and sees the goal", true);
}

async function verifyIsolation(sessionA, sessionB, originalGoal) {
  const goalsB = await rest(sessionB, "goals?select=id,title");
  const imported = Array.isArray(goalsB) ? goalsB.find((goal) => goal.title === goalTitle) : null;
  check("second account owns the imported goal", Boolean(imported?.id));
  check("the imported goal is a new row, not the original", imported.id !== originalGoal.id);

  const tasksB = await rest(
    sessionB,
    `tasks?goal_id=eq.${imported.id}&select=title,status`,
  );
  check(
    "the imported completed task kept its status",
    Array.isArray(tasksB) &&
      tasksB.some((task) => task.title === "Functional export task" && task.status === "completed"),
  );

  const foreign = await rest(sessionB, `goals?id=eq.${originalGoal.id}&select=id`);
  check("second account cannot read the original goal row", Array.isArray(foreign) && foreign.length === 0);

  const goalsA = await rest(sessionA, "goals?select=id,title");
  check(
    "first account still owns its original goal unchanged",
    Array.isArray(goalsA) &&
      goalsA.some((goal) => goal.id === originalGoal.id && goal.title === goalTitle),
  );
}

async function main() {
  requireConfiguration();

  const healthResponse = await fetch(`${BASE}/api/health`);
  if (!healthResponse.ok) {
    throw new Error(`The app is not healthy at ${BASE} (${healthResponse.status}).`);
  }
  const health = await healthResponse.json();
  if (health?.status !== "ok") {
    throw new Error(`The app health check is not ok: ${JSON.stringify(health).slice(0, 300)}`);
  }

  workDir = mkdtempSync(join(tmpdir(), "get-to-it-functional-"));
  const accountA = await createAccount("a");
  const accountB = await createAccount("b");
  const sessionA = await signIn(accountA);
  const sessionB = await signIn(accountB);

  browser = await chromium.launch({ headless: true });
  const contextA = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  const contextB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  pageA = await contextA.newPage();
  pageB = await contextB.newPage();

  await uiLogin(pageA, accountA);
  check("first account signs in through the UI", true);
  await uiLogin(pageB, accountB);
  check("second account signs in through the UI", true);

  const goal = await seedGoal(sessionA, accountA);
  await runWorkflowInput(sessionA, accountA, pageA);
  const exportPath = await exportGoal(pageA);
  await importGoal(pageB, exportPath);
  await verifyIsolation(sessionA, sessionB, goal);
}

let failure = null;

try {
  await main();
} catch (error) {
  failure = error;
  console.error(`Functional smoke test failed: ${error.message}`);
  if (pageA) {
    try {
      mkdirSync("artifacts", { recursive: true });
      await pageA.screenshot({
        path: "artifacts/e2e-functional-failure.png",
        fullPage: true,
      });
    } catch {
      // The app may already have navigated to an error or closed.
    }
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  if (workDir) rmSync(workDir, { recursive: true, force: true });

  for (const account of accounts) {
    try {
      await admin(`/users/${account.id}`, { method: "DELETE" });
    } catch (error) {
      console.error(`Could not delete disposable account ${account.label}: ${error.message}`);
      if (!failure) failure = new Error(`Disposable account cleanup failed for ${account.label}.`);
    }
  }
}

console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
if (failure) process.exitCode = 1;
