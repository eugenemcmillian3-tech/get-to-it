/**
 * Think it through: bounded, sequential review perspectives.
 *
 * This is deliberately not an agent swarm. A review has exactly five stages,
 * each one model call started by the person, with a shared record and no
 * delegation, tools or external actions. The rules encoded here:
 *
 *   * five fixed perspectives, five calls at most, one at a time;
 *   * every stage reads the same question, context, sources, constraints and
 *     priorities, plus the earlier stages' saved outputs for the synthesizer;
 *   * explanations are concise and labelled; the app never claims to expose a
 *     model's hidden internal reasoning;
 *   * five answers from one model are not five independent sources, and repeated
 *     agreement is never counted as evidence;
 *   * the person can cancel between stages, reject the recommendation and record
 *     their own decision without an argument.
 *
 * Everything here is pure, so call limits, sequencing, parsing and partial
 * failures are tested with fixtures and no model call.
 */

import { z } from "zod";
import type { ChatMessage } from "@/lib/ai/ollama";
import { extractJsonObject } from "@/lib/ai/plan";
import { clip } from "@/lib/format";

export const PERSPECTIVES = [
  "planner",
  "critic",
  "research",
  "human_impact",
  "synthesizer",
] as const;

export type Perspective = (typeof PERSPECTIVES)[number];

export const PERSPECTIVE_LABELS: Record<Perspective, string> = {
  planner: "Planner",
  critic: "Critic",
  research: "Research reviewer",
  human_impact: "Human-impact reviewer",
  synthesizer: "Synthesizer",
};

export const PERSPECTIVE_QUESTIONS: Record<Perspective, string> = {
  planner: "How could this work?",
  critic: "What could fail?",
  research: "What evidence is missing?",
  human_impact: "Who could benefit or be harmed?",
  synthesizer: "What choices and trade-offs remain?",
};

export const PERSPECTIVE_NOTES: Record<Perspective, string> = {
  planner: "The most plausible path from here, and what it depends on.",
  critic: "Ways this fails, and what would make the failure visible early.",
  research: "Which claims rest on nothing, and what would test them.",
  human_impact: "Who gains, who carries the cost, and who was not considered.",
  synthesizer: "The live choices and trade-offs once the other four are read.",
};

/** Hard cap. One stage, one call; the synthesizer adds no extra call. */
export const MAX_REVIEW_REQUESTS = 5;

export const MAX_QUESTION = 500;
export const MAX_CONTEXT = 4000;
export const MAX_CONSTRAINTS = 2000;
export const MAX_PRIORITIES = 8;
export const MAX_PRIORITY_LENGTH = 80;
export const MAX_SOURCES = 8;
export const MAX_ITEMS = 6;
export const MAX_ITEM_TEXT = 500;
export const MAX_SUMMARY = 900;
export const MAX_DECISION = 4000;
export const MAX_CHOSEN_OPTION = 200;

export const USAGE_NOTE = `A review makes at most ${MAX_REVIEW_REQUESTS} AI requests: one per perspective, and you start each one. Each request counts against your daily allowance or credits. You can stop between stages.`;

export const TRANSPARENCY_NOTE =
  "Each perspective shows a concise written explanation, its assumptions and the evidence it cites. That is the model's summary of its answer, not its hidden internal reasoning — no such reasoning is exposed or claimed.";

export const SAME_MODEL_NOTE =
  "All five perspectives are answered by the same model in separate calls. Agreement between them is repeated output, not independent evidence, and it is never counted as corroboration.";

export const NO_TOOLS_NOTE =
  "This review has no search, no tools, no delegation and no external actions. Sources are only the ones you supplied.";

export const CANCELLATION_NOTE =
  "Cancelling stops the review between stages. Stages already finished stay readable; nothing further is requested.";

// ---------------------------------------------------------------------------
// Shared record
// ---------------------------------------------------------------------------

export type ReviewSource = { title: string; url: string };

