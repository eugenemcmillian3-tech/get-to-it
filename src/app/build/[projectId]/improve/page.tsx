import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import {
  ChangeControls,
  ChangeRequestForm,
  ClarifyChangeForm,
  DeleteMemoryForm,
  ErrorForm,
  LogErrorForm,
  MemoryForm,
  ObservabilityForm,
  SeedMemoryForm,
  SkillForm,
} from "@/components/improve-forms";
import { requireSession } from "@/lib/auth";
import { getAppProjectDetail } from "@/lib/data/app-projects";
import { getImprovementDetail } from "@/lib/data/improvements";
import { getIdentity } from "@/lib/identity";
import {
  CHANGE_KIND_LABELS,
  MEMORY_KIND_LABELS,
  evaluationTotals,
} from "@/lib/improvements";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { isUuid } from "@/lib/validation";
import type { AppChangeRequest } from "@/lib/types";

export const metadata: Metadata = { title: "Improvement workspace — GET TO IT" };

const STATUS_LABEL: Record<string, string> = {
  clarifying: "Needs clarification",
  proposed: "Plan proposed",
  approved: "Plan approved",
  implemented: "Patch prepared",
  tested: "Tests recorded",
  preview_ready: "Ready for diff review",
  reviewed: "Diff approved",
  merged: "Merged source version",
  rejected: "Rejected",
  failed: "Failed",
};

function checksPassed(change: AppChangeRequest): boolean {
  return change.checks.length > 0 && change.checks.every((check) => check.status === "passed" || check.status === "skipped");
}

