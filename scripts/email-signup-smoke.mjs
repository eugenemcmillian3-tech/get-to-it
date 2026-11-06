#!/usr/bin/env node
/**
 * Production email-delivery smoke test.
 *
 * Creates a disposable mailbox, signs up through Supabase Auth, waits for the
 * confirmation message delivered through the configured SMTP provider, follows
 * the confirmation link, signs in, and then removes both the auth user and the
 * mailbox. The address, passwords, tokens and confirmation URL are never
 * printed.
 *
 * Required environment:
 *   EMAIL_SMOKE_SUPABASE_URL       Supabase project URL.
 *   EMAIL_SMOKE_SUPABASE_ANON_KEY  Browser-safe anon key for that project.
 *   EMAIL_SMOKE_SERVICE_ROLE_KEY   Service-role key used only to delete the
 *                                  disposable user.
 *
 * Local fallbacks are NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 * E2E_SERVICE_ROLE_KEY and SUPABASE_SERVICE_ROLE_KEY.
 */

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const LOCAL_ENV = readLocalEnv();
const SUPABASE_URL = (
  process.env.EMAIL_SMOKE_SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  LOCAL_ENV.NEXT_PUBLIC_SUPABASE_URL ??
  ""
).replace(/\/$/, "");
const ANON_KEY =
  process.env.EMAIL_SMOKE_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  LOCAL_ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";
const SERVICE_KEY =
  process.env.EMAIL_SMOKE_SERVICE_ROLE_KEY ??
  process.env.E2E_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "";
const MAILTM_BASE = (process.env.MAILTM_BASE ?? "https://api.mail.tm").replace(/\/$/, "");
const MAILTM_DOMAIN = process.env.MAILTM_DOMAIN ?? "fldubai.com";
const POLL_ATTEMPTS = Number(process.env.EMAIL_SMOKE_POLL_ATTEMPTS ?? 32);
const POLL_INTERVAL_MS = Number(process.env.EMAIL_SMOKE_POLL_INTERVAL_MS ?? 5_000);

const checks = [];
let mailbox = null;
let testUser = null;
let failure = null;

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
  if (!SUPABASE_URL) {
    throw new Error(
      "Set EMAIL_SMOKE_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL for the email smoke test.",
    );
  }
  if (!ANON_KEY) {
    throw new Error(
      "Set EMAIL_SMOKE_SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY for the email smoke test.",
    );
  }
  if (!SERVICE_KEY) {
    throw new Error(
      "Set EMAIL_SMOKE_SERVICE_ROLE_KEY, E2E_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY. It is used only to delete the disposable test user.",
    );
  }
  if (!Number.isInteger(POLL_ATTEMPTS) || POLL_ATTEMPTS < 1) {
    throw new Error("EMAIL_SMOKE_POLL_ATTEMPTS must be a positive integer.");
  }
  if (!Number.isFinite(POLL_INTERVAL_MS) || POLL_INTERVAL_MS < 100) {
    throw new Error("EMAIL_SMOKE_POLL_INTERVAL_MS must be at least 100.");
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelay(response, fallbackMs) {
  const header = response.headers.get("retry-after");
  const seconds = header ? Number(header) : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds * 1_000, 30_000)
    : fallbackMs;
}

async function requestJson(url, options, label, attempts = 1) {
  let lastStatus = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(30_000),
    });
    lastStatus = response.status;
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }

    if (response.ok) return body;

    if (response.status === 429 && attempt < attempts) {
      await sleep(retryDelay(response, 5_000));
      continue;
    }

    const code =
      body?.error_code ?? body?.code ?? body?.name ?? body?.error ?? "unknown";
    throw new Error(`${label} failed (${lastStatus}, ${String(code).slice(0, 60)})`);
  }

  throw new Error(`${label} failed (${lastStatus ?? "network"})`);
}

async function createMailbox() {
  const email = `gti-${Date.now()}-${randomBytes(3).toString("hex")}@${MAILTM_DOMAIN}`;
  const password = `Mail-${randomBytes(16).toString("hex")}`;

  const account = await requestJson(
    `${MAILTM_BASE}/accounts`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: email, password }),
    },
    "Creating the disposable mailbox",
  );

  const session = await requestJson(
    `${MAILTM_BASE}/token`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: email, password }),
    },
    "Opening the disposable mailbox",
  );

  if (!account?.id || !session?.token) {
    throw new Error("The disposable mailbox service did not return a usable account.");
  }

  mailbox = {
    id: account.id,
    token: session.token,
    email,
  };
  return mailbox;
}

