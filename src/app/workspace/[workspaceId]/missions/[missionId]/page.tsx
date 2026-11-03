import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AssistanceForm,
  DecisionForm,
  DeleteEvidenceButton,
  DeleteOutcomeButton,
  EvidenceForm,
  MissionSettingsForm,
  MissionTaskForm,
  OutcomeForm,
  ReportForm,
  ReportList,
  ShareForm,
  SuggestionReview,
  TaskStatusButtons,
} from "@/components/mission-forms";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { getMissionDetail } from "@/lib/data/missions";
import { getIdentity } from "@/lib/identity";
import {
  AI_CANNOT_VOTE_NOTE,
  AI_LABEL,
  CONSENT_NOTE,
  DISAGREEMENT_NOTE,
  EVIDENCE_KINDS,
  IMPACT_NOTE,
  MISSION_STATUSES,
  NO_AUTO_PUBLISH_NOTE,
  NO_SCORING_NOTE,
  OUTCOME_KINDS,
  PRIVACY_NOTE,
  REMOVAL_NOTE,
  canApproveShare,
  canDeleteEvidence,
  canDeleteOutcome,
  canManageMissions,
  canRecordDecision,
  categoryLabel,
  countOutcomes,
  hasConsent,
  impactSummaryText,
  reviewDue,
  shareBlockers,
  statusLabel,
  suggestionLabel,
  taskProgress,
} from "@/lib/missions";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { memberLabel } from "@/lib/workspaces";
import type { MissionSuggestion } from "@/lib/types";

export const metadata: Metadata = { title: "Mission — GET TO IT" };

function suggestionStatusLabel(status: MissionSuggestion["status"]): string {
  switch (status) {
    case "proposed":
      return "Not reviewed";
    case "accepted":
      return "Accepted by a person";
    case "rejected":
      return "Rejected by a person";
    case "challenged":
      return "Challenged";
  }
}

