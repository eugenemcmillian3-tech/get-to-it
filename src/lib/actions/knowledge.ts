"use server";

import { revalidatePath } from "next/cache";
import type { KnowledgeState } from "@/lib/action-state";
import { getSession } from "@/lib/auth";
import {
  isCorrectionKind,
  isImpactKind,
  isSourceKind,
  knowledgeCorrectionSchema,
  knowledgeEntrySchema,
  knowledgeEvidenceSchema,
  knowledgeImpactSchema,
  knowledgeReviewSchema,
  knowledgeSourceSchema,
  knowledgeTransferSchema,
  type SourceKind,
} from "@/lib/knowledge";
import { firstErrorMessage, isUuid, readText } from "@/lib/validation";

/**
 * Phase 37 actions.
 *
 * Each one revalidates the workspace page and calls a security-definer function
 * that repeats the membership, role and validity checks. Nothing here sends
 * outreach, publishes, charges or transfers a record without an approval.
 */

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That knowledge entry isn't available to you.";
const NO_PERMISSION = "Your role in this workspace doesn't allow that. Nothing was changed.";

function fail(message: string): KnowledgeState {
  return { status: "error", message, nonce: Date.now() };
}

function done(message: string): KnowledgeState {
  return { status: "success", message, nonce: Date.now() };
}

function refresh(workspaceId: string, entryId?: string): void {
  revalidatePath(`/workspace/${workspaceId}/knowledge`);
  if (entryId) revalidatePath(`/workspace/${workspaceId}/knowledge/${entryId}`);
}

export async function createEntryAction(
  _previous: KnowledgeState,
  formData: FormData,
): Promise<KnowledgeState> {
  const workspaceId = readText(formData, "workspace_id");
  if (!isUuid(workspaceId)) return fail(NOT_AVAILABLE);

  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = knowledgeEntrySchema.safeParse({
    kind: readText(formData, "kind"),
    claim_type: readText(formData, "claim_type"),
    title: readText(formData, "title"),
    statement: readText(formData, "statement"),
    domain: readText(formData, "domain"),
    applies_when: readText(formData, "applies_when"),
    limitations: readText(formData, "limitations"),
    authorized_scope: readText(formData, "authorized_scope"),
    retention_note: readText(formData, "retention_note"),
    review_at: readText(formData, "review_at"),
    delete_after: readText(formData, "delete_after"),
  });
  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const { error } = await session.supabase.rpc("knowledge_create_entry", {
    p_workspace_id: workspaceId,
    p_kind: parsed.data.kind,
    p_claim_type: parsed.data.claim_type,
    p_title: parsed.data.title,
    p_statement: parsed.data.statement,
    p_domain: parsed.data.domain,
    p_applies_when: parsed.data.applies_when,
    p_limitations: parsed.data.limitations,
    p_authorized_scope: parsed.data.authorized_scope,
    p_retention_note: parsed.data.retention_note,
    p_review_at: parsed.data.review_at === "" ? null : parsed.data.review_at,
    p_delete_after: parsed.data.delete_after === "" ? null : parsed.data.delete_after,
  });

  if (error) {
    console.error("createEntryAction failed:", error.message);
    return fail(error.message);
  }

  refresh(workspaceId);
  return done("Saved as an unverified entry. Nothing was promoted from it.");
}

export async function addSourceAction(
  _previous: KnowledgeState,
  formData: FormData,
): Promise<KnowledgeState> {
  const workspaceId = readText(formData, "workspace_id");
  const entryId = readText(formData, "entry_id");
  if (!isUuid(workspaceId) || !isUuid(entryId)) return fail(NOT_AVAILABLE);

  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = knowledgeSourceSchema.safeParse({
    source_kind: readText(formData, "source_kind"),
    source_id: readText(formData, "source_id"),
    label: readText(formData, "label"),
  });
  if (!parsed.success) return fail(firstErrorMessage(parsed.error));
  if (!isSourceKind(parsed.data.source_kind)) return fail("Choose what to link.");

  const kind = parsed.data.source_kind as SourceKind;
  const needsId = kind !== "user_note" && kind !== "transfer";
  if (needsId && !isUuid(parsed.data.source_id)) {
    return fail("Choose the record you want to link.");
  }

  const { error } = await session.supabase.rpc("knowledge_add_source", {
    p_entry_id: entryId,
    p_source_kind: kind,
    p_source_id: needsId ? parsed.data.source_id : null,
    p_label: parsed.data.label,
  });

  if (error) {
    console.error("addSourceAction failed:", error.message);
    return fail(error.message);
  }

  refresh(workspaceId, entryId);
  return done("Source linked. A link never grants access to the record itself.");
}

