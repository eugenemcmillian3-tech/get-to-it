import { describe, expect, it } from "vitest";
import {
  KIND_LABELS,
  NO_PREDICTION_NOTE,
  RADAR_TOPICS,
  SIGNAL_KINDS,
  SOURCE_HONESTY_NOTE,
  canonicalSourceUrl,
  dedupeKey,
  filterSignals,
  freshnessLabel,
  isOlder,
  isRadarTopic,
  kindLabel,
  kindNote,
  learningGoalOutcome,
  learningGoalTitle,
  parseTopicSelection,
  preparationTaskInstructions,
  preparationTaskTitle,
  publishedOnProblem,
  relevanceNote,
  signalInputSchema,
  sortSignals,
  sourceUrlProblem,
  topicLabel,
} from "@/lib/radar";
import type { RadarSignal } from "@/lib/types";

const TODAY = "2026-11-02";

function makeSignal(overrides: Partial<RadarSignal> = {}): RadarSignal {
  return {
    id: "signal-1",
    user_id: "user-1",
    topic: "ai",
    kind: "announced",
    headline: "A vendor announced an assistant that drafts invoices",
    source_name: "Vendor announcement",
    source_url: "https://example.org/news/assistant",
    published_on: "2026-10-20",
    retrieved_at: "2026-11-01T09:30:00.000Z",
    geography: "United Kingdom",
    sector: "Retail",
    uncertainty: "No release date, no price, no independent test",
    goal_id: null,
    dedupe_key: "example.org/news/assistant|2026-10-20",
    saved_at: null,
    dismissed_at: null,
    experiment_task_id: null,
    learning_goal_id: null,
    created_at: "2026-11-01T09:30:00.000Z",
    updated_at: "2026-11-01T09:30:00.000Z",
    ...overrides,
  };
}

const VALID_INPUT = {
  topic: "ai",
  kind: "announced",
  headline: "A vendor announced an assistant that drafts invoices",
  source_name: "Vendor announcement",
  source_url: "https://example.org/news/assistant",
  published_on: "2026-10-20",
  geography: "",
  sector: "",
  uncertainty: "No release date, no price, no independent test",
  goal_id: "",
};

describe("radar topics", () => {
  it("offers the six topics the phase names, each with a label", () => {
    expect(RADAR_TOPICS.map((topic) => topic.slug)).toEqual([
      "ai",
      "work",
      "business",
      "education",
      "community",
      "policy",
    ]);
    for (const topic of RADAR_TOPICS) {
      expect(topic.label.length).toBeGreaterThan(3);
      expect(topicLabel(topic.slug)).toBe(topic.label);
    }
  });

  it("follows nothing until a valid topic is chosen", () => {
    expect(parseTopicSelection([])).toEqual([]);
    expect(parseTopicSelection(["not-a-topic"])).toEqual([]);
    expect(parseTopicSelection(["work", "ai", "ai"])).toEqual(["ai", "work"]);
  });

  it("recognises only the six known topics", () => {
    expect(isRadarTopic("community")).toBe(true);
    expect(isRadarTopic("finance")).toBe(false);
  });
});

describe("signal kinds", () => {
  it("keeps all six kinds distinct, with their own explanation", () => {
    const slugs = SIGNAL_KINDS.map((kind) => kind.slug);
    expect(new Set(slugs).size).toBe(6);
    expect(new Set(SIGNAL_KINDS.map((kind) => kind.label)).size).toBe(6);
    expect(new Set(SIGNAL_KINDS.map((kind) => kind.note)).size).toBe(6);
  });

  it("never presents an announcement as a release", () => {
    expect(kindLabel("announced")).toBe("Announced capability");
    expect(kindLabel("released")).toBe("Released capability");
    expect(kindNote("announced")).toContain("not available yet");
    expect(kindNote("released")).toContain("available to use now");
    expect(KIND_LABELS.announced).not.toBe(KIND_LABELS.released);
  });

  it("keeps speculation and opinion labelled as such", () => {
    expect(kindNote("speculation")).toContain("may never happen");
    expect(kindNote("opinion")).toContain("not a measurement");
  });
});

