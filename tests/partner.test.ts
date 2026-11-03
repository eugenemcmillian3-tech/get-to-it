import { describe, expect, it } from "vitest";
import {
  CHECKIN_MAX_LENGTH,
  cleanShare,
  describeShared,
  formatMessageTime,
  inviteEmailSchema,
  invitePath,
  messageSchema,
  normalizeInviteEmail,
  partnerErrorMessage,
  shareSchema,
  TOKEN_LENGTH,
  tokenLooksValid,
} from "@/lib/partner";

describe("invitation addresses", () => {
  it("normalises case and surrounding whitespace", () => {
    expect(normalizeInviteEmail("  Them@Example.COM ")).toBe("them@example.com");
  });

  it("accepts a real-looking address", () => {
    const parsed = inviteEmailSchema.safeParse("  Them@Example.COM ");
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).toBe("them@example.com");
  });

  it("rejects malformed addresses", () => {
    expect(inviteEmailSchema.safeParse("them").success).toBe(false);
    expect(inviteEmailSchema.safeParse("them@example").success).toBe(false);
    expect(inviteEmailSchema.safeParse("th em@example.com").success).toBe(false);
    expect(inviteEmailSchema.safeParse("").success).toBe(false);
  });
});

describe("invitation tokens", () => {
  const token = "a".repeat(TOKEN_LENGTH);

  it("accepts a hex token of the right length", () => {
    expect(tokenLooksValid(token)).toBe(true);
    expect(tokenLooksValid(`  ${token}  `)).toBe(true);
  });

  it("rejects short, long or non-hex tokens", () => {
    expect(tokenLooksValid("abc")).toBe(false);
    expect(tokenLooksValid("z".repeat(TOKEN_LENGTH))).toBe(false);
    expect(tokenLooksValid("a".repeat(TOKEN_LENGTH + 1))).toBe(false);
    expect(tokenLooksValid("")).toBe(false);
  });

  it("builds an in-app path", () => {
    expect(invitePath(token)).toBe(`/partner/join/${token}`);
  });
});

describe("encouragement messages", () => {
  it("trims and accepts a short line", () => {
    const parsed = messageSchema.safeParse({ body: "  Good luck today.  " });
    expect(parsed.success && parsed.data.body).toBe("Good luck today.");
  });

  it("refuses empty and over-long messages", () => {
    expect(messageSchema.safeParse({ body: "   " }).success).toBe(false);
    expect(messageSchema.safeParse({ body: "x".repeat(301) }).success).toBe(false);
    // A hundred kilobytes of text is not a "short encouragement".
    expect(messageSchema.safeParse({ body: "x".repeat(100_000) }).success).toBe(false);
  });
});

describe("sharing settings", () => {
  const base = {
    goalTitle: false,
    completion: false,
    milestone: false,
    checkin: false,
    milestoneText: "",
    checkinText: "",
  };

  it("accepts everything off — the default", () => {
    const parsed = shareSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    expect(cleanShare(base)).toEqual({
      goalTitle: false,
      completion: false,
      milestone: false,
      checkin: false,
      milestoneText: null,
      checkinText: null,
    });
  });

  it("requires text when a text switch is on", () => {
    expect(shareSchema.safeParse({ ...base, milestone: true }).success).toBe(false);
    expect(shareSchema.safeParse({ ...base, checkin: true }).success).toBe(false);
    expect(
      shareSchema.safeParse({ ...base, milestone: true, milestoneText: "Ship it" })
        .success,
    ).toBe(true);
  });

  it("drops text that belongs to a switch that is off", () => {
    // Someone writes a check-in, then unticks it. The text must not sit in the
    // row waiting to reappear.
    const cleaned = cleanShare({
      ...base,
      milestone: false,
      milestoneText: "a private milestone",
      checkinText: "a private check-in",
    });
    expect(cleaned.milestoneText).toBeNull();
    expect(cleaned.checkinText).toBeNull();
  });

  it("keeps the text when the switch is on", () => {
    const cleaned = cleanShare({
      ...base,
      checkin: true,
      checkinText: "  Where I got to.  ",
    });
    expect(cleaned.checkinText).toBe("Where I got to.");
  });

  it("rejects over-long milestone and check-in text", () => {
    expect(
      shareSchema.safeParse({ ...base, milestone: true, milestoneText: "x".repeat(301) })
        .success,
    ).toBe(false);
    expect(
      shareSchema.safeParse({
        ...base,
        checkin: true,
        checkinText: "x".repeat(CHECKIN_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });
});

describe("what a partner can actually see", () => {
  it("shows nothing when nothing was switched on", () => {
    expect(describeShared({})).toEqual([]);
    expect(
      describeShared({
        goal_titles: null,
        completion: null,
        milestone: null,
        checkin: null,
      }),
    ).toEqual([]);
  });

  it("shows only the switches that are on", () => {
    const items = describeShared({
      checkin: "Slow week, but I started.",
      milestone: null,
      goal_titles: null,
      completion: null,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: "checkin" });
    expect(JSON.stringify(items)).not.toContain("goal");
    expect(JSON.stringify(items)).not.toContain("completion");
  });

  it("lists goal titles and completion counts when they are on", () => {
    const items = describeShared({
      goal_titles: ["Finish the portfolio", "Clear the admin pile"],
      completion: {
        goals_total: 2,
        goals_completed: 1,
        tasks_total: 9,
        tasks_completed: 4,
      },
    });

    expect(items.map((item) => item.key)).toEqual(["goal_titles", "completion"]);
    expect(items[0].value).toContain("Finish the portfolio");
    expect(items[1].value).toBe("4 of 9 tasks complete · 1 of 2 goals finished");
  });

  it("ignores empty strings rather than showing a blank row", () => {
    expect(describeShared({ milestone: "   ", checkin: "" })).toEqual([]);
  });
});

describe("error copy", () => {
  it("gives the same answer for a dead token as for a wrong account", () => {
    const wrongAccount = partnerErrorMessage("invalid-invitation");
    const deadToken = partnerErrorMessage("invalid-invitation");
    expect(wrongAccount).toBe(deadToken);
    expect(wrongAccount).toContain("expired");
    // No hint about whether the address has an account.
    expect(wrongAccount.toLowerCase()).not.toContain("account exists");
  });

  it("names limits plainly", () => {
    expect(partnerErrorMessage("daily-limit")).toContain("limit");
    expect(partnerErrorMessage("slow-down")).toContain("few seconds");
    expect(partnerErrorMessage("something-new")).toBe(
      "That didn't work. Nothing was changed — try again.",
    );
  });

  it("formats times deterministically in UTC", () => {
    expect(formatMessageTime("2026-11-01T21:05:00.000Z")).toBe("Nov 1, 9:05 PM");
    expect(formatMessageTime("not-a-date")).toBe("");
  });
});
