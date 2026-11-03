import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PERSPECTIVES,
  SAME_MODEL_NOTE,
  TRANSPARENCY_NOTE,
  USAGE_NOTE,
  allowedSourceUrls,
  buildPerspectiveMessages,
  canRunStage,
  disagreementRows,
  experimentRows,
  missingInfoRows,
  nextPerspective,
  parsePerspectiveReply,
  parsePriorities,
  parseSources,
  reviewInputSchema,
  reviewOutcomeSchema,
  reviewStatusFor,
  type Perspective,
  type ReviewInput,
  type ReviewStageOutput,
} from "@/lib/reviews";

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/review-perspectives.json", import.meta.url),
    "utf8",
  ),
) as Record<Perspective, Record<string, unknown>>;

const input: ReviewInput = {
  question: "Should I take the six-month contract and hire part-time help?",
  context: "The current client needs two days a week and I have three months of savings.",
  constraints: "I cannot relocate, and the current client comes first.",
  priorities: ["Predictable income", "Time with family"],
  sources: [{ title: "Rate card", url: "https://example.org/rates" }],
};

function parse(perspective: Perspective) {
  return parsePerspectiveReply(
    JSON.stringify(fixture[perspective]),
    allowedSourceUrls(input.sources),
    perspective,
  );
}

describe("the shared record", () => {
  it("parses priorities from lines or commas, de-duplicated and capped", () => {
    expect(parsePriorities("Income\nTime with family, income")).toEqual([
      "Income",
      "Time with family",
    ]);

    const many = Array.from({ length: 12 }, (_, index) => `Priority ${index + 1}`);
    expect(parsePriorities(many.join("\n"))).toHaveLength(8);
  });

  it("accepts titled sources and rejects anything that is not a full link", () => {
    const parsed = parseSources(
      "Rate card | https://example.org/rates\nhttps://example.org/second\nnot a link\nhttps://example.org/rates",
    );

    expect(parsed.sources).toEqual([
      { title: "Rate card", url: "https://example.org/rates" },
      { title: "", url: "https://example.org/second" },
    ]);
    expect(parsed.invalid).toEqual(["not a link"]);
  });

  it("requires a real question", () => {
    expect(
      reviewInputSchema.safeParse({ ...input, question: "Why?" }).success,
    ).toBe(false);
    expect(reviewInputSchema.safeParse(input).success).toBe(true);
  });
});

describe("perspective replies", () => {
  it("parses all five fixtures with their own rules", () => {
    for (const perspective of PERSPECTIVES) {
      const result = parse(perspective);
      expect(result.kind, perspective).toBe("output");
    }

    const planner = parse("planner");
    if (planner.kind === "output") {
      expect(planner.output.experiment?.title).toBe("Run one paid trial deliverable");
      expect(planner.output.tradeoffs).toEqual([]);
      expect(planner.output.recommendation).toBeNull();
    }

    const synthesizer = parse("synthesizer");
    if (synthesizer.kind === "output") {
      expect(synthesizer.output.tradeoffs.length).toBeGreaterThanOrEqual(2);
      expect(synthesizer.output.recommendation).toContain("written terms");
    }
  });

  it("keeps a supplied source as evidence", () => {
    const result = parse("research");
    if (result.kind !== "output") throw new Error(result.reason);

    const sourced = result.output.evidence.find(
      (item) => item.source_url === "https://example.org/rates",
    );
    expect(sourced?.basis).toBe("user_source");
    expect(result.adjustedSources).toBe(0);
  });

  it("removes a URL the person did not supply and relabels the claim", () => {
    const invented = {
      ...fixture.critic,
      evidence: [
        {
          text: "A study nobody supplied says the contract always pays.",
          basis: "user_source",
          source_url: "https://invented.example/study",
        },
      ],
    };

    const result = parsePerspectiveReply(JSON.stringify(invented), new Set(), "critic");
    if (result.kind !== "output") throw new Error(result.reason);

    expect(result.adjustedSources).toBe(1);
    expect(
      result.output.evidence.some((item) => item.source_url !== null),
    ).toBe(false);
    expect(result.output.evidence[0].basis).not.toBe("user_source");
  });

  it("rejects a reply missing required lists", () => {
    const broken = { ...fixture.planner } as Record<string, unknown>;
    delete broken.missing_info;

    const result = parsePerspectiveReply(
      JSON.stringify(broken),
      allowedSourceUrls(input.sources),
      "planner",
    );
    expect(result.kind).toBe("invalid");
  });

  it("requires a low-risk experiment from every working perspective", () => {
    const broken = { ...fixture.planner, experiment: null };
    const result = parsePerspectiveReply(
      JSON.stringify(broken),
      allowedSourceUrls(input.sources),
      "planner",
    );
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") expect(result.reason).toBe("missing-experiment");
  });

  it("requires at least two trade-offs from the synthesizer", () => {
    const broken = { ...fixture.synthesizer, tradeoffs: ["Only one"] };
    const result = parsePerspectiveReply(
      JSON.stringify(broken),
      allowedSourceUrls(input.sources),
      "synthesizer",
    );
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") expect(result.reason).toBe("too-few-tradeoffs");
  });
});

