import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  DecideTransferForm,
  KnowledgeEntryForm,
  PurgeExpiredForm,
} from "@/components/knowledge-forms";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { listKnowledge, retrieveKnowledge } from "@/lib/data/knowledge";
import { getIdentity } from "@/lib/identity";
import {
  SEPARATION_NOTE,
  AI_SUGGESTION_NOTE,
  RETENTION_NOTE,
  RETRIEVAL_NOTE,
  TRANSFER_NOTE,
  NO_AGI_CLAIM,
  entryStateLabel,
  entrySummary,
} from "@/lib/knowledge";
import { cardClass, chipClass, inputClass, labelClass, quietButton } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Knowledge — GET TO IT" };

export default async function KnowledgePage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ q?: string; domain?: string }>;
}) {
  const { workspaceId } = await params;
  const { q = "", domain = "" } = await searchParams;

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
    listKnowledge(session, workspaceId),
  ]);
  if (!list) notFound();

  const searchQuery = q.trim();
  const searchDomain = domain.trim();
  const searching = searchQuery !== "" || searchDomain !== "";
  const retrieved = searching
    ? await retrieveKnowledge(session, workspaceId, searchQuery, searchDomain)
    : [];
  const retrievedIds = new Set(retrieved.map((row) => row.id));
  const visible = searching
    ? list.entries.filter((row) => retrievedIds.has(row.id))
    : list.entries;

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
            Evidence-backed knowledge
          </p>
          <h1 className="mt-1 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
            What this workspace has actually learned
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
            A record here is a claim or a reusable procedure, linked by id to the
            experiment, review or record it came from. Preferences, opinions,
            measurements, tested procedures, hypotheses and AI suggestions are kept apart,
            and nothing is verified because a model said so.
          </p>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted">{SEPARATION_NOTE}</p>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">{NO_AGI_CLAIM}</p>
        </header>

        {list.incoming.length > 0 ? (
          <section aria-labelledby="incoming-heading" className="mt-8">
            <h2 id="incoming-heading" className="text-xl font-bold">
              Transfers awaiting your approval
            </h2>
            <p className="mt-1 text-sm text-muted">{TRANSFER_NOTE}</p>
            <div className="mt-3 grid gap-3">
              {list.incoming.map((transfer) => (
                <article key={transfer.id} className={cardClass}>
                  <p className="text-sm font-semibold">
                    A lesson from another workspace was proposed for this one
                  </p>
                  <dl className="mt-2 grid gap-1 text-sm text-muted">
                    <div>
                      <dt className="inline font-semibold text-ink">Similarities: </dt>
                      <dd className="inline">{transfer.similarities}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold text-ink">Differences: </dt>
                      <dd className="inline">{transfer.differences}</dd>
                    </div>
                    <div>
                      <dt className="inline font-semibold text-ink">Assumption to test: </dt>
                      <dd className="inline">{transfer.assumptions_to_test}</dd>
                    </div>
                  </dl>
                  {transfer.evidence_summary.trim() === "" ? null : (
                    <p className="mt-2 text-sm text-muted">{transfer.evidence_summary}</p>
                  )}
                  <DecideTransferForm
                    workspaceId={workspaceId}
                    entryId={transfer.entry_id}
                    transferId={transfer.id}
                  />
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section aria-labelledby="create-heading" className="mt-8">
          <h2 id="create-heading" className="text-xl font-bold">
            Record a claim or a reusable procedure
          </h2>
          <p className="mt-1 text-sm text-muted">
            It is saved unverified, with its sources, conditions, limitations, owner,
            review date and retention requirement. {AI_SUGGESTION_NOTE}
          </p>
          <KnowledgeEntryForm workspaceId={workspaceId} />
        </section>

        <section aria-labelledby="retrieve-heading" className="mt-8">
          <h2 id="retrieve-heading" className="text-xl font-bold">
            Retrieve
          </h2>
          <p className="mt-1 text-sm text-muted">{RETRIEVAL_NOTE}</p>
          <form method="get" className={`${cardClass} mt-3 flex flex-wrap items-end gap-3`}>
            <div className="min-w-48 flex-1">
              <label className={labelClass} htmlFor="knowledge-query">
                Search
              </label>
              <input
                id="knowledge-query"
                name="q"
                className={inputClass}
                defaultValue={searchQuery}
                placeholder="reminder, shift, onboarding"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="knowledge-domain-filter">
                Domain
              </label>
              <select
                id="knowledge-domain-filter"
                name="domain"
                className={inputClass}
                defaultValue={searchDomain}
              >
                <option value="">All domains</option>
                {list.domains.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className={quietButton}>
              Search current entries
            </button>
          </form>
          {searching ? (
            <p className="mt-2 text-sm text-muted">
              {visible.length} entr{visible.length === 1 ? "y" : "ies"} returned. Retracted,
              superseded and contradicted entries are never included.
            </p>
          ) : null}
        </section>

        <section aria-labelledby="entries-heading" className="mt-8">
          <h2 id="entries-heading" className="text-xl font-bold">
            {searching ? "Matching entries" : "Entries in this workspace"}
          </h2>
          {visible.length === 0 ? (
            <p className={`${cardClass} mt-3 text-sm text-muted`}>
              {searching
                ? "Nothing matched. Try a shorter search, or clear the domain."
                : "Nothing recorded yet. A first useful entry often comes from an experiment review you already have."}
            </p>
          ) : (
            <ul className="mt-3 grid gap-3">
              {visible.map((entry) => (
                <li key={entry.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <Link
                        href={`/workspace/${workspaceId}/knowledge/${entry.id}`}
                        className="rounded text-lg font-bold underline decoration-line underline-offset-4 hover:text-ink"
                      >
                        {entry.title}
                      </Link>
                      <p className="mt-1 text-sm leading-relaxed text-muted">
                        {entry.statement.length > 220
                          ? `${entry.statement.slice(0, 220)}…`
                          : entry.statement}
                      </p>
                    </div>
                    <span className={chipClass}>{entryStateLabel(entry)}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    {entrySummary(entry, list.counts[entry.id] ?? { supporting: 0, contradicting: 0 })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {list.outgoing.length > 0 ? (
          <section aria-labelledby="outgoing-heading" className="mt-8">
            <h2 id="outgoing-heading" className="text-xl font-bold">
              Transfers proposed from this workspace
            </h2>
            <ul className="mt-3 grid gap-2">
              {list.outgoing.map((transfer) => (
                <li key={transfer.id} className={`${cardClass} text-sm text-muted`}>
                  <span className="font-semibold text-ink">{transfer.status}</span> · proposed
                  to another workspace · assumption to test: {transfer.assumptions_to_test}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="retention-heading" className="mt-8">
          <h2 id="retention-heading" className="text-xl font-bold">
            Retention
          </h2>
          <p className="mt-1 text-sm text-muted">{RETENTION_NOTE}</p>
          <PurgeExpiredForm workspaceId={workspaceId} count={list.dueForPurge} />
        </section>
      </main>
    </div>
  );
}
