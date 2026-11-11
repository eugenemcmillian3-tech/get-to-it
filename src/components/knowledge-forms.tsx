"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleKnowledgeState, type KnowledgeState } from "@/lib/action-state";
import {
  addEvidenceAction,
  addSourceAction,
  confirmReviewAction,
  createEntryAction,
  decideCorrectionAction,
  decideTransferAction,
  markImpactAction,
  proposeTransferAction,
  purgeExpiredAction,
  recordCorrectionAction,
  retractEntryAction,
  setVerificationAction,
  supersedeEntryAction,
} from "@/lib/actions/knowledge";
import type {
  KnowledgeCandidate,
  KnowledgeWorkspaceOption,
} from "@/lib/data/knowledge";
import {
  CLAIM_TYPES,
  CLAIM_TYPE_LABELS,
  CLAIM_TYPE_NOTES,
  CORRECTION_KINDS,
  CORRECTION_KIND_LABELS,
  EVIDENCE_STANCES,
  EVIDENCE_STANCE_LABELS,
  IMPACT_KINDS,
  IMPACT_KIND_LABELS,
  KNOWLEDGE_KINDS,
  KNOWLEDGE_KIND_LABELS,
  KNOWLEDGE_KIND_NOTES,
  KNOWLEDGE_LIMITS,
  VERIFICATION_STATUSES,
  VERIFICATION_STATUS_LABELS,
  VERIFICATION_STATUS_NOTES,
} from "@/lib/knowledge";
import {
  cardClass,
  dangerButton,
  hintClass,
  inputClass,
  labelClass,
  quietButton,
} from "@/lib/styles";

function StateNote({ state }: { state: KnowledgeState }) {
  if (state.status === "error") {
    return (
      <p className="text-sm text-danger" role="alert">
        {state.message}
      </p>
    );
  }
  if (state.status === "success") {
    return <p className="text-sm text-mint">{state.message}</p>;
  }
  return null;
}

const optionalDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 90)
  .toISOString()
  .slice(0, 10);

