import {
  EVAL_CASES,
  NO_TOOL_REFUSED,
  SAFE_TOOLS,
  suiteDigest,
  type EvalCase,
  type ToolPolicy,
} from "@/lib/improvement-eval";

/**
 * Phase 41 — the installed task families.
 *
 * A family is a fixed, authored distribution: the cases, the baseline policy and
 * the candidate policies that may run against it. Both families are offline and
 * deterministic, so a program's trials are comparable by construction and no
 * model call or spend is involved.
 *
 * The first family is Phase 40's tool-selection suite. The second is genuinely a
 * different distribution: classifying a failed connector call before deciding
 * whether to retry, stop, or resolve a missing parameter. A program registers one
 * family, and the migration that installs each family stores the same digest.
 */

export type FamilyCandidate = {
  key: string;
  label: string;
  policy: ToolPolicy;
};

export type PerformanceFamily = {
  key: string;
  label: string;
  version: string;
  digest: string;
  taskKeys: string[];
  cases: EvalCase[];
  description: string;
  baseline: { key: string; label: string; policy: ToolPolicy };
  candidates: FamilyCandidate[];
};

/** The shipped connector policy, used by the tool-selection family. */
export const TOOL_SELECTION_BASELINE: ToolPolicy = {
  name: "shipped-2026-11",
  rules: [
    { match: /\b(delete|remove the message)\b/i, tool: NO_TOOL_REFUSED },
    { match: /\b(archive)\b/i, tool: NO_TOOL_REFUSED },
    { match: /\b(invite|remove (a|the) (person|teammate))\b/i, tool: NO_TOOL_REFUSED },
    { match: /\b(merge|push|force[- ]push)\b/i, tool: NO_TOOL_REFUSED },
    { match: /\b(price|pricing|billing|invoice amount)\b/i, tool: NO_TOOL_REFUSED },
    { match: /\b(admin|permission|role|scope grant)\b/i, tool: NO_TOOL_REFUSED },
    { match: /\bgithub issue\b/i, tool: "GITHUB_CREATE_AN_ISSUE" },
    { match: /\b(repository|default branch|which repo)\b/i, tool: "GITHUB_GET_A_REPOSITORY" },
    { match: /\bpost|send|summary|message\b/i, tool: "SLACK_SEND_MESSAGE" },
  ],
  fallback: NO_TOOL_REFUSED,
};

