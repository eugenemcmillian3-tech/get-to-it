import { z } from "zod";
import type { PartnerShared } from "@/lib/types";

/**
 * Phase 8 rules that are worth testing without a database: what an invitation
 * address may look like, what a message may contain, and which shared fields
 * are genuinely visible.
 */

export const MESSAGE_DAILY_LIMIT = 20;
export const MESSAGE_MAX_LENGTH = 300;
export const MILESTONE_MAX_LENGTH = 300;
export const CHECKIN_MAX_LENGTH = 1000;
export const INVITATION_DAYS = 7;

export const REPORT_REASONS = [
  { value: "harassment", label: "Harassment or pressure" },
  { value: "spam", label: "Spam or unwanted messages" },
  { value: "impersonation", label: "Pretending to be someone else" },
  { value: "other", label: "Something else" },
] as const;

export function normalizeInviteEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** The address an invitation is sent to. Validated, never looked up. */
export const inviteEmailSchema = z
  .string()
  .transform(normalizeInviteEmail)
  .refine((value) => value.length >= 3 && value.length <= 254, {
    message: "Enter an email address.",
  })
  .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
    message: "That email doesn't look right.",
  });

export const TOKEN_LENGTH = 64;

/** Invitation tokens are two UUID v4s, hex only: 128 bits of randomness. */
export function tokenLooksValid(value: string): boolean {
  return new RegExp(`^[0-9a-f]{${TOKEN_LENGTH}}$`).test(value.trim());
}

export function invitePath(token: string): string {
  return `/partner/join/${token}`;
}

export const messageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write a line before sending.")
    .max(MESSAGE_MAX_LENGTH, "Keep encouragement under 300 characters."),
});

export type ShareInput = {
  goalTitle: boolean;
  completion: boolean;
  milestone: boolean;
  checkin: boolean;
  milestoneText: string;
  checkinText: string;
};

export const shareSchema = z
  .object({
    goalTitle: z.boolean(),
    completion: z.boolean(),
    milestone: z.boolean(),
    checkin: z.boolean(),
    milestoneText: z
      .string()
      .trim()
      .max(MILESTONE_MAX_LENGTH, "Keep the milestone under 300 characters.")
      .default(""),
    checkinText: z
      .string()
      .trim()
      .max(CHECKIN_MAX_LENGTH, "Keep the check-in under 1000 characters.")
      .default(""),
  })
  .refine((value) => !value.milestone || value.milestoneText !== "", {
    message: "Write the milestone you want to share, or untick it.",
    path: ["milestoneText"],
  })
  .refine((value) => !value.checkin || value.checkinText !== "", {
    message: "Write the check-in you want to share, or untick it.",
    path: ["checkinText"],
  });

/**
 * The exact payload sent to the database.
 *
 * A switch that is off also clears its text, so nothing written earlier sits in
 * the row waiting to become visible if the switch is flicked back on.
 */
export function cleanShare(input: ShareInput): {
  goalTitle: boolean;
  completion: boolean;
  milestone: boolean;
  checkin: boolean;
  milestoneText: string | null;
  checkinText: string | null;
} {
  return {
    goalTitle: input.goalTitle,
    completion: input.completion,
    milestone: input.milestone,
    checkin: input.checkin,
    milestoneText: input.milestone ? input.milestoneText.trim() : null,
    checkinText: input.checkin ? input.checkinText.trim() : null,
  };
}

export type SharedItem = {
  key: "goal_titles" | "completion" | "milestone" | "checkin";
  label: string;
  value: string;
};

/**
 * Turns a partner snapshot into the lines a person is allowed to see.
 *
 * A field the partner did not switch on is absent from the snapshot, and is
 * absent from this list too — the UI never receives it and never hides it.
 */
export function describeShared(shared: PartnerShared): SharedItem[] {
  const items: SharedItem[] = [];

  const titles = shared.goal_titles;
  if (Array.isArray(titles) && titles.length > 0) {
    items.push({
      key: "goal_titles",
      label: titles.length === 1 ? "Goal" : "Goals",
      value: titles.join(" · "),
    });
  }

  const completion = shared.completion;
  if (completion) {
    items.push({
      key: "completion",
      label: "Completion",
      value: `${completion.tasks_completed} of ${completion.tasks_total} tasks complete · ${completion.goals_completed} of ${completion.goals_total} goals finished`,
    });
  }

  if (typeof shared.milestone === "string" && shared.milestone.trim() !== "") {
    items.push({ key: "milestone", label: "Milestone", value: shared.milestone });
  }

  if (typeof shared.checkin === "string" && shared.checkin.trim() !== "") {
    items.push({ key: "checkin", label: "Check-in", value: shared.checkin });
  }

  return items;
}

/** A deterministic time label, so server and client render the same text. */
export function formatMessageTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/** Plain-language reasons, kept short and free of blame. */
export function partnerErrorMessage(code: string | undefined): string {
  switch (code) {
    case "invalid-email":
      return "That email doesn't look right.";
    case "own-email":
      return "That's your own address. Invite someone else.";
    case "already-partnered":
      return "One of you already has an active partner.";
    case "already-invited":
      return "You already have a pending invitation. Cancel it to send another.";
    case "invalid-invitation":
      return "That invitation link didn't work. It may have expired, been used, or be for a different account.";
    case "inviter-unavailable":
      return "That invitation can't be accepted right now.";
    case "blocked":
      return "This invitation can't be accepted.";
    case "no-partnership":
      return "That partnership is no longer active.";
    case "missing-milestone":
      return "Write the milestone you want to share.";
    case "missing-checkin":
      return "Write the check-in you want to share.";
    case "invalid-message":
      return "Write a line of 300 characters or fewer.";
    case "slow-down":
      return "Give it a few seconds before sending another.";
    case "daily-limit":
      return "That's today's limit for this thread. It resets tomorrow.";
    case "invalid-reason":
      return "Choose a reason.";
    case "unauthenticated":
      return "Your session expired. Sign in again.";
    default:
      return "That didn't work. Nothing was changed — try again.";
  }
}
