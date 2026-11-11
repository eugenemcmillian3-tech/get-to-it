/**
 * Phase 37 — the evidence-backed knowledge layer, as pure rules.
 *
 * The knowledge layer sits on top of records that already exist: experiments
 * and their reviews, outcome reviews, learning records and goals, mission
 * workspaces and orchestration reviews. It links them by id and never copies
 * them into a competing store.
 *
 * The rules encoded here are the point of the feature:
 *
 *   * Seven kinds of statement stay separate. A participant's opinion is not a
 *     measurement, a preference is not a project fact, and an AI suggestion is
 *     never verified knowledge.
 *   * Nothing is promoted automatically. Verification needs a person, a stated
 *     basis and, for "supported", at least one real supporting item.
 *   * A superseded or retracted entry is never presented as valid again, and a
 *     retraction reaches the recommendations that were built on it.
 *   * A transfer to another workspace is a proposal until an owner or admin of
 *     the target workspace approves it, and it never carries personal
 *     information, confidential artifacts or participant feedback with it.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export const KNOWLEDGE_KINDS = ["claim", "procedure"] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

export const KNOWLEDGE_KIND_LABELS: Record<KnowledgeKind, string> = {
  claim: "Claim",
  procedure: "Reusable procedure",
};

export const KNOWLEDGE_KIND_NOTES: Record<KnowledgeKind, string> = {
  claim: "A statement you believe, or are testing, to be true in a stated domain.",
  procedure: "A repeatable way of doing something, with the conditions where it applies.",
};

/**
 * The seven kinds that must never be merged into one another.
 */
export const CLAIM_TYPES = [
  "user_preference",
  "project_fact",
  "participant_opinion",
  "measured_observation",
  "tested_procedure",
  "hypothesis",
  "ai_suggestion",
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
  user_preference: "User preference",
  project_fact: "Project fact",
  participant_opinion: "Participant opinion",
  measured_observation: "Measured observation",
  tested_procedure: "Tested procedure",
  hypothesis: "Hypothesis",
  ai_suggestion: "AI-generated suggestion",
};

export const CLAIM_TYPE_NOTES: Record<ClaimType, string> = {
  user_preference: "Someone said what they want or like. It is not a fact about the world.",
  project_fact: "A verifiable statement about this project, its records or its results.",
  participant_opinion: "One person's view. It is not a measurement and does not generalise.",
  measured_observation: "Something observed or measured, with the conditions recorded.",
  tested_procedure: "A procedure that was run at least once and recorded as a test.",
  hypothesis: "A testable guess. It stays a guess until evidence and review exist.",
  ai_suggestion: "Text a model produced. It is a suggestion, never verified knowledge.",
};

/** Types that may never be promoted to "supported" as recorded. */
export const UNPROMOTABLE_TYPES: ClaimType[] = ["ai_suggestion", "hypothesis"];

