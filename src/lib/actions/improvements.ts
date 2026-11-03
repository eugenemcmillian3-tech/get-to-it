"use server";

import { revalidatePath } from "next/cache";
import type { BuildState } from "@/lib/action-state";
import { getSession } from "@/lib/auth";
import { sourceDigest, type DeploymentFile } from "@/lib/deployments";
import { getPreviewConfig, runRunnerChecks, startRunnerPreview, stopRunnerWorkspace, createRunnerWorkspace, previewUrl, checkSummary } from "@/lib/preview-workspace";
import {
  CHANGE_LIMITS,
  MEMORY_KINDS,
  buildChangePlan,
  clarifyChange,
  containsSecret,
  errorFingerprint,
  implementFixture,
  inspectProject,
  redactError,
  skillFromPlan,
  type ChangeKind,
  type MemoryKind,
} from "@/lib/improvements";
import { isUuid, readText } from "@/lib/validation";

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That app project isn't available to you.";

function fail(message: string): BuildState {
  return { status: "error", message, nonce: Date.now() };
}
function done(message: string, link?: string): BuildState {
  return { status: "success", message, link, nonce: Date.now() };
}
function refresh(projectId: string): void {
  revalidatePath("/build");
  revalidatePath(`/build/${projectId}`);
  revalidatePath(`/build/${projectId}/improve`);
  revalidatePath(`/build/${projectId}/deploy`);
}

async function ownerProject(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  projectId: string,
) {
  if (!isUuid(projectId)) return null;
  const { data } = await session.supabase
    .from("app_projects")
    .select("id, name, current_version, updated_at")
    .eq("id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  return data;
}

async function filesFor(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  projectId: string,
): Promise<DeploymentFile[]> {
  const { data } = await session.supabase
    .from("app_files")
    .select("path, content")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .order("path", { ascending: true });
  return (data ?? []) as DeploymentFile[];
}

async function event(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  changeId: string,
  projectId: string,
  kind: string,
  detail: string,
): Promise<void> {
  await session.supabase.from("app_change_events").insert({
    change_id: changeId,
    project_id: projectId,
    user_id: session.user.id,
    kind: kind.slice(0, 80),
    detail: detail.slice(0, 1000),
  });
}

async function changeRow(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  projectId: string,
  changeId: string,
) {
  if (!isUuid(changeId)) return null;
  const { data } = await session.supabase
    .from("app_change_requests")
    .select("*")
    .eq("id", changeId)
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  return data;
}

function changeKind(value: string): ChangeKind | null {
  return ["dashboard", "bug", "mobile_navigation", "integration", "dependency", "other"].includes(value)
    ? (value as ChangeKind)
    : null;
}

async function insertChange(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  projectId: string,
  input: { kind: ChangeKind; request: string; answers: string; automation: number; files: DeploymentFile[]; version: number; questions?: string[] },
): Promise<{ id: string; status: "clarifying" | "proposed" } | { error: string }> {
  const inspection = inspectProject(input.files);
  const questions = input.questions ?? clarifyChange({ files: input.files, kind: input.kind, request: input.request });
  const plan = questions.length > 0 && input.answers.trim() === "" ? null : buildChangePlan({
    files: input.files,
    kind: input.kind,
    request: input.answers.trim() === "" ? input.request : `${input.request}\n\nClarification: ${input.answers}`,
  });
  const { data, error } = await session.supabase
    .from("app_change_requests")
    .insert({
      project_id: projectId,
      user_id: session.user.id,
      kind: input.kind,
      request: input.request.slice(0, CHANGE_LIMITS.maxRequestChars),
      answers: input.answers.slice(0, 2000),
      status: plan ? "proposed" : "clarifying",
      automation_level: Math.min(3, Math.max(1, input.automation)),
      base_version: Math.max(1, input.version),
      base_digest: inspection.digest,
      inspection,
      questions,
      plan: plan ?? {},
      base_files: input.files,
      patch_files: [],
    })
    .select("id, status")
    .single();
  if (error || !data) return { error: "The change request could not be saved." };
  return { id: data.id as string, status: data.status as "clarifying" | "proposed" };
}

export async function createChangeAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const project = await ownerProject(session, projectId);
  if (!project) return fail(NOT_AVAILABLE);
  const kind = changeKind(readText(formData, "kind"));
  if (!kind) return fail("Choose a change category.");
  const request = readText(formData, "request").trim();
  if (request.length < 5) return fail("Describe the change.");
  const files = await filesFor(session, projectId);
  if (files.length === 0) return fail("Generate the project before requesting a change.");

  const result = await insertChange(session, projectId, {
    kind,
    request,
    answers: readText(formData, "answers"),
    automation: Number(readText(formData, "automation_level") || "2"),
    files,
    version: Number(project.current_version ?? 1),
  });
  if ("error" in result) return fail(result.error);
  refresh(projectId);
  if (result.status === "clarifying") return done("The request needs a short clarification before a bounded plan can be proposed.");
  return done("A bounded plan was created. Inspect it, approve it, then prepare the isolated patch.");
}

