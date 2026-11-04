"use server";

import { revalidatePath } from "next/cache";
import type { BuildState } from "@/lib/action-state";
import { getSession } from "@/lib/auth";
import {
  buildRecoveryPlan,
  buildReleaseEvidence,
  checkSafety,
  evaluateHttpCheck,
  automationProblems,
  proposeDiagnosis,
  redactReleaseText,
  RELEASE_CHECK_KINDS,
  RECOVERY_KINDS,
  type RecoveryKind,
  type ReleaseCheckConfig,
  type ReleaseCheckKind,
} from "@/lib/releases";
import { extractEnvRequirements, type DeploymentFile } from "@/lib/deployments";
import { isUuid, readText } from "@/lib/validation";

/**
 * Phase 29 actions.
 *
 * Release actions compose evidence and record observations. Incident writes go
 * through guarded database functions; automatic rollback is never executed by
 * this module. Every action is owner-scoped by the same project check.
 */

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That app project isn't available to you.";
const REFUSED = "That action was refused. Nothing changed.";

function fail(message: string): BuildState {
  return { status: "error", message: redactReleaseText(message), nonce: Date.now() };
}

function done(message: string): BuildState {
  return { status: "success", message: redactReleaseText(message), nonce: Date.now() };
}

function raw(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function refresh(projectId: string): void {
  revalidatePath("/build");
  revalidatePath(`/build/${projectId}`);
  revalidatePath(`/build/${projectId}/releases`);
  revalidatePath(`/build/${projectId}/deploy`);
}

function rpcMessage(error: { message?: string } | null): string {
  const message = error?.message ?? "";
  const allowed = [
    "project access denied",
    "check run not found",
    "only a failed check",
    "incident title",
    "incident not found",
    "evidence is required",
    "a hypothesis",
    "supporting evidence",
    "this incident",
    "propose a diagnosis",
    "invalid recovery kind",
    "a recovery plan",
    "a code rollback",
    "type APPROVE",
    "automatic rollback",
    "conditions must",
  ];
  return allowed.some((prefix) => message.includes(prefix)) ? message : REFUSED;
}

type OwnerSession = NonNullable<Awaited<ReturnType<typeof getSession>>>;

async function ownerProject(session: OwnerSession, projectId: string) {
  if (!isUuid(projectId)) return null;
  const { data } = await session.supabase
    .from("app_projects")
    .select("id, name, current_version")
    .eq("id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  return data as { id: string; name: string; current_version: number } | null;
}

function normalizeTarget(value: string): string {
  const trim = value.trim();
  if (!trim) return "/";
  if (!trim.startsWith("/") || trim.startsWith("//") || trim.includes("..")) return "";
  return trim.slice(0, 1000);
}

export async function captureReleaseAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const project = await ownerProject(session, projectId);
  if (!project) return fail(NOT_AVAILABLE);
  const versionNumber = Number(project.current_version);
  if (!Number.isInteger(versionNumber) || versionNumber < 1) {
    return fail("Generate or save a project version before capturing release evidence.");
  }

  const [version, previous, deployment, changes, errors] = await Promise.all([
    session.supabase
      .from("app_versions")
      .select("version, summary, files")
      .eq("project_id", projectId)
      .eq("user_id", session.user.id)
      .eq("version", versionNumber)
      .maybeSingle(),
    session.supabase
      .from("app_versions")
      .select("version, summary, files")
      .eq("project_id", projectId)
      .eq("user_id", session.user.id)
      .eq("version", versionNumber - 1)
      .maybeSingle(),
    session.supabase
      .from("app_deployments")
      .select("id, target, status, source_commit, deployment_url, migration_state, checks, error, partial_failure")
      .eq("project_id", projectId)
      .eq("user_id", session.user.id)
      .eq("snapshot_version", versionNumber)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    session.supabase
      .from("app_change_requests")
      .select("request, status, merged_version")
      .eq("project_id", projectId)
      .eq("user_id", session.user.id)
      .eq("merged_version", versionNumber)
      .limit(20),
    session.supabase
      .from("app_error_events")
      .select("message, status, release_label, created_at")
      .eq("project_id", projectId)
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  for (const result of [version, previous, deployment, changes, errors]) {
    if (result.error) {
      console.error("captureReleaseAction read failed:", result.error.message);
      return fail("The release evidence could not be read completely. Nothing was saved.");
    }
  }
  if (!version.data) return fail("The current source version is not available.");

  const files = version.data.files as DeploymentFile[];
  const previousFiles = (previous.data?.files ?? []) as DeploymentFile[];
  const currentEnv = extractEnvRequirements(files).map((requirement) => requirement.name);
  const previousEnv = extractEnvRequirements(previousFiles).map((requirement) => requirement.name);
  const evidence = buildReleaseEvidence({
    version: versionNumber,
    versionSummary: String(version.data.summary ?? ""),
    files,
    previousFiles,
    deployment: deployment.data
      ? {
          id: String(deployment.data.id),
          target: String(deployment.data.target),
          status: String(deployment.data.status),
          source_commit: deployment.data.source_commit ?? null,
          deployment_url: deployment.data.deployment_url ?? null,
          migration_state: String(deployment.data.migration_state ?? "not_recorded"),
          checks: Array.isArray(deployment.data.checks)
            ? (deployment.data.checks as { name: string; status: string; detail?: string }[])
            : [],
          error: deployment.data.error ?? null,
          partial_failure: deployment.data.partial_failure ?? null,
        }
      : null,
    changes: (changes.data ?? []) as { request: string; status: string; merged_version: number | null }[],
    errors: (errors.data ?? []) as { message: string; status: string; release_label: string; created_at: string }[],
    envNames: currentEnv,
    previousEnvNames: previousEnv,
  });

  const { data: saved, error } = await session.supabase
    .from("app_releases")
    .upsert(
      {
        project_id: projectId,
        user_id: session.user.id,
        version: versionNumber,
        deployment_id: deployment.data?.id ?? null,
        source_revision: evidence.source_revision,
        source_digest: evidence.source_digest,
        status: "review_ready",
        changed_features: evidence.changed_features,
        test_results: evidence.test_results,
        dependency_changes: evidence.dependency_changes,
        migration_requirements: evidence.migration_requirements,
        config_changes: evidence.config_changes,
        known_issues: evidence.known_issues,
        rollback_limitations: evidence.rollback_limitations,
        review: evidence.review,
        review_generated_at: new Date().toISOString(),
      },
      { onConflict: "project_id,version" },
    )
    .select("id")
    .single();
  if (error || !saved) return fail("The release evidence could not be saved. Nothing was changed.");
  refresh(projectId);

  const unverified = evidence.migration_requirements.some((item) => item.destructive.length > 0)
    ? " This release contains a destructive migration; a code rollback will not reverse it."
    : "";
  return done(
    `Release v${versionNumber} evidence captured with ${evidence.test_results.length} recorded check result(s).${unverified}`,
  );
}

export async function addReleaseCheckAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  const name = readText(formData, "name").trim();
  const kind = readText(formData, "kind") as ReleaseCheckKind;
  const target = normalizeTarget(readText(formData, "target"));
  const instructions = readText(formData, "instructions").trim();
  const expectedStatus = Number(readText(formData, "expected_status") || "200");
  const maxErrors = Number(readText(formData, "max_errors") || "0");
  if (name.length < 2 || name.length > 80) return fail("Give the check a name of 2 to 80 characters.");
  if (!RELEASE_CHECK_KINDS.includes(kind)) return fail("Choose a supported check kind.");
  if (!target) return fail("Use a relative route such as /health; full URLs and traversal are refused.");
  if (!Number.isInteger(expectedStatus) || expectedStatus < 100 || expectedStatus > 599) {
    return fail("Expected status must be between 100 and 599.");
  }
  if (!Number.isInteger(maxErrors) || maxErrors < 0 || maxErrors > 1000) {
    return fail("Error threshold must be between 0 and 1000.");
  }
  if (kind === "smoke" && instructions.length < 5) {
    return fail("Describe the functional smoke steps so a person can repeat them.");
  }
  const destructive = raw(formData, "destructive") === "on";
  const { error } = await session.supabase.from("app_release_check_configs").insert({
    project_id: projectId,
    user_id: session.user.id,
    name,
    kind,
    target: ["health", "route"].includes(kind) ? target : "",
    expected_status: expectedStatus,
    max_errors: maxErrors,
    instructions: redactReleaseText(instructions).slice(0, 4000),
    synthetic: true,
    destructive,
    enabled: true,
  });
  if (error) return fail("The check configuration could not be saved.");
  refresh(projectId);
  return done("Check configured. Destructive checks remain skipped against production.");
}

export async function runReleaseChecksAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const releaseId = readText(formData, "release_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  if (!isUuid(releaseId)) return fail("Choose a release.");

  const [releaseResult, configsResult] = await Promise.all([
    session.supabase
      .from("app_releases")
      .select("id, version, deployment_id")
      .eq("id", releaseId)
      .eq("project_id", projectId)
      .eq("user_id", session.user.id)
      .maybeSingle(),
    session.supabase
      .from("app_release_check_configs")
      .select("*")
      .eq("project_id", projectId)
      .eq("user_id", session.user.id)
      .eq("enabled", true)
      .order("created_at", { ascending: true }),
  ]);
  if (releaseResult.error || !releaseResult.data) return fail("That release is not available.");
  if (configsResult.error) return fail("The configured checks could not be read.");

  const deploymentQuery = releaseResult.data.deployment_id
    ? session.supabase
        .from("app_deployments")
        .select("target, deployment_url")
        .eq("id", releaseResult.data.deployment_id)
        .eq("project_id", projectId)
        .eq("user_id", session.user.id)
        .maybeSingle()
    : session.supabase
        .from("app_deployments")
        .select("target, deployment_url")
        .eq("project_id", projectId)
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
  const deployment = await deploymentQuery;
  const deploymentTarget: "preview" | "production" =
    deployment.data?.target === "production" ? "production" : "preview";
  const deploymentUrl = deployment.data?.deployment_url ?? null;
  const configs = (configsResult.data ?? []) as ReleaseCheckConfig[];
  if (configs.length === 0) return fail("Configure at least one check before running checks.");

  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let incidents = 0;

  for (const config of configs) {
    const safety = checkSafety(config, deploymentTarget);
    let status: "passed" | "failed" | "skipped" = "skipped";
    let detail = safety.reason;
    let observed: Record<string, unknown> = { safety: safety.reason };

    if (safety.runnable && config.kind === "error_rate") {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
      const { count, error } = await session.supabase
        .from("app_error_events")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId)
        .eq("user_id", session.user.id)
        .gte("created_at", since);
      if (error) {
        status = "skipped";
        detail = "The error events could not be counted; this is not a passing observation.";
      } else {
        const total = count ?? 0;
        status = total <= config.max_errors ? "passed" : "failed";
        detail = `${total} recorded error event(s) in the last 24 hours; threshold ${config.max_errors}. Absence of recorded errors is not proof of health.`;
        observed = { window_hours: 24, count: total, threshold: config.max_errors };
      }
    } else if (safety.runnable && ["health", "route"].includes(config.kind)) {
      if (!deploymentUrl) {
        status = "skipped";
        detail = "No deployment URL is recorded for this release, so the HTTP check did not run.";
      } else {
        try {
          const base = new URL(deploymentUrl);
          const url = new URL(config.target, base);
          if (url.origin !== base.origin) throw new Error("cross-origin");
          const response = await fetch(url, {
            redirect: "follow",
            cache: "no-store",
            signal: AbortSignal.timeout(15_000),
            headers: { "User-Agent": "get-to-it-release-check" },
          });
          const body = (await response.text()).slice(0, 20_000);
          const result = evaluateHttpCheck(
            config.kind as "health" | "route",
            response.status,
            response.headers.get("content-type"),
            body,
          );
          status = result.status === "not_run" ? "skipped" : result.status;
          detail = `${result.detail} Unauthenticated synthetic request; no production data was written.`;
          observed = {
            url: url.toString(),
            status: response.status,
            content_type: response.headers.get("content-type"),
            expected_status: config.expected_status,
            synthetic: true,
          };
          if (response.status !== config.expected_status) {
            status = "failed";
            detail = `Expected HTTP ${config.expected_status}, received ${response.status}.`;
          }
        } catch {
          status = "failed";
          detail = "The configured URL could not be reached or was not same-origin. No request was retried.";
        }
      }
    } else if (config.kind === "smoke") {
      status = "skipped";
      detail = `Manual functional smoke test not run automatically. Steps: ${config.instructions.slice(0, 600)}`;
    }

    const { data: run, error } = await session.supabase
      .from("app_release_check_runs")
      .insert({
        release_id: releaseId,
        config_id: config.id,
        project_id: projectId,
        user_id: session.user.id,
        name: config.name,
        kind: config.kind,
        status,
        observed,
        detail: redactReleaseText(detail).slice(0, 2000),
        synthetic: true,
        destructive: config.destructive,
      })
      .select("id")
      .single();
    if (error || !run) {
      failed += 1;
      continue;
    }
    if (status === "passed") passed += 1;
    else if (status === "failed") {
      failed += 1;
      const incident = await session.supabase.rpc("detect_app_release_incident", {
        p_check_run_id: run.id,
        p_title: `Failed ${config.kind} check: ${config.name}`,
        p_severity: config.kind === "health" ? "high" : "medium",
      });
      if (!incident.error) incidents += 1;
    } else skipped += 1;
  }

  refresh(projectId);
  const summary = `Checks recorded: ${passed} passed, ${failed} failed, ${skipped} skipped. ${incidents} incident(s) opened with redacted evidence.`;
  if (failed > 0) return fail(`${summary} Review the incident before preparing any recovery.`);
  return done(summary);
}

export async function recordSmokeResultAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const releaseId = readText(formData, "release_id");
  const configId = readText(formData, "config_id");
  const result = readText(formData, "result");
  const detail = readText(formData, "detail").trim();
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  if (!isUuid(releaseId) || !isUuid(configId)) return fail("Choose a functional smoke check.");
  if (!["passed", "failed"].includes(result)) return fail("Record the manual result as passed or failed.");
  if (detail.length < 3) return fail("Record what was actually exercised and observed.");

  const { data: config } = await session.supabase
    .from("app_release_check_configs")
    .select("id, name, kind, destructive")
    .eq("id", configId)
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!config || config.kind !== "smoke") return fail("That configuration is not a functional smoke test.");

  const synthetic = raw(formData, "synthetic") === "on";
  const { data: run, error } = await session.supabase
    .from("app_release_check_runs")
    .insert({
      release_id: releaseId,
      config_id: configId,
      project_id: projectId,
      user_id: session.user.id,
      name: config.name,
      kind: "smoke",
      status: result,
      observed: { manual: true, synthetic, destructive: config.destructive },
      detail: redactReleaseText(detail).slice(0, 2000),
      synthetic,
      destructive: config.destructive,
    })
    .select("id")
    .single();
  if (error || !run) return fail("The smoke result could not be recorded. Nothing was changed.");

  if (result === "failed") {
    const incident = await session.supabase.rpc("detect_app_release_incident", {
      p_check_run_id: run.id,
      p_title: `Failed functional smoke test: ${config.name}`,
      p_severity: "medium",
    });
    refresh(projectId);
    if (incident.error) return fail("The failure was recorded, but an incident could not be opened. Review the check run.");
    return fail("Functional smoke test failed. An incident was opened with the redacted observation.");
  }

  refresh(projectId);
  return done(
    `Functional smoke test recorded as passed${synthetic ? " with a synthetic account" : " manually"}. This one observation does not prove the absence of defects.`,
  );
}

export async function proposeIncidentDiagnosisAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const incidentId = readText(formData, "incident_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  if (!isUuid(incidentId)) return fail("That incident is not available.");
  let diagnosis;
  try {
    diagnosis = proposeDiagnosis(readText(formData, "hypothesis"), readText(formData, "support"));
  } catch (error) {
    return fail((error as Error).message);
  }
  const { error } = await session.supabase.rpc("propose_app_incident_diagnosis", {
    p_incident_id: incidentId,
    p_hypothesis: diagnosis.hypothesis,
    p_support: diagnosis.supportingEvidence,
    p_confirm_root: false,
  });
  if (error) return fail(rpcMessage(error));
  refresh(projectId);
  return done("Hypothesis recorded. The root cause remains unconfirmed.");
}

export async function prepareIncidentRecoveryAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const incidentId = readText(formData, "incident_id");
  const kind = readText(formData, "kind") as RecoveryKind;
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  if (!isUuid(incidentId)) return fail("That incident is not available.");
  if (!RECOVERY_KINDS.includes(kind)) return fail("Choose a distinct recovery kind.");

  const { data: incident } = await session.supabase
    .from("app_release_incidents")
    .select("id, release_id, evidence, status")
    .eq("id", incidentId)
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!incident) return fail("That incident is not available.");
  if (incident.status !== "diagnosed") return fail("Propose a diagnosis before preparing a recovery plan.");
  const { data: release } = await session.supabase
    .from("app_releases")
    .select("version, source_revision, migration_requirements")
    .eq("id", incident.release_id)
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!release) return fail("The incident release is not available.");
  const migrations = Array.isArray(release.migration_requirements)
    ? (release.migration_requirements as { state?: string; destructive?: string[] }[])
    : [];
  const migrationState =
    migrations.length > 0
      ? migrations.map((item) => `${item.state ?? "unknown"}${item.destructive?.length ? " (destructive)" : ""}`).join("; ")
      : "no migration files recorded";
  const plan = buildRecoveryPlan(kind, {
    releaseVersion: Number(release.version),
    sourceRevision: String(release.source_revision),
    migrationState,
  });

  const { error } = await session.supabase.rpc("prepare_app_incident_recovery", {
    p_incident_id: incidentId,
    p_kind: kind,
    p_plan: plan,
  });
  if (error) return fail(rpcMessage(error));
  refresh(projectId);
  return done(`${plan.label} prepared and approval requested. Nothing was executed.`);
}

