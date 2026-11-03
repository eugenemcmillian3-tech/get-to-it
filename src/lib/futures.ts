/**
 * Future Paths: the contract between GET TO IT and the model.
 *
 * The point of this feature is not to predict anything. It explores three
 * plausible futures for a decision the person is actually weighing, and shows
 * the assumptions and evidence behind every line:
 *
 *   * exactly three scenarios: favorable conditions, expected working
 *     assumptions and difficult conditions;
 *   * the middle scenario is never called likely, statistically or otherwise;
 *   * every item carries an evidence label, and a "retrieved fact" is only kept
 *     when its source URL was typed by the person. This build performs no
 *     retrieval, so in practice the exercise is labelled assumption-based;
 *   * percentages, probabilities, guarantees and predictions are removed from
 *     generated text instead of being shown as if they were evidence;
 *   * no financial, medical or legal decision is made for the person.
 *
 * Everything here is pure, so it is tested with fixtures and no model call.
 */

import { z } from "zod";
import type { ChatMessage } from "@/lib/ai/ollama";
import { extractJsonObject } from "@/lib/ai/plan";
import { clip } from "@/lib/format";

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export const HORIZONS = [
  { value: "3_months", label: "3 months", months: 3 },
  { value: "6_months", label: "6 months", months: 6 },
  { value: "1_year", label: "1 year", months: 12 },
  { value: "2_years", label: "2 years", months: 24 },
  { value: "5_years", label: "5 years", months: 60 },
] as const;

export type Horizon = (typeof HORIZONS)[number]["value"];

export const HORIZON_VALUES = HORIZONS.map((horizon) => horizon.value) as [
  Horizon,
  ...Horizon[],
];

