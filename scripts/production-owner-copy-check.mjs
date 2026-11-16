#!/usr/bin/env node
/**
 * Production owner-copy release assertion.
 *
 * Waits for the deployed `/api/health` revision to match the expected commit,
 * signs in as a disposable account, grants that account owner access, and
 * checks the learning, mission, workflow and preview-repair pages. Each page
 * must return 200, show owner copy, stay signed in, and contain no per-request
 * credit price such as `1 credit ($0.10)`.
 *
 * Required environment:
 *   OWNER_COPY_BASE_URL               Deployed origin, without a trailing slash.
 *   OWNER_COPY_SUPABASE_URL           Production Supabase URL.
 *   OWNER_COPY_SUPABASE_ANON_KEY      Production anon key.
 *   OWNER_COPY_SERVICE_ROLE_KEY       Production service-role key, used only to
 *                                     create, seed and delete disposable rows.
 *
 * Fallbacks: EMAIL_SMOKE_SUPABASE_* / EMAIL_SMOKE_SERVICE_ROLE_KEY, then
 * NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / E2E_SERVICE_ROLE_KEY
 * or SUPABASE_SERVICE_ROLE_KEY for local runs.
 *
 * Optional:
 *   EXPECTED_REVISION            Commit SHA the deployed health revision must
 *                                match, compared by its first 12 characters.
 *   REVISION_TIMEOUT_SECONDS     Defaults to 900.
 *
 * Disposable rows and the account are removed in every exit path. Emails,
 * passwords, tokens and keys are never printed.
 */

import { mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";

const BASE = (process.env.OWNER_COPY_BASE_URL ?? "").replace(/\/$/, "");
const SUPABASE_URL = (
  process.env.OWNER_COPY_SUPABASE_URL ??
  process.env.EMAIL_SMOKE_SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  ""
).replace(/\/$/, "");
const ANON_KEY =
  process.env.OWNER_COPY_SUPABASE_ANON_KEY ??
  process.env.EMAIL_SMOKE_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";
const SERVICE_KEY =
  process.env.OWNER_COPY_SERVICE_ROLE_KEY ??
  process.env.EMAIL_SMOKE_SERVICE_ROLE_KEY ??
  process.env.E2E_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "";
const EXPECTED_REVISION = (process.env.EXPECTED_REVISION ?? "").trim().toLowerCase();
const REVISION_TIMEOUT_SECONDS = Number(process.env.REVISION_TIMEOUT_SECONDS ?? 900);

const stamp = `${Date.now()}.${randomBytes(3).toString("hex")}`;
const PER_REQUEST_CREDIT_PRICE = /\b[1-9]\d*\s+credits?\s*\(\s*\$\d+\.\d{2}\s*\)/i;
const checks = [];
const accounts = [];
const fixture = {
  goalId: null,
  workspaceId: null,
  workflowId: null,
  projectId: null,
};
let browser = null;
let page = null;

function requireConfiguration() {
  const missing = [];
  if (!BASE) missing.push("OWNER_COPY_BASE_URL");
  if (!SUPABASE_URL) missing.push("OWNER_COPY_SUPABASE_URL");
  if (!ANON_KEY) missing.push("OWNER_COPY_SUPABASE_ANON_KEY");
  if (!SERVICE_KEY) missing.push("OWNER_COPY_SERVICE_ROLE_KEY");
  if (missing.length > 0) {
    throw new Error(`Missing required environment: ${missing.join(", ")}.`);
  }
  if (!Number.isFinite(REVISION_TIMEOUT_SECONDS) || REVISION_TIMEOUT_SECONDS <= 0) {
    throw new Error("REVISION_TIMEOUT_SECONDS must be a positive number.");
  }
  if (EXPECTED_REVISION && EXPECTED_REVISION.length < 12) {
    throw new Error("EXPECTED_REVISION must contain at least the first 12 characters.");
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

async function serviceRest(path, options = {}) {
  return jsonRequest(
    `${SUPABASE_URL}/rest/v1/${path}`,
    {
      ...options,
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "content-type": "application/json",
        Prefer: "return=representation",
        ...(options.headers ?? {}),
      },
    },
    `Service REST ${path}`,
  );
}

function check(name, condition, detail = {}) {
  if (!condition) throw new Error(`${name} failed.`);
  checks.push({ name, ...detail });
  console.log(`ok - ${name}`);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForProductionRevision() {
  const deadline = Date.now() + REVISION_TIMEOUT_SECONDS * 1000;
  let lastRevision = "";
  let lastError = "";

  for (;;) {
    try {
      const response = await fetch(`${BASE}/api/health`, { cache: "no-store" });
      if (response.ok) {
        const health = await response.json();
        const revision = String(health?.revision ?? "");
        if (health?.status === "ok") {
          const matches =
            !EXPECTED_REVISION ||
            revision.toLowerCase().startsWith(EXPECTED_REVISION.slice(0, 12));
          if (matches) {
            check(
              EXPECTED_REVISION
                ? "production health reports the merged revision"
                : "production health is ok",
              true,
              { revision },
            );
            return revision;
          }
          if (revision !== lastRevision) {
            console.log(
              `Waiting for production revision ${EXPECTED_REVISION.slice(0, 12)}; health reports ${revision || "unknown"}...`,
            );
            lastRevision = revision;
          }
        } else {
          lastError = `health status ${String(health?.status ?? "unknown")}`;
        }
      } else {
        lastError = `health HTTP ${response.status}`;
      }
    } catch (error) {
      lastError = error.message;
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `Production did not report ${EXPECTED_REVISION.slice(0, 12)} within ${REVISION_TIMEOUT_SECONDS}s${lastRevision ? `; last revision was ${lastRevision}` : ""}${lastError ? `; ${lastError}` : ""}.`,
      );
    }
    await sleep(5_000);
  }
}

async function createAccount() {
  const email = `owner-copy.${stamp}@get-to-it.test`;
  const password = `OwnerCopy-${randomBytes(24).toString("base64url")}`;
  const body = await admin("/users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!body?.id) throw new Error("The Admin API did not return an account id.");
  const account = { id: body.id, email, password };
  accounts.push(account);
  return account;
}

async function uiLogin(account) {
  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
  await page.locator("#email").fill(account.email);
  await page.locator("#password").fill(account.password);
  await Promise.all([
    page.waitForURL((url) => url.pathname === "/dashboard", { timeout: 20_000 }),
    page.getByRole("button", { name: /^Sign in$/ }).click(),
  ]);
  check("disposable account signs in before owner access is granted", true);
}

async function grantOwner(account) {
  await serviceRest("app_owners", {
    method: "POST",
    body: JSON.stringify({ user_id: account.id }),
  });
  check("disposable account is granted owner access", true);
}

async function seedFixture(account) {
  const [goal] = await serviceRest("goals", {
    method: "POST",
    body: JSON.stringify({
      user_id: account.id,
      title: `Owner copy goal ${stamp}`,
      desired_outcome: "Read owner-facing copy without a per-request price.",
      time_available_minutes: 30,
      blocker: "None; this is a disposable release fixture.",
    }),
  });
  fixture.goalId = goal.id;

  const [workspace] = await serviceRest("workspaces", {
    method: "POST",
    body: JSON.stringify({
      name: `Owner copy workspace ${stamp}`,
      description: "Disposable release fixture for owner-facing mission copy.",
      created_by: account.id,
    }),
  });
  fixture.workspaceId = workspace.id;

  await serviceRest("workspace_members", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspace.id,
      user_id: account.id,
      role: "owner",
      status: "active",
    }),
  });

  const [mission] = await serviceRest("missions", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: workspace.id,
      created_by: account.id,
      title: `Owner copy mission ${stamp}`,
      category: "learning",
      problem: "Disposable release fixture for owner-facing mission copy.",
      stakeholders: "One test account",
      desired_outcome: "Read the owner copy without a per-request price.",
      constraints: "",
      status: "active",
      decision_owner_id: account.id,
    }),
  });

  const workflowName = `Owner copy workflow ${stamp}`;
  const steps = [
    {
      kind: "user_input",
      title: "Collect input",
      instructions: "",
      retry_policy: "manual",
      config: {},
    },
    {
      kind: "ai_draft",
      title: "Draft the update",
      instructions: "Write a short update from the notes.",
      retry_policy: "manual",
      config: {},
    },
  ];
  const [workflow] = await serviceRest("workflows", {
    method: "POST",
    body: JSON.stringify({
      user_id: account.id,
      name: workflowName,
      description: "Disposable release fixture for owner-facing workflow copy.",
      goal_id: goal.id,
      current_version: 1,
    }),
  });
  fixture.workflowId = workflow.id;

  await serviceRest("workflow_versions", {
    method: "POST",
    body: JSON.stringify({
      workflow_id: workflow.id,
      version: 1,
      name: workflowName,
      description: "Disposable release fixture for owner-facing workflow copy.",
      goal_id: goal.id,
      steps,
    }),
  });

  const [run] = await serviceRest("workflow_runs", {
    method: "POST",
    body: JSON.stringify({
      user_id: account.id,
      workflow_id: workflow.id,
      workflow_name: workflowName,
      workflow_version: 1,
      goal_id: goal.id,
      status: "waiting_for_input",
      current_position: 1,
      context: {},
      credit_budget: 10,
      credits_spent: 0,
    }),
  });

  await serviceRest("workflow_run_steps", {
    method: "POST",
    body: JSON.stringify([
      {
        run_id: run.id,
        user_id: account.id,
        position: 1,
        kind: "user_input",
        title: "Collect input",
        instructions: "",
        config: {},
        retry_policy: "manual",
        status: "waiting_for_input",
        attempt: 0,
      },
      {
        run_id: run.id,
        user_id: account.id,
        position: 2,
        kind: "ai_draft",
        title: "Draft the update",
        instructions: "Write a short update from the notes.",
        config: {},
        retry_policy: "manual",
        status: "pending",
        attempt: 0,
      },
    ]),
  });

  const [project] = await serviceRest("app_projects", {
    method: "POST",
    body: JSON.stringify({
      user_id: account.id,
      name: `Owner copy project ${stamp}`,
      purpose: "Verify owner-facing preview repair copy after a release.",
      target_users: "The disposable release account",
      workflows: "Open the preview workspace and read the owner copy.",
      required_pages: "Preview workspace",
      entities: "",
      auth_requirements: "none",
      integrations: "",
      definition_of_done: "The owner copy renders without a per-request price.",
    }),
  });
  fixture.projectId = project.id;

  const [appWorkspace] = await serviceRest("app_workspaces", {
    method: "POST",
    body: JSON.stringify({
      project_id: project.id,
      user_id: account.id,
      runner_key: randomBytes(16).toString("hex"),
      status: "checks_failed",
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      iterations: 0,
      ai_requests: 0,
      credit_budget: 6,
      credits_spent: 0,
    }),
  });

  await serviceRest("app_workspace_runs", {
    method: "POST",
    body: JSON.stringify({
      workspace_id: appWorkspace.id,
      project_id: project.id,
      user_id: account.id,
      kind: "checks",
      status: "failed",
      iteration: 0,
      checks: [
        { name: "typecheck", label: "Typecheck", status: "failed", code: 1 },
      ],
      log: "Seeded failure for the production owner-copy release assertion.",
      changed_files: [],
      diff: "",
      ai_requests: 0,
      error: null,
    }),
  });

  check("disposable owner fixture is ready", true);
  return {
    goalId: goal.id,
    workspaceId: workspace.id,
    missionId: mission.id,
    workflowId: workflow.id,
    runId: run.id,
    projectId: project.id,
  };
}