export async function approveIncidentRecoveryAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const incidentId = readText(formData, "incident_id");
  const confirmation = readText(formData, "confirmation").trim();
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  if (!isUuid(incidentId)) return fail("That incident is not available.");
  if (confirmation !== "APPROVE") return fail("Type APPROVE exactly to approve the prepared recovery action.");
  const { error } = await session.supabase.rpc("approve_app_incident_action", {
    p_incident_id: incidentId,
    p_confirmation: confirmation,
  });
  if (error) return fail(rpcMessage(error));
  refresh(projectId);
  return done("Recovery approved. This dashboard did not execute it; perform only the separately reviewed steps.");
}

export async function saveReleaseAutomationAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  const enabled = raw(formData, "auto_rollback_enabled") === "on";
  const conditions = readText(formData, "conditions")
    .split(/\r?\n/)
    .map((item) => redactReleaseText(item.trim()).slice(0, 300))
    .filter(Boolean)
    .slice(0, 12);
  const limitations = redactReleaseText(readText(formData, "limitations")).slice(0, 4000);
  const problems = automationProblems({
    auto_rollback_enabled: enabled,
    conditions,
    limitations,
  });
  if (problems.length > 0) return fail(problems.join(" "));
  const { error } = await session.supabase.rpc("save_app_release_automation", {
    p_project_id: projectId,
    p_enabled: enabled,
    p_conditions: conditions,
    p_limitations: limitations,
  });
  if (error) return fail(rpcMessage(error));
  refresh(projectId);
  return done(
    enabled
      ? "Automatic rollback enabled with explicit conditions and limitations. Execution still needs a separate incident approval."
      : "Automatic rollback is disabled. Release recommendations remain available.",
  );
}

export async function disableReleaseAutomationAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  const { error } = await session.supabase.rpc("disable_app_release_automation", {
    p_project_id: projectId,
  });
  if (error) return fail(rpcMessage(error));
  refresh(projectId);
  return done("Automatic rollback disabled and recorded in the audit trail.");
}
