/**
 * Credit pricing. Pure functions and constants only, so the browser, server
 * actions and tests use exactly the same numbers.
 *
 * A credit is retail value, not a token count. The approved operation prices
 * are fixed per call; the provider-cost draft lives in RATE_CARD_DRAFT.md.
 */

import { formatCredits, formatUsd } from "./format";

/** Retail value of one credit in US cents. */
export const CREDIT_VALUE_CENTS = 10;

/** Display form of the retail credit value. */
export const CREDIT_VALUE_LABEL = formatUsd(CREDIT_VALUE_CENTS);

export type AiOperation =
  | "unstuck"
  | "plan"
  | "task_help"
  | "learning"
  | "learning_help"
  | "workflow_draft"
  | "future_paths"
  | "review"
  | "mission_assist"
  | "app_repair"
  | "team_task";

export type AiOperationPrice = {
  kind: AiOperation;
  label: string;
  credits: number;
  note: string;
};

/** The approved customer-facing operation prices. */
export const AI_OPERATION_PRICES: AiOperationPrice[] = [
  { kind: "unstuck", label: "Goal help", credits: 1, note: "One suggestion from a goal." },
  { kind: "plan", label: "Goal plan", credits: 1, note: "A plan or clarifying questions." },
  { kind: "task_help", label: "Task help", credits: 1, note: "Start, explain, draft or review a task." },
  { kind: "learning", label: "Learning path", credits: 1, note: "A learning path for one topic." },
  { kind: "learning_help", label: "Learning step help", credits: 1, note: "Help with one learning step." },
  { kind: "workflow_draft", label: "Workflow draft", credits: 1, note: "One AI draft step in a workflow run." },
  { kind: "future_paths", label: "Future paths", credits: 1, note: "Three possible futures for a decision." },
  { kind: "review", label: "Review perspective", credits: 1, note: "One perspective in a multi-perspective review." },
  { kind: "mission_assist", label: "Mission assist", credits: 1, note: "One suggestion for a mission." },
  { kind: "app_repair", label: "Build repair attempt", credits: 2, note: "One AI repair proposal for a failing build." },
  { kind: "team_task", label: "Agent team task", credits: 2, note: "One model-backed task in a bounded agent-team run." },
];

/** Database-authoritative prices, mirrored here for estimates and tests. */
export const AI_OPERATION_CREDIT_COSTS: Record<AiOperation, number> = {
  unstuck: 1,
  plan: 1,
  task_help: 1,
  learning: 1,
  learning_help: 1,
  workflow_draft: 1,
  future_paths: 1,
  review: 1,
  mission_assist: 1,
  app_repair: 2,
  team_task: 2,
};

export const BUILD_REPAIR_CREDITS = AI_OPERATION_CREDIT_COSTS.app_repair;
export const BUILD_MAX_CREDITS = 6;
export const WORKFLOW_MAX_CREDITS = 10;
/** Six tasks at two credits each is the default, with room for a re-run. */
export const SWARM_MAX_CREDITS = 48;
export const TEAM_TASK_CREDITS = AI_OPERATION_CREDIT_COSTS.team_task;

export function operationCreditCost(kind: string): number {
  return AI_OPERATION_CREDIT_COSTS[kind as AiOperation] ?? 1;
}

export function operationLabel(kind: string): string {
  return AI_OPERATION_PRICES.find((operation) => operation.kind === kind)?.label ?? kind;
}

/** Example: `1 credit ($0.10)`. */
export function operationChargeLabel(kind: string): string {
  const credits = operationCreditCost(kind);
  return `${formatCredits(credits)} (${formatUsd(credits * CREDIT_VALUE_CENTS)})`;
}

export type CreditPackDefinition = {
  slug: string;
  credits: number;
  amount_cents: number;
  label: string;
  sort_order: number;
};

/** The five packs in the pricing decision. The database remains the source. */
export const CREDIT_PACK_DEFINITIONS: CreditPackDefinition[] = [
  { slug: "starter", credits: 50, amount_cents: 500, label: "50 credits", sort_order: 1 },
  { slug: "steady", credits: 100, amount_cents: 1000, label: "100 credits", sort_order: 2 },
  { slug: "deep", credits: 250, amount_cents: 2500, label: "250 credits", sort_order: 3 },
  { slug: "builder", credits: 500, amount_cents: 5000, label: "500 credits", sort_order: 4 },
  { slug: "studio", credits: 1000, amount_cents: 10000, label: "1,000 credits", sort_order: 5 },
];

export function creditsToCents(credits: number): number {
  if (!Number.isFinite(credits)) return 0;
  return Math.trunc(credits) * CREDIT_VALUE_CENTS;
}

/** Example: `50 credits ($5.00)`. */
export function formatCreditsWithUsd(credits: number): string {
  return `${formatCredits(credits)} (${formatUsd(creditsToCents(credits))})`;
}

/** Short note under an AI control once credits exist. */
export function creditNote(balance: number): string | null {
  if (balance > 0) {
    return `${formatCredits(balance)} available (${formatUsd(
      creditsToCents(balance),
    )}).`;
  }

  return "No credits available. AI work needs credits; everything you've saved is still here.";
}
