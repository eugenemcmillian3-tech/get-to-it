import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import type {
  LearningPlan,
  LearningRecord,
  LearningStep,
} from "@/lib/types";

const LOAD_ERROR =
  "We couldn't load your learning material just now. Refresh the page to try again.";

/** The plan for one goal, or null. Ownership is enforced by RLS and the filter. */
export async function getLearningPlan(
  session: Session,
  goalId: string,
): Promise<{ plan: LearningPlan; steps: LearningStep[] } | null> {
  const { data: plan, error: planError } = await session.supabase
    .from("learning_plans")
    .select(
      "id, goal_id, what_to_learn, experience, outcome, minutes_per_week, model, created_at, updated_at",
    )
    .eq("goal_id", goalId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (planError) {
    console.error("getLearningPlan failed:", planError.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!plan) return null;

  const { data: steps, error: stepsError } = await session.supabase
    .from("learning_steps")
    .select(
      "id, plan_id, position, kind, title, body, estimated_minutes, status, approved_at, created_at, updated_at",
    )
    .eq("plan_id", (plan as LearningPlan).id)
    .eq("user_id", session.user.id)
    .order("position", { ascending: true });

  if (stepsError) {
    console.error("getLearningPlan steps failed:", stepsError.message);
    throw new DataError(LOAD_ERROR);
  }

  return {
    plan: plan as LearningPlan,
    steps: (steps ?? []) as LearningStep[],
  };
}

/**
 * One step with its plan, plus this person's saved record for it. A step that
 * isn't theirs resolves to null, so the page can 404 without disclosing it.
 */
export async function getLearningStep(
  session: Session,
  goalId: string,
  stepId: string,
): Promise<{
  plan: LearningPlan;
  step: LearningStep;
  record: LearningRecord | null;
} | null> {
  const { data: step, error: stepError } = await session.supabase
    .from("learning_steps")
    .select(
      "id, plan_id, position, kind, title, body, estimated_minutes, status, approved_at, created_at, updated_at",
    )
    .eq("id", stepId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (stepError) {
    console.error("getLearningStep failed:", stepError.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!step) return null;

  const { data: plan, error: planError } = await session.supabase
    .from("learning_plans")
    .select(
      "id, goal_id, what_to_learn, experience, outcome, minutes_per_week, model, created_at, updated_at",
    )
    .eq("id", (step as LearningStep).plan_id)
    .eq("goal_id", goalId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (planError) {
    console.error("getLearningStep plan failed:", planError.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!plan) return null;

  const { data: record, error: recordError } = await session.supabase
    .from("learning_records")
    .select(
      "id, step_id, goal_id, prompt, answer, feedback, confidence, revisit, completed_at, created_at, updated_at",
    )
    .eq("step_id", stepId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (recordError) {
    console.error("getLearningStep record failed:", recordError.message);
    throw new DataError(LOAD_ERROR);
  }

  return {
    plan: plan as LearningPlan,
    step: step as LearningStep,
    record: (record as LearningRecord | null) ?? null,
  };
}

/** Every saved exercise record for one goal, newest first. */
export async function getLearningRecords(
  session: Session,
  goalId: string,
): Promise<LearningRecord[]> {
  const { data, error } = await session.supabase
    .from("learning_records")
    .select(
      "id, step_id, goal_id, prompt, answer, feedback, confidence, revisit, completed_at, created_at, updated_at",
    )
    .eq("goal_id", goalId)
    .eq("user_id", session.user.id)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("getLearningRecords failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  return (data ?? []) as LearningRecord[];
}
