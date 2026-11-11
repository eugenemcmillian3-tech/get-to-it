import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import {
  CopyPersonalGoalForm,
  DeleteWorkspaceForm,
  InvitationLinkField,
  LeaveWorkspaceForm,
  MemberRoleForm,
  NotificationPrefsForm,
  RemoveMemberForm,
  ShareGoalForm,
  WorkspaceInviteForm,
  WorkspaceSettingsForm,
} from "@/components/workspace-forms";
import {
  cancelWorkspaceInvitationAction,
  markNotificationsReadAction,
} from "@/lib/actions/workspaces";
import { requireSession } from "@/lib/auth";
import { getWorkspaceOverview } from "@/lib/data/workspaces";
import { getIdentity } from "@/lib/identity";
import { getSupabaseSettings } from "@/lib/supabase/config";
import {
  PERMISSION_MATRIX,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  SOURCES_NOTE,
  canLeaveWorkspace,
  canRemoveMember,
  eventLabel,
  formatWorkspaceTime,
  inboxWhen,
  memberLabel,
  memberStatusLabel,
  normalizeNotificationPrefs,
  sortMembers,
  workspaceProgress,
} from "@/lib/workspaces";
import {
  cardClass,
  chipClass,
  focusRing,
  quietButton,
  secondaryButton,
} from "@/lib/styles";