export const reviewInputSchema = z.object({
  question: z
    .string()
    .trim()
    .min(5, "Say which decision you want to think through.")
    .max(MAX_QUESTION, "Keep the question under 500 characters."),
  context: z
    .string()
    .trim()
    .max(MAX_CONTEXT, "Keep the context under 4000 characters.")
    .default(""),
  constraints: z
    .string()
    .trim()
    .max(MAX_CONSTRAINTS, "Keep the constraints under 2000 characters.")
    .default(""),
  priorities: z
    .array(z.string().trim().min(1).max(MAX_PRIORITY_LENGTH))
    .max(MAX_PRIORITIES)
    .default([]),
  sources: z
    .array(
      z.object({
        title: z.string().trim().max(120).default(""),
        url: z.string().trim().url("Use a full http or https link.").max(500),
      }),
    )
    .max(MAX_SOURCES)
    .default([]),
});

export type ReviewInput = z.infer<typeof reviewInputSchema>;

/** One priority per line, or comma-separated. Bounded and de-duplicated. */
export function parsePriorities(raw: string): string[] {
  const seen = new Set<string>();
  const priorities: string[] = [];

  for (const part of raw.split(/[\n,]+/)) {
    const label = part.replace(/\s+/g, " ").trim().slice(0, MAX_PRIORITY_LENGTH);
    if (label === "") continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    priorities.push(label);
    if (priorities.length === MAX_PRIORITIES) break;
  }

  return priorities;
}

export type SourceParse = {
  sources: ReviewSource[];
  invalid: string[];
};

/**
 * Sources are typed by the person, one per line: `Title | https://…` or just a
 * URL. The app never fetches them, and anything that is not a full http(s) link
 * is reported rather than silently dropped.
 */
export function parseSources(raw: string): SourceParse {
  const sources: ReviewSource[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    const separator = trimmed.lastIndexOf("|");
    const title = separator >= 0 ? trimmed.slice(0, separator).trim() : "";
    const url = (separator >= 0 ? trimmed.slice(separator + 1) : trimmed).trim();

    if (!/^https?:\/\/\S+$/i.test(url)) {
      invalid.push(trimmed.slice(0, 120));
      continue;
    }

    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    sources.push({ title: title.slice(0, 120), url: url.slice(0, 500) });
    if (sources.length === MAX_SOURCES) break;
  }

  return { sources, invalid };
}

export function allowedSourceUrls(sources: ReviewSource[]): Set<string> {
  return new Set(sources.map((source) => source.url.trim().toLowerCase()));
}

// ---------------------------------------------------------------------------
// Stage output
// ---------------------------------------------------------------------------

const basisValues = ["user_source", "context", "assumption", "unknown", "ai_hypothesis"] as const;
export type EvidenceBasis = (typeof basisValues)[number];

export const EVIDENCE_BASIS_LABELS: Record<EvidenceBasis, string> = {
  user_source: "From a source you supplied",
  context: "From the context you wrote",
  assumption: "Assumption",
  unknown: "Unknown",
  ai_hypothesis: "Model's hypothesis",
};

export type ReviewEvidence = {
  text: string;
  basis: EvidenceBasis;
  source_url: string | null;
};

export type ReviewOption = { title: string; description: string };

export type ReviewExperiment = {
  title: string;
  steps: string[];
  success_signal: string;
  stop_signal: string;
};

export type ReviewStageOutput = {
  summary: string;
  assumptions: string[];
  options: ReviewOption[];
  evidence: ReviewEvidence[];
  counterarguments: string[];
  disagreements: string[];
  missing_info: string[];
  experiment: ReviewExperiment | null;
  questions: string[];
  tradeoffs: string[];
  recommendation: string | null;
};

const rawEvidenceSchema = z.object({
  text: z.string().trim().min(3).max(700),
  basis: z.enum(basisValues).default("ai_hypothesis"),
  source_url: z.string().max(500).optional(),
});

const rawOptionSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(5).max(700),
});

const rawExperimentSchema = z.object({
  title: z.string().trim().min(3).max(160),
  steps: z.array(z.string().trim().min(3).max(300)).min(2).max(5),
  success_signal: z.string().trim().min(3).max(300),
  stop_signal: z.string().trim().min(3).max(300),
});