export async function addEvidenceAction(
  _previous: KnowledgeState,
  formData: FormData,
): Promise<KnowledgeState> {
  const workspaceId = readText(formData, "workspace_id");
  const entryId = readText(formData, "entry_id");
  if (!isUuid(workspaceId) || !isUuid(entryId)) return fail(NOT_AVAILABLE);

  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = knowledgeEvidenceSchema.safeParse({
    stance: readText(formData, "stance"),
    evidence_kind: readText(formData, "evidence_kind"),
    detail: readText(formData, "detail"),
    source_kind: readText(formData, "source_kind"),
    source_id: readText(formData, "source_id"),
    observed_at: readText(formData, "observed_at"),
  });
  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const sourceKind =
    parsed.data.source_kind !== "" && isSourceKind(parsed.data.source_kind)
      ? parsed.data.source_kind
      : null;
  if (sourceKind && sourceKind !== "user_note" && !isUuid(parsed.data.source_id)) {
    return fail("Choose the record this evidence came from, or leave the link empty.");
  }

  const { error } = await session.supabase.rpc("knowledge_add_evidence", {
    p_entry_id: entryId,
    p_stance: parsed.data.stance,
    p_evidence_kind: parsed.data.evidence_kind,
    p_detail: parsed.data.detail,
    p_source_kind: sourceKind,
    p_source_id: sourceKind && sourceKind !== "user_note" ? parsed.data.source_id : null,
    p_observed_at: parsed.data.observed_at === "" ? null : parsed.data.observed_at,
  });

  if (error) {
    console.error("addEvidenceAction failed:", error.message);
    return fail(error.message);
  }

  refresh(workspaceId, entryId);
  return done("Evidence recorded. It is append-only and can be neither edited nor deleted.");
}

export async function setVerificationAction(
  _previous: KnowledgeState,
  formData: FormData,
): Promise<KnowledgeState> {
  const workspaceId = readText(formData, "workspace_id");
  const entryId = readText(formData, "entry_id");
  if (!isUuid(workspaceId) || !isUuid(entryId)) return fail(NOT_AVAILABLE);

  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const status = readText(formData, "status");
  if (status !== "unverified" && status !== "supported" && status !== "contradicted") {
    return fail("Choose unverified, supported or contradicted.");
  }

  const { error } = await session.supabase.rpc("knowledge_set_verification", {
    p_entry_id: entryId,
    p_status: status,
    p_note: readText(formData, "note"),
  });

  if (error) {
    console.error("setVerificationAction failed:", error.message);
    return fail(error.message);
  }

  refresh(workspaceId, entryId);
  return done(
    status === "supported"
      ? "Marked supported. The basis and the person who set it are recorded."
      : status === "contradicted"
        ? "Marked contradicted. It is no longer presented as valid."
        : "Reset to unverified.",
  );
}

export async function confirmReviewAction(
  _previous: KnowledgeState,
  formData: FormData,
): Promise<KnowledgeState> {
  const workspaceId = readText(formData, "workspace_id");
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = knowledgeReviewSchema.safeParse({
    entry_id: readText(formData, "entry_id"),
    next_review_at: readText(formData, "next_review_at"),
    note: readText(formData, "note"),
  });
  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const { error } = await session.supabase.rpc("knowledge_confirm_review", {
    p_entry_id: parsed.data.entry_id,
    p_next_review_at:
      parsed.data.next_review_at === "" ? null : parsed.data.next_review_at,
    p_note: parsed.data.note,
  });

  if (error) {
    console.error("confirmReviewAction failed:", error.message);
    return fail(error.message);
  }

  refresh(workspaceId, parsed.data.entry_id);
  return done("Review recorded.");
}