export async function clarifyChangeAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const changeId = readText(formData, "change_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  const row = await changeRow(session, projectId, changeId);
  if (!row || row.status !== "clarifying") return fail("That request is not waiting for clarification.");
  const answers = readText(formData, "answers").trim();
  if (answers.length < 3) return fail("Answer the clarification questions first.");
  try {
    const plan = buildChangePlan({
      files: row.base_files as DeploymentFile[],
      kind: row.kind as ChangeKind,
      request: `${row.request}\n\nClarification: ${answers}`,
    });
    const { error } = await session.supabase
      .from("app_change_requests")
      .update({ answers: answers.slice(0, 2000), plan, status: "proposed", questions: [] })
      .eq("id", changeId)
      .eq("user_id", session.user.id);
    if (error) throw new Error("The clarified plan could not be saved.");
    refresh(projectId);
    return done("Clarification saved and a bounded plan proposed. Approve it when it is right.");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The plan could not be proposed.");
  }
}

export async function approveChangePlanAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const changeId = readText(formData, "change_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  const row = await changeRow(session, projectId, changeId);
  if (!row || row.status !== "proposed") return fail("Only a proposed plan can be approved.");
  if (!row.plan || Object.keys(row.plan).length === 0) return fail("This request has no plan yet.");
  const { error } = await session.supabase
    .from("app_change_requests")
    .update({ status: "approved" })
    .eq("id", changeId)
    .eq("user_id", session.user.id)
    .eq("status", "proposed");
  if (error) return fail("The plan could not be approved.");
  await event(session, changeId, projectId, "plan_approved", "Owner approved the bounded change plan.");
  refresh(projectId);
  return done(row.automation_level === 1 ? "Plan approved in suggest-only mode. No patch will be written." : "Plan approved. Prepare the isolated patch next.");
}

