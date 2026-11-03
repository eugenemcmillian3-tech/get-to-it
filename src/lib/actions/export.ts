"use server";

import { revalidatePath } from "next/cache";
import type { ImportState } from "@/lib/action-state";
import { getSession } from "@/lib/auth";
import { buildMyExport, getImportExistingState } from "@/lib/data/export";
import {
  EXPORT_DATASETS,
  MAX_EXPORT_BYTES,
  exportBundleJson,
  exportCsv,
  exportCsvFileName,
  exportFileName,
  type ExportDatasetId,
} from "@/lib/export";
import {
  IMPORT_CONFIRMATION,
  parseImportFile,
  importRows,
  importSummary,
  type ImportOptions,
} from "@/lib/import";
import { logOperational } from "@/lib/log";
import { readText } from "@/lib/validation";

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";

export type ExportPayload = {
  ok: boolean;
  message: string;
  filename?: string;
  mime?: string;
  content?: string;
};

function isDataset(value: string): value is ExportDatasetId {
  return EXPORT_DATASETS.some((dataset) => dataset.id === value);
}

/** The whole export as documented JSON, handed to the browser as a download. */
export async function exportJsonAction(): Promise<ExportPayload> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_EXPIRED };

  try {
    const bundle = await buildMyExport(session);
    const content = exportBundleJson(bundle);
    const bytes = new TextEncoder().encode(content).length;

    if (bytes > MAX_EXPORT_BYTES) {
      return {
        ok: false,
        message:
          "That export is larger than this build will generate in one file. Nothing was downloaded.",
      };
    }

    logOperational("export_json", {
      outcome: "ok",
      goals: bundle.counts.goals,
      tasks: bundle.counts.tasks,
    });

    return {
      ok: true,
      message: "Your JSON export is ready.",
      filename: exportFileName("json", bundle.exported_at),
      mime: "application/json",
      content,
    };
  } catch {
    logOperational("export_json", { outcome: "error" });
    return {
      ok: false,
      message: "We couldn't build your export. Nothing was downloaded — try again.",
    };
  }
}

/** One CSV dataset. Columns are stable for the current export version. */
export async function exportCsvAction(dataset: string): Promise<ExportPayload> {
  const session = await getSession();
  if (!session) return { ok: false, message: SESSION_EXPIRED };
  if (!isDataset(dataset)) {
    return { ok: false, message: "That export isn't one of the documented datasets." };
  }

  try {
    const bundle = await buildMyExport(session);
    const content = exportCsv(dataset, bundle);

    logOperational("export_csv", { outcome: "ok", dataset });

    return {
      ok: true,
      message: "Your CSV is ready.",
      filename: exportCsvFileName(dataset, bundle.exported_at),
      mime: "text/csv;charset=utf-8",
      content,
    };
  } catch {
    logOperational("export_csv", { outcome: "error", dataset });
    return {
      ok: false,
      message: "We couldn't build that CSV. Nothing was downloaded — try again.",
    };
  }
}

function readOptions(formData: FormData): ImportOptions {
  return {
    skipExistingGoalTitles: formData.get("skip_existing") !== null,
    replacePreferences: formData.get("replace_preferences") !== null,
  };
}

/**
 * Validates an uploaded export and returns a preview. Nothing is written here,
 * so a rejected file cannot leave a partial import behind.
 */
export async function previewImportAction(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const payload = readText(formData, "payload");
  const filename = readText(formData, "filename") || "export.json";

  if (payload === "") {
    return { status: "error", message: "Choose a GET TO IT JSON export first." };
  }

  try {
    const existing = await getImportExistingState(session);
    const parsed = parseImportFile(payload, existing, readOptions(formData));

    if (!parsed.ok) {
      logOperational("import_preview", { outcome: "rejected" });
      return { status: "error", message: parsed.errors.join(" ") };
    }

    const preview = {
      planHash: parsed.plan.hash,
      exportedAt: parsed.exportedAt,
      goals: parsed.plan.goals.map((goal) => ({
        title: goal.title,
        taskCount: goal.tasks.length,
        savedResults: goal.tasks.filter((task) => task.result !== null).length,
        alreadyExists: existing.goalTitles.includes(goal.title),
      })),
      counts: parsed.plan.counts,
      skipped: parsed.plan.skipped,
      rejected: parsed.plan.rejected,
      warnings: parsed.plan.warnings,
      replacePreferences: parsed.plan.replacePreferences,
    };

    logOperational("import_preview", {
      outcome: "ok",
      goals: preview.counts.goals,
      tasks: preview.counts.tasks,
      rejected: preview.rejected.length,
    });

    return {
      status: "preview",
      message: importSummary(parsed.plan),
      preview,
      planHash: parsed.plan.hash,
      filename,
      skippedCount: parsed.plan.skipped.length,
      rejectedCount: parsed.plan.rejected.length,
      nonce: Date.now(),
    };
  } catch {
    logOperational("import_preview", { outcome: "error" });
    return {
      status: "error",
      message: "We couldn't read that file. Nothing was imported — try again.",
    };
  }
}

function chunks<T>(rows: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    result.push(rows.slice(index, index + size));
  }
  return result;
}

/**
 * Applies a previewed import.
 *
 * The confirmation is tied to the exact plan hash from the preview, so editing
 * the file between preview and import is refused. Every row is created with a
 * new identifier under the signed-in account; identifiers in the file are never
 * used, and no existing goal, task or reflection is updated or deleted.
 */
