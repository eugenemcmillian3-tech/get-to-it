import { createHash } from "node:crypto";

/**
 * Phase 9: one connector, one workflow.
 *
 * A person turns an approved GET TO IT record into a GitHub issue. The
 * connection and the OAuth flow are the existing Composio path; this module is
 * the workspace-scoped handoff, and it is deliberately narrow: issue creation
 * from explicit, previewed content, and nothing else.
 */

export const GITHUB_CREATE_ISSUE_TOOL = "GITHUB_CREATE_AN_ISSUE";

/** Actions this connector will never perform, whatever a caller asks for. */
export const GITHUB_EXCLUDED_ACTIONS = [
  "push_to_branch",
  "merge_pull_request",
  "delete_repository",
  "edit_workflow_file",
  "manage_secrets",
  "deploy",
] as const;

export type GithubExcludedAction = (typeof GITHUB_EXCLUDED_ACTIONS)[number];

export const GITHUB_ISSUE_LIMITS = {
  minTitle: 8,
  maxTitle: 120,
  minBody: 10,
  maxBody: 8000,
  executionTimeoutMs: 30_000,
} as const;

export const GITHUB_RECORD_KINDS = [
  "mission",
  "experiment",
  "outcome_review",
  "research_mission",
] as const;

export type GithubRecordKind = (typeof GITHUB_RECORD_KINDS)[number];

export const GITHUB_RECORD_KIND_LABELS: Record<GithubRecordKind, string> = {
  mission: "Mission",
  experiment: "Experiment",
  outcome_review: "Outcome review",
  research_mission: "Research mission",
};

export const GITHUB_STATUSES = [
  "draft",
  "approved",
  "sending",
  "sent",
  "failed",
  "cancelled",
] as const;

export type GithubStatus = (typeof GITHUB_STATUSES)[number];

export const GITHUB_STATUS_LABELS: Record<GithubStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed — not sent",
  cancelled: "Cancelled",
};

export const GITHUB_NOTES = {
  approval:
    "Approval is bound to a fingerprint of the exact repository, title and body. Edit any of them and the old approval no longer covers what would be sent.",
  duplicates:
    "The same record cannot produce the same issue twice: the fingerprint is unique per record, so a second identical request is refused.",
  exclusions:
    "This connector creates issues and nothing else. It cannot push code, merge, delete a repository, change a workflow file, manage secrets or deploy.",
  transport:
    "The issue is created through your own GitHub connection. Without a connected account and a granted create-issue tool, nothing is sent and the request says so.",
} as const;

export function isGithubRecordKind(value: string): value is GithubRecordKind {
  return (GITHUB_RECORD_KINDS as readonly string[]).includes(value);
}

export type GithubIssueDraftInput = {
  repository: string;
  title: string;
  body: string;
};

/** Repository names are owner/name, with the characters GitHub allows. */
export function repositoryProblem(repository: string): string | null {
  const value = repository.trim();
  if (!value) return "Choose the repository the issue should be created in.";
  if (!/^[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(value)) {
    return "Use the owner/name form, for example your-org/your-repository.";
  }
  if (value.startsWith(".") || value.endsWith(".") || value.includes("..")) {
    return "That repository name is not valid.";
  }
  return null;
}

export function draftProblems(input: GithubIssueDraftInput): string[] {
  const problems: string[] = [];
  const repository = repositoryProblem(input.repository);
  if (repository) problems.push(repository);

  const title = input.title.trim();
  if (title.length < GITHUB_ISSUE_LIMITS.minTitle) {
    problems.push("The issue title is too short to be useful.");
  }
  if (title.length > GITHUB_ISSUE_LIMITS.maxTitle) {
    problems.push(`Keep the title under ${GITHUB_ISSUE_LIMITS.maxTitle} characters.`);
  }

  const body = input.body.trim();
  if (body.length < GITHUB_ISSUE_LIMITS.minBody) {
    problems.push("The issue body needs at least a sentence of context.");
  }
  if (body.length > GITHUB_ISSUE_LIMITS.maxBody) {
    problems.push(`Keep the body under ${GITHUB_ISSUE_LIMITS.maxBody} characters.`);
  }

  return problems;
}

/**
 * A stable hash of exactly what would be sent. The approval stores this value,
 * so a later edit cannot ride on an earlier approval.
 */
export function issueFingerprint(input: GithubIssueDraftInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        repository: input.repository.trim().toLowerCase(),
        title: input.title.trim(),
        body: input.body.trim(),
      }),
    )
    .digest("hex");
}