const rawOutputSchema = z.object({
  summary: z.string().trim().min(10).max(MAX_SUMMARY),
  assumptions: z.array(z.string().trim().min(3).max(MAX_ITEM_TEXT)).min(1).max(MAX_ITEMS),
  options: z.array(rawOptionSchema).min(1).max(MAX_ITEMS),
  evidence: z.array(rawEvidenceSchema).min(1).max(MAX_ITEMS),
  counterarguments: z.array(z.string().trim().min(3).max(MAX_ITEM_TEXT)).max(MAX_ITEMS).default([]),
  disagreements: z.array(z.string().trim().min(3).max(MAX_ITEM_TEXT)).max(MAX_ITEMS).default([]),
  missing_info: z.array(z.string().trim().min(3).max(MAX_ITEM_TEXT)).min(1).max(MAX_ITEMS),
  experiment: rawExperimentSchema.nullable().default(null),
  questions: z.array(z.string().trim().min(5).max(400)).min(1).max(MAX_ITEMS),
  tradeoffs: z.array(z.string().trim().min(3).max(MAX_ITEM_TEXT)).max(MAX_ITEMS).default([]),
  recommendation: z.string().trim().max(400).nullable().default(null),
});

export type OutputParseResult =
  | { kind: "output"; output: ReviewStageOutput; adjustedSources: number }
  | { kind: "invalid"; reason: string };

/**
 * Validates one perspective reply.
 *
 * A cited URL that the person did not supply is removed and the claim is
 * re-labelled as an assumption. That is not the same as rejecting the answer: it
 * keeps the thinking while refusing to present an invented source as evidence.
 */
export function parsePerspectiveReply(
  raw: string,
  allowedUrls: Set<string>,
  perspective: Perspective,
): OutputParseResult {
  const object = extractJsonObject(raw);
  if (!object) return { kind: "invalid", reason: "unreadable-json" };

  const parsed = rawOutputSchema.safeParse(object);
  if (!parsed.success) return { kind: "invalid", reason: "bad-shape" };

  let adjustedSources = 0;
  const evidence: ReviewEvidence[] = parsed.data.evidence.map((item) => {
    const source = item.source_url?.trim().toLowerCase() ?? "";
    if (source === "") {
      return { text: item.text, basis: item.basis, source_url: null };
    }
    if (!allowedUrls.has(source)) {
      adjustedSources += 1;
      return { text: item.text, basis: "assumption", source_url: null };
    }
    return { text: item.text, basis: "user_source", source_url: source };
  });

  const output: ReviewStageOutput = {
    summary: parsed.data.summary,
    assumptions: parsed.data.assumptions,
    options: parsed.data.options,
    evidence,
    counterarguments: parsed.data.counterarguments,
    disagreements: parsed.data.disagreements,
    missing_info: parsed.data.missing_info,
    experiment: parsed.data.experiment,
    questions: parsed.data.questions,
    tradeoffs: perspective === "synthesizer" ? parsed.data.tradeoffs : [],
    recommendation: perspective === "synthesizer" ? parsed.data.recommendation : null,
  };

  if (perspective === "synthesizer" && output.tradeoffs.length < 2) {
    return { kind: "invalid", reason: "too-few-tradeoffs" };
  }

  if (perspective !== "synthesizer" && output.experiment === null) {
    return { kind: "invalid", reason: "missing-experiment" };
  }

  return { kind: "output", output, adjustedSources };
}

// ---------------------------------------------------------------------------
// Stage order and status
// ---------------------------------------------------------------------------

export type StageLike = {
  perspective: Perspective;
  position: number;
  status: string;
};

export function orderedPerspectives(): Perspective[] {
  return [...PERSPECTIVES];
}

/** The next stage the person may start, or null when none is pending. */
export function nextPerspective(stages: StageLike[]): Perspective | null {
  const pending = [...stages]
    .sort((a, b) => a.position - b.position)
    .find((stage) => stage.status === "pending");
  return pending?.perspective ?? null;
}

export const REVIEW_STATUSES = [
  "in_progress",
  "complete",
  "partial",
  "cancelled",
] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export function isTerminalReviewStatus(status: string): boolean {
  return status === "complete" || status === "partial" || status === "cancelled";
}

/**
 * Status after one stage attempt:
 *   * no stage has started yet → in_progress;
 *   * any pending stage left → in_progress;
 *   * all done and all succeeded → complete;
 *   * all done with at least one failure → partial, never "complete";
 *   * cancelled wins over everything.
 */
export function reviewStatusFor(
  cancelled: boolean,
  stages: { status: string }[],
): ReviewStatus {
  if (cancelled) return "cancelled";
  if (stages.some((stage) => stage.status === "pending")) return "in_progress";
  if (stages.every((stage) => stage.status === "succeeded")) return "complete";
  return "partial";
}

