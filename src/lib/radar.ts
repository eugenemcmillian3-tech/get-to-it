/**
 * Phase 18 — the opt-in "what's changing?" radar, as pure rules.
 *
 * Ground rules encoded here:
 *   * A signal is something the person recorded after reading a source. This
 *     build fetches nothing: there is no crawler, no feed reader, no login to a
 *     third-party site and no private account access. The source link is
 *     stored for attribution, never opened by the app.
 *   * Publication date and retrieval date are separate and both shown. An old
 *     item is marked as older; nothing is dressed up as breaking.
 *   * The six signal kinds are distinct labels, and an announcement stays an
 *     announcement. A confident promotional claim is never shown as a fact or
 *     as something released.
 *   * Relevance uses only the topics the person follows and the goal title they
 *     chose to connect. Nothing infers a trait, location or circumstance.
 *   * Signals never change a plan on their own. Preparing a task or a learning
 *     goal is a separate, explicitly pressed action.
 */

import { z } from "zod";
import type { RadarSignal, RadarSignalKind, RadarTopicSlug } from "@/lib/types";

export const RADAR_TOPICS = [
  { slug: "ai", label: "AI and automation" },
  { slug: "work", label: "Work and careers" },
  { slug: "business", label: "Business and entrepreneurship" },
  { slug: "education", label: "Education" },
  { slug: "community", label: "Community needs" },
  { slug: "policy", label: "Technology and public policy" },
] as const;

export const RADAR_TOPIC_SLUGS: RadarTopicSlug[] = RADAR_TOPICS.map(
  (topic) => topic.slug,
);

export const TOPIC_DETAILS: Record<RadarTopicSlug, string> = {
  ai: "Models, automation and tools that change how work gets done.",
  work: "Hiring, roles, skills and how people earn a living.",
  business: "Small business, self-employment and starting something.",
  education: "Courses, credentials, schools and learning outside them.",
  community: "Local services, volunteering, care and neighbourhood needs.",
  policy: "Rules, public spending and decisions that affect technology use.",
};

export const SIGNAL_KINDS = [
  {
    slug: "announced",
    label: "Announced capability",
    note: "Stated as planned or coming. It is not available yet, and the date may slip.",
  },
  {
    slug: "released",
    label: "Released capability",
    note: "The source says it is available to use now. You have not tried it yourself.",
  },
  {
    slug: "research",
    label: "Research result",
    note: "A result as the source reports it. One result is not a settled finding.",
  },
  {
    slug: "opinion",
    label: "Opinion",
    note: "One person's or organisation's view, not a measurement.",
  },
  {
    slug: "speculation",
    label: "Speculation",
    note: "A possibility or projection. It may never happen, and no plan should assume it.",
  },
  {
    slug: "observed",
    label: "Observed change",
    note: "A change someone measured or saw, as described by the source.",
  },
] as const;

export const MAX_HEADLINE = 200;
export const MAX_UNCERTAINTY = 600;
export const MAX_SOURCE_NAME = 80;
export const MAX_SOURCE_URL = 500;
export const MAX_PLACE = 80;
export const OLDER_THAN_DAYS = 30;
export const EARLIEST_PUBLISHED = "1990-01-01";

export const SOURCE_HONESTY_NOTE =
  "GET TO IT does not fetch, crawl or scrape pages. You record what you read, with its source and dates; nothing enters this radar without you.";

export const TIMESTAMP_NOTE =
  "Published is when the source says the item appeared. Retrieved is when you recorded it here. They are different dates and are never merged.";

export const RELEVANCE_NOTE =
  "Why this may relate uses only the topics you follow and the goal title you connect. It does not infer anything else about you.";

export const NO_PREDICTION_NOTE =
  "A signal is not a prediction, a job-loss forecast or an investment signal, and it never changes your plans by itself.";

export const PROMOTION_NOTE =
  "A company saying something is coming is an announced capability, not a released one, and not a fact. Confidence in the wording changes nothing.";

export const KIND_LABELS: Record<RadarSignalKind, string> = SIGNAL_KINDS.reduce(
  (labels, kind) => ({ ...labels, [kind.slug]: kind.label }),
  {} as Record<RadarSignalKind, string>,
);

export function isRadarTopic(value: string): value is RadarTopicSlug {
  return (RADAR_TOPIC_SLUGS as string[]).includes(value);
}

export function isSignalKind(value: string): value is RadarSignalKind {
  return SIGNAL_KINDS.some((kind) => kind.slug === value);
}

