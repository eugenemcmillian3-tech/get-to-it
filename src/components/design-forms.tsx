"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleBuildState, type BuildState } from "@/lib/action-state";
import {
  applyDesignAction,
  deleteDesignAssetAction,
  saveDesignConfigAction,
  uploadDesignAssetAction,
} from "@/lib/actions/app-design";
import { DESIGN_SECTIONS, type DesignConfig } from "@/lib/design";
import {
  cardClass,
  dangerButton,
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
} from "@/lib/styles";

function StateNote({ state, idle }: { state: BuildState; idle?: string }) {
  if (state.status === "error") return <span className="text-danger" role="alert">{state.message}</span>;
  if (state.status === "success") return <span className="text-mint">{state.message}</span>;
  return idle ? <span className="text-muted">{idle}</span> : null;
}

function ColorField({ name, label, value }: { name: string; label: string; value: string }) {
  return (
    <div>
      <label className={labelClass} htmlFor={`design-${name}`}>{label}</label>
      <input
        id={`design-${name}`}
        name={`color_${name}`}
        type="color"
        defaultValue={value}
        className="mt-1.5 h-11 w-full cursor-pointer rounded-xl border border-line bg-card px-2"
        required
      />
    </div>
  );
}

function TextField({
  name,
  label,
  value,
  hint,
  maxLength = 240,
  required = true,
}: {
  name: string;
  label: string;
  value: string;
  hint?: string;
  maxLength?: number;
  required?: boolean;
}) {
  return (
    <div>
      <label className={labelClass} htmlFor={`design-${name}`}>{label}</label>
      <input
        id={`design-${name}`}
        name={name}
        defaultValue={value}
        maxLength={maxLength}
        className={`mt-1.5 ${inputClass}`}
        required={required}
      />
      {hint ? <p className={hintClass}>{hint}</p> : null}
    </div>
  );
}

export function DesignConfigForm({ projectId, config }: { projectId: string; config: DesignConfig }) {
  const [state, formAction] = useActionState(saveDesignConfigAction, idleBuildState);

  return (
    <form action={formAction} className={cardClass}>
      <h2 className="text-lg font-bold">Brief and design tokens</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        These values become CSS variables and a small reusable component layer. Existing API routes,
        authentication and data access are not changed.
      </p>
      <input type="hidden" name="project_id" value={projectId} />

      <div className="mt-4">
        <label className={labelClass} htmlFor="design-brief">Design brief</label>
        <textarea
          id="design-brief"
          name="brief"
          defaultValue={config.brief}
          maxLength={4000}
          rows={5}
          className={`mt-1.5 ${inputClass}`}
          required
        />
        <p className={hintClass}>Tone, hierarchy, density, what to avoid, and how the real data should feel.</p>
      </div>

      <fieldset className="mt-4">
        <legend className="text-sm font-semibold">Brand colors</legend>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ColorField name="background" label="Background" value={config.colors.background} />
          <ColorField name="surface" label="Surface" value={config.colors.surface} />
          <ColorField name="text" label="Text" value={config.colors.text} />
          <ColorField name="muted" label="Muted text" value={config.colors.muted} />
          <ColorField name="primary" label="Primary" value={config.colors.primary} />
          <ColorField name="accent" label="Focus / accent" value={config.colors.accent} />
          <ColorField name="danger" label="Error" value={config.colors.danger} />
          <ColorField name="success" label="Success" value={config.colors.success} />
        </div>
      </fieldset>

      <fieldset className="mt-4">
        <legend className="text-sm font-semibold">Typography and density</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="design-font-sans">Body font</label>
            <select id="design-font-sans" name="font_sans" defaultValue={config.typography.sans} className={`mt-1.5 ${inputClass}`}>
              <option value="system">System sans</option>
              <option value="serif">Serif</option>
              <option value="mono">Monospace</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="design-font-display">Display font</label>
            <select id="design-font-display" name="font_display" defaultValue={config.typography.display} className={`mt-1.5 ${inputClass}`}>
              <option value="system">System sans</option>
              <option value="serif">Serif</option>
              <option value="mono">Monospace</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="design-base-size">Base size (px)</label>
            <input id="design-base-size" name="base_size" type="number" min={14} max={20} defaultValue={config.typography.base_size} className={`mt-1.5 ${inputClass}`} required />
          </div>
          <div>
            <label className={labelClass} htmlFor="design-line-height">Line height</label>
            <input id="design-line-height" name="line_height" type="number" min={1.3} max={1.8} step={0.05} defaultValue={config.typography.line_height} className={`mt-1.5 ${inputClass}`} required />
          </div>
          <div>
            <label className={labelClass} htmlFor="design-spacing">Spacing</label>
            <select id="design-spacing" name="spacing" defaultValue={config.spacing} className={`mt-1.5 ${inputClass}`}>
              <option value="compact">Compact</option>
              <option value="comfortable">Comfortable</option>
              <option value="spacious">Spacious</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="design-variant">Component variant</label>
            <select id="design-variant" name="variant" defaultValue={config.variant} className={`mt-1.5 ${inputClass}`}>
              <option value="soft">Soft corners</option>
              <option value="sharp">Sharp corners</option>
            </select>
          </div>
        </div>
      </fieldset>

      <div className="mt-4">
        <label className={labelClass} htmlFor="design-sections">Preview section order</label>
        <input
          id="design-sections"
          name="sections"
          defaultValue={config.sections.join(", ")}
          className={`mt-1.5 ${inputClass}`}
          required
        />
        <p className={hintClass}>
          Comma-separated. Supported: {DESIGN_SECTIONS.map((section) => section.id).join(", ")}. The hero is
          always first; the others follow this order.
        </p>
      </div>

      <fieldset className="mt-4">
        <legend className="text-sm font-semibold">Interface text</legend>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <TextField name="headline" label="Headline" value={config.text.headline} />
          <TextField name="subhead" label="Subhead" value={config.text.subhead} />
          <TextField name="primary_action" label="Primary action" value={config.text.primary_action} />
          <TextField name="loading" label="Loading state" value={config.text.loading} />
          <TextField name="empty" label="Empty state" value={config.text.empty} />
          <TextField name="error" label="Error state" value={config.text.error} />
          <TextField name="success" label="Success state" value={config.text.success} />
        </div>
      </fieldset>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <SubmitButton className={primaryButton} pendingLabel="Saving design…">Save design and preview</SubmitButton>
        <p className="text-sm"><StateNote state={state} idle="Saving does not change generated app files." /></p>
      </div>
    </form>
  );
}

