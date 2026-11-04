import type { AppSpec, GeneratedFile } from "@/lib/app-builder";

/**
 * Phase 27 — Design Workspace contract.
 *
 * The design layer is deliberately bounded. It owns a design manifest, reusable
 * UI components, a design-preview route, and a marked token block in
 * app/globals.css. It never edits API routes, auth code, data access or any
 * existing page outside the marked block. All generation is deterministic and
 * makes no pixel-perfect or third-party-branding claim.
 */

export const DESIGN_LIMITS = {
  maxBriefChars: 4_000,
  maxAssets: 12,
  maxAssetBytes: 1_500_000,
  maxAssetNameChars: 120,
  maxAttributionChars: 500,
  maxDiffChars: 24_000,
  maxTextChars: 240,
} as const;

export const DESIGN_SECTIONS = [
  { id: "hero", label: "Hero" },
  { id: "features", label: "Features" },
  { id: "data", label: "Data model" },
  { id: "states", label: "Loading and result states" },
  { id: "accessibility", label: "Accessibility notes" },
] as const;

export type DesignSectionId = (typeof DESIGN_SECTIONS)[number]["id"];
export type DesignFont = "system" | "serif" | "mono";
export type DesignSpacing = "compact" | "comfortable" | "spacious";
export type DesignVariant = "soft" | "sharp";

export type DesignColors = {
  background: string;
  surface: string;
  text: string;
  muted: string;
  primary: string;
  accent: string;
  danger: string;
  success: string;
};

export type DesignConfig = {
  brief: string;
  colors: DesignColors;
  typography: {
    sans: DesignFont;
    display: DesignFont;
    base_size: number;
    line_height: number;
  };
  spacing: DesignSpacing;
  variant: DesignVariant;
  sections: DesignSectionId[];
  text: {
    headline: string;
    subhead: string;
    primary_action: string;
    loading: string;
    empty: string;
    error: string;
    success: string;
  };
};

export const DEFAULT_DESIGN_CONFIG: DesignConfig = {
  brief:
    "A calm, high-contrast interface for a small working app. Use clear hierarchy, generous spacing, and visible status feedback without decorative noise.",
  colors: {
    background: "#f7f5f1",
    surface: "#ffffff",
    text: "#1d2939",
    muted: "#5b6573",
    primary: "#176b5b",
    accent: "#a85a2a",
    danger: "#b42318",
    success: "#2f6b3f",
  },
  typography: { sans: "system", display: "system", base_size: 16, line_height: 1.6 },
  spacing: "comfortable",
  variant: "soft",
  sections: ["hero", "features", "data", "states", "accessibility"],
  text: {
    headline: "A clear place to get things done",
    subhead: "One useful workflow, with the real routes, data and account state kept intact.",
    primary_action: "Open the app",
    loading: "Loading your workspace…",
    empty: "Nothing here yet. Add the first record to begin.",
    error: "Something went wrong. Nothing was changed.",
    success: "Saved. The latest change is visible now.",
  },
};

const FONTS: DesignFont[] = ["system", "serif", "mono"];
const SPACINGS: DesignSpacing[] = ["compact", "comfortable", "spacious"];
const VARIANTS: DesignVariant[] = ["soft", "sharp"];
const SECTION_IDS = new Set<string>(DESIGN_SECTIONS.map((item) => item.id));
const HEX = /^#[0-9a-fA-F]{6}$/;

export function fontStack(font: DesignFont): string {
  if (font === "serif") return "Georgia, 'Times New Roman', serif";
  if (font === "mono") return "ui-monospace, SFMono-Regular, Menlo, monospace";
  return "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
}

export function isHexColor(value: string): boolean {
  return HEX.test(value.trim());
}

