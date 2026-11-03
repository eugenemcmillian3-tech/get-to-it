"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/lib/action-state";
import { getSession } from "@/lib/auth";
import { getPersonalTemplate } from "@/lib/data/templates";
import { stepsFromTasks } from "@/lib/templates/helpers";
import { getStaticTemplate } from "@/lib/templates/library";
import {
  firstErrorMessage,
  isUuid,
  personalTemplateSchema,
  readText,
  templateUseSchema,
} from "@/lib/validation";

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That item isn't available. Go back to your dashboard.";

/**
 * Steps arrive as indexed fields (`step_title_0`, `step_minutes_0`, …) so a
 * person can edit titles and time estimates before anything is saved. Blank
 * titles are treated as removed steps, not as errors.
 */
function readStepsFromForm(
  formData: FormData,
  prefix = "step",
): { title: string; estimated_minutes: string; example_deliverable: string | null }[] {
  const rawCount = Number.parseInt(readText(formData, `${prefix}_count`), 10);
  const count = Number.isFinite(rawCount)
    ? Math.min(Math.max(rawCount, 0), 12)
    : 0;

  const steps: {
    title: string;
    estimated_minutes: string;
    example_deliverable: string | null;
  }[] = [];

  for (let index = 0; index < count; index += 1) {
    const title = readText(formData, `${prefix}_title_${index}`);
    if (title === "") continue;

    const minutes = readText(formData, `${prefix}_minutes_${index}`);
    const deliverable = readText(formData, `${prefix}_deliverable_${index}`);

    steps.push({
      title,
      estimated_minutes: minutes === "" ? "20" : minutes,
      example_deliverable: deliverable === "" ? null : deliverable,
    });
  }

  return steps;
}

/**
 * Creates a goal and its tasks from a template.
 *
 * The template is only ever read: a static one from code, a personal one from
 * the person's own rows. Everything copied into the goal becomes the person's
 * own data, so editing the goal afterwards cannot touch the source template.
 */
export async function createGoalFromTemplateAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const kind = readText(formData, "template_kind");
  const key = readText(formData, "template_key");

  let staticTemplateId: string | null = null;

  if (kind === "personal") {
    if (!isUuid(key)) return { status: "error", message: NOT_AVAILABLE };
    const template = await getPersonalTemplate(session, key);
    if (!template) return { status: "error", message: NOT_AVAILABLE };
    staticTemplateId = null;
  } else if (kind === "static") {
    const template = getStaticTemplate(key);
    if (!template) return { status: "error", message: NOT_AVAILABLE };
  } else {
    return { status: "error", message: NOT_AVAILABLE };
  }

  const parsed = templateUseSchema.safeParse({
    title: readText(formData, "title"),
    desired_outcome: readText(formData, "desired_outcome"),
    deadline: readText(formData, "deadline"),
    time_available_minutes: readText(formData, "time_available_minutes"),
    category: readText(formData, "category"),
    steps: readStepsFromForm(formData),
  });

  if (!parsed.success) {
    return { status: "error", message: firstErrorMessage(parsed.error) };
  }

  const { steps, ...goalInput } = parsed.data;

  const { data: goal, error: goalError } = await session.supabase
    .from("goals")
    .insert({
      user_id: session.user.id,
      title: goalInput.title,
      desired_outcome: goalInput.desired_outcome,
      deadline: goalInput.deadline === "" ? null : goalInput.deadline,
      time_available_minutes: goalInput.time_available_minutes,
      category: goalInput.category === "" ? null : goalInput.category,
      template_id: kind === "personal" ? key : staticTemplateId,
    })
    .select("id")
    .single();

  if (goalError || !goal?.id) {
    console.error("createGoalFromTemplateAction goal failed:", goalError?.message);
    return {
      status: "error",
      message: "We couldn't create that goal. Your edits are still here — try again.",
    };
  }

  const goalId = goal.id as string;

  const { error: tasksError } = await session.supabase.from("tasks").insert(
    steps.map((item, index) => ({
      goal_id: goalId,
      user_id: session.user.id,
      title: item.title,
      status: "todo" as const,
      sort_order: index,
      estimated_minutes: item.estimated_minutes,
      expected_deliverable: item.example_deliverable,
      origin: "manual" as const,
    })),
  );

  if (tasksError) {
    console.error("createGoalFromTemplateAction tasks failed:", tasksError.message);
    // Do not leave a goal behind with no steps: remove it and report honestly.
    await session.supabase.from("goals").delete().eq("id", goalId);
    return {
      status: "error",
      message:
        "We created the goal but couldn't add its steps, so nothing was kept. Try again.",
    };
  }

  revalidatePath("/dashboard");
  revalidatePath("/templates");
  redirect(`/goals/${goalId}`);
}

