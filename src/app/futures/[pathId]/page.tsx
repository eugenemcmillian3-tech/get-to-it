import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ConvertActionButton,
  DeleteFuturePathForm,
  RationaleForm,
  ScenarioEditor,
} from "@/components/future-forms";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { getFuturePathDetail } from "@/lib/data/futures";
import { getIdentity } from "@/lib/identity";
import {
  ASSUMPTION_BASED_NOTE,
  EVIDENCE_LABEL_HINTS,
  EVIDENCE_LABEL_TEXT,
  EVIDENCE_LABELS,
  EVIDENCE_SEPARATION_NOTE,
  EXPECTED_SCENARIO_NOTE,
  LIST_FIELD_LABELS,
  NO_HIGH_STAKES_NOTE,
  NO_PREDICTION_NOTE,
  SCENARIO_KINDS,
  SCENARIO_LABELS,
  SCENARIO_LIST_FIELDS,
  SCENARIO_NOTES,
  compareRows,
  evidenceCounts,
  formatFutureDay,
  horizonLabel,
} from "@/lib/futures";
import { isUuid } from "@/lib/validation";
import type { FutureEvidence, FutureScenario } from "@/lib/types";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";

export const metadata: Metadata = { title: "Future path — GET TO IT" };

function EvidenceList({ items }: { items: FutureEvidence[] }) {
  return (
    <ul className="mt-2 space-y-2">
      {items.map((item) => (
        <li key={item.text} className="text-sm leading-relaxed">
          <span>{item.text}</span>{" "}
          <span className="ml-1 inline-flex rounded-full border border-line bg-paper px-2 py-0.5 text-[11px] font-medium text-muted">
            {EVIDENCE_LABEL_TEXT[item.label]}
          </span>
          {item.source_url ? (
            <a
              href={item.source_url}
              target="_blank"
              rel="noreferrer noopener"
              className={`ml-1 rounded text-xs underline decoration-line underline-offset-2 hover:text-ink ${focusRing}`}
            >
              Source you supplied
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ScenarioCard({
  pathId,
  scenario,
  added,
  canConvert,
}: {
  pathId: string;
  scenario: FutureScenario;
  added: (kind: string, index: number) => boolean;
  canConvert: boolean;
}) {
  const counts = evidenceCounts(
    SCENARIO_LIST_FIELDS.flatMap((field) => scenario[field]),
  );

  return (
    <section aria-labelledby={`scenario-${scenario.kind}`} className={`${cardClass} mt-4`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={`scenario-${scenario.kind}`} className="text-lg font-bold">
            {SCENARIO_LABELS[scenario.kind]}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            {SCENARIO_NOTES[scenario.kind]}
          </p>
        </div>
        <span className={chipClass}>{scenario.title}</span>
      </div>

      <p className="mt-2 text-xs text-muted">
        {counts.user} you provided · {counts.retrieved} retrieved ·{" "}
        {counts.assumption} assumptions · {counts.ai} AI possibilities ·{" "}
        {counts.unknown} unknowns
      </p>

      <div className="mt-4 space-y-4">
        {SCENARIO_LIST_FIELDS.map((field) => (
          <div key={field}>
            <h3 className="text-sm font-bold">{LIST_FIELD_LABELS[field]}</h3>
            <EvidenceList items={scenario[field]} />
            {field === "actions" ? (
              <div className="mt-2 space-y-2">
                {scenario.actions.map((action, index) => (
                  <div
                    key={`${action.text}-${index}`}
                    className="flex flex-wrap items-center gap-2 text-xs"
                  >
                    <ConvertActionButton
                      pathId={pathId}
                      kind={scenario.kind}
                      index={index}
                      added={added(scenario.kind, index)}
                      canConvert={canConvert}
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <ScenarioEditor pathId={pathId} scenario={scenario} />
    </section>
  );
}

export default async function FuturePathPage({
  params,
}: {
  params: Promise<{ pathId: string }>;
}) {
  const { pathId } = await params;
  if (!isUuid(pathId)) notFound();

  const session = await requireSession();
  const [identity, detail] = await Promise.all([
    getIdentity(session),
    getFuturePathDetail(session, pathId),
  ]);

  if (!detail) notFound();

  const ordered = SCENARIO_KINDS.map((kind) =>
    detail.scenarios.find((scenario) => scenario.kind === kind),
  ).filter((scenario): scenario is FutureScenario => scenario !== undefined);

  if (ordered.length !== SCENARIO_KINDS.length) notFound();

  const rows = compareRows(ordered);
  const converted = new Set(
    detail.actions.map((link) => `${link.scenario_kind}:${link.action_index}`),
  );
  const canConvert = detail.path.goal_id !== null;

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-5xl px-5 pb-16 pt-6">
        <Link
          href="/futures"
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← All future paths
        </Link>

        <header className="mt-4">
          <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">
            {detail.path.decision}
          </h1>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
            <span className={chipClass}>{horizonLabel(detail.path.horizon)}</span>
            <span className={chipClass}>Model {detail.path.model}</span>
            <span className={chipClass}>
              Created {formatFutureDay(detail.path.created_at)}
            </span>
            {detail.path.review_at ? (
              <span className={chipClass}>
                Review {formatFutureDay(detail.path.review_at)}
              </span>
            ) : null}
            {detail.path.goal_id ? (
              <Link
                href={`/goals/${detail.path.goal_id}`}
                className={`${chipClass} hover:text-ink`}
              >
                Linked goal
              </Link>
            ) : (
              <span className={chipClass}>No goal linked</span>
            )}
          </div>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
            {NO_PREDICTION_NOTE}
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
            {ASSUMPTION_BASED_NOTE}
          </p>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
            {EXPECTED_SCENARIO_NOTE}
          </p>
        </header>

        <details className={`${cardClass} mt-5`}>
          <summary className="cursor-pointer rounded text-sm font-semibold">
            The inputs you gave
          </summary>
          <dl className="mt-3 space-y-2 text-sm">
            <div>
              <dt className="font-semibold">Success means</dt>
              <dd className="text-muted">{detail.path.success_definition}</dd>
            </div>
            {detail.path.resources ? (
              <div>
                <dt className="font-semibold">Resources</dt>
                <dd className="text-muted">{detail.path.resources}</dd>
              </div>
            ) : null}
            {detail.path.constraints ? (
              <div>
                <dt className="font-semibold">Constraints</dt>
                <dd className="text-muted">{detail.path.constraints}</dd>
              </div>
            ) : null}
            {detail.path.uncertainties ? (
              <div>
                <dt className="font-semibold">Uncertain about</dt>
                <dd className="text-muted">{detail.path.uncertainties}</dd>
              </div>
            ) : null}
          </dl>
        </details>

        <section aria-labelledby="legend-heading" className={`${cardClass} mt-4`}>
          <h2 id="legend-heading" className="text-sm font-bold">
            How to read the labels
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {EVIDENCE_SEPARATION_NOTE}
          </p>
          <dl className="mt-2 grid gap-1.5 text-xs sm:grid-cols-2">
            {EVIDENCE_LABELS.map((label) => (
              <div key={label} className="flex gap-2">
                <dt className="shrink-0 rounded-full border border-line bg-paper px-2 py-0.5 font-medium">
                  {EVIDENCE_LABEL_TEXT[label]}
                </dt>
                <dd className="text-muted">{EVIDENCE_LABEL_HINTS[label]}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="compare-heading" className="mt-8">
          <h2 id="compare-heading" className="text-xl font-bold">
            Compare the three scenarios
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Same starting point, three different futures. No column is ranked,
            recommended or described as more likely.
          </p>

          <div className="mt-4 space-y-5">
            {rows.map((row) => (
              <div key={row.field}>
                <h3 className="text-sm font-bold">{row.label}</h3>
                <div className="mt-2 grid gap-3 md:grid-cols-3">
                  {SCENARIO_KINDS.map((kind) => (
                    <div
                      key={kind}
                      className="rounded-xl border border-line bg-card p-3"
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                        {SCENARIO_LABELS[kind]}
                      </p>
                      <EvidenceList items={row.values[kind]} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="detail-heading" className="mt-10">
          <h2 id="detail-heading" className="text-xl font-bold">
            Each scenario in full
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Actions worth doing in every scenario can become ordinary tasks in
            your linked goal. You can edit or delete them afterwards.
          </p>

          {ordered.map((scenario) => (
            <ScenarioCard
              key={scenario.kind}
              pathId={detail.path.id}
              scenario={scenario}
              added={(kind, index) => converted.has(`${kind}:${index}`)}
              canConvert={canConvert}
            />
          ))}
        </section>

        <RationaleForm path={detail.path} />

        {detail.path.rationale ? (
          <section className={`${cardClass} mt-4`} aria-labelledby="saved-decision">
            <h2 id="saved-decision" className="text-lg font-bold">
              Saved decision
            </h2>
            {detail.path.chosen_kind ? (
              <p className="mt-1 text-sm font-medium">
                Leaning toward {SCENARIO_LABELS[detail.path.chosen_kind]}.
              </p>
            ) : null}
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-muted">
              {detail.path.rationale}
            </p>
            {detail.path.rationale_saved_at ? (
              <p className="mt-2 text-xs text-muted">
                Saved {formatFutureDay(detail.path.rationale_saved_at)}.
              </p>
            ) : null}
          </section>
        ) : null}

        <p className="mt-6 text-xs leading-relaxed text-muted">
          {NO_HIGH_STAKES_NOTE}
        </p>

        <DeleteFuturePathForm pathId={detail.path.id} />

        <p className="mt-6">
          <Link href="/futures" className={secondaryButton}>
            Back to all future paths
          </Link>
        </p>
      </main>
    </div>
  );
}