export function topicLabel(slug: string): string {
  return RADAR_TOPICS.find((topic) => topic.slug === slug)?.label ?? slug;
}

export function kindLabel(slug: string): string {
  return isSignalKind(slug) ? KIND_LABELS[slug] : slug;
}

export function kindNote(slug: string): string {
  return SIGNAL_KINDS.find((kind) => kind.slug === slug)?.note ?? "";
}

/** Keeps only known topics, in catalogue order, without duplicates. */
export function parseTopicSelection(values: readonly string[]): RadarTopicSlug[] {
  const chosen = new Set(values.map((value) => value.trim()).filter(isRadarTopic));
  return RADAR_TOPIC_SLUGS.filter((slug) => chosen.has(slug));
}

/**
 * A stable comparison form of a source link: host without `www`, path without
 * a trailing slash, campaign parameters removed. Path case is preserved because
 * two paths can differ only by case.
 */
export function canonicalSourceUrl(raw: string): string | null {
  const value = raw.trim();
  if (value === "") return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "") return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "") return null;

  const path = url.pathname.replace(/\/+$/, "") || "/";

  const kept = [...url.searchParams.entries()]
    .filter(([key]) => !/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$)/i.test(key))
    .sort(([a], [b]) => a.localeCompare(b));

  const query =
    kept.length === 0
      ? ""
      : `?${kept
          .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
          .join("&")}`;

  return `${host}${path}${query}`;
}

/**
 * The same source at the same publication date is the same signal, even if the
 * headline was retyped. The database holds a unique index on this key, so a
 * duplicate is refused rather than silently stored twice.
 */
export function dedupeKey(sourceUrl: string, publishedOn: string): string {
  const canonical = canonicalSourceUrl(sourceUrl);
  if (!canonical) return "";
  return `${canonical}|${publishedOn}`.slice(0, 300);
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "::1" || host === "[::1]") return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;

  const second = /^172\.(\d{1,3})\./.exec(host);
  if (second) {
    const octet = Number(second[1]);
    if (octet >= 16 && octet <= 31) return true;
  }

  return false;
}

export function sourceUrlProblem(raw: string): string | null {
  const value = raw.trim();
  if (value === "") return "Add the link to the original source.";
  if (value.length > MAX_SOURCE_URL) {
    return `That link is longer than ${MAX_SOURCE_URL} characters. Use the article's own address.`;
  }
  if (canonicalSourceUrl(value) === null) {
    return "That doesn't look like a public http or https link. Use the address of the page you read, without a username or password in it.";
  }

  let hostname = "";
  try {
    hostname = new URL(value).hostname;
  } catch {
    return "That doesn't look like a public http or https link.";
  }

  if (isPrivateHost(hostname)) {
    return "That is a local or private address, not a public source. Use the public page address.";
  }

  return null;
}

export function publishedOnProblem(value: string, today: string): string | null {
  const raw = value.trim();
  if (raw === "") return "Add the date the source published it.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "Use a date in the form YYYY-MM-DD.";

  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    return "That date doesn't exist. Check the day and month.";
  }
  if (raw > today) {
    return "A publication date can't be in the future. If it isn't published yet, it is announced rather than reported.";
  }
  if (raw < EARLIEST_PUBLISHED) {
    return `Check that date — ${EARLIEST_PUBLISHED} is the earliest accepted.`;
  }
  return null;
}