export const metadata: Metadata = { title: "Workspace — GET TO IT" };

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const { workspaceId } = await params;
  const [identity, overview] = await Promise.all([
    getIdentity(session),
    getWorkspaceOverview(session, workspaceId),
  ]);
  if (!overview) notFound();

  const { workspace, myRole, members, goals, tasks, events, invitations, unread, seatLimit } =
    overview;
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const origin = host ? `${protocol}://${host}` : "";
  const progress = workspaceProgress(goals, tasks, session.user.id);
  const memberById = new Map(members.map((member) => [member.user_id, member]));
  const activeMembers = sortMembers(members.filter((member) => member.status === "active"));
  const seatsUsed = activeMembers.length + invitations.length;
  const hasFreeSeat = seatsUsed < seatLimit;
  const formerMembers = sortMembers(members.filter((member) => member.status !== "active"));
  const canManageGoals = myRole === "owner" || myRole === "admin";

  const allowed = PERMISSION_MATRIX.filter((row) => row.allowed[myRole]);

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-3xl px-5 pb-16 pt-6">
        <Link
          href="/workspace"
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← All workspaces
        </Link>

        <header className="mt-4">
          <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">
            {workspace.name}
          </h1>
          {workspace.description ? (
            <p className="mt-2 max-w-xl leading-relaxed text-muted">
              {workspace.description}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <span className={chipClass}>{ROLE_LABELS[myRole]}</span>
            <span className={chipClass}>
              {activeMembers.length} {activeMembers.length === 1 ? "member" : "members"} ·{" "}
              {seatsUsed} of {seatLimit} seats used
            </span>
            <span className={chipClass}>
              {progress.tasksDone} of {progress.tasksTotal} tasks done
            </span>
          </div>

          <p className="mt-2 text-sm leading-relaxed text-muted">
            {ROLE_DESCRIPTIONS[myRole]}
          </p>
        </header>

        <p className="mt-5 flex flex-wrap gap-2">
          <Link href={`/workspace/${workspaceId}/missions`} className={secondaryButton}>
            Missions
          </Link>
          <Link href={`/workspace/${workspaceId}/experiments`} className={secondaryButton}>
            Experiments
          </Link>
          <Link
            href={`/workspace/${workspaceId}/orchestrations`}
            className={secondaryButton}
          >
            Orchestration
          </Link>
          <Link href={`/workspace/${workspaceId}/knowledge`} className={secondaryButton}>
            Knowledge
          </Link>
        </p>

        <section aria-labelledby="progress-heading" className="mt-8">
          <h2 id="progress-heading" className="text-lg font-bold">
            Shared progress
          </h2>
          <div className={`${cardClass} mt-3`}>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress.percent}
              aria-label="Shared task completion"
              className="h-2.5 w-full overflow-hidden rounded-full bg-line"
            >
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Goals
                </dt>
                <dd>
                  {progress.goalsDone} of {progress.goalsTotal} finished
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Tasks
                </dt>
                <dd>
                  {progress.tasksDone} of {progress.tasksTotal} complete
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Assigned to you
                </dt>
                <dd>
                  {progress.myTasksDone} of {progress.myTasksTotal} complete
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-xs leading-relaxed text-muted">{SOURCES_NOTE}</p>
          </div>
        </section>

        <section aria-labelledby="inbox-heading" className="mt-10">
          <h2 id="inbox-heading" className="text-lg font-bold">
            Your workspace inbox
          </h2>

          {unread.length === 0 ? (
            <p className="mt-2 rounded-xl border border-dashed border-line p-4 text-sm text-muted">
              Nothing unread. Assignments, comments and role changes arrive here;
              nothing is sent by email, SMS or push.
            </p>
          ) : (
            <>
              <ul className="mt-3 space-y-2">
                {unread.map((notification) => (
                  <li key={notification.id} className="rounded-xl border border-line bg-card p-3">
                    <p className="text-sm font-medium">{notification.summary}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {inboxWhen(notification.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
              <form action={markNotificationsReadAction} className="mt-2">
                <input type="hidden" name="workspace_id" value={workspace.id} />
                <button type="submit" className={quietButton}>
                  Mark all as read
                </button>
              </form>
            </>
          )}

          <NotificationPrefsForm
            workspaceId={workspace.id}
            prefs={normalizeNotificationPrefs(overview.prefs)}
          />
        </section>

        <section aria-labelledby="members-heading" className="mt-10">
          <h2 id="members-heading" className="text-lg font-bold">
            Members
          </h2>

          <ul className="mt-3 space-y-2">
            {activeMembers.map((member) => (
              <li key={member.user_id} className={cardClass}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    {member.display_name}
                    {member.user_id === session.user.id ? (
                      <span className="ml-1 text-sm font-normal text-muted">(you)</span>
                    ) : null}
                  </p>
                  <span className={chipClass}>{ROLE_LABELS[member.role]}</span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  Joined {formatWorkspaceTime(member.joined_at)}
                </p>

                {myRole === "owner" && member.user_id !== session.user.id ? (
                  <>
                    <MemberRoleForm
                      workspaceId={workspace.id}
                      member={{
                        user_id: member.user_id,
                        display_name: member.display_name,
                        role: member.role,
                        status: member.status,
                      }}
                    />
                    {canRemoveMember(myRole, member.role) ? (
                      <RemoveMemberForm
                        workspaceId={workspace.id}
                        member={{
                          user_id: member.user_id,
                          display_name: member.display_name,
                          role: member.role,
                          status: member.status,
                        }}
                      />
                    ) : null}
                  </>
                ) : null}
              </li>
            ))}
          </ul>

          {formerMembers.length > 0 ? (
            <div className="mt-4">
              <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-muted">
                Former members
              </h3>
              <ul className="mt-2 space-y-1 text-sm text-muted">
                {formerMembers.map((member) => (
                  <li key={member.user_id}>
                    {memberLabel(member)} · {memberStatusLabel(member.status)} ·{" "}
                    {ROLE_LABELS[member.role]}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                A former member keeps their comments, attributed by user id, and
                anything they created stays with the workspace.
              </p>
            </div>
          ) : null}

          {myRole === "owner" ? (
            <div className="mt-5">
              <h3 className="text-sm font-bold">Invite someone</h3>
              {hasFreeSeat ? (
                <WorkspaceInviteForm workspaceId={workspace.id} />
              ) : (
                <p className="mt-2 rounded-xl border border-line bg-card p-3 text-sm leading-relaxed">
                  No free seats. This workspace has {seatLimit} paid seat
                  {seatLimit === 1 ? "" : "s"}.{" "}
                  <Link href="/billing" className={`font-semibold underline ${focusRing}`}>
                    Buy team seats under Plans
                  </Link>{" "}
                  or cancel a pending invitation.
                </p>
              )}

              {invitations.length > 0 ? (
                <div className="mt-4">
                  <h4 className="text-xs font-bold uppercase tracking-[0.15em] text-muted">
                    Pending invitations
                  </h4>
                  <ul className="mt-2 space-y-2">
                    {invitations.map((invitation) => (
                      <li
                        key={invitation.id}
                        className="rounded-xl border border-line bg-card p-3"
                      >
                        <p className="text-sm font-semibold">{invitation.invitee_email}</p>
                        <p className="mt-0.5 text-xs text-muted">
                          {ROLE_LABELS[invitation.role]} · expires{" "}
                          {formatWorkspaceTime(invitation.expires_at)}
                        </p>
                        <InvitationLinkField
                          invitationId={invitation.id}
                          link={`${origin}/workspace/join/${invitation.token}`}
                        />
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <Link
                            href={`/workspace/join/${invitation.token}`}
                            className={`rounded text-sm font-semibold text-ink underline decoration-line underline-offset-4 ${focusRing}`}
                          >
                            Open the link
                          </Link>
                          <form action={cancelWorkspaceInvitationAction}>
                            <input type="hidden" name="invitation_id" value={invitation.id} />
                            <input type="hidden" name="workspace_id" value={workspace.id} />
                            <button type="submit" className={quietButton}>
                              Cancel
                            </button>
                          </form>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <section aria-labelledby="goals-heading" className="mt-10">
          <h2 id="goals-heading" className="text-lg font-bold">
            Shared goals
          </h2>

          {goals.length === 0 ? (
            <p className="mt-2 rounded-xl border border-dashed border-line p-4 text-sm text-muted">
              No shared goals yet. Personal goals are never added automatically.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {goals.map((goal) => {
                const own = tasks.filter((task) => task.goal_id === goal.id);
                const done = own.filter((task) => task.status === "completed").length;

                return (
                  <li key={goal.id} className={cardClass}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="text-lg font-semibold leading-snug">
                        <Link
                          href={`/workspace/${workspace.id}/goals/${goal.id}`}
                          className={`rounded hover:underline ${focusRing}`}
                        >
                          {goal.title}
                        </Link>
                      </h3>
                      {goal.archived_at ? (
                        <span className={chipClass}>Archived</span>
                      ) : null}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted">
                      {goal.desired_outcome}
                    </p>
                    <p className="mt-2 text-xs text-muted">
                      {done} of {own.length} tasks complete
                      {goal.source_goal_id ? " · copied from a personal goal" : ""}
                    </p>
                    <p className="mt-3">
                      <Link
                        href={`/workspace/${workspace.id}/goals/${goal.id}`}
                        className={secondaryButton}
                      >
                        Open shared goal
                      </Link>
                    </p>
                  </li>
                );
              })}
            </ul>
          )}

          {canManageGoals ? (
            <>
              <ShareGoalForm workspaceId={workspace.id} />
              <CopyPersonalGoalForm
                workspaceId={workspace.id}
                candidates={overview.copyCandidates}
              />
            </>
          ) : (
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Owners and admins create shared goals. You can add tasks inside the
              goals that exist, and pick up work assigned to you.
            </p>
          )}
        </section>

        <section aria-labelledby="activity-heading" className="mt-10">
          <h2 id="activity-heading" className="text-lg font-bold">
            Membership and permission changes
          </h2>
          <p className="mt-1 text-sm text-muted">
            Roles and ids only — this log never records private content.
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {events.length === 0 ? (
              <li className="text-muted">Nothing logged yet.</li>
            ) : (
              events.map((event) => {
                const actor = event.actor_id ? memberById.get(event.actor_id) : undefined;
                return (
                  <li key={event.id} className="rounded-lg border border-line bg-card px-3 py-2">
                    <span className="font-medium">{eventLabel(event.kind)}</span>
                    {event.detail ? <span className="text-muted"> · {event.detail}</span> : null}
                    <span className="block text-xs text-muted">
                      {actor ? `${memberLabel(actor)} · ` : ""}
                      {formatWorkspaceTime(event.created_at)}
                    </span>
                  </li>
                );
              })
            )}
          </ul>
        </section>

        <section aria-labelledby="role-heading" className="mt-10">
          <h2 id="role-heading" className="text-lg font-bold">
            What your role allows
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {allowed.map((row) => (
              <li key={row.permission} className={chipClass}>
                {row.label}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            The database re-checks your role on every request. Changing what the
            page shows does not change what you can do.
          </p>
        </section>

        {myRole === "owner" ? (
          <section aria-labelledby="settings-heading" className="mt-10 border-t border-line pt-6">
            <h2 id="settings-heading" className="text-lg font-bold">
              Workspace settings
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              Only the owner can rename or delete a workspace, invite people, change
              roles and remove members.
            </p>
            <WorkspaceSettingsForm
              workspaceId={workspace.id}
              name={workspace.name}
              description={workspace.description}
            />
          </section>
        ) : null}

        <section aria-labelledby="leave-heading" className="mt-10 border-t border-line pt-6">
          <h2 id="leave-heading" className="text-lg font-bold">
            Leaving
          </h2>

          {canLeaveWorkspace(myRole) ? (
            <LeaveWorkspaceForm workspaceId={workspace.id} />
          ) : (
            <p className="mt-2 rounded-xl border border-line bg-card p-3 text-sm leading-relaxed">
              You are the owner. A workspace needs an owner, so make someone else
              the owner first — that demotes you to admin and lets you leave — or
              delete the workspace below.
            </p>
          )}

          {myRole === "owner" ? (
            <DeleteWorkspaceForm workspaceId={workspace.id} workspaceName={workspace.name} />
          ) : null}
        </section>
      </main>
    </div>
  );
}
