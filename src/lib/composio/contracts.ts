import { createHash, timingSafeEqual } from "node:crypto";
import { TEAM_ROLES, type TeamRole } from "@/lib/agent-team";

/**
 * Composio integration contracts.
 *
 * Everything in this module is deterministic and server-safe. It encodes the
 * allow-lists and limits used by both the adapter and the UI, so there is one
 * source of truth for what may be connected and executed.
 *
 * SDK generation: @composio/core 0.28.0 (the `composio-core` package is the
 * deprecated v1 SDK and is deliberately not used).
 */

export const COMPOSIO_SDK_PACKAGE = "@composio/core";
export const COMPOSIO_SDK_VERSION = "0.28.0";
export const COMPOSIO_MIN_NODE = "22.22.3";

export const COMPOSIO_TOOLKITS = [
  {
    slug: "github",
    label: "GitHub",
    category: "Developer tools",
    auth: "OAuth",
    description: "Read repositories, issues, and pull requests, and create issues as the connected GitHub account.",
  },
  {
    slug: "notion",
    label: "Notion",
    category: "Productivity",
    auth: "OAuth or API key",
    description: "Search pages and create pages in the Notion workspace the account shared.",
  },
  {
    slug: "slack",
    label: "Slack",
    category: "Communication",
    auth: "OAuth",
    description: "Read channels and send messages in the connected Slack workspace.",
  },
  {
    slug: "gmail",
    label: "Gmail",
    category: "Communication",
    auth: "OAuth",
    description: "Read and search mail, and prepare or send email as the connected Google account.",
  },
  {
    slug: "googlecalendar",
    label: "Google Calendar",
    category: "Scheduling",
    auth: "OAuth",
    description: "List calendars and events, and create or update events.",
  },
  {
    slug: "googledrive",
    label: "Google Drive",
    category: "Files",
    auth: "OAuth",
    description: "Search, read, upload, and organize files in Google Drive.",
  },
  {
    slug: "googledocs",
    label: "Google Docs",
    category: "Documents",
    auth: "OAuth",
    description: "Read and create Google Docs and collaborate on documents.",
  },
  {
    slug: "googlesheets",
    label: "Google Sheets",
    category: "Data",
    auth: "OAuth",
    description: "Read and update spreadsheets and append rows.",
  },
  {
    slug: "googletasks",
    label: "Google Tasks",
    category: "Productivity",
    auth: "OAuth",
    description: "List and manage tasks and task lists.",
  },
  {
    slug: "googlemeet",
    label: "Google Meet",
    category: "Communication",
    auth: "OAuth",
    description: "Create meetings and read meeting details available to the connected account.",
  },
  {
    slug: "googleslides",
    label: "Google Slides",
    category: "Documents",
    auth: "OAuth",
    description: "Create and update presentations from markdown or templates.",
  },
  {
    slug: "linear",
    label: "Linear",
    category: "Project management",
    auth: "OAuth or API key",
    description: "Read and create issues, projects, and comments in Linear.",
  },
  {
    slug: "jira",
    label: "Jira",
    category: "Project management",
    auth: "OAuth or API key",
    description: "Read and create Jira issues and update project work.",
  },
  {
    slug: "asana",
    label: "Asana",
    category: "Project management",
    auth: "OAuth",
    description: "Read projects and tasks, and create or update work in Asana.",
  },
  {
    slug: "trello",
    label: "Trello",
    category: "Project management",
    auth: "OAuth",
    description: "Read boards and lists, and create or move cards in Trello.",
  },
  {
    slug: "clickup",
    label: "ClickUp",
    category: "Project management",
    auth: "OAuth or API key",
    description: "Read and create tasks, comments, and goals in ClickUp.",
  },
  {
    slug: "airtable",
    label: "Airtable",
    category: "Data",
    auth: "OAuth or API key",
    description: "Read and write records in Airtable bases the account can access.",
  },
  {
    slug: "hubspot",
    label: "HubSpot",
    category: "CRM",
    auth: "OAuth or API key",
    description: "Read and update contacts, companies, deals, and tickets in HubSpot.",
  },
  {
    slug: "salesforce",
    label: "Salesforce",
    category: "CRM",
    auth: "OAuth",
    description: "Read and create Salesforce records such as leads, contacts, and opportunities.",
  },
  {
    slug: "zendesk",
    label: "Zendesk",
    category: "Support",
    auth: "OAuth",
    description: "Read and update tickets, users, and support conversations in Zendesk.",
  },
  {
    slug: "intercom",
    label: "Intercom",
    category: "Support",
    auth: "OAuth",
    description: "Read and reply to customer conversations and manage contacts in Intercom.",
  },
  {
    slug: "gorgias",
    label: "Gorgias",
    category: "Support",
    auth: "OAuth or API key",
    description: "Read and create support tickets and manage customer conversations.",
  },
  {
    slug: "discord",
    label: "Discord",
    category: "Communication",
    auth: "OAuth",
    description: "Read channels and send messages in a connected Discord server.",
  },
  {
    slug: "microsoft_teams",
    label: "Microsoft Teams",
    category: "Communication",
    auth: "OAuth",
    description: "Read teams and chats, and send messages in Microsoft Teams.",
  },
  {
    slug: "dropbox",
    label: "Dropbox",
    category: "Files",
    auth: "OAuth",
    description: "Search, read, upload, and organize files in Dropbox.",
  },
  {
    slug: "box",
    label: "Box",
    category: "Files",
    auth: "OAuth",
    description: "Search, read, upload, and organize files in Box.",
  },
  {
    slug: "todoist",
    label: "Todoist",
    category: "Productivity",
    auth: "OAuth",
    description: "Read and manage projects, tasks, and comments in Todoist.",
  },
  {
    slug: "onenote",
    label: "Microsoft OneNote",
    category: "Productivity",
    auth: "OAuth",
    description: "Read and create notes and notebooks in Microsoft OneNote.",
  },
  {
    slug: "stripe",
    label: "Stripe",
    category: "Commerce",
    auth: "OAuth or API key",
    description: "Read customers, payments, invoices, and subscriptions in the connected Stripe account.",
  },
  {
    slug: "mailchimp",
    label: "Mailchimp",
    category: "Marketing",
    auth: "OAuth",
    description: "Read audiences and campaigns, and manage subscribers in Mailchimp.",
  },
  {
    slug: "calendly",
    label: "Calendly",
    category: "Scheduling",
    auth: "OAuth",
    description: "Read event types and scheduled events, and create scheduling links.",
  },
  {
    slug: "figma",
    label: "Figma",
    category: "Design",
    auth: "OAuth or API key",
    description: "Read files, comments, and design metadata, and create comments in Figma.",
  },
  {
    slug: "gitlab",
    label: "GitLab",
    category: "Developer tools",
    auth: "OAuth or API key",
    description: "Read projects and merge requests, and create issues in GitLab.",
  },
  {
    slug: "confluence",
    label: "Confluence",
    category: "Documents",
    auth: "OAuth or API key",
    description: "Search and read Confluence pages, and create or update content.",
  },
  {
    slug: "quickbooks",
    label: "QuickBooks",
    category: "Finance",
    auth: "OAuth",
    description: "Read and create invoices, bills, customers, and reports in QuickBooks.",
  },
  {
    slug: "linkedin",
    label: "LinkedIn",
    category: "Marketing",
    auth: "OAuth",
    description: "Read profile and organization data available to the connection.",
  },
  {
    slug: "youtube",
    label: "YouTube",
    category: "Marketing",
    auth: "OAuth",
    description: "Read channel and video data and manage playlists the account can access.",
  },
  {
    slug: "google_analytics",
    label: "Google Analytics",
    category: "Analytics",
    auth: "OAuth",
    description: "Read analytics reports and property data for connected Google Analytics accounts.",
  },
  {
    slug: "google_search_console",
    label: "Google Search Console",
    category: "Analytics",
    auth: "OAuth",
    description: "Read search performance and inspect or submit sitemaps for verified sites.",
  },
  {
    slug: "googleads",
    label: "Google Ads",
    category: "Marketing",
    auth: "OAuth",
    description: "Read campaigns and performance, and prepare changes in Google Ads.",
  },
  {
    slug: "googlebigquery",
    label: "Google BigQuery",
    category: "Data",
    auth: "OAuth",
    description: "Run queries and inspect datasets and projects in Google BigQuery.",
  },
  {
    slug: "zoho_invoice",
    label: "Zoho Invoice",
    category: "Finance",
    auth: "OAuth",
    description: "Read and create invoices, customers, and payments in Zoho Invoice.",
  },
  {
    slug: "ynab",
    label: "YNAB",
    category: "Finance",
    auth: "OAuth",
    description: "Read budgets, accounts, and transactions, and update transactions in YNAB.",
  },
  {
    slug: "shippo",
    label: "Shippo",
    category: "Commerce",
    auth: "OAuth or API key",
    description: "Read shipments and rates, and create labels and tracking in Shippo.",
  },
  {
    slug: "dub",
    label: "Dub",
    category: "Marketing",
    auth: "OAuth or API key",
    description: "Create and inspect short links and conversion tracking in Dub.",
  },
] as const;

