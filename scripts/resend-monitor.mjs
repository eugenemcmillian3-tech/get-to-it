#!/usr/bin/env node
/**
 * Scheduled Resend delivery monitor.
 *
 * Reads recent Resend emails and opens one GitHub issue per email whose latest
 * delivery event needs attention. Re-running the monitor is safe because the
 * issue title contains the Resend email id and an existing issue is reused.
 *
 * Required environment:
 *   RESEND_API_KEY       Resend key with access to read email history.
 *   GITHUB_TOKEN         Token with issues:write; the workflow provides it.
 *   GITHUB_REPOSITORY    owner/repo, supplied by GitHub Actions.
 *
 * Local dry run:
 *   RESEND_MONITOR_DRY_RUN=1 RESEND_API_KEY=... node scripts/resend-monitor.mjs
 *
 * Recipient addresses and message bodies are never printed or written to an
 * issue.
 */

const RESEND_API_BASE = (process.env.RESEND_API_BASE ?? "https://api.resend.com").replace(/\/$/, "");
const GITHUB_API_BASE = (process.env.GITHUB_API_BASE ?? "https://api.github.com").replace(/\/$/, "");
const ALERT_STATUSES = new Map([
  ["bounced", "bounced"],
  ["complained", "complained"],
  ["failed", "failed"],
  ["suppressed", "suppressed"],
  ["delivery_delayed", "delivery delayed"],
]);
const DRY_RUN = process.env.RESEND_MONITOR_DRY_RUN === "1";
const RESEND_KEY = process.env.RESEND_API_KEY?.trim() ?? "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN?.trim() ?? "";
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY?.trim() ?? "";

function requireConfiguration() {
  if (!RESEND_KEY) {
    throw new Error("RESEND_API_KEY is not configured.");
  }
  if (!DRY_RUN && !GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN is not configured.");
  }
  if (!DRY_RUN && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(GITHUB_REPOSITORY)) {
    throw new Error("GITHUB_REPOSITORY is not configured.");
  }
}

async function requestJson(url, options, label) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}).`);
  }
  return body;
}

async function listRecentEmails() {
  const result = await requestJson(
    `${RESEND_API_BASE}/emails?limit=100`,
    {
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        Accept: "application/json",
      },
    },
    "Listing Resend emails",
  );
  return Array.isArray(result?.data) ? result.data : [];
}

function safeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value)
    ? value
    : "";
}

function alertFor(email) {
  const status = typeof email?.last_event === "string" ? email.last_event : "";
  if (!ALERT_STATUSES.has(status)) return null;

  const id = safeId(email?.id);
  if (!id) return null;

  return {
    id,
    status,
    label: ALERT_STATUSES.get(status),
    createdAt: typeof email?.created_at === "string" ? email.created_at : "unknown",
  };
}

async function github(path, options = {}) {
  return requestJson(
    `${GITHUB_API_BASE}${path}`,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "get-to-it-resend-monitor",
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    },
    `GitHub ${path}`,
  );
}

async function issueExists(alert) {
  const query = `repo:${GITHUB_REPOSITORY} is:issue in:title "Resend delivery alert: ${alert.id}"`;
  const result = await github(`/search/issues?q=${encodeURIComponent(query)}`);
  return Number(result?.total_count ?? 0) > 0;
}

async function createIssue(alert) {
  const title = `Resend delivery alert: ${alert.id}`;
  const body = [
    "Resend reported an email delivery event that needs attention.",
    "",
    `- Email ID: \`${alert.id}\``,
    `- Event: \`${alert.status}\` (${alert.label})`,
    `- Event time: ${alert.createdAt}`,
    "",
    "Open the email in Resend by its ID for the recipient and delivery details.",
    "This alert intentionally omits recipient addresses and message bodies.",
  ].join("\n");

  await github("/issues", {
    method: "POST",
    body: JSON.stringify({ title, body }),
  });
}

async function main() {
  requireConfiguration();

  const emails = await listRecentEmails();
  const alerts = emails.map(alertFor).filter(Boolean);

  if (DRY_RUN) {
    const counts = {};
    for (const alert of alerts) {
      counts[alert.status] = (counts[alert.status] ?? 0) + 1;
    }
    console.log(
      JSON.stringify(
        { dryRun: true, scanned: emails.length, alerts: alerts.length, statuses: counts },
        null,
        2,
      ),
    );
    return;
  }

  let created = 0;
  let existing = 0;

  for (const alert of alerts) {
    if (await issueExists(alert)) {
      existing += 1;
      continue;
    }
    await createIssue(alert);
    created += 1;
  }

  console.log(
    JSON.stringify(
      { scanned: emails.length, alerts: alerts.length, created, existing },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(`Resend monitor failed: ${error.message}`);
  process.exitCode = 1;
});