export function KnowledgeEntryForm({ workspaceId }: { workspaceId: string }) {
  const [state, action] = useActionState(createEntryAction, idleKnowledgeState);

  return (
    <form action={action} className={`${cardClass} mt-3 grid gap-4`}>
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <div>
        <label className={labelClass} htmlFor="knowledge-kind">
          What is this record?
        </label>
        <select id="knowledge-kind" name="kind" className={inputClass} defaultValue="claim">
          {KNOWLEDGE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {KNOWLEDGE_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
        <p className={hintClass}>
          {KNOWLEDGE_KIND_NOTES.claim} {KNOWLEDGE_KIND_NOTES.procedure}
        </p>
      </div>

      <div>
        <label className={labelClass} htmlFor="knowledge-claim-type">
          Which kind of statement is it?
        </label>
        <select
          id="knowledge-claim-type"
          name="claim_type"
          className={inputClass}
          defaultValue="measured_observation"
        >
          {CLAIM_TYPES.map((type) => (
            <option key={type} value={type}>
              {CLAIM_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        <p className={hintClass}>
          These stay separate. A preference is not a measurement, and an AI suggestion is
          never verified knowledge.
        </p>
      </div>

      <div>
        <label className={labelClass} htmlFor="knowledge-title">
          Title
        </label>
        <input
          id="knowledge-title"
          name="title"
          className={inputClass}
          maxLength={KNOWLEDGE_LIMITS.title}
          placeholder="Volunteers forget a shift they signed up for"
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="knowledge-statement">
          The claim or procedure
        </label>
        <textarea
          id="knowledge-statement"
          name="statement"
          className={`${inputClass} min-h-28`}
          maxLength={KNOWLEDGE_LIMITS.statement}
          placeholder="State it plainly, in your own words."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="knowledge-domain">
            Domain
          </label>
          <input
            id="knowledge-domain"
            name="domain"
            className={inputClass}
            maxLength={KNOWLEDGE_LIMITS.domain}
            placeholder="Volunteer onboarding"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="knowledge-review-at">
            Review by
          </label>
          <input
            id="knowledge-review-at"
            name="review_at"
            type="date"
            className={inputClass}
            defaultValue={optionalDate}
          />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="knowledge-applies">
          Where it applies
        </label>
        <textarea
          id="knowledge-applies"
          name="applies_when"
          className={`${inputClass} min-h-20`}
          maxLength={KNOWLEDGE_LIMITS.appliesWhen}
          placeholder="Conditions, population or context. Leave empty if you do not know yet."
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="knowledge-limitations">
          Known limitations
        </label>
        <textarea
          id="knowledge-limitations"
          name="limitations"
          className={`${inputClass} min-h-20`}
          maxLength={KNOWLEDGE_LIMITS.limitations}
          placeholder="What this does not cover, and what could be wrong about it."
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="knowledge-scope">
          Who may reuse it
        </label>
        <input
          id="knowledge-scope"
          name="authorized_scope"
          className={inputClass}
          maxLength={KNOWLEDGE_LIMITS.scope}
          defaultValue="This workspace only; reuse elsewhere needs a transfer approval."
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="knowledge-retention">
            Retention note
          </label>
          <input
            id="knowledge-retention"
            name="retention_note"
            className={inputClass}
            maxLength={KNOWLEDGE_LIMITS.retentionNote}
            placeholder="Keep while the pilot runs; delete afterwards."
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="knowledge-delete-after">
            Delete after
          </label>
          <input
            id="knowledge-delete-after"
            name="delete_after"
            type="date"
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Saving…">Save the record</SubmitButton>
        <StateNote state={state} />
      </div>
      <p className={hintClass}>
        It is saved as unverified. Nothing is supported until evidence and a person say so.
      </p>
    </form>
  );
}

function CandidateSelect({
  id,
  candidates,
  includeNote,
}: {
  id: string;
  candidates: KnowledgeCandidate[];
  includeNote?: boolean;
}) {
  return (
    <select id={id} name="source_pick" className={inputClass} defaultValue="">
      <option value="">No record linked</option>
      {candidates.map((candidate) => (
        <option key={`${candidate.kind}:${candidate.id}`} value={`${candidate.kind}:${candidate.id}`}>
          {candidate.detail} · {candidate.label}
        </option>
      ))}
      {includeNote ? <option value="user_note:">A note written here</option> : null}
    </select>
  );
}

function hiddenPick(formData: FormData): { kind: string; id: string } {
  const raw = String(formData.get("source_pick") ?? "");
  const [kind, id] = raw.split(":");
  return { kind: kind ?? "", id: id ?? "" };
}

/** Source links submit the chosen kind and id through hidden fields. */
function SourceFields({
  id,
  candidates,
  includeNote,
}: {
  id: string;
  candidates: KnowledgeCandidate[];
  includeNote?: boolean;
}) {
  return (
    <div>
      <label className={labelClass} htmlFor={id}>
        Record it came from
      </label>
      <CandidateSelect id={id} candidates={candidates} includeNote={includeNote} />
      <p className={hintClass}>
        Only records you can already read are listed. A link never grants access.
      </p>
    </div>
  );
}

export function LinkSourceForm({
  workspaceId,
  entryId,
  candidates,
}: {
  workspaceId: string;
  entryId: string;
  candidates: KnowledgeCandidate[];
}) {
  const [state, action] = useActionState(async (previous: KnowledgeState, formData: FormData) => {
    const pick = hiddenPick(formData);
    formData.set("source_kind", pick.kind);
    formData.set("source_id", pick.id);
    return addSourceAction(previous, formData);
  }, idleKnowledgeState);

  return (
    <form action={action} className="mt-3 grid gap-3">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="entry_id" value={entryId} />
      <SourceFields id="source-pick" candidates={candidates} includeNote />
      <div>
        <label className={labelClass} htmlFor="source-label">
          Label (optional)
        </label>
        <input
          id="source-label"
          name="label"
          className={inputClass}
          maxLength={120}
          placeholder="Pilot with six volunteers"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Linking…">Link the record</SubmitButton>
        <StateNote state={state} />
      </div>
    </form>
  );
}

export function EvidenceForm({
  workspaceId,
  entryId,
  candidates,
}: {
  workspaceId: string;
  entryId: string;
  candidates: KnowledgeCandidate[];
}) {
  const [state, action] = useActionState(async (previous: KnowledgeState, formData: FormData) => {
    const pick = hiddenPick(formData);
    formData.set("source_kind", pick.kind);
    formData.set("source_id", pick.id);
    return addEvidenceAction(previous, formData);
  }, idleKnowledgeState);

  return (
    <form action={action} className="mt-3 grid gap-3">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="entry_id" value={entryId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="evidence-stance">
            Does it support or contradict?
          </label>
          <select id="evidence-stance" name="stance" className={inputClass} defaultValue="supports">
            {EVIDENCE_STANCES.map((stance) => (
              <option key={stance} value={stance}>
                {EVIDENCE_STANCE_LABELS[stance]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="evidence-kind">
            What kind of item is it?
          </label>
          <select
            id="evidence-kind"
            name="evidence_kind"
            className={inputClass}
            defaultValue="measured_observation"
          >
            {CLAIM_TYPES.map((type) => (
              <option key={type} value={type}>
                {CLAIM_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className={hintClass}>{CLAIM_TYPE_NOTES.measured_observation}</p>
      <div>
        <label className={labelClass} htmlFor="evidence-detail">
          What was recorded
        </label>
        <textarea
          id="evidence-detail"
          name="detail"
          className={`${inputClass} min-h-24`}
          maxLength={KNOWLEDGE_LIMITS.evidenceDetail}
          placeholder="Four of six volunteers in the pilot missed a shift they had confirmed."
        />
      </div>
      <SourceFields id="evidence-source" candidates={candidates} includeNote />
      <div>
        <label className={labelClass} htmlFor="evidence-observed-at">
          Observed on (optional)
        </label>
        <input
          id="evidence-observed-at"
          name="observed_at"
          type="date"
          className={inputClass}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Recording…">Record the evidence</SubmitButton>
        <StateNote state={state} />
      </div>
      <p className={hintClass}>
        Evidence is append-only. It cannot be edited or deleted; retract the entry instead.
      </p>
    </form>
  );
}

export function VerificationForm({
  workspaceId,
  entryId,
}: {
  workspaceId: string;
  entryId: string;
}) {
  const [state, action] = useActionState(setVerificationAction, idleKnowledgeState);

  return (
    <form action={action} className="mt-3 grid gap-3">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="entry_id" value={entryId} />
      <div>
        <label className={labelClass} htmlFor="verification-status">
          Verification
        </label>
        <select
          id="verification-status"
          name="status"
          className={inputClass}
          defaultValue="supported"
        >
          {VERIFICATION_STATUSES.filter((status) => status !== "retracted").map((status) => (
            <option key={status} value={status}>
              {VERIFICATION_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        <p className={hintClass}>{VERIFICATION_STATUS_NOTES.supported}</p>
      </div>
      <div>
        <label className={labelClass} htmlFor="verification-note">
          Basis for the decision
        </label>
        <textarea
          id="verification-note"
          name="note"
          className={`${inputClass} min-h-20`}
          maxLength={KNOWLEDGE_LIMITS.limitations}
          placeholder="Why the recorded items justify this status, and what they do not show."
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Saving…">Set verification</SubmitButton>
        <StateNote state={state} />
      </div>
    </form>
  );
}

export function ReviewForm({
  workspaceId,
  entryId,
  nextReviewAt,
}: {
  workspaceId: string;
  entryId: string;
  nextReviewAt: string;
}) {
  const [state, action] = useActionState(confirmReviewAction, idleKnowledgeState);

  return (
    <form action={action} className="mt-3 grid gap-3">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="entry_id" value={entryId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="review-next">
            Next review
          </label>
          <input
            id="review-next"
            name="next_review_at"
            type="date"
            className={inputClass}
            defaultValue={nextReviewAt}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="review-note">
            Note (optional)
          </label>
          <input id="review-note" name="note" className={inputClass} maxLength={500} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Saving…">Mark reviewed</SubmitButton>
        <StateNote state={state} />
      </div>
    </form>
  );
}

export function SupersedeForm({
  workspaceId,
  entryId,
  title,
  statement,
  limitations,
}: {
  workspaceId: string;
  entryId: string;
  title: string;
  statement: string;
  limitations: string;
}) {
  const [state, action] = useActionState(supersedeEntryAction, idleKnowledgeState);

  return (
    <form action={action} className="mt-3 grid gap-3">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="entry_id" value={entryId} />
      <div>
        <label className={labelClass} htmlFor="supersede-title">
          Title for the new version
        </label>
        <input
          id="supersede-title"
          name="title"
          className={inputClass}
          defaultValue={title}
          maxLength={KNOWLEDGE_LIMITS.title}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="supersede-statement">
          Replacement wording
        </label>
        <textarea
          id="supersede-statement"
          name="statement"
          className={`${inputClass} min-h-24`}
          defaultValue={statement}
          maxLength={KNOWLEDGE_LIMITS.statement}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="supersede-limitations">
          Limitations for the new version
        </label>
        <textarea
          id="supersede-limitations"
          name="limitations"
          className={`${inputClass} min-h-20`}
          defaultValue={limitations}
          maxLength={KNOWLEDGE_LIMITS.limitations}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="supersede-note">
          Why it changed
        </label>
        <input id="supersede-note" name="note" className={inputClass} maxLength={500} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Saving…">Save as a new version</SubmitButton>
        <StateNote state={state} />
      </div>
      <p className={hintClass}>
        The new version starts unverified. The earlier wording, its evidence and its
        verification stay in the history.
      </p>
    </form>
  );
}

export function RetractForm({
  workspaceId,
  entryId,
}: {
  workspaceId: string;
  entryId: string;
}) {
  const [state, action] = useActionState(retractEntryAction, idleKnowledgeState);

  return (
    <form action={action} className="mt-3 grid gap-3">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="entry_id" value={entryId} />
      <div>
        <label className={labelClass} htmlFor="retract-reason">
          Why is it no longer valid?
        </label>
        <textarea
          id="retract-reason"
          name="reason"
          className={`${inputClass} min-h-20`}
          maxLength={KNOWLEDGE_LIMITS.limitations}
          placeholder="The pilot it was based on was withdrawn, and nothing else supports it."
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Retracting…" className={dangerButton}>
          Retract the entry
        </SubmitButton>
        <StateNote state={state} />
      </div>
      <p className={hintClass}>
        Retracting marks every linked decision as built on an invalid entry and refuses to
        revive this version.
      </p>
    </form>
  );
}

export function CorrectionForm({
  workspaceId,
  entryId,
}: {
  workspaceId: string;
  entryId: string;
}) {
  const [state, action] = useActionState(recordCorrectionAction, idleKnowledgeState);

  return (
    <form action={action} className="mt-3 grid gap-3">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="entry_id" value={entryId} />
      <div>
        <label className={labelClass} htmlFor="correction-kind">
          Correction or dispute
        </label>
        <select id="correction-kind" name="kind" className={inputClass} defaultValue="correction">
          {CORRECTION_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {CORRECTION_KIND_LABELS[kind]}
            </option>
          ))}
        </select>
        <p className={hintClass}>
          A correction proposes new wording. A dispute asks for the claim to be withdrawn.
        </p>
      </div>
      <div>
        <label className={labelClass} htmlFor="correction-detail">
          What is wrong?
        </label>
        <textarea
          id="correction-detail"
          name="detail"
          className={`${inputClass} min-h-20`}
          maxLength={KNOWLEDGE_LIMITS.correctionDetail}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="correction-statement">
          Proposed wording (required for a correction)
        </label>
        <textarea
          id="correction-statement"
          name="proposed_statement"
          className={`${inputClass} min-h-20`}
          maxLength={KNOWLEDGE_LIMITS.statement}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Recording…">Record it</SubmitButton>
        <StateNote state={state} />
      </div>
    </form>
  );
}

export function DecideCorrectionForm({
  workspaceId,
  entryId,
  correctionId,
}: {
  workspaceId: string;
  entryId: string;
  correctionId: string;
}) {
  const [state, action] = useActionState(decideCorrectionAction, idleKnowledgeState);

  return (
    <form action={action} className="mt-2 grid gap-2">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="entry_id" value={entryId} />
      <input type="hidden" name="correction_id" value={correctionId} />
      <div>
        <label className={labelClass} htmlFor={`correction-note-${correctionId}`}>
          Decision note
        </label>
        <input
          id={`correction-note-${correctionId}`}
          name="note"
          className={inputClass}
          maxLength={500}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          name="decision"
          value="accept"
          className={quietButton}
        >
          Accept
        </button>
        <button
          type="submit"
          name="decision"
          value="reject"
          className={quietButton}
        >
          Reject
        </button>
        <StateNote state={state} />
      </div>
    </form>
  );
}

export function ImpactForm({
  workspaceId,
  entryId,
}: {
  workspaceId: string;
  entryId: string;
}) {
  const [state, action] = useActionState(markImpactAction, idleKnowledgeState);

  return (
    <form action={action} className="mt-3 grid gap-3">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="entry_id" value={entryId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="impact-kind">
            What was built on it
          </label>
          <select
            id="impact-kind"
            name="target_kind"
            className={inputClass}
            defaultValue="recommendation"
          >
            {IMPACT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {IMPACT_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="impact-label">
            Short description
          </label>
          <input
            id="impact-label"
            name="target_label"
            className={inputClass}
            maxLength={KNOWLEDGE_LIMITS.impactLabel}
            placeholder="Reminder copy in the shift finder"
          />
        </div>
      </div>
      <div>
        <label className={labelClass} htmlFor="impact-note">
          Note (optional)
        </label>
        <input id="impact-note" name="note" className={inputClass} maxLength={500} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Linking…">Link the decision</SubmitButton>
        <StateNote state={state} />
      </div>
      <p className={hintClass}>
        Nothing is rewritten automatically. A retraction marks these so a person can revisit
        them.
      </p>
    </form>
  );
}

export function TransferForm({
  workspaceId,
  entryId,
  targets,
}: {
  workspaceId: string;
  entryId: string;
  targets: KnowledgeWorkspaceOption[];
}) {
  const [state, action] = useActionState(proposeTransferAction, idleKnowledgeState);

  if (targets.length === 0) {
    return (
      <p className={hintClass}>
        You are not an active member of another workspace, so there is nowhere to propose a
        transfer yet.
      </p>
    );
  }

  return (
    <form action={action} className="mt-3 grid gap-3">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="entry_id" value={entryId} />
      <div>
        <label className={labelClass} htmlFor="transfer-target">
          Other workshop
        </label>
        <select id="transfer-target" name="target_workspace_id" className={inputClass}>
          {targets.map((target) => (
            <option key={target.id} value={target.id}>
              {target.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass} htmlFor="transfer-similarities">
          What makes the projects similar
        </label>
        <textarea
          id="transfer-similarities"
          name="similarities"
          className={`${inputClass} min-h-20`}
          maxLength={KNOWLEDGE_LIMITS.transferNote}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="transfer-differences">
          What is different there
        </label>
        <textarea
          id="transfer-differences"
          name="differences"
          className={`${inputClass} min-h-20`}
          maxLength={KNOWLEDGE_LIMITS.transferNote}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="transfer-evidence">
          What the evidence shows (optional)
        </label>
        <textarea
          id="transfer-evidence"
          name="evidence_summary"
          className={`${inputClass} min-h-16`}
          maxLength={KNOWLEDGE_LIMITS.transferNote}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="transfer-assumptions">
          Assumption that needs a new test there
        </label>
        <textarea
          id="transfer-assumptions"
          name="assumptions_to_test"
          className={`${inputClass} min-h-20`}
          maxLength={KNOWLEDGE_LIMITS.transferNote}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Proposing…">Propose the transfer</SubmitButton>
        <StateNote state={state} />
      </div>
      <p className={hintClass}>
        Nothing crosses over until an owner or admin of the other workspace approves it.
        Participant feedback and personal records are never transferred.
      </p>
    </form>
  );
}

export function DecideTransferForm({
  workspaceId,
  entryId,
  transferId,
}: {
  workspaceId: string;
  entryId: string;
  transferId: string;
}) {
  const [state, action] = useActionState(decideTransferAction, idleKnowledgeState);

  return (
    <form action={action} className="mt-2 grid gap-2">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="entry_id" value={entryId} />
      <input type="hidden" name="transfer_id" value={transferId} />
      <div>
        <label className={labelClass} htmlFor={`transfer-note-${transferId}`}>
          Decision note
        </label>
        <input
          id={`transfer-note-${transferId}`}
          name="note"
          className={inputClass}
          maxLength={500}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="decision" value="approve" className={quietButton}>
          Approve
        </button>
        <button type="submit" name="decision" value="decline" className={quietButton}>
          Decline
        </button>
        <StateNote state={state} />
      </div>
    </form>
  );
}

export function PurgeExpiredForm({
  workspaceId,
  count,
}: {
  workspaceId: string;
  count: number;
}) {
  const [state, action] = useActionState(purgeExpiredAction, idleKnowledgeState);

  if (count === 0) return null;

  return (
    <form action={action} className="mt-3 grid gap-2">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <p className="text-sm text-muted">
        {count} entr{count === 1 ? "y is" : "ies are"} past the retention date you set.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Deleting…" className={dangerButton}>
          Delete them
        </SubmitButton>
        <StateNote state={state} />
      </div>
    </form>
  );
}
