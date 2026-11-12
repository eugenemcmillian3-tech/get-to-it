import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AddFindingForm,
  AddSourceForm,
  MissionControlForms,
} from "@/components/research-forms";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { getResearchMission } from "@/lib/data/research";
import { getIdentity } from "@/lib/identity";
import {
  FINDING_LABEL_LABELS,
  RESEARCH_FUNCTION_LABELS,
  RESEARCH_NOTES,
  REQUIRED_SOURCE_TIER_LABELS,
  RESEARCH_STATUS_LABELS,
  RESEARCH_SOURCE_KIND_LABELS,
  SOURCE_STANCE_LABELS,
  SOURCE_TIER_LABELS,
  STATEMENT_KIND_LABELS,
} from "@/lib/research-missions";
import { cardClass, chipClass } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Research mission — GET TO IT" };

export default async function ResearchMissionPage({
  params,
}: {
  params: Promise<{ workspaceId: string; missionId: string }>;
}) {
  const { workspaceId, missionId } = await params;
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
    getResearchMission(session, workspaceId, missionId),
  ]);
  if (!detail) notFound();

  const { mission, brief, hypotheses, sources, findings } = detail;
  const closed = mission.status === "cancelled" || mission.status === "complete";

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-6">
        <Link
          href={`/workspace/${workspaceId}/research`}
          className="text-sm text-muted underline"
        >
          Back to research missions
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <h1 className="max-w-2xl text-3xl font-black tracking-tight">
            {mission.question}
          </h1>
          <span className={chipClass}>{RESEARCH_STATUS_LABELS[mission.status]}</span>
        </div>

        <section aria-labelledby="contract-details" className={`mt-6 ${cardClass}`}>
          <h2 id="contract-details" className="text-lg font-bold">
            The contract
          </h2>
          <dl className="mt-3 grid gap-3 text-sm">
            <div>
              <dt className="font-semibold">Scope</dt>
              <dd className="text-muted">{mission.scope}</dd>
            </div>
            <div>
              <dt className="font-semibold">Existing evidence</dt>
              <dd className="text-muted">
                {mission.existing_evidence || "None recorded before this mission."}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Required source quality</dt>
              <dd className="text-muted">
                {REQUIRED_SOURCE_TIER_LABELS[mission.required_source_tier]}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Limits</dt>
              <dd className="text-muted">
                {mission.task_budget} tasks, {mission.agent_budget} agents,{" "}
                {mission.retry_budget} retries, {mission.spend_ceiling_cents} cents
                shared, {mission.time_ceiling_minutes} minutes.
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Allowed tools</dt>
              <dd className="text-muted">{mission.allowed_tools.join(", ")}</dd>
            </div>
            <div>
              <dt className="font-semibold">Stop conditions</dt>
              <dd className="text-muted">{mission.stop_conditions.join(" ")}</dd>
            </div>
            <div>
              <dt className="font-semibold">Human review checkpoints</dt>
              <dd className="text-muted">{mission.checkpoints.join(" ")}</dd>
            </div>
            <div>
              <dt className="font-semibold">Orchestration</dt>
              <dd className="text-muted">
                {detail.orchestration
                  ? `${detail.orchestration.goal} (${detail.orchestration.status})`
                  : "None linked. Cancelling this mission stops only the mission."}
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="brief-heading" className="mt-10">
          <h2 id="brief-heading" className="text-xl font-bold">
            Research brief
          </h2>
          <p className="mt-1 text-sm text-muted">
            {brief.counts.sources} sources ({brief.counts.supporting} supporting,{" "}
            {brief.counts.contradicting} contradicting, {brief.counts.verifiedSources}{" "}
            re-checked) · {brief.counts.findings} findings · {brief.counts.discoveries}{" "}
            verified discoveries.
          </p>

          <h3 className="mt-5 text-base font-bold">Findings</h3>
          {brief.findings.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No finding has been recorded yet.</p>
          ) : (
            <ul className="mt-2 grid gap-2">
              {brief.findings.map((finding) => (
                <li key={finding.id} className={cardClass}>
                  <p className="text-sm font-medium">{finding.claim}</p>
                  <p className="mt-1 text-xs text-muted">
                    {FINDING_LABEL_LABELS[finding.label]} · {finding.status} ·{" "}
                    {finding.supportedBy} supporting, {finding.contradictedBy}{" "}
                    contradicting ·{" "}
                    {finding.verified ? "independently verified" : "not verified"}
                  </p>
                  {finding.downgraded ? (
                    <p className="mt-1 text-xs font-semibold text-red-800">
                      {finding.downgraded}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {brief.proposals.length > 0 ? (
            <>
              <h3 className="mt-5 text-base font-bold">Proposals</h3>
              <ul className="mt-2 grid gap-2">
                {brief.proposals.map((proposal) => (
                  <li key={proposal.id} className={cardClass}>
                    <p className="text-sm">{proposal.claim}</p>
                    <p className="mt-1 text-xs text-muted">
                      A proposal is not a finding. Status: {proposal.status}.
                    </p>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <h3 className="mt-5 text-base font-bold">Evidence</h3>
          {sources.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No source has been recorded yet.</p>
          ) : (
            <div className="mt-2 overflow-x-auto rounded-2xl border border-line bg-card">
              <table className="w-full min-w-[42rem] border-collapse text-sm">
                <thead className="bg-paper text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2">Source</th>
                    <th scope="col" className="px-3 py-2">Stance</th>
                    <th scope="col" className="px-3 py-2">Kind</th>
                    <th scope="col" className="px-3 py-2">Quality</th>
                    <th scope="col" className="px-3 py-2">Provenance</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((source) => (
                    <tr key={source.id} className="border-t border-line align-top">
                      <td className="px-3 py-2">
                        <p className="font-medium">{source.title}</p>
                        <p className="text-xs text-muted">
                          {RESEARCH_SOURCE_KIND_LABELS[source.source_kind]} ·{" "}
                          {source.verified ? "re-checked" : "not re-checked"}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {SOURCE_STANCE_LABELS[source.stance]}
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {STATEMENT_KIND_LABELS[source.statement_kind]}
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {SOURCE_TIER_LABELS[source.source_tier]}
                      </td>
                      <td className="px-3 py-2 text-muted">{source.locator}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3 className="mt-5 text-base font-bold">Alternative explanations</h3>
          <ul className="mt-2 grid gap-2">
            {brief.alternatives.map((alternative) => (
              <li key={alternative.id} className={cardClass}>
                <p className="text-sm">{alternative.statement}</p>
                <p className="mt-1 text-xs text-muted">
                  {alternative.role === "leading" ? "Leading" : "Competing"} ·{" "}
                  {alternative.state} · {alternative.supporting} supporting,{" "}
                  {alternative.contradicting} contradicting
                </p>
              </li>
            ))}
          </ul>

          <h3 className="mt-5 text-base font-bold">Limitations</h3>
          <ul className="mt-2 grid gap-1 text-sm text-muted">
            {brief.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>

          <h3 className="mt-5 text-base font-bold">Unresolved questions</h3>
          <ul className="mt-2 grid gap-1 text-sm text-muted">
            {brief.unresolvedQuestions.length === 0 ? (
              <li>Nothing is outstanding against the recorded evidence.</li>
            ) : (
              brief.unresolvedQuestions.map((question) => <li key={question}>{question}</li>)
            )}
          </ul>

          <h3 className="mt-5 text-base font-bold">Proposed next experiment</h3>
          {brief.proposedExperiment ? (
            <div className={`mt-2 ${cardClass}`}>
              <p className="text-sm font-medium">{brief.proposedExperiment.question}</p>
              <p className="mt-1 text-sm text-muted">
                Hypothesis: {brief.proposedExperiment.hypothesis}
              </p>
              <p className="mt-1 text-sm text-muted">
                Success: {brief.proposedExperiment.success_criteria}
              </p>
              <p className="mt-1 text-sm text-muted">
                Fails if: {brief.proposedExperiment.failure_criteria}
              </p>
              <p className="mt-1 text-sm text-muted">
                Limit: {brief.proposedExperiment.time_limit_minutes} minutes. It becomes a
                normal Phase 35 draft record, not a running experiment.
              </p>
              {mission.proposed_experiment_id ? (
                <p className="mt-2 text-sm">
                  <Link
                    href={`/workspace/${workspaceId}/experiments/${mission.proposed_experiment_id}`}
                    className="underline"
                  >
                    Open the experiment record
                  </Link>
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">
              Nothing to propose until the brief has a finding or a hypothesis.
            </p>
          )}

          <p className="mt-3 text-xs text-muted">{RESEARCH_NOTES.noProposalAsDiscovery}</p>
        </section>

        <MissionControlForms
          workspaceId={workspaceId}
          missionId={mission.id}
          hasExperiment={mission.proposed_experiment_id !== null}
          closed={closed}
        />

        {closed ? null : (
          <>
            <AddSourceForm
              workspaceId={workspaceId}
              missionId={mission.id}
              hypotheses={hypotheses}
            />
            <AddFindingForm
              workspaceId={workspaceId}
              missionId={mission.id}
              hypotheses={hypotheses}
            />
          </>
        )}

        <section aria-labelledby="roles-heading" className={`mt-6 ${cardClass}`}>
          <h2 id="roles-heading" className="text-lg font-bold">
            Who did what
          </h2>
          <ul className="mt-2 grid gap-1 text-sm text-muted">
            {findings.map((finding) => (
              <li key={finding.id}>
                {RESEARCH_FUNCTION_LABELS[finding.author_role]} wrote a{" "}
                {FINDING_LABEL_LABELS[finding.label].toLowerCase()}
                {finding.verifier_role
                  ? `; ${RESEARCH_FUNCTION_LABELS[finding.verifier_role]} verified it`
                  : "; nobody has verified it"}
                .
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">
            A shared role label is not independent verification: the database refuses a
            conclusion verified by the same specialist function that wrote it.
          </p>
        </section>
      </main>
    </div>
  );
}
