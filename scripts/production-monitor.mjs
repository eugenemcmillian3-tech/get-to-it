#!/usr/bin/env node
/**
 * Synthetic production monitor.
 *
 * Checks the public pages, the health endpoint and the unauthenticated
 * boundaries of critical APIs. A failure opens or updates one GitHub issue;
 * recovery closes it. This is HTTP/health monitoring, not exception tracing.
 *
 * Environment:
 *   MONITOR_BASE_URL       defaults to the production Vercel origin
 *   GITHUB_TOKEN           token with issues:write, supplied by Actions
 *   GITHUB_REPOSITORY      owner/repo, supplied by Actions
 *   GITHUB_API_URL         defaults to https://api.github.com
 *   GITHUB_SERVER_URL,
 *   GITHUB_RUN_ID          optional, used to link the workflow run
 *   MONITOR_DRY_RUN=1      skip GitHub issue writes for local testing
 */

const DEFAULT_BASE_URL = "https://get-to-it-wvpy.vercel.app";
const ALERT_TITLE = "Production monitor: failing";
const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT = "get-to-it-production-monitor/1.0";

const baseUrl = (process.env.MONITOR_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
const githubToken = process.env.GITHUB_TOKEN?.trim() ?? "";
const githubRepository = process.env.GITHUB_REPOSITORY?.trim() ?? "";
const githubApiUrl = (process.env.GITHUB_API_URL?.trim() || "https://api.github.com").replace(
  /\/+$/,
  "",
);
const dryRun = process.env.MONITOR_DRY_RUN === "1";

const checks = [
  {
    name: "home",
    path: "/",
    statuses: [200],
    contentType: "text/html",
    textIncludes: "GET TO IT",
  },
  {
    name: "sign-in",
    path: "/sign-in",
    statuses: [200],
    contentType: "text/html",
    textIncludes: "sign in",
  },
  {
    name: "health",
    path: "/api/health",
    statuses: [200],
    contentType: "application/json",
    validate(body) {
      if (body?.status !== "ok") throw new Error("health status is not ok");
      if (body?.checks?.database !== "ok") throw new Error("database check is not ok");
      if (body?.checks?.configuration !== "configured") {
        throw new Error("configuration is not configured");
      }
      if (typeof body?.revision !== "string" || body.revision === "unknown") {
        throw new Error("health revision is missing");
      }
    },
  },
  {
    name: "developer API",
    path: "/api/v1",
    statuses: [200],
    contentType: "application/json",
    validate(body) {
      const payload = body?.data ?? body;
      if (payload?.api !== "GET TO IT developer API") {
        throw new Error("developer API contract is missing");
      }
      if (typeof payload?.version !== "string") {
        throw new Error("developer API version is missing");
      }
    },
  },
  {
    name: "projects API boundary",
    path: "/api/v1/projects",
    statuses: [405],
  },
  {
    name: "MCP boundary",
    path: "/api/mcp",
    statuses: [405],
  },
  {
    name: "reminders boundary",
    path: "/api/reminders/run",
    statuses: [401],
  },
  {
    name: "Stripe webhook boundary",
    path: "/api/stripe/webhook",
    statuses: [405],
  },
];

function runUrl() {
  const server = process.env.GITHUB_SERVER_URL?.trim();
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  const runId = process.env.GITHUB_RUN_ID?.trim();
  return server && repository && runId
    ? `${server}/${repository}/actions/runs/${runId}`
    : "";
}

async function checkOne(check) {
  const response = await fetch(new URL(check.path, `${baseUrl}/`), {
    headers: { "user-agent": USER_AGENT },
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();

  if (!check.statuses.includes(response.status)) {
    throw new Error(`HTTP ${response.status}; expected ${check.statuses.join(" or ")}`);
  }
  if (check.contentType && !contentType.startsWith(check.contentType)) {
    throw new Error(`content-type ${contentType || "(missing)"}; expected ${check.contentType}`);
  }
  if (check.textIncludes && !text.toLowerCase().includes(check.textIncludes.toLowerCase())) {
    throw new Error(`response does not contain ${JSON.stringify(check.textIncludes)}`);
  }
  if (check.validate) {
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error("response is not valid JSON");
    }
    check.validate(body);
  }

  return { name: check.name, path: check.path, status: response.status };
}

function issueCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .slice(0, 300);
}

function issueBody(failures) {
  const lines = [
    "## Production monitor failure",
    "",
    `- Base URL: ${baseUrl}`,
    `- Checked: ${new Date().toISOString()}`,
  ];
  const run = runUrl();
  if (run) lines.push(`- Workflow run: ${run}`);
  lines.push(
    "",
    "| Check | Path | Error |",
    "| --- | --- | --- |",
    ...failures.map(
      (failure) =>
        `| ${issueCell(failure.name)} | ${issueCell(failure.path)} | ${issueCell(failure.error)} |`,
    ),
  );
  return lines.join("\n");
}

async function github(path, init = {}) {
  if (!githubToken || !githubRepository) {
    throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY are required for alerting.");
  }

  const response = await fetch(`${githubApiUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${githubToken}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": USER_AGENT,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `GitHub API ${init.method ?? "GET"} ${path} failed with HTTP ${response.status}: ${text.slice(0, 300)}`,
    );
  }
  return text ? JSON.parse(text) : null;
}

async function openAlerts() {
  const issues = await github(
    `/repos/${githubRepository}/issues?state=open&per_page=100`,
  );
  return (Array.isArray(issues) ? issues : []).filter(
    (issue) => !issue.pull_request && issue.title === ALERT_TITLE,
  );
}

async function publishFailure(failures) {
  if (dryRun) {
    console.log("MONITOR_DRY_RUN=1: would open or update the production monitor issue.");
    return;
  }

  const existing = await openAlerts();
  const body = issueBody(failures);
  if (existing[0]) {
    await github(`/repos/${githubRepository}/issues/${existing[0].number}`, {
      method: "PATCH",
      body: JSON.stringify({ body }),
    });
    console.log(`Updated production monitor issue #${existing[0].number}.`);
    return;
  }

  const created = await github(`/repos/${githubRepository}/issues`, {
    method: "POST",
    body: JSON.stringify({ title: ALERT_TITLE, body }),
  });
  console.log(`Opened production monitor issue #${created.number}.`);
}

async function closeRecovered() {
  if (dryRun) {
    console.log("MONITOR_DRY_RUN=1: would close recovered production monitor issues.");
    return;
  }

  const existing = await openAlerts();
  for (const issue of existing) {
    await github(`/repos/${githubRepository}/issues/${issue.number}/comments`, {
      method: "POST",
      body: JSON.stringify({
        body: `Recovered at ${new Date().toISOString()}; all production monitor checks passed.`,
      }),
    });
    await github(`/repos/${githubRepository}/issues/${issue.number}`, {
      method: "PATCH",
      body: JSON.stringify({ state: "closed" }),
    });
    console.log(`Closed recovered production monitor issue #${issue.number}.`);
  }
}

async function main() {
  console.log(`Checking ${baseUrl} at ${new Date().toISOString()}...`);
  const results = await Promise.all(
    checks.map(async (check) => {
      try {
        return { ...(await checkOne(check)), ok: true };
      } catch (error) {
        return {
          name: check.name,
          path: check.path,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  for (const result of results) {
    console.log(
      result.ok
        ? `ok   ${result.name}: HTTP ${result.status}`
        : `FAIL ${result.name}: ${result.error}`,
    );
  }

  const failures = results.filter((result) => !result.ok);
  if (failures.length) {
    await publishFailure(failures);
    process.exitCode = 1;
    return;
  }

  await closeRecovered();
  console.log(`All ${results.length} production checks passed.`);
}

main().catch((error) => {
  console.error(`Production monitor failed to run: ${error.message}`);
  process.exitCode = 1;
});
