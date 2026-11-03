import type { Metadata } from "next";
import Link from "next/link";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { InvitationResponseForm } from "@/components/workspace-forms";
import { requireSession } from "@/lib/auth";
import { getInvitationPreview } from "@/lib/data/workspaces";
import { getIdentity } from "@/lib/identity";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { ROLE_LABELS, formatWorkspaceTime } from "@/lib/workspaces";
import { cardClass, focusRing, secondaryButton } from "@/lib/styles";

export const metadata: Metadata = { title: "Workspace invitation — GET TO IT" };

export default async function WorkspaceJoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const { token } = await params;
  const [identity, preview] = await Promise.all([
    getIdentity(session),
    getInvitationPreview(session, token),
  ]);

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

        {preview ? (
          <>
            <h1 className="mt-4 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
              Join {preview.workspace_name}?
            </h1>
            <p className="mt-3 max-w-xl leading-relaxed text-muted">
              {preview.inviter_name} invited you as a{" "}
              <span className="font-semibold text-ink">
                {ROLE_LABELS[preview.role]}
              </span>
              . Joining shows you that workspace&apos;s shared goals, tasks and
              comments — nothing from your personal goals.
            </p>

            <div className={`${cardClass} mt-5`}>
              <p className="text-sm leading-relaxed">
                You will be able to see the shared work, add tasks, comment, and
                take on tasks assigned to you. Your personal goals, saved work,
                reflections and AI conversations stay private.
              </p>
              {preview.expires_at ? (
                <p className="mt-2 text-xs text-muted">
                  Invitation expires {formatWorkspaceTime(preview.expires_at)}.
                </p>
              ) : null}

              <InvitationResponseForm token={token} />
            </div>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
              That invitation didn&apos;t work
            </h1>
            <p className="mt-3 max-w-xl leading-relaxed text-muted">
              It may have expired, been used already, been cancelled, or be for a
              different email address. Nothing was joined.
            </p>
            <p className="mt-4">
              <Link href="/workspace" className={secondaryButton}>
                Back to workspaces
              </Link>
            </p>
          </>
        )}
      </main>
    </div>
  );
}
