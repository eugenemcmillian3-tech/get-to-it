/**
 * Workflow rules: the five supported step kinds, the run state machine, exact
 * content hashing, idempotency keys and retry policy.
 *
 * Everything here is pure, so the risky parts — an approval that must match
 * exactly, a retry that must not repeat an external call, an edit that must not
 * reach an active run — are unit tested without a database or a model.
 */

import { z } from "zod";
import type { ChatMessage } from "@/lib/ai/ollama";
import { clip } from "@/lib/format";
import type {
  ActionApproval,
  ActionRecord,
  TaskResult,
  WorkflowRunStep,
  WorkflowStepKind,
} from "@/lib/types";

export const WORKFLOW_STEP_KINDS = [
  "user_input",
  "ai_draft",
  "user_review",
  "connector_action",
  "checkpoint",
] as const;

export const STEP_KIND_LABELS: Record<WorkflowStepKind, string> = {
  user_input: "User input",
  ai_draft: "AI drafting",
  user_review: "User review",
  connector_action: "Approved connector action",
  checkpoint: "Completion checkpoint",
};

export const STEP_KIND_DESCRIPTIONS: Record<WorkflowStepKind, string> = {
  user_input: "Collects what the person wants included, including completed work.",
  ai_draft: "Drafts text from those inputs. Nothing is saved anywhere.",
  user_review: "The person edits and approves the draft. This is the only approval of content.",
  connector_action: "One action, with its own exact-content approval.",
  checkpoint: "The person marks the run finished. No automatic success.",
};

export const RUN_STATUSES = [
  "not_started",
  "waiting_for_input",
  "running",
  "waiting_for_approval",
  "succeeded",
  "failed",
  "cancelled",
  "outcome_uncertain",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  not_started: "Not started",
  waiting_for_input: "Waiting for input",
  running: "Running",
  waiting_for_approval: "Waiting for approval",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
  outcome_uncertain: "Outcome uncertain",
};

export const STEP_STATUSES = [
  "pending",
  "waiting_for_input",
  "running",
  "waiting_for_approval",
  "succeeded",
  "failed",
  "cancelled",
  "outcome_uncertain",
] as const;

export type RunStepStatus = (typeof STEP_STATUSES)[number];

export const STEP_STATUS_LABELS: Record<RunStepStatus, string> = {
  pending: "Pending",
  waiting_for_input: "Waiting for input",
  running: "Running",
  waiting_for_approval: "Waiting for approval",
  succeeded: "Succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
  outcome_uncertain: "Outcome uncertain",
};

export const WORKFLOW_NAME_MAX = 120;
export const WORKFLOW_DESCRIPTION_MAX = 500;
export const WORKFLOW_STEP_TITLE_MAX = 120;
export const WORKFLOW_STEP_INSTRUCTIONS_MAX = 1000;
export const WORKFLOW_DESTINATION_MAX = 200;
export const WORKFLOW_MIN_STEPS = 2;
export const WORKFLOW_MAX_STEPS = 10;
export const MAX_DRAFT_LENGTH = 8000;
export const MAX_SELECTED_TASKS = 20;
export const MAX_INPUT_NOTES = 4000;

export const TERMINAL_RUN_STATUSES: RunStatus[] = [
  "succeeded",
  "failed",
  "cancelled",
  "outcome_uncertain",
];

export function isTerminalRunStatus(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status);
}

export function canCancelRun(status: RunStatus): boolean {
  return !isTerminalRunStatus(status);
}

export const RETRY_POLICIES = ["manual", "none"] as const;
export type RetryPolicy = (typeof RETRY_POLICIES)[number];

