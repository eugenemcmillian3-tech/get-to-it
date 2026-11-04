"use server";

import { revalidatePath } from "next/cache";
import type { BuildState } from "@/lib/action-state";
import { getSession } from "@/lib/auth";
import {
  DESIGN_LIMITS,
  buildDesignFiles,
  designConfigProblems,
  diffFiles,
  isHexColor,
  normaliseDesignConfig,
  parseSections,
  type DesignConfig,
  type DesignFont,
  type DesignSpacing,
  type DesignVariant,
} from "@/lib/design";
import { DesignAssetError, validateAssetBytes, type DesignAssetKind } from "@/lib/design-assets";
import { getDesignWorkspace } from "@/lib/data/app-design";
import { summarizeChanges, type AppSpec, type GeneratedFile } from "@/lib/app-builder";
import { isUuid, readText } from "@/lib/validation";

/**
 * Phase 27 actions.
 *
 * Design config is stored separately from the app specification. Applying a
 * design writes only the design-owned files and the marked token block through
 * the existing app_files snapshot function. Existing API routes, auth code and
 * data access are not rewritten.
 */

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That app project isn't available to you.";

function fail(message: string): BuildState {
  return { status: "error", message: message.slice(0, 1_000), nonce: Date.now() };
}

function done(message: string): BuildState {
  return { status: "success", message: message.slice(0, 1_000), nonce: Date.now() };
}

function refresh(projectId: string): void {
  revalidatePath("/build");
  revalidatePath(`/build/${projectId}`);
  revalidatePath(`/build/${projectId}/design`);
}

async function ownerProject(session: NonNullable<Awaited<ReturnType<typeof getSession>>>, projectId: string) {
  if (!isUuid(projectId)) return null;
  const { data } = await session.supabase
    .from("app_projects")
    .select("id, name")
    .eq("id", projectId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  return data;
}

async function latestSpec(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  projectId: string,
): Promise<AppSpec | null> {
  const { data } = await session.supabase
    .from("app_specs")
    .select("spec, approved_at")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .not("approved_at", "is", null)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.spec ?? null) as AppSpec | null;
}

function configFromForm(formData: FormData): DesignConfig {
  const colorKeys = ["background", "surface", "text", "muted", "primary", "accent", "danger", "success"] as const;
  const rawColors: Record<string, string> = {};
  for (const key of colorKeys) rawColors[key] = readText(formData, `color_${key}`).trim();

  const raw = {
    brief: readText(formData, "brief"),
    colors: rawColors,
    typography: {
      sans: readText(formData, "font_sans") || "system",
      display: readText(formData, "font_display") || "system",
      base_size: Number(readText(formData, "base_size")),
      line_height: Number(readText(formData, "line_height")),
    },
    spacing: readText(formData, "spacing") || "comfortable",
    variant: readText(formData, "variant") || "soft",
    sections: parseSections(readText(formData, "sections")),
    text: {
      headline: readText(formData, "headline"),
      subhead: readText(formData, "subhead"),
      primary_action: readText(formData, "primary_action"),
      loading: readText(formData, "loading"),
      empty: readText(formData, "empty"),
      error: readText(formData, "error"),
      success: readText(formData, "success"),
    },
  };
  return normaliseDesignConfig(raw);
}

export async function saveDesignConfigAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);

  const colorKeys = ["background", "surface", "text", "muted", "primary", "accent", "danger", "success"] as const;
  for (const key of colorKeys) {
    const value = readText(formData, `color_${key}`).trim();
    if (!isHexColor(value)) return fail(`Choose a six-digit hex color for ${key}.`);
  }
  const baseSize = Number(readText(formData, "base_size"));
  const lineHeight = Number(readText(formData, "line_height"));
  if (!Number.isFinite(baseSize) || baseSize < 14 || baseSize > 20) return fail("Base font size must be between 14 and 20px.");
  if (!Number.isFinite(lineHeight) || lineHeight < 1.3 || lineHeight > 1.8) return fail("Line height must be between 1.3 and 1.8.");

  const sections = parseSections(readText(formData, "sections"));
  if (sections.length === 0) return fail("Choose at least one preview section.");

  const config = configFromForm(formData);
  config.sections = sections;
  config.typography.sans = readText(formData, "font_sans") as DesignFont;
  config.typography.display = readText(formData, "font_display") as DesignFont;
  config.spacing = readText(formData, "spacing") as DesignSpacing;
  config.variant = readText(formData, "variant") as DesignVariant;
  if (!["system", "serif", "mono"].includes(config.typography.sans)) return fail("Choose a supported body font.");
  if (!["system", "serif", "mono"].includes(config.typography.display)) return fail("Choose a supported display font.");
  if (!["compact", "comfortable", "spacious"].includes(config.spacing)) return fail("Choose a supported spacing scale.");
  if (!["soft", "sharp"].includes(config.variant)) return fail("Choose a supported component variant.");

  const problems = designConfigProblems(config);
  if (problems.length > 0) return fail(problems.join(" "));

  const { error } = await session.supabase.from("app_design_profiles").upsert(
    {
      project_id: projectId,
      user_id: session.user.id,
      brief: config.brief,
      config,
    },
    { onConflict: "project_id" },
  );
  if (error) {
    console.error("saveDesignConfigAction failed:", error.message);
    return fail("The design configuration could not be saved. Nothing changed.");
  }

  refresh(projectId);
  return done("Design brief and tokens saved. Review the preview and code diff before applying.");
}

