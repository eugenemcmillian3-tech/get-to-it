import type { GoalCategory, GoalTemplate, TemplateStep } from "@/lib/types";

/**
 * The starting library.
 *
 * These are static: reading, previewing and using a template is ordinary
 * rendering and copying. No model is called, and nothing here is stored in the
 * database, so a template can never drift because one person edited their copy.
 *
 * Every time estimate is a suggestion the person can change before saving.
 * Every deliverable is an example, not a promise or a requirement.
 */

export type TemplateCategoryInfo = {
  slug: GoalCategory;
  label: string;
  blurb: string;
};

export const TEMPLATE_CATEGORIES: TemplateCategoryInfo[] = [
  {
    slug: "launch",
    label: "Launch a project",
    blurb: "Get something small from idea to showable, without waiting for perfect.",
  },
  {
    slug: "job",
    label: "Find a job",
    blurb: "A steady search, and preparation for the conversations that follow.",
  },
  {
    slug: "content",
    label: "Create content",
    blurb: "Publish a thing and keep a rhythm you can actually hold.",
  },
  {
    slug: "learn",
    label: "Learn a skill",
    blurb: "Start from nothing and reach the point of usefulness.",
  },
  {
    slug: "personal",
    label: "Organize personal tasks",
    blurb: "Clear a pile of small things that keeps stealing your attention.",
  },
  {
    slug: "business",
    label: "Build a business",
    blurb: "Talk to real people and make a clear offer, one step at a time.",
  },
];

function step(
  title: string,
  estimatedMinutes: number,
  exampleDeliverable: string,
): TemplateStep {
  return {
    title,
    estimated_minutes: estimatedMinutes,
    example_deliverable: exampleDeliverable,
  };
}