export type ComposioToolkitAuth = (typeof COMPOSIO_TOOLKITS)[number]["auth"];

export type ComposioToolkit = (typeof COMPOSIO_TOOLKITS)[number]["slug"];

export const COMPOSIO_TOOLKIT_SLUGS: readonly string[] = COMPOSIO_TOOLKITS.map(
  (toolkit) => toolkit.slug,
);

export function isComposioToolkit(value: string): value is ComposioToolkit {
  return COMPOSIO_TOOLKIT_SLUGS.includes(value);
}

/**
 * The OAuth scopes this build will ever ask for, per toolkit.
 *
 * Composio's managed app for a toolkit requests whatever that toolkit
 * advertises, and GitHub's default set includes `workflow`, `codespace`,
 * `project`, `gist`, `notifications` and `user` — far more than creating an
 * issue needs, and `workflow` covers exactly what the connector refuses to do.
 * A connect flow that names an auth config outside this list is refused, so a
 * normal connection cannot quietly acquire those permissions.
 *
 * Adding a toolkit here is an explicit decision, not a default.
 */
export const COMPOSIO_TOOLKIT_SCOPES: Readonly<Record<string, readonly string[]>> = {
  github: ["repo"],
};

/** Scopes this build never asks any connector for. */
export const COMPOSIO_DISALLOWED_SCOPES = [
  "workflow",
  "codespace",
  "project",
  "gist",
  "notifications",
  "user",
  "delete_repo",
  "admin:org",
] as const;

