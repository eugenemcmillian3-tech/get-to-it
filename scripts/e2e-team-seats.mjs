#!/usr/bin/env node
/**
 * Browser regression for team-seat reuse.
 *
 * Starts with an owner and one active member on a two-seat workspace, removes
 * the member through the real UI, invites and cancels a pending replacement to
 * prove cancellation returns the seat, then re-invites the removed member and
 * accepts the invitation.
 *
 * Required environment:
 *   E2E_ALLOW_BILLING_FIXTURE=1  Explicitly allow the disposable paid entitlement
 *                                fixture below. No payment is made.
 *   E2E_SERVICE_ROLE_KEY         Supabase service-role key, used only to create
 *                                and delete disposable accounts and seed the
 *                                isolated workspace entitlement. Never put it in
 *                                .env.local or a NEXT_PUBLIC_ variable.
 *   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
 *                                Read from the process or .env.local.
 *
 * Optional:
 *   E2E_BASE_URL                 Defaults to http://127.0.0.1:3100.
 *
 * The workspace and both accounts are removed in every exit path. Emails,
 * passwords, tokens and keys are never printed.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
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
const workspaceName = `Seat reuse drill ${stamp}`;
const checks = [];
const accounts = [];
let browser = null;
let ownerPage = null;
let workspaceId = null;
let ownerSession = null;

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
  if (process.env.E2E_ALLOW_BILLING_FIXTURE !== "1") {
    throw new Error(
      "Set E2E_ALLOW_BILLING_FIXTURE=1 to run this disposable team-seats fixture. No payment is made.",
    );
  }
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error(
      "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in the environment or .env.local.",
    );
  }
  if (!SERVICE_KEY) {
    throw new Error(
      "Set E2E_SERVICE_ROLE_KEY in the process environment. It is used only for disposable test setup and cleanup.",
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
  const email = `seat-reuse.${label}.${stamp}@get-to-it.test`;
  const password = `SeatReuse-${randomBytes(24).toString("base64url")}`;
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

async function rpc(session, name, args) {
  return rest(session, `rpc/${name}`, {
    method: "POST",
    body: JSON.stringify(args),
  });
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

async function seedWorkspace(accountA, accountB, sessionB) {
  const workspace = await rpc(ownerSession, "create_workspace", {
    p_name: workspaceName,
    p_description: "Browser regression for removing a member and reusing the freed seat.",
  });
  if (!workspace?.ok || !workspace.workspace_id) {
    throw new Error(`The workspace fixture was not created: ${JSON.stringify(workspace)}`);
  }
  workspaceId = workspace.workspace_id;

  const [purchase] = await serviceRest("billing_purchases", {
    method: "POST",
    body: JSON.stringify({
      user_id: accountA.id,
      offer_slug: "team_seats",
      quantity: 2,
      amount_cents: 3800,
      status: "paid",
      workspace_id: workspaceId,
      paid_at: new Date().toISOString(),
    }),
  });
  if (!purchase?.id) throw new Error("The disposable seat purchase was not created.");

  const [entitlement] = await serviceRest("billing_entitlements", {
    method: "POST",
    body: JSON.stringify({
      purchase_id: purchase.id,
      user_id: accountA.id,
      offer_slug: "team_seats",
      grants: ["team_seats"],
      quantity: 2,
      workspace_id: workspaceId,
      status: "active",
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }),
  });
  if (!entitlement?.id) throw new Error("The disposable seat entitlement was not created.");

  const limit = await rpc(ownerSession, "billing_workspace_seat_limit", {
    p_workspace_id: workspaceId,
  });
  check("two-seat fixture is active", Number(limit) === 2);

  const credits = await serviceRest(`credit_ledger?user_id=eq.${accountA.id}&select=id`);
  check("team-seat fixture adds no AI credits", Array.isArray(credits) && credits.length === 0);

  const invitation = await rpc(ownerSession, "create_workspace_invitation", {
    p_workspace_id: workspaceId,
    p_email: accountB.email,
    p_role: "member",
  });
  if (!invitation?.ok || !invitation.token) {
    throw new Error(`The initial invitation was not created: ${JSON.stringify(invitation)}`);
  }
  const accepted = await rpc(sessionB, "accept_workspace_invitation", {
    p_token: invitation.token,
  });
  if (!accepted?.ok) throw new Error("The initial member could not accept the invitation.");
  check("fixture starts with two active members", true);
}

async function cleanupWorkspace() {
  if (!workspaceId) return;
  const id = workspaceId;
  workspaceId = null;

  try {
    await serviceRest(`workspaces?id=eq.${id}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    return;
  } catch (error) {
    console.error(`Could not delete the disposable workspace with the service role: ${error.message}`);
  }

  if (ownerSession) {
    try {
      const deleted = await rpc(ownerSession, "delete_workspace", { p_workspace_id: id });
      if (!deleted?.ok) {
        throw new Error(`The owner could not delete the workspace: ${JSON.stringify(deleted)}`);
      }
    } catch (error) {
      console.error(`Could not delete the disposable workspace as its owner: ${error.message}`);
      throw error;
    }
  }
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

  const accountA = await createAccount("owner");
  const accountB = await createAccount("member");
  ownerSession = await signIn(accountA);
  const initialMemberSession = await signIn(accountB);

  await seedWorkspace(accountA, accountB, initialMemberSession);

  browser = await chromium.launch({ headless: true });
  const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ownerContext.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const memberContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  ownerPage = await ownerContext.newPage();
  const memberPage = await memberContext.newPage();

  await uiLogin(ownerPage, accountA);
  await uiLogin(memberPage, accountB);

  const workspaceUrl = `${BASE}/workspace/${workspaceId}`;
  await ownerPage.goto(workspaceUrl, { waitUntil: "domcontentloaded" });
  await ownerPage.getByRole("heading", { name: workspaceName }).waitFor({ timeout: 20_000 });
  await ownerPage.getByText("2 members · 2 of 2 seats used").waitFor({ timeout: 20_000 });
  await ownerPage.getByText(/No free seats\. This workspace has 2 paid seats\./).waitFor({
    timeout: 20_000,
  });
  check("owner UI sees both seats used and no invite form", true);

  await memberPage.goto(workspaceUrl, { waitUntil: "domcontentloaded" });
  await memberPage.getByRole("heading", { name: workspaceName }).waitFor({ timeout: 20_000 });
  check("member can open the workspace before removal", true);

  const removal = ownerPage
    .locator("details")
    .filter({ hasText: "Remove from workspace" })
    .first();
  await removal.locator("summary").click();
  await removal.getByRole("button", { name: /^Remove / }).click();
  await ownerPage.getByText("1 member · 1 of 2 seats used").waitFor({ timeout: 20_000 });
  await ownerPage.locator("#invite-email").waitFor({ timeout: 20_000 });
  check("owner UI removal frees one seat and restores the invite form", true);

  const removedResponse = await memberPage.goto(workspaceUrl, { waitUntil: "domcontentloaded" });
  check(
    "removed member loses browser access",
    removedResponse?.status() === 404,
    { status: removedResponse?.status() },
  );

  const cancelledInviteeEmail = `cancelled.${stamp}@get-to-it.test`;
  await ownerPage.locator("#invite-email").fill(cancelledInviteeEmail);
  await ownerPage.getByRole("button", { name: "Create invitation link" }).click();
  await ownerPage.getByText(cancelledInviteeEmail, { exact: true }).waitFor({ timeout: 20_000 });
  await ownerPage.getByText("1 member · 2 of 2 seats used").waitFor({ timeout: 20_000 });
  const pendingInvitation = ownerPage
    .locator("li")
    .filter({ hasText: cancelledInviteeEmail })
    .first();
  const cancelledLink = await pendingInvitation
    .getByLabel("Invitation link")
    .inputValue();
  check(
    "pending invitation link stays copyable after the last seat fills",
    cancelledLink.includes("/workspace/join/"),
  );
  await pendingInvitation.getByRole("button", { name: "Copy link" }).click();
  await pendingInvitation.getByRole("button", { name: "Copied" }).waitFor({ timeout: 5_000 });
  const copiedLink = await ownerPage.evaluate(() => navigator.clipboard.readText());
  check("Copy link copies the pending invitation URL", copiedLink === cancelledLink);
  check("UI invitation consumes the freed seat before cancellation", true);

  await pendingInvitation.getByRole("button", { name: "Cancel" }).click();
  await ownerPage.getByText("1 member · 1 of 2 seats used").waitFor({ timeout: 20_000 });
  await ownerPage
    .getByText(cancelledInviteeEmail, { exact: true })
    .waitFor({ state: "detached", timeout: 20_000 });
  await ownerPage.locator("#invite-email").waitFor({ timeout: 20_000 });
  check("UI cancellation frees the seat and removes the pending invitation", true);

  await ownerPage.locator("#invite-email").fill(accountB.email);
  await ownerPage.getByRole("button", { name: "Create invitation link" }).click();
  await ownerPage.getByText(accountB.email, { exact: true }).waitFor({ timeout: 20_000 });
  await ownerPage.getByText("1 member · 2 of 2 seats used").waitFor({ timeout: 20_000 });
  const replacementRow = ownerPage.locator("li").filter({ hasText: accountB.email }).first();
  const inviteLink = await replacementRow
    .getByLabel("Invitation link")
    .inputValue();
  const inviteToken = new URL(inviteLink, BASE).pathname.split("/").filter(Boolean).pop() ?? "";
  if (!inviteToken) throw new Error("The UI did not render a usable invitation link.");
  check("UI invitation consumes the freed seat before acceptance", true);

  const accepted = await rpc(initialMemberSession, "accept_workspace_invitation", {
    p_token: inviteToken,
  });
  check("replacement invitation is accepted", accepted?.ok === true);

  await ownerPage.reload({ waitUntil: "domcontentloaded" });
  await ownerPage.getByText("2 members · 2 of 2 seats used").waitFor({ timeout: 20_000 });
  check("accepted replacement restores both active seats", true);
  check(
    "replacement is no longer listed as a former member",
    (await ownerPage.getByText("Former members", { exact: true }).count()) === 0,
  );

  await memberPage.goto(workspaceUrl, { waitUntil: "domcontentloaded" });
  await memberPage.getByRole("heading", { name: workspaceName }).waitFor({ timeout: 20_000 });
  check("replacement member can open the workspace again", true);
}

let failure = null;

try {
  await main();
} catch (error) {
  failure = error;
  console.error(`Team-seat browser drill failed: ${error.message}`);
  if (ownerPage) {
    try {
      mkdirSync("artifacts", { recursive: true });
      await ownerPage.screenshot({
        path: "artifacts/e2e-team-seats-failure.png",
        fullPage: true,
      });
    } catch {
      // The page may already be closed or showing a navigation error.
    }
  }
} finally {
  if (browser) await browser.close().catch(() => {});

  try {
    await cleanupWorkspace();
  } catch (error) {
    console.error(`Disposable workspace cleanup failed: ${error.message}`);
    if (!failure) failure = new Error("Disposable workspace cleanup failed.");
  }

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