export const RETRY_POLICY_LABELS: Record<RetryPolicy, string> = {
  manual: "A person may retry this step",
  none: "No retry — a failure ends the run",
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uuidSchema = z
  .string()
  .trim()
  .regex(UUID_PATTERN, "That link doesn't look right.");

export const workflowStepSchema = z.object({
  kind: z.enum(WORKFLOW_STEP_KINDS),
  title: z
    .string()
    .trim()
    .min(2, "Give every step a short title.")
    .max(WORKFLOW_STEP_TITLE_MAX, "Keep step titles under 120 characters."),
  instructions: z
    .string()
    .trim()
    .max(WORKFLOW_STEP_INSTRUCTIONS_MAX, "Keep step notes under 1000 characters.")
    .default(""),
  retry_policy: z.enum(RETRY_POLICIES).default("manual"),
  config: z
    .object({
      connector: z.string().trim().max(60).optional(),
      destination: z.string().trim().max(WORKFLOW_DESTINATION_MAX).optional(),
    })
    .default({}),
});

export type WorkflowStepInput = z.infer<typeof workflowStepSchema>;

export const workflowStepsSchema = z
  .array(workflowStepSchema)
  .min(WORKFLOW_MIN_STEPS, "A workflow needs at least two steps.")
  .max(WORKFLOW_MAX_STEPS, "A workflow holds at most ten steps.");

export const workflowInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Give the workflow a name.")
    .max(WORKFLOW_NAME_MAX, "Keep the name under 120 characters."),
  description: z
    .string()
    .trim()
    .max(WORKFLOW_DESCRIPTION_MAX, "Keep the description under 500 characters.")
    .default(""),
  goal_id: z.union([uuidSchema, z.literal("")]).default(""),
  steps: workflowStepsSchema,
}).superRefine((value, ctx) => {
  const kinds = value.steps.map((step) => step.kind);

  if (value.steps[0].kind !== "user_input") {
    ctx.addIssue({
      code: "custom",
      message: "The first step must collect input, so the run has something to work from.",
      path: ["steps", 0, "kind"],
    });
  }

  if (!kinds.includes("ai_draft")) {
    ctx.addIssue({
      code: "custom",
      message: "Add an AI drafting step.",
      path: ["steps"],
    });
  }

  if (!kinds.includes("user_review")) {
    ctx.addIssue({
      code: "custom",
      message: "Add a review step: generated text is never sent without a person approving it.",
      path: ["steps"],
    });
  }

  if (!kinds.includes("checkpoint")) {
    ctx.addIssue({
      code: "custom",
      message: "Add a completion checkpoint, so finishing is an explicit act.",
      path: ["steps"],
    });
  }

  value.steps.forEach((step, index) => {
    if (step.kind !== "connector_action") return;

    if (!step.config.destination || step.config.destination.trim() === "") {
      ctx.addIssue({
        code: "custom",
        message: "Say where the approved text would go.",
        path: ["steps", index, "config", "destination"],
      });
    }

    const reviewBefore = value.steps
      .slice(0, index)
      .some((earlier) => earlier.kind === "user_review");

    if (!reviewBefore) {
      ctx.addIssue({
        code: "custom",
        message: "A connector action must come after a review step.",
        path: ["steps", index, "kind"],
      });
    }
  });
});

export type WorkflowInput = z.infer<typeof workflowInputSchema>;

/**
 * Steps that reuse an existing private template: the standard input, draft and
 * review steps, with one checkpoint per template step. Template text is only
 * names and notes the person already saved; nothing is called.
 */
export function stepsFromTemplate(
  templateSteps: { title: string }[],
): WorkflowStepInput[] {
  const checkpoints = templateSteps.slice(0, 6).map((step) => ({
    kind: "checkpoint" as const,
    title: clip(step.title, WORKFLOW_STEP_TITLE_MAX),
    instructions: "Confirm this part of the run is done.",
    retry_policy: "manual" as const,
    config: {},
  }));

  return [
    {
      kind: "user_input",
      title: "Select the goal and completed work",
      instructions: "Choose what this run is about and which finished tasks to include.",
      retry_policy: "manual",
      config: {},
    },
    {
      kind: "ai_draft",
      title: "Draft from the selected work",
      instructions: "Draft in plain text. Nothing is sent anywhere.",
      retry_policy: "manual",
      config: {},
    },
    {
      kind: "user_review",
      title: "Edit and approve the draft",
      instructions: "Change anything you like. Approving here approves this exact text only.",
      retry_policy: "manual",
      config: {},
    },
    ...checkpoints,
  ].slice(0, WORKFLOW_MAX_STEPS) as WorkflowStepInput[];
}