/** A stage may run only while the review is live and it is still pending. */
export function canRunStage(
  reviewStatus: string,
  stageStatus: string,
  hasPriorOutput: boolean,
  perspective: Perspective,
): boolean {
  if (isTerminalReviewStatus(reviewStatus)) return false;
  if (stageStatus !== "pending") return false;
  if (perspective === "synthesizer" && !hasPriorOutput) return false;
  return true;
}

export type PriorOutput = {
  perspective: Perspective;
  output: ReviewStageOutput;
};

/** Compact context for the synthesizer: saved summaries, not another round. */
export function priorContextLines(prior: PriorOutput[]): string {
  if (prior.length === 0) return "No earlier perspectives succeeded.";

  return prior
    .map((entry) => {
      const output = entry.output;
      const lines = [
        `${PERSPECTIVE_LABELS[entry.perspective]}: ${clip(output.summary, 400)}`,
        output.options.length
          ? `Options: ${output.options.map((option) => clip(option.title, 120)).join("; ")}`
          : "",
        output.disagreements.length
          ? `Disagreements: ${output.disagreements.map((item) => clip(item, 160)).join("; ")}`
          : "",
        output.missing_info.length
          ? `Missing: ${output.missing_info.map((item) => clip(item, 160)).join("; ")}`
          : "",
      ];
      return lines.filter(Boolean).join("\n");
    })
    .join("\n\n");
}

const SHARED_RULES = [
  "You are one of five reviewers looking at one decision for one person.",
  "You have no tools, no search, no delegation and no ability to act. Never claim to have checked anything outside the material given.",
  "Use only the question, context, sources, constraints and priorities supplied. Never invent sources, links, studies, prices, names or dates.",
  "A source may be cited only by the exact URL supplied. If a claim needs evidence that is not supplied, put it in missing_info or mark it as an assumption.",
  "Do not give percentages, probabilities, odds or guarantees.",
  "Do not present repeated agreement as evidence, and do not claim access to hidden reasoning.",
  "Be concise: plain text inside the JSON fields, no markdown, no code fences.",
  "Never make a financial, medical or legal decision for the person.",
  "Reply with JSON only.",
].join(" ");

const PERSPECTIVE_INSTRUCTIONS: Record<Perspective, string> = {
  planner:
    "Focus on how this could work. Propose concrete options, the assumptions they rely on, and a small reversible experiment with a success signal and a stop signal.",
  critic:
    "Focus on what could fail. Name the failure modes, the early signals, the counterarguments to the obvious plan, and a low-risk experiment that would expose the biggest risk.",
  research:
    "Focus on evidence. Say which claims are supported only by the person's context, which need a source, and what specific missing information would change the answer. Do not invent studies or numbers.",
  human_impact:
    "Focus on people. Who benefits, who carries a cost, who is missing from the decision, and what a fairer option might look like. Do not moralise or decide for them.",
  synthesizer:
    "Read the earlier perspectives and lay out the choices and trade-offs that remain. Do not average them into a verdict, do not treat agreement as evidence, and make clear which disagreements are unresolved. A recommendation is optional and the person may reject it.",
};

const OUTPUT_SHAPE = [
  'Shape: {"summary": "...", "assumptions": ["..."], "options": [{"title": "...", "description": "..."}], "evidence": [{"text": "...", "basis": "user_source|context|assumption|unknown|ai_hypothesis", "source_url": ""}], "counterarguments": ["..."], "disagreements": ["..."], "missing_info": ["..."], "experiment": {"title": "...", "steps": ["..."], "success_signal": "...", "stop_signal": "..."} or null, "questions": ["..."], "tradeoffs": ["..."], "recommendation": "..." or null}',
  "Give 1 to 6 items per list. summary is under 700 characters. Put questions for the person in questions, not in summary.",
  "tradeoffs and recommendation are only used by the synthesizer; other perspectives may leave them empty.",
].join(" ");