export default async function MissionPage({
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
    getMissionDetail(session, workspaceId, missionId),
  ]);

  if (!detail) notFound();

  const { mission, myRole, members, evidence, decisions, tasks, outcomes, suggestions, reports } =
    detail;
  const today = new Date().toISOString().slice(0, 10);
  const progress = taskProgress(tasks);
  const summary = countOutcomes(outcomes);
  const blockers = shareBlockers({
    role: myRole,
    evidence,
    scope: mission.share_scope ?? "described in the approval form",
  });

  const nameOf = (userId: string | null): string => {
    if (!userId) return "A former member";
    const member = members.find((entry) => entry.user_id === userId);
    return member ? memberLabel(member) : "A former member";
  };

  const canManage = canManageMissions(myRole);
  const canDecide = canRecordDecision(myRole);
  const canShare = canApproveShare(myRole);

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-6">
        <Link
          href={`/workspace/${workspaceId}/missions`}
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← All missions
        </Link>

        <header className="mt-4">
          <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">
            {mission.title}
          </h1>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
            <span className={chipClass}>{categoryLabel(mission.category)}</span>
            <span className={chipClass}>{statusLabel(mission.status)}</span>
            <span className={chipClass}>
              Decision owner: {nameOf(mission.decision_owner_id)}
            </span>
            <span className={chipClass}>
              {mission.review_at ? `Review ${mission.review_at}` : "No review date"}
            </span>
            <span className={chipClass}>
              {progress.done} of {progress.total} tasks done
            </span>
          </div>

          {reviewDue(mission.review_at, today) ? (
            <p className="mt-3 rounded-xl border border-brand/40 bg-brand-soft/40 p-3 text-sm">
              The review date has passed. Nothing changed automatically — look at
              the outcomes below and decide whether to record a new decision.
            </p>
          ) : null}

          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
            {PRIVACY_NOTE} {AI_CANNOT_VOTE_NOTE}
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
            {NO_AUTO_PUBLISH_NOTE}
          </p>
        </header>

        <section aria-labelledby="record-heading" className={`${cardClass} mt-6`}>
          <h2 id="record-heading" className="text-lg font-bold">
            The record
          </h2>
          <dl className="mt-3 space-y-3 text-sm">
            <div>
              <dt className="font-semibold">The problem</dt>
              <dd className="mt-1 whitespace-pre-line text-muted">{mission.problem}</dd>
            </div>
            <div>
              <dt className="font-semibold">People affected</dt>
              <dd className="mt-1 whitespace-pre-line text-muted">
                {mission.stakeholders}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Desired outcome</dt>
              <dd className="mt-1 whitespace-pre-line text-muted">
                {mission.desired_outcome}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Constraints</dt>
              <dd className="mt-1 whitespace-pre-line text-muted">
                {mission.constraints || "None recorded yet."}
              </dd>
            </div>
          </dl>
        </section>

        {canManage ? (
          <div className="mt-4">
            <MissionSettingsForm mission={mission} members={members} />
          </div>
        ) : null}

        <section aria-labelledby="tasks-heading" className="mt-10">
          <h2 id="tasks-heading" className="text-xl font-bold">
            Shared tasks
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Work in progress. Finishing these counts as work completed, which is
            listed separately from outcomes.
          </p>

          {tasks.length === 0 ? (
            <p className={`${cardClass} mt-3 text-sm text-muted`}>No tasks yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {tasks.map((task) => (
                <li key={task.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-medium">{task.title}</p>
                    <span className={chipClass}>
                      {task.status === "completed"
                        ? "Done"
                        : task.status === "in_progress"
                          ? "In progress"
                          : "To do"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {task.assignee_id
                      ? `Assigned to ${nameOf(task.assignee_id)}`
                      : "Unassigned"}
                  </p>
                  <div className="mt-2">
                    <TaskStatusButtons mission={mission} taskId={task.id} />
                  </div>
                </li>
              ))}
            </ul>
          )}

          <MissionTaskForm mission={mission} members={members} />
        </section>

        <section aria-labelledby="evidence-heading" className="mt-10">
          <h2 id="evidence-heading" className="text-xl font-bold">
            Evidence and assumptions
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Each line keeps who added it and whether it is evidence or an
            assumption. {CONSENT_NOTE}
          </p>

          {evidence.length === 0 ? (
            <p className={`${cardClass} mt-3 text-sm text-muted`}>
              Nothing recorded yet. Assumptions are welcome here; they are labelled
              as assumptions.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {evidence.map((item) => (
                <li key={item.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="whitespace-pre-line text-sm">{item.text}</p>
                    <span className={chipClass}>
                      {EVIDENCE_KINDS.find((kind) => kind.slug === item.kind)?.label ??
                        item.kind}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    Added by {nameOf(item.author_id)}
                    {item.source_url ? (
                      <>
                        {" · "}
                        <a
                          href={item.source_url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className={`rounded underline decoration-line underline-offset-2 hover:text-ink ${focusRing}`}
                        >
                          Source
                        </a>
                      </>
                    ) : null}
                  </p>
                  {item.contains_personal_story ? (
                    <p className="mt-1 text-xs text-muted">
                      {hasConsent(item)
                        ? `Personal story — consent recorded: ${item.consent_note}`
                        : "Personal story without recorded consent. It cannot be shared and is excluded from AI input."}
                    </p>
                  ) : null}
                  {canDeleteEvidence(myRole, session.user.id, item.author_id) ? (
                    <DeleteEvidenceButton mission={mission} evidence={item} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4">
            <EvidenceForm mission={mission} />
          </div>
        </section>

        <section aria-labelledby="decisions-heading" className="mt-10">
          <h2 id="decisions-heading" className="text-xl font-bold">
            Human decisions
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{DISAGREEMENT_NOTE}</p>

          {decisions.length === 0 ? (
            <p className={`${cardClass} mt-3 text-sm text-muted`}>
              No decisions recorded yet. Suggestions do not become decisions on
              their own.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {decisions.map((decision) => (
                <li key={decision.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="font-semibold">{decision.title}</h3>
                    <span className={chipClass}>
                      Approved by {nameOf(decision.decided_by)}
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-line text-sm">{decision.summary}</p>
                  <p className="mt-2 text-xs text-muted">
                    Decided {decision.decided_at.slice(0, 10)} · recorded by{" "}
                    {nameOf(decision.created_by)}
                  </p>
                  {decision.dissent ? (
                    <p className="mt-2 rounded-xl border border-line bg-paper p-2 text-sm">
                      <span className="font-semibold">Dissent: </span>
                      {decision.dissent}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {canDecide ? (
            <div className="mt-4">
              <DecisionForm mission={mission} members={members} />
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">
              Only owners and admins record decisions. Everyone can add evidence and
              challenge a summary.
            </p>
          )}
        </section>

        <section aria-labelledby="impact-heading" className="mt-10">
          <h2 id="impact-heading" className="text-xl font-bold">
            What changed, honestly
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{IMPACT_NOTE}</p>
          <p className="mt-1 text-sm text-muted">{impactSummaryText(summary)}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{NO_SCORING_NOTE}</p>

          <div className="mt-4 space-y-4">
            {OUTCOME_KINDS.map((kind) => {
              const items = outcomes.filter((outcome) => outcome.kind === kind.slug);
              return (
                <div key={kind.slug} className={cardClass}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-bold">{kind.label}</h3>
                    <span className={chipClass}>
                      {items.length} {items.length === 1 ? "record" : "records"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{kind.note}</p>

                  {items.length === 0 ? (
                    <p className="mt-2 text-sm text-muted">Nothing recorded yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-2 text-sm">
                      {items.map((item) => (
                        <li key={item.id}>
                          <p className="whitespace-pre-line">{item.text}</p>
                          <p className="mt-1 text-xs text-muted">
                            {item.reported_by
                              ? `Reported by ${nameOf(item.reported_by)}`
                              : "Reporter removed"}
                            {item.verified_by
                              ? ` · verified by ${nameOf(item.verified_by)}`
                              : ""}
                            {item.source_url ? (
                              <>
                                {" · "}
                                <a
                                  href={item.source_url}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className={`rounded underline decoration-line underline-offset-2 hover:text-ink ${focusRing}`}
                                >
                                  Source
                                </a>
                              </>
                            ) : null}
                          </p>
                          {canDeleteOutcome(myRole, session.user.id, item.reported_by) ? (
                            <DeleteOutcomeButton mission={mission} outcomeId={item.id} />
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          <OutcomeForm mission={mission} />
        </section>

        <section aria-labelledby="assistance-heading" className="mt-10">
          <h2 id="assistance-heading" className="text-xl font-bold">
            AI assistance
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Assistance is optional and clearly labelled. Every suggestion is a
            proposal for people to accept, reject or challenge; none of them votes,
            decides or speaks for anyone.
          </p>

          <AssistanceForm mission={mission} />

          {suggestions.length === 0 ? (
            <p className={`${cardClass} mt-4 text-sm text-muted`}>
              No suggestions requested yet.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {suggestions.map((suggestion) => (
                <li key={suggestion.id} className={`${cardClass} border-brand/25`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-muted">
                        {AI_LABEL}
                      </p>
                      <h3 className="mt-1 text-sm font-bold">
                        {suggestionLabel(suggestion.kind)}
                      </h3>
                    </div>
                    <span className={chipClass}>
                      {suggestionStatusLabel(suggestion.status)}
                    </span>
                  </div>

                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">
                    {suggestion.body}
                  </p>

                  <p className="mt-2 text-xs text-muted">
                    Model {suggestion.model} · requested by{" "}
                    {nameOf(suggestion.requested_by)} ·{" "}
                    {suggestion.created_at.slice(0, 10)}
                  </p>

                  {suggestion.challenge_note ? (
                    <p className="mt-2 rounded-xl border border-line bg-paper p-2 text-sm">
                      <span className="font-semibold">Challenged or corrected: </span>
                      {suggestion.challenge_note}
                    </p>
                  ) : null}

                  <SuggestionReview
                    mission={mission}
                    suggestion={suggestion}
                    role={myRole}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="privacy-heading" className="mt-10">
          <h2 id="privacy-heading" className="text-xl font-bold">
            Privacy, sharing and removal
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{REMOVAL_NOTE}</p>

          {mission.share_approved_at ? (
            <div className={`${cardClass} mt-3`}>
              <h3 className="text-sm font-bold">Share approval recorded</h3>
              <p className="mt-1 text-sm">
                Approved by {nameOf(mission.share_approved_by)} on{" "}
                {mission.share_approved_at.slice(0, 10)}.
              </p>
              <p className="mt-1 whitespace-pre-line text-sm text-muted">
                {mission.share_scope}
              </p>
              <p className="mt-2 text-xs text-muted">
                Nothing was published or sent. This build has no sharing channel.
              </p>
            </div>
          ) : null}

          <ShareForm mission={mission} blockers={blockers} canApprove={canShare} />
          <ReportForm mission={mission} />
          {canManage ? <ReportList mission={mission} reports={reports} /> : null}
        </section>

        <p className="mt-8 text-xs leading-relaxed text-muted">
          {MISSION_STATUSES.map((status) => `${status.label}: ${status.note}`).join(" ")}
        </p>

        <p className="mt-4">
          <Link href={`/workspace/${workspaceId}/missions`} className={secondaryButton}>
            Back to missions
          </Link>
        </p>
      </main>
    </div>
  );
}
