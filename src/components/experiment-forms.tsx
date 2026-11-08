"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleExperimentState, type ExperimentState } from "@/lib/action-state";
import {
  addExperimentFeedbackAction,
  addExperimentObservationAction,
  approveExperimentPrototypeAction,
  createExperimentAction,
  decideExperimentApprovalAction,
  requestExperimentApprovalAction,
  saveExperimentReviewAction,
} from "@/lib/actions/experiments";
import {
  APPROVAL_KIND_NOTES,
  EXPERIMENT_APPROVAL_KINDS,
  EXPERIMENT_DECISIONS,
  EXPERIMENT_FEEDBACK_KINDS,
  EXPERIMENT_NOTES,
  EXPERIMENT_OBSERVATION_KINDS,
  OBSERVATION_KIND_LABELS,
  approvalKindLabel,
  decisionLabel,
  type Experiment,
  type ExperimentApproval,
  type ExperimentReview,
} from "@/lib/experiments";
import type { ExperimentCandidates } from "@/lib/data/experiments";
import {
  cardClass,
  hintClass,
  inputClass,
  labelClass,
  quietButton,
  secondaryButton,
} from "@/lib/styles";

function StateNote({ state }: { state: ExperimentState }) {
  if (state.status === "error") {
    return <span className="text-danger" role="alert">{state.message}</span>;
  }
  if (state.status === "success") {
    return <span className="text-mint">{state.message}</span>;
  }
  return null;
}

function LinkSelect({
  name,
  label,
  options,
  hint,
}: {
  name: string;
  label: string;
  options: { id: string; label: string; detail: string }[];
  hint: string;
}) {
  return (
    <div>
      <label className={labelClass} htmlFor={`experiment-${name}`}>
        {label}
      </label>
      <select id={`experiment-${name}`} name={name} className={`mt-1.5 ${inputClass}`}>
        <option value="">Not linked</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label} — {option.detail}
          </option>
        ))}
      </select>
      <p className={hintClass}>{hint}</p>
    </div>
  );
}

