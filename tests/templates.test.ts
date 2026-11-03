import { describe, expect, it } from "vitest";
import {
  clampMinutes,
  DEFAULT_GOAL_FILTERS,
  goalListHref,
  hasActiveGoalFilters,
  pageBounds,
  parseGoalListParams,
  sanitizeSearchTerm,
  stepsFromTasks,
} from "@/lib/templates/helpers";
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_LIBRARY,
  categoryLabel,
  getStaticTemplate,
  templateTotalMinutes,
  templatesByCategory,
} from "@/lib/templates/library";
import { templateStepsSchema, templateUseSchema } from "@/lib/validation";

describe("the static template library", () => {
  it("covers all six categories", () => {
    expect(TEMPLATE_CATEGORIES.map((entry) => entry.slug)).toEqual([
      "launch",
      "job",
      "content",
      "learn",
      "personal",
      "business",
    ]);
    const groups = templatesByCategory();
    expect(groups).toHaveLength(6);
    for (const group of groups) {
      expect(group.templates.length).toBeGreaterThan(0);
    }
  });

  it("gives every template a name, description, outcome and real steps", () => {
    expect(TEMPLATE_LIBRARY.length).toBeGreaterThanOrEqual(12);

    for (const template of TEMPLATE_LIBRARY) {
      expect(template.name.trim().length).toBeGreaterThan(2);
      expect(template.description.trim().length).toBeGreaterThan(10);
      expect(template.desired_outcome.trim().length).toBeGreaterThan(10);
      expect(template.steps.length).toBeGreaterThanOrEqual(3);
      expect(template.steps.length).toBeLessThanOrEqual(12);

      for (const step of template.steps) {
        expect(step.title.trim().length).toBeGreaterThan(1);
        expect(step.estimated_minutes).toBeGreaterThanOrEqual(5);
        expect(step.estimated_minutes).toBeLessThanOrEqual(480);
        // Every step carries an example, which the interface labels as one.
        expect(step.example_deliverable).toBeTruthy();
      }
    }
  });

  it("uses unique slugs and can look one up", () => {
    const slugs = TEMPLATE_LIBRARY.map((template) => template.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(TEMPLATE_LIBRARY.map((template) => template.name)).size).toBe(
      TEMPLATE_LIBRARY.length,
    );

    const found = getStaticTemplate("launch-something-small");
    expect(found?.category).toBe("launch");
    expect(getStaticTemplate("not-a-template")).toBeNull();
  });

  it("keeps every template's steps valid for the same schema personal templates use", () => {
    for (const template of TEMPLATE_LIBRARY) {
      const parsed = templateStepsSchema.safeParse(template.steps);
      expect(parsed.success).toBe(true);
    }
  });

  it("adds up the estimates", () => {
    const template = getStaticTemplate("clear-an-admin-pile");
    expect(template).not.toBeNull();
    expect(templateTotalMinutes(template!.steps)).toBe(155);
  });

  it("labels categories in plain words", () => {
    expect(categoryLabel("job")).toBe("Find a job");
    expect(categoryLabel(null)).toBeNull();
  });
});

describe("building a private template from an existing plan", () => {
  const tasks = [
    {
      title: "Write the outline",
      estimated_minutes: 25,
      sort_order: 1,
      // Anything below is not part of the input type, so it cannot be copied.
      instructions: "PRIVATE model instructions",
      first_action: "PRIVATE first action",
      expected_deliverable: "PRIVATE deliverable",
      content: "PRIVATE saved work",
    },
    {
      title: "Draft it",
      estimated_minutes: 60,
      sort_order: 0,
      instructions: "PRIVATE instructions two",
      content: "PRIVATE saved work two",
    },
  ];

  it("copies names and time estimates only", () => {
    const steps = stepsFromTasks(tasks);

    expect(steps).toEqual([
      { title: "Draft it", estimated_minutes: 60, example_deliverable: null },
      { title: "Write the outline", estimated_minutes: 25, example_deliverable: null },
    ]);

    const serialized = JSON.stringify(steps);
    expect(serialized).not.toContain("PRIVATE");
    expect(serialized).not.toContain("instructions");
    expect(serialized).not.toContain("saved work");
  });

  it("does not include saved results, reflections or AI answers", () => {
    // The only fields the function reads are title, estimated_minutes and
    // sort_order; extra data on the object is ignored entirely.
    const taskWithPrivateData: {
      title: string;
      estimated_minutes: number;
      sort_order: number;
      content?: string;
      ai_answer?: string;
    } = {
      title: "One",
      estimated_minutes: 10,
      sort_order: 0,
      content: "a reflection I wrote",
      ai_answer: "an assistant reply",
    };

    const steps = stepsFromTasks([taskWithPrivateData]);

    expect(Object.keys(steps[0])).toEqual([
      "title",
      "estimated_minutes",
      "example_deliverable",
    ]);
    expect(JSON.stringify(steps)).not.toContain("reflection");
    expect(JSON.stringify(steps)).not.toContain("assistant reply");
  });

  it("keeps at most twelve steps, drops blanks and clamps estimates", () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      title: `Step ${index}`,
      estimated_minutes: 10,
      sort_order: index,
    }));

    expect(stepsFromTasks(many)).toHaveLength(12);
    expect(stepsFromTasks([{ title: "  ", estimated_minutes: 20 }])).toEqual([]);
    expect(stepsFromTasks([{ title: "Tiny", estimated_minutes: 1 }])[0].estimated_minutes).toBe(5);
    expect(
      stepsFromTasks([{ title: "Huge", estimated_minutes: 900 }])[0]
        .estimated_minutes,
    ).toBe(480);
    expect(
      stepsFromTasks([{ title: "No estimate", estimated_minutes: null }])[0]
        .estimated_minutes,
    ).toBe(20);
  });

  it("clamps estimates for the editor too", () => {
    expect(clampMinutes(3)).toBe(5);
    expect(clampMinutes(600)).toBe(480);
    expect(clampMinutes(Number.NaN)).toBe(20);
    expect(clampMinutes(47.6)).toBe(48);
  });
});