async function expectOwnerPage(path, label, copy) {
  const response = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  check(`${label} returns 200`, response?.status() === 200, {
    status: response?.status(),
  });
  await page.getByText(copy).first().waitFor({ timeout: 20_000 });

  const body = (await page.locator("body").textContent()) ?? "";
  const price = body.match(PER_REQUEST_CREDIT_PRICE);
  check(`${label} shows no per-request credit price`, !price, price ? { price: price[0] } : {});
  check(`${label} stays signed in`, !new URL(page.url()).pathname.startsWith("/sign-in"));
}

async function verifyOwnerCopy(seeded) {
  await expectOwnerPage(
    `/goals/${seeded.goalId}/learn`,
    "production owner learning page",
    "This request: no charge on your owner account.",
  );
  await expectOwnerPage(
    `/workspace/${seeded.workspaceId}/missions/${seeded.missionId}`,
    "production owner mission page",
    "One request (no charge on your owner account), one suggestion.",
  );
  await expectOwnerPage(
    `/workflows/${seeded.workflowId}`,
    "production owner workflow page",
    "Owner account: drafts are not charged.",
  );
  await expectOwnerPage(
    `/workflows/runs/${seeded.runId}`,
    "production owner workflow run page",
    "Owner account: drafts are not charged.",
  );
  await expectOwnerPage(
    `/build/${seeded.projectId}/workspace`,
    "production owner preview-repair page",
    "Owner account: AI repairs not charged",
  );
}

async function deleteRow(path, label, errors) {
  try {
    await serviceRest(path, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  } catch (error) {
    errors.push(`${label}: ${error.message}`);
  }
}

async function cleanupFixture() {
  const errors = [];
  const { workspaceId, workflowId, projectId } = fixture;
  fixture.workspaceId = null;
  fixture.workflowId = null;
  fixture.projectId = null;

  if (projectId) {
    await deleteRow(`app_projects?id=eq.${projectId}`, "app project", errors);
  }
  if (workflowId) {
    await deleteRow(`workflows?id=eq.${workflowId}`, "workflow", errors);
  }
  if (workspaceId) {
    await deleteRow(`workspaces?id=eq.${workspaceId}`, "workspace", errors);
  }
  if (errors.length > 0) throw new Error(errors.join(" "));
}

async function main() {
  requireConfiguration();
  const revision = await waitForProductionRevision();
  console.log(`Production owner-copy check against ${BASE} (${revision}).`);

  const account = await createAccount();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await uiLogin(account);
  await grantOwner(account);

  const seeded = await seedFixture(account);
  await verifyOwnerCopy(seeded);
}

let failure = null;

try {
  await main();
} catch (error) {
  failure = error;
  console.error(`Production owner-copy check failed: ${error.message}`);
  if (page) {
    try {
      mkdirSync("artifacts", { recursive: true });
      await page.screenshot({
        path: "artifacts/production-owner-copy-failure.png",
        fullPage: true,
      });
    } catch {
      // The page may already be closed or showing a navigation error.
    }
  }
} finally {
  if (browser) await browser.close().catch(() => {});

  try {
    await cleanupFixture();
  } catch (error) {
    console.error(`Disposable production fixture cleanup failed: ${error.message}`);
    if (!failure) failure = new Error("Disposable production fixture cleanup failed.");
  }

  for (const account of accounts) {
    try {
      await admin(`/users/${account.id}`, { method: "DELETE" });
    } catch (error) {
      console.error(`Could not delete the disposable production account: ${error.message}`);
      if (!failure) failure = new Error("Disposable production account cleanup failed.");
    }
  }
}

console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
if (failure) process.exitCode = 1;
