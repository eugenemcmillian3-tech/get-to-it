"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleBuildState, type BuildState } from "@/lib/action-state";
import {
  connectDatabaseAction,
  createOpenApiDraftAction,
  disconnectIntegrationAction,
  generateIntegrationCodeAction,
  rotateIntegrationSecretAction,
  saveIntegrationSelectionAction,
  testIntegrationAction,
} from "@/lib/actions/app-integrations";
import {
  APP_INTEGRATION_KINDS,
  INTEGRATION_LIMITS,
  mappingToText,
  type AppIntegrationKind,
} from "@/lib/integrations/registry";
import type { AppIntegration } from "@/lib/types";
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

export function OpenApiIntegrationForm({ projectId, vaultReady }: { projectId: string; vaultReady: boolean }) {
  const [state, formAction] = useActionState(createOpenApiDraftAction, idleBuildState);

  return (
    <form action={formAction} className={cardClass}>
      <h3 className="text-base font-bold">Import an OpenAPI document</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Accepts one JSON OpenAPI 3 document up to {INTEGRATION_LIMITS.maxSpecBytes.toLocaleString()} bytes.
        YAML, Swagger 2 and external references are not followed. Descriptions and examples are untrusted
        documentation and are never executed.
      </p>
      <div className="mt-4 space-y-3">
        <input type="hidden" name="project_id" value={projectId} />
        <div>
          <label className={labelClass} htmlFor="openapi-name">Integration name</label>
          <input id="openapi-name" name="name" className={`mt-1.5 ${inputClass}`} placeholder="Billing API" required />
        </div>
        <div>
          <label className={labelClass} htmlFor="openapi-file">OpenAPI 3 JSON</label>
          <input
            id="openapi-file"
            name="spec"
            type="file"
            accept=".json,application/json"
            className={`mt-1.5 ${inputClass}`}
            required
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="openapi-base">Base URL</label>
          <input
            id="openapi-base"
            name="base_url"
            type="url"
            className={`mt-1.5 ${inputClass}`}
            placeholder="https://api.example.com/v1"
          />
          <p className={hintClass}>Optional if the document has a server URL. Only public http/https hosts are allowed.</p>
        </div>
        <div>
          <label className={labelClass} htmlFor="openapi-key">API credential (optional)</label>
          <input
            id="openapi-key"
            name="api_key"
            type="password"
            autoComplete="off"
            className={`mt-1.5 ${inputClass}`}
            placeholder="Encrypted server-side; never shown again"
            disabled={!vaultReady}
          />
          <p className={hintClass}>
            {vaultReady
              ? "The value is sealed with the existing deployment vault and never enters generated code."
              : "Set DEPLOYMENT_VAULT_KEY before saving a credential. You can still import a public API without one."}
          </p>
        </div>
        <SubmitButton className={primaryButton} pendingLabel="Validating specification…">
          Preview operations
        </SubmitButton>
        <p className="text-sm"><StateNote state={state} /></p>
      </div>
    </form>
  );
}

export function DatabaseIntegrationForm({ projectId, vaultReady }: { projectId: string; vaultReady: boolean }) {
  const [state, formAction] = useActionState(connectDatabaseAction, idleBuildState);

  return (
    <form action={formAction} className={cardClass}>
      <h3 className="text-base font-bold">Connect PostgreSQL</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Separate development and production URLs are required. Schema inspection runs in a read-only
        transaction and never selects table rows. This build supports PostgreSQL only; it does not claim
        compatibility with every database.
      </p>
      <div className="mt-4 space-y-3">
        <input type="hidden" name="project_id" value={projectId} />
        <div>
          <label className={labelClass} htmlFor="database-name">Integration name</label>
          <input id="database-name" name="name" className={`mt-1.5 ${inputClass}`} placeholder="Reporting database" required />
        </div>
        <div>
          <label className={labelClass} htmlFor="database-dev">Development connection URL</label>
          <input
            id="database-dev"
            name="development_url"
            type="password"
            autoComplete="off"
            className={`mt-1.5 ${inputClass}`}
            placeholder="postgresql://readonly@localhost:5432/app_dev"
            required
            disabled={!vaultReady}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="database-prod">Production connection URL</label>
          <input
            id="database-prod"
            name="production_url"
            type="password"
            autoComplete="off"
            className={`mt-1.5 ${inputClass}`}
            placeholder="postgresql://readonly@prod.example.com:5432/app"
            required
            disabled={!vaultReady}
          />
        </div>
        <p className="text-xs leading-relaxed text-muted">
          Prefer read-only credentials. Both values are encrypted server-side; the UI and logs receive
          only a host/database label. No migration is applied by this action.
        </p>
        <SubmitButton className={primaryButton} pendingLabel="Inspecting schema read-only…" disabled={!vaultReady}>
          Connect and inspect
        </SubmitButton>
        <p className="text-sm"><StateNote state={state} idle={vaultReady ? undefined : "The vault is not configured."} /></p>
      </div>
    </form>
  );
}