export async function implementChangeAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const changeId = readText(formData, "change_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  const row = await changeRow(session, projectId, changeId);
  if (!row || row.status !== "approved") return fail("Approve the plan before preparing a patch.");
  if (row.automation_level < 2) return fail("This plan is suggest-only. Change the automation level to prepare a patch.");
  const current = await filesFor(session, projectId);
  if (sourceDigest(current) !== row.base_digest) return fail("The project changed after the plan. Create a new plan so the base is exact.");
  try {
    const result = implementFixture(row.base_files as DeploymentFile[], row.plan);
    const patchFiles = result.files;
    if (patchFiles.some((file) => file.path.endsWith(".env") || file.path.includes(".env."))) {
      return fail("A change may not touch environment files.");
    }
    const { error } = await session.supabase
      .from("app_change_requests")
      .update({ status: "implemented", patch_files: patchFiles, diff: result.diff, error: null })
      .eq("id", changeId)
      .eq("user_id", session.user.id);
    if (error) throw new Error("The isolated patch could not be saved.");
    await event(session, changeId, projectId, "implemented", `Fixture patch changed ${result.changed.join(", ")}.`);
    refresh(projectId);
    return done(`Isolated patch prepared for ${result.changed.join(", ")}. Run tests next.`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The patch could not be prepared.");
  }
}

export async function testChangeAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const changeId = readText(formData, "change_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  const row = await changeRow(session, projectId, changeId);
  if (!row || !["implemented", "tested", "preview_ready"].includes(row.status)) {
    return fail("Prepare an isolated patch before running tests.");
  }
  if (!Array.isArray(row.patch_files) || row.patch_files.length === 0) return fail("There is no patch to test.");
  const config = getPreviewConfig();
  if (!config) return fail("The preview runner is not configured. Set the runner variables before testing a change.");

  let key: string | null = null;
  try {
    const created = await createRunnerWorkspace(config, {
      projectId,
      userId: session.user.id,
      files: row.patch_files as DeploymentFile[],
    });
    key = created.key;
    const checks = await runRunnerChecks(config, key);
    if (checks.status !== "passed") {
      await session.supabase
        .from("app_change_requests")
        .update({ status: "tested", checks: checks.checks, error: "Tests failed; the patch was not merged." })
        .eq("id", changeId)
        .eq("user_id", session.user.id);
      await event(session, changeId, projectId, "tests_failed", checkSummary(checks.checks));
      refresh(projectId);
      return fail(`Tests failed: ${checkSummary(checks.checks)}. The project is unchanged; inspect the evidence and reject or re-plan.`);
    }

    let link: string | undefined;
    try {
      const started = await startRunnerPreview(config, key);
      link = previewUrl(config, { key, projectId, userId: session.user.id });
      await session.supabase
        .from("app_change_requests")
        .update({ status: "preview_ready", checks: checks.checks, preview_url: link, runner_key: key, error: null })
        .eq("id", changeId)
        .eq("user_id", session.user.id);
      await event(session, changeId, projectId, "preview_started", `Preview started (${started.host}); checks passed.`);
    } catch {
      await session.supabase
        .from("app_change_requests")
        .update({ status: "tested", checks: checks.checks, error: "Tests passed, but the preview could not start." })
        .eq("id", changeId)
        .eq("user_id", session.user.id);
      await event(session, changeId, projectId, "preview_failed", "Tests passed; preview did not start.");
      refresh(projectId);
      return fail(`Tests passed: ${checkSummary(checks.checks)}. The preview could not start, so the change is not ready for review.`);
    }
    refresh(projectId);
    return done(`Tests passed and a preview is running: ${checkSummary(checks.checks)}.`, link);
  } catch (error) {
    if (key) await stopRunnerWorkspace(config, key).catch(() => undefined);
    return fail(error instanceof Error ? error.message : "The change could not be tested.");
  }
}

export async function reviewChangeAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const changeId = readText(formData, "change_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  const row = await changeRow(session, projectId, changeId);
  if (!row || row.status !== "preview_ready") return fail("A passing test and a running preview are required before diff review.");
  if (!Array.isArray(row.checks) || row.checks.length === 0 || row.checks.some((check: { status: string }) => !["passed", "skipped"].includes(check.status))) {
    return fail("The recorded checks did not pass. Nothing can be reviewed for merge.");
  }
  const { error } = await session.supabase
    .from("app_change_requests")
    .update({ status: "reviewed" })
    .eq("id", changeId)
    .eq("user_id", session.user.id);
  if (error) return fail("The diff review could not be saved.");
  await event(session, changeId, projectId, "diff_reviewed", "Owner reviewed the diff and approved a reversible merge.");
  refresh(projectId);
  return done("Diff approved. Merge creates a new source version; deployment remains a separate approval.");
}

export async function mergeChangeAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const changeId = readText(formData, "change_id");
  const project = await ownerProject(session, projectId);
  if (!project) return fail(NOT_AVAILABLE);
  const row = await changeRow(session, projectId, changeId);
  if (!row || row.status !== "reviewed") return fail("Approve the diff before merging.");
  if (!Array.isArray(row.patch_files) || row.patch_files.length === 0) return fail("There is no patch to merge.");
  const current = await filesFor(session, projectId);
  if (sourceDigest(current) !== row.base_digest) return fail("The project changed after this patch was made. The merge was refused; create a new change.");
  try {
    const { data: version, error } = await session.supabase.rpc("replace_app_files", {
      p_project_id: projectId,
      p_files: row.patch_files,
      p_summary: `Improvement: ${row.request}`.slice(0, 500),
      p_note: `Incremental change ${row.id.slice(0, 8)}. Deployment requires a separate approval.`.slice(0, 500),
    });
    if (error || typeof version !== "number") throw new Error("The source snapshot could not be written.");
    await session.supabase
      .from("app_change_requests")
      .update({ status: "merged", merged_version: version, error: null })
      .eq("id", changeId)
      .eq("user_id", session.user.id);
    await session.supabase.from("app_change_evaluations").upsert({
      change_id: changeId,
      project_id: projectId,
      user_id: session.user.id,
      accepted: true,
      rejected: false,
      tests_passed: true,
      regression_count: 0,
      runtime_seconds: Math.max(0, Math.round((Date.now() - Date.parse(row.created_at)) / 1000)),
      ai_calls: 0,
    });
    await event(session, changeId, projectId, "merged", `Merged into source version ${version}; no deployment was performed.`);
    if (row.runner_key) {
      const config = getPreviewConfig();
      if (config) await stopRunnerWorkspace(config, row.runner_key).catch(() => undefined);
    }
    refresh(projectId);
    return done(`Merged as source version ${version}. Restore that version to reverse it. Deploy from the Deploy page when you are ready.`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The change could not be merged.");
  }
}

export async function rejectChangeAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const changeId = readText(formData, "change_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  const row = await changeRow(session, projectId, changeId);
  if (!row || ["merged", "rejected"].includes(row.status)) return fail("That change cannot be rejected now.");
  if (row.runner_key) {
    const config = getPreviewConfig();
    if (config) await stopRunnerWorkspace(config, row.runner_key).catch(() => undefined);
  }
  const { error } = await session.supabase
    .from("app_change_requests")
    .update({ status: "rejected", runner_key: null, error: null })
    .eq("id", changeId)
    .eq("user_id", session.user.id);
  if (error) return fail("The change could not be rejected.");
  await session.supabase.from("app_change_evaluations").upsert({
    change_id: changeId,
    project_id: projectId,
    user_id: session.user.id,
    accepted: false,
    rejected: true,
    tests_passed: Array.isArray(row.checks) && row.checks.length > 0 && row.checks.every((check: { status: string }) => check.status === "passed"),
    regression_count: 0,
    runtime_seconds: 0,
    ai_calls: 0,
  });
  await event(session, changeId, projectId, "rejected", "Owner rejected the change; no project files were changed.");
  refresh(projectId);
  return done("Change rejected. No project files were changed.");
}

export async function saveMemoryAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  const kind = readText(formData, "kind") as MemoryKind;
  const title = readText(formData, "title").trim();
  const body = readText(formData, "body").trim();
  if (!MEMORY_KINDS.includes(kind)) return fail("Choose a memory category.");
  if (title.length < 1 || title.length > 120) return fail("Keep the title under 120 characters.");
  if (body.length < 1 || body.length > 4000) return fail("Keep the memory under 4,000 characters.");
  if (containsSecret(`${title}\n${body}`)) return fail("Project memory cannot contain credentials, tokens or database URLs. Remove the secret and try again.");
  const { error } = await session.supabase.from("app_project_memory").upsert(
    { project_id: projectId, user_id: session.user.id, kind, title, body, version: 1 },
    { onConflict: "project_id,kind,title" },
  );
  if (error) return fail("The memory record could not be saved.");
  refresh(projectId);
  return done("Project memory saved. It is editable and never treated as a permission grant.");
}

