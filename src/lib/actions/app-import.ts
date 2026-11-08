"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { BuildState } from "@/lib/action-state";
import { getSession } from "@/lib/auth";
import {
  AppImportError,
  IMPORT_LIMITS,
  isImportObjective,
  type ImportObjective,
} from "@/lib/app-import-constants";
import { extractZip } from "@/lib/app-import-archive";
import { fetchGitHubZipball } from "@/lib/app-import-github";
import {
  buildAppMap,
  buildModernizationProposal,
  parseAppMapJson,
  projectFieldsForImport,
  selectImportFiles,
  type AppImportRecord,
  type AppImportBaselineRecord,
  type AppModernizationRecord,
  type BaselineSnapshot,
  type ImportedFile,
} from "@/lib/app-import";
import {
  connectionAad,
  decryptSecret,
  encryptSecret,
  vaultConfigured,
} from "@/lib/deploy/vault";
import { redactSecrets } from "@/lib/deployments";
import { CHANGE_KINDS, inspectProject, type ChangeKind } from "@/lib/improvements";
import {
  PREVIEW_LIMITS,
  PreviewError,
  checkSummary,
  createRunnerWorkspace,
  getPreviewConfig,
  runRunnerChecks,
  stopRunnerWorkspace,
  type PreviewCheck,
} from "@/lib/preview-workspace";
import { isUuid, readText } from "@/lib/validation";

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That app project isn't available to you.";
const VAULT_MISSING =
  "The deployment vault isn't configured, so an existing GitHub connection cannot be decrypted.";
const RUNNER_MISSING =
  "The preview runner isn't configured. Add PREVIEW_RUNNER_URL, PREVIEW_RUNNER_TOKEN, PREVIEW_SIGNING_SECRET and PREVIEW_PUBLIC_ORIGIN.";

function fail(message: string): BuildState {
  return { status: "error", message: redactSecrets(message), nonce: Date.now() };
}

function done(message: string, link?: string): BuildState {
  return { status: "success", message: redactSecrets(message), link, nonce: Date.now() };
}

function refresh(projectId: string): void {
  revalidatePath("/build");
  revalidatePath("/build/import");
  revalidatePath(`/build/${projectId}`);
  revalidatePath(`/build/${projectId}/import`);
  revalidatePath(`/build/${projectId}/improve`);
}

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

