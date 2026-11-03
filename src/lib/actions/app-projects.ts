"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { BuildState } from "@/lib/action-state";
import {
  AppBuildError,
  buildProjectFiles,
  buildSpecDraft,
  composeSpec,
  intakeProblems,
  intakeSchema,
  isSafeProjectPath,
  specInputSchema,
  summarizeChanges,
  type AppSpec,
} from "@/lib/app-builder";
import { getSession } from "@/lib/auth";
import { firstErrorMessage, isUuid, readText } from "@/lib/validation";

/**
 * Phase 21 actions.
 *
 * Every write is owner-scoped by RLS and an explicit user_id filter. Generation
 * validates the whole file set before writing, and a version snapshot is kept
 * by the database function, so a failed generation cannot destroy the last
 * usable project. Nothing here executes code, deploys, installs anything or
 * invents a credential.
 */

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That app project isn't available to you.";

function fail(message: string): BuildState {
  return { status: "error", message, nonce: Date.now() };
}

function done(message: string): BuildState {
  return { status: "success", message, nonce: Date.now() };
}

function refresh(projectId?: string): void {
  revalidatePath("/build");
  if (projectId) revalidatePath(`/build/${projectId}`);
}

async function ownerProject(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  projectId: string,
) {
  if (!isUuid(projectId)) return null;
  const { data } = await session.supabase
    .from("app_projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  return data;
}

export async function createAppProjectAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = intakeSchema.safeParse({
    name: readText(formData, "name"),
    purpose: readText(formData, "purpose"),
    target_users: readText(formData, "target_users"),
    workflows: readText(formData, "workflows"),
    required_pages: readText(formData, "required_pages"),
    entities: readText(formData, "entities"),
    auth_requirements: readText(formData, "auth_requirements"),
    integrations: readText(formData, "integrations"),
    design_preferences: readText(formData, "design_preferences"),
    definition_of_done: readText(formData, "definition_of_done"),
  });

  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const problems = intakeProblems(parsed.data);
  if (problems.length > 0) return fail(problems.join(" "));

  const spec = buildSpecDraft(parsed.data);

  // Validate the whole generated set before the intake is stored, so an
  // oversized or unsafe request is refused without leaving a half project.
  try {
    buildProjectFiles(spec, { name: parsed.data.name, purpose: parsed.data.purpose });
  } catch (error) {
    if (error instanceof AppBuildError) return fail(error.message);
    throw error;
  }

  const { data: project, error } = await session.supabase
    .from("app_projects")
    .insert({
      user_id: session.user.id,
      name: parsed.data.name,
      purpose: parsed.data.purpose,
      target_users: parsed.data.target_users,
      workflows: parsed.data.workflows,
      required_pages: parsed.data.required_pages,
      entities: parsed.data.entities,
      auth_requirements: parsed.data.auth_requirements,
      integrations: parsed.data.integrations,
      design_preferences: parsed.data.design_preferences,
      definition_of_done: parsed.data.definition_of_done,
      status: "spec_draft",
    })
    .select("id")
    .single();

  if (error || !project) {
    console.error("createAppProjectAction project failed:", error?.message);
    return fail("We couldn't save that app project. Nothing was created.");
  }

  const projectId = project.id as string;

  const { error: specError } = await session.supabase.from("app_specs").insert({
    project_id: projectId,
    user_id: session.user.id,
    version: 1,
    spec,
  });

  if (specError) {
    // Remove the project so a spec failure does not leave an empty workspace.
    await session.supabase
      .from("app_projects")
      .delete()
      .eq("id", projectId)
      .eq("user_id", session.user.id);
    console.error("createAppProjectAction spec failed:", specError.message);
    return fail("We couldn't save the first specification. Nothing was created.");
  }

  refresh(projectId);
  redirect(`/build/${projectId}`);
}

