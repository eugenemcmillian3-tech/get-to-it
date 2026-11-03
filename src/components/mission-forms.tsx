"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleMissionState, type MissionState } from "@/lib/action-state";
import {
  addDecisionAction,
  addEvidenceAction,
  addMissionTaskAction,
  addOutcomeAction,
  approveMissionShareAction,
  createMissionAction,
  deleteEvidenceAction,
  deleteOutcomeAction,
  reportMissionAction,
  requestAssistanceAction,
  resolveMissionReportAction,
  reviewSuggestionAction,
  setMissionTaskStatusAction,
  updateMissionAction,
} from "@/lib/actions/missions";
import { AI_MODELS, DEFAULT_AI_MODEL } from "@/lib/ai/models";
import {
  EVIDENCE_KINDS,
  MISSION_CATEGORIES,
  MISSION_STATUSES,
  OUTCOME_KINDS,
  SUGGESTION_KINDS,
  canReviewSuggestion,
} from "@/lib/missions";
import {
  cardClass,
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
  quietButton,
  secondaryButton,
} from "@/lib/styles";
import type {
  Mission,
  MissionEvidence,
  MissionReport,
  MissionSuggestion,
  WorkspaceMember,
  WorkspaceRole,
} from "@/lib/types";

function StateNote({ state, idle }: { state: MissionState; idle?: string }) {
  if (state.status === "error") {
    return <span className="text-danger">{state.message}</span>;
  }
  if (state.status === "success") {
    return <span className="text-mint">{state.message}</span>;
  }
  return idle ? <span className="text-muted">{idle}</span> : null;
}

export function MissionCreateForm({ workspaceId }: { workspaceId: string }) {
  const [state, formAction] = useActionState(createMissionAction, idleMissionState);

  return (
    <form action={formAction} className={`${cardClass} border-brand/30 bg-brand-soft/30`}>
      <h2 className="text-lg font-bold">New mission</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        A mission names the problem, who is affected, what a good outcome is, the
        constraints and a review date. It starts as a draft; nothing is expected
        of anyone until the group says so.
      </p>

      <input type="hidden" name="workspace_id" value={workspaceId} />

      <div className="mt-4 space-y-4">
        <div>
          <label className={labelClass} htmlFor="mission-title">
            Mission title
          </label>
          <input
            id="mission-title"
            name="title"
            required
            maxLength={160}
            placeholder="e.g. Make the repair café open to wheelchairs"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="mission-category">
            Category
          </label>
          <select id="mission-category" name="category" className={`mt-1.5 ${inputClass}`}>
            {MISSION_CATEGORIES.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.label}
              </option>
            ))}
          </select>
          <p className={hintClass}>
            A starting point, not a promise. The problem below is what matters.
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor="mission-problem">
            What is the problem?
          </label>
          <textarea
            id="mission-problem"
            name="problem"
            rows={4}
            required
            maxLength={3000}
            placeholder="What is happening, and why does it matter now?"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="mission-stakeholders">
            Who is affected?
          </label>
          <textarea
            id="mission-stakeholders"
            name="stakeholders"
            rows={3}
            required
            maxLength={2000}
            placeholder="People, groups or services. Describe roles, not private details."
            className={`mt-1.5 ${inputClass}`}
          />
          <p className={hintClass}>
            Do not add personal stories here. Those go in the evidence section, with
            consent.
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor="mission-outcome">
            Desired outcome
          </label>
          <textarea
            id="mission-outcome"
            name="desired_outcome"
            rows={3}
            required
            maxLength={2000}
            placeholder="What would be different if this went well?"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="mission-constraints">
              Constraints
            </label>
            <textarea
              id="mission-constraints"
              name="constraints"
              rows={3}
              maxLength={2000}
              placeholder="Time, money, rules, capacity, things you cannot change"
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="mission-review">
              Review date
            </label>
            <input
              id="mission-review"
              name="review_at"
              type="date"
              className={`mt-1.5 ${inputClass}`}
            />
            <p className={hintClass}>
              Optional. It is a reminder to look again, not a deadline.
            </p>
          </div>
        </div>
      </div>

      <p aria-live="polite" className="mt-3 min-h-5 text-sm">
        <StateNote state={state} idle="Creating a mission spends no AI request." />
      </p>

      <SubmitButton className={primaryButton} pendingLabel="Creating mission…">
        Create the mission
      </SubmitButton>
    </form>
  );
}

