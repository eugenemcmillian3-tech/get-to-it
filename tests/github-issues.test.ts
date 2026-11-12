import { describe, expect, it } from "vitest";
import {
  GITHUB_CREATE_ISSUE_TOOL,
  approvalCoversRequest,
  buildIssueDraft,
  draftProblems,
  excludedActionProblem,
  issueFingerprint,
  issueFromProviderResult,
  repositoryProblem,
  sendBlocker,
} from "@/lib/connectors/github-issues";

const draft = {
  repository: "acme/roadmap",
  title: "[Research finding] Does a narrow viewport change review completion?",
  body: "From GET TO IT: research finding — viewport\n\nApproved by a person.",
};

describe("github issue drafts", () => {
  it("derives a title and body from the record, not from nothing", () => {
    const built = buildIssueDraft({
      kind: "research_mission",
      title: "Does a 320 px viewport change completion?",
      question: "Does a 320 px viewport change completion?",
      summary: "Synthetic data only.",
      nextStep: "Cap required fields at three.",
      link: "https://example.test/workspace/x/research/y",
    });

    expect(built.title.startsWith("[Research finding]")).toBe(true);
    expect(built.body).toContain("Synthetic data only.");
    expect(built.body).toContain("Proposed next step");
    expect(built.body).toContain("Approved by a person");
  });

  it("reports an empty repository and short text instead of inventing them", () => {
    const problems = draftProblems({ repository: "", title: "short", body: "tiny" });
    expect(problems.join(" ")).toContain("repository");
    expect(problems.join(" ")).toContain("title");
    expect(problems.join(" ")).toContain("body");
  });

  it("accepts owner/name and refuses anything else", () => {
    expect(repositoryProblem("acme/roadmap")).toBeNull();
    expect(repositoryProblem("acme")).not.toBeNull();
    expect(repositoryProblem("acme/../etc")).not.toBeNull();
  });

  it("fingerprints exactly the content that would be sent", () => {
    const first = issueFingerprint(draft);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(issueFingerprint({ ...draft })).toBe(first);
    expect(issueFingerprint({ ...draft, title: `${draft.title} ` })).toBe(first);
    expect(issueFingerprint({ ...draft, body: `${draft.body} Extra.` })).not.toBe(first);
    expect(issueFingerprint({ ...draft, repository: "acme/other" })).not.toBe(first);
  });
});

describe("approval coverage", () => {
  const fingerprint = issueFingerprint(draft);

  it("covers only the exact approved fingerprint", () => {
    expect(
      approvalCoversRequest({
        status: "approved",
        fingerprint,
        approvalFingerprint: fingerprint,
        approvedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(true);

    expect(
      approvalCoversRequest({
        status: "approved",
        fingerprint,
        approvalFingerprint: "f".repeat(64),
        approvedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(false);

    expect(
      approvalCoversRequest({
        status: "draft",
        fingerprint,
        approvalFingerprint: fingerprint,
        approvedAt: null,
      }),
    ).toBe(false);
  });
});

describe("sending", () => {
  it("refuses to send without configuration, an active connection or a grant", () => {
    expect(
      sendBlocker({ configured: false, connectionStatus: "active", toolGranted: true })?.code,
    ).toBe("not_configured");
    expect(
      sendBlocker({ configured: true, connectionStatus: "revoked", toolGranted: true })?.code,
    ).toBe("connection_inactive");
    expect(
      sendBlocker({ configured: true, connectionStatus: "active", toolGranted: false })?.code,
    ).toBe("tool_not_granted");
    expect(
      sendBlocker({ configured: true, connectionStatus: "active", toolGranted: true }),
    ).toBeNull();
  });

  it("reads the issue url and number from the provider result", () => {
    expect(
      issueFromProviderResult({
        response_data: { html_url: "https://github.com/acme/roadmap/issues/12", number: 12 },
      }),
    ).toEqual({ url: "https://github.com/acme/roadmap/issues/12", number: 12 });

    expect(issueFromProviderResult({ html_url: "https://example.com/x", number: 3 })).toBeNull();
    expect(issueFromProviderResult({ html_url: "https://github.com/acme/roadmap/issues/1" })).toBeNull();
    expect(issueFromProviderResult(null)).toBeNull();
  });

  it("never performs a push, merge, delete, workflow edit, secret change or deploy", () => {
    for (const action of [
      "push_to_branch",
      "merge_pull_request",
      "delete_repository",
      "edit_workflow_file",
      "manage_secrets",
      "deploy",
    ]) {
      expect(excludedActionProblem(action)).toContain("only creates issues");
    }
    expect(excludedActionProblem("create_issue")).toBeNull();
  });

  it("names the create-issue tool it needs", () => {
    expect(GITHUB_CREATE_ISSUE_TOOL).toBe("GITHUB_CREATE_AN_ISSUE");
  });
});
