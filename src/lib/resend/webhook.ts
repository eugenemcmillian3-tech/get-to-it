import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Resend delivery webhook support.
 *
 * Resend signs deliveries with Svix headers. The signature covers the raw body,
 * the Svix message id and the timestamp, so verification must happen before the
 * body is parsed. The secret is the `whsec_...` value returned when the Resend
 * webhook is created.
 *
 * This module is deliberately dependency-free. It also keeps recipient
 * addresses, subjects and message bodies out of GitHub alerts.
 */

export const RESEND_WEBHOOK_TOLERANCE_SECONDS = 300;
export const RESEND_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

export const RESEND_ALERT_STATUSES = new Map<string, string>([
  ["email.bounced", "bounced"],
  ["email.complained", "complained"],
  ["email.failed", "failed"],
  ["email.suppressed", "suppressed"],
  ["email.delivery_delayed", "delivery delayed"],
]);

const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export type ResendEvent = {
  type: string;
  createdAt: string;
  data: { emailId: string };
};

export type ResendAlert = {
  id: string;
  event: string;
  label: string;
  createdAt: string;
};

export type GithubAlertConfig = {
  token: string;
  repo: string;
  apiBase: string;
};

export function getResendWebhookSecret(): string | null {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  return secret && secret.startsWith("whsec_") ? secret : null;
}

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

function decodeSecret(secret: string): Buffer | null {
  if (!secret.startsWith("whsec_")) return null;
  const encoded = secret.slice("whsec_".length);
  if (!encoded) return null;

  try {
    const key = Buffer.from(encoded, "base64");
    return key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

function parseSvixSignatures(header: string | null): string[] {
  if (!header) return [];
  const signatures: string[] = [];

  for (const part of header.split(/\s+/)) {
    if (!part.startsWith("v1,")) continue;
    const value = part.slice(3);
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(value)) signatures.push(value);
  }

  return signatures;
}

/**
 * Verifies the Svix signature format used by Resend:
 * `v1,<base64 HMAC-SHA256 of id.timestamp.rawBody>`.
 *
 * Multiple `v1,` values are accepted so a secret rotation can overlap. A
 * missing, malformed, stale or incorrectly signed delivery is rejected.
 */
export function verifyResendWebhook(input: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  toleranceSeconds?: number;
  nowMs?: number;
}): boolean {
  const key = decodeSecret(input.secret);
  const id = input.id?.trim() ?? "";
  if (!key || !SAFE_ID.test(id)) return false;

  const timestamp = Number(input.timestamp);
  if (!Number.isInteger(timestamp) || timestamp <= 0) return false;

  const tolerance = input.toleranceSeconds ?? RESEND_WEBHOOK_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - timestamp) > tolerance) return false;

  const signatures = parseSvixSignatures(input.signature);
  if (signatures.length === 0) return false;

  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${input.rawBody}`)
    .digest();

  return signatures.some((signature) => {
    const provided = Buffer.from(signature, "base64");
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  });
}

/**
 * Reads only the fields needed for alerting. Recipient addresses, subjects and
 * message content are intentionally not retained.
 */
export function parseResendEvent(raw: string): ResendEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  if (payload === null || typeof payload !== "object") return null;
  const record = payload as {
    type?: unknown;
    created_at?: unknown;
    data?: { email_id?: unknown };
  };

  if (typeof record.type !== "string" || record.type.length === 0) return null;
  if (record.type.length > 80) return null;
  if (!record.data || typeof record.data !== "object") return null;

  const emailId = record.data.email_id;
  if (typeof emailId !== "string" || !SAFE_ID.test(emailId)) return null;

  const createdAt =
    typeof record.created_at === "string" && SAFE_TIMESTAMP.test(record.created_at)
      ? record.created_at
      : "unknown";

  return {
    type: record.type,
    createdAt,
    data: { emailId },
  };
}

export function alertForResendEvent(event: ResendEvent): ResendAlert | null {
  const label = RESEND_ALERT_STATUSES.get(event.type);
  if (!label) return null;

  return {
    id: event.data.emailId,
    event: event.type,
    label,
    createdAt: event.createdAt,
  };
}

export function resendAlertBody(alert: ResendAlert): string {
  return [
    "Resend reported an email delivery event that needs attention.",
    "",
    `- Email ID: \`${alert.id}\``,
    `- Event: \`${alert.event}\` (${alert.label})`,
    `- Event time: ${alert.createdAt}`,
    "",
    "Open the email in Resend by its ID for the recipient and delivery details.",
    "This alert intentionally omits recipient addresses and message bodies.",
  ].join("\n");
}

async function github(
  config: GithubAlertConfig,
  path: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  const response = await fetch(`${config.apiBase}${path}`, {
    ...init,
    signal: AbortSignal.timeout(8_000),
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "get-to-it-resend-webhook",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  let body: Record<string, unknown> = {};
  if (text) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }

  if (!response.ok) {
    throw new Error(`GitHub ${path} failed (${response.status}).`);
  }

  return body;
}

/**
 * Creates one issue per Resend email id. The title is shared with the hourly
 * reconciliation script, so either path reuses the same existing issue.
 */
export async function publishResendAlert(
  alert: ResendAlert,
  config: GithubAlertConfig,
): Promise<"created" | "existing"> {
  const title = `Resend delivery alert: ${alert.id}`;
  const query = `repo:${config.repo} is:issue in:title "${title}"`;
  const existing = await github(config, `/search/issues?q=${encodeURIComponent(query)}`);

  if (Number(existing.total_count ?? 0) > 0) return "existing";

  await github(config, "/issues", {
    method: "POST",
    body: JSON.stringify({ title, body: resendAlertBody(alert) }),
  });

  return "created";
}
