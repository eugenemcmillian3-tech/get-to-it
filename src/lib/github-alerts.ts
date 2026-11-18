import { createHash } from "node:crypto";

/**
 * The GitHub-issue alert channel shared by the Resend and Stripe webhooks.
 *
 * Each thing that needs a person gets exactly one issue. Claiming is atomic on
 * GitHub through a label: label creation succeeds only once, while issue search
 * is eventually consistent and can miss an issue created a moment ago.
 *
 * Everything here is transport only. Callers decide the title, body and label
 * prefix, so no alert invents content it cannot justify.
 */

export type GithubAlertConfig = {
  token: string;
  repo: string;
  apiBase: string;
};

export class GithubAlertError extends Error {
  constructor(readonly status: number) {
    super(`GitHub request failed with status ${status}.`);
    this.name = "GithubAlertError";
  }
}

const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function getGithubAlertConfig(): GithubAlertConfig | null {
  const token = process.env.GITHUB_ALERT_TOKEN?.trim();
  const repo = process.env.GITHUB_ALERT_REPO?.trim();
  if (!token || !repo || !SAFE_REPOSITORY.test(repo)) return null;

  return {
    token,
    repo,
    apiBase: (process.env.GITHUB_API_BASE ?? "https://api.github.com").replace(/\/+$/, ""),
  };
}

/**
 * A deterministic, bounded label for one subject. GitHub caps labels at 50
 * characters, so the caller picks a prefix and a digest length that fit; the
 * digest keeps the subject itself out of the label.
 */
export function alertClaimLabel(prefix: string, value: string, length = 40): string {
  const digest = createHash("sha256").update(value, "utf8").digest("hex").slice(0, length);
  return `${prefix}${digest}`;
}

export type GithubAlert = {
  title: string;
  body: string;
  label: string;
  labelColor: string;
  labelDescription: string;
};

async function github<T = Record<string, unknown>>(
  config: GithubAlertConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${config.apiBase}${path}`, {
    ...init,
    signal: AbortSignal.timeout(8_000),
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "get-to-it-alerts",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = {};
    }
  }

  if (!response.ok) {
    throw new GithubAlertError(response.status);
  }

  return body as T;
}

async function claimAlertLabel(
  config: GithubAlertConfig,
  alert: GithubAlert,
): Promise<boolean> {
  try {
    await github(config, `/repos/${config.repo}/labels`, {
      method: "POST",
      body: JSON.stringify({
        name: alert.label,
        color: alert.labelColor,
        description: alert.labelDescription,
      }),
    });
    return true;
  } catch (error) {
    if (error instanceof GithubAlertError && error.status === 422) return false;
    throw error;
  }
}

async function releaseAlertLabel(
  config: GithubAlertConfig,
  label: string,
): Promise<void> {
  try {
    await github(config, `/repos/${config.repo}/labels/${encodeURIComponent(label)}`, {
      method: "DELETE",
    });
  } catch {
    // Best effort: a failed release leaves a claim without an issue. The caller
    // still reports the failure so the event is retried and the alert is not lost.
  }
}

type GithubIssue = {
  title?: unknown;
  pull_request?: unknown;
};

/**
 * GitHub search is eventually consistent. A newly created alert can be absent
 * from search for a short time, so check the recent issue list first. Search is
 * retained as a fallback for issues older than the first page.
 */
async function recentAlertIssueExists(
  config: GithubAlertConfig,
  title: string,
): Promise<boolean> {
  const issues = await github<unknown>(
    config,
    `/repos/${config.repo}/issues?state=all&sort=created&direction=desc&per_page=100`,
  );

  if (!Array.isArray(issues)) return false;

  return issues.some((issue) => {
    if (issue === null || typeof issue !== "object") return false;
    const record = issue as GithubIssue;
    return !("pull_request" in record) && record.title === title;
  });
}

/**
 * Creates one issue per alert subject. A repeated alert — a redelivered webhook,
 * or the same refund reported twice — returns "existing" instead of a second
 * issue, provided the caller derives the title and label from the subject.
 */
export async function publishGithubAlert(
  config: GithubAlertConfig,
  alert: GithubAlert,
): Promise<"created" | "existing"> {
  if (await recentAlertIssueExists(config, alert.title)) return "existing";

  const query = `repo:${config.repo} is:issue in:title "${alert.title}"`;
  const existing = await github<{ total_count?: unknown }>(
    config,
    `/search/issues?q=${encodeURIComponent(query)}`,
  );

  if (Number(existing.total_count ?? 0) > 0) return "existing";

  if (!(await claimAlertLabel(config, alert))) return "existing";

  try {
    await github(config, `/repos/${config.repo}/issues`, {
      method: "POST",
      body: JSON.stringify({
        title: alert.title,
        body: alert.body,
        labels: [alert.label],
      }),
    });
    return "created";
  } catch (error) {
    await releaseAlertLabel(config, alert.label);
    throw error;
  }
}