export const VERIFICATION_STATUSES = [
  "unverified",
  "supported",
  "contradicted",
  "retracted",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const VERIFICATION_STATUS_LABELS: Record<VerificationStatus, string> = {
  unverified: "Unverified",
  supported: "Supported",
  contradicted: "Contradicted",
  retracted: "Retracted",
};

export const VERIFICATION_STATUS_NOTES: Record<VerificationStatus, string> = {
  unverified: "Recorded, but nothing in this workspace yet supports or contradicts it.",
  supported: "At least one recorded item supports it and a person stated the basis.",
  contradicted: "At least one recorded item contradicts it. It must not be presented as valid.",
  retracted: "Withdrawn by a person. It is kept for history and must not be presented as valid.",
};

export const ENTRY_STATUSES = ["active", "superseded", "retracted"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const ENTRY_STATUS_LABELS: Record<EntryStatus, string> = {
  active: "Current version",
  superseded: "Superseded",
  retracted: "Retracted",
};

export const EVIDENCE_STANCES = ["supports", "contradicts"] as const;
export type EvidenceStance = (typeof EVIDENCE_STANCES)[number];

export const EVIDENCE_STANCE_LABELS: Record<EvidenceStance, string> = {
  supports: "Supports",
  contradicts: "Contradicts",
};

export const SOURCE_KINDS = [
  "experiment",
  "experiment_review",
  "outcome_review",
  "learning_record",
  "goal",
  "orchestration_review",
  "mission",
  "project_model",
  "user_note",
  "transfer",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  experiment: "Experiment",
  experiment_review: "Experiment review",
  outcome_review: "Outcome review",
  learning_record: "Learning record",
  goal: "Goal",
  orchestration_review: "Orchestration outcome review",
  mission: "Mission workspace",
  project_model: "Project model",
  user_note: "Note written here",
  transfer: "Transfer from another workspace",
};

/** Personal records that may only be linked by the person who owns them. */
export const PERSONAL_SOURCE_KINDS: SourceKind[] = [
  "outcome_review",
  "learning_record",
  "goal",
];

/** Source kinds that carry participant feedback and must not be copied. */
export const PARTICIPANT_SOURCE_KINDS: SourceKind[] = ["experiment_review"];

export const IMPACT_KINDS = [
  "recommendation",
  "contract_criterion",
  "plan_task",
  "improvement",
  "app_change",
  "other",
] as const;
export type ImpactKind = (typeof IMPACT_KINDS)[number];

export const IMPACT_KIND_LABELS: Record<ImpactKind, string> = {
  recommendation: "Recommendation",
  contract_criterion: "Contract criterion",
  plan_task: "Plan task",
  improvement: "Improvement proposal",
  app_change: "App change",
  other: "Other decision",
};

export const CORRECTION_KINDS = ["correction", "dispute"] as const;
export type CorrectionKind = (typeof CORRECTION_KINDS)[number];

export const CORRECTION_KIND_LABELS: Record<CorrectionKind, string> = {
  correction: "Correction",
  dispute: "Dispute",
};

export const TRANSFER_STATUSES = ["proposed", "approved", "declined", "withdrawn"] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  proposed: "Awaiting approval",
  approved: "Approved",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

export const CORRECTION_STATUSES = ["open", "accepted", "rejected"] as const;
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];

export const CORRECTION_STATUS_LABELS: Record<CorrectionStatus, string> = {
  open: "Open",
  accepted: "Accepted",
  rejected: "Rejected",
};

// ---------------------------------------------------------------------------
// Standing notes shown beside the interface
// ---------------------------------------------------------------------------

export const NO_AGI_CLAIM =
  "The knowledge layer organises recorded evidence. It does not establish or claim AGI, superintelligence, consciousness or a technological singularity.";

export const AI_SUGGESTION_NOTE =
  "AI-generated text is stored as an unverified suggestion. It is never promoted to verified knowledge: a person has to state the claim, or confirm it in their own words, as a new version.";

export const VERIFICATION_NOTE =
  "\"Supported\" needs a person, a written basis and at least one recorded supporting item. Nothing here is verified because a model, an agent or a consensus of agents says so.";

export const SEPARATION_NOTE =
  "A preference, an opinion, a measurement, a tested procedure, a hypothesis and an AI suggestion are different kinds of record. They are stored separately and none of them silently becomes another.";

export const TRANSFER_NOTE =
  "A transfer is a proposal, not a copy. An owner or admin of the target workspace approves it, and only then does a linked entry appear there with its provenance, conditions and limitations visible.";

export const CORRECTION_NOTE =
  "Anyone in the workspace can record a correction or dispute. Accepting one supersedes or retracts the entry, and the earlier version stays in the history rather than being edited in place.";

export const RETRIEVAL_NOTE =
  "Retrieval reads only entries in workspaces you are an active member of. It never returns retracted or superseded entries, and it never uses a link to grant access.";

export const RETENTION_NOTE =
  "Each entry carries its own retention note and, where one was set, a deletion date. Deleting the record it came from does not silently keep the claim looking supported: the missing source is shown.";

export const PRIVACY_TRANSFER_NOTE =
  "Personal information, confidential artifacts and participant feedback are never transferred. A transfer carries the statement, its conditions, its limitations and the count of supporting items, not the people or their words.";

// ---------------------------------------------------------------------------
// Limits and validation
// ---------------------------------------------------------------------------

export const KNOWLEDGE_LIMITS = {
  title: 200,
  statement: 4000,
  domain: 120,
  appliesWhen: 2000,
  limitations: 2000,
  scope: 500,
  provenance: 1000,
  evidenceDetail: 2000,
  retentionNote: 1000,
  transferNote: 4000,
  correctionDetail: 4000,
  impactLabel: 300,
} as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const uuidSchema = z.string().trim().regex(UUID_PATTERN, "That link doesn't look right.");

const optionalDate = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value),
    "Use a date in the form YYYY-MM-DD.",
  );

