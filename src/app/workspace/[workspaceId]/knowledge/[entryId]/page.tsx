import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  CorrectionForm,
  DecideCorrectionForm,
  DecideTransferForm,
  EvidenceForm,
  ImpactForm,
  LinkSourceForm,
  RetractForm,
  ReviewForm,
  SupersedeForm,
  TransferForm,
  VerificationForm,
} from "@/components/knowledge-forms";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { getKnowledgeEntry } from "@/lib/data/knowledge";
import { getIdentity } from "@/lib/identity";
import {
  AI_SUGGESTION_NOTE,
  CLAIM_TYPE_LABELS,
  CLAIM_TYPE_NOTES,
  CORRECTION_KIND_LABELS,
  CORRECTION_STATUS_LABELS,
  EVIDENCE_STANCE_LABELS,
  KNOWLEDGE_KIND_LABELS,
  PRIVACY_TRANSFER_NOTE,
  SOURCE_KIND_LABELS,
  TRANSFER_STATUS_LABELS,
  VERIFICATION_STATUS_LABELS,
  VERIFICATION_STATUS_NOTES,
  canApproveTransfer,
  canVerifyEntry,
  entryStateLabel,
  impactSummary,
  supersedePlan,
} from "@/lib/knowledge";
import { cardClass, chipClass } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Knowledge entry — GET TO IT" };

function date(value: string | null): string {
  return value === null ? "Not set" : value.slice(0, 10);
}

function nextReview(): string {
  const when = new Date();
  when.setDate(when.getDate() + 90);
  return when.toISOString().slice(0, 10);
}