export async function deleteMemoryAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const id = readText(formData, "id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  if (!isUuid(id)) return fail("Unknown memory record.");
  const { error } = await session.supabase
    .from("app_project_memory")
    .delete()
    .eq("id", id)
    .eq("project_id", projectId)
    .eq("user_id", session.user.id);
  if (error) return fail("The memory record could not be deleted.");
  refresh(projectId);
  return done("Memory record deleted.");
}

export async function seedMemoryAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  const files = await filesFor(session, projectId);
  const inspection = inspectProject(files);
  const records = [
    { kind: "architecture", title: "Supported stack", body: "Next.js, TypeScript and Tailwind CSS. Incremental changes preserve the existing tree." },
    { kind: "convention", title: "Change boundaries", body: "Use a bounded isolated patch; never regenerate the whole application for a small request." },
    { kind: "test_command", title: "Project checks", body: inspection.test_commands.join("\n") || "npm run typecheck\nnpm run lint\nnpm run build" },
    { kind: "deployment_config", title: "Environment names", body: inspection.env_names.join("\n") || "No environment names found in the current code." },
    { kind: "limitation", title: "Fixture implementation", body: "Phase 25 uses deterministic bounded fixtures. Arbitrary bug fixes and dependency upgrades need a later reviewed worker." },
  ];
  const { error } = await session.supabase.from("app_project_memory").upsert(
    records.map((record) => ({ project_id: projectId, user_id: session.user.id, ...record, version: 1 })),
    { onConflict: "project_id,kind,title" },
  );
  if (error) return fail("The starter memory could not be saved.");
  refresh(projectId);
  return done("Starter project memory saved. Edit anything that is not true for this project.");
}

