import type { PlanTask } from "@/lib/ai/plan";
import type { TaskHelpIntent } from "@/lib/ai/task-help";
import type { FocusSnapshot } from "@/lib/types";

export type FormState = {
  status: "idle" | "error" | "success";
  message?: string;
  /** Human-readable time of the last successful save. */
  savedAt?: string;
  /** Content as persisted, used to tell whether the editor has unsaved changes. */
  savedContent?: string;
  /** Changes on every successful submission so forms can reset or re-announce. */
  nonce?: number;
  /** A one-time link to show the person, e.g. an invitation to copy. */
  link?: string;
  /** Legacy allowance field; credit operations use a fixed charge and budget. */
  remaining?: number;
};

export const idleFormState: FormState = { status: "idle" };

export type AuthState = {
  status: "idle" | "error" | "success";
  message?: string;
};

export const idleAuthState: AuthState = { status: "idle" };

export type AiHelpState = {
  status: "idle" | "error" | "success";
  message?: string;
  /** Model reply text, exactly as Ollama sent it. */
  answer?: string;
  /** Model id that actually answered. */
  model?: string;
  /** Legacy allowance field; credit operations use a fixed charge and budget. */
  remaining?: number;
  nonce?: number;
};

export const idleAiHelpState: AiHelpState = { status: "idle" };

export type PlanState = {
  /**
   * idle    — nothing asked yet
   * clarify — the model needs one to three answers before it can plan
   * preview — a validated plan awaits review; nothing is saved
   * saved   — the approved plan became real tasks
   * error   — anything that stopped the request; existing plans stay put
   */
  status: "idle" | "clarify" | "preview" | "saved" | "error";
  message?: string;
  questions?: string[];
  tasks?: PlanTask[];
  /** Fingerprint of the goal at preview time, used to reject stale saves. */
  snapshot?: string;
  /** Idempotency key for this preview, so a double submit saves one plan. */
  planId?: string;
  model?: string;
  remaining?: number;
  savedCount?: number;
  nonce?: number;
};

export const idlePlanState: PlanState = { status: "idle" };

export type TaskAiState = {
  /**
   * idle       — nothing asked yet
   * suggestion — a usable answer is waiting for accept, edit or reject
   * error      — the request failed; the editor is untouched
   */
  status: "idle" | "suggestion" | "error";
  message?: string;
  /** Plain text from the model, already stripped of markup. Never saved yet. */
  text?: string;
  intent?: TaskHelpIntent;
  model?: string;
  /** Legacy allowance field; credit operations use a fixed charge and budget. */
  remaining?: number;
  nonce?: number;
};

export const idleTaskAiState: TaskAiState = { status: "idle" };

export type FocusState = {
  status: "idle" | "updated" | "error";
  message?: string;
  /** The server's own view of the timer after the change. */
  snapshot?: FocusSnapshot;
  nonce?: number;
};

export const idleFocusState: FocusState = { status: "idle" };

export type DailyPlanState = {
  /**
   * idle    — nothing approved yet
   * warning — the selection is longer than the time given; nothing saved
   * saved   — the selection is now the approved plan for that day
   * error   — the request failed; the previous plan is untouched
   */
  status: "idle" | "warning" | "saved" | "error";
  message?: string;
  totalMinutes?: number;
  unknownEstimates?: number;
  plan?: import("@/lib/types").DailyPlan;
  nonce?: number;
};

export const idleDailyPlanState: DailyPlanState = { status: "idle" };

export type LearningPlanState = {
  status: "idle" | "saved" | "error";
  message?: string;
  planId?: string;
  remaining?: number;
  nonce?: number;
};

export const idleLearningPlanState: LearningPlanState = { status: "idle" };

export type LearningHelpState = {
  status: "idle" | "suggestion" | "error";
  message?: string;
  /** Plain text from the model. Never saved until the person chooses to. */
  text?: string;
  intent?: string;
  model?: string;
  remaining?: number;
  nonce?: number;
};

export const idleLearningHelpState: LearningHelpState = { status: "idle" };

export type ImportState = {
  /**
   * idle     — nothing chosen yet
   * preview  — the file validated and nothing has been written
   * imported — the plan was applied; existing work was never overwritten
   * error    — validation or writing stopped; the account is unchanged
   */
  status: "idle" | "preview" | "imported" | "error";
  message?: string;
  preview?: import("@/lib/import").ImportPreview;
  planHash?: string;
  filename?: string;
  imported?: {
    goals: number;
    tasks: number;
    savedResults: number;
    reflections: number;
    preferences: boolean;
  };
  skippedCount?: number;
  rejectedCount?: number;
  nonce?: number;
};

export const idleImportState: ImportState = { status: "idle" };

export type FuturePathState = {
  status: "idle" | "error" | "success";
  message?: string;
  /** Legacy allowance field; credit operations use a fixed charge and budget. */
  remaining?: number;
  nonce?: number;
};

export const idleFuturePathState: FuturePathState = { status: "idle" };

export type ReviewState = {
  status: "idle" | "error" | "success";
  message?: string;
  remaining?: number;
  nonce?: number;
};

export const idleReviewState: ReviewState = { status: "idle" };

export type RadarState = {
  status: "idle" | "error" | "success";
  message?: string;
  nonce?: number;
};

export const idleRadarState: RadarState = { status: "idle" };

export type MissionState = {
  status: "idle" | "error" | "success";
  message?: string;
  /** Legacy allowance field; credit operations use a fixed charge and budget. */
  remaining?: number;
  nonce?: number;
};

export const idleMissionState: MissionState = { status: "idle" };

export type ExperimentState = {
  status: "idle" | "error" | "success";
  message?: string;
  nonce?: number;
};

export const idleExperimentState: ExperimentState = { status: "idle" };

export type OrchestrationState = {
  status: "idle" | "error" | "success";
  message?: string;
  nonce?: number;
};

export const idleOrchestrationState: OrchestrationState = { status: "idle" };

export type OutcomeState = {
  status: "idle" | "error" | "success";
  message?: string;
  nonce?: number;
};

export const idleOutcomeState: OutcomeState = { status: "idle" };

export type BuildState = {
  status: "idle" | "error" | "success";
  message?: string;
  /** A short-lived preview link. Never a platform credential. */
  link?: string;
  /** Legacy allowance field; credit operations use a fixed charge and budget. */
  remaining?: number;
  nonce?: number;
};

export const idleBuildState: BuildState = { status: "idle" };
