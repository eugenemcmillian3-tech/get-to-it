"use client";

import { useActionState } from "react";
import { idleBuildState } from "@/lib/action-state";
import {
  attemptRelaxationAction,
  createImprovementCandidateAction,
  decideImprovementCandidateAction,
  evaluateImprovementCandidateAction,
} from "@/lib/actions/improvement-candidates";
import {
  CANDIDATE_KINDS,
  CANDIDATE_KIND_LABELS,
  POLICY_OPTIONS,
  PROTECTED_AUTHORITIES,
  PROTECTED_AUTHORITY_LABELS,
} from "@/lib/improvement-candidates";
import type { DeploymentOption, ProjectOption } from "@/lib/data/improvement-candidates";
import {
  cardClass,
  inputClass,
  labelClass,
  primaryButton,
  quietButton,
  secondaryButton,
} from "@/lib/styles";

function Note({ state }: { state: { status: string; message?: string } }) {
  if (state.status === "idle" || !state.message) return null;
  return (
    <p
      role="status"
      className={`mt-3 rounded-xl border px-3 py-2 text-sm ${
        state.status === "error"
          ? "border-red-300 bg-red-50 text-red-800"
          : "border-emerald-300 bg-emerald-50 text-emerald-900"
      }`}
    >
      {state.message}
    </p>
  );
}

const FIELD = [
  { name: "problem", label: "Problem", hint: "What is wrong today, in plain language." },
  { name: "evidence", label: "Evidence of the problem", hint: "Runs, cases or records that show it." },
  { name: "proposedChange", label: "Proposed change", hint: "Exactly what would change." },
  { name: "expectedBenefit", label: "Expected benefit", hint: "What should measurably improve." },
  { name: "possibleRegressions", label: "Possible regressions", hint: "What could get worse." },
  { name: "evaluationPlan", label: "Evaluation plan", hint: "How the candidate is compared with the baseline. Frozen once evaluation starts." },
  { name: "costImpact", label: "Cost impact", hint: "What it costs, and what it saves." },
  { name: "securityImplications", label: "Security implications", hint: "What it can reach that it could not before." },
  { name: "rollbackPlan", label: "Rollback plan", hint: "How to undo it, and what stays behind." },
] as const;