export function composioRequiredScopes(toolkit: string): readonly string[] | null {
  return COMPOSIO_TOOLKIT_SCOPES[toolkit] ?? null;
}

/** Provider scope fields arrive as a comma-separated string or an array. */
export function normalizeComposioScopes(value: unknown): readonly string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const cleaned = raw
    .filter((scope): scope is string => typeof scope === "string")
    .map((scope) => scope.trim().toLowerCase())
    .filter((scope) => scope.length > 0);
  return [...new Set(cleaned)].sort();
}

/**
 * Null when a requested scope set is exactly what this build allows for the
 * toolkit, otherwise a short reason a person can act on.
 */
export function composioScopeProblem(
  toolkit: string,
  scopes: unknown,
): string | null {
  const required = composioRequiredScopes(toolkit);
  if (!required) return null;

  const asked = normalizeComposioScopes(scopes);
  const missing = required.filter((scope) => !asked.includes(scope));
  if (missing.length > 0) {
    return `does not request ${missing.join(", ")}`;
  }
  const extra = asked.filter((scope) => !required.includes(scope));
  if (extra.length > 0) {
    return `also requests ${extra.join(", ")}`;
  }
  return null;
}

export function composioToolkit(slug: string) {
  return COMPOSIO_TOOLKITS.find((toolkit) => toolkit.slug === slug) ?? null;
}

export const COMPOSIO_LIMITS = {
  maxEnabledGrantsPerConnection: 5,
  maxDiscoveredTools: 50,
  maxArgumentsBytes: 16_384,
  maxStoredResultBytes: 32_768,
  maxCallsPerDay: 100,
  maxWritesPerDay: 25,
  maxPendingProposals: 20,
  maxProposalsPerDay: 50,
  maxAttemptsPerHour: 10,
  authAttemptMinutes: 15,
  executionTimeoutMs: 35_000,
  maxReturnedString: 2_000,
  maxReturnedArray: 20,
} as const;

export const COMPOSIO_ACTION_STATUSES = [
  "proposed",
  "approved",
  "executing",
  "succeeded",
  "failed",
  "uncertain",
  "cancelled",
] as const;

export type ComposioActionStatus = (typeof COMPOSIO_ACTION_STATUSES)[number];

export type ComposioConnectionStatus = "active" | "expired" | "revoked" | "removed";

export type ComposioConnection = {
  id: string;
  project_id: string;
  toolkit: ComposioToolkit;
  account_label: string;
  status: ComposioConnectionStatus;
  last_verified_at: string | null;
  connected_at: string;
};

export type ComposioTool = {
  id: string;
  connection_id: string;
  toolkit: ComposioToolkit;
  tool_slug: string;
  name: string;
  description: string;
};

export type ComposioGrant = {
  id: string;
  connection_id: string;
  tool_slug: string;
  role: TeamRole;
  enabled: boolean;
};