export default async function ImprovePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) notFound();
  if (!getSupabaseSettings()) {
    return <main className="mx-auto w-full max-w-3xl px-5 py-10"><p className="text-sm text-muted">Sign-in is not configured in this build.</p></main>;
  }

  const session = await requireSession();
  const [identity, detail, improvement] = await Promise.all([
    getIdentity(session),
    getAppProjectDetail(session, projectId),
    getImprovementDetail(session, projectId),
  ]);
  if (!detail) notFound();
  const { project } = detail;
  const totals = evaluationTotals(improvement.evaluations);
  const merged = improvement.changes.filter((change) => change.status === "merged");

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />
      <main className="mx-auto w-full max-w-5xl px-5 pb-16 pt-6">
        <Link href={`/build/${project.id}`} className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}>← Back to {project.name}</Link>
        <header className="mt-4">
          <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">Improvement workspace</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
            Request a bounded incremental change. The current tree is the base; only a small isolated patch is tested and previewed.
            Merging creates a reversible source version. Production deployment remains a separate approval.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
            <span className={chipClass}>Current version {project.current_version}</span>
            <span className={chipClass}>No full regeneration</span>
            <span className={chipClass}>Deploy approval separate</span>
          </div>
        </header>

        <section aria-labelledby="request-heading" className={`${cardClass} mt-6`}>
          <h2 id="request-heading" className="text-lg font-bold">Request a change</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Inspect → clarify → plan → approve → isolated workspace → test → preview → review diff → merge. A merge does not deploy.
          </p>
          <div className="mt-4"><ChangeRequestForm projectId={project.id} /></div>
        </section>

        <section aria-labelledby="changes-heading" className="mt-8">
          <h2 id="changes-heading" className="text-xl font-bold">Change requests</h2>
          {improvement.changes.length === 0 ? <p className="mt-2 text-sm text-muted">No change requests yet.</p> : (
            <ul className="mt-3 space-y-3">
              {improvement.changes.map((change) => (
                <li key={change.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="font-bold">{CHANGE_KIND_LABELS[change.kind] ?? change.kind}</h3>
                      <p className="text-xs text-muted">Automation {change.automation_level} · base version {change.base_version} · {change.created_at.slice(0, 19).replace("T", " ")}</p>
                    </div>
                    <span className={chipClass}>{STATUS_LABEL[change.status] ?? change.status}</span>
                  </div>
                  <p className="mt-2 text-sm">{change.request}</p>
                  {change.questions.length > 0 ? (
                    <div className="mt-2 rounded-lg border border-line bg-paper p-3 text-sm">
                      <p className="font-semibold">Clarify first</p>
                      <ul className="mt-1 list-disc pl-5 text-muted">{change.questions.map((question) => <li key={question}>{question}</li>)}</ul>
                    </div>
                  ) : null}
                  {change.plan && Object.keys(change.plan).length > 0 ? (
                    <div className="mt-3 space-y-2 text-sm">
                      <p className="font-semibold">{change.plan.summary}</p>
                      <ol className="list-decimal space-y-1 pl-5 text-muted">{change.plan.steps.map((step) => <li key={step}>{step}</li>)}</ol>
                      <p className="text-xs text-muted">Files: {change.plan.files.map((file) => `${file.path} (${file.action})`).join(", ")}</p>
                    </div>
                  ) : null}
                  {change.base_digest ? <p className="mt-2 break-all font-mono text-[11px] text-muted">base {change.base_digest}</p> : null}
                  {change.diff ? (
                    <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">Review diff</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-paper p-3 font-mono text-xs">{change.diff}</pre></details>
                  ) : null}
                  {change.checks.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-xs">{change.checks.map((check) => <li key={check.name}><span className="font-semibold">{check.label}:</span> <span className={check.status === "passed" ? "text-mint" : "text-danger"}>{check.status}</span></li>)}</ul>
                  ) : null}
                  {change.preview_url ? <p className="mt-2 text-sm"><a href={change.preview_url} target="_blank" rel="noreferrer noopener" className="underline">Open isolated preview</a></p> : null}
                  {change.error ? <p className="mt-2 text-sm text-danger">{change.error}</p> : null}
                  {change.status === "clarifying" ? <ClarifyChangeForm projectId={project.id} change={change} /> : null}
                  <ChangeControls projectId={project.id} change={change} canReview={change.status === "preview_ready" && checksPassed(change)} />
                  {change.status === "merged" && change.merged_version ? (
                    <p className="mt-2 text-xs text-muted">Merged at source version {change.merged_version}. <Link href={`/build/${project.id}/deploy`} className="underline">Approve a deployment separately.</Link></p>
                  ) : null}
                  {merged.some((item) => item.id === change.id) ? <SkillForm projectId={project.id} change={change} /> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="memory-heading" className="mt-8">
          <h2 id="memory-heading" className="text-xl font-bold">Project memory</h2>
          <p className="mt-1 text-sm text-muted">Editable records, not permissions. Repository text cannot override approvals or capabilities. Credentials are refused.</p>
          <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_20rem]">
            <div className="space-y-2">
              {improvement.memory.length === 0 ? <p className={`${cardClass} text-sm text-muted`}>No memory records yet.</p> : improvement.memory.map((record) => (
                <div key={record.id} className={cardClass}>
                  <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="font-semibold">{record.title}</h3><span className={chipClass}>{MEMORY_KIND_LABELS[record.kind] ?? record.kind}</span></div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{record.body}</p>
                  <DeleteMemoryForm projectId={project.id} record={record} />
                </div>
              ))}
            </div>
            <div className={`${cardClass} h-fit`}><MemoryForm projectId={project.id} /><div className="mt-3"><SeedMemoryForm projectId={project.id} /></div></div>
          </div>
        </section>

        <section aria-labelledby="skills-heading" className="mt-8">
          <h2 id="skills-heading" className="text-xl font-bold">Reusable skills</h2>
          <p className="mt-1 text-sm text-muted">A skill is a verified procedure with version, inputs, outputs, tests and limitations. It cannot deploy or install privileged tools.</p>
          {improvement.skills.length === 0 ? <p className="mt-2 text-sm text-muted">Merge a change, then save its procedure as a skill.</p> : (
            <ul className="mt-3 space-y-2">{improvement.skills.map((skill) => (
              <li key={skill.id} className={cardClass}><h3 className="font-semibold">{skill.name} · v{skill.version}</h3><p className="text-sm text-muted">{skill.purpose}</p><p className="mt-1 text-xs text-muted">Permissions: {skill.required_permissions.join(", ")} · Tests: {skill.tests.join(", ")}</p></li>
            ))}</ul>
          )}
        </section>

        <section aria-labelledby="observability-heading" className="mt-8">
          <h2 id="observability-heading" className="text-xl font-bold">Selected errors</h2>
          <p className="mt-1 text-sm text-muted">Explicit configuration only. Store selected, redacted errors. No database dump, user rows or full production data is sent to any AI provider.</p>
          <div className={`${cardClass} mt-3`}>
            <ObservabilityForm projectId={project.id} enabled={improvement.settings?.enabled ?? false} release={improvement.settings?.release_label ?? `v${project.current_version}`} />
            {improvement.settings?.enabled ? <LogErrorForm projectId={project.id} /> : null}
          </div>
          {improvement.errors.length > 0 ? <ul className="mt-3 space-y-2">{improvement.errors.map((error) => (
            <li key={error.id} className={cardClass}><div className="flex flex-wrap justify-between gap-2"><p className="font-semibold">{error.message}</p><span className={chipClass}>{error.status}</span></div><p className="text-xs text-muted">Release {error.release_label} · {error.redactions} redaction(s) · fingerprint {error.fingerprint.slice(0, 12)}…</p>{error.detail && error.detail !== error.message ? <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words text-xs text-muted">{error.detail}</pre> : null}<ErrorForm projectId={project.id} error={error} /></li>
          ))}</ul> : null}
        </section>

        <section aria-labelledby="evaluation-heading" className="mt-8">
          <h2 id="evaluation-heading" className="text-xl font-bold">Evaluation</h2>
          <p className="mt-1 text-sm text-muted">Facts, not a score. More generated code is not treated as better.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {[["Accepted", totals.accepted], ["Rejected", totals.rejected], ["Tests passed", totals.tests_passed], ["Regressions recorded", totals.regressions], ["Runtime seconds", totals.runtime_seconds], ["AI calls", totals.ai_calls], ["Successful deployments", improvement.successfulDeployments]].map(([label, value]) => (
              <div key={String(label)} className={cardClass}><p className="text-xs text-muted">{label}</p><p className="text-2xl font-black">{value}</p></div>
            ))}
          </div>
        </section>

        <div className="mt-8 flex flex-wrap gap-3"><Link href={`/build/${project.id}`} className={secondaryButton}>Back to project</Link><Link href={`/build/${project.id}/deploy`} className={secondaryButton}>Deployment approvals</Link></div>
      </main>
    </div>
  );
}
