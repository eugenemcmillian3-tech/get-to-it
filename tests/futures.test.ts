import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ASSUMPTION_BASED_NOTE,
  EXPECTED_SCENARIO_NOTE,
  LIST_FIELD_MIN,
  SCENARIO_KINDS,
  SCENARIO_LIST_FIELDS,
  actionTaskInstructions,
  actionTaskTitle,
  allowedSourceUrls,
  buildScenarioMessages,
  compareRows,
  evidenceCounts,
  futurePathInputSchema,
  hasUnsupportedClaim,
  parseScenarioReply,
  relabelEditedLines,
  sanitizeEvidence,
  type ScenarioDraft,
} from "@/lib/futures";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/future-paths.json", import.meta.url), "utf8"),
) as { scenarios: Record<string, unknown>[] };

const input = {
  decision: "Take the contract and hire one person",
  horizon: "1_year" as const,
  resources: "Some savings and two days a week",
  constraints: "One hire at most",
  success_definition: "Steady income without losing the work I like",
  uncertainties: "Whether the main client renews. Rates: https://example.org/rates",
};

function cloneFixture(): { scenarios: Record<string, unknown>[] } {
  return JSON.parse(JSON.stringify(fixture));
}

function parsed(): ScenarioDraft[] {
  const result = parseScenarioReply(JSON.stringify(fixture), allowedSourceUrls(input));
  if (result.kind !== "scenarios") throw new Error(result.reason);
  return result.scenarios;
}

describe("future path input", () => {
  it("requires a decision, a horizon and a success definition", () => {
    const blank = futurePathInputSchema.safeParse({
      goal_id: "",
      decision: "",
      horizon: "1_year",
      resources: "",
      constraints: "",
      success_definition: "",
      uncertainties: "",
    });
    expect(blank.success).toBe(false);

    const valid = futurePathInputSchema.safeParse({
      goal_id: "",
      decision: "Change the offer",
      horizon: "6_months",
      resources: "",
      constraints: "",
      success_definition: "More predictable weeks",
      uncertainties: "",
    });
    expect(valid.success).toBe(true);
  });

  it("rejects a horizon outside the five supported ones", () => {
    const result = futurePathInputSchema.safeParse({
      ...input,
      goal_id: "",
      horizon: "10_years",
    });
    expect(result.success).toBe(false);
  });
});

describe("evidence sources", () => {
  it("extracts only URLs the person actually supplied", () => {
    const urls = allowedSourceUrls(input);
    expect([...urls]).toEqual(["https://example.org/rates"]);
    expect(allowedSourceUrls({ ...input, uncertainties: "" }).size).toBe(0);
  });

  it("keeps a retrieved fact only with an allowed source", () => {
    const withSource = sanitizeEvidence(
      [
        { text: "Day rates are listed between 400 and 600.", label: "retrieved", source_url: "https://example.org/rates" },
        { text: "Clients usually renew on time.", label: "retrieved", source_url: "https://invented.example/x" },
        { text: "Clients renew in the first quarter.", label: "retrieved" },
      ],
      allowedSourceUrls(input),
    );

    expect(withSource.items).toHaveLength(1);
    expect(withSource.items[0].label).toBe("retrieved");
    expect(withSource.items[0].source_url).toBe("https://example.org/rates");
    expect(withSource.dropped.sources).toBe(2);
  });

  it("drops everything when no source was supplied", () => {
    const none = sanitizeEvidence(
      [{ text: "A fact with no source.", label: "retrieved", source_url: "https://example.org/rates" }],
      new Set(),
    );
    expect(none.items).toEqual([]);
    expect(none.dropped.sources).toBe(1);
  });
});

describe("unsupported claims", () => {
  it("recognises percentages, probabilities and predictions", () => {
    expect(hasUnsupportedClaim("There is a 70% chance it works.")).toBe(true);
    expect(hasUnsupportedClaim("The probability of renewal is unknown.")).toBe(true);
    expect(hasUnsupportedClaim("This is the most likely outcome.")).toBe(true);
    expect(hasUnsupportedClaim("We predict the contract starts in March.")).toBe(true);
    expect(hasUnsupportedClaim("Two clients renew in the first quarter.")).toBe(false);
  });

  it("never keeps a generated percentage or a prediction", () => {
    const cleaned = sanitizeEvidence(
      [
        { text: "There is a 70% chance the client renews.", label: "ai" },
        { text: "This is the most likely outcome.", label: "assumption" },
        { text: "The contract may start a month later.", label: "assumption" },
      ],
      new Set(),
    );

    expect(cleaned.items.map((item) => item.text)).toEqual([
      "The contract may start a month later.",
    ]);
    expect(cleaned.dropped.claims).toBe(2);
  });

  it("leaves the person's own text untouched", () => {
    const cleaned = sanitizeEvidence(
      [{ text: "My own note says 70% of revenue comes from one client.", label: "user" }],
      new Set(),
    );
    expect(cleaned.items).toHaveLength(1);
    expect(cleaned.dropped.claims).toBe(0);
  });

  it("treats an unsupported label as an AI-generated possibility", () => {
    const cleaned = sanitizeEvidence(
      [{ text: "A possibility with a strange label.", label: "oracle" }],
      new Set(),
    );
    expect(cleaned.items[0].label).toBe("ai");
  });
});