export type ComposioAction = {
  id: string;
  project_id: string;
  connection_id: string;
  tool_slug: string;
  tool_name: string;
  role: TeamRole;
  task_id: string | null;
  arguments: Record<string, unknown>;
  arguments_hash: string;
  preview: string;
  status: ComposioActionStatus;
  approval_hash: string | null;
  approved_at: string | null;
  result: unknown;
  provider_ref: string | null;
  error_code: string | null;
  error_message: string | null;
  attempts: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export function isTeamRole(value: string): value is TeamRole {
  return (TEAM_ROLES as readonly string[]).includes(value);
}

/** Derives the Composio user identity from the authenticated app user only. */
export function composioUserId(appUserId: string): string {
  return `gettoit_${appUserId.replace(/-/g, "")}`;
}

export function toolSlugPrefix(toolkit: ComposioToolkit): string {
  return `${toolkit.toUpperCase()}_`;
}

/**
 * Tool slugs come from the provider, but we still refuse anything that is not
 * a well-formed uppercase slug for the connected toolkit.
 */
export function isValidToolSlug(toolkit: ComposioToolkit, slug: string): boolean {
  const prefix = toolSlugPrefix(toolkit);
  if (!/^[A-Z][A-Z0-9_]{2,80}$/.test(slug) || !slug.startsWith(prefix)) return false;
  const suffix = slug.slice(prefix.length);
  return suffix.length >= 2 && /^[A-Z0-9]/.test(suffix) && /[A-Z0-9]$/.test(suffix);
}

export function isValidConnectedAccountId(value: string): boolean {
  return /^ca_[A-Za-z0-9_-]{3,80}$/.test(value);
}

export type ParsedArguments =
  | { ok: true; value: Record<string, unknown>; text: string }
  | { ok: false; message: string };

/**
 * Normalizes a JSON object supplied as text, rejecting arrays, primitives,
 * oversized payloads and prototype-shaped keys. This is the only way argument
 * text becomes an action proposal.
 */
export function parseActionArguments(raw: string): ParsedArguments {
  const text = raw.trim();
  if (text === "") return { ok: false, message: "Enter the tool arguments as a JSON object." };
  if (Buffer.byteLength(text, "utf8") > COMPOSIO_LIMITS.maxArgumentsBytes) {
    return { ok: false, message: "Tool arguments are limited to 16 KB." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: "The arguments are not valid JSON." };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, message: "Tool arguments must be a JSON object." };
  }

  const value = parsed as Record<string, unknown>;
  if (Object.keys(value).some((key) => key === "__proto__" || key === "constructor" || key === "prototype")) {
    return { ok: false, message: "That argument name is not allowed." };
  }

  return { ok: true, value, text };
}

/** Stable SHA-256 of the same JSON text Postgres stores and hashes. */
export function actionArgumentsHash(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function stateHash(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

/** Constant-time comparison for the one-time authorization state. */
export function stateMatchesHash(state: string, expectedHash: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  const actual = Buffer.from(stateHash(state), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const REDACTED_KEY =
  /(token|secret|password|authorization|cookie|api[_-]?key|private[_-]?key|refresh|credential|session)/i;

export type RedactionResult = {
  value: unknown;
  redacted: boolean;
  truncated: boolean;
};

/**
 * Bounds and redacts provider output before it is shown or stored. Provider
 * responses can contain tokens or unrelated private content; only a small,
 * shape-preserving excerpt is kept.
 */
export function redactProviderResult(input: unknown): RedactionResult {
  let redacted = false;
  let truncated = false;

  function walk(value: unknown, depth: number): unknown {
    if (depth > 6) {
      truncated = true;
      return "[truncated]";
    }
    if (typeof value === "string") {
      if (value.length > COMPOSIO_LIMITS.maxReturnedString) {
        truncated = true;
        return `${value.slice(0, COMPOSIO_LIMITS.maxReturnedString)}…`;
      }
      return value;
    }
    if (typeof value === "number" || typeof value === "boolean" || value === null) {
      return value;
    }
    if (Array.isArray(value)) {
      if (value.length > COMPOSIO_LIMITS.maxReturnedArray) truncated = true;
      return value
        .slice(0, COMPOSIO_LIMITS.maxReturnedArray)
        .map((entry) => walk(entry, depth + 1));
    }
    if (typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (REDACTED_KEY.test(key)) {
          redacted = true;
          result[key] = "[redacted]";
        } else {
          result[key] = walk(entry, depth + 1);
        }
      }
      return result;
    }
    return null;
  }

  const value = walk(input, 0);
  let text: string;
  try {
    text = JSON.stringify(value) ?? "";
  } catch {
    return { value: "[unserializable]", redacted, truncated };
  }
  if (Buffer.byteLength(text, "utf8") > COMPOSIO_LIMITS.maxStoredResultBytes) {
    return { value: `${text.slice(0, 2_000)}…`, redacted, truncated: true };
  }
  return { value, redacted, truncated };
}

export type ProviderFailure =
  | "needs_input"
  | "auth"
  | "rate_limit"
  | "provider"
  | "timeout"
  | "network"
  | "unknown";

/** Maps an SDK/provider message to a small error category; never echoes it raw. */
export function providerErrorCategory(message: string | null | undefined): ProviderFailure {
  const text = (message ?? "").toLowerCase();
  if (text.includes("input required") || text.includes("needs approval") || text.includes("requires input")) {
    return "needs_input";
  }
  if (text.includes("unauthor") || text.includes("forbidden") || text.includes("401") || text.includes("403")) {
    return "auth";
  }
  if (text.includes("rate limit") || text.includes("429")) return "rate_limit";
  if (text.includes("timeout") || text.includes("timed out") || text.includes("abort")) return "timeout";
  if (text.includes("network") || text.includes("fetch failed") || text.includes("econn")) return "network";
  if (text.includes("error") || text.includes("failed")) return "provider";
  return "unknown";
}

/** Short, non-secret error text for storage and display. */
export function safeProviderMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  const stripped = message
    .replace(/\b(ca|sess|key|sk|pk)_[A-Za-z0-9_-]{6,}/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped === "") return null;
  return stripped.slice(0, 800);
}

export type NodeSupport =
  | { supported: true; version: string }
  | { supported: false; version: string; message: string };

/** The current SDK is ESM-only and declares Node >= 22.22.3. */
export function checkNodeSupport(version: string = process.versions.node): NodeSupport {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));
  const required = COMPOSIO_MIN_NODE.split(".").map((part) => Number.parseInt(part, 10));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  const supported =
    major > required[0] ||
    (major === required[0] && minor > required[1]) ||
    (major === required[0] && minor === required[1] && patch >= required[2]);

  if (supported) return { supported: true, version };
  return {
    supported: false,
    version,
    message: `Composio ${COMPOSIO_SDK_VERSION} requires Node ${COMPOSIO_MIN_NODE} or newer; this runtime reports ${version}.`,
  };
}

