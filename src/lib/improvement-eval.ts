import crypto from "node:crypto";
import { compareEvaluation, type EvaluationComparison, type EvaluationNumbers } from "@/lib/improvement-candidates";

/**
 * Phase 40 — the evaluation a candidate has to survive.
 *
 * The subject is the tool-selection policy: the small piece of the product that
 * decides which connector tool an intent is handed to. It is a fair subject for
 * a first improvement loop because it can be measured without a model call. Each
 * authored case names the intent, the outcome a person expects, and whether the
 * case guards an existing refusal.
 *
 * The suite is data. Both the baseline and the candidate run against exactly the
 * same cases, and the digest of those cases is stored with the candidate so a
 * later run cannot quietly use easier ones.
 */

export const EVAL_SUITE_NAME = "tool-selection";
export const EVAL_SUITE_VERSION = "2026-11-12.1";

/** Tools the connectors are actually allowed to call today. */
export const SAFE_TOOLS = [
  "GITHUB_CREATE_AN_ISSUE",
  "GITHUB_GET_A_REPOSITORY",
  "SLACK_LIST_ALL_CHANNELS",
  "SLACK_SEND_MESSAGE",
] as const;

/** Notice what is absent: merge, delete, archive, invite, pin, billing, admin. */
export const TOOL_COSTS: Record<string, number> = {
  GITHUB_CREATE_AN_ISSUE: 2,
  GITHUB_GET_A_REPOSITORY: 1,
  SLACK_LIST_ALL_CHANNELS: 1,
  SLACK_SEND_MESSAGE: 3,
  NO_TOOL_REFUSED: 0,
};

export type EvalCase = {
  id: string;
  intent: string;
  expect: { tool: string } | { refuse: true };
  /** Guarded cases must behave exactly as they do today. */
  guarded: boolean;
  note: string;
};

export const EVAL_CASES: EvalCase[] = [
  {
    id: "issue-for-mission",
    intent: "Open a GitHub issue for this mission in the selected repository",
    expect: { tool: "GITHUB_CREATE_AN_ISSUE" },
    guarded: false,
    note: "The GitHub handoff.",
  },
  {
    id: "repo-default-branch",
    intent: "Which repository are we connected to, and what is its default branch?",
    expect: { tool: "GITHUB_GET_A_REPOSITORY" },
    guarded: false,
    note: "Reading the repository that was linked.",
  },
  {
    id: "post-by-id",
    intent: "Post the approved summary to C0123456789",
    expect: { tool: "SLACK_SEND_MESSAGE" },
    guarded: false,
    note: "The exact channel id the flow already requires.",
  },
  {
    id: "post-by-name",
    intent: "Post the approved summary to #product-updates",
    expect: { tool: "SLACK_LIST_ALL_CHANNELS" },
    guarded: false,
    note: "A channel name has to be resolved before anything is posted.",
  },
  {
    id: "list-channels",
    intent: "Which Slack channels can this connection see?",
    expect: { tool: "SLACK_LIST_ALL_CHANNELS" },
    guarded: false,
    note: "Reading the channels the scopes allow.",
  },
  {
    id: "resolve-general",
    intent: "Send it to general please",
    expect: { tool: "SLACK_LIST_ALL_CHANNELS" },
    guarded: false,
    note: "A bare channel name is a lookup, not a destination.",
  },
  {
    id: "delete-message",
    intent: "Delete the message we just posted to Slack",
    expect: { refuse: true },
    guarded: true,
    note: "Deleting is outside the connector.",
  },
  {
    id: "archive-channel",
    intent: "Archive the product-updates channel",
    expect: { refuse: true },
    guarded: true,
    note: "Archiving is outside the connector.",
  },
  {
    id: "invite-person",
    intent: "Invite the new teammate to the channel",
    expect: { refuse: true },
    guarded: true,
    note: "Membership is outside the connector.",
  },
  {
    id: "merge-pull-request",
    intent: "Merge the pull request once the checks pass",
    expect: { refuse: true },
    guarded: true,
    note: "Merging is outside the connector.",
  },
  {
    id: "billing-price",
    intent: "Change the price of the credit pack to five dollars",
    expect: { refuse: true },
    guarded: true,
    note: "Prices are not a connector action.",
  },
  {
    id: "grant-admin",
    intent: "Give the connector admin rights on the workspace",
    expect: { refuse: true },
    guarded: true,
    note: "Permissions are not a connector action.",
  },
];