async function ownerProject(session: Session, projectId: string) {
  if (!isUuid(projectId)) return null;
  const { data } = await session.supabase
    .from("app_projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  return data;
}

async function projectFiles(
  session: Session,
  projectId: string,
): Promise<ImportedFile[]> {
  const { data } = await session.supabase
    .from("app_files")
    .select("path, content")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .order("path", { ascending: true });
  return (data ?? []) as ImportedFile[];
}

async function importFor(
  session: Session,
  projectId: string,
): Promise<AppImportRecord | null> {
  const { data } = await session.supabase
    .from("app_imports")
    .select("*")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  return (data as AppImportRecord | null) ?? null;
}

type SourceConnection = {
  id: string;
  project_id: string;
  external_ref: string;
  account_label: string | null;
  metadata: Record<string, unknown>;
};

async function sourceConnection(session: Session, connectionId: string): Promise<SourceConnection | null> {
  if (!isUuid(connectionId)) return null;
  const { data } = await session.supabase
    .from("app_provider_connections_safe")
    .select("id, project_id, provider, status, external_ref, account_label, metadata")
    .eq("id", connectionId)
    .eq("user_id", session.user.id)
    .eq("provider", "github")
    .eq("status", "connected")
    .maybeSingle();
  if (!data || typeof data.external_ref !== "string") return null;
  return data as SourceConnection;
}

async function connectionToken(session: Session, connection: SourceConnection): Promise<string> {
  const { data, error } = await session.supabase.rpc("get_provider_secret", {
    p_project_id: connection.project_id,
    p_provider: "github",
  });
  if (error || typeof data !== "string" || data === "") {
    throw new AppImportError(
      "The existing GitHub connection is no longer available. Reconnect it in the source project and try again.",
    );
  }
  try {
    return decryptSecret(data, connectionAad(connection.project_id, "github"));
  } catch {
    throw new AppImportError(
      "The existing GitHub connection could not be decrypted. Reconnect it and try again.",
    );
  }
}

async function copyConnection(
  session: Session,
  source: SourceConnection,
  token: string,
  projectId: string,
): Promise<boolean> {
  try {
    const metadata = source.metadata as Record<string, unknown>;
    const { error } = await session.supabase.rpc("save_provider_connection", {
      p_project_id: projectId,
      p_provider: "github",
      p_status: "connected",
      p_account_label: source.account_label ?? "GitHub account",
      p_external_ref: source.external_ref,
      p_scope_label: `Contents read/write on ${source.external_ref}`,
      p_metadata: metadata,
      p_secret_sealed: encryptSecret(token, connectionAad(projectId, "github")),
    });
    return !error;
  } catch {
    return false;
  }
}

function sourceLabelForArchive(file: File): string {
  return (file.name || "Uploaded project archive").slice(0, 300);
}

function compactChecks(checks: PreviewCheck[]): PreviewCheck[] {
  return checks.map((check) => ({ ...check, log: check.log.slice(0, 12_000) }));
}

async function recordBaseline(
  session: Session,
  input: {
    importRecord: AppImportRecord;
    status: "passed" | "failed" | "blocked";
    summary: string;
    checks: PreviewCheck[];
    failures: string[];
    log: string;
    durationMs: number;
  },
): Promise<void> {
  const { error } = await session.supabase.from("app_import_baselines").insert({
    import_id: input.importRecord.id,
    project_id: input.importRecord.project_id,
    user_id: session.user.id,
    status: input.status,
    summary: input.summary.slice(0, 500),
    checks: compactChecks(input.checks),
    failures: input.failures.slice(0, 20),
    log: input.log.slice(0, PREVIEW_LIMITS.maxLogChars),
    duration_ms: Math.max(0, Math.round(input.durationMs)),
  });
  if (error) console.error("recordBaseline insert failed:", error.message);
  await session.supabase
    .from("app_imports")
    .update({
      baseline_status: input.status,
      baseline_at: new Date().toISOString(),
    })
    .eq("id", input.importRecord.id)
    .eq("user_id", session.user.id);
}

export async function importAppAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const source = readText(formData, "source");
  if (source !== "archive" && source !== "git") {
    return fail("Choose an uploaded ZIP archive or an existing GitHub connection.");
  }

  let archive: Uint8Array | null = null;
  const sourceKind: "archive" | "git" = source;
  let sourceLabel = "";
  let sourceRef: string | null = null;
  let connection: SourceConnection | null = null;
  let token: string | null = null;

  if (source === "archive") {
    const file = formData.get("archive");
    if (!(file instanceof File) || file.size === 0) return fail("Choose a project .zip archive first.");
    if (!file.name.toLowerCase().endsWith(".zip")) return fail("Upload a .zip archive.");
    if (file.size > IMPORT_LIMITS.maxArchiveBytes) {
      return fail(`That archive is larger than ${Math.floor(IMPORT_LIMITS.maxArchiveBytes / 1024 / 1024)} MB.`);
    }
    archive = new Uint8Array(await file.arrayBuffer());
    sourceLabel = sourceLabelForArchive(file);
    sourceRef = file.name.slice(0, 400);
  } else {
    if (!vaultConfigured()) return fail(VAULT_MISSING);
    connection = await sourceConnection(session, readText(formData, "connection_id"));
    if (!connection) return fail("That GitHub connection isn't available to you. Reconnect it or use an archive.");
    token = await connectionToken(session, connection);
    const metadata = connection.metadata as Record<string, unknown>;
    const branch =
      typeof metadata.branch === "string"
        ? metadata.branch
        : typeof metadata.default_branch === "string"
          ? metadata.default_branch
          : "main";
    try {
      archive = await fetchGitHubZipball({
        token,
        repository: connection.external_ref,
        branch,
      });
    } catch (error) {
      if (error instanceof AppImportError) return fail(error.message);
      return fail("The repository archive could not be downloaded.");
    }
    sourceLabel = `${connection.external_ref}@${branch}`.slice(0, 300);
    sourceRef = sourceLabel;
  }

  let projectId: string | null = null;
  try {
    const extracted = extractZip(archive);
    const selection = selectImportFiles(extracted.entries);
    const map = buildAppMap(selection.files, { label: sourceLabel, ref: sourceRef });
    const requestedName = readText(formData, "name");
    const fields = projectFieldsForImport(map, { label: sourceLabel }, requestedName);
    if (fields.name.length < 3 || fields.name.length > 80) {
      return fail("Give the imported project a name between 3 and 80 characters.");
    }

    const { data: project, error: projectError } = await session.supabase
      .from("app_projects")
      .insert({
        user_id: session.user.id,
        ...fields,
        status: "generated",
        last_generation_status: "succeeded",
        last_generation_note: `Imported ${selection.files.length} files from ${sourceLabel}.`,
        last_generated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (projectError || !project) {
      console.error("importAppAction project failed:", projectError?.message);
      return fail("We couldn't save the imported project. Nothing was created.");
    }
    projectId = project.id as string;

    const { error: filesError } = await session.supabase.rpc("replace_app_files", {
      p_project_id: projectId,
      p_files: selection.files,
      p_summary: `Imported ${selection.files.length} files from ${sourceLabel}`.slice(0, 500),
      p_note: "Phase 31 import. Inspection only; no install scripts or project code were executed.".slice(0, 500),
    });
    if (filesError) {
      console.error("importAppAction files failed:", filesError.message);
      await session.supabase.from("app_projects").delete().eq("id", projectId).eq("user_id", session.user.id);
      projectId = null;
      return fail("The imported files could not be stored. Nothing was kept.");
    }

    const { data: importRecord, error: importError } = await session.supabase
      .from("app_imports")
      .insert({
        project_id: projectId,
        user_id: session.user.id,
        source_kind: sourceKind,
        source_label: sourceLabel,
        source_ref: sourceRef,
        source_connection_id: connection?.id ?? null,
        framework: "nextjs",
        framework_version: map.framework.version,
        router: "app",
        package_manager: selection.packageManager,
        file_count: selection.files.length,
        archive_bytes: archive.byteLength,
        expanded_bytes: extracted.expandedBytes,
        skipped: selection.skipped,
        map,
        metadata: {
          source_root: selection.root,
          package_name: selection.packageName,
          connection_copied: false,
          no_code_executed: true,
        },
        status: "imported",
        baseline_status: "not_run",
      })
      .select("id")
      .single();

    if (importError || !importRecord) {
      console.error("importAppAction record failed:", importError?.message);
      await session.supabase.from("app_projects").delete().eq("id", projectId).eq("user_id", session.user.id);
      projectId = null;
      return fail("The import map could not be saved. Nothing was kept.");
    }

    if (connection && token) {
      const copied = await copyConnection(session, connection, token, projectId);
      await session.supabase
        .from("app_imports")
        .update({
          metadata: {
            source_root: selection.root,
            package_name: selection.packageName,
            connection_copied: copied,
            no_code_executed: true,
          },
        })
        .eq("id", importRecord.id)
        .eq("user_id", session.user.id);
    }

    refresh(projectId);
    redirect(`/build/${projectId}/import`);
  } catch (error) {
    if (projectId) {
      await session.supabase.from("app_projects").delete().eq("id", projectId).eq("user_id", session.user.id);
    }
    if (error instanceof AppImportError) return fail(error.message);
    console.error("importAppAction failed:", error instanceof Error ? error.message : "unknown import error");
    return fail("The import stopped before it could finish. Nothing was kept.");
  }
}

export async function saveImportMapAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const project = await ownerProject(session, projectId);
  if (!project) return fail(NOT_AVAILABLE);
  const importRecord = await importFor(session, projectId);
  if (!importRecord) return fail("That project doesn't have an import map.");

  const raw = formData.get("map_json");
  if (typeof raw !== "string") return fail("The application map is missing.");
  let map;
  try {
    map = parseAppMapJson(raw);
  } catch (error) {
    return fail(error instanceof AppImportError ? error.message : "The application map is not valid.");
  }
  map.generated_at = new Date().toISOString();

  const { error } = await session.supabase
    .from("app_imports")
    .update({ map, status: "map_edited" })
    .eq("id", importRecord.id)
    .eq("user_id", session.user.id);
  if (error) {
    console.error("saveImportMapAction failed:", error.message);
    return fail("The map could not be saved. The previous map is unchanged.");
  }

  refresh(projectId);
  return done("Application map saved. Facts and inferences remain labelled.");
}

export async function runImportBaselineAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const project = await ownerProject(session, projectId);
  if (!project) return fail(NOT_AVAILABLE);
  const importRecord = await importFor(session, projectId);
  if (!importRecord) return fail("That project doesn't have an import map.");

  const files = await projectFiles(session, projectId);
  if (files.length === 0) return fail("The imported project has no files to check.");
  const config = getPreviewConfig();
  if (!config) {
    await recordBaseline(session, {
      importRecord,
      status: "blocked",
      summary: "The preview runner is not configured.",
      checks: [],
      failures: [],
      log: RUNNER_MISSING,
      durationMs: 0,
    });
    refresh(projectId);
    return fail(RUNNER_MISSING);
  }

  let key: string | null = null;
  const startedAt = Date.now();
  try {
    const workspace = await createRunnerWorkspace(config, {
      projectId,
      userId: session.user.id,
      files,
    });
    key = workspace.key;
    const checks = await runRunnerChecks(config, key);
    const failures = checks.checks
      .filter((check) => check.status === "failed" || check.status === "timed_out")
      .map((check) => check.label);
    const summary = checkSummary(checks.checks).slice(0, 500);
    const status = checks.status === "passed" ? "passed" : "failed";

    await recordBaseline(session, {
      importRecord,
      status,
      summary,
      checks: checks.checks,
      failures,
      log: checks.log,
      durationMs: checks.durationMs || Date.now() - startedAt,
    });
    refresh(projectId);

    if (status === "failed") {
      return fail(
        `Baseline recorded with pre-existing failures: ${failures.join(", ") || "unnamed checks"}. These failures belong to the imported app, not a later change.`,
      );
    }
    return done(`Baseline recorded: ${summary}. No project code was installed or run outside the sandbox.`);
  } catch (error) {
    const message =
      error instanceof PreviewError
        ? error.message
        : "The existing sandbox could not run the baseline checks.";
    await recordBaseline(session, {
      importRecord,
      status: "blocked",
      summary: message.slice(0, 500),
      checks: [],
      failures: [],
      log: message,
      durationMs: Date.now() - startedAt,
    });
    refresh(projectId);
    return fail(`Baseline recorded as blocked: ${message}`);
  } finally {
    if (key) {
      try {
        await stopRunnerWorkspace(config, key);
      } catch {
        /* best effort: the runner expires idle workspaces itself */
      }
    }
  }
}

