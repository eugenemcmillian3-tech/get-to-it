import { describe, expect, it } from "vitest";
import {
  formatIncidentMoment,
  historyFilters,
  historyHref,
  incidentDuration,
  notificationStageLabel,
  pageWindow,
  recoveryKindLabel,
} from "@/lib/incident-history";

describe("closed incident wording", () => {
  it("names each notification stage and admits a row from before the schedule", () => {
    expect(notificationStageLabel("first")).toBe("first notification");
    expect(notificationStageLabel("reminder")).toBe("reminder");
    expect(notificationStageLabel("escalation")).toBe("escalation");
    expect(notificationStageLabel(null)).toBe("notification sent before the schedule");
    expect(notificationStageLabel("something-else")).toBe("notification sent before the schedule");
  });

  it("states how long an incident was open without overstating short ones", () => {
    const opened = "2026-11-05T09:00:00.000Z";
    expect(incidentDuration(opened, "2026-11-05T09:20:00.000Z")).toBe("under an hour");
    expect(incidentDuration(opened, "2026-11-05T21:00:00.000Z")).toBe("12 hours");
    expect(incidentDuration(opened, "2026-11-06T10:00:00.000Z")).toBe("25 hours");
    expect(incidentDuration(opened, "2026-11-08T09:00:00.000Z")).toBe("3 days");
    // A closed-at earlier than opened-at is not turned into a negative span.
    expect(incidentDuration(opened, "2026-11-04T09:00:00.000Z")).toBe("under an hour");
  });

  it("formats moments in UTC and says when one was never recorded", () => {
    expect(formatIncidentMoment("2026-11-05T09:04:00.000Z")).toBe("2026-11-05 09:04 UTC");
    expect(formatIncidentMoment(null)).toBe("not recorded");
  });

  it("labels recovery kinds and does not invent one", () => {
    expect(recoveryKindLabel("code_rollback")).toBe("code rollback");
    expect(recoveryKindLabel("config_rollback")).toBe("config rollback");
    expect(recoveryKindLabel("database_recovery")).toBe("database recovery");
    expect(recoveryKindLabel("patch")).toBe("patch");
    expect(recoveryKindLabel(null)).toBe("not recorded");
  });
});

describe("history filters and pages", () => {
  it("keeps only the filters the read actually supports", () => {
    expect(
      historyFilters({ severity: "high", status: "dismissed", query: "  timeout ", page: "3" }),
    ).toEqual({ severity: "high", status: "dismissed", query: "timeout", page: 3 });

    // Values a hand-edited link could invent are dropped, not forwarded.
    expect(historyFilters({ severity: "urgent", status: "open", page: "zero" })).toEqual({
      severity: null,
      status: null,
      query: null,
      page: 1,
    });
    expect(historyFilters({ page: "-4" })).toMatchObject({ page: 1 });
    expect(historyFilters({ query: "   " })).toMatchObject({ query: null });
    expect(historyFilters({ query: "x".repeat(140) })?.query).toHaveLength(100);
    // A repeated parameter resolves to its first value rather than being concatenated.
    expect(historyFilters({ severity: ["low", "high"] })).toMatchObject({ severity: "low" });
  });

  it("builds links that keep the filters and omit the page when it is the first", () => {
    const base = historyHref("ws-1", { severity: null, status: null, query: null, page: 1 });
    expect(base).toBe("/workspace/ws-1/improvements/incidents");

    const filtered = historyHref(
      "ws-1",
      { severity: "high", status: "resolved", query: "sends are timing out", page: 1 },
      2,
    );
    const url = new URL(filtered, "https://example.test");
    expect(url.pathname).toBe("/workspace/ws-1/improvements/incidents");
    expect(url.searchParams.get("severity")).toBe("high");
    expect(url.searchParams.get("status")).toBe("resolved");
    expect(url.searchParams.get("query")).toBe("sends are timing out");
    expect(url.searchParams.get("page")).toBe("2");

    expect(historyHref("ws-1", { severity: null, status: null, query: null, page: 1 }, 1)).toBe(base);
  });

  it("describes the window of a result set without inventing a page", () => {
    expect(pageWindow(63, 1, 20)).toEqual({
      page: 1,
      pageCount: 4,
      first: 1,
      last: 20,
      hasPrevious: false,
      hasNext: true,
    });
    expect(pageWindow(63, 4, 20)).toEqual({
      page: 4,
      pageCount: 4,
      first: 61,
      last: 63,
      hasPrevious: true,
      hasNext: false,
    });
    // A page past the end clamps to the last one, and an empty set stays on page 1.
    expect(pageWindow(63, 9, 20)).toMatchObject({ page: 4, first: 61, last: 63, hasNext: false });
    expect(pageWindow(0, 2, 20)).toEqual({
      page: 1,
      pageCount: 1,
      first: 0,
      last: 0,
      hasPrevious: false,
      hasNext: false,
    });
  });
});