describe("goal list parameters", () => {
  it("falls back to active goals with nothing filtered", () => {
    expect(parseGoalListParams({})).toEqual(DEFAULT_GOAL_FILTERS);
  });

  it("keeps valid filters and rejects invented ones", () => {
    expect(parseGoalListParams({ q: "portfolio" })).toMatchObject({
      q: "portfolio",
      state: "active",
      category: "all",
      page: 1,
    });
    expect(parseGoalListParams({ state: "archived" }).state).toBe("archived");
    expect(parseGoalListParams({ state: "deleted" }).state).toBe("active");
    expect(parseGoalListParams({ category: "job" }).category).toBe("job");
    expect(parseGoalListParams({ category: "space" }).category).toBe("all");
  });

  it("clamps the page number", () => {
    expect(parseGoalListParams({ page: "3" }).page).toBe(3);
    expect(parseGoalListParams({ page: "0" }).page).toBe(1);
    expect(parseGoalListParams({ page: "-4" }).page).toBe(1);
    expect(parseGoalListParams({ page: "nonsense" }).page).toBe(1);
  });

  it("strips search characters that PostgREST treats as syntax", () => {
    expect(sanitizeSearchTerm("  tax, (2025)  ")).toBe("tax 2025");
    expect(sanitizeSearchTerm('a"b*c')).toBe("a b c");
    expect(sanitizeSearchTerm("x".repeat(200))).toHaveLength(80);
  });

  it("bounds a page of results", () => {
    expect(pageBounds(1, 8, 0)).toEqual({ from: 0, to: 7, page: 1, pageCount: 1 });
    expect(pageBounds(2, 8, 20)).toEqual({ from: 8, to: 15, page: 2, pageCount: 3 });
    // A page past the end is pulled back to the last real page.
    expect(pageBounds(9, 8, 20)).toEqual({ from: 16, to: 23, page: 3, pageCount: 3 });
    expect(pageBounds(0, 8, 8)).toEqual({ from: 0, to: 7, page: 1, pageCount: 1 });
  });

  it("builds links that keep the current filters", () => {
    expect(goalListHref(DEFAULT_GOAL_FILTERS)).toBe("/dashboard");

    const filters = {
      q: "site",
      state: "archived" as const,
      category: "launch" as const,
      page: 1,
    };

    expect(goalListHref(filters)).toBe(
      "/dashboard?q=site&state=archived&category=launch",
    );
    expect(goalListHref(filters, { page: 2 })).toBe(
      "/dashboard?q=site&state=archived&category=launch&page=2",
    );
  });

  it("knows when the list is narrowed", () => {
    expect(hasActiveGoalFilters(DEFAULT_GOAL_FILTERS)).toBe(false);
    expect(hasActiveGoalFilters({ ...DEFAULT_GOAL_FILTERS, q: "x" })).toBe(true);
    expect(
      hasActiveGoalFilters({ ...DEFAULT_GOAL_FILTERS, state: "archived" }),
    ).toBe(true);
  });
});

describe("template use validation", () => {
  const valid = {
    title: "Clear the admin pile",
    desired_outcome: "Everything answered or dropped on purpose.",
    deadline: "",
    time_available_minutes: "30",
    category: "personal",
    steps: [{ title: "Empty the pile", estimated_minutes: 25, example_deliverable: null }],
  };

  it("accepts a customized template", () => {
    const parsed = templateUseSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
  });

  it("rejects an unusable goal title or empty plan", () => {
    expect(templateUseSchema.safeParse({ ...valid, title: "a" }).success).toBe(false);
    expect(templateUseSchema.safeParse({ ...valid, steps: [] }).success).toBe(false);
    expect(
      templateUseSchema.safeParse({
        ...valid,
        steps: [{ title: "x", estimated_minutes: 0, example_deliverable: null }],
      }).success,
    ).toBe(false);
  });

  it("ignores an unknown category rather than trusting it", () => {
    expect(
      templateUseSchema.safeParse({ ...valid, category: "not-real" }).success,
    ).toBe(false);
    // "No category" is allowed and means null in the database.
    expect(templateUseSchema.safeParse({ ...valid, category: "" }).success).toBe(
      true,
    );
  });
});