export function ExperimentCreateForm({
  workspaceId,
  candidates,
  defaultReviewAt,
}: {
  workspaceId: string;
  candidates: ExperimentCandidates;
  defaultReviewAt: string;
}) {
  const [state, formAction] = useActionState(createExperimentAction, idleExperimentState);

  return (
    <form action={formAction} className={cardClass}>
      <h2 className="text-lg font-bold">Start a bounded experiment</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Write the question before you build. The original question and hypothesis
        are kept unchanged, and the review is recorded separately.
      </p>
      <input type="hidden" name="workspace_id" value={workspaceId} />

      <div className="mt-4 space-y-4">
        <div>
          <label className={labelClass} htmlFor="experiment-question">
            Question
          </label>
          <input
            id="experiment-question"
            name="question"
            required
            minLength={8}
            maxLength={300}
            placeholder="Could this tool help a particular group?"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="experiment-hypothesis">
            Hypothesis
          </label>
          <textarea
            id="experiment-hypothesis"
            name="hypothesis"
            required
            minLength={8}
            maxLength={2000}
            rows={2}
            placeholder="If we do this, we expect to observe…"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="experiment-target">
            Target users or affected stakeholders
          </label>
          <input
            id="experiment-target"
            name="target_users"
            required
            minLength={5}
            maxLength={1000}
            placeholder="Who would take part, and who would be affected?"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="experiment-evidence">
            Evidence already available
          </label>
          <textarea
            id="experiment-evidence"
            name="evidence_available"
            rows={2}
            maxLength={4000}
            placeholder="What you already know, and where it came from. Say plainly if there is none."
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="experiment-assumptions">
            Assumptions
          </label>
          <textarea
            id="experiment-assumptions"
            name="assumptions"
            rows={2}
            maxLength={4000}
            placeholder="One per line. What has to be true for this test to mean anything?"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="experiment-prototype">
            Proposed prototype
          </label>
          <textarea
            id="experiment-prototype"
            name="proposed_prototype"
            required
            minLength={5}
            maxLength={2000}
            rows={2}
            placeholder="The smallest workflow that would test the question."
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="experiment-success">
              Success criteria
            </label>
            <textarea
              id="experiment-success"
              name="success_criteria"
              required
              minLength={5}
              maxLength={2000}
              rows={2}
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="experiment-failure">
              Failure criteria
            </label>
            <textarea
              id="experiment-failure"
              name="failure_criteria"
              required
              minLength={5}
              maxLength={2000}
              rows={2}
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="experiment-time">
              Time limit (minutes)
            </label>
            <input
              id="experiment-time"
              name="time_limit_minutes"
              type="number"
              min={15}
              max={10080}
              defaultValue={120}
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="experiment-resources">
              Resource limit
            </label>
            <input
              id="experiment-resources"
              name="resource_limit"
              maxLength={1000}
              placeholder="e.g. one person, no paid ads"
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
        </div>
        <div>
          <label className={labelClass} htmlFor="experiment-privacy">
            Privacy requirements
          </label>
          <textarea
            id="experiment-privacy"
            name="privacy_requirements"
            required
            minLength={5}
            maxLength={2000}
            rows={2}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="experiment-consent">
            Consent requirements
          </label>
          <textarea
            id="experiment-consent"
            name="consent_requirements"
            required
            minLength={5}
            maxLength={2000}
            rows={2}
            placeholder="How will you explain the test and ask for voluntary consent?"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="experiment-stop">
            Stop conditions
          </label>
          <textarea
            id="experiment-stop"
            name="stop_conditions"
            required
            minLength={5}
            maxLength={2000}
            rows={2}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="experiment-ai">
            AI disclosure for participants
          </label>
          <textarea
            id="experiment-ai"
            name="ai_disclosure"
            minLength={10}
            maxLength={1000}
            rows={2}
            defaultValue="Tell participants which parts are AI-assisted and which are written by a person."
            className={`mt-1.5 ${inputClass}`}
          />
          <p className={hintClass}>{EXPERIMENT_NOTES.aiDisclosure}</p>
        </div>
        <div>
          <label className={labelClass} htmlFor="experiment-review-at">
            Review date
          </label>
          <input
            id="experiment-review-at"
            name="review_at"
            type="date"
            required
            defaultValue={defaultReviewAt}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>

        <fieldset className="border-t border-line pt-4">
          <legend className="text-sm font-bold">Reuse existing records</legend>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Linking is optional and explicit. It never creates another record or
            grants access to it.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <LinkSelect
              name="mission_id"
              label="Mission"
              options={candidates.missions}
              hint="A mission in this workspace."
            />
            <LinkSelect
              name="future_path_id"
              label="Future path"
              options={candidates.futurePaths}
              hint="A scenario plan you own."
            />
            <LinkSelect
              name="radar_signal_id"
              label="Radar signal"
              options={candidates.radarSignals}
              hint="A recorded signal you own."
            />
            <LinkSelect
              name="learning_goal_id"
              label="Learning goal"
              options={candidates.learningGoals}
              hint="A goal with a learning plan."
            />
            <LinkSelect
              name="outcome_review_id"
              label="Outcome review"
              options={candidates.outcomeReviews}
              hint="An earlier review you own."
            />
          </div>
        </fieldset>

        <div className="rounded-2xl border border-brand/40 bg-brand-soft/30 p-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="high_stakes" value="yes" className="mt-1" />
            <span>
              This involves medical, legal, financial, safety, crisis or
              work-with-minors decisions.
            </span>
          </label>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {EXPERIMENT_NOTES.highStakes}
          </p>
        </div>

        <p className="text-xs leading-relaxed text-muted">
          {EXPERIMENT_NOTES.voluntary} {EXPERIMENT_NOTES.noFabrication}
        </p>

        <div>
          <SubmitButton className={secondaryButton} pendingLabel="Saving…">
            Save experiment
          </SubmitButton>
          <p className="mt-2 text-sm">
            <StateNote state={state} />
          </p>
        </div>
      </div>
    </form>
  );
}

