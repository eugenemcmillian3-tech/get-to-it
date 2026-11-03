"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/lib/action-state";
import { getSession } from "@/lib/auth";
import {
  firstErrorMessage,
  isUuid,
  readText,
  taskEditSchema,
  taskInputSchema,
  taskResultSchema,
} from "@/lib/validation";

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That item isn't available. Go back to your dashboard.";

function savedAtLabel(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return "just now";
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export async function createTaskAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const parsed = taskInputSchema.safeParse({
    goal_id: readText(formData, "goal_id"),
    title: readText(formData, "title"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstErrorMessage(parsed.error) };
  }

  // Confirm the goal belongs to this user before writing anything.
  const { data: goal, error: goalError } = await session.supabase
    .from("goals")
    .select("id")
    .eq("id", parsed.data.goal_id)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (goalError) {
    console.error("createTaskAction goal lookup failed:", goalError.message);
    return { status: "error", message: "We couldn't add that task. Try again." };
  }
  if (!goal) return { status: "error", message: NOT_AVAILABLE };

  const { error } = await session.supabase.from("tasks").insert({
    goal_id: parsed.data.goal_id,
    user_id: session.user.id,
    title: parsed.data.title,
  });

  if (error) {
    console.error("createTaskAction failed:", error.message);
    return {
      status: "error",
      message: "We couldn't add that task. Your words are still here — try again.",
    };
  }

  revalidatePath(`/goals/${parsed.data.goal_id}`);
  revalidatePath("/dashboard");
  return { status: "success", message: "Task added.", nonce: Date.now() };
}

export async function updateTaskAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const parsed = taskEditSchema.safeParse({
    goal_id: readText(formData, "goal_id"),
    task_id: readText(formData, "task_id"),
    title: readText(formData, "title"),
    status: readText(formData, "status"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstErrorMessage(parsed.error) };
  }

  const { data, error } = await session.supabase
    .from("tasks")
    .update({ title: parsed.data.title, status: parsed.data.status })
    .eq("id", parsed.data.task_id)
    .eq("goal_id", parsed.data.goal_id)
    .eq("user_id", session.user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("updateTaskAction failed:", error.message);
    return { status: "error", message: "We couldn't update that task. Try again." };
  }
  if (!data) return { status: "error", message: NOT_AVAILABLE };

  revalidatePath(`/goals/${parsed.data.goal_id}`);
  revalidatePath(`/goals/${parsed.data.goal_id}/tasks/${parsed.data.task_id}`);
  revalidatePath("/dashboard");
  return { status: "success", message: "Task updated.", nonce: Date.now() };
}

export async function saveWorkspaceAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const parsed = taskResultSchema.safeParse({
    task_id: readText(formData, "task_id"),
    goal_id: readText(formData, "goal_id"),
    content: readText(formData, "content"),
    intent: readText(formData, "intent") === "complete" ? "complete" : "save",
  });
  if (!parsed.success) {
    return { status: "error", message: firstErrorMessage(parsed.error) };
  }

  const { goal_id, task_id, content, intent } = parsed.data;

  const { data: task, error: taskError } = await session.supabase
    .from("tasks")
    .select("id, status")
    .eq("id", task_id)
    .eq("goal_id", goal_id)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (taskError) {
    console.error("saveWorkspaceAction task lookup failed:", taskError.message);
    return { status: "error", message: "We couldn't save your work. Try again." };
  }
  if (!task) return { status: "error", message: NOT_AVAILABLE };

  const { data: saved, error: saveError } = await session.supabase
    .from("task_results")
    // task_results has no goal_id column: the parent goal is checked through
    // the task's own ownership, in the policy and in the lookup above.
    .upsert(
      { task_id, user_id: session.user.id, content },
      { onConflict: "task_id" },
    )
    .select("content, updated_at")
    .single();

  if (saveError || !saved) {
    console.error("saveWorkspaceAction failed:", saveError?.message);
    return {
      status: "error",
      message: "We couldn't save your work. Nothing was lost — try again.",
    };
  }

  let completed = task.status === "completed";

  if (intent === "complete" && !completed) {
    const { error: statusError } = await session.supabase
      .from("tasks")
      .update({ status: "completed" })
      .eq("id", task_id)
      .eq("user_id", session.user.id);

    if (statusError) {
      console.error("saveWorkspaceAction complete failed:", statusError.message);
      return {
        status: "error",
        message:
          "Your work was saved, but we couldn't mark the task complete. Try again.",
        savedAt: savedAtLabel(saved.updated_at as string),
        savedContent: saved.content as string,
      };
    }
    completed = true;
  }

  revalidatePath(`/goals/${goal_id}`);
  revalidatePath(`/goals/${goal_id}/tasks/${task_id}`);
  revalidatePath("/dashboard");

  return {
    status: "success",
    message: completed ? "Work saved. Task marked complete." : "Work saved.",
    savedAt: savedAtLabel(saved.updated_at as string),
    savedContent: saved.content as string,
    nonce: Date.now(),
  };
}

export async function reopenTaskAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const taskId = readText(formData, "task_id");
  const goalId = readText(formData, "goal_id");
  if (!isUuid(taskId) || !isUuid(goalId)) {
    return { status: "error", message: NOT_AVAILABLE };
  }

  const { error } = await session.supabase
    .from("tasks")
    .update({ status: "todo" })
    .eq("id", taskId)
    .eq("goal_id", goalId)
    .eq("user_id", session.user.id);

  if (error) {
    console.error("reopenTaskAction failed:", error.message);
    return { status: "error", message: "We couldn't reopen that task. Try again." };
  }

  revalidatePath(`/goals/${goalId}`);
  revalidatePath(`/goals/${goalId}/tasks/${taskId}`);
  revalidatePath("/dashboard");
  return { status: "success", message: "Task reopened.", nonce: Date.now() };
}