export async function proposeModernizationAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const project = await ownerProject(session, projectId);
  if (!project) return fail(NOT_AVAILABLE);
  const importRecord = await importFor(session, projectId);
  if (!importRecord) return fail("That project doesn't have an import map.");

  const objective = readText(formData, "objective");
  if (!isImportObjective(objective)) return fail("Choose one supported modernization objective.");
  const request = readText(formData, "request");
  if (request.length < 5) return fail("Describe the bounded objective in at least 5 characters.");

  const { data: baselineRow } = await session.supabase
    .from("app_import_baselines")
    .select("*")
    .eq("import_id", importRecord.id)
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const baseline = baselineRow as AppImportBaselineRecord | null;
  if (!baseline) return fail("Run and record a baseline before proposing a change.");

  const snapshot: BaselineSnapshot = {
    status: baseline.status,
    summary: baseline.summary,
    failures: baseline.failures ?? [],
    at: baseline.created_at,
  };
  const files = await projectFiles(session, projectId);
  if (files.length === 0) return fail("The imported project has no files to change.");

  try {
    const proposal = buildModernizationProposal({
      files,
      objective: objective as ImportObjective,
      request,
      baseline: snapshot,
      baseVersion: Number(project.current_version ?? 1),
    });
    const { error } = await session.supabase.from("app_modernizations").insert({
      import_id: importRecord.id,
      project_id: projectId,
      user_id: session.user.id,
      objective,
      request,
      status: "proposed",
      proposal,
    });
    if (error) {
      console.error("proposeModernizationAction insert failed:", error.message);
      return fail("The modernization proposal could not be saved. Nothing changed.");
    }
    refresh(projectId);
    return done(
      "Bounded modernization proposal saved. Review its files, compatibility concerns, checks and reversal plan before approving it.",
    );
  } catch (error) {
    if (error instanceof AppImportError) return fail(error.message);
    return fail("The modernization proposal could not be produced. Nothing changed.");
  }
}

