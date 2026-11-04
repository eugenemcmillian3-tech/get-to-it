import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DesignAssetForm, ApplyDesignForm, DeleteDesignAssetForm, DesignConfigForm } from "@/components/design-forms";
import { SiteHeader } from "@/components/site-header";
import {
  DEFAULT_DESIGN_CONFIG,
  DESIGN_SECTIONS,
  buildDesignFiles,
  checkAccessibility,
  diffFiles,
  normaliseDesignConfig,
  type DesignConfig,
} from "@/lib/design";
import { assetDataUrl } from "@/lib/design-assets";
import { requireSession } from "@/lib/auth";
import { getAppProjectDetail } from "@/lib/data/app-projects";
import { getDesignWorkspace } from "@/lib/data/app-design";
import { getIdentity } from "@/lib/identity";
import { cardClass, chipClass, focusRing, secondaryButton } from "@/lib/styles";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { isUuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Design Workspace — GET TO IT" };

const statusClass = {
  pass: "text-mint",
  warn: "text-amber-700",
  fail: "text-danger",
} as const;

function PreviewSurface({ children, config }: { children: React.ReactNode; config: DesignConfig }) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{
        background: config.colors.surface,
        borderColor: "color-mix(in srgb, var(--preview-text) 16%, transparent)",
        color: config.colors.text,
      }}
    >
      {children}
    </div>
  );
}

