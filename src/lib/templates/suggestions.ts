import type { GoalCategory } from "@/lib/types";

/**
 * Starting points for the parts of a template a person still has to fill in.
 *
 * These are deliberately concrete and a little opinionated: a deadline, a
 * realistic slice of time and one honest obstacle. They are suggestions the
 * form can apply, never values saved on their own.
 */
export type TemplateSuggestion = {
  focus: string;
  blocker: string;
  timeAvailable: number;
  deadlineDays: number;
};

const SUGGESTIONS: Record<GoalCategory, TemplateSuggestion> = {
  launch: {
    focus: "Ship the smallest version that can get a real reaction.",
    blocker: "I keep polishing instead of showing it to anyone.",
    timeAvailable: 45,
    deadlineDays: 14,
  },
  job: {
    focus: "Send three good applications, not thirty rushed ones.",
    blocker: "I rewrite the same message until it sounds like nobody.",
    timeAvailable: 45,
    deadlineDays: 21,
  },
  content: {
    focus: "Publish one useful piece and let it be enough.",
    blocker: "I wait for the idea to feel finished before posting.",
    timeAvailable: 30,
    deadlineDays: 14,
  },
  learn: {
    focus: "Practise the part I keep avoiding, not the part I already know.",
    blocker: "I collect tutorials instead of doing the exercise.",
    timeAvailable: 30,
    deadlineDays: 30,
  },
  personal: {
    focus: "Clear the smallest pile that keeps stealing my attention.",
    blocker: "I start five small things and finish none of them.",
    timeAvailable: 20,
    deadlineDays: 7,
  },
  business: {
    focus: "Talk to one real person before building anything else.",
    blocker: "I keep researching the market instead of asking a customer.",
    timeAvailable: 45,
    deadlineDays: 21,
  },
};

const FALLBACK: TemplateSuggestion = {
  focus: "Make the next step small enough to start today.",
  blocker: "I am not sure which first step actually matters.",
  timeAvailable: 30,
  deadlineDays: 14,
};

export function suggestionForCategory(
  category: GoalCategory | null,
): TemplateSuggestion {
  return category ? SUGGESTIONS[category] : FALLBACK;
}

/** A local calendar date `days` from today, in the form a date input expects. */
export function suggestedDeadline(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
