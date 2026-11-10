import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrchestrationCreateForm } from "@/components/orchestration-forms";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { listOrchestrations } from "@/lib/data/orchestration";
import { getIdentity } from "@/lib/identity";
import {
  ORCHESTRATION_STATUS_LABELS,
  ORIGIN_LABELS,
  formatCredits,
} from "@/lib/orchestration";
import { cardClass, chipClass } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Orchestration — GET TO IT" };

function reviewDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  return date.toISOString().slice(0, 10);
}

export default async function OrchestrationsPage({
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
    listOrchestrations(session, workspaceId),
  ]);
  if (!list) notFound();

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-5xl px-5 pb-16 pt-6">
        <Link
          href={`/workspace/${workspaceId}`}
          className="rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink"
        >
          ← {list.workspace.name}
        </Link>

        <header className="mt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted">
            MAGI outcome orchestration
          </p>
          <h1 className="mt-1 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
            Approved goals, carried to evidenced outcomes
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
            An orchestration links an existing mission, experiment, learning goal,
            opportunity or earlier review and carries it through planning,
            execution, verification and a human outcome decision. It references
            those records by id; it never copies them into a competing store.
          </p>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted">
            MAGI is the product name for manifested, evidenced outcomes. It does
            not establish or claim AGI, superintelligence, consciousness or a
            technological singularity.
          </p>
        </header>

        <section aria-labelledby="orchestrations-heading" className="mt-8">
          <h2 id="orchestrations-heading" className="text-xl font-bold">
            Orchestrations in this workspace
          </h2>
          {list.orchestrations.length === 0 ? (
            <div className={`${cardClass} mt-3`}>
              <p className="text-sm text-muted">
                None yet. Draft a contract below; it stays a draft until a person
                approves that exact version.
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {list.orchestrations.map((orchestration) => (
                <li key={orchestration.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/workspace/${workspaceId}/orchestrations/${orchestration.id}`}
                        className="rounded text-sm font-bold underline decoration-line underline-offset-4 hover:text-ink"
                      >
                        {orchestration.goal}
                      </Link>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className={chipClass}>
                          {ORCHESTRATION_STATUS_LABELS[orchestration.status]}
                        </span>
                        <span className={chipClass}>
                          {ORIGIN_LABELS[orchestration.origin_kind]}
                        </span>
                        <span className={chipClass}>
                          Review {orchestration.review_at}
                        </span>
                        <span className={chipClass}>
                          {formatCredits(orchestration.consumed_micros)} used of{" "}
                          {formatCredits(orchestration.authorized_micros)}
                        </span>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="draft-heading" className="mt-8">
          <h2 id="draft-heading" className="text-xl font-bold">
            Draft a contract
          </h2>
          <div className="mt-3">
            <OrchestrationCreateForm
              workspaceId={workspaceId}
              candidates={list.candidates}
              defaultReviewAt={reviewDate()}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