export async function saveSpecAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const project = await ownerProject(session, projectId);
  if (!project) return fail(NOT_AVAILABLE);

  const parsed = specInputSchema.safeParse({
    features: readText(formData, "features"),
    exclusions: readText(formData, "exclusions"),
    pages: readText(formData, "pages"),
    entities: readText(formData, "entities"),
    integrations: readText(formData, "integrations"),
    acceptance_checks: readText(formData, "acceptance_checks"),
    auth_requirements: readText(formData, "auth_requirements"),
  });

  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const { data: latest, error: latestError } = await session.supabase
    .from("app_specs")
    .select("id, version, approved_at, spec")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) {
    console.error("saveSpecAction latest failed:", latestError.message);
    return fail("We couldn't load the specification. Nothing changed.");
  }

  const previousSpec = (latest?.spec ?? null) as AppSpec | null;
  const composed = composeSpec(
    parsed.data,
    project.design_preferences as string,
    project.definition_of_done as string,
  );
  const spec: AppSpec = {
    ...composed,
    purpose: previousSpec?.purpose ?? (project.purpose as string),
    stack: "nextjs-typescript-tailwind",
  };

  if (spec.entities.length === 0 && spec.pages.length <= 1) {
    return fail("Add at least one page or one data entity before saving.");
  }

  // The spec is accepted only if a coherent file set can be generated from it.
  try {
    buildProjectFiles(spec, {
      name: project.name as string,
      purpose: project.purpose as string,
    });
  } catch (error) {
    if (error instanceof AppBuildError) return fail(error.message);
    throw error;
  }

  const version = Number(latest?.version ?? 0) + 1;

  const { error } = await session.supabase.from("app_specs").insert({
    project_id: projectId,
    user_id: session.user.id,
    version,
    spec,
  });

  if (error) {
    console.error("saveSpecAction insert failed:", error.message);
    return fail("We couldn't save that specification. Nothing changed.");
  }

  await session.supabase
    .from("app_projects")
    .update({ status: "spec_draft" })
    .eq("id", projectId)
    .eq("user_id", session.user.id);

  refresh(projectId);
  return done(
    `Specification version ${version} saved as a draft. The initial project is still blocked until you approve it.`,
  );
}

/** Copies the newest approved spec into a fresh, editable draft version. */
export async function reviseSpecAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const project = await ownerProject(session, projectId);
  if (!project) return fail(NOT_AVAILABLE);

  const { data: latest, error } = await session.supabase
    .from("app_specs")
    .select("id, version, spec, approved_at")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("reviseSpecAction failed:", error.message);
    return fail("We couldn't check the specification. Nothing changed.");
  }
  if (!latest) return fail("There is no specification to revise.");

  const version = Number(latest.version) + 1;
  const { error: insertError } = await session.supabase.from("app_specs").insert({
    project_id: projectId,
    user_id: session.user.id,
    version,
    spec: latest.spec,
  });

  if (insertError) {
    console.error("reviseSpecAction insert failed:", insertError.message);
    return fail("We couldn't start a revision. Nothing changed.");
  }

  await session.supabase
    .from("app_projects")
    .update({ status: "spec_draft" })
    .eq("id", projectId)
    .eq("user_id", session.user.id);

  refresh(projectId);
  return done(
    `Draft version ${version} opened from the last approved specification. Approve it to allow generation.`,
  );
}

export async function approveSpecAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const project = await ownerProject(session, projectId);
  if (!project) return fail(NOT_AVAILABLE);

  const { data: latest, error } = await session.supabase
    .from("app_specs")
    .select("id, version, spec, approved_at")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !latest) {
    console.error("approveSpecAction load failed:", error?.message);
    return fail("We couldn't load that specification. Nothing changed.");
  }
  if (latest.approved_at) return fail("That specification is already approved.");

  try {
    buildProjectFiles(latest.spec as AppSpec, {
      name: project.name as string,
      purpose: project.purpose as string,
    });
  } catch (buildError) {
    if (buildError instanceof AppBuildError) return fail(buildError.message);
    throw buildError;
  }

  const { error: approveError } = await session.supabase
    .from("app_specs")
    .update({ approved_at: new Date().toISOString() })
    .eq("id", latest.id)
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .is("approved_at", null);

  if (approveError) {
    console.error("approveSpecAction failed:", approveError.message);
    return fail("We couldn't approve that specification. Nothing changed.");
  }

  await session.supabase
    .from("app_projects")
    .update({ status: "spec_approved" })
    .eq("id", projectId)
    .eq("user_id", session.user.id);

  refresh(projectId);
  return done(
    `Specification version ${latest.version} approved. You can now generate the initial project files.`,
  );
}