/** The example workflow, used as the editor's starting point. */
export const EXAMPLE_WORKFLOW_STEPS: WorkflowStepInput[] = [
  {
    kind: "user_input",
    title: "Select the goal and completed work",
    instructions: "Pick the project and tick the finished tasks to include.",
    retry_policy: "manual",
    config: {},
  },
  {
    kind: "ai_draft",
    title: "Generate a weekly update draft",
    instructions: "Summarise only the selected work.",
    retry_policy: "manual",
    config: {},
  },
  {
    kind: "user_review",
    title: "Edit and approve the draft",
    instructions: "Rewrite anything that should sound different before it can go anywhere.",
    retry_policy: "manual",
    config: {},
  },
  {
    kind: "connector_action",
    title: "Save the approved update",
    instructions: "Optional: save the exact approved text to the chosen destination.",
    retry_policy: "manual",
    config: { connector: "demo_notes", destination: "Weekly updates (demo)" },
  },
  {
    kind: "checkpoint",
    title: "Mark the weekly update done",
    instructions: "Confirm you sent it wherever it needed to go.",
    retry_policy: "manual",
    config: {},
  },
];

/**
 * FNV-1a over the exact stored text. Used to compare an approval with the action
 * it authorizes; the database stores the hash and the action record's content is
 * immutable once approved.
 */