export function DesignAssetForm({ projectId }: { projectId: string }) {
  const [state, formAction] = useActionState(uploadDesignAssetAction, idleBuildState);

  return (
    <form action={formAction} className={cardClass}>
      <h3 className="text-base font-bold">Add a permitted reference</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        PNG, JPEG or WebP only, up to 1.5 MB. SVG, HTML and script-capable files are refused. Nothing is
        executed or fetched from a URL. Keep your own attribution and license notes.
      </p>
      <input type="hidden" name="project_id" value={projectId} />
      <div className="mt-3 space-y-3">
        <div>
          <label className={labelClass} htmlFor="design-asset-kind">Reference kind</label>
          <select id="design-asset-kind" name="kind" className={`mt-1.5 ${inputClass}`}>
            <option value="screenshot">Screenshot</option>
            <option value="wireframe">Wireframe</option>
            <option value="asset">Permitted design asset</option>
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="design-asset-file">File</label>
          <input
            id="design-asset-file"
            name="asset"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className={`mt-1.5 ${inputClass}`}
            required
          />
        </div>
        <TextField name="attribution" label="Attribution (optional)" value="" maxLength={500} required={false} />
        <div>
          <label className={labelClass} htmlFor="design-license">License or permission note (optional)</label>
          <input id="design-license" name="license_note" maxLength={500} className={`mt-1.5 ${inputClass}`} />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="permission" className="mt-1" required />
          <span>I have permission to use this reference, and it does not reproduce third-party branding without permission.</span>
        </label>
        <SubmitButton className={primaryButton} pendingLabel="Validating image…">Add reference</SubmitButton>
        <p className="text-sm"><StateNote state={state} /></p>
      </div>
    </form>
  );
}

export function ApplyDesignForm({ projectId, disabled }: { projectId: string; disabled: boolean }) {
  const [state, formAction] = useActionState(applyDesignAction, idleBuildState);

  return (
    <form action={formAction} className={cardClass}>
      <h2 className="text-lg font-bold">Apply the bounded design layer</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Writes only <code>app/globals.css</code> (the marked token block), the reusable design components,
        the design manifest, a preview route and <code>DESIGN.md</code>. Existing backend files outside that
        set are preserved, and the previous app snapshot stays available.
      </p>
      <input type="hidden" name="project_id" value={projectId} />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <SubmitButton className={primaryButton} pendingLabel="Applying design…" disabled={disabled}>
          Apply design files
        </SubmitButton>
        <p className="text-sm"><StateNote state={state} idle={disabled ? "Generate app files before applying." : undefined} /></p>
      </div>
    </form>
  );
}

export function DeleteDesignAssetForm({ projectId, assetId, name }: { projectId: string; assetId: string; name: string }) {
  const [state, formAction] = useActionState(deleteDesignAssetAction, idleBuildState);

  return (
    <form action={formAction} className="mt-2">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="asset_id" value={assetId} />
      <button type="submit" className={dangerButton} aria-label={`Remove ${name}`}>Remove reference</button>
      {state.status === "error" ? <p className="mt-1 text-sm text-danger" role="alert">{state.message}</p> : null}
    </form>
  );
}