export async function commitImportAction(
  _previous: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  if (readText(formData, "confirm").toUpperCase() !== IMPORT_CONFIRMATION) {
    return {
      status: "error",
      message: `Type ${IMPORT_CONFIRMATION} in the box to confirm. Nothing was imported.`,
    };
  }

  const payload = readText(formData, "payload");
  const planHash = readText(formData, "plan_hash");

  if (payload === "" || planHash === "") {
    return {
      status: "error",
      message: "Preview the file again before importing. Nothing was imported.",
    };
  }

  try {
    const existing = await getImportExistingState(session);
    const parsed = parseImportFile(payload, existing, readOptions(formData));

    if (!parsed.ok) {
      return { status: "error", message: parsed.errors.join(" ") };
    }

    if (parsed.plan.hash !== planHash) {
      return {
        status: "error",
        message:
          "The file or the options changed since the preview, so nothing was imported. Preview it again.",
      };
    }

    if (parsed.plan.counts.goals === 0 && parsed.plan.counts.reflections === 0 && !parsed.plan.preferences) {
      return { status: "error", message: "That file has nothing left to import." };
    }

    const rows = importRows(parsed.plan);
    const goalIds = rows.goals.map(() => crypto.randomUUID());

    if (rows.goals.length > 0) {
      for (const batch of chunks(rows.goals, 100)) {
        const { error } = await session.supabase.from("goals").insert(
          batch.map((goal) => ({
            id: goalIds[goal.index],
            user_id: session.user.id,
            ...goal.values,
          })),
        );
        if (error) throw new Error(`goals:${error.code ?? "unknown"}`);
      }
    }

    // `rows.tasks` is flattened in goal then task order, so an index here is the
    // same index a saved result refers to.
    const tasks = rows.tasks.map((task) => ({
      id: crypto.randomUUID(),
      goal_id: goalIds[task.goalIndex],
      user_id: session.user.id,
      ...task.values,
    }));

    if (tasks.length > 0) {
      for (const batch of chunks(tasks, 200)) {
        const { error } = await session.supabase.from("tasks").insert(batch);
        if (error) throw new Error(`tasks:${error.code ?? "unknown"}`);
      }
    }

    const savedResults = rows.results
      .map((result) => {
        const offset = parsed.plan.goals
          .slice(0, result.goalIndex)
          .reduce((total, row) => total + row.tasks.length, 0);
        const target = tasks[offset + result.taskIndex];
        if (!target) return null;
        return { task_id: target.id, user_id: session.user.id, content: result.content };
      })
      .filter((row): row is { task_id: string; user_id: string; content: string } => row !== null);

    if (savedResults.length > 0) {
      for (const batch of chunks(savedResults, 100)) {
        const { error } = await session.supabase.from("task_results").insert(batch);
        if (error) throw new Error(`results:${error.code ?? "unknown"}`);
      }
    }

    let reflections = 0;
    if (rows.reflections.length > 0) {
      // DO NOTHING on a week that already exists: an import never overwrites.
      const { error, count } = await session.supabase
        .from("weekly_checkins")
        .upsert(
          rows.reflections.map((reflection) => ({
            user_id: session.user.id,
            week_start: reflection.week_start,
            moved_forward: reflection.moved_forward,
            got_in_the_way: reflection.got_in_the_way,
            next_step: reflection.next_step,
          })),
          { onConflict: "user_id,week_start", ignoreDuplicates: true, count: "exact" },
        );
      if (error) throw new Error(`reflections:${error.code ?? "unknown"}`);
      reflections = count ?? rows.reflections.length;
    }

    let preferences = false;
    if (rows.preferences) {
      const values = {
        session_length_minutes: rows.preferences.session_length_minutes,
        work_days: rows.preferences.work_days,
        work_start: rows.preferences.work_start,
        work_end: rows.preferences.work_end,
        task_size: rows.preferences.task_size,
        communication_style: rows.preferences.communication_style,
        help_topics: rows.preferences.help_topics,
        personalization_enabled: rows.preferences.personalization_enabled,
      };

      const { error } = existing.hasPreferences
        ? await session.supabase
            .from("user_preferences")
            .update(values)
            .eq("user_id", session.user.id)
        : await session.supabase
            .from("user_preferences")
            .insert({ user_id: session.user.id, ...values });

      if (error) throw new Error(`preferences:${error.code ?? "unknown"}`);
      preferences = true;
    }

    revalidatePath("/data");
    revalidatePath("/dashboard");
    revalidatePath("/settings");

    logOperational("import_commit", {
      outcome: "ok",
      goals: rows.goals.length,
      tasks: tasks.length,
      reflections,
    });

    return {
      status: "imported",
      message: `Imported ${rows.goals.length} ${rows.goals.length === 1 ? "goal" : "goals"}, ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}, ${savedResults.length} saved ${savedResults.length === 1 ? "result" : "results"} and ${reflections} ${reflections === 1 ? "reflection" : "reflections"}.${preferences ? " Preferences were imported." : ""} Nothing existing was overwritten.`,
      imported: {
        goals: rows.goals.length,
        tasks: tasks.length,
        savedResults: savedResults.length,
        reflections,
        preferences,
      },
      skippedCount: parsed.plan.skipped.length,
      rejectedCount: parsed.plan.rejected.length,
      nonce: Date.now(),
    };
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 40) : "unknown";
    console.error("commitImportAction failed:", code);
    logOperational("import_commit", { outcome: "error" });
    return {
      status: "error",
      message:
        "The import stopped part-way. Anything created before the failure is listed on your dashboard; nothing existing was overwritten. Check your data and try again with a fresh export.",
    };
  }
}
