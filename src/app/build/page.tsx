import type { Metadata } from "next";
import Link from "next/link";
import { CreateAppProjectForm } from "@/components/build-forms";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import {
  EXISTING_PLATFORM_NOTE,
  GENERATION_NOTE,
  NOT_PRODUCTION_NOTE,
  SUPPORTED_STACK,
} from "@/lib/app-builder";
import { requireSession } from "@/lib/auth";
import { listAppProjects } from "@/lib/data/app-projects";
import { getIdentity } from "@/lib/identity";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Build an App — GET TO IT" };

const STATUS_LABELS: Record<string, string> = {
  intake: "Intake",
  spec_draft: "Specification draft",
  spec_approved: "Specification approved",
  generated: "Generated",
};

export default async function BuildPage() {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const [identity, projects] = await Promise.all([getIdentity(session), listAppProjects(session)]);

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
          Build an App
        </h1>
        <p className="mt-3 max-w-xl leading-relaxed text-muted">
          Describe the app you want, edit and approve its specification, then
          generate real project files you can read, edit and download.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          {SUPPORTED_STACK.note} {EXISTING_PLATFORM_NOTE}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          Generation is deterministic and spends no AI requests. It writes files
          from the approved specification. Code runs only after you start an
          isolated preview workspace, in a separate sandbox process with no host
          access and no platform credentials.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/build/import" className={secondaryButton}>
            Import my app
          </Link>
          <Link href="/evaluations" className={secondaryButton}>
            Evaluate agent configurations
          </Link>
        </div>

        <section aria-labelledby="new-app-heading" className="mt-8">
          <h2 id="new-app-heading" className="sr-only">
            Start an app
          </h2>
          <CreateAppProjectForm />
        </section>

        <section aria-labelledby="projects-heading" className="mt-10">
          <h2 id="projects-heading" className="text-xl font-bold">
            Your app projects
          </h2>

          {projects.length === 0 ? (
            <div className={`${cardClass} mt-3`}>
              <p className="font-medium">Nothing here yet.</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Start with the intake above. You will see a draft specification
                before any file is generated.
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {projects.map((project) => (
                <li key={project.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-lg font-semibold leading-snug">
                      <Link
                        href={`/build/${project.id}`}
                        className={`rounded hover:underline ${focusRing}`}
                      >
                        {project.name}
                      </Link>
                    </h3>
                    <span className={chipClass}>
                      {STATUS_LABELS[project.status] ?? project.status}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted">{project.purpose}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
                    <span className={chipClass}>{project.stack === "nextjs-typescript-tailwind" ? "Next.js + TypeScript + Tailwind" : project.stack}</span>
                    <span className={chipClass}>
                      {project.current_version > 0 ? `Version ${project.current_version}` : "No files yet"}
                    </span>
                    <span className={chipClass}>
                      {project.auth_requirements === "supabase" ? "Supabase accounts" : "No accounts"}
                    </span>
                  </div>
                  <p className="mt-3">
                    <Link href={`/build/${project.id}`} className={secondaryButton}>
                      Open the project
                    </Link>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${cardClass} mt-10`}>
          <h2 className="text-lg font-bold">What this workspace does and does not do</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">{GENERATION_NOTE}</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">{NOT_PRODUCTION_NOTE}</p>
          <ul className="mt-3 space-y-1 text-sm text-muted">
            <li>Project code runs only in a separate sandbox you start; never in the app process.</li>
            <li>No public deployment, hosting or infrastructure purchase.</li>
            <li>No autonomous agents or background generation.</li>
            <li>External integrations are clearly labelled as mocked.</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
