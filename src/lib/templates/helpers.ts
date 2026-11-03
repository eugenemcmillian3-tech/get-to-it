import type { GoalCategory, TemplateStep } from "@/lib/types";
import { GOAL_CATEGORY_SLUGS } from "@/lib/types";

/**
 * Pure helpers for Phase 7: building a template from an existing plan, and
 * reading the goal list's search and filter parameters.
 *
 * Nothing here talks to the network, so the rules that matter — what a private
 * template may contain, and how a page is bounded — are unit tested directly.
 */

export const GOAL_LIST_PAGE_SIZE = 8;

export const EXAMPLE_LABEL = "Example";

export const EXAMPLE_NOTE =
  "Examples show one way this could look. They are starting points, not requirements — change them or drop them.";

export const GOAL_STATES = ["active", "archived", "all"] as const;
export type GoalStateFilter = (typeof GOAL_STATES)[number];

export type GoalListFilters = {
  q: string;
  state: GoalStateFilter;
  category: GoalCategory | "all";
  page: number;
};

export const DEFAULT_GOAL_FILTERS: GoalListFilters = {
  q: "",
  state: "active",
  category: "all",
  page: 1,
};

/**
 * Personal templates copy names and time estimates, nothing else.
 *
 * Saved work (`task_results.content`), AI assistance (`instructions`,
 * `first_action`), reflections and check-ins are never read here, and the
 * input type has nowhere to carry them even if a caller passed them in.
 */
export function stepsFromTasks(
  tasks: {
    title: string;
    estimated_minutes: number | null;
    sort_order?: number | null;
  }[],
): TemplateStep[] {
  const ordered = [...tasks].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  );

  return ordered
    .filter((task) => task.title.trim() !== "")
    .slice(0, 12)
    .map((task) => ({
      title: task.title.trim().slice(0, 200),
      estimated_minutes: clampMinutes(task.estimated_minutes),
      // A personal template carries no example: the person writes their own
      // when they edit the template. This keeps copied content to titles and
      // times.
      example_deliverable: null,
    }));
}

/** Estimates in the interface stay inside the range the task model allows. */
export function clampMinutes(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 20;
  const rounded = Math.round(value);
  if (rounded < 5) return 5;
  if (rounded > 480) return 480;
  return rounded;
}

/** Search terms are passed to PostgREST, which has its own separators. */
export function sanitizeSearchTerm(value: string): string {
  return value
    .trim()
    .slice(0, 80)
    .replace(/[%,()\\*"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string {
  const value = params[key];
  if (Array.isArray(value)) return (value[0] ?? "").trim();
  return (value ?? "").trim();
}

/** Reads and validates the dashboard's query string. Unknown values fall back. */
export function parseGoalListParams(
  params: Record<string, string | string[] | undefined>,
): GoalListFilters {
  const stateParam = readParam(params, "state");
  const categoryParam = readParam(params, "category");
  const pageParam = readParam(params, "page");

  const state = (GOAL_STATES as readonly string[]).includes(stateParam)
    ? (stateParam as GoalStateFilter)
    : DEFAULT_GOAL_FILTERS.state;

  const category = (GOAL_CATEGORY_SLUGS as readonly string[]).includes(
    categoryParam,
  )
    ? (categoryParam as GoalCategory)
    : DEFAULT_GOAL_FILTERS.category;

  const pageNumber = Number.parseInt(pageParam, 10);
  const page =
    Number.isFinite(pageNumber) && pageNumber > 0
      ? Math.min(pageNumber, 10_000)
      : 1;

  return { q: sanitizeSearchTerm(readParam(params, "q")), state, category, page };
}

/** Where a page of results starts and ends, plus how many pages exist. */
export function pageBounds(
  page: number,
  pageSize: number,
  total: number,
): { from: number; to: number; page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, Math.trunc(page) || 1), pageCount);
  const from = (safePage - 1) * pageSize;
  return { from, to: from + pageSize - 1, page: safePage, pageCount };
}

/** A /dashboard link that keeps the current filters when the page changes. */
export function goalListHref(
  filters: GoalListFilters,
  patch: Partial<GoalListFilters> = {},
): string {
  const next = { ...filters, ...patch };
  const params = new URLSearchParams();

  if (next.q) params.set("q", next.q);
  if (next.state !== DEFAULT_GOAL_FILTERS.state) params.set("state", next.state);
  if (next.category !== DEFAULT_GOAL_FILTERS.category) {
    params.set("category", next.category);
  }
  if (next.page > 1) params.set("page", String(next.page));

  const query = params.toString();
  return query ? `/dashboard?${query}` : "/dashboard";
}

/** True when the person has narrowed the list, used for the empty-state copy. */
export function hasActiveGoalFilters(filters: GoalListFilters): boolean {
  return (
    filters.q !== "" ||
    filters.state !== DEFAULT_GOAL_FILTERS.state ||
    filters.category !== DEFAULT_GOAL_FILTERS.category
  );
}
