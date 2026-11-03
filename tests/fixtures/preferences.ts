/**
 * Fixtures for the preference tests.
 *
 * These stand in for saved rows, open tasks and the goal/task shape the AI
 * prompt builders expect, so the prompt rules can be tested without a model,
 * a browser or a database.
 */

import type { DailyPlanCandidate, Goal, Task, UserPreferences } from "@/lib/types";

export const EMPTY_PREFERENCES: UserPreferences = {
  user_id: "11111111-1111-4111-8111-111111111111",
  session_length_minutes: null,
  work_days: null,
  work_start: null,
  work_end: null,
  task_size: null,
  communication_style: null,
  help_topics: null,
  personalization_enabled: true,
  updated_at: null,
};

export const FULL_PREFERENCES: UserPreferences = {
  user_id: "11111111-1111-4111-8111-111111111111",
  session_length_minutes: 15,
  work_days: [1, 2, 3, 4, 5],
  work_start: "09:00",
  work_end: "17:00",
  task_size: "small",
  communication_style: "concise",
  help_topics: ["portfolio site", "job applications"],
  personalization_enabled: true,
  updated_at: "2026-11-02T09:00:00.000Z",
};

export const DISABLED_PREFERENCES: UserPreferences = {
  ...FULL_PREFERENCES,
  personalization_enabled: false,
};

export const OTHER_USER_PREFERENCES: UserPreferences = {
  ...FULL_PREFERENCES,
  user_id: "22222222-2222-4222-8222-222222222222",
  session_length_minutes: 90,
};

export function candidate(
  id: string,
  title: string,
  estimatedMinutes: number | null,
  status: DailyPlanCandidate["status"] = "todo",
): DailyPlanCandidate {
  return {
    id,
    title,
    status,
    estimated_minutes: estimatedMinutes,
    goal_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    goal_title: "Portfolio site",
  };
}

export const PLAN_CANDIDATES: DailyPlanCandidate[] = [
  candidate("b0000000-0000-4000-8000-000000000001", "Pick three screenshots", 20),
  candidate("b0000000-0000-4000-8000-000000000002", "Draft the hero copy", 45),
  candidate("b0000000-0000-4000-8000-000000000003", "Write the case study", null),
  candidate("b0000000-0000-4000-8000-000000000004", "Publish the page", 30),
];

export const GOAL: Pick<
  Goal,
  "title" | "desired_outcome" | "deadline" | "time_available_minutes" | "blocker"
> = {
  title: "Finish my portfolio site",
  desired_outcome: "A live site with three case studies",
  deadline: "2026-12-01",
  time_available_minutes: 30,
  blocker: "I keep rewriting the hero",
};

export const TASK: Pick<
  Task,
  | "title"
  | "status"
  | "instructions"
  | "first_action"
  | "expected_deliverable"
  | "estimated_minutes"
> = {
  title: "Draft the hero copy",
  status: "todo",
  instructions: "Write three headline options and pick one.",
  first_action: "Open the draft.",
  expected_deliverable: "One headline saved.",
  estimated_minutes: 25,
};
