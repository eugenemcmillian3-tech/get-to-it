import { createHash } from "node:crypto";

/**
 * Slack milestone summaries.
 *
 * The same shape as the GitHub handoff: one record, one destination, one
 * previewed message, one approval bound to a fingerprint of exactly what will be
 * posted. The scopes this needs are the three the connect flow asks for —
 * `channels:read`, `groups:read` and `chat:write` — so nothing here lists users,
 * reads history, uploads files, pins, reacts, calls or opens a DM.
 */

export const SLACK_SEND_TOOL = "SLACK_SEND_MESSAGE";
export const SLACK_LIST_TOOL = "SLACK_LIST_ALL_CHANNELS";

/** Actions this connector will never perform, whatever a caller asks for. */
export const SLACK_EXCLUDED_ACTIONS = [
  "set_channel_topic",
  "set_channel_purpose",
  "archive_channel",
  "invite_user",
  "remove_user",
  "upload_file",
  "pin_message",
  "add_reaction",
  "start_call",
  "delete_message",
  "open_dm",
  "schedule_message",
] as const;

export type SlackExcludedAction = (typeof SLACK_EXCLUDED_ACTIONS)[number];

export const SLACK_LIMITS = {
  minText: 10,
  maxText: 3000,
  executionTimeoutMs: 30_000,
  channelListLimit: 200,
} as const;

export const SLACK_RECORD_KINDS = ["mission", "experiment", "outcome_review"] as const;

export type SlackRecordKind = (typeof SLACK_RECORD_KINDS)[number];

export const SLACK_RECORD_KIND_LABELS: Record<SlackRecordKind, string> = {
  mission: "Mission",
  experiment: "Experiment",
  outcome_review: "Outcome review",
};

export const SLACK_STATUSES = [
  "draft",
  "approved",
  "sending",
  "sent",
  "failed",
  "cancelled",
] as const;

export type SlackStatus = (typeof SLACK_STATUSES)[number];

export const SLACK_STATUS_LABELS: Record<SlackStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  sending: "Sending",
  sent: "Posted",
  failed: "Failed — not posted",
  cancelled: "Cancelled",
};

export const SLACK_NOTES = {
  approval:
    "Approval is bound to a fingerprint of the exact channel and message text. Change either and the old approval no longer covers what would be posted.",
  duplicates:
    "The same record cannot post the same message twice: the fingerprint is unique per record, so a second identical request is refused.",
  channel:
    "The channel is resolved through your own connection before a draft is saved, so a mistyped channel is refused rather than silently sent somewhere else.",
  exclusions:
    "This connector posts one message and nothing else. It cannot change a topic or purpose, archive a channel, invite or remove people, upload files, pin, react, start calls or delete messages.",
  transport:
    "The message is posted through your own Slack connection. Without a connected account and a granted send-message tool, nothing is posted and the request says so.",
  scopes:
    "The connection is limited to channels:read, groups:read and chat:write: enough to list the channels you may choose and post one approved message.",
} as const;

export function isSlackRecordKind(value: string): value is SlackRecordKind {
  return (SLACK_RECORD_KINDS as readonly string[]).includes(value);
}

export type SlackMessageDraftInput = {
  channel: string;
  text: string;
};

/**
 * Slack channel ids are C… for public channels and G… for private ones, and they
 * end in a digit. Requiring that digit is what stops a word like "GENERAL" from
 * being accepted as an id.
 */
export function channelProblem(channel: string): string | null {
  const value = channel.trim().toUpperCase();
  if (!value) return "Enter the Slack channel id the summary should go to.";
  if (!/^[CG][A-Z0-9]{5,19}[0-9]$/.test(value)) {
    return "Use a Slack channel id such as C0123456789 (public) or G0123456789 (private).";
  }
  return null;
}

export function normalizedChannel(channel: string): string {
  return channel.trim().toUpperCase();
}

export function draftProblems(input: SlackMessageDraftInput): string[] {
  const problems: string[] = [];
  const channel = channelProblem(input.channel);
  if (channel) problems.push(channel);

  const text = input.text.trim();
  if (text.length < SLACK_LIMITS.minText) {
    problems.push("The message needs at least a sentence of context.");
  }
  if (text.length > SLACK_LIMITS.maxText) {
    problems.push(`Keep the message under ${SLACK_LIMITS.maxText} characters.`);
  }
  return problems;
}

/**
 * A stable hash of exactly what would be posted. The approval stores this value,
 * so a later edit cannot ride on an earlier approval.
 */
export function messageFingerprint(input: SlackMessageDraftInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        channel: normalizedChannel(input.channel),
        text: input.text.trim(),
      }),
    )
    .digest("hex");
}

