"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleBuildState, type BuildState } from "@/lib/action-state";
import {
  approveSpecAction,
  createAppProjectAction,
  deleteAppProjectAction,
  generateAppAction,
  restoreAppVersionAction,
  reviseSpecAction,
  saveAppFileAction,
  saveSpecAction,
} from "@/lib/actions/app-projects";
import {
  AUTH_CHOICES,
  INTAKE_FIELDS,
  PROJECT_LIMITS,
  type AppSpec,
} from "@/lib/app-builder";
import {
  cardClass,
  dangerButton,
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
  quietButton,
  secondaryButton,
} from "@/lib/styles";

function StateNote({ state, idle }: { state: BuildState; idle?: string }) {
  if (state.status === "error") {
    return <span className="text-danger" role="alert">{state.message}</span>;
  }
  if (state.status === "success") {
    return <span className="text-mint">{state.message}</span>;
  }
  return idle ? <span className="text-muted">{idle}</span> : null;
}

const TEXT_AREAS: { name: string; label: string; rows: number }[] = [
  { name: "features", label: "Features", rows: 5 },
  { name: "exclusions", label: "Exclusions", rows: 4 },
  { name: "pages", label: "Pages", rows: 6 },
  { name: "entities", label: "Data entities", rows: 5 },
  { name: "integrations", label: "Integrations (all mocked)", rows: 3 },
  { name: "acceptance_checks", label: "Acceptance checks", rows: 5 },
];

