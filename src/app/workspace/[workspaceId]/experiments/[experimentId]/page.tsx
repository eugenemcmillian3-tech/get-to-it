import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ExperimentApprovalDecisionForm,
  ExperimentApprovalRequestForm,
  ExperimentFeedbackForm,
  ExperimentObservationForm,
  ExperimentPrototypeForm,
  ExperimentReviewForm,
} from "@/components/experiment-forms";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { getExperimentDetail } from "@/lib/data/experiments";
import {
  APPROVAL_KIND_NOTES,
  EXPERIMENT_NOTES,
  EXPERIMENT_STATUS_LABELS,
  OBSERVATION_KIND_LABELS,
  approvalKindLabel,
  approvalProblem,
  canManageExperiments,
  compareApproaches,
  decisionLabel,
  experimentReadiness,
  interviewQuestions,
  nextExperimentSuggestion,
  prototypeApprovalProblem,
  smallestPrototype,
  summarizeFeedback,
} from "@/lib/experiments";
import { getIdentity } from "@/lib/identity";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { memberLabel } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Experiment — GET TO IT" };

export default async function ExperimentPage({
  params,
}: {
  params: Promise<{ workspaceId: string; experimentId: string }>;
}) {
  const { workspaceId, experimentId } = await params;
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
    getExperimentDetail(session, workspaceId, experimentId),
  ]);
  if (!detail) notFound();

  const { experiment, observations, feedback, approvals, review, events, linked, members, myRole } =
    detail;
  const canManage = canManageExperiments(myRole);
  const readiness = experimentReadiness(experiment);
  const comparison = compareApproaches(experiment);
  const prototype = smallestPrototype(experiment);
  const questions = interviewQuestions(experiment);
  const feedbackSummary = summarizeFeedback(feedback);
  const next = nextExperimentSuggestion({ experiment, review });
  const nameOf = (userId: string | null): string => {
    if (!userId) return "Unassigned";
    const member = members.find((entry) => entry.user_id === userId);
    return member ? memberLabel(member) : "A former member";
  };
  const links = [
    ["Mission", linked.mission],
    ["Future path", linked.futurePath],
    ["Radar signal", linked.radarSignal],
    ["Learning goal", linked.learningGoal],
    ["Earlier outcome review", linked.outcomeReview],
    ["Prototype project", linked.project],
  ].filter((entry): entry is [string, NonNullable<typeof linked.mission>] =>
    Boolean(entry[1]),
  );
  const prototypeProblem = prototypeApprovalProblem({
    experiment,
    role: myRole,
    hasProject: true,
  });

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-5xl px-5 pb-16 pt-6">
        <Link
          href={`/workspace/${workspaceId}/experiments`}
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← All experiments
        </Link>

        <header className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">
            Experiment
          </p>
          <h1 className="mt-1 max-w-4xl text-3xl font-black leading-tight tracking-tight sm:text-4xl">
            {experiment.question}
          </h1>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
            <span className={chipClass}>{EXPERIMENT_STATUS_LABELS[experiment.status]}</span>
            <span className={chipClass}>Review {experiment.review_at}</span>
            <span className={chipClass}>{experiment.time_limit_minutes} min limit</span>
            <span className={chipClass}>Created by {nameOf(experiment.created_by)}</span>
            {experiment.prototype_project_id ? (
              <span className={chipClass}>Prototype approved</span>
            ) : (
              <span className={chipClass}>No prototype yet</span>
            )}
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
            {EXPERIMENT_NOTES.aiDisclosure} {EXPERIMENT_NOTES.voluntary}
          </p>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
            {EXPERIMENT_NOTES.highStakes}
          </p>
        </header>

        <section aria-labelledby="record-heading" className="mt-8">
          <h2 id="record-heading" className="text-xl font-bold">
            The bounded record
          </h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className={cardClass}>
              <h3 className="text-sm font-bold">Original hypothesis</h3>
              <p className="mt-2 whitespace-pre-line text-sm text-muted">{experiment.hypothesis}</p>
              <p className="mt-2 text-xs text-muted">
                This is preserved. The review cannot rewrite it.
              </p>
            </div>
            <div className={cardClass}>
              <h3 className="text-sm font-bold">Target users or affected stakeholders</h3>
              <p className="mt-2 whitespace-pre-line text-sm text-muted">{experiment.target_users}</p>
            </div>
            <div className={cardClass}>
              <h3 className="text-sm font-bold">Evidence already available</h3>
              <p className="mt-2 whitespace-pre-line text-sm text-muted">
                {experiment.evidence_available || "None recorded."}
              </p>
            </div>
            <div className={cardClass}>
              <h3 className="text-sm font-bold">Assumptions</h3>
              <p className="mt-2 whitespace-pre-line text-sm text-muted">
                {experiment.assumptions || "None recorded."}
              </p>
            </div>
            <div className={cardClass}>
              <h3 className="text-sm font-bold">Proposed prototype</h3>
              <p className="mt-2 whitespace-pre-line text-sm text-muted">
                {experiment.proposed_prototype}
              </p>
            </div>
            <div className={cardClass}>
              <h3 className="text-sm font-bold">Limits</h3>
              <p className="mt-2 text-sm text-muted">
                {experiment.time_limit_minutes} minutes ·{" "}
                {experiment.resource_limit || "no resource limit recorded"}
              </p>
              <p className="mt-2 text-sm">
                <span className="font-semibold">Success: </span>
                {experiment.success_criteria}
              </p>
              <p className="mt-1 text-sm">
                <span className="font-semibold">Failure: </span>
                {experiment.failure_criteria}
              </p>
            </div>
            <div className={cardClass}>
              <h3 className="text-sm font-bold">Privacy and consent</h3>
              <p className="mt-2 text-sm text-muted">{experiment.privacy_requirements}</p>
              <p className="mt-1 text-sm text-muted">{experiment.consent_requirements}</p>
            </div>
            <div className={cardClass}>
              <h3 className="text-sm font-bold">Stop conditions</h3>
              <p className="mt-2 whitespace-pre-line text-sm text-muted">
                {experiment.stop_conditions}
              </p>
            </div>
            <div className={`${cardClass} md:col-span-2`}>
              <h3 className="text-sm font-bold">AI disclosure shown to participants</h3>
              <p className="mt-2 text-sm text-muted">{experiment.ai_disclosure}</p>
            </div>
            <div className={cardClass}>
              <h3 className="text-sm font-bold">Linked records</h3>
              {links.length === 0 ? (
                <p className="mt-2 text-sm text-muted">Nothing linked. This experiment stands alone.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm">
                  {links.map(([label, item]) => (
                    <li key={`${label}-${item.id}`}>
                      <span className="font-medium">{label}:</span> {item.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className={cardClass}>
              <h3 className="text-sm font-bold">Review decision</h3>
              <p className="mt-2 text-sm">
                {review ? decisionLabel(review.decision) : "Not recorded yet"}
              </p>
              {review?.decision_note ? (
                <p className="mt-1 whitespace-pre-line text-sm text-muted">{review.decision_note}</p>
              ) : null}
              <p className="mt-2 text-xs text-muted">
                Decided by {review?.decided_by ? nameOf(review.decided_by) : "a person not yet recorded"}.
              </p>
            </div>
          </div>
        </section>

        <section aria-labelledby="assistant-heading" className="mt-10">
          <h2 id="assistant-heading" className="text-xl font-bold">
            Planning assistant
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            These suggestions use the recorded fields and fixed rules; no model
            is called and nothing is invented. Treat them as questions to check,
            not conclusions.
          </p>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className={cardClass}>
              <h3 className="text-sm font-bold">Missing evidence or decisions</h3>
              {readiness.missing.length === 0 ? (
                <p className="mt-2 text-sm text-mint">
                  The recorded fields are complete enough to start. That does not
                  make the hypothesis true.
                </p>
              ) : (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                  {readiness.missing.map((item) => <li key={item}>{item}</li>)}
                </ul>
              )}
            </div>
            <div className={cardClass}>
              <h3 className="text-sm font-bold">Compare approaches</h3>
              <ul className="mt-2 space-y-2 text-sm">
                {comparison.map((option) => (
                  <li key={option.title}>
                    <span className="font-medium">{option.title}</span>
                    <span className="block text-xs text-muted">{option.whatYouWouldLearn}</span>
                    <span className="block text-xs text-muted">Cost: {option.cost}</span>
                    <span className="block text-xs text-muted">Risk: {option.risk}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className={cardClass}>
              <h3 className="text-sm font-bold">Smallest useful prototype</h3>
              <p className="mt-2 text-sm text-muted">{prototype.scope}</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted">
                {prototype.pages.map((page) => <li key={page}>{page}</li>)}
              </ul>
              <p className="mt-2 text-xs font-semibold">Exclusions</p>
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
                {prototype.exclusions.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </div>
            <div className={cardClass}>
              <h3 className="text-sm font-bold">Interview questions</h3>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted">
                {questions.map((question) => <li key={question}>{question}</li>)}
              </ol>
            </div>
          </div>

          <div className={`${cardClass} mt-3`}>
            <h3 className="text-sm font-bold">Next experiment suggestion</h3>
            <p className="mt-2 text-sm text-muted">{next}</p>
          </div>
        </section>

        <section aria-labelledby="observations-heading" className="mt-10">
          <h2 id="observations-heading" className="text-xl font-bold">
            Observations
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Append-only. A participant opinion is not a measured outcome.
          </p>
          {observations.length === 0 ? (
            <p className={`${cardClass} mt-3 text-sm text-muted`}>
              Nothing observed yet. Do not describe a result until it is recorded.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {observations.map((observation) => (
                <li key={observation.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-sm font-semibold">
                      {OBSERVATION_KIND_LABELS[observation.kind]}
                    </p>
                    <span className={chipClass}>
                      {observation.created_at.slice(0, 10)}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-line text-sm text-muted">{observation.text}</p>
                  {observation.source ? (
                    <p className="mt-1 text-xs text-muted">Source: {observation.source}</p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted">Recorded by {nameOf(observation.author_id)}</p>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <ExperimentObservationForm workspaceId={workspaceId} experimentId={experiment.id} />
          </div>
        </section>

        <section aria-labelledby="feedback-heading" className="mt-10">
          <h2 id="feedback-heading" className="text-xl font-bold">
            Consented feedback
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            {feedbackSummary.summary}
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className={cardClass}>
              <h3 className="text-sm font-bold">Participant opinions</h3>
              {feedbackSummary.opinions.length === 0 ? (
                <p className="mt-2 text-sm text-muted">None recorded with consent.</p>
              ) : (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                  {feedbackSummary.opinions.map((entry, index) => (
                    <li key={`${entry}-${index}`}>{entry}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className={cardClass}>
              <h3 className="text-sm font-bold">Measured feedback</h3>
              {feedbackSummary.measured.length === 0 ? (
                <p className="mt-2 text-sm text-muted">None recorded.</p>
              ) : (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                  {feedbackSummary.measured.map((entry, index) => (
                    <li key={`${entry}-${index}`}>{entry}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {feedbackSummary.identifiableCount > 0 ? (
            <p className="mt-2 rounded-xl border border-brand/40 bg-brand-soft/30 p-3 text-sm">
              Identifiable feedback exists. Do not quote or publish it without
              explicit permission and a separate publication approval.
            </p>
          ) : null}
          <div className="mt-3">
            <ExperimentFeedbackForm workspaceId={workspaceId} experimentId={experiment.id} />
          </div>
        </section>

        <section aria-labelledby="prototype-heading" className="mt-10">
          <h2 id="prototype-heading" className="text-xl font-bold">
            Prototype
          </h2>
          {experiment.prototype_project_id ? (
            <div className={`${cardClass} mt-3`}>
              <p className="text-sm font-semibold">A human approved a prototype project.</p>
              <p className="mt-1 text-sm text-muted">
                It is a normal app-builder project. Its sandbox, test and deployment
                approvals are unchanged. Deployment is not evidence of benefit.
              </p>
              <p className="mt-3">
                <Link href={`/build/${experiment.prototype_project_id}`} className={secondaryButton}>
                  Open the app project
                </Link>
              </p>
            </div>
          ) : canManage ? (
            <div className="mt-3">
              <ExperimentPrototypeForm workspaceId={workspaceId} experiment={experiment} />
              {!prototypeProblem.ok ? (
                <p className="mt-2 text-sm text-muted">{prototypeProblem.message}</p>
              ) : null}
            </div>
          ) : (
            <p className={`${cardClass} mt-3 text-sm text-muted`}>
              Only an owner or admin can approve a prototype. Nothing has been created.
            </p>
          )}
        </section>

        <section aria-labelledby="approvals-heading" className="mt-10">
          <h2 id="approvals-heading" className="text-xl font-bold">
            Separate approvals
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Real outreach, publication, paid activity and deployment need a
            separate decision. Approval records a decision; it does not perform
            the action.
          </p>
          {approvals.length === 0 ? (
            <p className={`${cardClass} mt-3 text-sm text-muted`}>No approvals requested.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {approvals.map((approval) => {
                const problem = approvalProblem({
                  approval,
                  actorId: session.user.id,
                  actorRole: myRole,
                });
                return (
                  <li key={approval.id} className={cardClass}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-semibold">
                        {approvalKindLabel(approval.kind)}: {approval.summary}
                      </p>
                      <span className={chipClass}>{approval.status}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-line text-sm text-muted">{approval.scope}</p>
                    <p className="mt-1 text-xs text-muted">
                      Requested by {approval.requested_by ? nameOf(approval.requested_by) : "an agent"}.
                      {" "}{APPROVAL_KIND_NOTES[approval.kind]}
                    </p>
                    {approval.note ? (
                      <p className="mt-1 text-xs text-muted">Note: {approval.note}</p>
                    ) : null}
                    {canManage && approval.status === "pending" ? (
                      problem.ok ? (
                        <ExperimentApprovalDecisionForm
                          workspaceId={workspaceId}
                          experimentId={experiment.id}
                          approval={approval}
                        />
                      ) : (
                        <p className="mt-2 text-xs text-muted">{problem.message}</p>
                      )
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-3">
            <ExperimentApprovalRequestForm workspaceId={workspaceId} experimentId={experiment.id} />
          </div>
        </section>

        <section aria-labelledby="review-heading" className="mt-10">
          <h2 id="review-heading" className="text-xl font-bold">
            Outcome review
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Keep the hypothesis above unchanged. Separate what was observed from
            what people said about it, and say what remains unknown.
          </p>
          <div className="mt-3">
            <ExperimentReviewForm
              workspaceId={workspaceId}
              experimentId={experiment.id}
              review={review}
            />
          </div>
        </section>

        <section aria-labelledby="events-heading" className="mt-10">
          <h2 id="events-heading" className="text-xl font-bold">
            Oversight trail
          </h2>
          <p className="mt-1 text-sm text-muted">
            Append-only records of experiment changes and human decisions.
          </p>
          {events.length === 0 ? (
            <p className={`${cardClass} mt-3 text-sm text-muted`}>No events yet.</p>
          ) : (
            <ul className="mt-3 space-y-1 text-sm">
              {events.map((event) => (
                <li key={event.id} className="rounded-xl border border-line bg-card px-3 py-2">
                  <span className="text-xs text-muted">
                    {event.created_at.slice(0, 16).replace("T", " ")}
                  </span>{" "}
                  <span className="font-medium">{event.kind}</span> — {event.detail}
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-8">
          <Link href={`/workspace/${workspaceId}/experiments`} className={secondaryButton}>
            Back to experiments
          </Link>
        </p>
      </main>
    </div>
  );
}