describe("recording a signal", () => {
  it("accepts a complete record", () => {
    expect(signalInputSchema.safeParse(VALID_INPUT).success).toBe(true);
  });

  it("requires what was reported and what remains uncertain", () => {
    expect(signalInputSchema.safeParse({ ...VALID_INPUT, headline: "Short" }).success).toBe(
      false,
    );
    expect(
      signalInputSchema.safeParse({ ...VALID_INPUT, uncertainty: "Not sure" }).success,
    ).toBe(false);
    expect(signalInputSchema.safeParse({ ...VALID_INPUT, source_name: "" }).success).toBe(
      false,
    );
  });

  it("rejects a topic that is not one of the six, or an unknown kind", () => {
    expect(
      signalInputSchema.safeParse({ ...VALID_INPUT, topic: "finance" }).success,
    ).toBe(false);
    expect(
      signalInputSchema.safeParse({ ...VALID_INPUT, kind: "rumour" }).success,
    ).toBe(false);
  });
});

describe("source attribution", () => {
  it("accepts public links only", () => {
    expect(sourceUrlProblem("https://example.org/report")).toBeNull();
    expect(sourceUrlProblem("http://example.org/report")).toBeNull();
    expect(sourceUrlProblem("javascript:alert(1)")).not.toBeNull();
    expect(sourceUrlProblem("https://user:secret@example.org/x")).not.toBeNull();
    expect(sourceUrlProblem("http://localhost:3000/x")).not.toBeNull();
    expect(sourceUrlProblem("http://192.168.1.4/x")).not.toBeNull();
    expect(sourceUrlProblem("not a link")).not.toBeNull();
  });

  it("normalises the link for comparison without losing the path", () => {
    expect(canonicalSourceUrl("https://www.Example.org/News/Item/?utm_source=x&b=2#top")).toBe(
      "example.org/News/Item?b=2",
    );
    expect(canonicalSourceUrl("https://example.org/News/Item")).toBe(
      canonicalSourceUrl("https://example.org/News/Item/"),
    );
    expect(canonicalSourceUrl("https://example.org/news/item")).not.toBe(
      canonicalSourceUrl("https://example.org/News/Item"),
    );
  });

  it("treats the same source on the same date as a duplicate", () => {
    const a = dedupeKey("https://www.example.org/report/?utm_campaign=launch", "2026-10-20");
    const b = dedupeKey("https://example.org/report", "2026-10-20");
    expect(a).toBe(b);

    expect(dedupeKey("https://example.org/report", "2026-10-21")).not.toBe(a);
    expect(dedupeKey("https://example.org/other-report", "2026-10-20")).not.toBe(a);
  });

  it("states plainly that nothing is fetched", () => {
    expect(SOURCE_HONESTY_NOTE).toContain("does not fetch");
  });
});

describe("timestamps", () => {
  it("requires a real publication date, never a future one", () => {
    expect(publishedOnProblem("2026-10-20", TODAY)).toBeNull();
    expect(publishedOnProblem("2026-11-03", TODAY)).toContain("future");
    expect(publishedOnProblem("2026-02-31", TODAY)).toContain("doesn't exist");
    expect(publishedOnProblem("20/10/2026", TODAY)).toContain("YYYY-MM-DD");
    expect(publishedOnProblem("", TODAY)).toContain("Add the date");
    expect(publishedOnProblem("1989-12-31", TODAY)).not.toBeNull();
  });

  it("describes age honestly instead of calling old items new", () => {
    expect(freshnessLabel("2026-11-02", TODAY)).toBe("Published today");
    expect(freshnessLabel("2026-11-01", TODAY)).toBe("Published yesterday");
    expect(freshnessLabel("2026-10-20", TODAY)).toBe("Published 13 days ago");
    expect(freshnessLabel("2026-09-01", TODAY)).toContain("older item, not new");
    expect(isOlder("2026-09-01", TODAY)).toBe(true);
    expect(isOlder("2026-10-20", TODAY)).toBe(false);
  });

  it("keeps retrieval separate from publication", () => {
    const signal = makeSignal();
    const instructions = preparationTaskInstructions(signal, "Open a shop");
    expect(instructions).toContain("Published 2026-10-20");
    expect(instructions).toContain("recorded in GET TO IT on 2026-11-01");
  });
});