export default async function KnowledgeEntryPage({
  params,
}: {
  params: Promise<{ workspaceId: string; entryId: string }>;
}) {
  const { workspaceId, entryId } = await params;

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
    getKnowledgeEntry(session, workspaceId, entryId),
  ]);
  if (!detail) notFound();

  const { entry, myRole } = detail;
  const canVerify = canVerifyEntry({ role: myRole, entry, userId: session.user.id });
  const canDecideTransfer = canApproveTransfer(myRole);
  const plan = supersedePlan(entry);
  const impacts = impactSummary(detail.impacts, entry);
  const supporting = detail.evidence.filter((row) => row.stance === "supports").length;
  const contradicting = detail.evidence.length - supporting;

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-4xl px-5 pb-16 pt-6">
        <Link
          href={`/workspace/${workspaceId}/knowledge`}
          className="rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink"
        >
          ← Knowledge
        </Link>

        <header className="mt-4">
          <div className="flex flex-wrap gap-2">
            <span className={chipClass}>{KNOWLEDGE_KIND_LABELS[entry.kind]}</span>
            <span className={chipClass}>{CLAIM_TYPE_LABELS[entry.claim_type]}</span>
            <span className={chipClass}>{entry.domain}</span>
            <span className={chipClass}>{entryStateLabel(entry)}</span>
            <span className={chipClass}>Version {entry.version}</span>
          </div>
          <h1 className="mt-2 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
            {entry.title}
          </h1>
          <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted">
            {entry.statement}
          </p>
          {entry.claim_type === "ai_suggestion" ? (
            <p className="mt-2 rounded-xl border border-line bg-card p-3 text-xs leading-relaxed text-muted">
              {AI_SUGGESTION_NOTE}
            </p>
          ) : null}
        </header>

        {detail.missingSources.length > 0 ? (
          <section className="mt-6 rounded-2xl border border-danger/40 bg-card p-4">
            <h2 className="text-sm font-bold text-danger">
              A linked record is gone or no longer readable
            </h2>
            <p className="mt-1 text-sm text-muted">
              {detail.missingSources.length} source
              {detail.missingSources.length === 1 ? " is" : "s are"} missing. The claim is
              not supported by them any more, and nothing was rewritten to hide that.
            </p>
            <ul className="mt-2 list-disc pl-5 text-sm text-muted">
              {detail.missingSources.map((source) => (
                <li key={source.id}>
                  {SOURCE_KIND_LABELS[source.source_kind]} · {source.source_id}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="record-heading" className="mt-8">
          <h2 id="record-heading" className="text-xl font-bold">
            The record
          </h2>
          <dl className={`${cardClass} mt-3 grid gap-3 text-sm sm:grid-cols-2`}>
            <div>
              <dt className="font-semibold">Applies when</dt>
              <dd className="text-muted">{entry.applies_when.trim() || "Not stated"}</dd>
            </div>
            <div>
              <dt className="font-semibold">Known limitations</dt>
              <dd className="whitespace-pre-line text-muted">
                {entry.limitations.trim() || "None recorded"}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Authorized scope</dt>
              <dd className="text-muted">{entry.authorized_scope}</dd>
            </div>
            <div>
              <dt className="font-semibold">Verification</dt>
              <dd className="text-muted">
                {VERIFICATION_STATUS_LABELS[entry.verification_status]} ·{" "}
                {VERIFICATION_STATUS_NOTES[entry.verification_status]}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Basis</dt>
              <dd className="text-muted">{entry.verification_note.trim() || "None recorded"}</dd>
            </div>
            <div>
              <dt className="font-semibold">Owner</dt>
              <dd className="text-muted">
                {entry.owner_id === session.user.id
                  ? "You"
                  : `Another member · ${entry.owner_id.slice(0, 8)}`}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Created / reviewed</dt>
              <dd className="text-muted">
                {date(entry.created_at)} · last reviewed {date(entry.last_reviewed_at)}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Next review</dt>
              <dd className="text-muted">{date(entry.review_at)}</dd>
            </div>
            <div>
              <dt className="font-semibold">Retention</dt>
              <dd className="text-muted">
                {entry.retention_note.trim() || "No retention note"}
                {entry.delete_after === null ? "" : ` · delete after ${entry.delete_after}`}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Provenance</dt>
              <dd className="text-muted">{entry.provenance.trim() || "Recorded here"}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted">{CLAIM_TYPE_NOTES[entry.claim_type]}</p>
        </section>

        <section aria-labelledby="sources-heading" className="mt-8">
          <h2 id="sources-heading" className="text-xl font-bold">
            Source records
          </h2>
          {detail.sources.length === 0 ? (
            <p className={`${cardClass} mt-3 text-sm text-muted`}>
              Nothing linked yet. A claim with no source is not supported by anything.
            </p>
          ) : (
            <ul className="mt-3 grid gap-2">
              {detail.sources.map((source) => (
                <li key={source.id} className={`${cardClass} text-sm`}>
                  <span className="font-semibold">{SOURCE_KIND_LABELS[source.source_kind]}</span>
                  {source.label.trim() === "" ? null : ` · ${source.label}`}
                  {source.source_id === null ? null : (
                    <span className="text-muted"> · {source.source_id.slice(0, 8)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {entry.status === "active" ? (
            <LinkSourceForm
              workspaceId={workspaceId}
              entryId={entry.id}
              candidates={detail.candidates}
            />
          ) : null}
        </section>

        <section aria-labelledby="evidence-heading" className="mt-8">
          <h2 id="evidence-heading" className="text-xl font-bold">
            Supporting and contradicting evidence
          </h2>
          <p className="mt-1 text-sm text-muted">
            {supporting} supporting · {contradicting} contradicting. Evidence is appended and
            never edited.
          </p>
          {detail.evidence.length === 0 ? (
            <p className={`${cardClass} mt-3 text-sm text-muted`}>No evidence recorded yet.</p>
          ) : (
            <ul className="mt-3 grid gap-2">
              {detail.evidence.map((item) => (
                <li key={item.id} className={`${cardClass} text-sm`}>
                  <div className="flex flex-wrap gap-2">
                    <span className={chipClass}>{EVIDENCE_STANCE_LABELS[item.stance]}</span>
                    <span className={chipClass}>{CLAIM_TYPE_LABELS[item.evidence_kind]}</span>
                    {item.observed_at === null ? null : (
                      <span className={chipClass}>{item.observed_at}</span>
                    )}
                  </div>
                  <p className="mt-2 whitespace-pre-line text-muted">{item.detail}</p>
                </li>
              ))}
            </ul>
          )}
          {entry.status === "active" ? (
            <EvidenceForm
              workspaceId={workspaceId}
              entryId={entry.id}
              candidates={detail.candidates}
            />
          ) : null}
        </section>

        <section aria-labelledby="verification-heading" className="mt-8">
          <h2 id="verification-heading" className="text-xl font-bold">
            Verification and versions
          </h2>
          {canVerify && entry.status === "active" ? (
            <>
              <VerificationForm workspaceId={workspaceId} entryId={entry.id} />
              <ReviewForm
                workspaceId={workspaceId}
                entryId={entry.id}
                nextReviewAt={entry.review_at ?? nextReview()}
              />
              <details className={`${cardClass} mt-3`}>
                <summary className="cursor-pointer text-sm font-semibold">
                  Write a new version (this one becomes v{entry.version} history)
                </summary>
                <SupersedeForm
                  workspaceId={workspaceId}
                  entryId={entry.id}
                  title={entry.title}
                  statement={entry.statement}
                  limitations={entry.limitations}
                />
              </details>
              <details className={`${cardClass} mt-3`}>
                <summary className="cursor-pointer text-sm font-semibold">
                  Retract this entry
                </summary>
                <RetractForm workspaceId={workspaceId} entryId={entry.id} />
              </details>
            </>
          ) : (
            <p className={`${cardClass} mt-3 text-sm text-muted`}>
              {entry.status === "active"
                ? "Only the entry owner or a workspace owner or admin can change verification."
                : `This version is ${entryStateLabel(entry).toLowerCase()}. It stays readable and is never presented as current guidance.`}
            </p>
          )}

          {detail.versions.length > 1 ? (
            <ul className="mt-3 grid gap-2">
              {detail.versions
                .slice()
                .sort((a, b) => a.version - b.version)
                .map((version) => (
                  <li key={version.id} className={`${cardClass} text-sm text-muted`}>
                    v{version.version} · {entryStateLabel(version)}
                    {version.id === entry.id ? (
                      " · this version"
                    ) : (
                      <Link
                        href={`/workspace/${workspaceId}/knowledge/${version.id}`}
                        className="ml-2 underline decoration-line underline-offset-4 hover:text-ink"
                      >
                        Open
                      </Link>
                    )}
                  </li>
                ))}
            </ul>
          ) : null}
          <p className="mt-2 text-xs text-muted">
            Next version number would be v{plan.nextVersion}. A new version starts unverified.
          </p>
        </section>

        <section aria-labelledby="corrections-heading" className="mt-8">
          <h2 id="corrections-heading" className="text-xl font-bold">
            Corrections and disputes
          </h2>
          <p className="mt-1 text-sm text-muted">
            Anyone in the workspace can correct or dispute an entry. Accepting one supersedes
            or retracts it; the earlier version is kept.
          </p>
          {detail.corrections.length === 0 ? (
            <p className={`${cardClass} mt-3 text-sm text-muted`}>None recorded.</p>
          ) : (
            <ul className="mt-3 grid gap-2">
              {detail.corrections.map((correction) => (
                <li key={correction.id} className={`${cardClass} text-sm`}>
                  <div className="flex flex-wrap gap-2">
                    <span className={chipClass}>
                      {CORRECTION_KIND_LABELS[correction.kind]}
                    </span>
                    <span className={chipClass}>
                      {CORRECTION_STATUS_LABELS[correction.status]}
                    </span>
                    <span className={chipClass}>{date(correction.created_at)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-line text-muted">{correction.detail}</p>
                  {correction.proposed_statement.trim() === "" ? null : (
                    <p className="mt-2 whitespace-pre-line text-muted">
                      Proposed wording: {correction.proposed_statement}
                    </p>
                  )}
                  {correction.decision_note.trim() === "" ? null : (
                    <p className="mt-2 text-xs text-muted">
                      Decision note: {correction.decision_note}
                    </p>
                  )}
                  {canVerify && correction.status === "open" ? (
                    <DecideCorrectionForm
                      workspaceId={workspaceId}
                      entryId={entry.id}
                      correctionId={correction.id}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <CorrectionForm workspaceId={workspaceId} entryId={entry.id} />
        </section>

        <section aria-labelledby="impacts-heading" className="mt-8">
          <h2 id="impacts-heading" className="text-xl font-bold">
            Decisions built on this
          </h2>
          <p className="mt-1 text-sm text-muted">{impacts.note}</p>
          {detail.impacts.length === 0 ? null : (
            <ul className="mt-3 grid gap-2">
              {detail.impacts.map((impact) => (
                <li key={impact.id} className={`${cardClass} text-sm`}>
                  <span className="font-semibold">{impact.target_label}</span>
                  <span className="text-muted"> · {impact.target_kind}</span>
                  {impact.invalidated_at === null ? null : (
                    <p className="mt-1 text-xs text-danger">
                      Marked invalid: {impact.invalidated_reason ?? "no reason recorded"}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <ImpactForm workspaceId={workspaceId} entryId={entry.id} />
        </section>

        <section aria-labelledby="transfers-heading" className="mt-8">
          <h2 id="transfers-heading" className="text-xl font-bold">
            Reuse in another workspace
          </h2>
          <p className="mt-1 text-sm text-muted">{PRIVACY_TRANSFER_NOTE}</p>
          {detail.transfers.length === 0 ? null : (
            <ul className="mt-3 grid gap-2">
              {detail.transfers.map((transfer) => (
                <li key={transfer.id} className={`${cardClass} text-sm`}>
                  <div className="flex flex-wrap gap-2">
                    <span className={chipClass}>
                      {TRANSFER_STATUS_LABELS[transfer.status]}
                    </span>
                    {transfer.target_workspace_id === workspaceId ? (
                      <span className={chipClass}>Into this workspace</span>
                    ) : (
                      <span className={chipClass}>Out of this workspace</span>
                    )}
                  </div>
                  <p className="mt-2 text-muted">
                    Assumption to test: {transfer.assumptions_to_test}
                  </p>
                  {transfer.status === "proposed" &&
                  transfer.target_workspace_id === workspaceId &&
                  canDecideTransfer ? (
                    <DecideTransferForm
                      workspaceId={workspaceId}
                      entryId={entry.id}
                      transferId={transfer.id}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {entry.status === "active" ? (
            <TransferForm
              workspaceId={workspaceId}
              entryId={entry.id}
              targets={detail.otherWorkspaces}
            />
          ) : null}
        </section>

        <section aria-labelledby="history-heading" className="mt-8">
          <h2 id="history-heading" className="text-xl font-bold">
            History
          </h2>
          <ul className="mt-3 grid gap-1 text-sm text-muted">
            {detail.events.map((event) => (
              <li key={event.id}>
                {date(event.created_at)} · {event.kind}
                {event.detail.trim() === "" ? "" : ` · ${event.detail}`}
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