export function contentHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const second = (hash ^ 0x9e3779b9) >>> 0;
  return `${hash.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

export function actionIdempotencyKey(
  runId: string,
  position: number,
  hash: string,
  attempt = 1,
): string {
  return `${runId}:${position}:${attempt}:${hash}`;
}

export type ApprovalCheck = {
  connector: string;
  destination: string;
  content: string;
};

/**
 * An approval covers one action only when connector, destination and content all
 * match exactly. There is no "approve the workflow" shortcut.
 */
export function approvalCoversAction(
  approval: Pick<ActionApproval, "connector" | "destination" | "approved_content" | "approved_hash" | "consumed_at"> | null,
  action: Pick<ActionRecord, "connector" | "destination" | "content" | "content_hash">,
): boolean {
  if (!approval) return false;
  if (approval.consumed_at !== null) return false;
  if (approval.connector !== action.connector) return false;
  if (approval.destination !== action.destination) return false;
  if (approval.approved_hash !== action.content_hash) return false;
  if (approval.approved_content !== action.content) return false;
  return approval.approved_hash === contentHash(action.content);
}

export function canApproveAction(status: string): boolean {
  return status === "pending_approval";
}

export function canExecuteAction(status: string, hasValidApproval: boolean): boolean {
  return status === "approved" && hasValidApproval;
}

/**
 * Retry behaviour, per step:
 *   * `none` — a failure ends the run.
 *   * `manual` — a person may retry.
 * A retry is refused when an earlier attempt may already have reached the
 * connector (executing, or an uncertain outcome), because repeating it could
 * send the same update twice. A succeeded action is never retried.
 */
export function canRetryStep(
  step: Pick<WorkflowRunStep, "retry_policy" | "status">,
  actions: Pick<ActionRecord, "status">[],
): boolean {
  if (step.retry_policy === "none") return false;
  if (actions.some((action) => action.status === "succeeded")) return false;
  if (
    actions.some(
      (action) => action.status === "executing" || action.status === "outcome_uncertain",
    )
  ) {
    return false;
  }
  return step.status === "failed";
}

export function retryRefusalMessage(): string {
  return "That step may already have reached the connector, so retrying could send it twice. It is marked outcome uncertain instead — check the destination before starting a new run.";
}

/** The run status implied by the step that is now waiting for the person. */
export function runStatusForStepKind(kind: WorkflowStepKind): RunStatus {
  switch (kind) {
    case "user_input":
    case "checkpoint":
      return "waiting_for_input";
    case "user_review":
      return "waiting_for_approval";
    case "connector_action":
      return "waiting_for_approval";
    case "ai_draft":
      return "running";
    default:
      return "running";
  }
}

export function stepStatusForStepKind(kind: WorkflowStepKind): RunStepStatus {
  return runStatusForStepKind(kind) as RunStepStatus;
}

export function nextStep(
  steps: Pick<WorkflowRunStep, "position" | "status">[],
): { position: number; status: RunStepStatus } | null {
  const ordered = [...steps].sort((a, b) => a.position - b.position);
  const pending = ordered.find(
    (step) =>
      step.status === "pending" ||
      step.status === "running" ||
      step.status === "waiting_for_input" ||
      step.status === "waiting_for_approval",
  );

  if (!pending) return null;
  return { position: pending.position, status: pending.status };
}

export type RunProgress = {
  total: number;
  done: number;
  percent: number;
  waitingFor: WorkflowStepKind | null;
};

export function runProgress(
  steps: Pick<WorkflowRunStep, "kind" | "status" | "position">[],
): RunProgress {
  const total = steps.length;
  const done = steps.filter((step) => step.status === "succeeded").length;
  const waiting = [...steps]
    .sort((a, b) => a.position - b.position)
    .find((step) => step.status !== "succeeded" && step.status !== "cancelled");

  return {
    total,
    done,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
    waitingFor: waiting ? waiting.kind : null,
  };
}

/** Outputs are preserved for every step, whether or not a later step failed. */
export function preservedOutputs(
  steps: Pick<WorkflowRunStep, "position" | "title" | "kind" | "output">[],
): { position: number; title: string; kind: WorkflowStepKind; output: unknown }[] {
  return [...steps]
    .sort((a, b) => a.position - b.position)
    .filter((step) => step.output !== null && step.output !== undefined)
    .map((step) => ({
      position: step.position,
      title: step.title,
      kind: step.kind,
      output: step.output,
    }));
}

export type RunContext = {
  inputs?: string;
  selectedTaskIds?: string[];
  taskTitles?: string[];
  draft?: string;
  reviewed?: string;
};

/** Reads the run's stored context defensively: it is JSON from the database. */
export function parseRunContext(value: unknown): RunContext {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const context: RunContext = {};

  if (typeof record.inputs === "string") context.inputs = record.inputs;
  if (typeof record.draft === "string") context.draft = record.draft;
  if (typeof record.reviewed === "string") context.reviewed = record.reviewed;

  if (Array.isArray(record.selectedTaskIds)) {
    context.selectedTaskIds = record.selectedTaskIds.filter(
      (id): id is string => typeof id === "string",
    );
  }

  if (Array.isArray(record.taskTitles)) {
    context.taskTitles = record.taskTitles.filter(
      (title): title is string => typeof title === "string",
    );
  }

  return context;
}

export type SelectedWork = {
  taskId: string;
  title: string;
  status: string;
};

/** Only completed tasks of the run's own goal can be selected. */
export function cleanSelectedTasks(
  selected: string[],
  candidates: { id: string; status: string }[],
): string[] {
  const completed = new Set(
    candidates.filter((task) => task.status === "completed").map((task) => task.id),
  );
  const unique = [...new Set(selected.filter((id) => completed.has(id)))];
  return unique.slice(0, MAX_SELECTED_TASKS);
}

export function selectedWorkLines(
  selected: SelectedWork[],
  results: Pick<TaskResult, "task_id" | "content">[],
): string {
  if (selected.length === 0) return "No completed work selected.";

  return selected
    .map((task) => {
      const result = results.find((entry) => entry.task_id === task.taskId);
      const content = result?.content?.trim();
      return content
        ? `- ${task.title}\n  Saved work: ${clip(content, 600)}`
        : `- ${task.title}`;
    })
    .join("\n");
}

const DRAFT_SYSTEM_PROMPT = [
  "You draft plain text for one person, from work they already did.",
  "Use only the goal and the completed tasks and saved work given below.",
  "Never invent facts, numbers, names, dates, links, quotes or sources. If something is missing, leave it out rather than guessing.",
  "Never address a client, employer or audience the person has not named.",
  "Never claim an external action was taken, and never mention sending, publishing or saving.",
  "Write plain text only: no markdown headings, no code blocks, no bullet characters, no HTML.",
  "Keep it under 300 words and clearly a draft a person can edit.",
].join(" ");

export type DraftContext = {
  goalTitle: string | null;
  instructions: string;
  notes: string;
  selectedWork: string;
  taskTitles: string[];
};

export function buildDraftMessages(context: DraftContext): ChatMessage[] {
  const lines = [
    context.goalTitle ? `Goal: ${context.goalTitle}` : "No goal attached.",
    context.instructions ? `Step notes: ${context.instructions}` : "",
    context.taskTitles.length > 0
      ? `Completed tasks: ${context.taskTitles.join("; ")}`
      : "Completed tasks: none selected.",
    context.selectedWork,
    context.notes ? `What the person wants included: ${clip(context.notes, 1500)}` : "",
    "Write the draft now. It will be shown to the person for editing and approval; nothing is sent by the model.",
  ];

  return [
    { role: "system", content: DRAFT_SYSTEM_PROMPT },
    { role: "user", content: lines.filter(Boolean).join("\n") },
  ];
}

export function normalizeDraft(raw: string): string {
  const text = raw
    .replace(/<[^>]*>/g, " ")
    .replace(/```[a-zA-Z]*\s*/g, "")
    .replace(/```/g, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (text.length <= MAX_DRAFT_LENGTH) return text;
  return `${text.slice(0, MAX_DRAFT_LENGTH).trimEnd()}…`;
}

export function isDraftUsable(text: string): boolean {
  return text.trim().length > 0 && /[a-zA-Z]{2}/.test(text);
}

/** What the person is about to authorize, in the approval card. */
export function approvalPreviewLines(action: Pick<
  ActionRecord,
  "connector" | "destination" | "content"
>): { label: string; value: string }[] {
  return [
    { label: "Connector", value: action.connector },
    { label: "Destination", value: action.destination },
    { label: "Content", value: action.content },
  ];
}

export const SIMULATED_ACTION_NOTE =
  "This action is simulated: the approved text is only recorded here. No external service is contacted, nothing is published, and no money is spent.";

export const WORKFLOW_SCOPE_NOTE =
  "Workflows run only these five step kinds. There is no code execution, no unrestricted HTTP request, no browser control and no background spending.";

export function formatWorkflowTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export function workflowErrorMessage(code: string | undefined): string {
  switch (code) {
    case "unauthenticated":
      return "Your session expired. Sign in again.";
    case "no-workflow":
      return "That workflow isn't available to you.";
    case "no-version":
      return "This workflow has no saved version to run.";
    case "invalid-steps":
      return "The workflow steps aren't valid, so no run was started.";
    case "no-run":
      return "That run isn't available to you.";
    case "not-current":
      return "That step isn't the one waiting. Refresh the page.";
    case "already-succeeded":
      return "That step already succeeded, so nothing was repeated.";
    case "needs-approval":
      return "Approve this exact content before it can run.";
    case "approval-mismatch":
      return "The approval doesn't match this content, connector and destination. Nothing was sent.";
    case "already-executing":
      return "This action has already been started, so it was not started twice.";
    case "retry-blocked":
      return retryRefusalMessage();
    case "no-connector":
      return "That connector isn't available, so no action was attempted.";
    case "cancelled":
      return "This run is cancelled. Start a new run to try again.";
    case "duplicate":
      return "That already happened once, so it was not repeated.";
    default:
      return "That didn't work. Nothing was sent — try again.";
  }
}

/** Compact description of a step for the editor and the run timeline. */
export function describeStep(step: {
  kind: WorkflowStepKind;
  title: string;
  config?: { destination?: string; connector?: string } | null;
}): string {
  const base = `${STEP_KIND_LABELS[step.kind]} — ${step.title}`;
  if (step.kind === "connector_action" && step.config?.destination) {
    return `${base} → ${step.config.destination}`;
  }
  return base;
}
