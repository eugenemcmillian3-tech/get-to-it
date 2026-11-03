"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/action-state";
import { getSession } from "@/lib/auth";
import { firstErrorMessage, goalInputSchema, isUuid, readText } from "@/lib/validation";

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";

export async function createGoalAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const parsed = goalInputSchema.safeParse({
    title: readText(formData, "title"),
    desired_outcome: readText(formData, "desired_outcome"),
    deadline: readText(formData, "deadline"),
    time_available_minutes: readText(formData, "time_available_minutes"),
    blocker: readText(formData, "blocker"),
  });

  if (!parsed.success) {
    return { status: "error", message: firstErrorMessage(parsed.error) };
  }

  const { data, error } = await session.supabase
    .from("goals")
    .insert({
      user_id: session.user.id,
      title: parsed.data.title,
      desired_outcome: parsed.data.desired_outcome,
      deadline: parsed.data.deadline === "" ? null : parsed.data.deadline,
      time_available_minutes: parsed.data.time_available_minutes,
      blocker: parsed.data.blocker === "" ? null : parsed.data.blocker,
      category: parsed.data.category === "" ? null : parsed.data.category,
    })
    .select("id")
    .single();

  if (error || !data?.id) {
    console.error("createGoalAction failed:", error?.message);
    return {
      status: "error",
      message: "We couldn't save that goal. Your words are still here — try again.",
    };
  }

  revalidatePath("/dashboard");
  redirect(`/goals/${data.id as string}`);
}

/**
 * Archiving keeps a goal and everything in it, and moves it out of the default
 * list. Nothing is deleted, and restoring is the same write in reverse.
 */
export async function archiveGoalAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const goalId = readText(formData, "goal_id");
  if (!isUuid(goalId)) return;

  const { error } = await session.supabase
    .from("goals")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", goalId)
    .eq("user_id", session.user.id);

  if (error) {
    console.error("archiveGoalAction failed:", error.message);
    return;
  }

  revalidatePath("/dashboard");
  revalidatePath(`/goals/${goalId}`);
}

export async function restoreGoalAction(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const goalId = readText(formData, "goal_id");
  if (!isUuid(goalId)) return;

  const { error } = await session.supabase
    .from("goals")
    .update({ archived_at: null })
    .eq("id", goalId)
    .eq("user_id", session.user.id);

  if (error) {
    console.error("restoreGoalAction failed:", error.message);
    return;
  }

  revalidatePath("/dashboard");
  revalidatePath(`/goals/${goalId}`);
}

export async function deleteGoalAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const goalId = readText(formData, "goal_id");
  if (!isUuid(goalId)) {
    return { status: "error", message: "That goal link doesn't look right." };
  }

  const { error } = await session.supabase
    .from("goals")
    .delete()
    .eq("id", goalId)
    .eq("user_id", session.user.id);

  if (error) {
    console.error("deleteGoalAction failed:", error.message);
    return { status: "error", message: "We couldn't delete that goal. Try again." };
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}