export const TEMPLATE_LIBRARY: GoalTemplate[] = [
  {
    slug: "launch-something-small",
    category: "launch",
    name: "Launch something small",
    description:
      "A short path from a vague idea to something you can put in front of one person.",
    desired_outcome:
      "A working version you can show to one person, plus their honest reaction.",
    steps: [
      step(
        "Write the one-sentence version",
        20,
        "One sentence you could say out loud without explaining it.",
      ),
      step(
        "Decide what version one leaves out",
        25,
        "A short list of things you are deliberately not doing yet.",
      ),
      step(
        "Build the smallest working version",
        90,
        "Something that runs end to end, even if it looks rough.",
      ),
      step(
        "Show it to one person",
        30,
        "One message sent with a link, a file or a photo attached.",
      ),
      step(
        "Write down what you would change next",
        15,
        "Three notes from their reaction and one next step.",
      ),
    ],
  },
  {
    slug: "launch-a-portfolio-page",
    category: "launch",
    name: "Get one portfolio page live",
    description:
      "Enough of a portfolio to be useful, without building a whole site first.",
    desired_outcome:
      "A public page with three pieces of your work and a way for someone to reach you.",
    steps: [
      step(
        "Choose the three pieces to show",
        30,
        "A list of three pieces and why each one is there.",
      ),
      step(
        "Write one line about each piece",
        40,
        "Three short captions: what it was, what you did.",
      ),
      step(
        "Put the page together",
        90,
        "A single page that works on a phone.",
      ),
      step(
        "Check the contact route works",
        15,
        "A message sent to yourself from the page and received.",
      ),
      step("Publish and note the address", 30, "A link you can paste into a message."),
    ],
  },
  {
    slug: "run-a-steady-job-search",
    category: "job",
    name: "Run a steady job search",
    description:
      "A search you can keep up for weeks, instead of a burst that burns you out.",
    desired_outcome:
      "A short list of real openings, applications sent, and a simple way to track replies.",
    steps: [
      step(
        "Write the version of the job you want",
        20,
        "Two or three sentences naming the role, the kind of team, and what you would stop doing.",
      ),
      step(
        "Collect ten real openings",
        45,
        "Ten links saved with the closing date next to each one.",
      ),
      step(
        "Update the two documents you actually need",
        90,
        "A current CV and one message you can adapt.",
      ),
      step(
        "Send three applications",
        90,
        "Three sent, each with the role name in the subject line.",
      ),
      step(
        "Set a weekly check-in with yourself",
        10,
        "A repeating 20-minute slot to review replies and send the next batch.",
      ),
    ],
  },
  {
    slug: "prepare-for-an-interview",
    category: "job",
    name: "Prepare for an interview",
    description:
      "Preparation that fits in a couple of short sittings, so the day is not the first time you say it out loud.",
    desired_outcome:
      "Answers you have said out loud, questions ready to ask, and the practical details settled.",
    steps: [
      step(
        "Write down what they are likely to ask",
        25,
        "Five questions, taken from the posting and the role.",
      ),
      step(
        "Draft your three main stories",
        45,
        "Three short notes: the situation, what you did, what changed.",
      ),
      step(
        "Say the answers out loud once",
        30,
        "A recording or a run-through with a person you trust.",
      ),
      step(
        "Prepare three questions to ask them",
        20,
        "Three questions you actually want answered.",
      ),
      step(
        "Settle the practical details",
        15,
        "Time, place or link, travel plan, and what you are bringing.",
      ),
    ],
  },
  {
    slug: "start-a-posting-rhythm",
    category: "content",
    name: "Start a posting rhythm",
    description:
      "A cadence small enough to survive a busy week, built around ideas you already have.",
    desired_outcome:
      "Two pieces published, and a list of ideas that will carry the next few weeks.",
    steps: [
      step(
        "Choose the format and the cadence",
        20,
        "One sentence: what you post, and how often.",
      ),
      step(
        "Collect ten ideas from your own notes",
        30,
        "Ten lines you could turn into something.",
      ),
      step(
        "Draft the first piece",
        45,
        "A rough draft you would be willing to publish.",
      ),
      step("Publish it", 20, "A live link."),
      step(
        "Draft and publish the second piece",
        60,
        "A second live link, and one note on what felt hard.",
      ),
    ],
  },
  {
    slug: "write-one-newsletter-issue",
    category: "content",
    name: "Write one newsletter issue",
    description:
      "One issue, start to send, so the next one has a shape to follow.",
    desired_outcome:
      "One issue written, checked and sent, with a repeatable outline saved.",
    steps: [
      step("Pick the single point of the issue", 20, "One sentence the reader should remember."),
      step(
        "Write the body in one sitting",
        60,
        "A draft with an opening, the point, and a closing line.",
      ),
      step(
        "Edit for length and clarity",
        30,
        "A draft with every sentence you would cut, cut.",
      ),
      step(
        "Add the practical parts",
        20,
        "A subject line, a preview line, and working links.",
      ),
      step(
        "Send it and save the outline",
        20,
        "Sent, and your outline saved as a template for next time.",
      ),
    ],
  },
  {
    slug: "learn-a-skill-to-useful",
    category: "learn",
    name: "Learn a skill to first usefulness",
    description:
      "A first pass at a new skill that ends with you able to do something real.",
    desired_outcome:
      "One small thing made with the skill, and a clear idea of what to learn next.",
    steps: [
      step(
        "Define what useful would look like",
        20,
        "One sentence describing something you could do that you cannot do today.",
      ),
      step(
        "Find one primary source and work through the first part",
        60,
        "Notes from the first chapter, lesson or tutorial.",
      ),
      step(
        "Practise the smallest complete piece",
        45,
        "A tiny finished exercise, not just reading.",
      ),
      step(
        "Make something you actually want",
        90,
        "One small thing of your own, however rough.",
      ),
      step(
        "Note what to learn next",
        15,
        "Three specific gaps and the one you will tackle first.",
      ),
    ],
  },
  {
    slug: "learn-by-finishing-a-small-project",
    category: "learn",
    name: "Learn by finishing a small project",
    description:
      "For people who learn best by building, and who need a finish line inside a week or two.",
    desired_outcome:
      "A finished small project you can point at, and notes on what you had to learn to get there.",
    steps: [
      step(
        "Pick a project you can finish in two weeks",
        20,
        "A one-paragraph description with a visible end state.",
      ),
      step(
        "Break it into four or five sittings",
        30,
        "A list of sittings, each with a concrete output.",
      ),
      step(
        "Do the first sitting",
        60,
        "The first output, however incomplete.",
      ),
      step(
        "Work through the middle sittings",
        120,
        "Progress you can see, with blockers written down as they appear.",
      ),
      step(
        "Finish it and write what you learned",
        30,
        "A finished project plus five notes on what you now understand.",
      ),
    ],
  },
  {
    slug: "clear-an-admin-pile",
    category: "personal",
    name: "Clear the admin pile",
    description:
      "For the stack of small obligations that is quietly taking up space in your head.",
    desired_outcome:
      "Everything in the pile is answered, booked, filed or deliberately dropped.",
    steps: [
      step(
        "Empty the pile into one list",
        25,
        "Every item written down, including the small ones.",
      ),
      step(
        "Mark the three that actually have a deadline",
        15,
        "Three items with dates, and everything else dated 'no deadline'.",
      ),
      step(
        "Do the three dated items",
        60,
        "Three sent, booked or paid.",
      ),
      step(
        "Deal with the rest in one sitting",
        45,
        "Each remaining item answered, filed, or dropped on purpose.",
      ),
      step(
        "Write down the two things that keep coming back",
        10,
        "A reminder or routine for the recurring ones.",
      ),
    ],
  },
  {
    slug: "reset-one-room",
    category: "personal",
    name: "Reset one room",
    description:
      "One room, four passes, no full-day clear-out required.",
    desired_outcome:
      "A room you can use without moving something first, and a home for the things that were homeless.",
    steps: [
      step("Clear one surface completely", 20, "One surface with nothing on it."),
      step(
        "Collect everything that has no home",
        25,
        "One box or bag of homeless things.",
      ),
      step(
        "Give each thing a home or let it go",
        30,
        "A box that is now empty, and things you are ready to pass on.",
      ),
      step(
        "Do the floor and the last flat surface",
        20,
        "Floor clear, and the room usable.",
      ),
    ],
  },
  {
    slug: "talk-to-first-potential-customers",
    category: "business",
    name: "Talk to your first potential customers",
    description:
      "Conversations before building, so the offer is shaped by something real.",
    desired_outcome:
      "Five real conversations, written notes, and one clear change to your offer.",
    steps: [
      step(
        "Write who has this problem already",
        25,
        "A list of ten people or places where these people already are.",
      ),
      step(
        "Write a two-line message asking for a conversation",
        20,
        "One message you would be comfortable sending.",
      ),
      step("Send it to five people", 20, "Five sent messages."),
      step(
        "Have the conversations and take notes",
        90,
        "Notes from each call: what they do now, what it costs them.",
      ),
      step(
        "Change one thing in your offer",
        30,
        "One specific change, written down with the reason.",
      ),
    ],
  },
  {
    slug: "publish-a-simple-offer",
    category: "business",
    name: "Publish a simple offer",
    description:
      "A clear, honest offer someone could say yes to, without a sales page.",
    desired_outcome:
      "One page describing what you do, who it is for, what it costs, and how to start.",
    steps: [
      step(
        "Write the result you help with",
        25,
        "One sentence naming the outcome, not the process.",
      ),
      step(
        "Say who it is not for",
        15,
        "One line that would let the wrong person rule themselves out.",
      ),
      step("Set a price and a scope", 30, "A price and what is included."),
      step(
        "Write the page",
        60,
        "A single page with the offer, the price and one way to get in touch.",
      ),
      step(
        "Send it to three people who might know someone",
        20,
        "Three messages with the link.",
      ),
    ],
  },
  {
    slug: "premium-release-readiness",
    premium: true,
    category: "launch",
    name: "Release readiness review",
    description:
      "A disciplined pass over the release that catches the expensive mistakes before other people do.",
    desired_outcome:
      "A release candidate with named checks, a rollback route, and one person who owns the decision.",
    steps: [
      step(
        "Freeze the exact release candidate",
        25,
        "A version, commit or snapshot reference plus the date it was frozen.",
      ),
      step(
        "Write the five checks that would block release",
        30,
        "Five specific pass/fail checks, not general hopes.",
      ),
      step(
        "Run every check and keep the evidence",
        75,
        "A result for each check, with a link or log attached.",
      ),
      step(
        "Name the rollback route and the decision owner",
        25,
        "One named person, one rollback step, and the signal that triggers it.",
      ),
      step(
        "Do a short post-release watch",
        30,
        "A 24-hour check of the one metric that would show harm.",
      ),
    ],
  },
  {
    slug: "premium-offer-teardown",
    premium: true,
    category: "business",
    name: "Offer teardown sprint",
    description:
      "Take one existing offer apart and rebuild only the part that is actually costing you yeses.",
    desired_outcome:
      "A clearer offer, a tested message, and a record of what changed and why.",
    steps: [
      step(
        "Write the offer exactly as a buyer hears it",
        20,
        "The promise, price, time to result and what is excluded, in plain words.",
      ),
      step(
        "Collect three real objections",
        35,
        "Three quotes or paraphrases from people who did not buy.",
      ),
      step(
        "Find the single weakest promise",
        30,
        "One sentence naming the gap between the promise and the proof.",
      ),
      step(
        "Rewrite only that part of the offer",
        45,
        "A before-and-after version with one stronger proof point.",
      ),
      step(
        "Test the new version with five people",
        45,
        "Five reactions and a decision to keep, change or discard the rewrite.",
      ),
    ],
  },
];

/** Look up a static template by its address-safe slug. */
export function getStaticTemplate(slug: string): GoalTemplate | null {
  return TEMPLATE_LIBRARY.find((template) => template.slug === slug) ?? null;
}

export function categoryLabel(category: GoalCategory | null): string | null {
  if (!category) return null;
  return (
    TEMPLATE_CATEGORIES.find((entry) => entry.slug === category)?.label ?? null
  );
}

/** The library grouped for display, in the order the categories are declared. */
export function templatesByCategory(): {
  category: TemplateCategoryInfo;
  templates: GoalTemplate[];
}[] {
  return TEMPLATE_CATEGORIES.map((category) => ({
    category,
    templates: TEMPLATE_LIBRARY.filter(
      (template) => template.category === category.slug,
    ),
  })).filter((group) => group.templates.length > 0);
}

export function templateTotalMinutes(
  steps: { estimated_minutes: number }[],
): number {
  return steps.reduce((total, item) => total + item.estimated_minutes, 0);
}