export function NewImprovementCandidateForm({
  workspaceId,
  projects,
}: {
  workspaceId: string;
  projects: ProjectOption[];
}) {
  const [state, action] = useActionState(createImprovementCandidateAction, idleBuildState);

  return (
    <section aria-labelledby="new-candidate-heading" className={`${cardClass} mt-8`}>
      <h2 id="new-candidate-heading" className="text-xl font-bold">
        Write a proposal
      </h2>
      <p className="mt-1 text-sm text-muted">
        Every field below is part of the record. A proposal runs in its own branch or sandbox; it
        never touches production data or credentials.
      </p>

      <form action={action} className="mt-4 grid gap-4">
        <input type="hidden" name="workspaceId" value={workspaceId} />

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1">
            <span className={labelClass}>Proposal kind</span>
            <select name="kind" className={inputClass} defaultValue="tool_policy">
              {CANDIDATE_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {CANDIDATE_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1">
            <span className={labelClass}>Candidate policy</span>
            <select name="policy" className={inputClass} defaultValue="channel-lookup">
              {POLICY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="grid gap-1">
          <span className={labelClass}>Project this proposal belongs to</span>
          <select name="projectId" className={inputClass} defaultValue={projects[0]?.id ?? ""} required>
            {projects.length === 0 ? <option value="">No project yet</option> : null}
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted">
            A promotion ships through an approved deployment of this project.
          </span>
        </label>

        <label className="grid gap-1">
          <span className={labelClass}>Title</span>
          <input name="title" className={inputClass} maxLength={160} required />
        </label>

        {FIELD.map((field) => (
          <label key={field.name} className="grid gap-1">
            <span className={labelClass}>{field.label}</span>
            <textarea
              name={field.name}
              className={`${inputClass} min-h-20`}
              maxLength={4000}
              required
            />
            <span className="text-xs text-muted">{field.hint}</span>
          </label>
        ))}

        <label className="grid gap-1">
          <span className={labelClass}>Affected components</span>
          <input
            name="affectedComponents"
            className={inputClass}
            placeholder="connector tool policy, Slack connector"
            required
          />
          <span className="text-xs text-muted">Comma separated, at most eight.</span>
        </label>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="grid gap-1">
            <span className={labelClass}>Isolation</span>
            <select name="sandboxKind" className={inputClass} defaultValue="sandbox">
              <option value="sandbox">Sandbox</option>
              <option value="branch">Branch</option>
            </select>
          </label>
          <label className="grid gap-1">
            <span className={labelClass}>Baseline</span>
            <input name="baseRef" className={inputClass} defaultValue="main" required />
          </label>
          <label className="grid gap-1">
            <span className={labelClass}>Candidate ref</span>
            <input
              name="candidateRef"
              className={inputClass}
              defaultValue="sandbox/channel-lookup"
              required
            />
          </label>
        </div>

        <fieldset className="rounded-xl border border-amber-300 bg-amber-50 p-3">
          <legend className="px-1 text-sm font-bold text-amber-900">
            Ask for extra authority (refused)
          </legend>
          <p className="text-xs text-amber-900">
            These are the boundaries. Ticking one records the attempt and refuses the proposal.
          </p>
          <div className="mt-2 grid gap-1">
            {PROTECTED_AUTHORITIES.map((authority) => (
              <label key={authority} className="flex items-start gap-2 text-sm text-amber-900">
                <input type="checkbox" name="requestedAuthorities" value={authority} className="mt-1" />
                <span>{PROTECTED_AUTHORITY_LABELS[authority]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <button type="submit" className={primaryButton}>
            Save draft
          </button>
        </div>
        <Note state={state} />
      </form>
    </section>
  );
}

export function EvaluateCandidateForm({
  workspaceId,
  candidateId,
}: {
  workspaceId: string;
  candidateId: string;
}) {
  const [state, action] = useActionState(evaluateImprovementCandidateAction, idleBuildState);

  return (
    <form action={action} className="mt-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="candidateId" value={candidateId} />
      <button type="submit" className={secondaryButton}>
        Run the evaluation
      </button>
      <Note state={state} />
    </form>
  );
}

export function DecideCandidateForm({
  workspaceId,
  candidateId,
  deployments,
}: {
  workspaceId: string;
  candidateId: string;
  deployments: DeploymentOption[];
}) {
  const [state, action] = useActionState(decideImprovementCandidateAction, idleBuildState);

  return (
    <form action={action} className="mt-3 grid gap-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="candidateId" value={candidateId} />
      <label className="grid gap-1">
        <span className={labelClass}>Review note</span>
        <textarea
          name="note"
          className={`${inputClass} min-h-16`}
          maxLength={1000}
          placeholder="What you read, what the run showed, what is left to watch and how to undo it."
        />
      </label>
      <label className="grid gap-1">
        <span className={labelClass}>Deployment to ship through (for promotion only)</span>
        <select name="deploymentId" className={inputClass} defaultValue={deployments[0]?.id ?? ""}>
          {deployments.length === 0 ? <option value="">No approved deployment yet</option> : null}
          {deployments.map((deployment) => (
            <option key={deployment.id} value={deployment.id}>
              {deployment.target} · {deployment.status.replaceAll("_", " ")} ·{" "}
              {deployment.approval_at
                ? `approved ${deployment.approval_at.slice(0, 10)}`
                : "not approved"}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted">
          Only a deployment already approved in the deployment flow can ship this change.
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="decision" value="approve" className={primaryButton}>
          Approve for promotion
        </button>
        <button type="submit" name="decision" value="reject" className={secondaryButton}>
          Reject
        </button>
        <button type="submit" name="decision" value="promote" className={secondaryButton}>
          Record promotion
        </button>
        <button type="submit" name="decision" value="cancel" className={quietButton}>
          Cancel proposal
        </button>
      </div>
      <Note state={state} />
    </form>
  );
}

export function RelaxationAttemptForm({
  workspaceId,
  candidateId,
}: {
  workspaceId: string;
  candidateId: string;
}) {
  const [state, action] = useActionState(attemptRelaxationAction, idleBuildState);

  return (
    <form action={action} className="mt-3 grid gap-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="candidateId" value={candidateId} />
      <label className="grid gap-1">
        <span className={labelClass}>Try to rewrite the evaluation plan after the results</span>
        <textarea
          name="relaxedPlan"
          className={`${inputClass} min-h-16`}
          maxLength={3000}
          placeholder="A weaker plan that would make this candidate look better."
        />
      </label>
      <div>
        <button type="submit" className={quietButton}>
          Attempt the change
        </button>
      </div>
      <Note state={state} />
    </form>
  );
}