export async function generateAppAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const project = await ownerProject(session, projectId);
  if (!project) return fail(NOT_AVAILABLE);

  const { data: approved, error: specError } = await session.supabase
    .from("app_specs")
    .select("id, version, spec")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .not("approved_at", "is", null)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (specError) {
    console.error("generateAppAction spec failed:", specError.message);
    return fail("We couldn't load the approved specification. Nothing changed.");
  }
  if (!approved) return fail("Approve a specification before generating project files.");

  const { data: currentFiles } = await session.supabase
    .from("app_files")
    .select("path, content")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id);

  let files;
  try {
    files = buildProjectFiles(approved.spec as AppSpec, {
      name: project.name as string,
      purpose: project.purpose as string,
    });
  } catch (error) {
    const message = error instanceof AppBuildError ? error.message : "Generation stopped before writing anything.";
    await session.supabase
      .from("app_projects")
      .update({ last_generation_status: "failed", last_generation_note: message })
      .eq("id", projectId)
      .eq("user_id", session.user.id);
    refresh(projectId);
    return fail(`${message} Your last usable snapshot was not changed.`);
  }

  const summary = summarizeChanges(
    (currentFiles ?? []) as { path: string; content: string }[],
    files,
  );

  const { data: version, error } = await session.supabase.rpc("replace_app_files", {
    p_project_id: projectId,
    p_files: files,
    p_summary: `${summary.summary} Stack: ${SUPPORTED_STACK_LABEL}.`,
    p_note: `Generated from specification version ${approved.version}.`,
  });

  if (error) {
    console.error("generateAppAction replace failed:", error.message);
    await session.supabase
      .from("app_projects")
      .update({
        last_generation_status: "failed",
        last_generation_note: "The file set was refused; the last usable snapshot was kept.",
      })
      .eq("id", projectId)
      .eq("user_id", session.user.id);
    refresh(projectId);
    return fail(
      "The project files couldn't be written, so nothing was replaced. The last usable snapshot is unchanged.",
    );
  }

  refresh(projectId);
  return done(
    `Generated version ${version}: ${summary.summary} Nothing was executed or deployed, and this is not production ready.`,
  );
}

const SUPPORTED_STACK_LABEL = "Next.js + TypeScript + Tailwind";

export async function saveAppFileAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const project = await ownerProject(session, projectId);
  if (!project) return fail(NOT_AVAILABLE);

  const path = readText(formData, "path");
  // Code keeps its exact leading and trailing whitespace.
  const raw = formData.get("content");
  const content = typeof raw === "string" ? raw : "";

  if (!isSafeProjectPath(path)) {
    return fail("That file path is not allowed. Paths must be relative and cannot contain '..'.");
  }

  const { data: existing } = await session.supabase
    .from("app_files")
    .select("id")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .eq("path", path)
    .maybeSingle();

  if (!existing) {
    return fail("That file isn't part of this project. Regenerate the project to add files.");
  }

  if (content.length > 60_000) {
    return fail("That file is larger than the 60000 character limit. Nothing was saved.");
  }

  const { data: version, error } = await session.supabase.rpc("save_app_file", {
    p_project_id: projectId,
    p_path: path,
    p_content: content,
  });

  if (error) {
    console.error("saveAppFileAction failed:", error.message);
    return fail("We couldn't save that file. The previous version is unchanged.");
  }

  refresh(projectId);
  return done(
    `Saved ${path} as version ${version}. The earlier snapshot is still available to restore.`,
  );
}

export async function restoreAppVersionAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  const project = await ownerProject(session, projectId);
  if (!project) return fail(NOT_AVAILABLE);

  const version = Number(readText(formData, "version"));
  if (!Number.isInteger(version) || version < 1) return fail("Choose a version to restore.");

  const { data: restored, error } = await session.supabase.rpc("restore_app_version", {
    p_project_id: projectId,
    p_version: version,
  });

  if (error) {
    console.error("restoreAppVersionAction failed:", error.message);
    return fail("We couldn't restore that version. Your current files are unchanged.");
  }

  refresh(projectId);
  return done(`Version ${version} restored as version ${restored}. The restore is itself reversible.`);
}

export async function deleteAppProjectAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const projectId = readText(formData, "project_id");
  if (!isUuid(projectId)) return fail(NOT_AVAILABLE);

  const { error } = await session.supabase
    .from("app_projects")
    .delete()
    .eq("id", projectId)
    .eq("user_id", session.user.id);

  if (error) {
    console.error("deleteAppProjectAction failed:", error.message);
    return fail("We couldn't delete that project. Nothing changed.");
  }

  revalidatePath("/build");
  redirect("/build");
}
