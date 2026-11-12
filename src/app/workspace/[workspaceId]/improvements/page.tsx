import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  DecideCandidateForm,
  EvaluateCandidateForm,
  NewImprovementCandidateForm,
  RelaxationAttemptForm,
} from "@/components/improvement-candidate-forms";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import {
  CANDIDATE_KIND_LABELS,
  CANDIDATE_NOTES,
  CANDIDATE_STATUS_LABELS,
  PROTECTED_AUTHORITIES,
  VERDICT_LABELS,
  type CandidateStatus,
  type Verdict,
} from "@/lib/improvement-candidates";
import { listImprovementCandidates } from "@/lib/data/improvement-candidates";
import { getIdentity } from "@/lib/identity";
import { cardClass, chipClass } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Improvement proposals — GET TO IT" };

const RECORD_FIELDS = [
  ["problem", "Problem"],
  ["evidence", "Evidence of the problem"],
  ["proposed_change", "Proposed change"],
  ["expected_benefit", "Expected benefit"],
  ["possible_regressions", "Possible regressions"],
  ["evaluation_plan", "Evaluation plan"],
  ["cost_impact", "Cost impact"],
  ["security_implications", "Security implications"],
  ["rollback_plan", "Rollback plan"],
] as const;

export default async function ImprovementsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const [identity, list] = await Promise.all([
    getIdentity(session),
    listImprovementCandidates(session, workspaceId),
  ]);
  if (!list) notFound();

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-6">
        <Link href={`/workspace/${workspaceId}`} className="text-sm text-muted underline">
          Back to {list.workspace.name}
        </Link>

        <h1 className="mt-3 text-3xl font-black tracking-tight">Improvement proposals</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          One written case per change to how this product is built and run: a prompt revision, a
          routing rule, a tool policy, a procedure, a workflow, an application patch or a new
          evaluation case. Measured against the baseline, reviewed by a person, promoted separately.
        </p>

        <ul className="mt-4 grid gap-2 text-sm text-muted">
          <li>{CANDIDATE_NOTES.isolation}</li>
          <li>{CANDIDATE_NOTES.evaluation}</li>
          <li>{CANDIDATE_NOTES.promotion}</li>
        </ul>

        <NewImprovementCandidateForm workspaceId={workspaceId} projects={list.projects} />

        <section aria-labelledby="boundaries-heading" className={`${cardClass} mt-8`}>
          <h2 id="boundaries-heading" className="text-xl font-bold">
            Boundaries the engine cannot cross
          </h2>
          <p className="mt-1 text-sm text-muted">{CANDIDATE_NOTES.boundaries}</p>
          <ul className="mt-2 grid gap-1 text-sm text-muted">
            {PROTECTED_AUTHORITIES.map((authority) => (
              <li key={authority}>{authority.replaceAll("_", " ")}</li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="candidates-heading" className="mt-10">
          <h2 id="candidates-heading" className="text-xl font-bold">
            Proposed changes
          </h2>
          {list.candidates.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No proposal has been written in this workspace yet.</p>
          ) : (
            <ul className="mt-3 grid gap-4">
              {list.candidates.map((candidate) => {
                const evaluation = list.evaluations.find(
                  (row) => row.candidate_id === candidate.id,
                );
                const events = list.events.filter((event) => event.candidate_id === candidate.id);
                const mine = candidate.user_id === session.user.id;
                const project = list.projects.find((row) => row.id === candidate.project_id);
                const shipDeployments = list.deployments.filter(
                  (deployment) =>
                    deployment.project_id === candidate.project_id &&
                    deployment.approval_at !== null &&
                    !["draft", "checks_ready", "failed", "partial_failure"].includes(
                      deployment.status,
                    ),
                );
                return (
                  <li key={candidate.id} className={cardClass}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="text-base font-bold">{candidate.title}</h3>
                        <p className="text-xs text-muted">
                          {CANDIDATE_KIND_LABELS[candidate.kind]} · {candidate.sandbox_kind}{" "}
                          {candidate.candidate_ref} against {candidate.base_ref}
                          {project ? ` · ${project.name}` : " · no project linked"}
                        </p>
                      </div>
                      <span className={chipClass}>
                        {CANDIDATE_STATUS_LABELS[candidate.status as CandidateStatus]}
                      </span>
                    </div>

                    <dl className="mt-3 grid gap-2 text-sm">
                      {RECORD_FIELDS.map(([key, label]) => (
                        <div key={key}>
                          <dt className="font-semibold">{label}</dt>
                          <dd className="text-muted">{candidate[key]}</dd>
                        </div>
                      ))}
                      <div>
                        <dt className="font-semibold">Affected components</dt>
                        <dd className="text-muted">{candidate.affected_components.join(", ")}</dd>
                      </div>
                    </dl>

                    {evaluation ? (
                      <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm">
                        <p className="font-semibold">
                          {VERDICT_LABELS[evaluation.verdict as Verdict]} —{" "}
                          {evaluation.candidate_passed} of {evaluation.total_cases} cases pass against{" "}
                          {evaluation.baseline_passed} for the baseline
                        </p>
                        <p className="text-muted">
                          Security findings: {evaluation.security_findings}. Guarded behaviours
                          changed: {evaluation.regressions}. Cost change:{" "}
                          {(evaluation.cost_delta_ratio * 100).toFixed(0)}%. Suite{" "}
                          {evaluation.suite_name} {evaluation.suite_version}.
                        </p>
                      </div>
                    ) : (
                      <p className="mt-3 text-sm text-muted">
                        Not evaluated yet. Running the evaluation freezes these criteria.
                      </p>
                    )}

                    {candidate.review_note ? (
                      <p className="mt-3 text-sm">
                        <span className="font-semibold">Review: </span>
                        {candidate.review_note}
                      </p>
                    ) : null}

                    {candidate.promotion_ref ? (
                      <p className="mt-1 text-sm text-muted">
                        Promoted against {candidate.promotion_ref}.
                      </p>
                    ) : null}

                    {events.length > 0 ? (
                      <ol className="mt-3 grid gap-1 text-xs text-muted">
                        {events.map((event) => (
                          <li key={event.id}>
                            {event.kind.replaceAll("_", " ")} —{" "}
                            {new Date(event.created_at).toISOString().slice(0, 16).replace("T", " ")}
                          </li>
                        ))}
                      </ol>
                    ) : null}

                    {mine && candidate.status === "draft" ? (
                      <EvaluateCandidateForm workspaceId={workspaceId} candidateId={candidate.id} />
                    ) : null}
                    {candidate.status === "evaluated" || candidate.status === "approved" ? (
                      <DecideCandidateForm
                        workspaceId={workspaceId}
                        candidateId={candidate.id}
                        deployments={shipDeployments}
                      />
                    ) : null}
                    {candidate.criteria_frozen_at ? (
                      <RelaxationAttemptForm workspaceId={workspaceId} candidateId={candidate.id} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="blocks-heading" className="mt-10">
          <h2 id="blocks-heading" className="text-xl font-bold">
            Blocked attempts
          </h2>
          {list.blocks.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              Nothing has tried to cross a boundary in this workspace.
            </p>
          ) : (
            <ul className="mt-2 grid gap-2 text-sm">
              {list.blocks.map((block) => (
                <li key={block.id} className={cardClass}>
                  <p className="font-semibold">{block.attempted_action.replaceAll("_", " ")}</p>
                  <p className="text-muted">{block.reason}</p>
                  <p className="text-xs text-muted">
                    {new Date(block.created_at).toISOString().slice(0, 16).replace("T", " ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