export function buildPerspectiveMessages(
  input: ReviewInput,
  perspective: Perspective,
  prior: PriorOutput[] = [],
): ChatMessage[] {
  const sourceLines =
    input.sources.length > 0
      ? input.sources
          .map((source) => `- ${source.title || "Untitled source"}: ${source.url}`)
          .join("\n")
      : "No sources were supplied. Do not cite any.";

  const lines = [
    `Question: ${input.question}`,
    input.context ? `Context from the person:\n${clip(input.context, MAX_CONTEXT)}` : "Context: none given.",
    input.constraints
      ? `Constraints:\n${clip(input.constraints, MAX_CONSTRAINTS)}`
      : "Constraints: none given.",
    input.priorities.length
      ? `Their priorities, in their own words: ${input.priorities.join("; ")}`
      : "They did not set priorities.",
    `Sources they supplied:\n${sourceLines}`,
    perspective === "synthesizer"
      ? `Earlier perspectives:\n${priorContextLines(prior)}`
      : "",
    `Your role: ${PERSPECTIVE_QUESTIONS[perspective]} ${PERSPECTIVE_INSTRUCTIONS[perspective]}`,
    OUTPUT_SHAPE,
    "Return the JSON now.",
  ];

  return [
    { role: "system", content: SHARED_RULES },
    { role: "user", content: lines.filter(Boolean).join("\n\n") },
  ];
}

// ---------------------------------------------------------------------------
// Reading the result
// ---------------------------------------------------------------------------

/** All disagreement lines across stages, each still attributed to its source. */
export function disagreementRows(
  stages: { perspective: Perspective; output: ReviewStageOutput }[],
): { perspective: Perspective; label: string; items: string[] }[] {
  return stages
    .filter((stage) => stage.output.disagreements.length > 0)
    .map((stage) => ({
      perspective: stage.perspective,
      label: PERSPECTIVE_LABELS[stage.perspective],
      items: stage.output.disagreements,
    }));
}

/** Every missing-information line, grouped by the stage that raised it. */
export function missingInfoRows(
  stages: { perspective: Perspective; output: ReviewStageOutput }[],
): { perspective: Perspective; label: string; items: string[] }[] {
  return stages
    .filter((stage) => stage.output.missing_info.length > 0)
    .map((stage) => ({
      perspective: stage.perspective,
      label: PERSPECTIVE_LABELS[stage.perspective],
      items: stage.output.missing_info,
    }));
}

/** All options proposed, tagged by perspective. No merging, no ranking. */
export function optionRows(
  stages: { perspective: Perspective; output: ReviewStageOutput }[],
): { perspective: Perspective; label: string; options: ReviewOption[] }[] {
  return stages
    .filter((stage) => stage.output.options.length > 0)
    .map((stage) => ({
      perspective: stage.perspective,
      label: PERSPECTIVE_LABELS[stage.perspective],
      options: stage.output.options,
    }));
}

export function experimentRows(
  stages: { perspective: Perspective; output: ReviewStageOutput }[],
): { perspective: Perspective; label: string; experiment: ReviewExperiment }[] {
  return stages
    .filter(
      (stage): stage is { perspective: Perspective; output: ReviewStageOutput & { experiment: ReviewExperiment } } =>
        stage.output.experiment !== null,
    )
    .map((stage) => ({
      perspective: stage.perspective,
      label: PERSPECTIVE_LABELS[stage.perspective],
      experiment: stage.output.experiment,
    }));
}

// ---------------------------------------------------------------------------
// Human decision
// ---------------------------------------------------------------------------

export const reviewOutcomeSchema = z.object({
  chosen_option: z.string().trim().max(MAX_CHOSEN_OPTION).default(""),
  decision: z
    .string()
    .trim()
    .min(1, "Write your decision before saving it.")
    .max(MAX_DECISION, "Keep your decision under 4000 characters."),
  rejected_recommendation: z.boolean().default(false),
});

export type ReviewOutcome = z.infer<typeof reviewOutcomeSchema>;

export const HUMAN_DECISION_NOTE =
  "The decision is yours. You can reject the recommendation, ignore every option, record something none of the perspectives suggested, and change it later. Nothing here argues with you.";

export function perspectiveErrorMessage(code: string | undefined): string {
  switch (code) {
    case "unauthenticated":
      return "Your session expired. Sign in again.";
    case "no-review":
      return "That review isn't available to you.";
    case "stage-done":
      return "That perspective has already been answered.";
    case "cancelled":
      return "This review is cancelled, so no further requests were made.";
    case "complete":
      return "This review is already finished.";
    case "needs-context":
      return "Run at least one earlier perspective before the synthesizer.";
    case "unusable":
      return "That reply wasn't usable, so nothing was saved for this perspective. You can try this stage again.";
    case "busy":
      return "That stage is already running.";
    default:
      return "That didn't work. Nothing was changed — try again.";
  }
}