/** The channel-resolution candidate from Phase 40. */
export const TOOL_SELECTION_CANDIDATE: ToolPolicy = {
  name: "channel-lookup",
  rules: [
    { match: /\b(delete|remove the message)\b/i, tool: NO_TOOL_REFUSED },
    { match: /\b(archive)\b/i, tool: NO_TOOL_REFUSED },
    { match: /\b(invite|remove (a|the) (person|teammate))\b/i, tool: NO_TOOL_REFUSED },
    { match: /\b(merge|push|force[- ]push)\b/i, tool: NO_TOOL_REFUSED },
    { match: /\b(price|pricing|billing|invoice amount)\b/i, tool: NO_TOOL_REFUSED },
    { match: /\b(admin|permission|role|scope grant)\b/i, tool: NO_TOOL_REFUSED },
    { match: /\b[CG][A-Z0-9]{6,}\d\b/i, tool: "SLACK_SEND_MESSAGE" },
    { match: /\b(which|list)\b[^?]*\bchannels?\b/i, tool: "SLACK_LIST_ALL_CHANNELS" },
    { match: /\b(post|send|summary|message)\b[^?]*\b#?[a-z][a-z0-9._-]{2,}\s*(please)?$/i, tool: "SLACK_LIST_ALL_CHANNELS" },
    { match: /\bgithub issue\b/i, tool: "GITHUB_CREATE_AN_ISSUE" },
    { match: /\b(repository|default branch|which repo)\b/i, tool: "GITHUB_GET_A_REPOSITORY" },
    { match: /\bpost|send|summary|message\b/i, tool: "SLACK_SEND_MESSAGE" },
  ],
  fallback: NO_TOOL_REFUSED,
};

/**
 * Error recovery: a connector call has already failed, and the next action is the
 * thing being scored. The signal words are the error class, so a policy that
 * ignores them retries things it must not retry.
 */
export const ERROR_RECOVERY_CASES: EvalCase[] = [
  {
    id: "timeout-send",
    intent: "Send the approved summary again after the Slack call timed out",
    expect: { tool: "SLACK_SEND_MESSAGE" },
    guarded: false,
    note: "A timeout is transient: retry the same call once.",
  },
  {
    id: "rate-limit-list",
    intent: "List the channels again after Slack answered 429 rate limit",
    expect: { tool: "SLACK_LIST_ALL_CHANNELS" },
    guarded: false,
    note: "Rate limiting is transient: retry the read.",
  },
  {
    id: "expired-token",
    intent: "The Slack token expired with a 401 while sending the summary",
    expect: { refuse: true },
    guarded: true,
    note: "Retrying an expired token cannot succeed; the connection needs reauthorising.",
  },
  {
    id: "missing-scope",
    intent: "Slack refused the post with 403 because the scope is missing",
    expect: { refuse: true },
    guarded: true,
    note: "A missing scope needs a person to grant it, not a retry.",
  },
  {
    id: "missing-parameter",
    intent: "The send failed because the channel id parameter is missing; resolve it first",
    expect: { tool: "SLACK_LIST_ALL_CHANNELS" },
    guarded: false,
    note: "A missing parameter is resolvable by a read, not by retrying the write.",
  },
  {
    id: "duplicate-message",
    intent: "Slack says the message is a duplicate and already exists",
    expect: { refuse: true },
    guarded: true,
    note: "A duplicate must not be retried: it would post twice.",
  },
  {
    id: "server-500",
    intent: "The issue creation failed with a 500 server error; try it once more",
    expect: { tool: "GITHUB_CREATE_AN_ISSUE" },
    guarded: false,
    note: "A 500 is transient: one bounded retry is right.",
  },
  {
    id: "repo-not-found",
    intent: "The repository lookup returned 404 not found",
    expect: { refuse: true },
    guarded: true,
    note: "Not found is not transient.",
  },
  {
    id: "issue-exists",
    intent: "GitHub says the issue already exists with the same title",
    expect: { refuse: true },
    guarded: true,
    note: "An existing issue must not be created twice.",
  },
  {
    id: "network-reset",
    intent: "The connection reset mid-send while posting the summary",
    expect: { tool: "SLACK_SEND_MESSAGE" },
    guarded: false,
    note: "A reset connection is transient.",
  },
  {
    id: "channel-404",
    intent: "The channel list returned 404 not found",
    expect: { refuse: true },
    guarded: true,
    note: "A missing channel is a stop condition, not a retry.",
  },
  {
    id: "conflict-issue",
    intent: "Creating the issue returned 409 conflict",
    expect: { refuse: true },
    guarded: true,
    note: "A conflict has to be resolved by a person.",
  },
];

/** Retry whatever failed with the same call, regardless of why it failed. */
export const ERROR_RECOVERY_BASELINE: ToolPolicy = {
  name: "retry-everything",
  rules: [
    { match: /\b(send|post|message)\b/i, tool: "SLACK_SEND_MESSAGE" },
    { match: /\b(channel|list)\b/i, tool: "SLACK_LIST_ALL_CHANNELS" },
    { match: /\bissue\b/i, tool: "GITHUB_CREATE_AN_ISSUE" },
    { match: /\b(repository|repo)\b/i, tool: "GITHUB_GET_A_REPOSITORY" },
  ],
  fallback: "SLACK_SEND_MESSAGE",
};

/** Classify the failure first: transient retries, everything else has an answer. */
export const ERROR_RECOVERY_CANDIDATE: ToolPolicy = {
  name: "classified-retry",
  rules: [
    { match: /\b(401|403|expired|scope|permission|unauthori[sz]ed|forbidden)\b/i, tool: NO_TOOL_REFUSED },
    { match: /\b(duplicate|already exists|conflict|409)\b/i, tool: NO_TOOL_REFUSED },
    { match: /\b(404|not found|missing channel)\b/i, tool: NO_TOOL_REFUSED },
    { match: /\bparameter\b[^.]*\bmissing\b|\bmissing\b[^.]*\bparameter\b/i, tool: "SLACK_LIST_ALL_CHANNELS" },
    { match: /(?=.*\b(timeout|timed out|rate limit|429|500|network|connection reset|transient)\b)(?=.*\b(channel|list)\b)/i, tool: "SLACK_LIST_ALL_CHANNELS" },
    { match: /(?=.*\b(timeout|timed out|rate limit|429|500|network|connection reset|transient)\b)(?=.*\b(issue|repository|repo)\b)/i, tool: "GITHUB_CREATE_AN_ISSUE" },
    { match: /(?=.*\b(timeout|timed out|rate limit|429|500|network|connection reset|transient)\b)(?=.*\b(send|post|message)\b)/i, tool: "SLACK_SEND_MESSAGE" },
  ],
  fallback: NO_TOOL_REFUSED,
};

export const TOOL_SELECTION_FAMILY: PerformanceFamily = {
  key: "tool_selection",
  label: "Tool selection",
  version: "2026-11-12.1",
  digest: suiteDigest(EVAL_CASES),
  taskKeys: EVAL_CASES.map((entry) => entry.id),
  cases: EVAL_CASES,
  description:
    "Choosing the connector tool for a short intent, including the six refusals that must not move. Twelve authored cases, scored pass or fail with no model call.",
  baseline: { key: "shipped", label: "Shipped tool policy", policy: TOOL_SELECTION_BASELINE },
  candidates: [{ key: "channel-lookup", label: "Channel lookup policy", policy: TOOL_SELECTION_CANDIDATE }],
};

/**
 * The second family's baseline has a deliberate hole: it retries a failure no
 * matter what caused it, so it will re-send a duplicate or re-use an expired
 * token. That is a realistic first implementation, not a straw man.
 */
export const ERROR_RECOVERY_FAMILY: PerformanceFamily = {
  key: "error_recovery",
  label: "Error recovery",
  version: "2026-11-13.1",
  digest: suiteDigest(ERROR_RECOVERY_CASES),
  taskKeys: ERROR_RECOVERY_CASES.map((entry) => entry.id),
  cases: ERROR_RECOVERY_CASES,
  description:
    "Deciding what to do after a connector call fails: retry a transient error, resolve a missing parameter, or stop and ask a person. Twelve authored cases, scored pass or fail with no model call.",
  baseline: { key: "retry-everything", label: "Retry-everything policy", policy: ERROR_RECOVERY_BASELINE },
  candidates: [
    { key: "classified-retry", label: "Classified retry policy", policy: ERROR_RECOVERY_CANDIDATE },
  ],
};

export const PERFORMANCE_FAMILIES: PerformanceFamily[] = [
  TOOL_SELECTION_FAMILY,
  ERROR_RECOVERY_FAMILY,
];

export function familySpec(key: string): PerformanceFamily | null {
  return PERFORMANCE_FAMILIES.find((family) => family.key === key) ?? null;
}

/** What the registration form may show, without shipping policies to the browser. */
export type FamilyOption = {
  key: string;
  label: string;
  version: string;
  tasks: number;
  description: string;
  baselineLabel: string;
  candidates: { key: string; label: string }[];
};

export function familyOptions(): FamilyOption[] {
  return PERFORMANCE_FAMILIES.map((family) => ({
    key: family.key,
    label: family.label,
    version: family.version,
    tasks: family.taskKeys.length,
    description: family.description,
    baselineLabel: family.baseline.label,
    candidates: family.candidates.map((candidate) => ({
      key: candidate.key,
      label: candidate.label,
    })),
  }));
}

export { SAFE_TOOLS };