export function MissionSettingsForm({
  mission,
  members,
}: {
  mission: Mission;
  members: WorkspaceMember[];
}) {
  const [state, formAction] = useActionState(updateMissionAction, idleMissionState);
  const active = members.filter((member) => member.status === "active");

  return (
    <form action={formAction} className={cardClass}>
      <input type="hidden" name="workspace_id" value={mission.workspace_id} />
      <input type="hidden" name="mission_id" value={mission.id} />
      <h2 className="text-lg font-bold">Mission settings</h2>

      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <div>
          <label className={labelClass} htmlFor="mission-status">
            Status
          </label>
          <select
            id="mission-status"
            name="status"
            defaultValue={mission.status}
            className={`mt-1.5 ${inputClass}`}
          >
            {MISSION_STATUSES.map((status) => (
              <option key={status.slug} value={status.slug}>
                {status.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="mission-owner">
            Human decision owner
          </label>
          <select
            id="mission-owner"
            name="decision_owner_id"
            defaultValue={mission.decision_owner_id ?? ""}
            className={`mt-1.5 ${inputClass}`}
          >
            <option value="">No owner named</option>
            {active.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.display_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="mission-review-edit">
            Review date
          </label>
          <input
            id="mission-review-edit"
            name="review_at"
            type="date"
            defaultValue={mission.review_at ?? ""}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
      </div>

      <p aria-live="polite" className="mt-3 min-h-5 text-sm">
        <StateNote state={state} idle="Only a person can be the decision owner." />
      </p>

      <SubmitButton className={secondaryButton} pendingLabel="Saving…">
        Save mission settings
      </SubmitButton>
    </form>
  );
}

export function EvidenceForm({ mission }: { mission: Mission }) {
  const [state, formAction] = useActionState(addEvidenceAction, idleMissionState);
  const [personal, setPersonal] = useState(false);

  return (
    <form action={formAction} className={cardClass}>
      <input type="hidden" name="workspace_id" value={mission.workspace_id} />
      <input type="hidden" name="mission_id" value={mission.id} />
      <h3 className="text-base font-bold">Add evidence or an assumption</h3>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="evidence-kind">
            Is this evidence or an assumption?
          </label>
          <select id="evidence-kind" name="kind" className={`mt-1.5 ${inputClass}`}>
            {EVIDENCE_KINDS.map((kind) => (
              <option key={kind.slug} value={kind.slug}>
                {kind.label}
              </option>
            ))}
          </select>
          <p className={hintClass}>
            {EVIDENCE_KINDS.map((kind) => `${kind.label}: ${kind.note}`).join(" ")}
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor="evidence-url">
            Source link, if any
          </label>
          <input
            id="evidence-url"
            name="source_url"
            type="url"
            maxLength={500}
            placeholder="https://example.org/report"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
      </div>

      <div className="mt-4">
        <label className={labelClass} htmlFor="evidence-text">
          What do you want the group to know?
        </label>
        <textarea
          id="evidence-text"
          name="text"
          rows={3}
          required
          maxLength={2000}
          className={`mt-1.5 ${inputClass}`}
        />
      </div>

      <label className="mt-4 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="contains_personal_story"
          value="yes"
          checked={personal}
          onChange={(event) => setPersonal(event.target.checked)}
          className="mt-1"
        />
        <span>
          This includes a personal story or identifying detail. I have explicit
          consent to record it for this mission.
        </span>
      </label>

      {personal ? (
        <div className="mt-3">
          <label className={labelClass} htmlFor="evidence-consent">
            Consent recorded
          </label>
          <input
            id="evidence-consent"
            name="consent_note"
            required
            maxLength={500}
            placeholder="Who consented, and to what, e.g. “A. agreed on 12 Oct to share this with the group”"
            className={`mt-1.5 ${inputClass}`}
          />
          <p className={hintClass}>
            Without this, the item cannot be stored as a personal story and cannot
            be included in a share approval or in AI input.
          </p>
        </div>
      ) : null}

      <p aria-live="polite" className="mt-3 min-h-5 text-sm">
        <StateNote state={state} idle="Contributions are visible to active members only." />
      </p>

      <SubmitButton className={secondaryButton} pendingLabel="Adding…">
        Add to the record
      </SubmitButton>
    </form>
  );
}

export function DeleteEvidenceButton({
  mission,
  evidence,
}: {
  mission: Mission;
  evidence: MissionEvidence;
}) {
  const [state, formAction] = useActionState(deleteEvidenceAction, idleMissionState);

  return (
    <form action={formAction} className="mt-1 inline-flex items-center gap-2">
      <input type="hidden" name="workspace_id" value={mission.workspace_id} />
      <input type="hidden" name="mission_id" value={mission.id} />
      <input type="hidden" name="evidence_id" value={evidence.id} />
      <SubmitButton className={quietButton} pendingLabel="Removing…">
        Remove
      </SubmitButton>
      <span aria-live="polite" className="text-xs">
        <StateNote state={state} />
      </span>
    </form>
  );
}

export function DecisionForm({
  mission,
  members,
}: {
  mission: Mission;
  members: WorkspaceMember[];
}) {
  const [state, formAction] = useActionState(addDecisionAction, idleMissionState);
  const active = members.filter((member) => member.status === "active");

  return (
    <form action={formAction} className={cardClass}>
      <input type="hidden" name="workspace_id" value={mission.workspace_id} />
      <input type="hidden" name="mission_id" value={mission.id} />
      <h3 className="text-base font-bold">Record a human decision</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        A decision names who approved it. Dissent stays visible, and no AI
        suggestion is ever counted as approval.
      </p>

      <div className="mt-3 space-y-3">
        <div>
          <label className={labelClass} htmlFor="decision-title">
            Decision
          </label>
          <input
            id="decision-title"
            name="title"
            required
            maxLength={160}
            placeholder="e.g. Run the prototype for four weeks"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="decision-summary">
            What was decided, and why?
          </label>
          <textarea
            id="decision-summary"
            name="summary"
            rows={3}
            required
            maxLength={2000}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="decision-approver">
              Who approved it?
            </label>
            <select
              id="decision-approver"
              name="decided_by"
              required
              defaultValue={mission.decision_owner_id ?? ""}
              className={`mt-1.5 ${inputClass}`}
            >
              <option value="" disabled>
                Choose a member
              </option>
              {active.map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {member.display_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass} htmlFor="decision-dissent">
              Dissent, in its own words
            </label>
            <textarea
              id="decision-dissent"
              name="dissent"
              rows={3}
              maxLength={2000}
              placeholder="Who disagreed, and why. Leave blank only if nobody did."
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
        </div>
      </div>

      <p aria-live="polite" className="mt-3 min-h-5 text-sm">
        <StateNote state={state} idle="Only owners and admins record decisions." />
      </p>

      <SubmitButton className={secondaryButton} pendingLabel="Recording…">
        Record the decision
      </SubmitButton>
    </form>
  );
}

export function MissionTaskForm({
  mission,
  members,
}: {
  mission: Mission;
  members: WorkspaceMember[];
}) {
  const [state, formAction] = useActionState(addMissionTaskAction, idleMissionState);

  return (
    <form action={formAction} className={`${cardClass} mt-3`}>
      <input type="hidden" name="workspace_id" value={mission.workspace_id} />
      <input type="hidden" name="mission_id" value={mission.id} />
      <h4 className="text-sm font-bold">Add a shared task</h4>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          name="title"
          required
          maxLength={200}
          placeholder="One specific, finishable step"
          className={inputClass}
        />
        <select name="assignee_id" defaultValue="" className={`sm:max-w-[14rem] ${inputClass}`}>
          <option value="">Unassigned</option>
          {members
            .filter((member) => member.status === "active")
            .map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.display_name}
              </option>
            ))}
        </select>
        <SubmitButton className={secondaryButton} pendingLabel="Adding…">
          Add task
        </SubmitButton>
      </div>
      <p aria-live="polite" className="mt-2 min-h-5 text-sm">
        <StateNote state={state} />
      </p>
    </form>
  );
}

export function TaskStatusButtons({
  mission,
  taskId,
}: {
  mission: Mission;
  taskId: string;
}) {
  const [state, formAction] = useActionState(
    setMissionTaskStatusAction,
    idleMissionState,
  );

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-1">
      <input type="hidden" name="workspace_id" value={mission.workspace_id} />
      <input type="hidden" name="mission_id" value={mission.id} />
      <input type="hidden" name="task_id" value={taskId} />
      {(["todo", "in_progress", "completed"] as const).map((status) => (
        <button
          key={status}
          type="submit"
          name="status"
          value={status}
          className={quietButton}
        >
          {status === "todo" ? "To do" : status === "in_progress" ? "In progress" : "Done"}
        </button>
      ))}
      <span aria-live="polite" className="text-xs">
        <StateNote state={state} />
      </span>
    </form>
  );
}

export function OutcomeForm({ mission }: { mission: Mission }) {
  const [state, formAction] = useActionState(addOutcomeAction, idleMissionState);

  return (
    <form action={formAction} className={`${cardClass} mt-3`}>
      <input type="hidden" name="workspace_id" value={mission.workspace_id} />
      <input type="hidden" name="mission_id" value={mission.id} />
      <h4 className="text-sm font-bold">Record an outcome</h4>
      <div className="mt-2 grid gap-2 sm:grid-cols-[12rem_1fr]">
        <select name="kind" className={inputClass}>
          {OUTCOME_KINDS.map((kind) => (
            <option key={kind.slug} value={kind.slug}>
              {kind.label}
            </option>
          ))}
        </select>
        <input
          name="text"
          required
          maxLength={3000}
          placeholder="What happened, in specific terms"
          className={inputClass}
        />
      </div>
      <input
        name="source_url"
        type="url"
        maxLength={500}
        placeholder="Source link (required for a verified outcome)"
        className={`mt-2 ${inputClass}`}
      />
      <p className={hintClass}>
        {OUTCOME_KINDS.map((kind) => `${kind.label}: ${kind.note}`).join(" ")}
      </p>
      <p aria-live="polite" className="mt-2 min-h-5 text-sm">
        <StateNote state={state} />
      </p>
      <SubmitButton className={secondaryButton} pendingLabel="Saving…">
        Add outcome
      </SubmitButton>
    </form>
  );
}

export function DeleteOutcomeButton({
  mission,
  outcomeId,
}: {
  mission: Mission;
  outcomeId: string;
}) {
  const [state, formAction] = useActionState(deleteOutcomeAction, idleMissionState);

  return (
    <form action={formAction} className="mt-1 inline-flex items-center gap-2">
      <input type="hidden" name="workspace_id" value={mission.workspace_id} />
      <input type="hidden" name="mission_id" value={mission.id} />
      <input type="hidden" name="outcome_id" value={outcomeId} />
      <SubmitButton className={quietButton} pendingLabel="Removing…">
        Remove
      </SubmitButton>
      <span aria-live="polite" className="text-xs">
        <StateNote state={state} />
      </span>
    </form>
  );
}

export function AssistanceForm({ mission }: { mission: Mission }) {
  const [state, formAction] = useActionState(
    requestAssistanceAction,
    idleMissionState,
  );
  const [model, setModel] = useState(DEFAULT_AI_MODEL);

  return (
    <form action={formAction} className={cardClass}>
      <input type="hidden" name="workspace_id" value={mission.workspace_id} />
      <input type="hidden" name="mission_id" value={mission.id} />
      <h3 className="text-base font-bold">Ask for assistance</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        One request, one suggestion. AI cannot vote, cannot be a decision owner,
        cannot speak as a participant and cannot publish anything. Personal
        stories without recorded consent are not sent to the model.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="assist-kind">
            What should it help with?
          </label>
          <select id="assist-kind" name="kind" className={`mt-1.5 ${inputClass}`}>
            {SUGGESTION_KINDS.map((kind) => (
              <option key={kind.slug} value={kind.slug}>
                {kind.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="assist-model">
            Model
          </label>
          <select
            id="assist-model"
            name="model"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            className={`mt-1.5 ${inputClass}`}
          >
            {AI_MODELS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label} — {option.vendor}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p aria-live="polite" className="mt-3 min-h-5 text-sm">
        <StateNote state={state} idle="Each request spends one AI request from today's allowance." />
      </p>
      {typeof state.remaining === "number" ? (
        <p className="text-xs text-muted">
          {state.remaining} AI {state.remaining === 1 ? "request" : "requests"} left today.
        </p>
      ) : null}

      <SubmitButton className={secondaryButton} pendingLabel="Asking…">
        Request one suggestion (1 AI request)
      </SubmitButton>
    </form>
  );
}

function SuggestionActionForm({
  mission,
  suggestion,
  intent,
  label,
  pendingLabel,
  requireNote,
}: {
  mission: Mission;
  suggestion: MissionSuggestion;
  intent: "accept" | "reject" | "challenge";
  label: string;
  pendingLabel: string;
  requireNote: boolean;
}) {
  const [state, formAction] = useActionState(
    reviewSuggestionAction,
    idleMissionState,
  );

  return (
    <form action={formAction} className="mt-2 space-y-2">
      <input type="hidden" name="workspace_id" value={mission.workspace_id} />
      <input type="hidden" name="mission_id" value={mission.id} />
      <input type="hidden" name="suggestion_id" value={suggestion.id} />
      <input type="hidden" name="intent" value={intent} />
      {requireNote ? (
        <textarea
          name="note"
          rows={2}
          required
          maxLength={2000}
          placeholder="What is wrong, missing or misattributed?"
          className={inputClass}
        />
      ) : (
        <input type="hidden" name="note" value="" />
      )}
      <SubmitButton className={requireNote ? secondaryButton : quietButton} pendingLabel={pendingLabel}>
        {label}
      </SubmitButton>
      <span aria-live="polite" className="block text-xs">
        <StateNote state={state} />
      </span>
    </form>
  );
}

export function SuggestionReview({
  mission,
  suggestion,
  role,
}: {
  mission: Mission;
  suggestion: MissionSuggestion;
  role: WorkspaceRole;
}) {
  if (suggestion.status === "accepted" || suggestion.status === "rejected") {
    return null;
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        Review this suggestion
      </p>
      <div className="mt-1 flex flex-wrap gap-2">
        {canReviewSuggestion(role) ? (
          <>
            <SuggestionActionForm
              mission={mission}
              suggestion={suggestion}
              intent="accept"
              label="Accept as useful"
              pendingLabel="Saving…"
              requireNote={false}
            />
            <SuggestionActionForm
              mission={mission}
              suggestion={suggestion}
              intent="reject"
              label="Reject"
              pendingLabel="Saving…"
              requireNote={false}
            />
          </>
        ) : null}
      </div>
      <SuggestionActionForm
        mission={mission}
        suggestion={suggestion}
        intent="challenge"
        label="Challenge or correct this"
        pendingLabel="Recording…"
        requireNote
      />
    </div>
  );
}

export function ShareForm({
  mission,
  blockers,
  canApprove,
}: {
  mission: Mission;
  blockers: string[];
  canApprove: boolean;
}) {
  const [state, formAction] = useActionState(
    approveMissionShareAction,
    idleMissionState,
  );

  if (!canApprove) {
    return (
      <p className={`${cardClass} mt-3 text-sm leading-relaxed text-muted`}>
        Only the workspace owner can approve a share. Nothing is shared
        automatically, and members cannot publish contributions.
      </p>
    );
  }

  return (
    <form action={formAction} className={`${cardClass} mt-3`}>
      <input type="hidden" name="workspace_id" value={mission.workspace_id} />
      <input type="hidden" name="mission_id" value={mission.id} />
      <h3 className="text-base font-bold">Record a share approval</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        This records who approved what could be shared, and with whom. Nothing is
        published or sent by GET TO IT, and this build has no sharing channel.
      </p>

      {blockers.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-danger">
          {blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      ) : null}

      <textarea
        name="scope"
        rows={2}
        required
        maxLength={500}
        defaultValue={mission.share_scope ?? ""}
        placeholder="What may be shared, and with whom? e.g. “The problem statement and desired outcome, with the local council”"
        className={`mt-3 ${inputClass}`}
      />
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirmed" value="yes" required className="mt-1" />
        <span>
          I understand this records an approval only. Nothing will be published or
          sent.
        </span>
      </label>
      <p aria-live="polite" className="mt-2 min-h-5 text-sm">
        <StateNote state={state} />
      </p>
      <SubmitButton className={secondaryButton} pendingLabel="Recording…">
        Record approval
      </SubmitButton>
    </form>
  );
}

export function ReportForm({ mission }: { mission: Mission }) {
  const [state, formAction] = useActionState(reportMissionAction, idleMissionState);

  return (
    <details className={`${cardClass} mt-3`}>
      <summary className="cursor-pointer rounded text-sm font-semibold">
        Report a concern
      </summary>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        This goes to the workspace owner and admins. It never leaves the
        workspace. To remove your own contribution, use Remove on the item.
      </p>
      <form action={formAction} className="mt-3 space-y-2">
        <input type="hidden" name="workspace_id" value={mission.workspace_id} />
        <input type="hidden" name="mission_id" value={mission.id} />
        <textarea
          name="reason"
          rows={2}
          required
          maxLength={1000}
          placeholder="What is the concern?"
          className={inputClass}
        />
        <SubmitButton className={secondaryButton} pendingLabel="Sending…">
          Record the report
        </SubmitButton>
        <p aria-live="polite" className="min-h-5 text-sm">
          <StateNote state={state} />
        </p>
      </form>
    </details>
  );
}

export function ReportList({
  mission,
  reports,
}: {
  mission: Mission;
  reports: MissionReport[];
}) {
  if (reports.length === 0) return null;

  return (
    <div className={`${cardClass} mt-3`}>
      <h3 className="text-sm font-bold">Reports ({reports.length})</h3>
      <ul className="mt-2 space-y-2 text-sm">
        {reports.map((report) => (
          <li key={report.id}>
            <p className="whitespace-pre-line">{report.reason}</p>
            <p className="mt-1 text-xs text-muted">
              {report.resolved_at ? "Resolved" : "Open"} · recorded{" "}
              {report.created_at.slice(0, 10)}
            </p>
            {report.resolved_at === null ? (
              <ResolveReportButton mission={mission} reportId={report.id} />
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResolveReportButton({
  mission,
  reportId,
}: {
  mission: Mission;
  reportId: string;
}) {
  const [state, formAction] = useActionState(
    resolveMissionReportAction,
    idleMissionState,
  );

  return (
    <form action={formAction} className="mt-1 inline-flex items-center gap-2">
      <input type="hidden" name="workspace_id" value={mission.workspace_id} />
      <input type="hidden" name="mission_id" value={mission.id} />
      <input type="hidden" name="report_id" value={reportId} />
      <SubmitButton className={quietButton} pendingLabel="Saving…">
        Mark resolved
      </SubmitButton>
      <span aria-live="polite" className="text-xs">
        <StateNote state={state} />
      </span>
    </form>
  );
}