export async function supersedeEntryAction(
  _previous: KnowledgeState,
  formData: FormData,
): Promise<KnowledgeState> {
  const workspaceId = readText(formData, "workspace_id");
  const entryId = readText(formData, "entry_id");
  if (!isUuid(workspaceId) || !isUuid(entryId)) return fail(NOT_AVAILABLE);

  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const { error } = await session.supabase.rpc("knowledge_supersede_entry", {
    p_entry_id: entryId,
    p_title: readText(formData, "title"),
    p_statement: readText(formData, "statement"),
    p_limitations: readText(formData, "limitations"),
    p_note: readText(formData, "note"),
  });

  if (error) {
    console.error("supersedeEntryAction failed:", error.message);
    return fail(error.message);
  }

  refresh(workspaceId, entryId);
  return done("New version saved as unverified. The earlier wording stays in the history.");
}

export async function retractEntryAction(
  _previous: KnowledgeState,
  formData: FormData,
): Promise<KnowledgeState> {
  const workspaceId = readText(formData, "workspace_id");
  const entryId = readText(formData, "entry_id");
  if (!isUuid(workspaceId) || !isUuid(entryId)) return fail(NOT_AVAILABLE);

  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const { error } = await session.supabase.rpc("knowledge_retract_entry", {
    p_entry_id: entryId,
    p_reason: readText(formData, "reason"),
  });

  if (error) {
    console.error("retractEntryAction failed:", error.message);
    return fail(error.message);
  }

  refresh(workspaceId, entryId);
  return done("Retracted. Linked decisions are marked so they can be revisited.");
}

export async function recordCorrectionAction(
  _previous: KnowledgeState,
  formData: FormData,
): Promise<KnowledgeState> {
  const workspaceId = readText(formData, "workspace_id");
  const entryId = readText(formData, "entry_id");
  if (!isUuid(workspaceId) || !isUuid(entryId)) return fail(NOT_AVAILABLE);

  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = knowledgeCorrectionSchema.safeParse({
    kind: readText(formData, "kind"),
    detail: readText(formData, "detail"),
    proposed_statement: readText(formData, "proposed_statement"),
  });
  if (!parsed.success) return fail(firstErrorMessage(parsed.error));
  if (!isCorrectionKind(parsed.data.kind)) return fail("Choose correction or dispute.");

  const { error } = await session.supabase.rpc("knowledge_record_correction", {
    p_entry_id: entryId,
    p_kind: parsed.data.kind,
    p_detail: parsed.data.detail,
    p_proposed_statement: parsed.data.proposed_statement,
  });

  if (error) {
    console.error("recordCorrectionAction failed:", error.message);
    return fail(error.message);
  }

  refresh(workspaceId, entryId);
  return done("Recorded. A decision on it supersedes or retracts the entry; it never edits it in place.");
}

export async function decideCorrectionAction(
  _previous: KnowledgeState,
  formData: FormData,
): Promise<KnowledgeState> {
  const workspaceId = readText(formData, "workspace_id");
  const entryId = readText(formData, "entry_id");
  const correctionId = readText(formData, "correction_id");
  if (!isUuid(workspaceId) || !isUuid(entryId) || !isUuid(correctionId)) {
    return fail(NOT_AVAILABLE);
  }

  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const { error } = await session.supabase.rpc("knowledge_decide_correction", {
    p_correction_id: correctionId,
    p_accept: readText(formData, "decision") === "accept",
    p_note: readText(formData, "note"),
  });

  if (error) {
    console.error("decideCorrectionAction failed:", error.message);
    if (error.message.includes("owner or admin")) return fail(NO_PERMISSION);
    return fail(error.message);
  }

  refresh(workspaceId, entryId);
  return done("Decision recorded.");
}

