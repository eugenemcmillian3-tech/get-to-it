import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ApproveContractForm,
  CheckpointForm,
  DecideCheckpointForm,
  EvidenceForm,
  GeneratePlanForm,
  LifecycleForm,
  PrototypeForm,
  ReviewForm,
  SubmitContractForm,
  TaskActions,
} from "@/components/orchestration-forms";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { getOrchestrationDetail } from "@/lib/data/orchestration";
import { getIdentity } from "@/lib/identity";
import {
  BUDGET_NOTE,
  CHECKPOINT_LABELS,
  DELIVERABLE_KIND_LABELS,
  EVIDENCE_KIND_LABELS,
  EVIDENCE_INPUT_NOTE,
  EXTERNAL_ACTION_LABELS,
  NO_FABRICATION_NOTE,
  ORCHESTRATION_STATUS_LABELS,
  ORIGIN_LABELS,
  OUTCOME_REVIEW_NOTE,
  TASK_STATUS_LABELS,
  UNCERTAIN_ACTION_NOTE,
  VERIFICATION_METHOD_LABELS,
  VERIFICATION_NOTE,
  approvalCoversContract,
  budgetSnapshot,
  canManageOrchestration,
  capabilityLabel,
  criterionStates,
  formatCredits,
  formatMicrosUsd,
  nextStepHint,
  outcomeSummary,
  readyTasks,
  type CriterionState,
  type EvidenceKind,
  type EvidenceRecord,
  type ExternalActionKind,
  type TaskState,
} from "@/lib/orchestration";
import { cardClass, chipClass, secondaryButton } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { memberLabel } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Orchestration — GET TO IT" };

