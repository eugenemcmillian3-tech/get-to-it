import { describe, expect, it } from "vitest";
import {
  AI_SUGGESTION_NOTE,
  canApproveTransfer,
  canVerifyEntry,
  correctionOutcome,
  domainsIn,
  entryStateLabel,
  entrySummary,
  impactSummary,
  isPresentedAsValid,
  isRetrievable,
  knowledgeCorrectionSchema,
  knowledgeEntrySchema,
  knowledgeSourceSchema,
  knowledgeTransferSchema,
  promotionBlockers,
  contradictionBlockers,
  retentionDue,
  retrievalFilter,
  sourceHealth,
  supersedePlan,
  transferBlockers,
  transferCopy,
  type KnowledgeEntryLike,
  type KnowledgeImpactLike,
  type KnowledgeSourceLike,
} from "@/lib/knowledge";

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const OTHER_USER = "44444444-4444-4444-8444-444444444444";
const UUID = "55555555-5555-4555-8555-555555555555";

function entry(overrides: Partial<KnowledgeEntryLike> = {}): KnowledgeEntryLike {
  return {
    id: UUID,
    workspace_id: WS,
    kind: "claim",
    claim_type: "measured_observation",
    title: "Volunteers forget a confirmed shift",
    statement:
      "Four of six volunteers in the pilot missed a shift they had already confirmed.",
    domain: "Volunteer onboarding",
    applies_when: "Single-session volunteering, no reminder sent",
    limitations: "One pilot, six people",
    authorized_scope: "This workspace only",
    provenance: "",
    verification_status: "unverified",
    verification_note: "",
    verified_by: null,
    verified_at: null,
    version: 1,
    supersedes_id: null,
    superseded_by_id: null,
    transferred_from_id: null,
    status: "active",
    retention_note: "",
    delete_after: null,
    review_at: null,
    owner_id: USER,
    created_by: USER,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

function source(overrides: Partial<KnowledgeSourceLike> = {}): KnowledgeSourceLike {
  return {
    id: UUID,
    source_kind: "experiment",
    source_id: "66666666-6666-4666-8666-666666666666",
    label: "Pilot",
    linked_by: USER,
    created_at: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

function impact(overrides: Partial<KnowledgeImpactLike> = {}): KnowledgeImpactLike {
  return {
    id: UUID,
    target_kind: "recommendation",
    target_id: null,
    target_label: "Reminder copy",
    note: "",
    invalidated_at: null,
    invalidated_reason: null,
    ...overrides,
  };
}

describe("validity and presentation", () => {
  it("presents an active entry with evidence status as valid", () => {
    expect(isPresentedAsValid(entry({ verification_status: "supported" }))).toBe(true);
    expect(isRetrievable(entry())).toBe(true);
  });

  it("never presents a retracted entry as valid or retrievable", () => {
    const retracted = entry({ status: "retracted", verification_status: "retracted" });
    expect(isPresentedAsValid(retracted)).toBe(false);
    expect(isRetrievable(retracted)).toBe(false);
    expect(entryStateLabel(retracted)).toContain("Retracted");
  });

  it("never presents a superseded version as current guidance", () => {
    const old = entry({ status: "superseded", superseded_by_id: OTHER_USER });
    expect(isPresentedAsValid(old)).toBe(false);
    expect(isRetrievable(old)).toBe(false);
    expect(entryStateLabel(old)).toContain("Superseded");
  });

  it("keeps a contradicted entry retrievable but states that it is contradicted", () => {
    const contradicted = entry({ verification_status: "contradicted" });
    expect(isRetrievable(contradicted)).toBe(true);
    expect(entryStateLabel(contradicted)).toContain("Contradicted");
  });
});

describe("promotion of generated text and hypotheses", () => {
  it("refuses to promote an AI suggestion and says why", () => {
    const blockers = promotionBlockers({
      entry: { claim_type: "ai_suggestion", status: "active", verification_status: "unverified" },
      evidence: [{ stance: "supports" }],
      sources: [source()],
      note: "The model sounded confident about it.",
    });
    expect(blockers).toContain(AI_SUGGESTION_NOTE);
  });

  it("refuses to promote a hypothesis without a test", () => {
    const blockers = promotionBlockers({
      entry: { claim_type: "hypothesis", status: "active", verification_status: "unverified" },
      evidence: [{ stance: "supports" }],
      sources: [],
      note: "Repeating it twice made it feel true.",
    });
    expect(blockers.join(" ")).toContain("Record the test");
  });

  it("requires a basis and at least one supporting item", () => {
    const noBasis = promotionBlockers({
      entry: { claim_type: "measured_observation", status: "active", verification_status: "unverified" },
      evidence: [],
      sources: [],
      note: "ok",
    });
    expect(noBasis.length).toBeGreaterThanOrEqual(2);

    const ready = promotionBlockers({
      entry: { claim_type: "measured_observation", status: "active", verification_status: "unverified" },
      evidence: [{ stance: "supports" }],
      sources: [],
      note: "Six volunteers, four missed, recorded in the pilot review.",
    });
    expect(ready).toEqual([]);
  });

  it("ignores a supporting item whose source record is gone", () => {
    const blockers = promotionBlockers({
      entry: { claim_type: "project_fact", status: "active", verification_status: "unverified" },
      evidence: [],
      sources: [source({ missing: true })],
      note: "The linked experiment was deleted, so it should not count.",
    });
    expect(blockers.join(" ")).toContain("source that still exists");
  });

  it("requires a contradicting item before marking something contradicted", () => {
    const blockers = contradictionBlockers({
      entry: { status: "active", verification_status: "unverified" },
      note: "A later run found the opposite.",
      contradicting: 0,
    });
    expect(blockers.join(" ")).toContain("contradicting item first");
  });
});

describe("who may verify and who may approve", () => {
  it("lets the entry owner verify, and workspace owners and admins", () => {
    expect(canVerifyEntry({ role: "member", entry: entry(), userId: USER })).toBe(true);
    expect(
      canVerifyEntry({ role: "admin", entry: entry({ owner_id: OTHER_USER, created_by: OTHER_USER }), userId: USER }),
    ).toBe(true);
  });

  it("refuses a plain member who does not own the entry", () => {
    expect(
      canVerifyEntry({ role: "member", entry: entry({ owner_id: OTHER_USER, created_by: OTHER_USER }), userId: USER }),
    ).toBe(false);
    expect(
      canVerifyEntry({ role: null, entry: entry({ owner_id: OTHER_USER, created_by: OTHER_USER }), userId: USER }),
    ).toBe(false);
  });

  it("only lets an owner or admin of the target workspace approve a transfer", () => {
    expect(canApproveTransfer("owner")).toBe(true);
    expect(canApproveTransfer("admin")).toBe(true);
    expect(canApproveTransfer("member")).toBe(false);
    expect(canApproveTransfer(null)).toBe(false);
  });
});

describe("versions and corrections", () => {
  it("bumps the version and leaves the new one unverified", () => {
    expect(supersedePlan(entry({ version: 3 }))).toEqual({
      nextVersion: 4,
      oldStatus: "superseded",
      newStatus: "unverified",
    });
  });

  it("turns an accepted correction into a superseding version", () => {
    const outcome = correctionOutcome({
      kind: "correction",
      status: "open",
      entryStatus: "active",
      proposedStatement: "Five of seven volunteers missed a confirmed shift in the pilot.",
      decisionNote: "Counts were wrong.",
      accepted: true,
    });
    expect(outcome).toEqual({
      action: "supersede",
      statement: "Five of seven volunteers missed a confirmed shift in the pilot.",
    });
  });

  it("turns an accepted dispute into a retraction", () => {
    const outcome = correctionOutcome({
      kind: "dispute",
      status: "open",
      entryStatus: "active",
      proposedStatement: "",
      decisionNote: "The pilot data was never collected.",
      accepted: true,
    });
    expect(outcome).toEqual({
      action: "retract",
      reason: "The pilot data was never collected.",
    });
  });

  it("rejects or blocks a correction it cannot apply", () => {
    expect(
      correctionOutcome({
        kind: "dispute",
        status: "open",
        entryStatus: "active",
        proposedStatement: "",
        decisionNote: "",
        accepted: false,
      }),
    ).toEqual({ action: "reject" });

    expect(
      correctionOutcome({
        kind: "correction",
        status: "accepted",
        entryStatus: "active",
        proposedStatement: "A long enough replacement statement.",
        decisionNote: "",
        accepted: true,
      }).action,
    ).toBe("blocked");

    expect(
      correctionOutcome({
        kind: "correction",
        status: "open",
        entryStatus: "superseded",
        proposedStatement: "A long enough replacement statement.",
        decisionNote: "",
        accepted: true,
      }).action,
    ).toBe("blocked");
  });

  it("requires replacement wording for a correction", () => {
    const parsed = knowledgeCorrectionSchema.safeParse({
      kind: "correction",
      detail: "The number in the claim is wrong.",
      proposed_statement: "too short",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("transfers between workspaces", () => {
  it("blocks a transfer inside the same workspace", () => {
    expect(
      transferBlockers({
        entry: entry(),
        sourceRole: "member",
        targetWorkspaceId: WS,
        input: {
          similarities: "Same volunteers and same coordinator",
          differences: "Different shift schedule",
          assumptions_to_test: "Reminders still help when shifts are weekly",
        },
      }).join(" "),
    ).toContain("different workspace");
  });

  it("blocks a transfer from a workspace the person is not in, or of an invalid entry", () => {
    const notMember = transferBlockers({
      entry: entry(),
      sourceRole: null,
      targetWorkspaceId: OTHER_WS,
      input: {
        similarities: "Same volunteers and same coordinator",
        differences: "Different shift schedule",
        assumptions_to_test: "Reminders still help when shifts are weekly",
      },
    });
    expect(notMember.join(" ")).toContain("not a member");

    const retracted = transferBlockers({
      entry: entry({ status: "retracted", verification_status: "retracted" }),
      sourceRole: "owner",
      targetWorkspaceId: OTHER_WS,
      input: {
        similarities: "Same volunteers and same coordinator",
        differences: "Different shift schedule",
        assumptions_to_test: "Reminders still help when shifts are weekly",
      },
    });
    expect(retracted.join(" ")).toContain("non-retracted");
  });

  it("requires similarities, differences and an assumption to test", () => {
    const blockers = transferBlockers({
      entry: entry(),
      sourceRole: "member",
      targetWorkspaceId: OTHER_WS,
      input: { similarities: "same", differences: "", assumptions_to_test: "nope" },
    });
    expect(blockers.length).toBe(3);
  });

  it("carries the statement, conditions and limitations but not participant feedback", () => {
    const copy = transferCopy({
      entry: entry({ verification_status: "supported", limitations: "One pilot, six people" }),
      sourceWorkspaceName: "Volunteer pilot",
      targetWorkspaceId: OTHER_WS,
      supporting: 3,
      contradicting: 1,
      participantItems: 2,
      assumptionsToTest: "Reminders still help when shifts are weekly",
    });

    expect(copy.provenance).toContain("Volunteer pilot");
    expect(copy.limitations).toContain("One pilot, six people");
    expect(copy.limitations).toContain("3 supporting and 1 contradicting");
    expect(copy.limitations).toContain("participant feedback, which was not transferred");
    expect(copy.limitations).toContain("Assumption to test");
    expect(copy.verification_status).toBe("supported");
    expect(copy.authorized_scope).toContain("This workspace only");
    expect(copy.statement).not.toContain("volunteer said");
  });

  it("validates the transfer form", () => {
    const parsed = knowledgeTransferSchema.safeParse({
      target_workspace_id: WS,
      similarities: "Both projects onboard volunteers one at a time",
      differences: "The second workshop runs weekend shifts",
      evidence_summary: "",
      assumptions_to_test: "Reminders still help weekly",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("retrieval authorization", () => {
  const active = entry();
  const otherWorkspace = entry({ id: OTHER_USER, workspace_id: OTHER_WS });
  const superseded = entry({ id: "77777777-7777-4777-8777-777777777777", status: "superseded", superseded_by_id: UUID });
  const retracted = entry({ id: "88888888-8888-4888-8888-888888888888", status: "retracted", verification_status: "retracted" });

  it("returns only active entries in workspaces the caller belongs to", () => {
    const result = retrievalFilter([active, otherWorkspace, superseded, retracted], {
      workspaceId: WS,
      workspaceIds: [WS],
    });
    expect(result.map((row) => row.id)).toEqual([UUID]);
  });

  it("returns nothing when the caller is not a member of the workspace", () => {
    const result = retrievalFilter([active], { workspaceId: WS, workspaceIds: [OTHER_WS] });
    expect(result).toEqual([]);
  });

  it("filters by domain and text without leaking across workspaces", () => {
    const second = entry({
      id: "99999999-9999-4999-8999-999999999999",
      domain: "Billing",
      title: "Invoices go out on the first working day",
      statement: "Invoices go out on the first working day.",
    });
    expect(
      retrievalFilter([active, second], { workspaceId: WS, workspaceIds: [WS], domain: "Billing" }),
    ).toEqual([second]);
    expect(
      retrievalFilter([active, second], { workspaceId: WS, workspaceIds: [WS], query: "reminder" }),
    ).toEqual([]);
    expect(
      retrievalFilter([active, second], { workspaceId: WS, workspaceIds: [WS], query: "shift" }),
    ).toEqual([active]);
  });

  it("lists domains deterministically", () => {
    expect(domainsIn([entry({ domain: "Billing" }), entry({ domain: "Volunteer" })])).toEqual([
      "Billing",
      "Volunteer",
    ]);
  });
});

describe("invalidation, retention and source health", () => {
  it("marks every linked decision when an entry is retracted", () => {
    const summary = impactSummary([impact(), impact({ id: OTHER_USER, invalidated_at: "2026-11-10T00:00:00Z" })], {
      status: "retracted",
      verification_status: "retracted",
    });
    expect(summary.affected).toHaveLength(2);
    expect(summary.note).toContain("no longer valid");
  });

  it("leaves decisions clean while the entry is valid", () => {
    const summary = impactSummary([impact()], { status: "active", verification_status: "supported" });
    expect(summary.clean).toHaveLength(1);
    expect(summary.affected).toHaveLength(0);
  });

  it("lists entries past their retention date", () => {
    const due = retentionDue(
      [
        entry({ id: UUID, delete_after: "2026-11-01", title: "Old" }),
        entry({ id: OTHER_USER, delete_after: "2027-01-01", title: "Later" }),
        entry({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", delete_after: null, title: "Keep" }),
      ],
      "2026-11-11",
    );
    expect(due.map((row) => row.title)).toEqual(["Old"]);
  });

  it("flags sources whose record is gone and keeps notes and transfers live", () => {
    const health = sourceHealth(
      [
        source(),
        source({ id: OTHER_USER, source_kind: "user_note", source_id: null }),
        source({ id: OTHER_USER, source_kind: "goal", source_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
      ],
      new Set(["66666666-6666-4666-8666-666666666666"]),
    );
    expect(health.live).toHaveLength(2);
    expect(health.missing).toHaveLength(1);
    expect(health.missing[0].missing).toBe(true);
  });

  it("summarises an entry without claiming it is valid", () => {
    const summary = entrySummary(entry({ status: "superseded", superseded_by_id: UUID }), {
      supporting: 2,
      contradicting: 0,
    });
    expect(summary).toContain("Superseded");
    expect(summary).toContain("2 supporting");
  });
});

describe("entry and source validation", () => {
  const valid = {
    kind: "claim",
    claim_type: "project_fact",
    title: "The prototype stores no personal data",
    statement: "The sandbox prototype keeps no personal data and writes only to local state.",
    domain: "Privacy",
    applies_when: "",
    limitations: "",
    authorized_scope: "This workspace only",
    retention_note: "",
    review_at: "",
    delete_after: "",
  };

  it("accepts a well-formed entry", () => {
    expect(knowledgeEntrySchema.safeParse(valid).success).toBe(true);
  });

  it("refuses a reusable procedure that is typed as a project fact", () => {
    expect(knowledgeEntrySchema.safeParse({ ...valid, kind: "procedure" }).success).toBe(false);
  });

  it("refuses a statement too short to be a record", () => {
    expect(knowledgeEntrySchema.safeParse({ ...valid, statement: "short" }).success).toBe(false);
  });

  it("requires a linked id for a real record and allows a note without one", () => {
    expect(
      knowledgeSourceSchema.safeParse({ source_kind: "experiment", source_id: "", label: "" })
        .success,
    ).toBe(false);
    expect(
      knowledgeSourceSchema.safeParse({ source_kind: "user_note", source_id: "", label: "Seen" })
        .success,
    ).toBe(true);
  });
});