describe("topic controls and the feed", () => {
  const signals = [
    makeSignal({ id: "a", topic: "ai", published_on: "2026-10-20" }),
    makeSignal({ id: "b", topic: "work", published_on: "2026-10-25", saved_at: "2026-11-01T10:00:00.000Z" }),
    makeSignal({ id: "c", topic: "ai", published_on: "2026-10-18", dismissed_at: "2026-11-01T10:00:00.000Z" }),
  ];

  it("hides dismissed signals unless they are explicitly asked for", () => {
    expect(filterSignals(signals).map((signal) => signal.id)).toEqual(["a", "b"]);
    expect(
      filterSignals(signals, { includeDismissed: true }).map((signal) => signal.id),
    ).toEqual(["a", "b", "c"]);
  });

  it("filters by topic and by saved", () => {
    expect(filterSignals(signals, { topic: "ai" }).map((signal) => signal.id)).toEqual([
      "a",
    ]);
    expect(filterSignals(signals, { savedOnly: true }).map((signal) => signal.id)).toEqual([
      "b",
    ]);
  });

  it("hides every signal of a muted topic without deleting it", () => {
    expect(filterSignals(signals, { mutedTopics: ["ai"] }).map((signal) => signal.id)).toEqual([
      "b",
    ]);
    expect(signals).toHaveLength(3);
  });

  it("sorts the newest publication first", () => {
    const mixed = [
      makeSignal({ id: "old", published_on: "2026-01-01" }),
      makeSignal({ id: "new", published_on: "2026-10-30" }),
      makeSignal({ id: "middle", published_on: "2026-06-01" }),
    ];
    expect(sortSignals(mixed).map((signal) => signal.id)).toEqual([
      "new",
      "middle",
      "old",
    ]);
  });
});

describe("personal relevance explanations", () => {
  it("names the followed topic and the goal the person connected", () => {
    expect(
      relevanceNote({ topic: "ai", followed: ["ai"], goalTitle: "Open a shop" }),
    ).toBe("You follow AI and automation and have this related goal: “Open a shop”.");
  });

  it("says when only the topic is followed", () => {
    expect(relevanceNote({ topic: "work", followed: ["work"], goalTitle: null })).toContain(
      "You follow Work and careers",
    );
  });

  it("says when only a goal is connected", () => {
    expect(
      relevanceNote({ topic: "policy", followed: ["ai"], goalTitle: "Open a shop" }),
    ).toContain("You are not following Technology and public policy now");
  });

  it("admits when there is no personal link at all", () => {
    expect(relevanceNote({ topic: "education", followed: [], goalTitle: null })).toContain(
      "no goal is connected",
    );
  });
});

describe("voluntary preparation", () => {
  it("builds a task that carries the source, both dates and the uncertainty", () => {
    const signal = makeSignal();
    const title = preparationTaskTitle(signal);
    const instructions = preparationTaskInstructions(signal, "Open a shop");

    expect(title).toContain(signal.headline);
    expect(title.length).toBeLessThanOrEqual(180);
    expect(instructions).toContain("https://example.org/news/assistant");
    expect(instructions).toContain("Announced capability");
    expect(instructions).toContain("No release date, no price, no independent test");
    expect(instructions).toContain("nothing in your plan changed automatically");
  });

  it("builds a learning goal that keeps the kind label", () => {
    const signal = makeSignal({ kind: "speculation" });
    expect(learningGoalTitle(signal)).toContain(signal.headline);
    expect(learningGoalOutcome(signal)).toContain("Speculation");
    expect(learningGoalOutcome(signal)).toContain("https://example.org/news/assistant");
  });

  it("says no signal is a prediction and none changes plans by itself", () => {
    expect(NO_PREDICTION_NOTE).toContain("not a prediction");
    expect(NO_PREDICTION_NOTE).toContain("never changes your plans");
  });
});