export function normaliseDesignConfig(raw: unknown): DesignConfig {
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const colors = typeof source.colors === "object" && source.colors !== null
    ? (source.colors as Record<string, unknown>)
    : {};
  const typography = typeof source.typography === "object" && source.typography !== null
    ? (source.typography as Record<string, unknown>)
    : {};
  const text = typeof source.text === "object" && source.text !== null
    ? (source.text as Record<string, unknown>)
    : {};
  const sections = Array.isArray(source.sections)
    ? source.sections.filter((item): item is DesignSectionId => typeof item === "string" && SECTION_IDS.has(item))
    : DEFAULT_DESIGN_CONFIG.sections;

  const color = (key: keyof DesignColors) => {
    const value = colors[key];
    return typeof value === "string" && HEX.test(value) ? value : DEFAULT_DESIGN_CONFIG.colors[key];
  };
  const stringValue = (key: keyof DesignConfig["text"]) => {
    const value = text[key];
    return typeof value === "string" ? value.slice(0, DESIGN_LIMITS.maxTextChars) : DEFAULT_DESIGN_CONFIG.text[key];
  };
  const font = (key: "sans" | "display"): DesignFont =>
    FONTS.includes(typography[key] as DesignFont) ? (typography[key] as DesignFont) : "system";

  return {
    brief: typeof source.brief === "string" ? source.brief.slice(0, DESIGN_LIMITS.maxBriefChars) : DEFAULT_DESIGN_CONFIG.brief,
    colors: {
      background: color("background"),
      surface: color("surface"),
      text: color("text"),
      muted: color("muted"),
      primary: color("primary"),
      accent: color("accent"),
      danger: color("danger"),
      success: color("success"),
    },
    typography: {
      sans: font("sans"),
      display: font("display"),
      base_size:
        typeof typography.base_size === "number" && typography.base_size >= 14 && typography.base_size <= 20
          ? typography.base_size
          : DEFAULT_DESIGN_CONFIG.typography.base_size,
      line_height:
        typeof typography.line_height === "number" && typography.line_height >= 1.3 && typography.line_height <= 1.8
          ? typography.line_height
          : DEFAULT_DESIGN_CONFIG.typography.line_height,
    },
    spacing: SPACINGS.includes(source.spacing as DesignSpacing)
      ? (source.spacing as DesignSpacing)
      : DEFAULT_DESIGN_CONFIG.spacing,
    variant: VARIANTS.includes(source.variant as DesignVariant)
      ? (source.variant as DesignVariant)
      : DEFAULT_DESIGN_CONFIG.variant,
    sections:
      sections.length > 0
        ? [...new Set(sections)].slice(0, DESIGN_SECTIONS.length)
        : DEFAULT_DESIGN_CONFIG.sections,
    text: {
      headline: stringValue("headline"),
      subhead: stringValue("subhead"),
      primary_action: stringValue("primary_action"),
      loading: stringValue("loading"),
      empty: stringValue("empty"),
      error: stringValue("error"),
      success: stringValue("success"),
    },
  };
}

export function designConfigProblems(config: DesignConfig): string[] {
  const problems: string[] = [];
  if (config.brief.trim().length < 20) problems.push("Write a design brief of at least 20 characters.");
  if (config.brief.length > DESIGN_LIMITS.maxBriefChars) problems.push("Keep the design brief under 4000 characters.");
  for (const [key, value] of Object.entries(config.colors)) {
    if (!isHexColor(value)) problems.push(`Color ${key} must be a six-digit hex value.`);
  }
  if (config.sections.length === 0) problems.push("Choose at least one preview section.");
  for (const [key, value] of Object.entries(config.text)) {
    if (value.trim().length < 3) problems.push(`The ${key.replace(/_/g, " ")} text needs at least 3 characters.`);
    if (value.length > DESIGN_LIMITS.maxTextChars) problems.push(`Keep ${key.replace(/_/g, " ")} under 240 characters.`);
  }
  return problems;
}

export function parseSections(value: string): DesignSectionId[] {
  const ids = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is DesignSectionId => SECTION_IDS.has(item));
  return [...new Set(ids)];
}