export function CreateAppProjectForm() {
  const [state, formAction] = useActionState(createAppProjectAction, idleBuildState);

  return (
    <form action={formAction} className={cardClass}>
      <h2 className="text-lg font-bold">Start an app</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Capture the app once. A draft specification is built from these answers,
        and you edit and approve it before any project file is generated.
      </p>

      <div className="mt-4 space-y-4">
        {INTAKE_FIELDS.map((field) => {
          const isLong = ["purpose", "workflows", "required_pages", "entities", "integrations", "definition_of_done"].includes(
            field.name,
          );

          return (
            <div key={field.name}>
              <label className={labelClass} htmlFor={`app-${field.name}`}>
                {field.label}
              </label>
              {isLong ? (
                <textarea
                  id={`app-${field.name}`}
                  name={field.name}
                  rows={field.name === "purpose" ? 3 : 3}
                  className={`mt-1.5 ${inputClass}`}
                  placeholder={field.hint}
                  required={["workflows", "required_pages", "definition_of_done"].includes(field.name)}
                />
              ) : (
                <input
                  id={`app-${field.name}`}
                  name={field.name}
                  className={`mt-1.5 ${inputClass}`}
                  placeholder={field.hint}
                  required={field.name === "name" || field.name === "target_users"}
                />
              )}
              <p className={hintClass}>{field.hint}</p>
            </div>
          );
        })}

        <div>
          <label className={labelClass} htmlFor="app-auth">
            Authentication requirements
          </label>
          <select id="app-auth" name="auth_requirements" className={`mt-1.5 ${inputClass}`}>
            {AUTH_CHOICES.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
          <p className={hintClass}>
            {AUTH_CHOICES.map((choice) => choice.note).join(" ")}
          </p>
        </div>

        <p className="text-xs leading-relaxed text-muted">
          Limits: {PROJECT_LIMITS.maxPages} pages, {PROJECT_LIMITS.maxEntities} entities and{" "}
          {PROJECT_LIMITS.maxIntegrations} integrations. Page paths cannot contain
          &ldquo;..&rdquo;. Nothing is generated until you approve the specification.
        </p>

        <div>
          <SubmitButton className={primaryButton} pendingLabel="Building the draft…">
            Save intake and draft a specification
          </SubmitButton>
          <p className="mt-2 text-sm">
            <StateNote state={state} />
          </p>
        </div>
      </div>
    </form>
  );
}

export function SpecEditor({
  projectId,
  spec,
  draft,
}: {
  projectId: string;
  spec: AppSpec;
  draft: boolean;
}) {
  const [state, formAction] = useActionState(saveSpecAction, idleBuildState);

  const values: Record<string, string> = {
    features: spec.features.join("\n"),
    exclusions: spec.exclusions.join("\n"),
    pages: spec.pages
      .filter((page) => page.path !== "/")
      .map((page) => `${page.path} | ${page.title} | ${page.purpose}`)
      .join("\n"),
    entities: spec.entities.map((entity) => `${entity.name}: ${entity.fields.join(", ")}`).join("\n"),
    integrations: spec.integrations.map((integration) => integration.name).join("\n"),
    acceptance_checks: spec.acceptance_checks.join("\n"),
  };

  return (
    <div className={cardClass}>
      <h2 className="text-lg font-bold">
        {draft ? "Edit the specification" : "Approved specification"}
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Edits are saved as a new version. An approved version cannot be edited;
        revising copies it into a draft first.
      </p>

      <form action={formAction} className="mt-4 space-y-4">
        <input type="hidden" name="project_id" value={projectId} />

        {TEXT_AREAS.map((area) => (
          <div key={area.name}>
            <label className={labelClass} htmlFor={`spec-${area.name}`}>
              {area.label}
            </label>
            <textarea
              id={`spec-${area.name}`}
              name={area.name}
              defaultValue={values[area.name] ?? ""}
              rows={area.rows}
              disabled={!draft}
              className={`mt-1.5 font-mono text-sm ${inputClass} disabled:opacity-70`}
            />
            {area.name === "pages" ? (
              <p className={hintClass}>
                One per line as <code>/path | Title | Purpose</code>. Home is always included.
              </p>
            ) : null}
            {area.name === "entities" ? (
              <p className={hintClass}>
                One per line as <code>name: field, field</code>. Fields never overwrite id,
                user_id or created_at.
              </p>
            ) : null}
          </div>
        ))}

        <div>
          <label className={labelClass} htmlFor="spec-auth">
            Accounts
          </label>
          <select
            id="spec-auth"
            name="auth_requirements"
            defaultValue={spec.supabase ? "supabase" : "none"}
            disabled={!draft}
            className={`mt-1.5 ${inputClass} disabled:opacity-70`}
          >
            {AUTH_CHOICES.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-3">
          <SubmitButton className={secondaryButton} pendingLabel="Saving…">
            {draft ? "Save draft version" : "Save (read-only until revised)"}
          </SubmitButton>
        </div>
        <p className="text-sm">
          <StateNote state={state} idle="Saving validates the whole file set before anything is stored." />
        </p>
      </form>
    </div>
  );
}

export function ReviseSpecForm({ projectId }: { projectId: string }) {
  const [state, formAction] = useActionState(reviseSpecAction, idleBuildState);

  return (
    <form action={formAction} className="mt-4">
      <input type="hidden" name="project_id" value={projectId} />
      <SubmitButton className={secondaryButton} pendingLabel="Opening a draft…">
        Revise the approved specification
      </SubmitButton>
      <p className="mt-2 text-sm">
        <StateNote state={state} />
      </p>
    </form>
  );
}

export function ApproveSpecForm({ projectId }: { projectId: string }) {
  const [state, formAction] = useActionState(approveSpecAction, idleBuildState);

  return (
    <form action={formAction} className="mt-4">
      <input type="hidden" name="project_id" value={projectId} />
      <SubmitButton className={primaryButton} pendingLabel="Approving…">
        Approve this specification
      </SubmitButton>
      <p className="mt-2 text-sm">
        <StateNote state={state} idle="Approval unlocks the initial project generation." />
      </p>
    </form>
  );
}

export function GenerateAppForm({ projectId }: { projectId: string }) {
  const [state, formAction] = useActionState(generateAppAction, idleBuildState);

  return (
    <form action={formAction} className={cardClass}>
      <h2 className="text-lg font-bold">Generate the project</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        The approved specification is turned into real files with a deterministic
        Next.js, TypeScript and Tailwind scaffold. Nothing is executed or deployed.
      </p>
      <input type="hidden" name="project_id" value={projectId} />
      <div className="mt-3">
        <SubmitButton className={primaryButton} pendingLabel="Generating files…">
          Generate project files
        </SubmitButton>
      </div>
      <p className="mt-2 text-sm">
        <StateNote state={state} idle="Generation validates every path and size before replacing the current tree." />
      </p>
    </form>
  );
}

export function AppFileEditor({
  projectId,
  path,
  content,
}: {
  projectId: string;
  path: string;
  content: string;
}) {
  const [state, formAction] = useActionState(saveAppFileAction, idleBuildState);

  return (
    <form action={formAction}>
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="path" value={path} />
      <label className={labelClass} htmlFor="app-file-content">
        {path}
      </label>
      <textarea
        id="app-file-content"
        name="content"
        defaultValue={content}
        rows={24}
        spellCheck={false}
        className={`mt-1.5 font-mono text-xs ${inputClass}`}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <SubmitButton className={secondaryButton} pendingLabel="Saving…">
          Save file as a new version
        </SubmitButton>
        <StateNote state={state} idle="Saving keeps the previous snapshot." />
      </div>
    </form>
  );
}

export function RestoreVersionForm({
  projectId,
  version,
}: {
  projectId: string;
  version: number;
}) {
  const [state, formAction] = useActionState(restoreAppVersionAction, idleBuildState);

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="version" value={version} />
      <SubmitButton className={quietButton} pendingLabel="Restoring…">
        Restore version {version}
      </SubmitButton>
      {state.status === "error" ? (
        <span className="ml-2 text-xs text-danger">{state.message}</span>
      ) : null}
    </form>
  );
}

export function DeleteAppProjectForm({ projectId }: { projectId: string }) {
  const [state, formAction] = useActionState(deleteAppProjectAction, idleBuildState);

  return (
    <form action={formAction} className="mt-4">
      <input type="hidden" name="project_id" value={projectId} />
      <SubmitButton className={dangerButton} pendingLabel="Deleting…">
        Delete this app project
      </SubmitButton>
      <p className="mt-2 text-sm">
        <StateNote state={state} idle="Deletes the specification, every file and every snapshot. No undo." />
      </p>
    </form>
  );
}