async function signUp(email, password) {
  const body = await requestJson(
    `${SUPABASE_URL}/auth/v1/signup`,
    {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
        data: { verification_source: "email-delivery-smoke" },
        redirect_to: "https://get-to-it-wvpy.vercel.app/auth/callback",
      }),
    },
    "Supabase signup",
  );

  const record = Array.isArray(body) ? body[0] : body;
  const user = record?.user ?? record;
  if (!user?.id) {
    throw new Error("Supabase did not return a disposable user id.");
  }
  if (!record?.confirmation_sent_at && !user?.confirmation_sent_at) {
    throw new Error("Supabase did not report that a confirmation email was sent.");
  }

  testUser = { id: user.id, email, password };
  return testUser;
}

async function waitForMessage() {
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
    const listing = await requestJson(
      `${MAILTM_BASE}/messages`,
      { headers: { Authorization: `Bearer ${mailbox.token}` } },
      "Checking the disposable mailbox",
      3,
    );
    const messages = listing?.["hydra:member"] ?? (Array.isArray(listing) ? listing : []);
    const message = messages[0];
    if (message?.id) return message.id;
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error("The confirmation email did not arrive in the disposable mailbox.");
}

async function readMessage(messageId) {
  const message = await requestJson(
    `${MAILTM_BASE}/messages/${encodeURIComponent(messageId)}`,
    { headers: { Authorization: `Bearer ${mailbox.token}` } },
    "Reading the confirmation email",
    8,
  );

  const parts = [message?.text];
  if (Array.isArray(message?.html)) parts.push(...message.html);
  else if (typeof message?.html === "string") parts.push(message.html);
  return parts.filter((part) => typeof part === "string" && part.length > 0).join("\n");
}

function findConfirmationUrl(body) {
  const text = body.replace(/&amp;/g, "&");
  const urls = text.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  return urls.find((url) => url.includes("/auth/v1/verify")) ?? null;
}

async function confirmEmail(url) {
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: { accept: "text/html" },
    signal: AbortSignal.timeout(30_000),
  });
  if (![200, 302, 303, 307, 308].includes(response.status)) {
    throw new Error(`The confirmation link was rejected (${response.status}).`);
  }
}

async function signIn(user) {
  const body = await requestJson(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: user.email, password: user.password }),
    },
    "Signing in after confirmation",
  );

  if (!body?.access_token || !body?.user?.email_confirmed_at) {
    throw new Error("The disposable account could not sign in as confirmed.");
  }
}

async function cleanup() {
  if (testUser?.id) {
    const response = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(testUser.id)}`,
      {
        method: "DELETE",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (![200, 204, 404].includes(response.status)) {
      throw new Error(`Deleting the disposable auth user failed (${response.status}).`);
    }
  }

  if (mailbox?.id && mailbox?.token) {
    const response = await fetch(
      `${MAILTM_BASE}/accounts/${encodeURIComponent(mailbox.id)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${mailbox.token}` },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (![200, 204, 404].includes(response.status)) {
      throw new Error(`Deleting the disposable mailbox failed (${response.status}).`);
    }
  }
}

async function main() {
  requireConfiguration();

  const box = await createMailbox();
  checks.push({ name: "disposable mailbox created" });

  const user = await signUp(box.email, `User-${randomBytes(24).toString("base64url")}`);
  checks.push({ name: "production signup accepted" });

  const messageId = await waitForMessage();
  checks.push({ name: "confirmation email received" });

  const body = await readMessage(messageId);
  const confirmationUrl = findConfirmationUrl(body);
  if (!confirmationUrl) {
    throw new Error("The confirmation email did not contain a Supabase verification link.");
  }
  checks.push({ name: "confirmation link present" });

  await confirmEmail(confirmationUrl);
  checks.push({ name: "confirmation link accepted" });

  await signIn(user);
  checks.push({ name: "confirmed account signs in" });
}

try {
  await main();
} catch (error) {
  failure = error;
  console.error(`Email smoke test failed: ${error.message}`);
} finally {
  try {
    await cleanup();
    checks.push({ name: "disposable user and mailbox cleaned up" });
  } catch (error) {
    console.error(`Email smoke test cleanup failed: ${error.message}`);
    if (!failure) failure = new Error("Disposable test data cleanup failed.");
  }
}

console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
if (failure) process.exitCode = 1;
