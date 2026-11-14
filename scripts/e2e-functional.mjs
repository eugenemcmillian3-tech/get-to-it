#!/usr/bin/env node
/**
 * Authenticated functional smoke test.
 *
 * Exercises the browser path that unit tests and an HTTP crawl cannot:
 * signing in, opening a goal and its task, reopening the task, starting and
 * advancing a workflow, downloading an export, and importing it into a second
 * account. Every browser action in that path is performed with the keyboard.
 * By default it stops before the AI draft, so it needs no provider key and
 * spends no AI request.
 *
 * Required environment:
 *   E2E_SERVICE_ROLE_KEY  Supabase service-role key, used only to create and
 *                         delete the two disposable accounts. Never put it in
 *                         .env.local or a NEXT_PUBLIC_ variable.
 *
 * Optional:
 *   E2E_BASE_URL          Defaults to http://127.0.0.1:3100.
 *   E2E_FULL_WORKFLOW=1   Continue through the AI draft, review and checkpoint.
 *                         The running app must have OLLAMA_API_KEY; this spends
 *                         one AI request.
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

const FULL_WORKFLOW = process.env.E2E_FULL_WORKFLOW === "1";
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

async function activeElement(page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!element) return null;
    const style = getComputedStyle(element);
    return {
      tag: element.tagName.toLowerCase(),
      id: element.id,
      name: element.getAttribute("name"),
      text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
      href: element.getAttribute("href"),
      disabled: element.hasAttribute("disabled"),
      outlineWidth: style.outlineWidth,
      outlineStyle: style.outlineStyle,
      boxShadow: style.boxShadow,
    };
  });
}

/** Presses Tab until the focused element matches, then returns it. */
async function tabTo(page, predicate, description, { max = 180, backwards = false } = {}) {
  for (let index = 0; index < max; index += 1) {
    await page.keyboard.press(backwards ? "Shift+Tab" : "Tab");
    const active = await activeElement(page);
    if (active && predicate(active)) return active;
  }
  throw new Error(
    `Keyboard traversal could not reach ${description} in ${max} tab stops.`,
  );
}

async function activateByKeyboard(page, predicate, description, options) {
  const active = await tabTo(page, predicate, description, options);
  await page.keyboard.press("Enter");
  return active;
}

async function uiLogin(page, account) {
  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
  const email = await tabTo(page, (active) => active.id === "email", "the email field");
  const ring =
    (email.outlineStyle !== "none" && email.outlineWidth !== "0px") ||
    email.boxShadow !== "none";
  if (!ring) throw new Error("The focused email field has no visible focus ring.");
  await page.keyboard.type(account.email);
  await page.keyboard.press("Tab");

  const password = await activeElement(page);
  if (password?.id !== "password") {
    throw new Error(`Tab after email focused ${JSON.stringify(password)}, not the password.`);
  }
  await page.keyboard.type(account.password);
  await tabTo(
    page,
    (active) => active.tag === "button" && active.text === "Sign in",
    "the Sign in button",
  );
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/dashboard", { timeout: 20_000 }),
    page.keyboard.press("Enter"),
  ]);
}

async function openGoalByKeyboard(page, goal) {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await tabTo(
    page,
    (active) => active.tag === "a" && active.text === goal.title,
    "the seeded goal link",
  );
  await Promise.all([
    page.waitForURL((url) => url.pathname === `/goals/${goal.id}`, { timeout: 20_000 }),
    page.keyboard.press("Enter"),
  ]);
  check("goal opens from the dashboard with the keyboard", true);
}

async function openTaskByKeyboard(page, goal, task) {
  await tabTo(
    page,
    (active) =>
      active.tag === "a" && active.href?.endsWith(`/goals/${goal.id}/tasks/${task.id}`),
    "the seeded task link",
  );
  await Promise.all([
    page.waitForURL((url) => url.pathname === `/goals/${goal.id}/tasks/${task.id}`, {
      timeout: 20_000,
    }),
    page.keyboard.press("Enter"),
  ]);
  check("task opens from the goal with the keyboard", true);
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
  return { goal, task };
}

