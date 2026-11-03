"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleBuildState, type BuildState } from "@/lib/action-state";
import {
  connectSupabaseProjectsAction,
  disconnectSupabaseAccountAction,
} from "@/lib/actions/app-deployments";
import { dangerButton, inputClass, primaryButton } from "@/lib/styles";
import type { AppProviderConnection, SupabaseAccountConnection } from "@/lib/types";

type Organization = { id: string; slug: string; name: string };
type Project = {
  id: string;
  ref: string;
  name: string;
  organization_slug: string;
  status: string;
  region: string;
};

function ActionNote({ state }: { state: BuildState }) {
  if (state.status === "error") {
    return <span className="text-sm text-danger" role="alert">{state.message}</span>;
  }
  if (state.status === "success") return <span className="text-sm text-mint">{state.message}</span>;
  return null;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function DisconnectAccountForm({ projectId }: { projectId: string }) {
  const [state, action] = useActionState(disconnectSupabaseAccountAction, idleBuildState);
  return (
    <form action={action} className="mt-2">
      <input type="hidden" name="project_id" value={projectId} />
      <SubmitButton className={dangerButton} pendingLabel="Disconnecting…">
        Disconnect Supabase account
      </SubmitButton>
      <p className="mt-1"><ActionNote state={state} /></p>
    </form>
  );
}

export function SupabaseOAuthPanel({
  projectId,
  account,
  connection,
}: {
  projectId: string;
  account: SupabaseAccountConnection | null;
  connection: AppProviderConnection | null;
}) {
  const [state, action] = useActionState(connectSupabaseProjectsAction, idleBuildState);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [org, setOrg] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [developmentRef, setDevelopmentRef] = useState("");
  const [productionRef, setProductionRef] = useState("");
  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadError, setLoadError] = useState("");

  const metadata = connection?.metadata ?? {};
  const currentDevelopment = typeof metadata.development_ref === "string" ? metadata.development_ref : "";
  const currentProduction = typeof metadata.production_ref === "string" ? metadata.production_ref : "";

  const activeOrg = organizations.some((item) => item.slug === org)
    ? org
    : organizations[0]?.slug ?? "";

  useEffect(() => {
    if (!account || account.status !== "connected") return;
    let cancelled = false;
    const load = async () => {
      setLoadingOrgs(true);
      setLoadError("");
      try {
        const response = await fetch("/api/integrations/supabase/organizations", { cache: "no-store" });
        const body = await readJson(response);
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Organizations could not be loaded.");
        if (!cancelled) {
          setOrganizations((Array.isArray(body.organizations) ? body.organizations : []) as Organization[]);
        }
      } catch (error: unknown) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Organizations could not be loaded.");
      } finally {
        if (!cancelled) setLoadingOrgs(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [account]);

  useEffect(() => {
    if (!activeOrg) return;
    let cancelled = false;
    const load = async () => {
      setLoadingProjects(true);
      setLoadError("");
      try {
        const response = await fetch(
          `/api/integrations/supabase/projects?org=${encodeURIComponent(activeOrg)}`,
          { cache: "no-store" },
        );
        const body = await readJson(response);
        if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Projects could not be loaded.");
        if (cancelled) return;
        const rows = (Array.isArray(body.projects) ? body.projects : []) as Project[];
        setProjects(rows);
        const hasCurrentDevelopment = rows.some((item) => item.ref === currentDevelopment);
        const nextDevelopment = hasCurrentDevelopment ? currentDevelopment : rows[0]?.ref ?? "";
        const hasCurrentProduction = rows.some((item) => item.ref === currentProduction) && currentProduction !== nextDevelopment;
        const nextProduction = hasCurrentProduction
          ? currentProduction
          : rows.find((item) => item.ref !== nextDevelopment)?.ref ?? "";
        setDevelopmentRef(nextDevelopment);
        setProductionRef(nextProduction);
      } catch (error: unknown) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Projects could not be loaded.");
      } finally {
        if (!cancelled) setLoadingProjects(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeOrg, currentDevelopment, currentProduction]);

  if (!account || account.status !== "connected") {
    return (
      <div className="mt-2 space-y-2">
        <p className="text-sm text-muted">
          Connect your own Supabase account. The projects stay in your organization and Supabase bills your account,
          not this platform.
        </p>
        <a
          href={`/api/integrations/supabase/start?project_id=${encodeURIComponent(projectId)}`}
          className={primaryButton}
        >
          Connect Supabase account
        </a>
        {account?.status === "revoked" ? (
          <p className="text-xs text-danger">The previous grant was revoked. Reconnect to choose projects again.</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-3">
      <div className="rounded-xl border border-line bg-paper p-3">
        <p className="text-sm font-semibold">{account.account_label}</p>
        <p className="text-xs text-muted">
          OAuth Management API access · token expires {account.expires_at?.slice(0, 19).replace("T", " ") ?? "unknown"}
        </p>
        {account.scopes ? <p className="mt-1 break-words font-mono text-[11px] text-muted">{account.scopes}</p> : null}
        <DisconnectAccountForm projectId={projectId} />
      </div>

      {loadingOrgs ? <p className="text-sm text-muted">Loading organizations…</p> : null}
      {loadError ? <p className="text-sm text-danger" role="alert">{loadError}</p> : null}

      {organizations.length === 0 && !loadingOrgs && !loadError ? (
        <p className="text-sm text-muted">
          No organizations are available to this grant. Create one in Supabase, reconnect, or use the connection-string
          fallback below.
        </p>
      ) : null}

      {organizations.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-semibold">
            Organization
            <select
              value={activeOrg}
              onChange={(event) => {
                setOrg(event.target.value);
                setProjects([]);
                setDevelopmentRef("");
                setProductionRef("");
              }}
              className={`${inputClass} mt-1`}
            >
              {organizations.map((item) => (
                <option key={item.slug} value={item.slug}>{item.name}</option>
              ))}
            </select>
          </label>
          <div className="text-xs text-muted">
            <p className="font-semibold text-ink">Where projects are created</p>
            <p>Create projects in the Supabase dashboard, then return here to attach them.</p>
            <a
              href="https://supabase.com/dashboard"
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 inline-block underline"
            >
              Open Supabase dashboard
            </a>
          </div>
        </div>
      ) : null}

      {loadingProjects ? <p className="text-sm text-muted">Loading projects…</p> : null}

      {projects.length > 0 ? (
        <form action={action} className="space-y-3 border-t border-line pt-3">
          <input type="hidden" name="project_id" value={projectId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold">
              Development project
              <select
                name="development_ref"
                required
                value={developmentRef}
                onChange={(event) => setDevelopmentRef(event.target.value)}
                className={`${inputClass} mt-1`}
              >
                {projects.map((project) => (
                  <option key={project.ref} value={project.ref}>
                    {project.name} ({project.ref}) · {project.status}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-semibold">
              Production project
              <select
                name="production_ref"
                required
                value={productionRef}
                onChange={(event) => setProductionRef(event.target.value)}
                className={`${inputClass} mt-1`}
              >
                {projects.map((project) => (
                  <option key={project.ref} value={project.ref}>
                    {project.name} ({project.ref}) · {project.status}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs leading-relaxed text-muted">
            Preview uses the development project; production uses the production project. They must be different.
            Migrations run through the Management API, so no database password is stored. This app still uses two
            projects; a free Supabase account allows two active projects.
          </p>
          {developmentRef === productionRef ? (
            <p className="text-xs text-danger">Choose two different projects before attaching them.</p>
          ) : null}
          <SubmitButton
            className={primaryButton}
            pendingLabel="Attaching projects…"
            disabled={!developmentRef || !productionRef || developmentRef === productionRef}
          >
            Use these Supabase projects
          </SubmitButton>
          <p><ActionNote state={state} /></p>
        </form>
      ) : null}

      {!loadingProjects && activeOrg && projects.length === 0 && !loadError ? (
        <p className="text-sm text-muted">
          This organization has no projects yet. Create two projects in Supabase, then reload this page.
        </p>
      ) : null}

      {connection?.status === "connected" && !metadata.oauth ? (
        <p className="text-xs text-muted">
          This app currently uses pasted connection strings. Attaching projects above replaces that connection with the
          OAuth Management API path.
        </p>
      ) : null}

    </div>
  );
}