function channel(value: number): number {
  const normal = value / 255;
  return normal <= 0.03928 ? normal / 12.92 : ((normal + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

export function readableTextOn(background: string): string {
  return contrastRatio("#ffffff", background) >= contrastRatio("#111827", background) ? "#ffffff" : "#111827";
}

export function designSpace(config: DesignConfig): string {
  return config.spacing === "compact" ? "0.75rem" : config.spacing === "spacious" ? "1.5rem" : "1rem";
}

export function designRadius(config: DesignConfig): string {
  return config.variant === "sharp" ? "0.25rem" : "0.9rem";
}

export function buildDesignCss(config: DesignConfig): string {
  const onPrimary = readableTextOn(config.colors.primary);
  return `:root {
  --design-bg: ${config.colors.background};
  --design-surface: ${config.colors.surface};
  --design-text: ${config.colors.text};
  --design-muted: ${config.colors.muted};
  --design-primary: ${config.colors.primary};
  --design-on-primary: ${onPrimary};
  --design-accent: ${config.colors.accent};
  --design-danger: ${config.colors.danger};
  --design-success: ${config.colors.success};
  --design-font-sans: ${fontStack(config.typography.sans)};
  --design-font-display: ${fontStack(config.typography.display)};
  --design-base-size: ${config.typography.base_size}px;
  --design-line-height: ${config.typography.line_height};
  --design-space: ${designSpace(config)};
  --design-radius: ${designRadius(config)};
  --design-border: color-mix(in srgb, var(--design-text) 16%, transparent);
}

.design-page { background: var(--design-bg); color: var(--design-text); font-family: var(--design-font-sans); font-size: var(--design-base-size); line-height: var(--design-line-height); }
.design-display { font-family: var(--design-font-display); line-height: 1.08; letter-spacing: -0.03em; }
.design-surface { background: var(--design-surface); border: 1px solid var(--design-border); border-radius: var(--design-radius); padding: var(--design-space); }
.design-button { background: var(--design-primary); color: var(--design-on-primary); border-radius: var(--design-radius); padding: 0.7rem 1rem; font-weight: 700; }
.design-focus:focus-visible, a:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 3px solid var(--design-accent); outline-offset: 2px; }

@media (max-width: 640px) {
  :root { --design-space: 0.75rem; --design-base-size: 15px; }
  .design-grid { grid-template-columns: 1fr !important; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
}`;
}

export const DESIGN_CSS_START = "/* GET TO IT DESIGN TOKENS:START */";
export const DESIGN_CSS_END = "/* GET TO IT DESIGN TOKENS:END */";

export function upsertDesignCss(existing: string, css: string): string {
  const block = `${DESIGN_CSS_START}\n${css}\n${DESIGN_CSS_END}`;
  const start = existing.indexOf(DESIGN_CSS_START);
  const end = existing.indexOf(DESIGN_CSS_END);
  if (start >= 0 && end > start) {
    return `${existing.slice(0, start)}${block}${existing.slice(end + DESIGN_CSS_END.length)}`;
  }
  return `${existing.trimEnd()}\n\n${block}\n`;
}

export type DesignAssetSummary = {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  attribution: string;
  license_note: string;
};

export function buildDesignManifest(spec: AppSpec, config: DesignConfig, assets: DesignAssetSummary[]): string {
  const manifest = {
    project: { name: spec.pages[0]?.title ?? "App", auth: spec.supabase ? "supabase" : "none" },
    routes: spec.pages.map((page) => ({ path: page.path, title: page.title, purpose: page.purpose })),
    entities: spec.entities,
    operations: spec.server_operations,
    assets,
    sections: config.sections,
    text: config.text,
    accessibility: "Static checks only; complete this with keyboard, screen reader and manual browser testing.",
  };
  return `// Generated by GET TO IT Design Workspace.\n// Routes, data model and auth are read from the approved app specification.\n// Uploaded assets are references only; no third-party asset is fetched or embedded.\nexport const designManifest = ${JSON.stringify(manifest, null, 2)} as const;\n`;
}

function designComponents(): string {
  return `import type { CSSProperties, ReactNode } from "react";

const pageStyle: CSSProperties = {
  background: "var(--design-bg)",
  color: "var(--design-text)",
  fontFamily: "var(--design-font-sans)",
  fontSize: "var(--design-base-size)",
  lineHeight: "var(--design-line-height)",
};

const surfaceStyle: CSSProperties = {
  background: "var(--design-surface)",
  border: "1px solid var(--design-border)",
  borderRadius: "var(--design-radius)",
  padding: "var(--design-space)",
};

const primaryStyle: CSSProperties = {
  background: "var(--design-primary)",
  color: "var(--design-on-primary)",
  borderRadius: "var(--design-radius)",
  padding: "0.7rem 1rem",
  fontWeight: 700,
  display: "inline-block",
};

export function PageShell({ children }: { children: ReactNode }) {
  return <main style={pageStyle} className="min-h-dvh px-5 py-10 sm:px-8">{children}</main>;
}

export function Section({ title, eyebrow, children }: { title: string; eyebrow?: string; children: ReactNode }) {
  return <section className="mt-8"><div style={{ color: "var(--design-muted)" }} className="text-xs font-bold uppercase tracking-widest">{eyebrow}</div><h2 className="design-display mt-1 text-2xl font-black">{title}</h2><div className="mt-3">{children}</div></section>;
}

export function Surface({ children }: { children: ReactNode }) {
  return <div style={surfaceStyle}>{children}</div>;
}

export function Button({ children, href }: { children: ReactNode; href?: string }) {
  if (href) return <a href={href} style={primaryStyle} className="design-focus">{children}</a>;
  return <button type="button" style={primaryStyle} className="design-focus">{children}</button>;
}

export function Field({ id, label, hint }: { id: string; label: string; hint?: string }) {
  return <div><label htmlFor={id} className="text-sm font-semibold">{label}</label><input id={id} name={id} className="mt-1 w-full rounded border bg-transparent px-3 py-2" style={{ borderColor: "var(--design-border)" }} />{hint ? <p className="mt-1 text-xs" style={{ color: "var(--design-muted)" }}>{hint}</p> : null}</div>;
}

export function StatePanel({ state, title, message }: { state: "loading" | "empty" | "error" | "success"; title: string; message: string }) {
  const color = state === "error" ? "var(--design-danger)" : state === "success" ? "var(--design-success)" : "var(--design-muted)";
  return <div style={{ ...surfaceStyle, borderColor: color }} role={state === "error" ? "alert" : "status"} aria-live="polite"><p className="text-sm font-bold" style={{ color }}>{title}</p><p className="mt-1 text-sm">{message}</p></div>;
}
`;
}

function previewPage(): string {
  return `import { designManifest } from "@/lib/design-manifest";
import { Button, Field, PageShell, Section, StatePanel, Surface } from "@/components/design/ui";

const manifest = designManifest;

function StateGrid() {
  return <div className="design-grid mt-3 grid gap-3 sm:grid-cols-2">
    <StatePanel state="loading" title="Loading" message={manifest.text.loading} />
    <StatePanel state="empty" title="Empty" message={manifest.text.empty} />
    <StatePanel state="error" title="Error" message={manifest.text.error} />
    <StatePanel state="success" title="Success" message={manifest.text.success} />
  </div>;
}

export default function DesignPreviewPage() {
  return <PageShell>
    <p className="text-xs font-bold uppercase tracking-widest" style={{ color: "var(--design-muted)" }}>Design preview · real routes and data model</p>
    <h1 className="design-display mt-2 max-w-3xl text-4xl font-black sm:text-5xl">{manifest.text.headline}</h1>
    <p className="mt-4 max-w-2xl" style={{ color: "var(--design-muted)" }}>{manifest.text.subhead}</p>
    <div className="mt-5"><Button href={manifest.routes[0]?.path ?? "/"}>{manifest.text.primary_action}</Button></div>
    <nav aria-label="App routes" className="mt-6 flex flex-wrap gap-3 text-sm">
      {manifest.routes.map((route) => <a key={route.path} href={route.path} className="design-focus underline">{route.title}</a>)}
    </nav>
    {manifest.sections.map((section) => {
      if (section === "hero") return null;
      if (section === "features") return <Section key={section} eyebrow="Features" title="What the app does"><div className="design-grid grid gap-3 sm:grid-cols-2">{manifest.entities.length === 0 ? <Surface>No data entities were specified.</Surface> : manifest.entities.map((entity) => <Surface key={entity.name}><p className="font-bold capitalize">{entity.name.replace(/_/g, " ")}</p><p className="mt-1 text-sm" style={{ color: "var(--design-muted)" }}>{entity.fields.join(", ")}</p></Surface>)}</div></Section>;
      if (section === "data") return <Section key={section} eyebrow="Data" title="Real app model"><div className="design-grid grid gap-3 sm:grid-cols-2">{manifest.operations.map((operation) => <Surface key={operation.entity}><p className="font-bold capitalize">{operation.entity.replace(/_/g, " ")}</p><p className="mt-1 text-sm" style={{ color: "var(--design-muted)" }}>{operation.operations.join(", ")}</p></Surface>)}</div></Section>;
      if (section === "states") return <Section key={section} eyebrow="States" title="Loading, empty, error and success"><StateGrid /></Section>;
      if (section === "accessibility") return <Section key={section} eyebrow="Accessibility" title="Check before shipping"><Surface><p className="text-sm">Static checks cover contrast, labels, focus styles, reduced motion and responsive rules. They are not a complete accessibility audit. Test with a keyboard and a screen reader.</p><div className="mt-3"><Field id="design-sample" label="Sample field" hint="Labels are explicitly associated with inputs in the generated components." /></div></Surface></Section>;
      return null;
    })}
    <footer className="mt-10 border-t border-current/10 pt-4 text-xs" style={{ color: "var(--design-muted)" }}>
      Auth: {manifest.project.auth}. This preview does not replace the real app routes or backend behavior.
    </footer>
  </PageShell>;
}
`;
}

function designReadme(spec: AppSpec, config: DesignConfig, assets: DesignAssetSummary[]): string {
  const assetLines = assets.length
    ? assets.map((asset) => `- ${asset.name} (${asset.mime}, ${asset.bytes} bytes) — attribution: ${asset.attribution || "not supplied"}; license: ${asset.license_note || "not supplied"}`).join("\n")
    : "- None uploaded.";
  return `# ${spec.pages[0]?.title ?? "App"} design workspace

This design layer was generated deterministically. It does not claim pixel-perfect reproduction.

## Brief

${config.brief}

## Tokens

${Object.entries(config.colors).map(([key, value]) => `- ${key}: ${value}`).join("\n")}
- Typography: ${config.typography.sans} / ${config.typography.display}, ${config.typography.base_size}px, line-height ${config.typography.line_height}
- Spacing: ${config.spacing}
- Variant: ${config.variant}

## Real app structure

Routes: ${spec.pages.map((page) => page.path).join(", ") || "none"}.
Data entities: ${spec.entities.map((entity) => entity.name).join(", ") || "none"}.
Auth: ${spec.supabase ? "Supabase accounts" : "none"}.

The design layer does not change API routes, authentication or data access. Existing files outside the marked token block are preserved.

## Uploaded references and attribution

${assetLines}

Only permitted assets may be uploaded. SVG and HTML are refused because they can contain active content. No asset is fetched from a URL or executed.

## Verification limits

Automated checks are not a complete accessibility audit. Screenshot comparison is pending unless browser tooling is available.
`;
}

export type AccessibilityCheck = {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
};

export function checkAccessibility(config: DesignConfig, files: GeneratedFile[]): AccessibilityCheck[] {
  const css = files.find((file) => file.path === "app/globals.css")?.content ?? "";
  const ui = files.find((file) => file.path === "components/design/ui.tsx")?.content ?? "";
  const checks: AccessibilityCheck[] = [];

  const textContrast = contrastRatio(config.colors.text, config.colors.background);
  const mutedContrast = contrastRatio(config.colors.muted, config.colors.background);
  const primaryContrast = contrastRatio(readableTextOn(config.colors.primary), config.colors.primary);
  checks.push({
    id: "contrast",
    label: "Text contrast",
    status: textContrast >= 4.5 && mutedContrast >= 4.5 ? "pass" : "fail",
    detail: `Body text ${textContrast.toFixed(2)}:1; muted text ${mutedContrast.toFixed(2)}:1; primary button ${primaryContrast.toFixed(2)}:1.`,
  });
  checks.push({
    id: "focus",
    label: "Visible focus",
    status: css.includes(":focus-visible") ? "pass" : "fail",
    detail: "The generated token block includes a visible focus outline.",
  });
  checks.push({
    id: "reduced-motion",
    label: "Reduced motion",
    status: css.includes("prefers-reduced-motion") ? "pass" : "fail",
    detail: "The generated token block reduces animation and transition durations.",
  });
  checks.push({
    id: "labels",
    label: "Labels",
    status: ui.includes("<label") && ui.includes("htmlFor=") ? "pass" : "warn",
    detail: "Generated fields associate a visible label with an input. Review every real form after applying the design.",
  });
  checks.push({
    id: "keyboard",
    label: "Keyboard semantics",
    status: ui.includes("<button") && ui.includes("<a ") ? "pass" : "warn",
    detail: "Generated actions use native buttons and links. No click handler is attached to a generic element.",
  });
  checks.push({
    id: "responsive",
    label: "Responsive states",
    status: css.includes("@media (max-width: 640px)") ? "pass" : "fail",
    detail: "The token block includes a small-screen spacing/size adjustment and the preview uses a responsive grid.",
  });
  checks.push({
    id: "audit",
    label: "Manual audit pending",
    status: "warn",
    detail: "Automated static checks are not a complete accessibility audit; keyboard, screen-reader and browser testing are still required.",
  });
  return checks;
}

export function buildDesignFiles(
  spec: AppSpec,
  config: DesignConfig,
  assets: DesignAssetSummary[],
  existingGlobals: string,
): GeneratedFile[] {
  const css = buildDesignCss(config);
  return [
    { path: "app/globals.css", content: upsertDesignCss(existingGlobals, css) },
    { path: "components/design/ui.tsx", content: designComponents() },
    { path: "lib/design-manifest.ts", content: buildDesignManifest(spec, config, assets) },
    { path: "app/design-preview/page.tsx", content: previewPage() },
    { path: "DESIGN.md", content: designReadme(spec, config, assets) },
  ];
}

export function diffFiles(previous: GeneratedFile[], next: GeneratedFile[]): string {
  const before = new Map(previous.map((file) => [file.path, file.content]));
  const parts: string[] = [];
  for (const file of next) {
    const old = before.get(file.path);
    if (old === file.content) continue;
    const oldLines = old === undefined ? [] : old.split("\n");
    const newLines = file.content.split("\n");
    const shownOld = oldLines.slice(0, 120);
    const shownNew = newLines.slice(0, 120);
    parts.push(
      `${old === undefined ? "new file" : "modified"} ${file.path}\n--- a/${file.path}\n+++ b/${file.path}\n${shownOld.map((line) => `-${line}`).join("\n")}\n${shownNew.map((line) => `+${line}`).join("\n")}`,
    );
    if (parts.join("\n\n").length > DESIGN_LIMITS.maxDiffChars) break;
  }
  const text = parts.join("\n\n");
  return text.length > DESIGN_LIMITS.maxDiffChars ? `${text.slice(0, DESIGN_LIMITS.maxDiffChars)}\n… diff truncated` : text;
}
