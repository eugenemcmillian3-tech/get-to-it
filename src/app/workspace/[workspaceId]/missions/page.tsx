import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MissionCreateForm } from "@/components/mission-forms";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { listMissions } from "@/lib/data/missions";
import { getIdentity } from "@/lib/identity";
import {
  MISSION_STATUSES,
  PRIVACY_NOTE,
  canManageMissions,
  categoryLabel,
  reviewDue,
  statusLabel,
} from "@/lib/missions";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Missions — GET TO IT" };

export default async function MissionsPage({
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
  const [identity, list] = await Promise.all([
    getIdentity(session),
    listMissions(session, workspaceId),
  ]);

  if (!list) notFound();

  const today = new Date().toISOString().slice(0, 10);
  const canCreate = canManageMissions(list.myRole);

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-3xl px-5 pb-16 pt-6">
        <Link
          href={`/workspace/${workspaceId}`}
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← {list.workspace.name}
        </Link>

        <h1 className="mt-4 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
          Missions
        </h1>
        <p className="mt-3 max-w-xl leading-relaxed text-muted">
          Shared problems with a written record: who is affected, what a good
          outcome is, what is assumed, who decides, and what actually changed.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted">{PRIVACY_NOTE}</p>

        <section aria-labelledby="mission-list" className="mt-8">
          <h2 id="mission-list" className="text-xl font-bold">
            In this workspace
          </h2>

          {list.missions.length === 0 ? (
            <div className={`${cardClass} mt-3`}>
              <p className="font-medium">No missions yet.</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                A mission starts with a problem worth naming. It begins as a draft,
                and nothing is expected of anyone until the group agrees.
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {list.missions.map((mission) => {
                const due = reviewDue(mission.review_at, today);
                return (
                  <li key={mission.id} className={cardClass}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="text-lg font-semibold leading-snug">
                        <Link
                          href={`/workspace/${workspaceId}/missions/${mission.id}`}
                          className={`rounded hover:underline ${focusRing}`}
                        >
                          {mission.title}
                        </Link>
                      </h3>
                      <span className={chipClass}>{statusLabel(mission.status)}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted">
                      {categoryLabel(mission.category)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
                      <span className={chipClass}>
                        {mission.review_at
                          ? `Review ${mission.review_at}${due ? " — due" : ""}`
                          : "No review date"}
                      </span>
                      <span className={chipClass}>
                        Started {mission.created_at.slice(0, 10)}
                      </span>
                    </div>
                    <p className="mt-3">
                      <Link
                        href={`/workspace/${workspaceId}/missions/${mission.id}`}
                        className={secondaryButton}
                      >
                        Open the mission
                      </Link>
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {canCreate ? (
          <section aria-labelledby="new-mission" className="mt-10">
            <h2 id="new-mission" className="sr-only">
              New mission
            </h2>
            <MissionCreateForm workspaceId={workspaceId} />
          </section>
        ) : (
          <p className={`${cardClass} mt-8 text-sm leading-relaxed text-muted`}>
            Only owners and admins create missions. As a member you can add
            evidence, tasks, outcomes and questions, and you can challenge any AI
            suggestion.
          </p>
        )}

        <p className="mt-8 text-xs leading-relaxed text-muted">
          {MISSION_STATUSES.map((status) => `${status.label}: ${status.note}`).join(" ")}
        </p>

        <p className="mt-4">
          <Link href={`/workspace/${workspaceId}`} className={secondaryButton}>
            Back to the workspace
          </Link>
        </p>
      </main>
    </div>
  );
}