export function ExperimentObservationForm({
  workspaceId,
  experimentId,
}: {
  workspaceId: string;
  experimentId: string;
}) {
  const [state, formAction] = useActionState(
    addExperimentObservationAction,
    idleExperimentState,
  );

  return (
    <form action={formAction} className={cardClass}>
      <h3 className="text-sm font-bold">Append an observation</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Label a participant opinion as an opinion. Do not record it as a measured
        outcome. Observations cannot be edited or deleted later.
      </p>
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="experiment_id" value={experimentId} />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="experiment-observation-kind">
            Kind
          </label>
          <select
            id="experiment-observation-kind"
            name="kind"
            className={`mt-1.5 ${inputClass}`}
          >
            {EXPERIMENT_OBSERVATION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {OBSERVATION_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="experiment-observation-source">
            Source (optional)
          </label>
          <input
            id="experiment-observation-source"
            name="source"
            maxLength={300}
            placeholder="e.g. session notes, test run 2"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="experiment-observation-text">
            What happened
          </label>
          <textarea
            id="experiment-observation-text"
            name="text"
            required
            minLength={5}
            maxLength={4000}
            rows={3}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
      </div>
      <div className="mt-3">
        <SubmitButton className={secondaryButton} pendingLabel="Appending…">
          Append observation
        </SubmitButton>
        <span className="ml-2 text-sm">
          <StateNote state={state} />
        </span>
      </div>
    </form>
  );
}

export function ExperimentFeedbackForm({
  workspaceId,
  experimentId,
}: {
  workspaceId: string;
  experimentId: string;
}) {
  const [state, formAction] = useActionState(
    addExperimentFeedbackAction,
    idleExperimentState,
  );

  return (
    <form action={formAction} className={cardClass}>
      <h3 className="text-sm font-bold">Record consented feedback</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Consent is a required condition, not a checkbox added afterwards. Do not
        paste a real quote unless the person agreed to it. {EXPERIMENT_NOTES.consent}
      </p>
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="experiment_id" value={experimentId} />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="experiment-feedback-kind">
            Kind
          </label>
          <select
            id="experiment-feedback-kind"
            name="kind"
            className={`mt-1.5 ${inputClass}`}
          >
            {EXPERIMENT_FEEDBACK_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {kind === "opinion" ? "Participant opinion" : "Measured feedback"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="experiment-feedback-reference">
            Participant reference (optional)
          </label>
          <input
            id="experiment-feedback-reference"
            name="participant_reference"
            maxLength={120}
            placeholder="e.g. Participant 2, not a real name"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="experiment-feedback-text">
            What they said, or what was measured
          </label>
          <textarea
            id="experiment-feedback-text"
            name="text"
            required
            minLength={5}
            maxLength={2000}
            rows={3}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="experiment-feedback-consent">
            Consent note
          </label>
          <input
            id="experiment-feedback-consent"
            name="consent_note"
            maxLength={1000}
            placeholder="How and when consent was recorded"
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
      </div>
      <div className="mt-3 space-y-2 text-sm">
        <label className="flex items-start gap-2">
          <input type="checkbox" name="consent_confirmed" value="yes" className="mt-1" />
          <span>This person gave voluntary, informed consent to record this.</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="identifiable" value="yes" className="mt-1" />
          <span>This could identify the person.</span>
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="permission_to_quote" value="yes" className="mt-1" />
          <span>They gave explicit permission to quote this text.</span>
        </label>
      </div>
      <div className="mt-3">
        <SubmitButton className={secondaryButton} pendingLabel="Saving…">
          Save consented feedback
        </SubmitButton>
        <span className="ml-2 text-sm">
          <StateNote state={state} />
        </span>
      </div>
    </form>
  );
}

export function ExperimentApprovalRequestForm({
  workspaceId,
  experimentId,
}: {
  workspaceId: string;
  experimentId: string;
}) {
  const [state, formAction] = useActionState(
    requestExperimentApprovalAction,
    idleExperimentState,
  );

  return (
    <form action={formAction} className={cardClass}>
      <h3 className="text-sm font-bold">Request a separate approval</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Real outreach, publication, paid activity and deployment each need their
        own decision. A different owner or admin must decide, and an approval
        performs no action.
      </p>
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="experiment_id" value={experimentId} />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="experiment-approval-kind">
            Kind
          </label>
          <select
            id="experiment-approval-kind"
            name="kind"
            className={`mt-1.5 ${inputClass}`}
          >
            {EXPERIMENT_APPROVAL_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {approvalKindLabel(kind)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="experiment-approval-summary">
            Summary
          </label>
          <input
            id="experiment-approval-summary"
            name="summary"
            required
            minLength={5}
            maxLength={500}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="experiment-approval-scope">
            Exactly what would change
          </label>
          <textarea
            id="experiment-approval-scope"
            name="scope"
            required
            minLength={5}
            maxLength={2000}
            rows={2}
            className={`mt-1.5 ${inputClass}`}
          />
          <p className={hintClass}>
            {EXPERIMENT_APPROVAL_KINDS.filter((kind) => kind !== "high_stakes")
              .map((kind) => `${approvalKindLabel(kind)}: ${APPROVAL_KIND_NOTES[kind]}`)
              .join(" ")}
          </p>
        </div>
      </div>
      <div className="mt-3">
        <SubmitButton className={secondaryButton} pendingLabel="Requesting…">
          Request approval
        </SubmitButton>
        <span className="ml-2 text-sm">
          <StateNote state={state} />
        </span>
      </div>
    </form>
  );
}

export function ExperimentApprovalDecisionForm({
  workspaceId,
  experimentId,
  approval,
}: {
  workspaceId: string;
  experimentId: string;
  approval: ExperimentApproval;
}) {
  const [state, formAction] = useActionState(
    decideExperimentApprovalAction,
    idleExperimentState,
  );

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2 border-t border-line pt-2">
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="experiment_id" value={experimentId} />
      <input type="hidden" name="approval_id" value={approval.id} />
      <div className="min-w-[12rem] flex-1">
        <label className={labelClass} htmlFor={`experiment-approval-note-${approval.id}`}>
          Decision note
        </label>
        <input
          id={`experiment-approval-note-${approval.id}`}
          name="note"
          maxLength={1000}
          className={`mt-1 ${inputClass}`}
        />
      </div>
      <button type="submit" name="decision" value="approved" className={secondaryButton}>
        Approve
      </button>
      <button type="submit" name="decision" value="rejected" className={quietButton}>
        Reject
      </button>
      <span className="text-xs">
        <StateNote state={state} />
      </span>
    </form>
  );
}

export function ExperimentPrototypeForm({
  workspaceId,
  experiment,
}: {
  workspaceId: string;
  experiment: Experiment;
}) {
  const [state, formAction] = useActionState(
    approveExperimentPrototypeAction,
    idleExperimentState,
  );

  return (
    <form action={formAction} className={cardClass}>
      <h3 className="text-sm font-bold">Approve a prototype</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        This creates an ordinary app-builder project from the recorded question.
        It does not generate files, run code, deploy or publish. Approve the
        specification and use the existing sandbox and deployment approvals afterwards.
      </p>
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="experiment_id" value={experiment.id} />
      <div className="mt-3">
        <SubmitButton className={secondaryButton} pendingLabel="Creating project…">
          Approve prototype and create app project
        </SubmitButton>
        <span className="ml-2 text-sm">
          <StateNote state={state} />
        </span>
      </div>
    </form>
  );
}

export function ExperimentReviewForm({
  workspaceId,
  experimentId,
  review,
}: {
  workspaceId: string;
  experimentId: string;
  review: ExperimentReview | null;
}) {
  const [state, formAction] = useActionState(
    saveExperimentReviewAction,
    idleExperimentState,
  );
  const decided = review !== null && review.decision !== "undecided";

  return (
    <form action={formAction} className={cardClass}>
      <h3 className="text-sm font-bold">Outcome review</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        The original hypothesis is above and cannot be rewritten. Record what
        happened, not what you hoped would happen. A deployed prototype is not
        evidence of social benefit.
      </p>
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input type="hidden" name="experiment_id" value={experimentId} />

      <div className="mt-4 space-y-3">
        {[
          ["built", "What was built", review?.built ?? ""],
          ["observed", "What was observed", review?.observed ?? ""],
          ["failed", "What failed", review?.failed ?? ""],
          ["unknown", "What remains unknown", review?.unknown ?? ""],
        ].map(([name, label, value]) => (
          <div key={name}>
            <label className={labelClass} htmlFor={`experiment-review-${name}`}>
              {label}
            </label>
            <textarea
              id={`experiment-review-${name}`}
              name={name}
              rows={2}
              maxLength={3000}
              defaultValue={value}
              className={`mt-1.5 ${inputClass}`}
            />
          </div>
        ))}
        <div>
          <label className={labelClass} htmlFor="experiment-review-decision">
            Decision
          </label>
          <select
            id="experiment-review-decision"
            name="decision"
            defaultValue={review?.decision ?? "undecided"}
            className={`mt-1.5 ${inputClass}`}
          >
            {EXPERIMENT_DECISIONS.map((decision) => (
              <option key={decision} value={decision}>
                {decisionLabel(decision)}
              </option>
            ))}
          </select>
          <p className={hintClass}>
            Continue, revise or stop. A decision is recorded by a person and cannot be rewritten.
          </p>
        </div>
        <div>
          <label className={labelClass} htmlFor="experiment-review-note">
            Decision note
          </label>
          <textarea
            id="experiment-review-note"
            name="decision_note"
            rows={2}
            maxLength={3000}
            defaultValue={review?.decision_note ?? ""}
            className={`mt-1.5 ${inputClass}`}
          />
        </div>
      </div>

      <div className="mt-3">
        <SubmitButton className={secondaryButton} pendingLabel="Saving…" disabled={decided}>
          {decided ? "Review decided" : "Save review and decision"}
        </SubmitButton>
        <span className="ml-2 text-sm">
          <StateNote state={state} />
        </span>
      </div>
    </form>
  );
}