export async function createSkillAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const changeId = readText(formData, "change_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  const row = await changeRow(session, projectId, changeId);
  if (!row || row.status !== "merged") return fail("Only a merged, verified change can become a skill.");
  try {
    const draft = skillFromPlan(changeId, row.plan, {
      name: readText(formData, "name"),
      purpose: readText(formData, "purpose"),
      inputs: readText(formData, "inputs").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      outputs: readText(formData, "outputs").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      tests: row.plan.tests,
      limitations: readText(formData, "limitations").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    });
    if (draft.name.length < 2 || draft.purpose.length < 5) return fail("Give the skill a name and a short purpose.");
    const { data: existing } = await session.supabase
      .from("app_skills")
      .select("version")
      .eq("project_id", projectId)
      .eq("name", draft.name)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = Number(existing?.version ?? 0) + 1;
    const { error } = await session.supabase.from("app_skills").insert({
      project_id: projectId,
      user_id: session.user.id,
      ...draft,
      version,
    });
    if (error) throw new Error("The skill could not be saved.");
    refresh(projectId);
    return done(`Skill “${draft.name}” saved as version ${version}. Reusing it still requires a new plan, tests and approvals.`);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The skill could not be saved.");
  }
}

export async function enableObservabilityAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  const enabled = readText(formData, "enabled") === "on";
  const release = readText(formData, "release_label").trim();
  if (enabled && release.length < 1) return fail("Name the release that selected errors belong to.");
  const { error } = await session.supabase.from("app_observability_settings").upsert(
    { project_id: projectId, user_id: session.user.id, enabled, release_label: release.slice(0, 160) },
    { onConflict: "project_id" },
  );
  if (error) return fail("Observability settings could not be saved.");
  refresh(projectId);
  return done(enabled ? `Observability enabled for release ${release}. Only selected, redacted errors are stored.` : "Observability disabled. Existing selected errors remain until you delete them.");
}

export async function logErrorAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  const { data: settings } = await session.supabase
    .from("app_observability_settings")
    .select("enabled, release_label")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!settings?.enabled) return fail("Enable observability for this project first.");
  const message = readText(formData, "message").trim();
  const detail = readText(formData, "detail").trim();
  if (message.length < 3) return fail("Paste a selected error message.");
  if (message.length > 2000 || detail.length > 12000) return fail("Keep the selected error under the size limit.");
  const redacted = redactError(`${message}\n${detail}`);
  const { error } = await session.supabase.from("app_error_events").insert({
    project_id: projectId,
    user_id: session.user.id,
    release_label: String(settings.release_label),
    fingerprint: errorFingerprint(redacted.text),
    message: redacted.text.split("\n")[0].slice(0, 2000),
    detail: redacted.text.slice(0, 12000),
    redactions: redacted.redactions,
    status: "new",
  });
  if (error) return fail("The selected error could not be stored.");
  refresh(projectId);
  return done(`Selected error stored with ${redacted.redactions} redaction(s). No database dump or user record was sent anywhere.`);
}

export async function proposeRepairAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const errorId = readText(formData, "error_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  if (!isUuid(errorId)) return fail("Unknown error record.");
  const { data: error } = await session.supabase
    .from("app_error_events")
    .select("*")
    .eq("id", errorId)
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  if (!error) return fail("Unknown error record.");
  const files = await filesFor(session, projectId);
  const result = await insertChange(session, projectId, {
    kind: "bug",
    request: `Fix this reported error from release ${error.release_label}: ${error.message}`.slice(0, 2000),
    answers: "Use the selected error only; do not fetch a production database or user records.",
    automation: 2,
    files,
    version: Number((await ownerProject(session, projectId))?.current_version ?? 1),
  });
  if ("error" in result) return fail(result.error);
  await session.supabase.from("app_error_events").update({ status: "repair_proposed", change_id: result.id }).eq("id", errorId).eq("user_id", session.user.id);
  refresh(projectId);
  return done("A bounded repair plan was proposed from the redacted selected error. It still needs plan approval, tests, preview and a separate deployment approval.");
}
