import type { Metadata } from "next";
import Link from "next/link";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { listPersonalTemplates } from "@/lib/data/templates";
import { getIdentity } from "@/lib/identity";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { formatMinutes } from "@/lib/format";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";
import { EXAMPLE_NOTE } from "@/lib/templates/helpers";
import { templateTotalMinutes, templatesByCategory } from "@/lib/templates/library";

export const metadata: Metadata = { title: "Templates — GET TO IT" };

export default async function TemplatesPage() {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const [identity, personal] = await Promise.all([
    getIdentity(session),
    listPersonalTemplates(session),
  ]);
  const groups = templatesByCategory();

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
          Start from a template
        </h1>
        <p className="mt-3 max-w-xl leading-relaxed text-muted">
          A starting point, not a script. Preview one, change the steps and
          times until they fit, then create your goal. Templates never cost an
          AI request — they are just text.
        </p>

        <section aria-labelledby="library-heading" className="mt-10">
          <h2 id="library-heading" className="text-lg font-bold">
            Library
          </h2>

          {groups.map((group) => (
            <section key={group.category.slug} className="mt-6">
              <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-muted">
                {group.category.label}
              </h3>
              <p className="mt-1 text-sm text-muted">{group.category.blurb}</p>

              <ul className="mt-3 space-y-3">
                {group.templates.map((template) => (
                  <li key={template.slug} className={cardClass}>
                    <h4 className="text-base font-semibold leading-snug">
                      <Link
                        href={`/templates/${template.slug}`}
                        className={`rounded hover:underline ${focusRing}`}
                      >
                        {template.name}
                      </Link>
                    </h4>
                    <p className="mt-1 text-sm leading-relaxed text-muted">
                      {template.description}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className={chipClass}>
                        {template.steps.length} steps
                      </span>
                      <span className={chipClass}>
                        About {formatMinutes(templateTotalMinutes(template.steps))}
                      </span>
                      <Link
                        href={`/templates/${template.slug}`}
                        className={`rounded text-sm font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink ${focusRing}`}
                      >
                        Preview template
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <p className="mt-6 text-xs leading-relaxed text-muted">{EXAMPLE_NOTE}</p>
        </section>

        <section aria-labelledby="personal-heading" className="mt-12 border-t border-line pt-8">
          <h2 id="personal-heading" className="text-lg font-bold">
            Your private templates
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Saved from your own goals. Only you can see them.
          </p>

          {personal.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-dashed border-line p-6">
              <p className="font-medium">No private templates yet.</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Open a goal and choose “Save this plan as a template” to reuse its
                task names and time estimates. Saved work, reflections and AI
                answers are never included.
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {personal.map((template) => (
                <li key={template.id} className={cardClass}>
                  <h3 className="text-base font-semibold leading-snug">
                    <Link
                      href={`/templates/personal/${template.id}`}
                      className={`rounded hover:underline ${focusRing}`}
                    >
                      {template.name}
                    </Link>
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    {template.description}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className={chipClass}>{template.steps.length} steps</span>
                    <span className={chipClass}>Private</span>
                    <Link
                      href={`/templates/personal/${template.id}`}
                      className={`rounded text-sm font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink ${focusRing}`}
                    >
                      Preview and edit
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-10">
          <Link href="/dashboard" className={secondaryButton}>
            Back to your goals
          </Link>
        </p>
      </main>
    </div>
  );
}
