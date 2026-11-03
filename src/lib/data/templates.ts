import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import type { PersonalTemplate } from "@/lib/types";
import { templateStepsSchema } from "@/lib/validation";

/**
 * Private templates, read straight from the person's own rows.
 *
 * Row Level Security means a template that belongs to someone else simply is
 * not there: these queries cannot return it, and no ownership check here can be
 * forgotten.
 */

const LOAD_ERROR =
  "We couldn't load your templates just now. Refresh the page to try again.";

const TEMPLATE_COLUMNS =
  "id, user_id, name, description, desired_outcome, category, steps, source_goal_id, created_at, updated_at";

type TemplateRow = Omit<PersonalTemplate, "steps"> & { steps: unknown };

function toPersonalTemplate(row: TemplateRow): PersonalTemplate {
  const parsed = templateStepsSchema.safeParse(row.steps);
  return {
    ...row,
    steps: parsed.success ? parsed.data : [],
  };
}

export async function listPersonalTemplates(
  session: Session,
): Promise<PersonalTemplate[]> {
  const { data, error } = await session.supabase
    .from("goal_templates")
    .select(TEMPLATE_COLUMNS)
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("listPersonalTemplates failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  return ((data ?? []) as TemplateRow[]).map(toPersonalTemplate);
}

export async function getPersonalTemplate(
  session: Session,
  templateId: string,
): Promise<PersonalTemplate | null> {
  const { data, error } = await session.supabase
    .from("goal_templates")
    .select(TEMPLATE_COLUMNS)
    .eq("id", templateId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error("getPersonalTemplate failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  return data ? toPersonalTemplate(data as TemplateRow) : null;
}