export function dayDistance(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

/** Never calls an old item new. The retrieval date is shown separately. */
export function freshnessLabel(publishedOn: string, today: string): string {
  const days = dayDistance(publishedOn, today);

  if (days <= 0) return "Published today";
  if (days === 1) return "Published yesterday";
  if (days > OLDER_THAN_DAYS) {
    return `Published ${days} days ago — older item, not new`;
  }
  return `Published ${days} days ago`;
}

export function isOlder(publishedOn: string, today: string): boolean {
  return dayDistance(publishedOn, today) > OLDER_THAN_DAYS;
}

/**
 * The explanation the card shows. It names only what the person configured:
 * a followed topic and, optionally, one of their own goal titles.
 */
export function relevanceNote({
  topic,
  followed,
  goalTitle,
}: {
  topic: string;
  followed: readonly string[];
  goalTitle: string | null;
}): string {
  const follows = followed.includes(topic);

  if (follows && goalTitle) {
    return `You follow ${topicLabel(topic)} and have this related goal: “${goalTitle}”.`;
  }
  if (follows) {
    return `You follow ${topicLabel(topic)}. No goal is connected yet, so this is background until you link one.`;
  }
  if (goalTitle) {
    return `You connected this to your goal “${goalTitle}”. You are not following ${topicLabel(topic)} now.`;
  }
  return "You are not following this topic and no goal is connected. This is saved without a personal link.";
}

export function filterSignals(
  signals: readonly RadarSignal[],
  options: {
    topic?: string | null;
    savedOnly?: boolean;
    mutedTopics?: readonly string[];
    includeDismissed?: boolean;
  } = {},
): RadarSignal[] {
  const { topic = null, savedOnly = false, mutedTopics = [], includeDismissed = false } =
    options;

  return signals.filter((signal) => {
    if (!includeDismissed && signal.dismissed_at !== null) return false;
    if (mutedTopics.includes(signal.topic)) return false;
    if (savedOnly && signal.saved_at === null) return false;
    if (topic !== null && signal.topic !== topic) return false;
    return true;
  });
}

/** Newest publication first, then the most recently recorded. */
export function sortSignals(signals: readonly RadarSignal[]): RadarSignal[] {
  return [...signals].sort((a, b) => {
    if (a.published_on !== b.published_on) {
      return a.published_on < b.published_on ? 1 : -1;
    }
    if (a.retrieved_at !== b.retrieved_at) {
      return a.retrieved_at < b.retrieved_at ? 1 : -1;
    }
    return a.id < b.id ? 1 : -1;
  });
}

function clip(text: string, max: number): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

export function preparationTaskTitle(signal: RadarSignal): string {
  return clip(`Check what “${signal.headline}” could mean for you`, 180);
}

export function preparationTaskInstructions(
  signal: RadarSignal,
  goalTitle: string | null,
): string {
  const lines = [
    `Signal: ${signal.headline}`,
    `Source: ${signal.source_name} — ${signal.source_url}`,
    `Published ${signal.published_on}; recorded in GET TO IT on ${signal.retrieved_at.slice(0, 10)}.`,
    `Kind: ${kindLabel(signal.kind)} — ${kindNote(signal.kind)}`,
    `What remains uncertain: ${signal.uncertainty}`,
    goalTitle
      ? `Connected goal: ${goalTitle}.`
      : "No goal was connected when this task was made.",
    "One small step: spend 20 minutes checking whether this changes anything in that goal, then write down what, if anything, you would do differently.",
    "If nothing changes, write that down and stop. This is preparation, not a prediction, and nothing in your plan changed automatically.",
  ];

  return lines.join("\n\n");
}

export function learningGoalTitle(signal: RadarSignal): string {
  return clip(`Understand “${signal.headline}”`, 180);
}

export function learningGoalOutcome(signal: RadarSignal): string {
  return [
    `Be able to explain “${signal.headline}” in my own words.`,
    `Separate what the source reports from what is still uncertain (${kindLabel(signal.kind)}).`,
    `Decide whether it changes anything I am working on.`,
    `Source: ${signal.source_name} — ${signal.source_url} (published ${signal.published_on}).`,
  ].join(" ");
}

/**
 * Validation for one recorded signal. Date and link checks stay in the helpers
 * above so the same rules are tested without a database or a clock.
 */
export const signalInputSchema = z.object({
  topic: z
    .string()
    .trim()
    .refine(isRadarTopic, "Choose one of the topics you follow."),
  kind: z
    .string()
    .trim()
    .refine(isSignalKind, "Choose what kind of signal this is."),
  headline: z
    .string()
    .trim()
    .min(8, "Describe what was reported, in at least 8 characters.")
    .max(MAX_HEADLINE, `Keep the headline under ${MAX_HEADLINE} characters.`),
  source_name: z
    .string()
    .trim()
    .min(2, "Name the source.")
    .max(MAX_SOURCE_NAME, `Keep the source name under ${MAX_SOURCE_NAME} characters.`),
  source_url: z.string().trim().min(1, "Add the link to the original source."),
  published_on: z.string().trim().min(1, "Add the date the source published it."),
  geography: z
    .string()
    .trim()
    .max(MAX_PLACE, `Keep the place under ${MAX_PLACE} characters.`),
  sector: z
    .string()
    .trim()
    .max(MAX_PLACE, `Keep the sector under ${MAX_PLACE} characters.`),
  uncertainty: z
    .string()
    .trim()
    .min(10, "Say what remains uncertain, in at least 10 characters.")
    .max(MAX_UNCERTAINTY, `Keep the uncertainty under ${MAX_UNCERTAINTY} characters.`),
  goal_id: z.string().trim(),
});

export type SignalInput = z.infer<typeof signalInputSchema>;