export type GrantCheck =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Pure authorization check shared by the adapter and tests. A grant is usable
 * only when it is enabled, matches the project role and the connected account.
 */
export function canUseGrant(input: {
  grant: Pick<ComposioGrant, "enabled" | "role" | "tool_slug"> | null;
  role: string;
  toolSlug: string;
  connectionActive: boolean;
}): GrantCheck {
  if (!input.connectionActive) {
    return { ok: false, message: "That connected account is not active." };
  }
  if (!input.grant || !input.grant.enabled) {
    return { ok: false, message: "That role is not allowed to request this tool." };
  }
  if (input.grant.role !== input.role) {
    return { ok: false, message: "That tool is granted to a different agent role." };
  }
  if (input.grant.tool_slug !== input.toolSlug) {
    return { ok: false, message: "That tool is not the granted tool." };
  }
  return { ok: true };
}

/**
 * Approval is valid only for the proposal it was recorded against and only
 * while the exact stored arguments still hash to the approved value.
 */
export function approvalCoversAction(input: {
  status: ComposioActionStatus;
  argumentsHash: string;
  approvalHash: string | null;
  approvedAt: string | null;
}): boolean {
  return (
    input.status === "approved" &&
    typeof input.approvalHash === "string" &&
    /^[a-f0-9]{64}$/.test(input.approvalHash) &&
    /^[a-f0-9]{64}$/.test(input.argumentsHash) &&
    input.approvedAt !== null
  );
}

/** Only a proposal that has not started may be cancelled from the UI. */
export function canCancelAction(status: ComposioActionStatus): boolean {
  return status === "proposed" || status === "approved";
}

/** A result that might have reached the provider is never retried automatically. */
export function completionForThrownError(error: unknown): {
  status: "failed" | "uncertain";
  code: ProviderFailure;
} {
  const message = error instanceof Error ? error.message : String(error);
  const category = providerErrorCategory(message);
  if (category === "timeout" || category === "network") {
    return { status: "uncertain", code: category };
  }
  return { status: "failed", code: category };
}

export const COMPOSIO_SETUP_MESSAGE =
  "Composio is not configured. Add a server-only COMPOSIO_API_KEY and APP_ORIGIN, then restart the app. No connection can be started without them.";

export const COMPOSIO_SECURITY_NOTE =
  "Connecting an account asks only for the scopes this build allows — GitHub is limited to repo, and an authorization that would ask for more is refused rather than granted — and it does not authorize any action. Every tool call is proposed with exact arguments and needs your approval for those exact arguments. Disconnecting can revoke the provider authorization or only remove it locally.";
