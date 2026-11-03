import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEEKDAYS,
  deliveryKey,
  deliveryOutcome,
  dueLabel,
  formatTime12,
  isQuietHours,
  isValidTimeZone,
  localClock,
  localDate,
  normalizeWeekdays,
  parseTimeOfDay,
  weekdaySummary,
} from "@/lib/reminders";

describe("parseTimeOfDay", () => {
  it("normalises a valid time", () => {
    expect(parseTimeOfDay("9:05")).toBe("09:05");
    expect(parseTimeOfDay("09:05:00")).toBe("09:05");
    expect(parseTimeOfDay("23:59")).toBe("23:59");
  });

  it("rejects impossible times", () => {
    expect(parseTimeOfDay("24:00")).toBeNull();
    expect(parseTimeOfDay("09:60")).toBeNull();
    expect(parseTimeOfDay("nine")).toBeNull();
    expect(parseTimeOfDay("")).toBeNull();
  });
});

describe("isQuietHours", () => {
  it("covers a night that wraps midnight", () => {
    expect(isQuietHours("23:30", "21:00", "08:00")).toBe(true);
    expect(isQuietHours("02:00", "21:00", "08:00")).toBe(true);
    expect(isQuietHours("08:00", "21:00", "08:00")).toBe(false);
    expect(isQuietHours("12:00", "21:00", "08:00")).toBe(false);
  });

  it("covers a same-day window", () => {
    expect(isQuietHours("13:30", "12:00", "14:00")).toBe(true);
    expect(isQuietHours("12:00", "12:00", "14:00")).toBe(true);
    expect(isQuietHours("14:00", "12:00", "14:00")).toBe(false);
  });

  it("treats an empty window as no quiet hours", () => {
    expect(isQuietHours("03:00", "09:00", "09:00")).toBe(false);
  });
});

describe("time formatting and weekdays", () => {
  it("formats a 12-hour clock", () => {
    expect(formatTime12("09:00")).toBe("9:00 am");
    expect(formatTime12("13:05")).toBe("1:05 pm");
    expect(formatTime12("00:00")).toBe("12:00 am");
    expect(formatTime12("12:00")).toBe("12:00 pm");
  });

  it("deduplicates and sorts weekdays", () => {
    expect(normalizeWeekdays([5, 1, 1, 9, -1])).toEqual([1, 5]);
  });

  it("summarises weekday sets", () => {
    expect(weekdaySummary([1, 2, 3, 4, 5])).toBe("Weekdays");
    expect(weekdaySummary([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
    expect(weekdaySummary([0, 6])).toBe("Weekends");
    expect(weekdaySummary([1, 3])).toBe("Mon, Wed");
    expect(weekdaySummary([])).toBe("No days selected");
    expect(weekdaySummary(DEFAULT_WEEKDAYS)).toBe("Weekdays");
  });
});

describe("timezone helpers", () => {
  it("accepts real zones and rejects invented ones", () => {
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });

  it("reads the local clock and date in a zone", () => {
    const instant = new Date("2026-11-01T23:30:00Z");
    expect(localClock("UTC", instant)).toBe("23:30");
    expect(localClock("Europe/London", instant)).toBe("23:30");
    expect(localDate("UTC", instant)).toBe("2026-11-01");
    expect(localDate("Pacific/Auckland", instant)).toBe("2026-11-02");
  });

  it("labels a due time in the person's zone", () => {
    const label = dueLabel("2026-11-02T09:00:00.000Z", "UTC");
    expect(label).toContain("09:00");
    expect(dueLabel(null, "UTC")).toBeNull();
  });
});

describe("delivery decisions (stubbed, no network)", () => {
  const now = new Date("2026-11-02T09:05:00Z");
  const base = {
    enabled: true,
    settingsEnabled: true,
    dueAt: "2026-11-02T09:00:00.000Z",
    quietNow: false,
    targetCompleted: false,
  };

  it("delivers a due, enabled, unfinished reminder", () => {
    expect(deliveryOutcome(base, now)).toBe("deliver");
  });

  it("does not deliver twice for the same due slot", () => {
    const first = deliveryKey("reminder", "reminder-1", base.dueAt);
    const second = deliveryKey("reminder", "reminder-1", base.dueAt);
    expect(first).toBe(second);
    // A unique index on this string is what prevents a second delivery.
    expect(new Set([first, second]).size).toBe(1);
  });

  it("holds reminders during quiet hours instead of dropping them", () => {
    expect(deliveryOutcome({ ...base, quietNow: true }, now)).toBe("skip-quiet");
  });

  it("skips completed targets", () => {
    expect(deliveryOutcome({ ...base, targetCompleted: true }, now)).toBe(
      "skip-completed",
    );
  });

  it("does not deliver when disabled or not yet due", () => {
    expect(deliveryOutcome({ ...base, enabled: false }, now)).toBe("not-due");
    expect(deliveryOutcome({ ...base, settingsEnabled: false }, now)).toBe(
      "not-due",
    );
    expect(
      deliveryOutcome({ ...base, dueAt: "2026-11-02T10:00:00.000Z" }, now),
    ).toBe("not-due");
    expect(deliveryOutcome({ ...base, dueAt: null }, now)).toBe("not-due");
  });

  it("keys a daily check-in by local day, so it arrives once", () => {
    const morning = deliveryKey("checkin", "user-1", "2026-11-02T08:00:00.000Z");
    const later = deliveryKey("checkin", "user-1", "2026-11-02T19:00:00.000Z");
    expect(morning).toBe("checkin:user-1:2026-11-02");
    expect(morning).toBe(later);
  });
});