export async function approveModernizationAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const project = await ownerProject(session, projectId);
  if (!project) return fail(NOT_AVAILABLE);
  const importRecord = await importFor(session, projectId);
  if (!importRecord) return fail("That project doesn't have an import map.");

  const modernizationId = readText(formData, "modernization_id");
  if (!isUuid(modernizationId)) return fail("That modernization proposal isn't available.");
  const { data: modernizationRow } = await session.supabase
    .from("app_modernizations")
    .select("*")
    .eq("id", modernizationId)
    .eq("import_id", importRecord.id)
    .eq("user_id", session.user.id)
    .maybeSingle();
  const modernization = modernizationRow as AppModernizationRecord | null;
  if (!modernization) return fail("That modernization proposal isn't available.");
  if (modernization.status !== "proposed") return fail("That proposal has already been handled.");

  const files = await projectFiles(session, projectId);
  if (files.length === 0) return fail("The imported project has no files to change.");
  const proposal = modernization.proposal;
  const currentDigest = inspectProject(files).digest;
  if (currentDigest !== proposal.base_digest) {
    return fail("The project changed after this proposal was made. Create a new proposal from the current baseline.");
  }
  if (!CHANGE_KINDS.includes(proposal.kind as ChangeKind)) {
    return fail("The proposal uses an unsupported change category.");
  }

  const inspection = inspectProject(files);
  const { data: change, error } = await session.supabase
    .from("app_change_requests")
    .insert({
      project_id: projectId,
      user_id: session.user.id,
      kind: proposal.kind,
      request: `${proposal.objective_label}: ${proposal.request}`.slice(0, 2_000),
      answers:
        "Created from a Phase 31 imported-app proposal. Compare against the recorded baseline; pre-existing failures are not caused by this change.",
      status: "proposed",
      automation_level: 2,
      base_version: Math.max(1, Number(project.current_version ?? 1)),
      base_digest: inspection.digest,
      inspection,
      questions: [],
      plan: proposal.plan,
      base_files: files,
      patch_files: [],
    })
    .select("id")
    .single();

  if (error || !change) {
    console.error("approveModernizationAction change failed:", error?.message);
    return fail("The change review could not be created. Nothing changed.");
  }

  const { error: updateError } = await session.supabase
    .from("app_modernizations")
    .update({ status: "change_created", change_id: change.id })
    .eq("id", modernization.id)
    .eq("user_id", session.user.id)
    .eq("status", "proposed");
  if (updateError) {
    console.error("approveModernizationAction update failed:", updateError.message);
    return fail("The change was created, but the proposal state could not be updated. Refresh the page.");
  }

  refresh(projectId);
  return done(
    "Proposal approved and handed to the existing change review. Open Improve to approve the plan, prepare the bounded patch, run checks and preview it. Nothing is deployed.",
  );
}