export type GithubRecordLike = {
  kind: GithubRecordKind;
  title: string;
  summary?: string;
  question?: string;
  hypothesis?: string;
  nextStep?: string;
  link?: string;
};

/**
 * The issue text is derived from the record, not invented: the same record
 * always produces the same draft, and the person can still edit it before
 * approving.
 */
export function buildIssueDraft(record: GithubRecordLike): GithubIssueDraftInput {
  const heading =
    record.kind === "research_mission"
      ? "Research finding"
      : GITHUB_RECORD_KIND_LABELS[record.kind];

  const title = `[${heading}] ${record.title}`.slice(
    0,
    GITHUB_ISSUE_LIMITS.maxTitle,
  );

  const lines = [
    `From GET TO IT: ${heading.toLowerCase()} — ${record.title}`,
    "",
    record.question ? `Question: ${record.question}` : "",
    record.hypothesis ? `Hypothesis: ${record.hypothesis}` : "",
    record.summary ? `Context: ${record.summary}` : "",
    record.nextStep ? `Proposed next step: ${record.nextStep}` : "",
    "",
    "Approved by a person in GET TO IT before this issue was created.",
    record.link ? `Record: ${record.link}` : "",
  ].filter((line) => line !== "");

  return {
    repository: "",
    title: title.length >= GITHUB_ISSUE_LIMITS.minTitle ? title : `[Issue] ${record.title}`,
    body: lines.join("\n").slice(0, GITHUB_ISSUE_LIMITS.maxBody),
  };
}

/** Reading a result is a parse, not an inference: no URL means no success. */
export function issueFromProviderResult(
  data: unknown,
): { url: string; number: number } | null {
  if (!data || typeof data !== "object") return null;

  const queue: unknown[] = [data];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") continue;
    const record = current as Record<string, unknown>;

    const urlCandidate =
      (typeof record.html_url === "string" && record.html_url) ||
      (typeof record.url === "string" && record.url) ||
      null;
    const numberCandidate =
      typeof record.number === "number"
        ? record.number
        : typeof record.issue_number === "number"
          ? record.issue_number
          : typeof record.number === "string"
            ? Number(record.number)
            : null;

    if (
      urlCandidate &&
      /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/.test(urlCandidate) &&
      typeof numberCandidate === "number" &&
      Number.isInteger(numberCandidate) &&
      numberCandidate > 0
    ) {
      return { url: urlCandidate, number: numberCandidate };
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

/**
 * Why a send would be refused before anything leaves the app. Returning a reason
 * instead of throwing keeps the request in a state a person can act on.
 */
export function sendBlocker(readiness: SendReadiness): SendBlocker {
  if (!readiness.configured) {
    return {
      code: "not_configured",
      message:
        "GitHub sending is not configured in this environment. Nothing was sent; the request stays approved.",
    };
  }
  if (readiness.connectionStatus !== "active") {
    return {
      code: "connection_inactive",
      message:
        "That GitHub connection is no longer active. Reconnect it before sending; nothing was sent.",
    };
  }
  if (!readiness.toolGranted) {
    return {
      code: "tool_not_granted",
      message:
        "The create-issue tool is not granted on that connection, so nothing was sent. Grant it before trying again rather than widening the connection.",
    };
  }
  return null;
}

export function excludedActionProblem(action: string): string | null {
  return (GITHUB_EXCLUDED_ACTIONS as readonly string[]).includes(action)
    ? `This connector never performs ${action.replace(/_/g, " ")}. It only creates issues.`
    : null;
}