/**
 * Saves one of the person's existing plans as a private template.
 *
 * Only task names, their order and their time estimates are read. Saved work,
 * reflections and AI assistance are never selected, so they cannot be copied
 * into a template even by accident.
 */
export async function savePlanAsTemplateAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const goalId = readText(formData, "goal_id");
  if (!isUuid(goalId)) return { status: "error", message: NOT_AVAILABLE };

  const { data: goal, error: goalError } = await session.supabase
    .from("goals")
    .select("id, desired_outcome")
    .eq("id", goalId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (goalError) {
    console.error("savePlanAsTemplateAction goal lookup failed:", goalError.message);
    return { status: "error", message: "We couldn't save that template. Try again." };
  }
  if (!goal) return { status: "error", message: NOT_AVAILABLE };

  // Titles, order and time estimates only.
  const { data: tasks, error: tasksError } = await session.supabase
    .from("tasks")
    .select("title, estimated_minutes, sort_order")
    .eq("goal_id", goalId)
    .eq("user_id", session.user.id)
    .order("sort_order", { ascending: true });

  if (tasksError) {
    console.error("savePlanAsTemplateAction tasks failed:", tasksError.message);
    return { status: "error", message: "We couldn't save that template. Try again." };
  }

  const steps = stepsFromTasks(
    (tasks ?? []) as {
      title: string;
      estimated_minutes: number | null;
      sort_order: number | null;
    }[],
  );

  if (steps.length === 0) {
    return {
      status: "error",
      message: "Add at least one task before saving this plan as a template.",
    };
  }

  const parsed = personalTemplateSchema.safeParse({
    name: readText(formData, "name"),
    description: readText(formData, "description"),
    desired_outcome: goal.desired_outcome as string,
    category: readText(formData, "category"),
    steps,
  });

  if (!parsed.success) {
    return { status: "error", message: firstErrorMessage(parsed.error) };
  }

  const { error } = await session.supabase.from("goal_templates").insert({
    user_id: session.user.id,
    name: parsed.data.name,
    description: parsed.data.description,
    desired_outcome: parsed.data.desired_outcome,
    category: parsed.data.category === "" ? null : parsed.data.category,
    steps: parsed.data.steps,
    source_goal_id: goalId,
  });

  if (error) {
    console.error("savePlanAsTemplateAction insert failed:", error.message);
    return { status: "error", message: "We couldn't save that template. Try again." };
  }

  revalidatePath("/templates");
  return {
    status: "success",
    message:
      "Saved to your private templates. Task names and time estimates only — saved work, reflections and AI answers stayed private.",
    nonce: Date.now(),
  };
}

export async function updatePersonalTemplateAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const templateId = readText(formData, "template_id");
  if (!isUuid(templateId)) return { status: "error", message: NOT_AVAILABLE };

  const parsed = personalTemplateSchema.safeParse({
    name: readText(formData, "name"),
    description: readText(formData, "description"),
    desired_outcome: readText(formData, "desired_outcome"),
    category: readText(formData, "category"),
    steps: readStepsFromForm(formData),
  });

  if (!parsed.success) {
    return { status: "error", message: firstErrorMessage(parsed.error) };
  }

  const { data, error } = await session.supabase
    .from("goal_templates")
    .update({
      name: parsed.data.name,
      description: parsed.data.description,
      desired_outcome: parsed.data.desired_outcome,
      category: parsed.data.category === "" ? null : parsed.data.category,
      steps: parsed.data.steps,
    })
    .eq("id", templateId)
    .eq("user_id", session.user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("updatePersonalTemplateAction failed:", error.message);
    return { status: "error", message: "We couldn't update that template. Try again." };
  }
  if (!data) return { status: "error", message: NOT_AVAILABLE };

  revalidatePath("/templates");
  revalidatePath(`/templates/personal/${templateId}`);
  return {
    status: "success",
    message: "Template updated. Goals you already made from it are unchanged.",
    nonce: Date.now(),
  };
}

export async function deletePersonalTemplateAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return { status: "error", message: SESSION_EXPIRED };

  const templateId = readText(formData, "template_id");
  if (!isUuid(templateId)) return { status: "error", message: NOT_AVAILABLE };

  const { data, error } = await session.supabase
    .from("goal_templates")
    .delete()
    .eq("id", templateId)
    .eq("user_id", session.user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("deletePersonalTemplateAction failed:", error.message);
    return { status: "error", message: "We couldn't delete that template. Try again." };
  }
  if (!data) return { status: "error", message: NOT_AVAILABLE };

  revalidatePath("/templates");
  redirect("/templates");
}