async function runWorkflow(sessionA, accountA, page) {
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
  await activateByKeyboard(
    page,
    (active) => active.tag === "button" && active.text === "Start a run",
    "the Start a run button",
  );
  await page.waitForURL(/\/workflows\/runs\/[0-9a-f-]{36}$/, { timeout: 20_000 });
  check("workflow run starts from the detail page with the keyboard", true);

  await tabTo(
    page,
    (active) => active.id === "workflow-notes",
    "the workflow notes field",
  );
  await page.keyboard.type(
    "Functional smoke test: save this input through the server action.",
  );
  await activateByKeyboard(
    page,
    (active) => active.tag === "button" && active.text === "Save input and continue",
    "the Save input and continue button",
  );

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

  if (!FULL_WORKFLOW) return;

  await page.getByRole("button", { name: "Generate the draft" }).click();
  try {
    await page.locator("#workflow-draft").waitFor({ timeout: 90_000 });
  } catch {
    const alerts = await page
      .locator('[role="alert"]')
      .allTextContents()
      .catch(() => []);
    const detail = alerts.filter(Boolean).join(" | ").slice(0, 500);
    throw new Error(`The AI draft did not produce reviewable text.${detail ? ` ${detail}` : ""}`);
  }
  check("AI draft produces reviewable text", true);

  await page
    .locator("#workflow-draft")
    .fill("Full workflow smoke draft approved by the disposable owner.");
  await page.getByRole("button", { name: "Approve this text" }).click();
  try {
    await page.getByRole("button", { name: "Mark this run complete" }).waitFor({ timeout: 20_000 });
  } catch {
    const alerts = await page
      .locator('[role="alert"]')
      .allTextContents()
      .catch(() => []);
    const detail = alerts.filter(Boolean).join(" | ").slice(0, 500);
    throw new Error(`Approving the draft did not reach the checkpoint.${detail ? ` ${detail}` : ""}`);
  }
  check("approved draft advances to the checkpoint", true);

  await page.getByRole("button", { name: "Mark this run complete" }).click();
  try {
    await page
      .getByText("Every step succeeded and you confirmed the checkpoint.")
      .waitFor({ timeout: 20_000 });
  } catch {
    const alerts = await page
      .locator('[role="alert"]')
      .allTextContents()
      .catch(() => []);
    const detail = alerts.filter(Boolean).join(" | ").slice(0, 500);
    throw new Error(`Confirming the checkpoint did not complete the run.${detail ? ` ${detail}` : ""}`);
  }
  check("confirmed checkpoint completes the workflow run", true);
}

async function exportGoal(page) {
  const exportPath = join(workDir, "export.json");
  await page.goto(`${BASE}/data`, { waitUntil: "domcontentloaded" });
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await activateByKeyboard(
    page,
    (active) => active.tag === "button" && active.text === "Download JSON export",
    "the Download JSON export button",
  );
  const download = await downloadPromise;
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

async function reopenTask(page, session, goal, task) {
  await page.goto(`${BASE}/goals/${goal.id}/tasks/${task.id}`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("button", { name: "Reopen task" }).waitFor({ timeout: 20_000 });
  await activateByKeyboard(
    page,
    (active) => active.tag === "button" && active.text === "Reopen task",
    "the Reopen task button",
  );
  await page.waitForFunction(
    () => {
      const button = Array.from(document.querySelectorAll("button")).find(
        (element) => element.textContent?.trim() === "Mark complete",
      );
      return Boolean(button && !button.disabled);
    },
    null,
    { timeout: 20_000 },
  );

  const rows = await rest(session, `tasks?id=eq.${task.id}&select=status`);
  check(
    "reopened task returns to the to-do list",
    Array.isArray(rows) && rows[0]?.status === "todo",
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
  check("first account signs in with the keyboard", true);
  await uiLogin(pageB, accountB);
  check("second account signs in with the keyboard", true);

  const { goal, task } = await seedGoal(sessionA, accountA);
  await openGoalByKeyboard(pageA, goal);
  await openTaskByKeyboard(pageA, goal, task);
  await reopenTask(pageA, sessionA, goal, task);
  await runWorkflow(sessionA, accountA, pageA);
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
