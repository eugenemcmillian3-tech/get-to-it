import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PersonalTemplateEditor } from "@/components/personal-template-editor";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { TemplateUseForm } from "@/components/template-use-form";
import { requireSession } from "@/lib/auth";
import { getPersonalTemplate } from "@/lib/data/templates";
import { getIdentity } from "@/lib/identity";
import { formatMinutes } from "@/lib/format";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { cardClass, chipClass, focusRing } from "@/lib/styles";
import { EXAMPLE_LABEL, EXAMPLE_NOTE } from "@/lib/templates/helpers";
import {
  categoryLabel,
  templateTotalMinutes,
} from "@/lib/templates/library";

export const metadata: Metadata = { title: "Your template — GET TO IT" };

export default async function PersonalTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const { id } = await params;
  const template = await getPersonalTemplate(session, id);
  // Someone else's template is indistinguishable from a missing one: RLS
  // returns nothing, so there is nothing to leak.
  if (!template) notFound();

  const identity = await getIdentity(session);
  const totalMinutes = templateTotalMinutes(template.steps);

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-3xl px-5 pb-16 pt-6">
        <Link
          href="/templates"
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← All templates
        </Link>

        <header className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-strong">
            {categoryLabel(template.category) ?? "Private template"}
          </p>
          <h1 className="mt-2 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
            {template.name}
          </h1>
          <p className="mt-3 max-w-xl leading-relaxed text-muted">
            {template.description}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className={chipClass}>{template.steps.length} steps</span>
            <span className={chipClass}>About {formatMinutes(totalMinutes)}</span>
            <span className={chipClass}>Private to you</span>
          </div>
        </header>

        <section aria-labelledby="personal-outcome-heading" className="mt-7">
          <h2
            id="personal-outcome-heading"
            className="text-xs font-bold uppercase tracking-[0.15em] text-muted"
          >
            What done looks like
          </h2>
          <p className="mt-2 leading-relaxed">{template.desired_outcome}</p>
        </section>

        <section aria-labelledby="personal-steps-heading" className="mt-7">
          <h2 id="personal-steps-heading" className="text-lg font-bold">
            Steps
          </h2>

          {template.steps.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              This template has no steps yet. Add a few below.
            </p>
          ) : (
            <ol className="mt-3 space-y-3">
              {template.steps.map((step, index) => (
                <li key={`${step.title}-${index}`} className={cardClass}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-base font-semibold leading-snug">
                      {index + 1}. {step.title}
                    </h3>
                    <span className={chipClass}>
                      {formatMinutes(step.estimated_minutes)}
                    </span>
                  </div>
                  {step.example_deliverable ? (
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                      <span className="rounded-full border border-line bg-paper px-2 py-0.5 text-xs font-semibold uppercase tracking-wide">
                        {EXAMPLE_LABEL}
                      </span>{" "}
                      {step.example_deliverable}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}

          <p className="mt-3 text-xs leading-relaxed text-muted">{EXAMPLE_NOTE}</p>
        </section>

        <TemplateUseForm
          kind="personal"
          templateKey={template.id}
          templateName={template.name}
          desiredOutcome={template.desired_outcome}
          category={template.category}
          steps={template.steps}
        />

        <PersonalTemplateEditor template={template} />
      </main>
    </div>
  );
}