export function horizonLabel(value: string): string {
  return HORIZONS.find((horizon) => horizon.value === value)?.label ?? value;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_DECISION = 200;
export const MAX_LONG_INPUT = 2000;
export const MAX_SUCCESS = 1000;
export const MAX_EVIDENCE_TEXT = 400;
export const MAX_ITEMS_PER_LIST = 10;
export const MAX_SCENARIO_TITLE = 120;
export const MAX_RATIONALE = 4000;

export const futurePathInputSchema = z.object({
  goal_id: z.union([z.string().trim().regex(UUID_PATTERN), z.literal("")]).default(""),
  decision: z
    .string()
    .trim()
    .min(3, "Say which decision or goal you are exploring.")
    .max(MAX_DECISION, "Keep the decision under 200 characters."),
  horizon: z.enum(HORIZON_VALUES),
  resources: z
    .string()
    .trim()
    .max(MAX_LONG_INPUT, "Keep this under 2000 characters.")
    .default(""),
  constraints: z
    .string()
    .trim()
    .max(MAX_LONG_INPUT, "Keep this under 2000 characters.")
    .default(""),
  success_definition: z
    .string()
    .trim()
    .min(3, "Describe what success would mean to you.")
    .max(MAX_SUCCESS, "Keep this under 1000 characters."),
  uncertainties: z
    .string()
    .trim()
    .max(MAX_LONG_INPUT, "Keep this under 2000 characters.")
    .default(""),
});

export type FuturePathInput = z.infer<typeof futurePathInputSchema>;

// ---------------------------------------------------------------------------
// Scenarios and evidence labels
// ---------------------------------------------------------------------------

export const SCENARIO_KINDS = ["favorable", "expected", "difficult"] as const;
export type ScenarioKind = (typeof SCENARIO_KINDS)[number];

export const SCENARIO_LABELS: Record<ScenarioKind, string> = {
  favorable: "Favorable conditions",
  expected: "Expected working assumptions",
  difficult: "Difficult conditions",
};

export const SCENARIO_NOTES: Record<ScenarioKind, string> = {
  favorable: "What would have to go right, and what it would look like if it did.",
  expected:
    "Ordinary working assumptions. Not a forecast, and not the most likely outcome.",
  difficult: "What could get in the way, and how you would notice early.",
};

export const EVIDENCE_LABELS = [
  "user",
  "retrieved",
  "assumption",
  "ai",
  "unknown",
] as const;

export type EvidenceLabel = (typeof EVIDENCE_LABELS)[number];

export const EVIDENCE_LABEL_TEXT: Record<EvidenceLabel, string> = {
  user: "You provided",
  retrieved: "Retrieved fact",
  assumption: "Assumption",
  ai: "AI-generated possibility",
  unknown: "Unknown",
};

export const EVIDENCE_LABEL_HINTS: Record<EvidenceLabel, string> = {
  user: "Typed by you in this workspace.",
  retrieved: "A fact with a source you supplied. Never invented.",
  assumption: "Something the scenario needs to be true.",
  ai: "A possibility the model suggested, not a fact.",
  unknown: "Nobody knows this yet.",
};

export type EvidenceItem = {
  text: string;
  label: EvidenceLabel;
  /** Only ever present for `retrieved`, and only a URL the person supplied. */
  source_url: string | null;
};

export const SCENARIO_LIST_FIELDS = [
  "assumptions",
  "developments",
  "opportunities",
  "risks",
  "signals",
  "actions",
  "first_steps",
  "change_conditions",
] as const;

export type ScenarioListField = (typeof SCENARIO_LIST_FIELDS)[number];

export const LIST_FIELD_LABELS: Record<ScenarioListField, string> = {
  assumptions: "Starting assumptions",
  developments: "Possible developments",
  opportunities: "Opportunities",
  risks: "Risks",
  signals: "Early signals to watch",
  actions: "Actions useful in every scenario",
  first_steps: "Reversible first steps",
  change_conditions: "Conditions that would justify changing course",
};

export const LIST_FIELD_HINTS: Record<ScenarioListField, string> = {
  assumptions: "What has to be true for this scenario to hold.",
  developments: "Ways events could unfold. Not predictions.",
  opportunities: "Upside worth noticing if this happens.",
  risks: "Downside worth preparing for.",
  signals: "What you could observe early that this is happening.",
  actions: "Worth doing whichever scenario turns out.",
  first_steps: "Small moves you can undo.",
  change_conditions: "Facts that would make a different choice sensible.",
};

export const LIST_FIELD_MIN: Record<ScenarioListField, number> = {
  assumptions: 2,
  developments: 2,
  opportunities: 2,
  risks: 2,
  signals: 2,
  actions: 2,
  first_steps: 2,
  change_conditions: 2,
};

export type ScenarioLists = Record<ScenarioListField, EvidenceItem[]>;

export type ScenarioDraft = {
  kind: ScenarioKind;
  title: string;
} & ScenarioLists;

export const ASSUMPTION_BASED_NOTE =
  "No research tool is connected, so this is an assumption-based exercise. Nothing here was retrieved or fact-checked.";

export const NO_PREDICTION_NOTE =
  "These are three possible futures, not predictions. They are not probabilities, and none of them is guaranteed.";

export const EXPECTED_SCENARIO_NOTE =
  "The expected scenario describes ordinary working assumptions. It is not statistically most likely, and no model or evidence was used to rank the three.";

export const EVIDENCE_SEPARATION_NOTE =
  "Each line is labelled: what you provided, a retrieved fact with a source you supplied, an assumption, an AI-generated possibility, or an unknown.";

export const NO_HIGH_STAKES_NOTE =
  "Future Paths does not make financial, medical or legal decisions for you. Treat it as thinking support, and check anything consequential with a qualified person.";

/** True when any label was dropped because it claimed a source it does not have. */
export type SanitizeCounts = {
  claims: number;
  sources: number;
};

// ---------------------------------------------------------------------------
// Probability and invented-source removal
// ---------------------------------------------------------------------------

/**
 * Claims that must never reach the page: percentages, explicit probabilities,
 * "most likely", guarantees and predictions. Only applied to generated text;
 * the person's own input is never rewritten.
 */
const UNSUPPORTED_CLAIM =
  /\b\d{1,3}(?:\.\d+)?\s?%|\bprobabilit(?:y|ies)\b|\bmost likely\b|\bguarantee(?:d|s)?\b|\bpredict(?:s|ed|ion|ions|ing)?\b/i;

export function hasUnsupportedClaim(text: string): boolean {
  return UNSUPPORTED_CLAIM.test(text);
}

/** Source URLs the person actually typed. Nothing else can be a source. */
export function allowedSourceUrls(input: {
  decision: string;
  resources: string;
  constraints: string;
  success_definition: string;
  uncertainties: string;
}): Set<string> {
  const text = [
    input.decision,
    input.resources,
    input.constraints,
    input.success_definition,
    input.uncertainties,
  ].join("\n");

  const found = text.match(/https?:\/\/[^\s<>"')]+/gi) ?? [];

  return new Set(
    found.map((url) =>
      url.replace(/[.,;:!?]+$/, "").trim().toLowerCase(),
    ),
  );
}

function normalizeSource(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const url = value.trim().replace(/[.,;:!?]+$/, "").toLowerCase();
  return url === "" ? null : url;
}

/**
 * Cleans one list from the model:
 *   * a `retrieved` item survives only with an allowed source URL;
 *   * percentages, probabilities and predictions are removed from generated
 *     text, never shown;
 *   * duplicates and empty lines disappear;
 *   * a label outside the five supported ones is treated as AI-generated.
 */
export function sanitizeEvidence(
  rawItems: unknown,
  allowedUrls: Set<string>,
): { items: EvidenceItem[]; dropped: SanitizeCounts } {
  const items: EvidenceItem[] = [];
  const seen = new Set<string>();
  const dropped: SanitizeCounts = { claims: 0, sources: 0 };

  if (!Array.isArray(rawItems)) return { items, dropped };

  for (const raw of rawItems.slice(0, MAX_ITEMS_PER_LIST * 2)) {
    if (typeof raw !== "object" || raw === null) continue;
    const record = raw as { text?: unknown; label?: unknown; source_url?: unknown };

    const text = clip(
      String(record.text ?? "")
        .replace(/<[^>]*>/g, " ")
        .replace(/[*_`#]/g, "")
        .replace(/\s+/g, " ")
        .trim(),
      MAX_EVIDENCE_TEXT,
    );

    if (text.length < 3) continue;

    const label: EvidenceLabel = (EVIDENCE_LABELS as readonly string[]).includes(
      String(record.label),
    )
      ? (record.label as EvidenceLabel)
      : "ai";

    let source: string | null = null;

    if (label === "retrieved") {
      source = normalizeSource(record.source_url);
      if (!source || !allowedUrls.has(source)) {
        dropped.sources += 1;
        continue;
      }
    }

    if (label !== "user" && hasUnsupportedClaim(text)) {
      dropped.claims += 1;
      continue;
    }

    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    items.push({ text, label, source_url: source });
    if (items.length === MAX_ITEMS_PER_LIST) break;
  }

  return { items, dropped };
}

// ---------------------------------------------------------------------------
// Reply parsing
// ---------------------------------------------------------------------------

const rawEvidenceSchema = z
  .object({
    text: z.string().max(MAX_EVIDENCE_TEXT * 2),
    label: z.string().max(40).optional(),
    source_url: z.string().max(500).optional(),
  })
  .passthrough();

const rawScenarioSchema = z
  .object({
    kind: z.enum(SCENARIO_KINDS),
    title: z.string().trim().max(MAX_SCENARIO_TITLE).optional(),
    assumptions: z.array(rawEvidenceSchema).max(MAX_ITEMS_PER_LIST * 2),
    developments: z.array(rawEvidenceSchema).max(MAX_ITEMS_PER_LIST * 2),
    opportunities: z.array(rawEvidenceSchema).max(MAX_ITEMS_PER_LIST * 2),
    risks: z.array(rawEvidenceSchema).max(MAX_ITEMS_PER_LIST * 2),
    signals: z.array(rawEvidenceSchema).max(MAX_ITEMS_PER_LIST * 2),
    actions: z.array(rawEvidenceSchema).max(MAX_ITEMS_PER_LIST * 2),
    first_steps: z.array(rawEvidenceSchema).max(MAX_ITEMS_PER_LIST * 2),
    change_conditions: z.array(rawEvidenceSchema).max(MAX_ITEMS_PER_LIST * 2),
  })
  .passthrough();

const rawReplySchema = z
  .object({ scenarios: z.array(rawScenarioSchema).min(3).max(3) })
  .passthrough();

export type ScenarioParseResult =
  | { kind: "scenarios"; scenarios: ScenarioDraft[]; dropped: SanitizeCounts }
  | { kind: "invalid"; reason: string };

/**
 * Validates a whole model reply. All three scenarios must be present exactly
 * once, and every list has to survive cleanup with at least the minimum number
 * of items. A partly usable reply is rejected rather than shown half-empty.
 */
export function parseScenarioReply(
  raw: string,
  allowedUrls: Set<string>,
): ScenarioParseResult {
  const object = extractJsonObject(raw);
  if (!object) return { kind: "invalid", reason: "unreadable-json" };

  const parsed = rawReplySchema.safeParse(object);
  if (!parsed.success) return { kind: "invalid", reason: "bad-scenario-shape" };

  const scenarios: ScenarioDraft[] = [];
  const dropped: SanitizeCounts = { claims: 0, sources: 0 };
  const kinds = new Set<ScenarioKind>();

  for (const candidate of parsed.data.scenarios) {
    if (kinds.has(candidate.kind)) {
      return { kind: "invalid", reason: "duplicate-kind" };
    }
    kinds.add(candidate.kind);

    const lists = {} as ScenarioLists;

    for (const field of SCENARIO_LIST_FIELDS) {
      const cleaned = sanitizeEvidence(candidate[field], allowedUrls);
      dropped.claims += cleaned.dropped.claims;
      dropped.sources += cleaned.dropped.sources;

      if (cleaned.items.length < LIST_FIELD_MIN[field]) {
        return { kind: "invalid", reason: `too-few-${field.replace(/_/g, "-")}` };
      }

      lists[field] = cleaned.items;
    }

    if (!lists.assumptions.some((item) => item.label !== "user")) {
      return { kind: "invalid", reason: "no-stated-assumptions" };
    }

    scenarios.push({
      kind: candidate.kind,
      title: clip(
        candidate.title?.trim() || SCENARIO_LABELS[candidate.kind],
        MAX_SCENARIO_TITLE,
      ),
      ...lists,
    });
  }

  if (kinds.size !== SCENARIO_KINDS.length) {
    return { kind: "invalid", reason: "missing-kind" };
  }

  return {
    kind: "scenarios",
    scenarios: SCENARIO_KINDS.map(
      (kind) => scenarios.find((scenario) => scenario.kind === kind)!,
    ),
    dropped,
  };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  "You help one person think through a decision by sketching three plausible futures.",
  "You are not predicting the future and you must not imply that you can.",
  "Reply with exactly three scenarios: kind favorable, kind expected and kind difficult, in that order.",
  "The expected scenario is ordinary working assumptions only. Never call it likely, most likely, probable, statistically expected or the baseline forecast.",
  "Never include a percentage, probability, odds, score, guarantee or prediction anywhere.",
  "Never invent sources, citations, links, statistics, studies, prices, names or dates.",
  'Every item is an object: {"text": "...", "label": "...", "source_url": ""}.',
  "label is one of: user, retrieved, assumption, ai, unknown.",
  "Use user only for something the person typed. Use assumption for what the scenario needs to be true. Use ai for a possibility you suggest. Use unknown when nobody knows yet.",
  "Use retrieved only when the person's own text contains the exact URL you cite, and put that URL in source_url. Otherwise never use retrieved and never invent a source.",
  "Do not make financial, medical or legal decisions, and do not tell them what they should do.",
  "Keep every text under 300 characters, concrete and short.",
  "Lists per scenario: assumptions, developments, opportunities, risks, signals, actions, first_steps, change_conditions. Give two to five items in each.",
  "assumptions must contain at least one non-user item. first_steps must be small and reversible. change_conditions must be observable facts that would justify changing course.",
  "Reply with JSON only: no prose, no markdown, no code fences.",
  'Shape: {"scenarios": [{"kind": "favorable", "title": "...", "assumptions": [{"text": "...", "label": "assumption", "source_url": ""}], "developments": [], "opportunities": [], "risks": [], "signals": [], "actions": [], "first_steps": [], "change_conditions": []}]}',
].join(" ");

export function buildScenarioMessages(input: FuturePathInput): ChatMessage[] {
  const lines = [
    `Decision or goal: ${input.decision}`,
    `Time horizon: ${horizonLabel(input.horizon)}`,
    input.resources ? `Available resources: ${input.resources}` : "Available resources: not stated.",
    input.constraints ? `Constraints: ${input.constraints}` : "Constraints: not stated.",
    `What success means to them: ${input.success_definition}`,
    input.uncertainties
      ? `What they are uncertain about: ${input.uncertainties}`
      : "What they are uncertain about: not stated.",
    "No research tool is connected for this request. Do not use the retrieved label unless their text above contains the exact URL.",
    "Return the JSON now.",
  ];

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: lines.join("\n") },
  ];
}

// ---------------------------------------------------------------------------
// Editing, comparing and converting actions
// ---------------------------------------------------------------------------

/** One item per line, which is how the editor shows a list. */
export function listToLines(items: EvidenceItem[]): string {
  return items.map((item) => item.text).join("\n");
}

/**
 * Rebuilds a list after the person edited it. Lines they did not change keep
 * their label and source; new or rewritten lines are labelled `user`, because
 * the person is now the one asserting them.
 */
export function relabelEditedLines(
  previous: EvidenceItem[],
  lines: string[],
): EvidenceItem[] {
  const byText = new Map(previous.map((item) => [item.text.toLowerCase(), item]));
  const seen = new Set<string>();

  return lines
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 3)
    .slice(0, MAX_ITEMS_PER_LIST)
    .map((text) => {
      const clipped = clip(text, MAX_EVIDENCE_TEXT);
      const key = clipped.toLowerCase();
      if (seen.has(key)) return null;
      seen.add(key);

      const old = byText.get(key);
      if (old) return old;

      return { text: clipped, label: "user" as const, source_url: null };
    })
    .filter((item): item is EvidenceItem => item !== null);
}

export type CompareRow = {
  field: ScenarioListField;
  label: string;
  values: Record<ScenarioKind, EvidenceItem[]>;
};

const EMPTY_ROW: Record<ScenarioKind, EvidenceItem[]> = {
  favorable: [],
  expected: [],
  difficult: [],
};

/** Side-by-side comparison, always in the same order, with no ranking. */
export function compareRows(scenarios: ScenarioDraft[]): CompareRow[] {
  return SCENARIO_LIST_FIELDS.map((field) => {
    const values: Record<ScenarioKind, EvidenceItem[]> = { ...EMPTY_ROW };

    for (const kind of SCENARIO_KINDS) {
      values[kind] = scenarios.find((scenario) => scenario.kind === kind)?.[field] ?? [];
    }

    return { field, label: LIST_FIELD_LABELS[field], values };
  });
}

export function evidenceCounts(items: EvidenceItem[]): Record<EvidenceLabel, number> {
  const counts: Record<EvidenceLabel, number> = {
    user: 0,
    retrieved: 0,
    assumption: 0,
    ai: 0,
    unknown: 0,
  };

  for (const item of items) counts[item.label] += 1;
  return counts;
}

export function allEvidence(scenario: ScenarioDraft): EvidenceItem[] {
  return SCENARIO_LIST_FIELDS.flatMap((field) => scenario[field]);
}

/** A task title has to stay short; the person can edit it afterwards. */
export function actionTaskTitle(text: string): string {
  return clip(text.replace(/\s+/g, " ").trim(), 200);
}

/**
 * Instructions for a converted task. They say where the action came from, and
 * never claim it is required or that the scenario is a prediction.
 */
export function actionTaskInstructions(decision: string, kind: ScenarioKind): string {
  return clip(
    `One action from the "${SCENARIO_LABELS[kind]}" scenario of your future path "${decision}". It was chosen as useful across scenarios, not as a prediction. Change or delete this task freely.`,
    1000,
  );
}

export const rationaleSchema = z.object({
  chosen_kind: z.union([z.enum(SCENARIO_KINDS), z.literal("")]).default(""),
  rationale: z
    .string()
    .trim()
    .max(MAX_RATIONALE, "Keep the rationale under 4000 characters.")
    .default(""),
  review_at: z
    .union([
      z.literal(""),
      z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2027-03-14."),
    ])
    .default(""),
});

export type RationaleInput = z.infer<typeof rationaleSchema>;

export function isFutureReviewDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime());
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function formatFutureDay(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function futurePathErrorMessage(code: string | undefined): string {
  switch (code) {
    case "unauthenticated":
      return "Your session expired. Sign in again.";
    case "unusable":
      return "The reply wasn't a usable set of three scenarios, so nothing was saved. Try again.";
    case "no-path":
      return "That future path isn't available to you.";
    case "no-goal":
      return "Choose one of your own goals before adding an action as a task.";
    case "no-action":
      return "That action isn't in this future path any more. Refresh the page.";
    default:
      return "That didn't work. Nothing was changed — try again.";
  }
}
