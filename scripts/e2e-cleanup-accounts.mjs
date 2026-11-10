#!/usr/bin/env node
/**
 * Removes disposable E2E accounts that a killed run never got to delete, and
 * reports what it removed somewhere a person will see it.
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
 * When it removes anything it also writes a step summary and opens (or updates)
 * one GitHub issue, following the same pattern as the production monitors, so
 * a killed run becomes visible without anyone reading a CI log.
 *
 * Environment:
 *   NEXT_PUBLIC_SUPABASE_URL   Supabase project URL
 *   E2E_SERVICE_ROLE_KEY       service-role key (SUPABASE_SERVICE_ROLE_KEY also accepted)
 *   E2E_CLEANUP_DRY_RUN=1      report what would go, delete nothing, file nothing
 *   GITHUB_TOKEN               optional; workflow token used to file the issue
 *   GITHUB_REPOSITORY          optional; owner/repo for the issue
 *   GITHUB_STEP_SUMMARY        optional; set by Actions
 *   GITHUB_API_BASE            optional; override for tests
 */

import { appendFileSync } from "node:fs";

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
const SERVICE_KEY =
  process.env.E2E_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const DRY_RUN = process.env.E2E_CLEANUP_DRY_RUN === "1";

const TEST_ADDRESS_SUFFIX = "@get-to-it.test";
const MIN_AGE_MINUTES = 60;
const PAGE_SIZE = 200;
const MAX_PAGES = 20;

const ISSUE_TITLE = "E2E cleanup: stale disposable accounts were removed";
const GITHUB_API_BASE = (process.env.GITHUB_API_BASE ?? "https://api.github.com").replace(/\/$/, "");

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

async function github(path, options = {}) {
  const token = process.env.GITHUB_TOKEN ?? "";
  if (!token) throw new Error("GITHUB_TOKEN is not set.");
  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
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

/**
 * What was removed, in plain words. Only test addresses appear here, and they
 * are the point of the report, so they are safe to publish in the repo.
 */
function reportLines(summary) {
  const list = summary.removed.map((email) => `- \`${email}\``).join("\n");
  return [
    `Swept **${summary.deleted}** disposable test account(s) that an earlier **E2E run left behind**.`,
    "",
    "Those suites delete their own accounts, so a leftover means the run was cancelled, timed out, or killed before its cleanup could execute.",
    "",
    list,
    "",
    `Only addresses ending in \`${TEST_ADDRESS_SUFFIX}\` and older than ${summary.min_age_minutes} minutes are swept, so accounts from a run in progress are never touched. No real account can match this rule.`,
  ].join("\n");
}

function writeStepSummary(summary) {
  const path = process.env.GITHUB_STEP_SUMMARY ?? "";
  if (!path) return;
  try {
    appendFileSync(path, `## Stale E2E accounts swept\n\n${reportLines(summary)}\n\n`);
  } catch (error) {
    console.error(`Could not write the step summary: ${error.message}`);
  }
}

async function reportToIssue(summary) {
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  if (!process.env.GITHUB_TOKEN || !repo) {
    console.log("No GITHUB_TOKEN/GITHUB_REPOSITORY, so no issue was filed.");
    return;
  }

  const body = reportLines(summary);
  const open = await github(`/repos/${repo}/issues?state=open&per_page=100`);
  const existing = Array.isArray(open)
    ? open.find((issue) => issue?.title === ISSUE_TITLE && !issue?.pull_request)
    : undefined;

  if (existing) {
    await github(`/repos/${repo}/issues/${existing.number}`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    });
    console.log(`Updated open issue #${existing.number}`);
    return;
  }

  const created = await github(`/repos/${repo}/issues`, {
    method: "POST",
    body: JSON.stringify({ title: ISSUE_TITLE, body }),
  });
  console.log(`Opened issue ${created?.html_url ?? created?.number ?? ""}`);
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

  if (summary.deleted > 0 && !DRY_RUN) {
    writeStepSummary(summary);
    try {
      await reportToIssue(summary);
    } catch (error) {
      // Reporting is a courtesy. Losing it must not hide the sweep's own error,
      // and must not fail a run whose accounts were already removed.
      console.error(`Could not file the sweep report: ${error.message}`);
    }
  }

  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Stale E2E account sweep failed: ${error.message}`);
  process.exitCode = 1;
});
