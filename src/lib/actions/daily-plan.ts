"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { DailyPlanState } from "@/lib/action-state";
import { getSession } from "@/lib/auth";
import { formatMinutes } from "@/lib/format";
import { firstErrorMessage, isUuid, readText } from "@/lib/validation";
import type { DailyPlan } from "@/lib/types";

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";

const planRequestSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a day."),
  minutes: z.coerce
    .number()
    .int()
    .min(5, "Choose at least 5 minutes.")
    .max(1440, "Keep it to 24 hours or less."),
  task_ids: z
    .array(z.string().trim())
    .min(1, "Choose at least one task.")
    .max(20, "Keep the selection to 20 tasks."),
  allow_over_limit: z.boolean(),
});

type PlanPayload = {
  ok?: boolean;
  code?: string;
  total_minutes?: number;
  unknown_estimates?: number;
  plan?: DailyPlan;
};

/**
 * Approves a daily selection.
 *
 * The browser sends ids and the time it has; the database verifies ownership,
 * computes the total from the tasks' own estimates and refuses an overrun
 * unless the person ticked the warning. No task row is written.
 */
export async function saveDailyPlanAction(
  _previous: DailyPlanState,
  formData: FormData,
): Promise<DailyPlanState> {
  const session = await getSession();
  if (!session) {
    return { status: "error", message: SESSION_EXPIRED, nonce: Date.now() };
  }

  let taskIds: unknown = null;
  try {
    taskIds = JSON.parse(readText(formData, "task_ids_json"));
  } catch {
    taskIds = null;
  }

  const parsed = planRequestSchema.safeParse({
    day: readText(formData, "day"),
    minutes: readText(formData, "minutes"),
    task_ids: taskIds,
    allow_over_limit: readText(formData, "allow_over_limit") === "true",
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: firstErrorMessage(parsed.error),
      nonce: Date.now(),
    };
  }

  if (!parsed.data.task_ids.every(isUuid)) {
    return {
      status: "error",
      message: "That selection wasn't usable. Pick the tasks again.",
      nonce: Date.now(),
    };
  }

  const { data, error } = await session.supabase.rpc("save_daily_plan", {
    p_day: parsed.data.day,
    p_minutes: parsed.data.minutes,
    p_task_ids: parsed.data.task_ids,
    p_allow_over_limit: parsed.data.allow_over_limit,
  });

  if (error) {
    console.error("saveDailyPlanAction failed:", error.message);
    return {
      status: "error",
      message: "We couldn't save that plan. Nothing changed — try again.",
      nonce: Date.now(),
    };
  }

  const payload = (data ?? {}) as PlanPayload;
  const total = Number(payload.total_minutes ?? 0);
  const unknown = Number(payload.unknown_estimates ?? 0);
  const estimateNote =
    unknown > 0
      ? ` ${unknown} of them ${unknown === 1 ? "has" : "have"} no estimate, so the real total may be higher.`
      : "";

  if (payload.ok !== true) {
    switch (payload.code) {
      case "over-limit":
        return {
          status: "warning",
          message: `That's about ${formatMinutes(total)} of estimated work in ${formatMinutes(parsed.data.minutes)} of time.${estimateNote} Nothing is saved yet: pick less, give yourself more time, or confirm you want the longer list.`,
          totalMinutes: total,
          unknownEstimates: unknown,
          nonce: Date.now(),
        };
      case "unknown-task":
        return {
          status: "error",
          message:
            "One of those tasks changed or isn't open any more. Nothing was saved — pick the list again.",
          nonce: Date.now(),
        };
      case "invalid-selection":
      case "invalid-minutes":
      case "invalid-day":
      case "unauthenticated":
        return {
          status: "error",
          message: "That plan wasn't usable. Nothing changed — pick the tasks again.",
          nonce: Date.now(),
        };
      default:
        return {
          status: "error",
          message: "We couldn't save that plan. Nothing changed — try again.",
          nonce: Date.now(),
        };
    }
  }

  revalidatePath("/plan");
  revalidatePath("/dashboard");

  return {
    status: "saved",
    message: `Plan approved for ${parsed.data.day}: ${parsed.data.task_ids.length} ${
      parsed.data.task_ids.length === 1 ? "task" : "tasks"
    }, about ${formatMinutes(total)} of estimated work.${estimateNote} No task status was changed.`,
    plan: payload.plan,
    totalMinutes: total,
    unknownEstimates: unknown,
    nonce: Date.now(),
  };
}