function LivePreview({ config, spec }: { config: DesignConfig; spec: { pages: { path: string; title: string; purpose: string }[]; entities: { name: string; fields: string[] }[]; supabase: boolean } }) {
  const hero = (
    <div>
      <p className="text-xs font-bold uppercase tracking-widest" style={{ color: config.colors.muted }}>
        Design preview · real routes and data model
      </p>
      <h2
        className="mt-2 max-w-3xl text-4xl font-black leading-[1.08] tracking-tight sm:text-5xl"
        style={{ fontFamily: config.typography.display === "serif" ? "Georgia, serif" : config.typography.display === "mono" ? "ui-monospace, monospace" : "ui-sans-serif, system-ui, sans-serif" }}
      >
        {config.text.headline}
      </h2>
      <p className="mt-4 max-w-2xl" style={{ color: config.colors.muted }}>{config.text.subhead}</p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link
          href={spec.pages[0]?.path ?? "/"}
          className="design-focus inline-flex min-h-11 items-center rounded-xl px-4 py-2 font-bold"
          style={{ background: config.colors.primary, color: "#ffffff" }}
        >
          {config.text.primary_action}
        </Link>
        <span className="text-xs" style={{ color: config.colors.muted }}>
          Auth: {spec.supabase ? "Supabase accounts" : "none"} · {spec.entities.length} data entities
        </span>
      </div>
      <nav aria-label="App routes" className="mt-6 flex flex-wrap gap-3 text-sm">
        {spec.pages.map((page) => (
          <Link key={page.path} href={page.path} className="design-focus underline">{page.title}</Link>
        ))}
      </nav>
    </div>
  );

  const sections = config.sections.filter((section) => section !== "hero");
  return (
    <div
      className="design-page rounded-2xl border p-5 sm:p-8"
      style={{
        background: config.colors.background,
        color: config.colors.text,
        borderColor: "color-mix(in srgb, var(--preview-text) 16%, transparent)",
        fontFamily: config.typography.sans === "serif" ? "Georgia, serif" : config.typography.sans === "mono" ? "ui-monospace, monospace" : "ui-sans-serif, system-ui, sans-serif",
        fontSize: `${config.typography.base_size}px`,
        lineHeight: config.typography.line_height,
        ["--preview-text" as string]: config.colors.text,
      }}
    >
      {hero}
      {sections.map((section) => {
        if (section === "features") {
          return (
            <section key={section} className="mt-8">
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: config.colors.muted }}>Features</p>
              <h3 className="mt-1 text-2xl font-black" style={{ fontFamily: config.typography.display === "serif" ? "Georgia, serif" : undefined }}>What the app does</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {spec.entities.length === 0 ? (
                  <PreviewSurface config={config}>No data entities were specified. The real app&apos;s existing behavior is unchanged.</PreviewSurface>
                ) : spec.entities.map((entity) => (
                  <PreviewSurface key={entity.name} config={config}>
                    <p className="font-bold capitalize">{entity.name.replace(/_/g, " ")}</p>
                    <p className="mt-1 text-sm" style={{ color: config.colors.muted }}>{entity.fields.join(", ")}</p>
                  </PreviewSurface>
                ))}
              </div>
            </section>
          );
        }
        if (section === "data") {
          return (
            <section key={section} className="mt-8">
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: config.colors.muted }}>Data</p>
              <h3 className="mt-1 text-2xl font-black">Real app model</h3>
              <p className="mt-1 text-sm" style={{ color: config.colors.muted }}>
                These routes and entities come from the approved specification. This preview does not replace
                the app&apos;s API routes, authentication or data access.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {spec.pages.map((page) => (
                  <PreviewSurface key={page.path} config={config}>
                    <p className="font-mono text-xs">{page.path}</p>
                    <p className="mt-1 font-bold">{page.title}</p>
                    <p className="mt-1 text-sm" style={{ color: config.colors.muted }}>{page.purpose}</p>
                  </PreviewSurface>
                ))}
              </div>
            </section>
          );
        }
        if (section === "states") {
          const states = [
            { label: "Loading", text: config.text.loading, color: config.colors.muted },
            { label: "Empty", text: config.text.empty, color: config.colors.muted },
            { label: "Error", text: config.text.error, color: config.colors.danger },
            { label: "Success", text: config.text.success, color: config.colors.success },
          ];
          return (
            <section key={section} className="mt-8">
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: config.colors.muted }}>States</p>
              <h3 className="mt-1 text-2xl font-black">Loading, empty, error and success</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {states.map((item) => (
                  <div key={item.label} role={item.label === "Error" ? "alert" : "status"} aria-live="polite">
                    <PreviewSurface config={config}>
                      <p className="text-sm font-bold" style={{ color: item.color }}>{item.label}</p>
                      <p className="mt-1 text-sm">{item.text}</p>
                    </PreviewSurface>
                  </div>
                ))}
              </div>
            </section>
          );
        }
        if (section === "accessibility") {
          return (
            <section key={section} className="mt-8">
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: config.colors.muted }}>Accessibility</p>
              <h3 className="mt-1 text-2xl font-black">Check before shipping</h3>
              <PreviewSurface config={config}>
                <label htmlFor="design-preview-field" className="text-sm font-semibold">Sample field</label>
                <input
                  id="design-preview-field"
                  className="design-focus mt-1 w-full rounded-lg border bg-transparent px-3 py-2"
                  style={{ borderColor: config.colors.muted }}
                  aria-describedby="design-preview-help"
                />
                <p id="design-preview-help" className="mt-1 text-xs" style={{ color: config.colors.muted }}>
                  Labels are explicitly associated with inputs. Static checks are not a complete accessibility audit.
                </p>
              </PreviewSurface>
            </section>
          );
        }
        return null;
      })}
      {sections.length === 0 ? <p className="mt-6 text-sm" style={{ color: config.colors.muted }}>No additional sections selected.</p> : null}
    </div>
  );
}

