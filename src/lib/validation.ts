import { z } from "zod";
import { MAX_TASK_RESULT_LENGTH } from "@/lib/constants";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const taskStatusSchema = z.enum(["todo", "in_progress", "completed"]);

export const optionalDateSchema = z
  .string()
  .trim()
  .refine((value) => value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value), {
    message: "Use a date like 2026-03-14.",
  })
  .refine(
    (value) => {
      if (value === "") return true;
      const parsed = new Date(`${value}T00:00:00Z`);
      return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
      );
    },
    { message: "That date doesn't exist. Pick another one." },
  );

export const goalCategorySchema = z.enum([
  "launch",
  "job",
  "content",
  "learn",
  "personal",
  "business",
]);

/** A category select where "" means "no category". */
const optionalCategorySchema = z.union([goalCategorySchema, z.literal("")]);

const goalTitleSchema = z
  .string()
  .trim()
  .min(3, "Give your goal a short, specific title.")
  .max(160, "Keep the title under 160 characters.");

const goalOutcomeSchema = z
  .string()
  .trim()
  .min(5, "Describe what done looks like, even roughly.")
  .max(2000, "Keep the outcome under 2000 characters.");

const goalTimeSchema = z.coerce
  .number()
  .int()
  .min(5, "Choose at least 5 minutes.")
  .max(480, "Keep today's time to 8 hours or less.");

export const goalInputSchema = z.object({
  title: goalTitleSchema,
  desired_outcome: goalOutcomeSchema,
  deadline: optionalDateSchema,
  time_available_minutes: goalTimeSchema,
  blocker: z
    .string()
    .trim()
    .max(2000, "Keep this under 2000 characters."),
  category: optionalCategorySchema.default(""),
});

export type GoalInput = z.infer<typeof goalInputSchema>;

/** A step in a template: a name, a time estimate, and an example deliverable. */
export const templateStepSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, "Give every step a name.")
    .max(200, "Keep step names under 200 characters."),
  estimated_minutes: z.coerce
    .number()
    .int("Estimates are whole minutes.")
    .min(5, "Estimates start at 5 minutes.")
    .max(480, "Keep estimates at 8 hours or less."),
  example_deliverable: z
    .string()
    .trim()
    .max(300, "Keep examples under 300 characters.")
    .nullable()
    .default(null),
});

export type TemplateStepInput = z.infer<typeof templateStepSchema>;

export const templateStepsSchema = z
  .array(templateStepSchema)
  .min(1, "Keep at least one step.")
  .max(12, "A template holds at most 12 steps.");

/** Creating a goal from a template: the plan is copied, never referenced. */
export const templateUseSchema = z.object({
  title: goalTitleSchema,
  desired_outcome: goalOutcomeSchema,
  deadline: optionalDateSchema,
  time_available_minutes: goalTimeSchema,
  category: optionalCategorySchema.default(""),
  steps: templateStepsSchema,
});

/** Editing or saving a private template. */
export const personalTemplateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "Give the template a name.")
    .max(120, "Keep the name under 120 characters."),
  description: z
    .string()
    .trim()
    .min(3, "Say what this template is for.")
    .max(1000, "Keep the description under 1000 characters."),
  desired_outcome: goalOutcomeSchema,
  category: optionalCategorySchema.default(""),
  steps: templateStepsSchema,
});

export type PersonalTemplateInput = z.infer<typeof personalTemplateSchema>;

export const taskInputSchema = z.object({
  goal_id: z.string().trim().regex(UUID_PATTERN, "That goal link doesn't look right."),
  title: z
    .string()
    .trim()
    .min(2, "Give the task a short, specific name.")
    .max(200, "Keep task names under 200 characters."),
});

export type TaskInput = z.infer<typeof taskInputSchema>;

export const taskEditSchema = taskInputSchema.extend({
  task_id: z.string().trim().regex(UUID_PATTERN, "That task link doesn't look right."),
  status: taskStatusSchema,
});

export const taskResultSchema = z.object({
  task_id: z.string().trim().regex(UUID_PATTERN, "That task link doesn't look right."),
  goal_id: z.string().trim().regex(UUID_PATTERN, "That goal link doesn't look right."),
  content: z
    .string()
    .max(MAX_TASK_RESULT_LENGTH, "Saved work is limited to 20000 characters."),
  intent: z.enum(["save", "complete"]).default("save"),
});

/**
 * A weekly reflection. Every prompt is optional, but an entirely blank entry
 * saves nothing, so at least one answer is required.
 */
export const checkinSchema = z
  .object({
    moved_forward: z
      .string()
      .trim()
      .max(2000, "Keep this under 2000 characters.")
      .default(""),
    got_in_the_way: z
      .string()
      .trim()
      .max(2000, "Keep this under 2000 characters.")
      .default(""),
    next_step: z
      .string()
      .trim()
      .max(500, "Keep your next step under 500 characters.")
      .default(""),
  })
  .refine(
    (value) =>
      value.moved_forward !== "" ||
      value.got_in_the_way !== "" ||
      value.next_step !== "",
    { message: "Write one line before saving." },
  );

export type CheckinInput = z.infer<typeof checkinSchema>;

/** The five things the feedback form asks about. */
export const FEEDBACK_AREAS = [
  "starting",
  "working",
  "stuck",
  "returning",
  "other",
] as const;

export const feedbackSchema = z.object({
  area: z.enum(FEEDBACK_AREAS).default("other"),
  message: z
    .string()
    .trim()
    .min(3, "Tell us a sentence or two.")
    .max(2000, "Keep feedback under 2000 characters."),
  contact_ok: z.boolean().default(false),
});

export type FeedbackInput = z.infer<typeof feedbackSchema>;

export const signUpSchema = z.object({
  display_name: z
    .string()
    .trim()
    .max(80, "Keep your name under 80 characters."),
  email: z
    .string()
    .trim()
    .min(1, "Enter your email address.")
    .max(254, "That email is too long.")
    .regex(EMAIL_PATTERN, "That email doesn't look right."),
  password: z
    .string()
    .min(8, "Use at least 8 characters.")
    .max(72, "Passwords are limited to 72 characters."),
});

export const signInSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email address.")
    .max(254, "That email is too long.")
    .regex(EMAIL_PATTERN, "That email doesn't look right."),
  password: z.string().min(1, "Enter your password.").max(72, "Passwords are limited to 72 characters."),
});

/** Safely read a form value as a trimmed string. */
export function readText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export function firstErrorMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Only allow in-app redirects after sign-in. */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}
