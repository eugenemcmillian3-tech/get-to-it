import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CreateResearchMissionForm,
  SeedSyntheticMissionForm,
} from "@/components/research-forms";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { listResearchMissions } from "@/lib/data/research";
import { getIdentity } from "@/lib/identity";
import { RESEARCH_NOTES, RESEARCH_STATUS_LABELS } from "@/lib/research-missions";
import { cardClass, chipClass, secondaryButton } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Research missions — GET TO IT" };

export default async function ResearchMissionsPage({
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
    listResearchMissions(session, workspaceId),
  ]);
  if (!list) notFound();

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-6">
        <Link href={`/workspace/${workspaceId}`} className="text-sm text-muted underline">
          Back to the workspace
        </Link>

        <h1 className="mt-3 text-3xl font-black tracking-tight">Research missions</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          A mission records a question, the explanations competing for it, and what
          would count as evidence. It runs on the existing orchestration layer and
          proposes an ordinary experiment; it is not a separate agent runtime.
        </p>

        <ul className="mt-4 grid gap-2 text-sm text-muted">
          <li>{RESEARCH_NOTES.provenance}</li>
          <li>{RESEARCH_NOTES.limits}</li>
          <li>{RESEARCH_NOTES.noAutomaticPublication}</li>
        </ul>

        <SeedSyntheticMissionForm workspaceId={workspaceId} />

        <CreateResearchMissionForm
          workspaceId={workspaceId}
          orchestrations={list.orchestrations}
        />

        <section aria-labelledby="missions-heading" className="mt-10">
          <h2 id="missions-heading" className="text-xl font-bold">
            Missions in this workspace
          </h2>
          {list.missions.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              No research mission yet. Write a contract above, or create the synthetic
              one to see the whole path.
            </p>
          ) : (
            <ul className="mt-3 grid gap-3">
              {list.missions.map((mission) => (
                <li key={mission.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-base font-bold">
                      <Link
                        href={`/workspace/${workspaceId}/research/${mission.id}`}
                        className="underline"
                      >
                        {mission.question}
                      </Link>
                    </h3>
                    <span className={chipClass}>
                      {RESEARCH_STATUS_LABELS[mission.status]}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted">{mission.scope}</p>
                  <p className="mt-2 text-xs text-muted">
                    {mission.task_budget} tasks · {mission.agent_budget} agents ·{" "}
                    {mission.retry_budget} retries · {mission.spend_ceiling_cents} cents ·{" "}
                    {mission.time_ceiling_minutes} minutes ·{" "}
                    {mission.orchestration_id ? "orchestration linked" : "no orchestration"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-10 text-sm text-muted">
          <Link href={`/workspace/${workspaceId}/experiments`} className={secondaryButton}>
            Open the experiment workspace
          </Link>
        </p>
      </main>
    </div>
  );
}