export function IntegrationSelectionForm({
  projectId,
  integration,
}: {
  projectId: string;
  integration: AppIntegration;
}) {
  const [state, formAction] = useActionState(saveIntegrationSelectionAction, idleBuildState);
  const isDatabase = integration.kind === "postgres";
  const available = isDatabase
    ? (integration.config.tables ?? []).map((table) => ({ key: table.name, label: table.name }))
    : (integration.config.operations ?? []).map((operation) => ({
        key: operation.key,
        label: `${operation.method} ${operation.path}`,
      }));
  const selected = new Set(integration.allowed_operations);

  return (
    <form action={formAction} className="mt-4 border-t border-line pt-4">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="integration_id" value={integration.id} />
      <h4 className="text-sm font-bold">Allowed {isDatabase ? "tables" : "operations"}</h4>
      <p className={hintClass}>
        Only selected entries are generated. {isDatabase ? "Schema inspection does not read records." : "Descriptions are shown but never executed."}
      </p>
      <div className="mt-2 grid gap-1 sm:grid-cols-2">
        {available.map((item) => (
          <label key={item.key} className="flex items-start gap-2 rounded px-1 py-0.5 text-xs">
            <input
              type="checkbox"
              name="operations"
              value={item.key}
              defaultChecked={selected.has(item.key)}
              className="mt-0.5"
            />
            <span className="break-all font-mono">{item.label}</span>
          </label>
        ))}
      </div>
      {!isDatabase ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium">Review operation descriptions</summary>
          <ul className="mt-1 space-y-1 text-xs text-muted">
            {(integration.config.operations ?? []).map((operation) => (
              <li key={operation.key}>
                <span className="font-mono">{operation.key}</span>
                {operation.summary ? ` — ${operation.summary}` : ""}
                {operation.description ? <p className="mt-0.5 break-words">{operation.description}</p> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="mt-3">
        <label className={labelClass} htmlFor={`mapping-${integration.id}`}>Map integration data to app features</label>
        <textarea
          id={`mapping-${integration.id}`}
          name="mapping"
          rows={3}
          defaultValue={mappingToText(integration.mapping)}
          className={`mt-1.5 font-mono text-xs ${inputClass}`}
          placeholder="Invoices page = GET /invoices"
        />
        <p className={hintClass}>One line as <code>feature = operation or table</code>. Saved as metadata; it does not execute anything.</p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <SubmitButton className={secondaryButton} pendingLabel="Saving selection…">
          Save allowed {isDatabase ? "tables" : "operations"}
        </SubmitButton>
        <StateNote state={state} />
      </div>
    </form>
  );
}

export function IntegrationTestForm({ projectId, integration }: { projectId: string; integration: AppIntegration }) {
  const [state, formAction] = useActionState(testIntegrationAction, idleBuildState);

  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-center gap-3">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="integration_id" value={integration.id} />
      <SubmitButton className={quietButton} pendingLabel="Testing safely…">
        Test connection
      </SubmitButton>
      <StateNote state={state} />
    </form>
  );
}

export function IntegrationRotateForm({ projectId, integration }: { projectId: string; integration: AppIntegration }) {
  const [state, formAction] = useActionState(rotateIntegrationSecretAction, idleBuildState);
  const isDatabase = integration.kind === "postgres";

  return (
    <details className="mt-3 rounded-xl border border-line p-3">
      <summary className="cursor-pointer text-sm font-semibold">Rotate credential</summary>
      <form action={formAction} className="mt-3 space-y-2">
        <input type="hidden" name="project_id" value={projectId} />
        <input type="hidden" name="integration_id" value={integration.id} />
        {isDatabase ? (
          <>
            <input name="development_url" type="password" autoComplete="off" className={inputClass} placeholder="Replacement development URL" required />
            <input name="production_url" type="password" autoComplete="off" className={inputClass} placeholder="Replacement production URL" required />
          </>
        ) : (
          <input name="api_key" type="password" autoComplete="off" className={inputClass} placeholder="Replacement API credential" required />
        )}
        <SubmitButton className={secondaryButton} pendingLabel="Rotating…">Replace credential</SubmitButton>
        <p className="text-sm"><StateNote state={state} /></p>
      </form>
    </details>
  );
}

export function IntegrationDisconnectForm({ projectId, integration }: { projectId: string; integration: AppIntegration }) {
  const [state, formAction] = useActionState(disconnectIntegrationAction, idleBuildState);

  return (
    <form action={formAction} className="mt-3">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="integration_id" value={integration.id} />
      <SubmitButton className={dangerButton} pendingLabel="Disconnecting…" disabled={integration.status === "disconnected"}>
        Disconnect
      </SubmitButton>
      <p className="mt-1 text-sm"><StateNote state={state} idle="Clears the sealed credential. Generated files stay until you remove them." /></p>
    </form>
  );
}

export function IntegrationCodeForm({ projectId, integration }: { projectId: string; integration: AppIntegration }) {
  const [state, formAction] = useActionState(generateIntegrationCodeAction, idleBuildState);

  return (
    <form action={formAction} className="mt-3">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="integration_id" value={integration.id} />
      <SubmitButton className={primaryButton} pendingLabel="Generating code…" disabled={integration.status !== "connected"}>
        Add generated code to app
      </SubmitButton>
      <p className="mt-1 text-sm">
        <StateNote state={state} idle="Writes a new version through the existing app-file snapshot system. The code is not executed." />
      </p>
    </form>
  );
}

export function IntegrationKindLegend({ kind }: { kind: AppIntegrationKind }) {
  const item = APP_INTEGRATION_KINDS.find((entry) => entry.id === kind);
  return <span className="text-xs text-muted">{item?.short ?? kind}</span>;
}