export type SlackRecordLike = {
  kind: SlackRecordKind;
  title: string;
  summary?: string;
  question?: string;
  hypothesis?: string;
  nextStep?: string;
  link?: string;
};

/**
 * The message is derived from the record rather than invented: the same record
 * always produces the same draft. Slack mrkdwn is used, so the heading is bold
 * and the record is a link.
 */
export function buildSlackMessageDraft(record: SlackRecordLike): SlackMessageDraftInput {
  const heading = SLACK_RECORD_KIND_LABELS[record.kind];
  const title = `${heading}: ${record.title}`.slice(0, 180);

  const lines = [
    `*${title}*`,
    "",
    record.question ? `Question: ${record.question}` : "",
    record.hypothesis ? `Hypothesis: ${record.hypothesis}` : "",
    record.summary ? `Context: ${record.summary}` : "",
    record.nextStep ? `Proposed next step: ${record.nextStep}` : "",
    "",
    "Approved by a person in GET TO IT before this message was posted.",
    record.link ? `Record: <${record.link}|Open it in GET TO IT>` : "",
  ].filter((line) => line !== "");

  return {
    channel: "",
    text: lines.join("\n").slice(0, SLACK_LIMITS.maxText),
  };
}

const SLACK_TS = /^[0-9]{10}\.[0-9]{6}$/;
const SLACK_PERMALINK = /^https:\/\/[A-Za-z0-9.-]+\.slack\.com\/archives\/[A-Z0-9]+\/p[0-9]+$/;

/**
 * Reading a result is a parse, not an inference: Slack must name the posted
 * message before the request is recorded as sent.
 */
export function messageFromProviderResult(
  data: unknown,
): { ts: string; permalink: string | null } | null {
  if (!data || typeof data !== "object") return null;

  let ts: string | null = null;
  let permalink: string | null = null;

  const seen = new Set<unknown>();
  const queue: unknown[] = [data];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const record = current as Record<string, unknown>;

    if (ts === null && typeof record.ts === "string" && SLACK_TS.test(record.ts)) {
      ts = record.ts;
    }
    if (
      permalink === null &&
      typeof record.permalink === "string" &&
      SLACK_PERMALINK.test(record.permalink)
    ) {
      permalink = record.permalink;
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }

  return ts ? { ts, permalink } : null;
}

/**
 * The channel name from a channel listing, so the person approving sees a name
 * rather than only an id. Null means the connection cannot see that channel.
 */
export function channelLabelFromListResult(data: unknown, channelId: string): string | null {
  if (!data || typeof data !== "object") return null;
  const wanted = normalizedChannel(channelId);

  const seen = new Set<unknown>();
  const queue: unknown[] = [data];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const record = current as Record<string, unknown>;

    if (typeof record.id === "string" && record.id.toUpperCase() === wanted) {
      const name =
        (typeof record.name === "string" && record.name) ||
        (typeof record.name_normalized === "string" && record.name_normalized) ||
        "";
      if (name) return name.slice(0, 120);
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === "object") queue.push(value);
    }
  }

  return null;
}

export type ApprovalCheck = {
  status: string;
  fingerprint: string;
  approvalFingerprint: string | null;
  approvedAt: string | null;
};

/** An approval only covers the exact content it was given for. */
export function approvalCoversRequest(check: ApprovalCheck): boolean {
  if (check.approvedAt === null) return false;
  if (check.approvalFingerprint === null) return false;
  if (check.approvalFingerprint !== check.fingerprint) return false;
  return check.status === "approved" || check.status === "failed";
}

export type SendReadiness = {
  configured: boolean;
  connectionStatus: string;
  toolGranted: boolean;
};

export type SendBlocker = { code: string; message: string } | null;

/** Why a send would be refused before anything leaves the app. */
export function sendBlocker(readiness: SendReadiness): SendBlocker {
  if (!readiness.configured) {
    return {
      code: "not_configured",
      message:
        "Slack sending is not configured in this environment. Nothing was posted; the request stays approved.",
    };
  }
  if (readiness.connectionStatus !== "active") {
    return {
      code: "connection_inactive",
      message:
        "That Slack connection is no longer active. Reconnect it before sending; nothing was posted.",
    };
  }
  if (!readiness.toolGranted) {
    return {
      code: "tool_not_granted",
      message:
        "The send-message tool is not granted on that connection, so nothing was posted. Grant it before trying again rather than widening the connection.",
    };
  }
  return null;
}

export function excludedActionProblem(action: string): string | null {
  return (SLACK_EXCLUDED_ACTIONS as readonly string[]).includes(action)
    ? `This connector never performs ${action.replace(/_/g, " ")}. It only posts one approved message.`
    : null;
}
