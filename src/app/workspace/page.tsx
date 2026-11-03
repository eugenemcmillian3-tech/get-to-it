import type { Metadata } from "next";
import Link from "next/link";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { WorkspaceCreateForm } from "@/components/workspace-forms";
import { requireSession } from "@/lib/auth";
import { getMyNotificationCount, listMyWorkspaces } from "@/lib/data/workspaces";
import { getIdentity } from "@/lib/identity";
import { getSupabaseSettings } from "@/lib/supabase/config";
import {
  ROLE_LABELS,
  SOURCES_NOTE,
  formatWorkspaceTime,
} from "@/lib/workspaces";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";

export const metadata: Metadata = { title: "Workspaces — GET TO IT" };

export default async function WorkspacesPage() {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const [identity, workspaces, unread] = await Promise.all([
    getIdentity(session),
    listMyWorkspaces(session),
    getMyNotificationCount(session),
  ]);

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-3xl px-5 pb-16 pt-6">
        <Link
          href="/dashboard"
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← Back to your goals
        </Link>

        <h1 className="mt-4 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
          Workspaces
        </h1>
        <p className="mt-3 max-w-xl leading-relaxed text-muted">
          A small shared place for work that is genuinely shared. Personal goals,
          saved work, reflections and AI conversations are never visible here.
        </p>

        {unread > 0 ? (
          <p className="mt-3">
            <span className={chipClass}>
              {unread} unread workspace {unread === 1 ? "notification" : "notifications"}
            </span>
          </p>
        ) : null}

        <div className="mt-6">
          <WorkspaceCreateForm />
        </div>

        <section aria-labelledby="workspace-list-heading" className="mt-10">
          <h2 id="workspace-list-heading" className="text-lg font-bold">
            Your workspaces
          </h2>

          {workspaces.length === 0 ? (
            <div className={`${cardClass} mt-3`}>
              <p className="font-medium">No workspaces yet.</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Create one when you have someone to work with. You become its
                owner, and nothing personal is added to it.
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {workspaces.map((workspace) => (
                <li key={workspace.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-lg font-semibold leading-snug">
                      <Link
                        href={`/workspace/${workspace.id}`}
                        className={`rounded hover:underline ${focusRing}`}
                      >
                        {workspace.name}
                      </Link>
                    </h3>
                    <span className={chipClass}>{ROLE_LABELS[workspace.role]}</span>
                  </div>
                  {workspace.description ? (
                    <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted">
                      {workspace.description}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-muted">
                    Started {formatWorkspaceTime(workspace.created_at)}
                  </p>
                  <p className="mt-3">
                    <Link href={`/workspace/${workspace.id}`} className={secondaryButton}>
                      Open workspace
                    </Link>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="join-heading" className="mt-10 border-t border-line pt-6">
          <h2 id="join-heading" className="text-lg font-bold">
            Have an invitation?
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Open the link the owner sent you. It works once, expires after seven
            days, and only the account with that email address can accept it.
          </p>
        </section>

        <p className="mt-8 text-xs leading-relaxed text-muted">{SOURCES_NOTE}</p>
      </main>
    </div>
  );
}