export default async function DesignWorkspacePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!isUuid(projectId)) notFound();

  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <p className="text-sm text-muted">Sign-in is not configured in this build.</p>
      </main>
    );
  }

  const session = await requireSession();
  const [identity, detail, workspace] = await Promise.all([
    getIdentity(session),
    getAppProjectDetail(session, projectId),
    getDesignWorkspace(session, projectId),
  ]);
  if (!detail) notFound();

  const { project, specs, files, versions } = detail;
  const approved = specs.find((record) => record.approved_at !== null) ?? null;
  const spec = approved?.spec ?? null;
  const config = normaliseDesignConfig(workspace.profile?.config ?? DEFAULT_DESIGN_CONFIG);
  const approvedSpec = spec;
  const existingGlobals = files.find((file) => file.path === "app/globals.css")?.content ?? "";
  const designFiles = approvedSpec && files.length > 0
    ? buildDesignFiles(approvedSpec, config, workspace.assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        mime: asset.mime,
        bytes: asset.bytes,
        attribution: asset.attribution,
        license_note: asset.license_note,
      })), existingGlobals)
    : [];
  const merged = new Map(files.map((file) => [file.path, file.content] as const));
  for (const file of designFiles) merged.set(file.path, file.content);
  const mergedFiles = [...merged.entries()].map(([path, content]) => ({ path, content })).sort((a, b) => a.path.localeCompare(b.path));
  const previewDiff = designFiles.length > 0 ? diffFiles(files, mergedFiles) : "";
  const checks = checkAccessibility(config, designFiles);

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />
      <main className="mx-auto w-full max-w-5xl px-5 pb-16 pt-6">
        <Link
          href={`/build/${project.id}`}
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← Back to {project.name}
        </Link>

        <header className="mt-4">
          <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">Design Workspace</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
            A bounded design layer over this app&apos;s real routes, data model, authentication states and
            component library. It does not replace backend behavior with a static mockup, and it does not
            claim pixel-perfect reproduction.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
            <span className={chipClass}>{approvedSpec ? "Specification approved" : "Approval required first"}</span>
            <span className={chipClass}>{files.length} generated files</span>
            <span className={chipClass}>{workspace.assets.length} references</span>
            <span className={chipClass}>Visual comparison pending</span>
          </div>
        </header>

        {!workspace.profile ? (
          <section className={`${cardClass} mt-5 border-brand/30`}>
            <h2 className="text-lg font-bold">Start with the brief</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Save the brief, colors and typography first. Nothing is written to the generated app until you
              review the preview and choose to apply the design layer.
            </p>
          </section>
        ) : null}

        <section aria-labelledby="design-brief-heading" className="mt-8 grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <h2 id="design-brief-heading" className="text-xl font-bold">1. Brief and tokens</h2>
            <div className="mt-3">
              <DesignConfigForm projectId={project.id} config={config} />
            </div>
          </div>
          <aside className="space-y-4">
            <div className={cardClass}>
              <h2 className="text-base font-bold">What is preserved</h2>
              <ul className="mt-2 space-y-1 text-sm text-muted">
                <li>Data access and API contracts.</li>
                <li>Owner-only authentication and authorization.</li>
                <li>Existing custom files outside the bounded design set.</li>
                <li>The previous app snapshot as a restorable version.</li>
              </ul>
            </div>
            <div className={cardClass}>
              <h2 className="text-base font-bold">Limits</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                This is a deterministic design layer, not an image-to-code model. It will not reproduce a
                screenshot pixel for pixel. No third-party branding or asset is fetched.
              </p>
            </div>
            <div className={cardClass}>
              <h2 className="text-base font-bold">Verification status</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Static accessibility checks run here. Browser screenshot comparison and a complete manual
                accessibility audit are pending; no browser tooling is available in this workspace.
              </p>
            </div>
          </aside>
        </section>

        <section aria-labelledby="reference-heading" className="mt-8">
          <h2 id="reference-heading" className="text-xl font-bold">2. Uploaded references</h2>
          <p className="mt-1 text-sm text-muted">
            Uploaded screenshots and wireframes are references, not templates to copy. Only genuine raster
            files are accepted; SVG and HTML are refused because they can contain active content.
          </p>
          <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_1fr]">
            <DesignAssetForm projectId={project.id} />
            <div className={cardClass}>
              <h3 className="text-base font-bold">Saved references</h3>
              {workspace.assets.length === 0 ? (
                <p className="mt-2 text-sm text-muted">No references uploaded.</p>
              ) : (
                <ul className="mt-3 space-y-4">
                  {workspace.assets.map((asset) => {
                    const source = assetDataUrl(asset.mime, asset.content_base64);
                    return (
                      <li key={asset.id} className="border-t border-line pt-3 first:border-0 first:pt-0">
                        <div className="flex gap-3">
                          {source ? (
                            // A data URL avoids fetching arbitrary asset URLs. The file is raster only.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={source} alt={asset.name} className="h-16 w-20 rounded-lg border border-line object-cover" />
                          ) : null}
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{asset.name}</p>
                            <p className="text-xs text-muted">{asset.kind} · {asset.mime} · {asset.bytes.toLocaleString()} bytes</p>
                            <p className="mt-1 text-xs text-muted">Attribution: {asset.attribution || "not supplied"}</p>
                            <p className="text-xs text-muted">License: {asset.license_note || "not supplied"}</p>
                          </div>
                        </div>
                        <DeleteDesignAssetForm projectId={project.id} assetId={asset.id} name={asset.name} />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </section>

        <section aria-labelledby="preview-heading" className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="preview-heading" className="text-xl font-bold">3. Preview</h2>
            <span className={chipClass}>Not pixel-perfect</span>
          </div>
          <p className="mt-1 text-sm text-muted">
            The preview uses the approved app&apos;s route names, entities and account state. It is an additional
            preview, not a replacement for the real routes.
          </p>
          <div className="mt-3">
            {approvedSpec ? (
              <LivePreview config={config} spec={approvedSpec} />
            ) : (
              <p className={`${cardClass} text-sm text-muted`}>Approve the app specification to preview the real structure.</p>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
            {DESIGN_SECTIONS.map((section) => <span key={section.id} className={chipClass}>{section.label}{config.sections.includes(section.id) ? "" : " · hidden"}</span>)}
          </div>
        </section>

        <section aria-labelledby="checks-heading" className="mt-8">
          <h2 id="checks-heading" className="text-xl font-bold">4. Accessibility checks</h2>
          <p className="mt-1 text-sm text-muted">
            These are static checks over the generated files and token values. They are not a complete
            accessibility audit; keyboard, screen-reader and browser testing are still required.
          </p>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {checks.map((check) => (
              <li key={check.id} className={cardClass}>
                <p className={`text-sm font-bold ${statusClass[check.status]}`}>
                  {check.status === "pass" ? "Pass" : check.status === "warn" ? "Needs review" : "Fix"} · {check.label}
                </p>
                <p className="mt-1 text-sm text-muted">{check.detail}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="diff-heading" className="mt-8">
          <h2 id="diff-heading" className="text-xl font-bold">5. Code diff</h2>
          <p className="mt-1 text-sm text-muted">
            Shows the bounded set only. No API route, authentication file or data-access file is included.
          </p>
          {previewDiff ? (
            <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-line bg-paper p-4 font-mono text-[11px] leading-relaxed">
              {previewDiff}
            </pre>
          ) : (
            <p className={`${cardClass} mt-3 text-sm text-muted`}>Generate app files and approve the specification to see the diff.</p>
          )}
        </section>

        <section aria-labelledby="apply-heading" className="mt-8">
          <h2 id="apply-heading" className="text-xl font-bold">6. Apply</h2>
          <div className="mt-3">
            <ApplyDesignForm projectId={project.id} disabled={!approvedSpec || files.length === 0 || !workspace.profile} />
          </div>
        </section>

        <section aria-labelledby="history-heading" className="mt-8">
          <h2 id="history-heading" className="text-xl font-bold">Design history</h2>
          {workspace.versions.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No design has been applied yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {workspace.versions.map((version) => (
                <li key={version.id} className={cardClass}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-bold">Design {version.version}</p>
                    <p className="text-xs text-muted">{version.created_at.slice(0, 16).replace("T", " ")}</p>
                  </div>
                  <p className="mt-1 text-sm text-muted">{version.summary}</p>
                </li>
              ))}
            </ul>
          )}
          {versions.length > 0 ? (
            <p className="mt-2 text-xs text-muted">The project&apos;s app versions remain the source of truth for rollback. Applying a design creates a new app version.</p>
          ) : null}
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href={`/build/${project.id}`} className={secondaryButton}>Back to project</Link>
          <Link href={`/build/${project.id}/integrations`} className={secondaryButton}>Integration Studio</Link>
        </div>
      </main>
    </div>
  );
}