export async function uploadDesignAssetAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);

  const existing = await session.supabase
    .from("app_design_assets")
    .select("id")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id);
  if (existing.error) return fail("The existing assets could not be checked.");
  if ((existing.data ?? []).length >= 12) return fail("Keep at most 12 design references per project.");

  const upload = formData.get("asset");
  if (!(upload instanceof File)) {
    return fail("Choose a PNG, JPEG or WebP file.");
  }
  if (upload.size > DESIGN_LIMITS.maxAssetBytes) {
    return fail(`Assets are limited to ${DESIGN_LIMITS.maxAssetBytes.toLocaleString()} bytes.`);
  }

  const kind = readText(formData, "kind") as DesignAssetKind;
  if (!["screenshot", "wireframe", "asset"].includes(kind)) return fail("Choose a supported reference kind.");

  try {
    const bytes = new Uint8Array(await upload.arrayBuffer());
    const asset = validateAssetBytes({
      name: upload.name,
      declaredType: upload.type,
      bytes,
      attribution: readText(formData, "attribution"),
      licenseNote: readText(formData, "license_note"),
      permissionConfirmed: formData.get("permission") === "on",
    });
    const { error } = await session.supabase.from("app_design_assets").insert({
      project_id: projectId,
      user_id: session.user.id,
      kind,
      ...asset,
      permission_confirmed: true,
    });
    if (error) throw new DesignAssetError("The reference could not be saved.");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The reference was refused. Nothing was saved.");
  }

  refresh(projectId);
  return done("Reference saved. Only permitted raster files are accepted; SVG and HTML are refused.");
}

export async function deleteDesignAssetAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  const assetId = readText(formData, "asset_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);
  if (!isUuid(assetId)) return fail("That reference is not available.");

  const { error } = await session.supabase
    .from("app_design_assets")
    .delete()
    .eq("id", assetId)
    .eq("project_id", projectId)
    .eq("user_id", session.user.id);
  if (error) return fail("The reference could not be removed.");
  refresh(projectId);
  return done("Reference removed.");
}

export async function applyDesignAction(
  _previous: BuildState,
  formData: FormData,
): Promise<BuildState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);
  const projectId = readText(formData, "project_id");
  if (!(await ownerProject(session, projectId))) return fail(NOT_AVAILABLE);

  const spec = await latestSpec(session, projectId);
  if (!spec) return fail("Approve the app specification before applying a design.");

  const workspace = await getDesignWorkspace(session, projectId);
  if (!workspace.profile) return fail("Save the design brief and tokens before applying.");

  const { data: current, error: currentError } = await session.supabase
    .from("app_files")
    .select("path, content")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id);
  if (currentError || !current || current.length === 0) {
    return fail("Generate the app files before applying a design.");
  }

  const currentFiles = current as GeneratedFile[];
  const globals = currentFiles.find((file) => file.path === "app/globals.css");
  if (!globals) return fail("The generated app has no app/globals.css to add tokens to.");

  const assets = workspace.assets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    mime: asset.mime,
    bytes: asset.bytes,
    attribution: asset.attribution,
    license_note: asset.license_note,
  }));
  const designFiles = buildDesignFiles(
    spec,
    normaliseDesignConfig(workspace.profile.config),
    assets,
    globals.content,
  );
  const next = new Map(currentFiles.map((file) => [file.path, file.content]));
  for (const file of designFiles) next.set(file.path, file.content);
  if (next.size > 60) return fail("The project already has the maximum number of files.");

  const files = [...next.entries()]
    .map(([path, content]) => ({ path, content }))
    .sort((a, b) => a.path.localeCompare(b.path));
  for (const file of files) {
    if (file.content.length > 60_000) return fail("A generated design file is too large to save.");
  }

  const diff = diffFiles(currentFiles, files);
  const summary = summarizeChanges(currentFiles, files);
  const { data: fileVersion, error: writeError } = await session.supabase.rpc("replace_app_files", {
    p_project_id: projectId,
    p_files: files,
    p_summary: `Design Workspace: ${summary.summary}`.slice(0, 500),
    p_note: "Design tokens, reusable components, manifest and preview only. Existing backend files are preserved.",
  });
  if (writeError || typeof fileVersion !== "number") {
    return fail("The design files could not be saved. The previous snapshot is unchanged.");
  }

  const latest = await session.supabase
    .from("app_design_versions")
    .select("version")
    .eq("project_id", projectId)
    .eq("user_id", session.user.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const designVersion = Number(latest.data?.version ?? 0) + 1;
  const { error: versionError } = await session.supabase.from("app_design_versions").insert({
    project_id: projectId,
    user_id: session.user.id,
    version: designVersion,
    config: workspace.profile.config,
    summary: summary.summary.slice(0, 500),
    diff,
  });

  refresh(projectId);
  if (versionError) {
    return done(`Applied design as app version ${fileVersion}. The design history entry could not be saved.`);
  }
  return done(`Applied design ${designVersion} as app version ${fileVersion}. The code diff is shown before and after applying.`);
}

