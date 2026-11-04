"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import type { ApiCredentialState } from "@/lib/actions/api-keys";
import {
  createApiKeyAction,
  createApiWebhookAction,
  revokeApiKeyAction,
  revokeApiWebhookAction,
} from "@/lib/actions/api-keys";
import { API_SCOPES, SCOPE_LABELS } from "@/lib/api/contracts";
import {
  dangerButton,
  hintClass,
  inputClass,
  labelClass,
  primaryButton,
  quietButton,
} from "@/lib/styles";

const initial: ApiCredentialState = { status: "idle" };

function Note({ state }: { state: ApiCredentialState }) {
  if (state.status === "error") {
    return (
      <span className="text-danger" role="alert">
        {state.message}
      </span>
    );
  }
  if (state.status === "success") {
    return <span className="text-mint">{state.message}</span>;
  }
  return null;
}

function OneTimeSecret({ value, label }: { value: string; label: string }) {
  return (
    <div className="mt-2 rounded-xl border border-line bg-paper p-3">
      <p className="text-xs font-semibold text-ink">{label}</p>
      <code className="mt-1 block break-all font-mono text-xs text-ink">{value}</code>
      <p className="mt-1 text-xs text-muted">
        This value is shown once in this panel. It is not stored in plaintext and cannot be
        retrieved again.
      </p>
    </div>
  );
}

export function CreateApiKeyForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(createApiKeyAction, initial);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="project_id" value={projectId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={labelClass}>
          Key name
          <input
            name="name"
            required
            minLength={2}
            maxLength={80}
            className={`${inputClass} mt-1`}
            placeholder="CI build key"
          />
        </label>
        <label className={labelClass}>
          Requests per minute
          <input
            name="rate_limit"
            type="number"
            min={1}
            max={600}
            defaultValue={60}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label className={labelClass}>
          Expires in days
          <input
            name="expires_days"
            type="number"
            min={1}
            max={365}
            defaultValue={30}
            className={`${inputClass} mt-1`}
          />
        </label>
      </div>

      <fieldset>
        <legend className={labelClass}>Scopes</legend>
        <div className="mt-1 grid gap-2 sm:grid-cols-2">
          {API_SCOPES.map((scope) => (
            <label key={scope} className="flex items-start gap-2 text-sm">
              <input name="scopes" type="checkbox" value={scope} defaultChecked className="mt-1" />
              <span>
                <code className="text-xs">{scope}</code>
                <span className="mt-0.5 block text-xs text-muted">{SCOPE_LABELS[scope]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <SubmitButton className={primaryButton} pendingLabel="Creating key…">
        Create API key
      </SubmitButton>
      <p className={`${hintClass} text-xs`}>
        A key is limited to this project. It never bypasses owner permissions, credit
        balances, action approval or deployment restrictions.
      </p>
      <div className="text-sm">
        <Note state={state} />
        {state.secret ? (
          <OneTimeSecret value={state.secret} label={`Token for ${state.prefix ?? "this key"}`} />
        ) : null}
      </div>
    </form>
  );
}

export function RevokeApiKeyForm({ projectId, keyId }: { projectId: string; keyId: string }) {
  const [state, action] = useActionState(revokeApiKeyAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="key_id" value={keyId} />
      <SubmitButton className={quietButton} pendingLabel="Revoking…">
        Revoke
      </SubmitButton>
      <span className="text-xs">
        <Note state={state} />
      </span>
    </form>
  );
}

export function CreateApiWebhookForm({
  projectId,
  vaultReady,
}: {
  projectId: string;
  vaultReady: boolean;
}) {
  const [state, action] = useActionState(createApiWebhookAction, initial);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="project_id" value={projectId} />
      <label className={labelClass}>
        Endpoint URL
        <input
          name="url"
          type="url"
          required
          maxLength={1000}
          className={`${inputClass} mt-1`}
          placeholder="https://example.com/hooks/gettoit"
        />
        <span className={hintClass}>HTTPS only, except localhost during development.</span>
      </label>
      <fieldset>
        <legend className={labelClass}>Events</legend>
        <div className="mt-1 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input name="events" type="checkbox" value="build.completed" defaultChecked />
            build.completed
          </label>
          <label className="flex items-center gap-2">
            <input name="events" type="checkbox" value="build.failed" defaultChecked />
            build.failed
          </label>
        </div>
      </fieldset>
      <SubmitButton className={primaryButton} pendingLabel="Registering…">
        Register webhook
      </SubmitButton>
      {!vaultReady ? (
        <p className="text-xs text-danger">
          The deployment vault is not configured, so webhook signing is unavailable.
        </p>
      ) : null}
      <div className="text-sm">
        <Note state={state} />
        {state.webhookSecret ? (
          <OneTimeSecret value={state.webhookSecret} label="Webhook signing secret" />
        ) : null}
      </div>
    </form>
  );
}

export function RevokeApiWebhookForm({
  projectId,
  webhookId,
}: {
  projectId: string;
  webhookId: string;
}) {
  const [state, action] = useActionState(revokeApiWebhookAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="webhook_id" value={webhookId} />
      <SubmitButton className={dangerButton} pendingLabel="Removing…">
        Remove
      </SubmitButton>
      <span className="text-xs">
        <Note state={state} />
      </span>
    </form>
  );
}