export async function proposeTransferAction(
  _previous: KnowledgeState,
  formData: FormData,
): Promise<KnowledgeState> {
  const workspaceId = readText(formData, "workspace_id");
  const entryId = readText(formData, "entry_id");
  if (!isUuid(workspaceId) || !isUuid(entryId)) return fail(NOT_AVAILABLE);

  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = knowledgeTransferSchema.safeParse({
    target_workspace_id: readText(formData, "target_workspace_id"),
    similarities: readText(formData, "similarities"),
    differences: readText(formData, "differences"),
    evidence_summary: readText(formData, "evidence_summary"),
    assumptions_to_test: readText(formData, "assumptions_to_test"),
  });
  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const { error } = await session.supabase.rpc("knowledge_propose_transfer", {
    p_entry_id: entryId,
    p_target_workspace_id: parsed.data.target_workspace_id,
    p_similarities: parsed.data.similarities,
    p_differences: parsed.data.differences,
    p_evidence_summary: parsed.data.evidence_summary,
    p_assumptions_to_test: parsed.data.assumptions_to_test,
  });

  if (error) {
    console.error("proposeTransferAction failed:", error.message);
    return fail(error.message);
  }

  refresh(workspaceId, entryId);
  refresh(parsed.data.target_workspace_id);
  return done("Proposed. Nothing is copied until an owner or admin of the other workspace approves.");
}

export async function decideTransferAction(
  _previous: KnowledgeState,
  formData: FormData,
): Promise<KnowledgeState> {
  const workspaceId = readText(formData, "workspace_id");
  const entryId = readText(formData, "entry_id");
  const transferId = readText(formData, "transfer_id");
  if (!isUuid(workspaceId) || !isUuid(entryId) || !isUuid(transferId)) {
    return fail(NOT_AVAILABLE);
  }

  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const approve = readText(formData, "decision") === "approve";
  const { error } = await session.supabase.rpc("knowledge_decide_transfer", {
    p_transfer_id: transferId,
    p_approve: approve,
    p_note: readText(formData, "note"),
  });

  if (error) {
    console.error("decideTransferAction failed:", error.message);
    if (error.message.includes("owner or admin")) return fail(NO_PERMISSION);
    return fail(error.message);
  }

  refresh(workspaceId, entryId);
  return done(
    approve
      ? "Approved. The statement, conditions and limitations were linked into this workspace."
      : "Declined. Nothing was copied.",
  );
}

export async function markImpactAction(
  _previous: KnowledgeState,
  formData: FormData,
): Promise<KnowledgeState> {
  const workspaceId = readText(formData, "workspace_id");
  const entryId = readText(formData, "entry_id");
  if (!isUuid(workspaceId) || !isUuid(entryId)) return fail(NOT_AVAILABLE);

  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = knowledgeImpactSchema.safeParse({
    target_kind: readText(formData, "target_kind"),
    target_id: readText(formData, "target_id"),
    target_label: readText(formData, "target_label"),
    note: readText(formData, "note"),
  });
  if (!parsed.success) return fail(firstErrorMessage(parsed.error));
  if (!isImpactKind(parsed.data.target_kind)) return fail("Choose what was built on this.");

  const { error } = await session.supabase.rpc("knowledge_mark_impact", {
    p_entry_id: entryId,
    p_target_kind: parsed.data.target_kind,
    p_target_id: isUuid(parsed.data.target_id) ? parsed.data.target_id : null,
    p_target_label: parsed.data.target_label,
    p_note: parsed.data.note,
  });

  if (error) {
    console.error("markImpactAction failed:", error.message);
    return fail(error.message);
  }

  refresh(workspaceId, entryId);
  return done("Linked. A retraction will mark this decision as built on an invalid entry.");
}

export async function purgeExpiredAction(
  _previous: KnowledgeState,
  formData: FormData,
): Promise<KnowledgeState> {
  const workspaceId = readText(formData, "workspace_id");
  if (!isUuid(workspaceId)) return fail(NOT_AVAILABLE);

  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const { data, error } = await session.supabase.rpc("knowledge_purge_expired", {
    p_workspace_id: workspaceId,
  });

  if (error) {
    console.error("purgeExpiredAction failed:", error.message);
    if (error.message.includes("owner or admin")) return fail(NO_PERMISSION);
    return fail(error.message);
  }

  refresh(workspaceId);
  return done(`Deleted ${data ?? 0} entr${data === 1 ? "y" : "ies"} past their retention date.`);
}