describe("call order and limits", () => {
  const all = (status: string) =>
    PERSPECTIVES.map((perspective, index) => ({
      perspective,
      position: index + 1,
      status,
    }));

  it("returns the first pending perspective in order", () => {
    const stages = all("succeeded");
    stages[2] = { ...stages[2], status: "pending" };
    expect(nextPerspective(stages)).toBe("research");
    expect(nextPerspective(all("succeeded"))).toBeNull();
  });

  it("refuses a finished or cancelled review and an unanswered synthesizer", () => {
    expect(canRunStage("complete", "pending", true, "planner")).toBe(false);
    expect(canRunStage("cancelled", "pending", true, "planner")).toBe(false);
    expect(canRunStage("partial", "pending", true, "planner")).toBe(false);
    expect(canRunStage("in_progress", "pending", false, "synthesizer")).toBe(false);
    expect(canRunStage("in_progress", "pending", true, "synthesizer")).toBe(true);
    expect(canRunStage("in_progress", "pending", false, "planner")).toBe(true);
    expect(canRunStage("in_progress", "succeeded", true, "planner")).toBe(false);
  });

  it("never calls a review with a failure complete", () => {
    expect(reviewStatusFor(false, all("succeeded"))).toBe("complete");
    expect(readStatus(all("succeeded"), "failed")).toBe("partial");
    expect(reviewStatusFor(false, all("pending"))).toBe("in_progress");
    expect(reviewStatusFor(true, all("succeeded"))).toBe("cancelled");
  });

  function readStatus(
    stages: { perspective: Perspective; position: number; status: string }[],
    failed: string,
  ) {
    const copy = stages.map((stage) => ({ ...stage }));
    copy[1] = { ...copy[1], status: failed };
    copy[4] = { ...copy[4], status: "succeeded" };
    return reviewStatusFor(false, copy);
  }

  it("states the five-request cap and the single-model limit", () => {
    expect(USAGE_NOTE).toContain("at most 5 AI requests");
    expect(SAME_MODEL_NOTE).toContain("not independent evidence");
    expect(TRANSPARENCY_NOTE).toContain("not its hidden internal reasoning");
  });
});

describe("prompts keep one shared record and no tools", () => {
  it("gives every perspective the same record and its own role", () => {
    const messages = buildPerspectiveMessages(input, "critic");
    const user = messages[1].content;

    expect(user).toContain(input.question);
    expect(user).toContain("Predictable income");
    expect(user).toContain("https://example.org/rates");
    expect(user).toContain("What could fail?");
    expect(user).not.toContain("Earlier perspectives");
    expect(messages[0].content).toContain("no tools, no search, no delegation");
    expect(messages[0].content).toContain("Never invent sources");
  });

  it("gives the synthesizer the saved answers instead of another call", () => {
    const prior = PERSPECTIVES.filter((p) => p !== "synthesizer").map(
      (perspective) => {
        const result = parse(perspective);
        if (result.kind !== "output") throw new Error(result.reason);
        return { perspective, output: result.output };
      },
    );

    const messages = buildPerspectiveMessages(input, "synthesizer", prior);
    expect(messages[1].content).toContain("Earlier perspectives");
    expect(messages[1].content).toContain("Planner:");
    expect(messages[1].content).toContain("Human-impact reviewer:");
    expect(messages[1].content).toContain("What choices and trade-offs remain?");
  });
});

describe("reading the result and the human decision", () => {
  const outputs = PERSPECTIVES.map((perspective) => {
    const result = parse(perspective);
    if (result.kind !== "output") throw new Error(result.reason);
    return { perspective, output: result.output };
  });

  it("attributes disagreements, missing information and experiments", () => {
    const disagreements = disagreementRows(outputs);
    expect(disagreements.map((row) => row.perspective)).toContain("synthesizer");
    expect(disagreements.every((row) => row.items.length > 0)).toBe(true);

    const missing = missingInfoRows(outputs);
    expect(missing.length).toBe(PERSPECTIVES.length);

    const experiments = experimentRows(outputs);
    expect(experiments.map((row) => row.perspective)).toEqual([
      "planner",
      "critic",
      "research",
      "human_impact",
    ]);
  });

  it("accepts a decision that ignores every option, and requires some text", () => {
    expect(
      reviewOutcomeSchema.safeParse({
        chosen_option: "",
        decision: "I am going to wait until March and decide then.",
        rejected_recommendation: true,
      }).success,
    ).toBe(true);

    expect(
      reviewOutcomeSchema.safeParse({
        chosen_option: "",
        decision: "",
        rejected_recommendation: false,
      }).success,
    ).toBe(false);
  });

  it("type-checks an output shape used by the page", () => {
    const output: ReviewStageOutput = outputs[0].output;
    expect(output.summary.length).toBeGreaterThan(10);
  });
});
