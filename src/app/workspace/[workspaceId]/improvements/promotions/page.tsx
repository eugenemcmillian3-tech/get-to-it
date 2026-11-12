import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { CANDIDATE_KIND_LABELS, VERDICT_LABELS, type Verdict } from "@/lib/improvement-candidates";
import { listPromotionAudit } from "@/lib/data/improvement-candidates";
import { getIdentity } from "@/lib/identity";
import { cardClass, chipClass } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Promotion audit — GET TO IT" };

function when(value: string | null): string {
  if (!value) return "not recorded";
  return new Date(value).toISOString().slice(0, 16).replace("T", " ");
}

function person(name: string | null, id: string | null): string {
  if (name) return name;
  if (id) return `member ${id.slice(0, 8)}`;
  return "not recorded";
}

export default async function PromotionAuditPage({
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
  const [identity, audit] = await Promise.all([
    getIdentity(session),
    listPromotionAudit(session, workspaceId),
  ]);
  if (!audit) notFound();

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-6">
        <Link
          href={`/workspace/${workspaceId}/improvements`}
          className="text-sm text-muted underline"
        >
          Back to improvement proposals
        </Link>

        <h1 className="mt-3 text-3xl font-black tracking-tight">Promotion audit</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          Every promoted proposal in this workspace with the deployment it rides on, the person who
          approved the change, the person who approved the promotion and the rollback that undoes
          it. A promotion never deploys anything itself; the deployment column is where the change
          actually ships.
        </p>

        <section aria-labelledby="promotions-heading" className="mt-8">
          <h2 id="promotions-heading" className="text-xl font-bold">
            Promoted changes
          </h2>
          {audit.rows.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              No proposal has been promoted in this workspace yet.
            </p>
          ) : (
            <ul className="mt-3 grid gap-4">
              {audit.rows.map((row) => (
                <li key={row.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="text-base font-bold">{row.title}</h3>
                      <p className="text-xs text-muted">
                        {CANDIDATE_KIND_LABELS[row.kind]} · promoted {when(row.promoted_at)}
                      </p>
                    </div>
                    <span className={chipClass}>
                      {row.verdict ? VERDICT_LABELS[row.verdict as Verdict] : "no verdict"}
                    </span>
                  </div>

                  <dl className="mt-3 grid gap-3 text-sm">
                    <div>
                      <dt className="font-semibold">Deployment</dt>
                      <dd className="text-muted">
                        {row.deployment ? (
                          <>
                            {row.deployment.target} deployment, {row.deployment.status.replaceAll("_", " ")}
                            {row.deployment.approval_at
                              ? `, plan approved ${when(row.deployment.approval_at)}`
                              : ", plan not approved"}
                            {row.deployment.deployment_url ? (
                              <>
                                {" · "}
                                <a
                                  href={row.deployment.deployment_url}
                                  className="underline"
                                  rel="noreferrer noopener"
                                  target="_blank"
                                >
                                  open the deployment
                                </a>
                              </>
                            ) : null}
                            {row.project_id ? (
                              <>
                                {" · "}
                                <Link
                                  href={`/build/${row.project_id}/deploy`}
                                  className="underline"
                                >
                                  deployment page
                                </Link>
                              </>
                            ) : null}
                            <span className="block text-xs">
                              {row.deployment.external_deployment_id
                                ? `external id ${row.deployment.external_deployment_id}`
                                : "no external deployment recorded"}
                            </span>
                          </>
                        ) : (
                          "the deployment is no longer recorded"
                        )}
                      </dd>
                    </div>

                    <div>
                      <dt className="font-semibold">Approved by</dt>
                      <dd className="text-muted">
                        {person(row.approved_by_name, row.approved_by)} on {when(row.approved_at)}
                      </dd>
                    </div>

                    <div>
                      <dt className="font-semibold">Promotion approved by</dt>
                      <dd className="text-muted">
                        {person(row.promotion_approved_by_name, row.promotion_approved_by)}
                      </dd>
                    </div>

                    <div>
                      <dt className="font-semibold">Rollback</dt>
                      <dd className="text-muted">{row.rollback_plan}</dd>
                    </div>

                    {row.review_note ? (
                      <div>
                        <dt className="font-semibold">Review note</dt>
                        <dd className="text-muted">{row.review_note}</dd>
                      </div>
                    ) : null}
                  </dl>

                  <p className="mt-2 text-xs text-muted">
                    Reference {row.promotion_ref ?? "not recorded"}
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