export const knowledgeEntrySchema = z
  .object({
    kind: z.enum(KNOWLEDGE_KINDS),
    claim_type: z.enum(CLAIM_TYPES),
    title: z.string().trim().min(5, "Give it a short title.").max(KNOWLEDGE_LIMITS.title),
    statement: z
      .string()
      .trim()
      .min(15, "Write the claim or procedure in at least 15 characters.")
      .max(KNOWLEDGE_LIMITS.statement),
    domain: z.string().trim().min(2, "Name the domain this applies to.").max(KNOWLEDGE_LIMITS.domain),
    applies_when: z.string().trim().max(KNOWLEDGE_LIMITS.appliesWhen),
    limitations: z.string().trim().max(KNOWLEDGE_LIMITS.limitations),
    authorized_scope: z
      .string()
      .trim()
      .min(10, "Say who may reuse this, even if the answer is only this workspace.")
      .max(KNOWLEDGE_LIMITS.scope),
    retention_note: z.string().trim().max(KNOWLEDGE_LIMITS.retentionNote),
    review_at: optionalDate,
    delete_after: optionalDate,
  })
  .refine((value) => value.kind !== "procedure" || value.claim_type !== "project_fact", {
    message: "A reusable procedure is not a project fact; choose another type.",
    path: ["claim_type"],
  });

export type KnowledgeEntryInput = z.infer<typeof knowledgeEntrySchema>;

export const knowledgeEvidenceSchema = z.object({
  stance: z.enum(EVIDENCE_STANCES),
  evidence_kind: z.enum(CLAIM_TYPES),
  detail: z
    .string()
    .trim()
    .min(5, "Describe the evidence in at least 5 characters.")
    .max(KNOWLEDGE_LIMITS.evidenceDetail),
  source_kind: z.union([z.enum(SOURCE_KINDS), z.literal("")]),
  source_id: z.union([uuidSchema, z.literal("")]),
  observed_at: optionalDate,
});

export type KnowledgeEvidenceInput = z.infer<typeof knowledgeEvidenceSchema>;

export const knowledgeSourceSchema = z
  .object({
    source_kind: z.enum(SOURCE_KINDS),
    source_id: z.union([uuidSchema, z.literal("")]),
    label: z.string().trim().max(500),
  })
  .superRefine((value, ctx) => {
    if (value.source_kind === "user_note") return;
    if (!UUID_PATTERN.test(value.source_id)) {
      ctx.addIssue({
        code: "custom",
        message: "Choose the record you want to link.",
        path: ["source_id"],
      });
    }
  });

export const knowledgeVerificationSchema = z.object({
  status: z.enum(["unverified", "supported", "contradicted"]),
  note: z.string().trim().max(KNOWLEDGE_LIMITS.limitations),
});

export const knowledgeCorrectionSchema = z
  .object({
    kind: z.enum(CORRECTION_KINDS),
    detail: z
      .string()
      .trim()
      .min(10, "Explain what is wrong in at least 10 characters.")
      .max(KNOWLEDGE_LIMITS.correctionDetail),
    proposed_statement: z.string().trim().max(KNOWLEDGE_LIMITS.statement),
  })
  .refine(
    (value) => value.kind !== "correction" || value.proposed_statement.trim().length >= 15,
    {
      message: "A correction proposes the wording that should replace it.",
      path: ["proposed_statement"],
    },
  );

export type KnowledgeCorrectionInput = z.infer<typeof knowledgeCorrectionSchema>;

export const knowledgeTransferSchema = z.object({
  target_workspace_id: uuidSchema,
  similarities: z
    .string()
    .trim()
    .min(10, "Say what makes the other project similar.")
    .max(KNOWLEDGE_LIMITS.transferNote),
  differences: z
    .string()
    .trim()
    .min(10, "Say what is different there.")
    .max(KNOWLEDGE_LIMITS.transferNote),
  evidence_summary: z.string().trim().max(KNOWLEDGE_LIMITS.transferNote),
  assumptions_to_test: z
    .string()
    .trim()
    .min(10, "Name at least one assumption that needs a new test there.")
    .max(KNOWLEDGE_LIMITS.transferNote),
});