export default async function OrchestrationPage({
  params,
}: {
  params: Promise<{ workspaceId: string; orchestrationId: string }>;
}) {
  const { workspaceId, orchestrationId } = await params;
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const [identity, detail] = await Promise.all([
    getIdentity(session),
    getOrchestrationDetail(session, workspaceId, orchestrationId),
  ]);
  if (!detail) notFound();

  const {
    orchestration,
    currentContract,
    approvedContract,
    contracts,
    tasks,
    evidence,
    checkpoints,
    events,
    review,
    linked,
    prototype,
    members,
    myRole,
  } = detail;

  const canManage = canManageOrchestration(myRole);
  const budget = budgetSnapshot({
    authorizedMicros: orchestration.authorized_micros,
    reservedMicros: orchestration.reserved_micros,
    consumedMicros: orchestration.consumed_micros,
  });

  const criteria = currentContract?.content.acceptance_criteria ?? [];
  const evidenceRecords: EvidenceRecord[] = evidence.map((row) => ({
    id: row.id,
    criterion_key: row.criterion_key,
    kind: row.kind as EvidenceKind,
    source_ref: row.source_ref,
    artifact_version: row.artifact_version,
    method: row.method,
    result: row.result,
    limitations: row.limitations,
    verifier: row.verifier,
    observed_at: row.observed_at,
  }));
  const states: CriterionState[] = criterionStates({
    criteria,
    evidence: evidenceRecords,
  });
  const taskStates: (TaskState & {
    external_action_kind?: ExternalActionKind | null;
  })[] = tasks.map((task) => ({
    task_key: task.task_key,
    depends_on: task.depends_on,
    status: task.status,
    attempts: task.attempts,
    retry_limit: task.retry_limit,
    external_action_kind: task.external_action_kind as ExternalActionKind | null,
  }));
  const ready = readyTasks(taskStates);
  const unverified = states.filter((state) => state.state !== "verified").length;
  const summary = currentContract
    ? outcomeSummary({
        contract: currentContract.content,
        approvedVersion: approvedContract?.version ?? null,
        tasks: taskStates,
        criteria: states,
        budget,
      })
    : null;
  const approvalProblem = currentContract
    ? approvalCoversContract({
        contract: {
          id: currentContract.id,
          version: currentContract.version,
          fingerprint: currentContract.fingerprint,
          status: currentContract.status,
          content: currentContract.content,
        },
        approval: approvedContract
          ? {
              version: approvedContract.version,
              fingerprint: approvedContract.fingerprint,
              status: approvedContract.status,
              approved_by: approvedContract.approved_by,
              approved_at: approvedContract.approved_at,
            }
          : null,
      })
    : null;

  const nameOf = (userId: string | null): string => {
    if (!userId) return "Unassigned";
    const member = members.find((entry) => entry.user_id === userId);
    return member ? memberLabel(member) : "A former member";
  };

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-5xl px-5 pb-16 pt-6">
        <Link
          href={`/workspace/${workspaceId}/orchestrations`}
          className="rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink"
        >
          ← All orchestrations
        </Link>

        <header className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">
            Orchestration
          </p>
          <h1 className="mt-1 max-w-4xl text-3xl font-black leading-tight tracking-tight sm:text-4xl">
            {orchestration.goal}
          </h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className={chipClass}>
              {ORCHESTRATION_STATUS_LABELS[orchestration.status]}
            </span>
            <span className={chipClass}>
              {ORIGIN_LABELS[orchestration.origin_kind]}
            </span>
            <span className={chipClass}>Review {orchestration.review_at}</span>
            <span className={chipClass}>
              {formatCredits(budget.consumed)} of {formatCredits(budget.authorized)} used
            </span>
            {orchestration.prototype_project_id ? (
              <span className={chipClass}>Prototype linked</span>
            ) : null}
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
            {nextStepHint({
              status: orchestration.status,
              hasContractApproval: Boolean(approvedContract),
              ready,
              unverified,
            })}
          </p>
        </header>

        <section aria-labelledby="origin-heading" className="mt-8">
          <h2 id="origin-heading" className="text-xl font-bold">
            Where this came from
          </h2>
          <div className={`${cardClass} mt-3`}>
            <p className="text-sm">
              {linked
                ? `${linked.detail}: ${linked.label}`
                : orchestration.origin_kind === "new_goal"
                  ? "A new goal, stored as an existing-style mission."
                  : "The linked record is no longer visible to you."}
            </p>
            {prototype ? (
              <p className="mt-2 text-sm">
                Normal app-builder project:{" "}
                <Link
                  href={`/build/${prototype.id}`}
                  className="underline decoration-line underline-offset-4"
                >
                  {prototype.label}
                </Link>
                . Its sandbox, test and deployment approvals are unchanged.
              </p>
            ) : canManage ? (
              <PrototypeForm
                workspaceId={workspaceId}
                orchestrationId={orchestration.id}
              />
            ) : null}
          </div>
        </section>

        <section aria-labelledby="contract-heading" className="mt-8">
          <h2 id="contract-heading" className="text-xl font-bold">
            The outcome contract
          </h2>
          {!currentContract ? (
            <p className="mt-2 text-sm text-muted">No contract version is attached.</p>
          ) : (
            <>
              <div className={`${cardClass} mt-3`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold">
                    Version {currentContract.version} ·{" "}
                    {currentContract.status === "approved"
                      ? "approved"
                      : currentContract.status === "superseded"
                        ? "superseded"
                        : "draft"}
                  </p>
                  <p className="font-mono text-xs text-muted">
                    {currentContract.fingerprint.slice(0, 12)}
                  </p>
                </div>
                <p className="mt-2 text-sm">
                  <span className="font-semibold">Scope:</span>{" "}
                  {currentContract.content.scope}
                </p>
                <p className="mt-1 text-sm">
                  <span className="font-semibold">Stakeholders:</span>{" "}
                  {currentContract.content.stakeholders}
                </p>
                <div className="mt-3">
                  <h3 className="text-sm font-bold">Intended outcomes</h3>
                  <ul className="mt-1 space-y-1">
                    {currentContract.content.deliverables.map((deliverable) => (
                      <li key={deliverable.key} className="text-sm text-muted">
                        <span className="font-semibold text-ink">
                          {DELIVERABLE_KIND_LABELS[deliverable.kind]}:
                        </span>{" "}
                        {deliverable.statement}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mt-3">
                  <h3 className="text-sm font-bold">Acceptance criteria</h3>
                  <ul className="mt-1 space-y-1">
                    {currentContract.content.acceptance_criteria.map((criterion) => {
                      const state = states.find((entry) => entry.key === criterion.key);
                      return (
                        <li key={criterion.key} className="text-sm text-muted">
                          {criterion.criterion} ·{" "}
                          {VERIFICATION_METHOD_LABELS[criterion.verification]} ·{" "}
                          <span className="font-semibold text-ink">
                            {state?.state ?? "unverified"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-2">
                  <p>Exclusions: {currentContract.content.exclusions.join("; ")}</p>
                  <p>Stop conditions: {currentContract.content.stop_conditions}</p>
                  <p>Privacy: {currentContract.content.privacy_constraints}</p>
                  <p>Consent: {currentContract.content.consent_constraints}</p>
                  <p>Tools: {currentContract.content.allowed_tools.join(", ")}</p>
                  <p>
                    Environments: {currentContract.content.execution_environments.join(", ")}
                  </p>
                  <p>Time limit: {currentContract.content.time_limit_minutes} minutes</p>
                  <p>Resource limits: {currentContract.content.resource_limits || "None recorded"}</p>
                </div>
                <p className="mt-3 text-xs text-muted">
                  Evidence available: {currentContract.content.evidence_available || "None recorded."}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Unresolved: {currentContract.content.unresolved_questions || "Nothing recorded."}
                </p>
              </div>

              <div className={`${cardClass} mt-3`}>
                <p className="text-sm font-semibold">
                  {approvalProblem?.ok
                    ? `Approved: version ${approvedContract?.version} by ${nameOf(approvedContract?.approved_by ?? null)}`
                    : approvalProblem?.message}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Approval is bound to this exact version and fingerprint. A
                  material change needs a new approval, and contract approval never
                  replaces the separate approval each external action needs.
                </p>
                {orchestration.status === "draft" && canManage ? (
                  <div className="mt-3">
                    <SubmitContractForm
                      workspaceId={workspaceId}
                      orchestrationId={orchestration.id}
                    />
                  </div>
                ) : null}
                {orchestration.status === "awaiting_approval" && canManage ? (
                  <ApproveContractForm
                    workspaceId={workspaceId}
                    orchestrationId={orchestration.id}
                    contract={currentContract}
                  />
                ) : null}
              </div>
            </>
          )}
        </section>

        <section aria-labelledby="budget-heading" className="mt-8">
          <h2 id="budget-heading" className="text-xl font-bold">
            Budget and usage
          </h2>
          <div className={`${cardClass} mt-3 text-sm`}>
            <p>
              Authorized {formatCredits(budget.authorized)} (
              {formatMicrosUsd(budget.authorized)}) · reserved{" "}
              {formatCredits(budget.reserved)} · consumed {formatCredits(budget.consumed)} (
              {formatMicrosUsd(budget.consumed)})
            </p>
            <p className="mt-1 text-muted">
              Available {formatCredits(Math.max(budget.available, 0))}.{" "}
              {budget.overCommitted ? "Reserved plus consumed exceeds the maximum." : null}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted">{BUDGET_NOTE}</p>
          </div>
        </section>

        <section aria-labelledby="plan-heading" className="mt-8">
          <h2 id="plan-heading" className="text-xl font-bold">
            Bounded plan
          </h2>
          {tasks.length === 0 ? (
            <div className={`${cardClass} mt-3`}>
              <p className="text-sm text-muted">
                No plan yet. A plan becomes tasks inside the approved maximum and
                never adds scope, tools, recipients or spending.
              </p>
              {canManage ? (
                <div className="mt-3">
                  <GeneratePlanForm
                    workspaceId={workspaceId}
                    orchestrationId={orchestration.id}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {tasks.map((task) => (
                <li key={task.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold">{task.title}</p>
                      <p className="mt-1 text-xs text-muted">{task.purpose}</p>
                    </div>
                    <span className={chipClass}>{TASK_STATUS_LABELS[task.status]}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    <span className={chipClass}>
                      {capabilityLabel(task.capability as never)}
                    </span>
                    <span className={chipClass}>
                      {formatCredits(task.credits_micros)}
                    </span>
                    <span className={chipClass}>
                      {VERIFICATION_METHOD_LABELS[task.verification_method as never]}
                    </span>
                    <span className={chipClass}>
                      {task.attempts}/{task.retry_limit + 1} attempts
                    </span>
                    {task.depends_on.length > 0 ? (
                      <span className={chipClass}>
                        after {task.depends_on.join(", ")}
                      </span>
                    ) : null}
                    {task.external_action_kind ? (
                      <span className={chipClass}>
                        {EXTERNAL_ACTION_LABELS[task.external_action_kind as never]}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    Expected output: {task.expected_output}
                  </p>
                  {task.covers.length > 0 ? (
                    <p className="mt-1 text-xs text-muted">
                      Covers: {task.covers.join(", ")}
                    </p>
                  ) : null}
                  {task.last_error ? (
                    <p className="mt-1 text-xs text-danger">{task.last_error}</p>
                  ) : null}
                  {canManage ? (
                    <TaskActions
                      workspaceId={workspaceId}
                      orchestrationId={orchestration.id}
                      task={task}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="lifecycle-heading" className="mt-8">
          <h2 id="lifecycle-heading" className="text-xl font-bold">
            Lifecycle
          </h2>
          <div className={`${cardClass} mt-3`}>
            <p className="text-xs text-muted">
              Valid moves are enforced on the server. A mission is not completed
              because an agent says it is finished.
            </p>
            {canManage ? (
              <div className="mt-3">
                <LifecycleForm
                  workspaceId={workspaceId}
                  orchestrationId={orchestration.id}
                />
              </div>
            ) : null}
            <p className="mt-2 text-xs text-muted">{UNCERTAIN_ACTION_NOTE}</p>
          </div>
        </section>

        <section aria-labelledby="evidence-heading" className="mt-8">
          <h2 id="evidence-heading" className="text-xl font-bold">
            Evidence
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {EVIDENCE_INPUT_NOTE} {VERIFICATION_NOTE} {NO_FABRICATION_NOTE}
          </p>
          {evidence.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No evidence recorded yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {evidence.map((entry) => (
                <li key={entry.id} className={cardClass}>
                  <p className="text-sm">
                    <span className="font-semibold">
                      {EVIDENCE_KIND_LABELS[entry.kind as EvidenceKind]}
                    </span>{" "}
                    · {entry.result} · {entry.method}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {entry.source_ref}
                    {entry.criterion_key ? ` · covers ${entry.criterion_key}` : ""}
                    {entry.artifact_version ? ` · ${entry.artifact_version}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Verified by {entry.verifier}
                    {entry.limitations ? ` · limitations: ${entry.limitations}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {canManage && currentContract ? (
            <EvidenceForm
              workspaceId={workspaceId}
              orchestrationId={orchestration.id}
              tasks={tasks}
              criteria={criteria.map((criterion) => ({
                key: criterion.key,
                criterion: criterion.criterion,
              }))}
            />
          ) : null}
        </section>

        <section aria-labelledby="checkpoints-heading" className="mt-8">
          <h2 id="checkpoints-heading" className="text-xl font-bold">
            Human decision checkpoints
          </h2>
          {checkpoints.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              None recorded. External actions, missing consent, budget shortfalls
              and stop conditions each pause here for a person.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {checkpoints.map((checkpoint) => (
                <li key={checkpoint.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-sm font-bold">{checkpoint.title}</p>
                    <span className={chipClass}>
                      {checkpoint.status === "pending"
                        ? "Awaiting a decision"
                        : checkpoint.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {CHECKPOINT_LABELS[checkpoint.kind as never]}: {checkpoint.what_happened}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    Decision required: {checkpoint.decision}
                  </p>
                  {checkpoint.implication ? (
                    <p className="mt-1 text-xs text-muted">{checkpoint.implication}</p>
                  ) : null}
                  {checkpoint.status === "pending" && canManage ? (
                    <DecideCheckpointForm
                      workspaceId={workspaceId}
                      orchestrationId={orchestration.id}
                      checkpoint={checkpoint}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canManage ? (
            <div className={`${cardClass} mt-3`}>
              <CheckpointForm
                workspaceId={workspaceId}
                orchestrationId={orchestration.id}
                taskKey={ready[0] ?? tasks[0]?.task_key ?? "plan"}
              />
            </div>
          ) : null}
        </section>

        <section aria-labelledby="review-heading" className="mt-8">
          <h2 id="review-heading" className="text-xl font-bold">
            Outcome review
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">{OUTCOME_REVIEW_NOTE}</p>
          {summary ? (
            <div className={`${cardClass} mt-3 text-sm`}>
              <p>
                <span className="font-semibold">Original goal:</span> {summary.original_goal}
              </p>
              <p className="mt-1">
                <span className="font-semibold">Approved scope:</span> {summary.approved_scope} (version{" "}
                {summary.approved_version ?? "none"})
              </p>
              <p className="mt-1">
                <span className="font-semibold">Produced:</span>{" "}
                {summary.produced.join(", ") || "Nothing produced yet."}
              </p>
              <p className="mt-1">
                <span className="font-semibold">Verified:</span>{" "}
                {summary.verified.join(", ") || "Nothing verified yet."}
              </p>
              <p className="mt-1">
                <span className="font-semibold">Failed:</span>{" "}
                {summary.failed.join(", ") || "Nothing recorded as failed."}
              </p>
              <p className="mt-1">
                <span className="font-semibold">Still unknown:</span> {summary.unknown}
              </p>
              <p className="mt-1">
                <span className="font-semibold">Actual consumption:</span>{" "}
                {formatCredits(summary.spent_micros)} ({summary.spent_usd})
              </p>
              <p className="mt-2 text-xs text-muted">{summary.note}</p>
            </div>
          ) : null}
          <ReviewForm
            workspaceId={workspaceId}
            orchestrationId={orchestration.id}
            review={review}
            canDecide={canManage}
          />
        </section>

        <section aria-labelledby="history-heading" className="mt-8">
          <h2 id="history-heading" className="text-xl font-bold">
            History
          </h2>
          {events.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No events recorded.</p>
          ) : (
            <ul className="mt-3 space-y-1 text-xs text-muted">
              {events.map((event) => (
                <li key={event.id}>
                  {new Date(event.created_at).toISOString().slice(0, 16).replace("T", " ")} ·{" "}
                  {event.kind} · {event.detail}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">
            Contract versions on file: {contracts.length}. Earlier versions stay
            visible so a changed scope cannot quietly replace what was approved.
          </p>
          <p className="mt-4">
            <Link
              href={`/workspace/${workspaceId}/orchestrations`}
              className={secondaryButton}
            >
              Back to orchestration
            </Link>
          </p>
        </section>
      </main>
    </div>
  );
}