describe("parsing a model reply", () => {
  it("accepts three labelled scenarios and removes the percentage line", () => {
    const result = parseScenarioReply(JSON.stringify(fixture), allowedSourceUrls(input));
    expect(result.kind).toBe("scenarios");
    if (result.kind !== "scenarios") return;

    expect(result.scenarios.map((scenario) => scenario.kind)).toEqual([
      "favorable",
      "expected",
      "difficult",
    ]);
    expect(result.dropped.claims).toBe(1);
    expect(result.dropped.sources).toBe(0);

    const retrieved = result.scenarios[1].assumptions.find(
      (item) => item.label === "retrieved",
    );
    expect(retrieved?.source_url).toBe("https://example.org/rates");

    for (const scenario of result.scenarios) {
      for (const field of SCENARIO_LIST_FIELDS) {
        expect(scenario[field].length).toBeGreaterThanOrEqual(LIST_FIELD_MIN[field]);
      }
    }

    expect(SCENARIO_KINDS).toHaveLength(3);
  });

  it("rejects a reply with a duplicate scenario kind", () => {
    const broken = cloneFixture();
    broken.scenarios[2].kind = "expected";
    const result = parseScenarioReply(JSON.stringify(broken), allowedSourceUrls(input));
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") expect(result.reason).toBe("duplicate-kind");
  });

  it("rejects a missing scenario rather than showing a partial comparison", () => {
    const broken = cloneFixture();
    broken.scenarios.pop();
    const result = parseScenarioReply(JSON.stringify(broken), allowedSourceUrls(input));
    expect(result.kind).toBe("invalid");
  });

  it("rejects a list left too thin after cleanup", () => {
    const broken = cloneFixture();
    broken.scenarios[1].developments = [
      { text: "There is a 70% chance the client renews.", label: "ai" },
    ];
    const result = parseScenarioReply(JSON.stringify(broken), allowedSourceUrls(input));
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") {
      expect(result.reason).toBe("too-few-developments");
    }
  });

  it("rejects prose that is not JSON", () => {
    const result = parseScenarioReply("Here are three scenarios…", allowedSourceUrls(input));
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") expect(result.reason).toBe("unreadable-json");
  });

  it("requires at least one stated assumption per scenario", () => {
    const broken = cloneFixture();
    broken.scenarios[0].assumptions = [
      { text: "Only something the person typed.", label: "user" },
      { text: "A second line the person typed.", label: "user" },
    ];
    const result = parseScenarioReply(JSON.stringify(broken), allowedSourceUrls(input));
    expect(result.kind).toBe("invalid");
    if (result.kind === "invalid") expect(result.reason).toBe("no-stated-assumptions");
  });
});

describe("editing keeps evidence provenance", () => {
  it("keeps untouched lines and labels rewritten ones as the person's", () => {
    const scenario = parsed()[1];
    const original = scenario.assumptions.find((item) => item.label === "retrieved")!;

    const edited = relabelEditedLines(scenario.assumptions, [
      original.text,
      "A new line I typed myself",
      "",
    ]);

    const kept = edited.find((item) => item.text === original.text);
    expect(kept?.label).toBe("retrieved");
    expect(kept?.source_url).toBe("https://example.org/rates");

    const added = edited.find((item) => item.text === "A new line I typed myself");
    expect(added?.label).toBe("user");
    expect(added?.source_url).toBeNull();
  });

  it("drops duplicate lines and lines that are too short", () => {
    const edited = relabelEditedLines([], ["Keep this line", "Keep this line", "a"]);
    expect(edited).toHaveLength(1);
  });
});

describe("comparison", () => {
  it("orders the same fields for all three scenarios without ranking them", () => {
    const scenarios = parsed();
    const rows = compareRows(scenarios);

    expect(rows.map((row) => row.field)).toEqual([...SCENARIO_LIST_FIELDS]);
    for (const row of rows) {
      expect(Object.keys(row.values)).toEqual(["favorable", "expected", "difficult"]);
    }

    const allText = rows
      .flatMap((row) => SCENARIO_KINDS.flatMap((kind) => row.values[kind]))
      .map((item) => item.text)
      .join(" ");

    expect(allText).not.toMatch(/%/);
    expect(allText.toLowerCase()).not.toContain("most likely");
    expect(EXPECTED_SCENARIO_NOTE.toLowerCase()).toContain("not statistically most likely");
  });

  it("counts labels separately", () => {
    const counts = evidenceCounts(parsed()[0].assumptions);
    expect(counts.user).toBe(1);
    expect(counts.assumption).toBe(2);
    expect(counts.retrieved).toBe(0);
  });
});

describe("prompts and conversions", () => {
  it("tells the model not to rank the expected scenario", () => {
    const messages = buildScenarioMessages({ ...input, goal_id: "" });
    expect(messages[0].content).toContain("Never call it likely, most likely, probable");
    expect(messages[0].content).toContain("Never invent sources");
    expect(messages[1].content).toContain("Time horizon: 1 year");
    expect(messages[1].content).toContain("No research tool is connected");
    expect(ASSUMPTION_BASED_NOTE).toContain("assumption-based exercise");
  });

  it("shortens a long action into a task title and says where it came from", () => {
    const title = actionTaskTitle("a".repeat(400));
    expect(title.length).toBeLessThanOrEqual(200);
    expect(title.endsWith("…")).toBe(true);

    const instructions = actionTaskInstructions("Hire one person", "difficult");
    expect(instructions).toContain("Difficult conditions");
    expect(instructions).toContain("not as a prediction");
    expect(instructions.length).toBeLessThanOrEqual(1000);
  });
});