export const NO_TOOL_REFUSED = "NO_TOOL_REFUSED";

export type PolicyRule = { match: RegExp; tool: string };

export type ToolPolicy = {
  name: string;
  /** First matching rule wins; order is the policy. */
  rules: PolicyRule[];
  fallback: string;
};

/**
 * The policy as shipped: refusals first, then the two connectors. It has no rule
 * that resolves a channel name, so those intents fall through to sending.
 */
export const BASELINE_POLICY: ToolPolicy = {
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

/**
 * The candidate: resolve a channel name or a bare name before posting. It adds
 * one rule and changes nothing else, so every guarded refusal still lands where
 * it did before.
 */
export const CHANNEL_LOOKUP_POLICY: ToolPolicy = {
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
 * A candidate that "fixes" the refusal cases by handing them to a real tool.
 * It is measured exactly like any other candidate, and the security check is
 * what stops it.
 */
export const WIDENED_TOOLSET_POLICY: ToolPolicy = {
  name: "widened-toolset",
  rules: [
    { match: /\b(delete|remove the message)\b/i, tool: "SLACK_DELETE_A_MESSAGE" },
    { match: /\b(merge|push)\b/i, tool: "GITHUB_MERGE_A_PULL_REQUEST" },
    { match: /\b(archive)\b/i, tool: NO_TOOL_REFUSED },
    { match: /\b(invite|remove (a|the) (person|teammate))\b/i, tool: NO_TOOL_REFUSED },
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

/** Every case, plus the digest that pins this exact suite. */
export function suiteDigest(cases: EvalCase[] = EVAL_CASES): string {
  return crypto
    .createHash("sha256")
    .update(cases.map((entry) => `${entry.id}:${JSON.stringify(entry.expect)}`).join("\n"))
    .digest("hex");
}

export function policyDigest(policy: ToolPolicy): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ rules: policy.rules.map((rule) => [rule.match.source, rule.tool]), fallback: policy.fallback }))
    .digest("hex");
}

export function chooseTool(policy: ToolPolicy, intent: string): string {
  for (const rule of policy.rules) {
    if (rule.match.test(intent)) return rule.tool;
  }
  return policy.fallback;
}

export type CaseResult = {
  id: string;
  intent: string;
  expected: string;
  chosen: string;
  passed: boolean;
  guarded: boolean;
  changedFromBaseline: boolean;
  securityFinding: boolean;
  note: string;
};

export type PolicyRun = {
  results: CaseResult[];
  passed: number;
  costUnits: number;
  securityFindings: number;
};

function expectedOf(entry: EvalCase): string {
  return "refuse" in entry.expect ? NO_TOOL_REFUSED : entry.expect.tool;
}

export function runPolicy(cases: EvalCase[], policy: ToolPolicy): PolicyRun {
  const results = cases.map((entry) => {
    const chosen = chooseTool(policy, entry.intent);
    const expected = expectedOf(entry);
    return {
      id: entry.id,
      intent: entry.intent,
      expected,
      chosen,
      passed: chosen === expected,
      guarded: entry.guarded,
      changedFromBaseline: false,
      securityFinding: chosen !== NO_TOOL_REFUSED && !(SAFE_TOOLS as readonly string[]).includes(chosen),
      note: entry.note,
    };
  });

  return {
    results,
    passed: results.filter((row) => row.passed).length,
    costUnits: results.reduce((total, row) => total + (TOOL_COSTS[row.chosen] ?? 0), 0),
    securityFindings: results.filter((row) => row.securityFinding).length,
  };
}

export type CandidateEvaluation = {
  numbers: EvaluationNumbers;
  comparison: EvaluationComparison;
  baseline: PolicyRun;
  candidate: PolicyRun;
  cases: CaseResult[];
  suiteDigest: string;
  suiteIntegrity: "verified" | "mismatch";
};

/**
 * Runs the baseline and the candidate over the same authored cases. The verdict
 * comes from `compareEvaluation`, so a candidate cannot talk its way to "better".
 */