export type KnowledgeTransferInput = z.infer<typeof knowledgeTransferSchema>;

export const knowledgeImpactSchema = z.object({
  target_kind: z.enum(IMPACT_KINDS),
  target_id: z.union([uuidSchema, z.literal("")]),
  target_label: z
    .string()
    .trim()
    .min(3, "Describe what was built on this.")
    .max(KNOWLEDGE_LIMITS.impactLabel),
  note: z.string().trim().max(KNOWLEDGE_LIMITS.retentionNote),
});

export const knowledgeReviewSchema = z.object({
  entry_id: uuidSchema,
  next_review_at: optionalDate,
  note: z.string().trim().max(KNOWLEDGE_LIMITS.retentionNote),
});

// ---------------------------------------------------------------------------
// Shape rules
// ---------------------------------------------------------------------------

export type KnowledgeEntryLike = {
  id: string;
  workspace_id: string;
  kind: KnowledgeKind;
  claim_type: ClaimType;
  title: string;
  statement: string;
  domain: string;
  applies_when: string;
  limitations: string;
  authorized_scope: string;
  provenance: string;
  verification_status: VerificationStatus;
  verification_note: string;
  verified_by: string | null;
  verified_at: string | null;
  version: number;
  supersedes_id: string | null;
  superseded_by_id: string | null;
  transferred_from_id: string | null;
  status: EntryStatus;
  retention_note: string;
  delete_after: string | null;
  review_at: string | null;
  owner_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type KnowledgeEvidenceLike = {
  id: string;
  stance: EvidenceStance;
  evidence_kind: ClaimType;
  detail: string;
  source_kind: SourceKind | null;
  source_id: string | null;
  observed_at: string | null;
  added_by: string | null;
  created_at: string;
};

export type KnowledgeSourceLike = {
  id: string;
  source_kind: SourceKind;
  source_id: string | null;
  label: string;
  linked_by: string | null;
  created_at: string;
  /** Resolved by the data layer: the linked record is gone or unreadable. */
  missing?: boolean;
};

export type KnowledgeImpactLike = {
  id: string;
  target_kind: ImpactKind;
  target_id: string | null;
  target_label: string;
  note: string;
  invalidated_at: string | null;
  invalidated_reason: string | null;
};

export type KnowledgeTransferLike = {
  id: string;
  entry_id: string;
  source_workspace_id: string;
  target_workspace_id: string;
  status: TransferStatus;
  similarities: string;
  differences: string;
  evidence_summary: string;
  assumptions_to_test: string;
  created_entry_id: string | null;
  requested_by: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string;
};

/**
 * Only an active version that was not retracted or contradicted counts as
 * valid. Superseded versions stay readable for history, never as guidance.
 */
export function isPresentedAsValid(entry: KnowledgeEntryLike): boolean {
  return entry.status === "active" && entry.verification_status !== "retracted";
}

/** Whether retrieval may return the entry at all. */
export function isRetrievable(entry: KnowledgeEntryLike): boolean {
  if (entry.status !== "active") return false;
  if (entry.verification_status === "retracted") return false;
  return true;
}

/** Human-facing state, in one line. */
export function entryStateLabel(entry: KnowledgeEntryLike): string {
  if (entry.status === "retracted" || entry.verification_status === "retracted") {
    return "Retracted — not valid, kept for history";
  }
  if (entry.status === "superseded") {
    return entry.superseded_by_id
      ? "Superseded by a later version"
      : "Superseded";
  }
  if (entry.verification_status === "contradicted") {
    return "Contradicted by recorded evidence";
  }
  return VERIFICATION_STATUS_LABELS[entry.verification_status];
}

/**
 * What stops a person promoting this entry. An AI suggestion and a hypothesis
 * can never become "supported" as written: both need a human-authored version.
 */
export function promotionBlockers({
  entry,
  evidence,
  sources,
  note,
}: {
  entry: Pick<KnowledgeEntryLike, "claim_type" | "status" | "verification_status">;
  evidence: Pick<KnowledgeEvidenceLike, "stance">[];
  sources: Pick<KnowledgeSourceLike, "missing">[];
  note: string;
}): string[] {
  const blockers: string[] = [];

  if (entry.claim_type === "ai_suggestion") {
    blockers.push(AI_SUGGESTION_NOTE);
  }
  if (entry.claim_type === "hypothesis") {
    blockers.push(
      "A hypothesis is not supported by being restated. Record the test that was run, then write the result as a measured observation or a tested procedure.",
    );
  }
  if (entry.status !== "active") {
    blockers.push("Only the current version can change status. Create a new version instead.");
  }
  if (entry.verification_status === "retracted") {
    blockers.push("This entry was retracted. Record a new version rather than reviving it.");
  }
  if (note.trim().length < 10) {
    blockers.push("Write the basis for the decision in at least 10 characters.");
  }
  const supporting = evidence.filter((item) => item.stance === "supports").length;
  const usableSources = sources.filter((source) => !source.missing).length;
  if (supporting === 0 && usableSources === 0) {
    blockers.push("Record at least one supporting item, or link a source that still exists.");
  }

  return blockers;
}

/** Marking something contradicted also needs a basis, but no positive evidence. */
export function contradictionBlockers({
  entry,
  note,
  contradicting,
}: {
  entry: Pick<KnowledgeEntryLike, "status" | "verification_status">;
  note: string;
  contradicting: number;
}): string[] {
  const blockers: string[] = [];
  if (entry.status !== "active") {
    blockers.push("Only the current version can change status.");
  }
  if (note.trim().length < 10) {
    blockers.push("Write what contradicts it in at least 10 characters.");
  }
  if (contradicting === 0) {
    blockers.push("Record the contradicting item first, so the decision has a basis.");
  }
  return blockers;
}

/**
 * Who may change verification: the entry's owner, or an owner/admin of the
 * workspace. A reader can still record evidence and corrections.
 */
export function canVerifyEntry({
  role,
  entry,
  userId,
}: {
  role: "owner" | "admin" | "member" | null;
  entry: Pick<KnowledgeEntryLike, "owner_id" | "created_by">;
  userId: string;
}): boolean {
  if (role === null) return false;
  if (entry.owner_id === userId || entry.created_by === userId) return true;
  return role === "owner" || role === "admin";
}

/** Who may approve a transfer: only an owner or admin of the target workspace. */
export function canApproveTransfer(role: "owner" | "admin" | "member" | null): boolean {
  return role === "owner" || role === "admin";
}

export type SupersedePlan = {
  nextVersion: number;
  oldStatus: EntryStatus;
  newStatus: "unverified";
};

/**
 * A new version starts unverified. The old one keeps its evidence and its own
 * verification, so history never claims the new wording was the verified one.
 */
export function supersedePlan(entry: Pick<KnowledgeEntryLike, "version">): SupersedePlan {
  return {
    nextVersion: Math.max(1, entry.version) + 1,
    oldStatus: "superseded",
    newStatus: "unverified",
  };
}

export type CorrectionOutcome =
  | { action: "supersede"; statement: string }
  | { action: "retract"; reason: string }
  | { action: "reject" }
  | { action: "blocked"; reason: string };

/**
 * Accepting a correction replaces the wording; accepting a dispute withdraws
 * the claim. Neither edits the earlier version in place.
 */
export function correctionOutcome({
  kind,
  status,
  entryStatus,
  proposedStatement,
  decisionNote,
  accepted,
}: {
  kind: CorrectionKind;
  status: CorrectionStatus;
  entryStatus: EntryStatus;
  proposedStatement: string;
  decisionNote: string;
  accepted: boolean;
}): CorrectionOutcome {
  if (status !== "open") {
    return { action: "blocked", reason: "This correction was already decided." };
  }
  if (!accepted) return { action: "reject" };
  if (entryStatus !== "active") {
    return {
      action: "blocked",
      reason: "That entry is no longer the current version. Record the correction on the current one.",
    };
  }
  if (kind === "correction") {
    if (proposedStatement.trim().length < 15) {
      return {
        action: "blocked",
        reason: "A correction needs the replacement wording before it can be accepted.",
      };
    }
    return { action: "supersede", statement: proposedStatement.trim() };
  }
  return {
    action: "retract",
    reason: decisionNote.trim() === "" ? "Upheld dispute" : decisionNote.trim(),
  };
}

// ---------------------------------------------------------------------------
// Transfers between workspaces
// ---------------------------------------------------------------------------

export function transferBlockers({
  entry,
  sourceRole,
  targetWorkspaceId,
  input,
}: {
  entry: Pick<KnowledgeEntryLike, "workspace_id" | "status" | "verification_status">;
  sourceRole: "owner" | "admin" | "member" | null;
  targetWorkspaceId: string;
  input: Pick<
    KnowledgeTransferInput,
    "similarities" | "differences" | "assumptions_to_test"
  >;
}): string[] {
  const blockers: string[] = [];
  if (sourceRole === null) {
    blockers.push("You are not a member of the workspace that holds this entry.");
  }
  if (targetWorkspaceId === entry.workspace_id) {
    blockers.push("Choose a different workspace. This entry already lives here.");
  }
  if (!entry.workspace_id) {
    blockers.push("This entry has no workspace and cannot be transferred.");
  }
  if (entry.status !== "active" || entry.verification_status === "retracted") {
    blockers.push("Only a current, non-retracted entry can be proposed for transfer.");
  }
  if (input.similarities.trim().length < 10) {
    blockers.push("Say what makes the two projects similar.");
  }
  if (input.differences.trim().length < 10) {
    blockers.push("Say what is different in the other project.");
  }
  if (input.assumptions_to_test.trim().length < 10) {
    blockers.push("Name an assumption that needs a new test there.");
  }
  return blockers;
}

export type TransferCopy = {
  title: string;
  statement: string;
  domain: string;
  applies_when: string;
  limitations: string;
  provenance: string;
  authorized_scope: string;
  verification_status: VerificationStatus;
  transfer_note: string;
};

/**
 * What actually crosses the workspace boundary: the statement, its conditions,
 * its limitations and the shape of the evidence — never the evidence text, the
 * people, or any artifact. Limitations always gain the transfer caveat.
 */
export function transferCopy({
  entry,
  sourceWorkspaceName,
  targetWorkspaceId,
  supporting,
  contradicting,
  participantItems,
  assumptionsToTest,
}: {
  entry: Pick<
    KnowledgeEntryLike,
    | "title"
    | "statement"
    | "domain"
    | "applies_when"
    | "limitations"
    | "verification_status"
    | "workspace_id"
  >;
  sourceWorkspaceName: string;
  targetWorkspaceId: string;
  supporting: number;
  contradicting: number;
  participantItems: number;
  assumptionsToTest: string;
}): TransferCopy {
  const evidenceLine = `${supporting} supporting and ${contradicting} contradicting item${
    supporting + contradicting === 1 ? "" : "s"
  } in the source workspace.`;
  const participantLine =
    participantItems === 0
      ? ""
      : ` ${participantItems} of them came from participant feedback, which was not transferred.`;

  const limitations = [
    entry.limitations.trim(),
    `Verified in ${sourceWorkspaceName} only. The evidence itself stayed there: ${evidenceLine}${participantLine}`,
    `Not yet tested in this workspace. Assumption to test: ${assumptionsToTest.trim()}`,
  ]
    .filter((line) => line !== "")
    .join("\n\n");

  return {
    title: entry.title,
    statement: entry.statement,
    domain: entry.domain,
    applies_when: entry.applies_when,
    limitations,
    provenance: `Transferred from ${sourceWorkspaceName} with approval. Original workspace: ${entry.workspace_id}. Target workspace: ${targetWorkspaceId}.`,
    authorized_scope: `This workspace only. Reuse outside it needs its own transfer approval.`,
    verification_status: entry.verification_status,
    transfer_note: participantLine.trim(),
  };
}

// ---------------------------------------------------------------------------
// Retrieval, invalidation, retention, source health
// ---------------------------------------------------------------------------

export type RetrievalQuery = {
  workspaceId: string;
  workspaceIds: string[];
  domain?: string;
  query?: string;
};

/**
 * The retrieval filter used by the data layer, kept pure so the authorization
 * rule is testable: membership first, then validity, then the text filters.
 */
export function retrievalFilter(
  entries: KnowledgeEntryLike[],
  { workspaceIds, workspaceId, domain = "", query = "" }: RetrievalQuery,
): KnowledgeEntryLike[] {
  const allowed = new Set(workspaceIds);
  const needle = query.trim().toLowerCase();
  const domainNeedle = domain.trim().toLowerCase();

  return entries.filter((entry) => {
    if (entry.workspace_id !== workspaceId) return false;
    if (!allowed.has(entry.workspace_id)) return false;
    if (!isRetrievable(entry)) return false;
    if (domainNeedle !== "" && entry.domain.toLowerCase() !== domainNeedle) return false;
    if (needle === "") return true;
    return (
      entry.title.toLowerCase().includes(needle) ||
      entry.statement.toLowerCase().includes(needle) ||
      entry.domain.toLowerCase().includes(needle)
    );
  });
}

export function domainsIn(entries: Pick<KnowledgeEntryLike, "domain">[]): string[] {
  return Array.from(new Set(entries.map((entry) => entry.domain))).sort((a, b) =>
    a.localeCompare(b),
  );
}

export type ImpactSummary = {
  affected: KnowledgeImpactLike[];
  clean: KnowledgeImpactLike[];
  note: string;
};

/**
 * What a retraction reaches. Affected recommendations stay in place but are
 * shown as built on a claim that no longer holds.
 */
export function impactSummary(
  impacts: KnowledgeImpactLike[],
  entry: Pick<KnowledgeEntryLike, "status" | "verification_status">,
): ImpactSummary {
  const stale = entry.status === "retracted" || entry.verification_status === "retracted";
  const affected = impacts.filter((impact) => impact.invalidated_at !== null || stale);
  const clean = impacts.filter((impact) => impact.invalidated_at === null && !stale);
  return {
    affected,
    clean,
    note:
      impacts.length === 0
        ? "Nothing in this workspace is recorded as built on this entry yet."
        : stale
          ? `${affected.length} of ${impacts.length} linked decisions were built on an entry that is no longer valid. They are listed so they can be revisited; nothing was rewritten automatically.`
          : `${clean.length} linked decision${clean.length === 1 ? "" : "s"} currently rest on this entry.`,
  };
}

/** Entries whose retention date has passed, for a workspace owner to purge. */
export function retentionDue(
  entries: Pick<KnowledgeEntryLike, "id" | "title" | "delete_after" | "status">[],
  today: string,
): Pick<KnowledgeEntryLike, "id" | "title" | "delete_after" | "status">[] {
  return entries
    .filter((entry) => entry.delete_after !== null && entry.delete_after <= today)
    .sort((a, b) => (a.delete_after ?? "").localeCompare(b.delete_after ?? ""));
}

/** Sources whose record is gone, so the claim cannot lean on them any more. */
export function sourceHealth(
  sources: KnowledgeSourceLike[],
  existingIds: Set<string>,
): { live: KnowledgeSourceLike[]; missing: KnowledgeSourceLike[] } {
  const live: KnowledgeSourceLike[] = [];
  const missing: KnowledgeSourceLike[] = [];
  for (const source of sources) {
    if (source.source_id === null || source.source_kind === "user_note" || source.source_kind === "transfer") {
      live.push(source);
      continue;
    }
    if (existingIds.has(source.source_id)) live.push(source);
    else missing.push({ ...source, missing: true });
  }
  return { live, missing };
}

/** One-line summary for a list row. */
export function entrySummary(
  entry: Pick<
    KnowledgeEntryLike,
    "kind" | "claim_type" | "domain" | "verification_status" | "status" | "version"
  >,
  counts: { supporting: number; contradicting: number },
): string {
  return [
    KNOWLEDGE_KIND_LABELS[entry.kind],
    CLAIM_TYPE_LABELS[entry.claim_type],
    entry.domain,
    entryStateLabel(entry as KnowledgeEntryLike),
    `v${entry.version}`,
    `${counts.supporting} supporting`,
    `${counts.contradicting} contradicting`,
  ].join(" · ");
}

export function isSourceKind(value: string): value is SourceKind {
  return (SOURCE_KINDS as readonly string[]).includes(value);
}

export function isClaimType(value: string): value is ClaimType {
  return (CLAIM_TYPES as readonly string[]).includes(value);
}

export function isImpactKind(value: string): value is ImpactKind {
  return (IMPACT_KINDS as readonly string[]).includes(value);
}

export function isCorrectionKind(value: string): value is CorrectionKind {
  return (CORRECTION_KINDS as readonly string[]).includes(value);
}

export function verificationStatusLabel(value: VerificationStatus): string {
  return VERIFICATION_STATUS_LABELS[value];
}
