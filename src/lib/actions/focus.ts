"use server";

import { revalidatePath } from "next/cache";
import type { FocusState, FormState } from "@/lib/action-state";
import { getSession } from "@/lib/auth";
import { getFocusSnapshot } from "@/lib/data/progress";
import {
  currentWeekStart,
  focusErrorMessage,
  formatFocusTotal,
} from "@/lib/focus";
import { checkinSchema, firstErrorMessage, isUuid, readText } from "@/lib/validation";
import type { FocusSessionView } from "@/lib/types";

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That task isn't available. Go back to your goal.";
const TIMER_UNAVAILABLE =
  "We couldn't update the timer. Reload the page to see where it stands.";

type FocusRpcPayload = {
  ok?: boolean;
  code?: string;
  reused?: boolean;
  session?: FocusSessionView | null;
};

function fail(message: string): FocusState {
  return { status: "error", message, nonce: Date.now() };
}

/**
 * Start, pause, resume or finish the current focus session.
 *
 * The browser sends an intent and an id — never a duration. Transitions and
 * totals happen inside the database functions, so a repeated click is a no-op
 * rather than extra time, and nothing here can complete a task.
 */
export async function focusAction(
  _previous: FocusState,
  formData: FormData,
): Promise<FocusState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const intent = readText(formData, "intent");
  const goalId = readText(formData, "goal_id");
  const taskId = readText(formData, "task_id");
  const sessionId = readText(formData, "session_id");

  let payload: FocusRpcPayload | null = null;
  let message = "";

  if (intent === "start") {
    if (!isUuid(taskId)) return fail(NOT_AVAILABLE);

    const { data, error } = await session.supabase.rpc("start_focus_session", {
      p_task_id: taskId,
    });
    if (error) {
      console.error("start_focus_session failed:", error.message);
      return fail(TIMER_UNAVAILABLE);
    }

    payload = (data ?? {}) as FocusRpcPayload;
    message = payload.reused
      ? "A session was already open, so this one carries on from it — no duplicate started."
      : "Focus session started.";
  } else if (
    intent === "pause" ||
    intent === "resume" ||
    intent === "finish"
  ) {
    if (!isUuid(sessionId)) {
      return fail(focusErrorMessage("no-session"));
    }

    if (intent === "pause") {
      const { data, error } = await session.supabase.rpc("pause_focus_session", {
        p_session_id: sessionId,
      });
      if (error) {
        console.error("pause_focus_session failed:", error.message);
        return fail(TIMER_UNAVAILABLE);
      }
      payload = (data ?? {}) as FocusRpcPayload;
      message = "Paused. The time recorded so far is kept.";
    } else if (intent === "resume") {
      const { data, error } = await session.supabase.rpc(
        "resume_focus_session",
        { p_session_id: sessionId },
      );
      if (error) {
        console.error("resume_focus_session failed:", error.message);
        return fail(TIMER_UNAVAILABLE);
      }
      payload = (data ?? {}) as FocusRpcPayload;
      message = "Running again.";
    } else {
      const { data, error } = await session.supabase.rpc(
        "finish_focus_session",
        { p_session_id: sessionId },
      );
      if (error) {
        console.error("finish_focus_session failed:", error.message);
        return fail(TIMER_UNAVAILABLE);
      }
      payload = (data ?? {}) as FocusRpcPayload;
      message = "Session finished.";
    }
  } else {
    return fail(TIMER_UNAVAILABLE);
  }

  if (!payload || payload.ok !== true) {
    return fail(focusErrorMessage(payload?.code));
  }

  if (intent === "finish" && payload.session) {
    message = `Session finished. ${formatFocusTotal(payload.session.elapsed_seconds)} recorded — the task is still yours to complete.`;
  }

  let snapshot;
  try {
    snapshot = await getFocusSnapshot(session);
  } catch {
    return {
      status: "error",
      message:
        "Your timer is safe, but we couldn't refresh it. Reload the page to see it.",
      nonce: Date.now(),
    };
  }

  if (isUuid(goalId) && isUuid(taskId)) {
    revalidatePath(`/goals/${goalId}/tasks/${taskId}`);
  }
  revalidatePath("/dashboard");

  return { status: "updated", message, snapshot, nonce: Date.now() };
}

function savedAtLabel(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return "just now";
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Saves this week's reflection.
 *
 * Only `weekly_checkins` is written: no task, goal or plan is touched, so a
 * reflection can never quietly change what you planned to do.
 */
export async function saveCheckinAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const parsed = checkinSchema.safeParse({
    moved_forward: readText(formData, "moved_forward"),
    got_in_the_way: readText(formData, "got_in_the_way"),
    next_step: readText(formData, "next_step"),
  });

  if (!parsed.success) {
    return { status: "error", message: firstErrorMessage(parsed.error) };
  }

  // The week is decided here, not by the form.
  const weekStart = currentWeekStart();

  const { data, error } = await session.supabase
    .from("weekly_checkins")
    .upsert(
      {
        user_id: session.user.id,
        week_start: weekStart,
        moved_forward: parsed.data.moved_forward,
        got_in_the_way: parsed.data.got_in_the_way,
        next_step: parsed.data.next_step,
      },
      { onConflict: "user_id,week_start" },
    )
    .select("updated_at")
    .single();

  if (error || !data) {
    console.error("saveCheckinAction failed:", error?.message);
    return {
      status: "error",
      message:
        "We couldn't save that. Your words are still in the form — try again.",
    };
  }

  revalidatePath("/dashboard");

  return {
    status: "success",
    message: "Saved. Private to your account.",
    savedAt: savedAtLabel(data.updated_at as string),
    nonce: Date.now(),
  };
}