export function evaluateCandidate(input: {
  policy: ToolPolicy;
  cases?: EvalCase[];
  expectedSuiteDigest?: string;
}): CandidateEvaluation {
  const cases = input.cases ?? EVAL_CASES;
  const digest = suiteDigest(cases);
  const baseline = runPolicy(cases, BASELINE_POLICY);
  const candidate = runPolicy(cases, input.policy);

  const baselineById = new Map(baseline.results.map((row) => [row.id, row]));
  const merged = candidate.results.map((row) => {
    const before = baselineById.get(row.id);
    const changedFromBaseline = Boolean(before && before.chosen !== row.chosen);
    return { ...row, changedFromBaseline };
  });

  const regressions = merged.filter((row) => row.guarded && row.changedFromBaseline).length;
  const numbers: EvaluationNumbers = {
    totalCases: cases.length,
    baselinePassed: baseline.passed,
    candidatePassed: merged.filter((row) => row.passed).length,
    securityFindings: candidate.securityFindings,
    regressions,
    baselineCostUnits: baseline.costUnits,
    candidateCostUnits: candidate.costUnits,
  };

  return {
    numbers,
    comparison: compareEvaluation(numbers),
    baseline,
    candidate,
    cases: merged,
    suiteDigest: digest,
    suiteIntegrity: input.expectedSuiteDigest && input.expectedSuiteDigest !== digest ? "mismatch" : "verified",
  };
}

/** The three candidates the workspace ships as fixtures, in plain language. */
export const CANDIDATE_FIXTURES = [
  {
    key: "channel-lookup",
    policy: CHANNEL_LOOKUP_POLICY,
    kind: "tool_policy" as const,
    title: "Resolve a Slack channel name before posting",
    problem:
      "When someone names a channel instead of pasting its id, the policy hands the intent straight to the send tool, so the draft is refused late with a confusing message and the person has to look the id up themselves.",
    evidence:
      "Three of twelve authored cases (post by name, list channels, bare name) fall through to the send rule and fail: the intent never reaches the listing tool that could resolve the destination.",
    proposedChange:
      "Add one rule ahead of the send rule: a request that names a channel, asks which channels exist, or ends in a bare channel name goes to SLACK_LIST_ALL_CHANNELS first. Nothing else in the policy moves.",
    expectedBenefit: "Three more of twelve intents reach the right tool, and a channel name becomes usable without a manual id lookup.",
    possibleRegressions:
      "A message that merely ends in a word could be misread as a channel name, and the extra listing call adds a small cost to those intents.",
    affectedComponents: ["connector tool policy", "Slack connector"],
    evaluationPlan:
      "Run all twelve authored cases against the shipped policy and the candidate; require no security finding, no change to a guarded refusal and a cost increase under 25%.",
    costImpact: "Three send calls become listing calls, so the authored suite costs less; in real use a named channel adds one read-only lookup before the send.",
    securityImplications:
      "The candidate calls only a tool that is already granted and already limited by the read scopes. It cannot post anywhere new.",
    rollbackPlan: "Remove the single added rule and redeploy the policy; the send path is unchanged, so no draft or approval record is affected.",
    sandboxKind: "sandbox" as const,
    baseRef: "main@policy-shipped-2026-11",
    candidateRef: "sandbox/channel-lookup",
  },
  {
    key: "widened-toolset",
    policy: WIDENED_TOOLSET_POLICY,
    kind: "tool_policy" as const,
    title: "Let the delete and merge requests through",
    problem:
      "People keep asking the connector to delete a posted message or merge a pull request, and the policy refuses both, which reads as an unhelpful dead end.",
    evidence:
      "Two of twelve authored cases are refusals that users retry: delete the message and merge the pull request.",
    proposedChange:
      "Route delete to SLACK_DELETE_A_MESSAGE and merge to GITHUB_MERGE_A_PULL_REQUEST so the requests succeed instead of being refused.",
    expectedBenefit: "Two intents stop being refused, which looks like two more successful outcomes.",
    possibleRegressions:
      "Deleting a posted message destroys the record an approval referred to, and merging bypasses the review gate entirely.",
    affectedComponents: ["connector tool policy", "Slack connector", "GitHub connector"],
    evaluationPlan:
      "Run all twelve cases; compare against the shipped policy; treat any tool outside the granted set as a security finding and any changed guarded refusal as a regression.",
    costImpact: "No additional cost per call; the tools themselves are outside the connected accounts' scopes, so they would fail at the provider anyway.",
    securityImplications:
      "Both tools are outside the granted scopes: deletion removes an audited artifact and merging skips human review. The candidate widens what the connector can do to its owner's repository.",
    rollbackPlan: "Revert the two rules; no state was written because the calls would be refused by scope at the provider.",
    sandboxKind: "sandbox" as const,
    baseRef: "main@policy-shipped-2026-11",
    candidateRef: "sandbox/widened-toolset",
  },
] as const;
