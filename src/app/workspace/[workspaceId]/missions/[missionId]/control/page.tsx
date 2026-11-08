import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AgentJobForm,
  ApprovalDecisionForm,
  ApprovalRequestForm,
  CancelMissionJobsForm,
  JobActions,
  JobDependencyForm,
  LinkProjectForm,
  MilestoneDependencyForm,
  MilestoneForm,
  MilestoneStatusForm,
  MissionLimitsForm,
  UnlinkProjectButton,
} from "@/components/mission-control-forms";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { getMissionControl } from "@/lib/data/mission-control";
import { getIdentity } from "@/lib/identity";
import {
  MISSION_CONTROL_NOTES,
  approvalKindLabel,
  approvalKindNote,
  approvalProblem,
  buildMissionPlan,
  canManageMissionControl,
  evidenceSummary,
  jobStatusLabel,
  milestoneStatusLabel,
  missionDashboard,
  normalizeMissionLimits,
} from "@/lib/mission-control";
import {
  cardClass,
  chipClass,
  focusRing,
  secondaryButton,
} from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { memberLabel } from "@/lib/workspaces";

export const metadata: Metadata = { title: "Mission control — GET TO IT" };

export default async function MissionControlPage({
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
    getMissionControl(session, workspaceId, missionId),
  ]);
  if (!detail) notFound();

  const { mission, myRole, members, milestones, milestoneDependencies, jobs, jobDependencies, approvals, events, decisions } = detail;
  const today = new Date().toISOString().slice(0, 10);
  const limits = normalizeMissionLimits({
    max_parallel_jobs: mission.max_parallel_jobs,
    max_agent_jobs: mission.max_agent_jobs,
    max_runtime_seconds: mission.max_runtime_seconds,
    max_agent_calls: mission.max_agent_calls,
  });
  const plan = buildMissionPlan({
    milestones,
    dependencies: milestoneDependencies,
    jobs,
    limits,
    projectCount: detail.projects.length,
  });
  const dashboard = missionDashboard({
    mission: { id: mission.id, title: mission.title, review_at: mission.review_at, limits },
    milestones,
    milestonesDependencies: milestoneDependencies,
    jobs,
    approvals,
    decisions,
    today,
  });
  const canManage = canManageMissionControl(myRole);

  const nameOf = (userId: string | null): string => {
    if (!userId) return "Unassigned";
    const member = members.find((entry) => entry.user_id === userId);
    return member ? memberLabel(member) : "A former member";
  };
  const milestoneTitle = (id: string | null): string =>
    milestones.find((milestone) => milestone.id === id)?.title ?? "No deliverable";
  const projectName = (projectId: string): string => {
    const linked = detail.projects.find((project) => project.project_id === projectId);
    const summary = detail.projectSummaries.find((project) => project.id === projectId);
    return summary?.name ?? linked?.label ?? "Linked project";
  };
  const jobTitle = (id: string): string => jobs.find((job) => job.id === id)?.title ?? id;
  const linkedProjects = detail.projects.map((link) => ({
    link,
    name: detail.projectSummaries.find((project) => project.id === link.project_id)?.name ?? null,
  }));

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-5xl px-5 pb-16 pt-6">
        <Link
          href={`/workspace/${workspaceId}/missions/${missionId}`}
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← Back to the mission
        </Link>

        <header className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">Mission control</p>
          <h1 className="mt-1 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
            {mission.title}
          </h1>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
            <span className={chipClass}>{mission.status}</span>
            <span className={chipClass}>Decision owner: {nameOf(mission.decision_owner_id)}</span>
            <span className={chipClass}>{detail.projects.length} linked project(s)</span>
            <span className={chipClass}>
              {dashboard.overall.jobsDone} / {dashboard.overall.jobsTotal} jobs complete
            </span>
            <span className={chipClass}>{mission.review_at ? `Review ${mission.review_at}` : "No review date"}</span>
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
            {MISSION_CONTROL_NOTES.noAutoCreate} {MISSION_CONTROL_NOTES.noGuarantee}
          </p>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
            {MISSION_CONTROL_NOTES.humanAuthority} {MISSION_CONTROL_NOTES.noRanking}
          </p>
        </header>

        <section aria-labelledby="dashboard-heading" className="mt-8">
          <h2 id="dashboard-heading" className="text-xl font-bold">
            Dashboard
          </h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className={cardClass}>
              <h3 className="text-sm font-bold">Progress by deliverable</h3>
              {dashboard.deliverables.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No deliverables recorded yet.</p>
              ) : (
                <ul className="mt-2 space-y-2 text-sm">
                  {dashboard.deliverables.map((deliverable) => (
                    <li key={deliverable.id}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">{deliverable.title}</span>
                        <span className={chipClass}>{milestoneStatusLabel(deliverable.status)}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        Owner: {nameOf(deliverable.ownerId)} · {deliverable.completedJobs} of{" "}
                        {deliverable.totalJobs} jobs complete
                        {deliverable.blockedJobs > 0 ? ` · ${deliverable.blockedJobs} blocked` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className={cardClass}>
              <h3 className="text-sm font-bold">Blocked dependencies</h3>
              {dashboard.blockedDependencies.length === 0 ? (
                <p className="mt-2 text-sm text-muted">None recorded.</p>
              ) : (
                <ul className="mt-2 space-y-2 text-sm">
                  {dashboard.blockedDependencies.map((item) => (
                    <li key={`${item.milestoneId}-${item.dependsOnId}`}>
                      <span className="font-medium">{item.milestoneTitle}</span> is waiting on{" "}
                      <span className="font-medium">{item.dependsOnTitle}</span>, which is{" "}
                      {milestoneStatusLabel(item.dependencyStatus).toLowerCase()}.
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className={cardClass}>
              <h3 className="text-sm font-bold">Pending decisions and disagreements</h3>
              <p className="mt-2 text-sm">
                {dashboard.pendingApprovals.length} pending approval(s);{" "}
                {dashboard.unresolvedDisagreements.length} recorded disagreement(s).
              </p>
              {dashboard.unresolvedDisagreements.length > 0 ? (
                <ul className="mt-2 space-y-2 text-sm">
                  {dashboard.unresolvedDisagreements.map((item) => (
                    <li key={item.id}>
                      <span className="font-medium">{item.title}: </span>
                      <span className="text-muted">{item.dissent}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <div className={cardClass}>
              <h3 className="text-sm font-bold">Resource consumption</h3>
              <p className="mt-2 text-sm">
                {dashboard.resourceUse.runningJobs} / {dashboard.resourceUse.limits.max_parallel_jobs} jobs running ·{" "}
                {dashboard.resourceUse.activeJobs} / {dashboard.resourceUse.limits.max_agent_jobs} active jobs
              </p>
              <p className="mt-1 text-sm">
                {dashboard.resourceUse.runtimeSeconds}s recorded runtime /{" "}
                {dashboard.resourceUse.limits.max_runtime_seconds}s ·{" "}
                {dashboard.resourceUse.callsUsed} calls / {dashboard.resourceUse.limits.max_agent_calls}
              </p>
              <p className="mt-1 text-xs text-muted">
                Mission limits are additional to project limits. No usage is a productivity measure.
              </p>
            </div>

            <div className={cardClass}>
              <h3 className="text-sm font-bold">Test evidence</h3>
              {dashboard.testEvidence.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No completed evidence recorded yet.</p>
              ) : (
                <ul className="mt-2 space-y-2 text-sm">
                  {dashboard.testEvidence.map((item) => (
                    <li key={item.jobId}>
                      <span className="font-medium">{item.title}: </span>
                      <span className="text-muted">{item.summary}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className={cardClass}>
              <h3 className="text-sm font-bold">Upcoming reviews</h3>
              {dashboard.upcomingReviews.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No review dates in the future.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm">
                  {dashboard.upcomingReviews.map((review) => (
                    <li key={`${review.kind}-${review.id}`}>
                      {review.date} · {review.title} ({review.kind})
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section aria-labelledby="plan-heading" className="mt-10">
          <h2 id="plan-heading" className="text-xl font-bold">Suggested plan</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{plan.note}</p>

          {plan.sequence.length > 0 ? (
            <ol className="mt-3 space-y-2">
              {plan.sequence.map((item) => (
                <li key={item.id} className={cardClass}>
                  <span className="font-semibold">{item.order}. {item.title}</span>
                  <span className={`ml-2 ${chipClass}`}>Parallel group {item.wave + 1}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className={`${cardClass} mt-3 text-sm text-muted`}>
              No order can be suggested from the current dependencies.
            </p>
          )}

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className={cardClass}>
              <h3 className="text-sm font-bold">Missing decisions</h3>
              {plan.missingDecisions.length === 0 ? (
                <p className="mt-2 text-sm text-muted">None found.</p>
              ) : (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                  {plan.missingDecisions.map((item) => <li key={item}>{item}</li>)}
                </ul>
              )}
            </div>
            <div className={cardClass}>
              <h3 className="text-sm font-bold">Resource conflicts</h3>
              {plan.resourceConflicts.length === 0 ? (
                <p className="mt-2 text-sm text-muted">None found in the recorded graph.</p>
              ) : (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
                  {plan.resourceConflicts.map((item) => <li key={item}>{item}</li>)}
                </ul>
              )}
            </div>
          </div>

          <div className={`${cardClass} mt-3`}>
            <h3 className="text-sm font-bold">Assumptions</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
              {plan.assumptions.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <p className="mt-2 text-sm text-muted">
              Human review points: {plan.reviewPoints.length === 0
                ? "none recorded — add review dates before starting work."
                : plan.reviewPoints.map((item) => `${item.title} (${item.reviewAt})`).join("; ")}
            </p>
          </div>
        </section>

        <section aria-labelledby="projects-heading" className="mt-10">
          <h2 id="projects-heading" className="text-xl font-bold">Related projects</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Links are explicit and read-only. Project access and project limits stay in force.
          </p>
          {detail.projects.length === 0 ? (
            <p className={`${cardClass} mt-3 text-sm text-muted`}>No projects linked yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {detail.projects.map((link) => {
                const summary = detail.projectSummaries.find((project) => project.id === link.project_id);
                return (
                  <li key={link.id} className={cardClass}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{summary?.name ?? link.label}</p>
                        <p className="mt-1 text-xs text-muted">
                          {summary
                            ? `${summary.status} · version ${summary.current_version}`
                            : "Project details are not visible to you; only the explicit mission link is shown."}
                        </p>
                      </div>
                      <span className={chipClass}>{link.label}</span>
                    </div>
                    {canManage ? (
                      <UnlinkProjectButton missionId={mission.id} workspaceId={workspaceId} linkId={link.id} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {canManage ? (
            <div className="mt-3">
              <LinkProjectForm
                missionId={mission.id}
                workspaceId={workspaceId}
                projects={detail.availableProjects}
              />
            </div>
          ) : null}
        </section>

        <section aria-labelledby="deliverables-heading" className="mt-10">
          <h2 id="deliverables-heading" className="text-xl font-bold">Deliverables and dependencies</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Dates are review points. A blocked or cancelled dependency pauses downstream work.
          </p>

          {milestones.length === 0 ? (
            <p className={`${cardClass} mt-3 text-sm text-muted`}>No deliverables yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {milestones.map((milestone) => (
                <li key={milestone.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{milestone.title}</p>
                      <p className="mt-1 text-xs text-muted">
                        Owner: {nameOf(milestone.owner_id)} · Review{" "}
                        {milestone.review_at ?? "not set"} · Target {milestone.due_at ?? "not set"}
                      </p>
                    </div>
                    <span className={chipClass}>{milestoneStatusLabel(milestone.status)}</span>
                  </div>
                  {milestone.description ? (
                    <p className="mt-2 whitespace-pre-line text-sm text-muted">{milestone.description}</p>
                  ) : null}
                  {canManage ? (
                    <MilestoneStatusForm
                      missionId={mission.id}
                      workspaceId={workspaceId}
                      milestone={milestone}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {milestoneDependencies.length > 0 ? (
            <div className={`${cardClass} mt-3`}>
              <h3 className="text-sm font-bold">Dependencies</h3>
              <ul className="mt-2 space-y-1 text-sm text-muted">
                {milestoneDependencies.map((dependency) => (
                  <li key={dependency.id}>
                    {milestoneTitle(dependency.milestone_id)} depends on{" "}
                    {milestoneTitle(dependency.depends_on_id)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {canManage ? (
            <div className="mt-3 space-y-3">
              <MilestoneForm
                missionId={mission.id}
                workspaceId={workspaceId}
                members={members}
                nextPosition={milestones.length}
              />
              <MilestoneDependencyForm
                missionId={mission.id}
                workspaceId={workspaceId}
                milestones={milestones}
              />
            </div>
          ) : null}
        </section>

        <section aria-labelledby="jobs-heading" className="mt-10">
          <h2 id="jobs-heading" className="text-xl font-bold">Agent jobs</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Jobs attach to existing project work and run only after their dependencies.
            Completed artifacts are preserved. {MISSION_CONTROL_NOTES.cancellation}
          </p>

          {jobs.length === 0 ? (
            <p className={`${cardClass} mt-3 text-sm text-muted`}>No agent jobs assigned yet.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {jobs.map((job) => (
                <li key={job.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{job.title}</p>
                      <p className="mt-1 text-xs text-muted">
                        {projectName(job.project_id)} · {milestoneTitle(job.milestone_id)} · role {job.role} ·{" "}
                        {job.budget_seconds}s / {job.budget_calls} calls
                      </p>
                    </div>
                    <span className={chipClass}>{jobStatusLabel(job.status)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-line text-sm text-muted">{job.objective}</p>
                  {job.blocker ? (
                    <p className="mt-2 rounded-xl border border-brand/40 bg-brand-soft/30 p-2 text-sm">
                      {job.blocker}
                    </p>
                  ) : null}
                  {job.error ? <p className="mt-2 text-sm text-danger">{job.error}</p> : null}
                  {job.output !== null ? (
                    <p className="mt-2 text-sm">
                      <span className="font-semibold">Saved evidence: </span>
                      {evidenceSummary(job.output)}
                    </p>
                  ) : null}
                  {jobDependencies.some((dependency) => dependency.job_id === job.id) ? (
                    <p className="mt-2 text-xs text-muted">
                      Waits for{" "}
                      {jobDependencies
                        .filter((dependency) => dependency.job_id === job.id)
                        .map((dependency) => jobTitle(dependency.depends_on_job_id))
                        .join(", ")}
                    </p>
                  ) : null}
                  {canManage ? (
                    <JobActions missionId={mission.id} workspaceId={workspaceId} job={job} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {canManage ? (
            <div className="mt-3 space-y-3">
              <AgentJobForm
                missionId={mission.id}
                workspaceId={workspaceId}
                projects={linkedProjects}
                tasks={detail.projectTasks}
                milestones={milestones}
              />
              <JobDependencyForm missionId={mission.id} workspaceId={workspaceId} jobs={jobs} />
              <CancelMissionJobsForm missionId={mission.id} workspaceId={workspaceId} />
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">
              Only owners and admins assign, start or cancel agent jobs.
            </p>
          )}
        </section>

        <section aria-labelledby="approvals-heading" className="mt-10">
          <h2 id="approvals-heading" className="text-xl font-bold">Approvals and escalation</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            External writes and deployments need their own approval. A requester cannot
            approve their own request, and an agent cannot approve its own permission increase.
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
                      <div>
                        <p className="font-semibold">{approvalKindLabel(approval.kind)}: {approval.summary}</p>
                        <p className="mt-1 text-xs text-muted">
                          Requested by {nameOf(approval.requested_by)} · {approval.status}
                        </p>
                      </div>
                      <span className={chipClass}>{approval.status}</span>
                    </div>
                    <p className="mt-2 whitespace-pre-line text-sm text-muted">{approval.scope}</p>
                    <p className="mt-2 text-xs text-muted">{approvalKindNote(approval.kind)}</p>
                    {approval.note ? <p className="mt-1 text-xs text-muted">Note: {approval.note}</p> : null}
                    {canManage && approval.status === "pending" ? (
                      problem.ok ? (
                        <ApprovalDecisionForm
                          missionId={mission.id}
                          workspaceId={workspaceId}
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
            <ApprovalRequestForm missionId={mission.id} workspaceId={workspaceId} />
          </div>
        </section>

        <section aria-labelledby="limits-heading" className="mt-10">
          <h2 id="limits-heading" className="text-xl font-bold">Limits</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Mission limits are additional to project limits. They do not raise a project&apos;s cap.
          </p>
          <div className="mt-3">
            {canManage ? (
              <MissionLimitsForm mission={mission} />
            ) : (
              <div className={cardClass}>
                <p className="text-sm">
                  {limits.max_parallel_jobs} running at once · {limits.max_agent_jobs} jobs ·{" "}
                  {limits.max_runtime_seconds}s runtime · {limits.max_agent_calls} calls.
                </p>
                <p className="mt-1 text-xs text-muted">Only owners and admins change limits.</p>
              </div>
            )}
          </div>
        </section>

        <section aria-labelledby="events-heading" className="mt-10">
          <h2 id="events-heading" className="text-xl font-bold">Oversight trail</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Append-only records of claims, completions, cancellations and approvals.
          </p>
          {events.length === 0 ? (
            <p className={`${cardClass} mt-3 text-sm text-muted`}>No events yet.</p>
          ) : (
            <ul className="mt-3 space-y-1 text-sm">
              {events.map((event) => (
                <li key={event.id} className="rounded-xl border border-line bg-card px-3 py-2">
                  <span className="text-xs text-muted">{event.created_at.slice(0, 16).replace("T", " ")}</span>{" "}
                  <span className="font-medium">{event.kind}</span> — {event.detail}
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-8">
          <Link href={`/workspace/${workspaceId}/missions/${missionId}`} className={secondaryButton}>
            Back to the mission
          </Link>
        </p>
      </main>
    </div>
  );
}
