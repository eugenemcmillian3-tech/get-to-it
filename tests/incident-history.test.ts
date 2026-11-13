import { describe, expect, it } from "vitest";
import type { ClosedIncident } from "@/lib/data/incident-history";
import {
  formatIncidentMoment,
  exportHref,
  historyFilters,
  historyHref,
  incidentDuration,
  notificationExportHref,
  notificationStageLabel,
  pageWindow,
  recoveryKindLabel,
} from "@/lib/incident-history";
import {
  INCIDENT_HISTORY_CSV_HEADERS,
  INCIDENT_NOTIFICATION_CSV_HEADERS,
  incidentHistoryCsv,
  filterIncidentNotificationsByRecipient,
  incidentHistoryCsvFileName,
  incidentNotificationCsv,
  incidentNotificationCsvFileName,
  incidentNotificationRowCount,
} from "@/lib/incident-history-csv";

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
    ).toEqual({
      severity: "high",
      status: "dismissed",
      query: "timeout",
      from: null,
      to: null,
      openFrom: null,
      openTo: null,
      page: 3,
    });

    // Values a hand-edited link could invent are dropped, not forwarded.
    expect(historyFilters({ severity: "urgent", status: "open", page: "zero" })).toEqual({
      severity: null,
      status: null,
      query: null,
      from: null,
      to: null,
      openFrom: null,
      openTo: null,
      page: 1,
    });
    expect(historyFilters({ page: "-4" })).toMatchObject({ page: 1 });
    expect(historyFilters({ query: "   " })).toMatchObject({ query: null });
    expect(historyFilters({ query: "x".repeat(140) })?.query).toHaveLength(100);
    // A repeated parameter resolves to its first value rather than being concatenated.
    expect(historyFilters({ severity: ["low", "high"] })).toMatchObject({ severity: "low" });
  });

  it("keeps a closed-date range only when it is a real UTC day", () => {
    expect(historyFilters({ from: "2026-11-01", to: "2026-11-30" })).toMatchObject({
      from: "2026-11-01",
      to: "2026-11-30",
    });
    // Days that do not exist, unpadded months, and free text are not dates.
    expect(historyFilters({ from: "2026-02-31" })).toMatchObject({ from: null });
    expect(historyFilters({ to: "2026-2-3" })).toMatchObject({ to: null });
    expect(historyFilters({ from: "last tuesday" })).toMatchObject({ from: null });
    expect(historyFilters({ from: "2026-11-01T00:00:00Z" })).toMatchObject({ from: null });

    expect(historyFilters({ open_from: "2026-10-01", open_to: "2026-10-31" })).toMatchObject({
      openFrom: "2026-10-01",
      openTo: "2026-10-31",
    });
    expect(historyFilters({ open_to: "2026-13-01" })).toMatchObject({ openTo: null });
  });

  it("builds links that keep the filters and omit the page when it is the first", () => {
    const base = historyHref("ws-1", {
      severity: null,
      status: null,
      query: null,
      from: null,
      to: null,
      openFrom: null,
      openTo: null,
      page: 1,
    });
    expect(base).toBe("/workspace/ws-1/improvements/incidents");

    const filtered = historyHref(
      "ws-1",
      {
        severity: "high",
        status: "resolved",
        query: "sends are timing out",
        from: "2026-11-01",
        to: "2026-11-30",
        openFrom: "2026-10-01",
        openTo: "2026-10-31",
        page: 1,
      },
      2,
    );
    const url = new URL(filtered, "https://example.test");
    expect(url.pathname).toBe("/workspace/ws-1/improvements/incidents");
    expect(url.searchParams.get("severity")).toBe("high");
    expect(url.searchParams.get("status")).toBe("resolved");
    expect(url.searchParams.get("query")).toBe("sends are timing out");
    expect(url.searchParams.get("from")).toBe("2026-11-01");
    expect(url.searchParams.get("to")).toBe("2026-11-30");
    expect(url.searchParams.get("open_from")).toBe("2026-10-01");
    expect(url.searchParams.get("open_to")).toBe("2026-10-31");
    expect(url.searchParams.get("page")).toBe("2");

    const unfiltered = {
      severity: null,
      status: null,
      query: null,
      from: null,
      to: null,
      openFrom: null,
      openTo: null,
      page: 1,
    };
    expect(historyHref("ws-1", unfiltered, 1)).toBe(base);
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

function incident(overrides: Partial<ClosedIncident> = {}): ClosedIncident {
  return {
    id: "incident-1",
    title: "Sends are timing out",
    severity: "high",
    status: "resolved",
    trigger: "The release check saw timeouts.",
    openedAt: "2026-11-05T09:00:00.000Z",
    closedAt: "2026-11-06T11:00:00.000Z",
    recoveryKind: "patch",
    candidateId: "candidate-1",
    candidateTitle: "Resolve the channel name first",
    deploymentId: "deployment-1",
    target: "preview",
    notifications: [],
    ...overrides,
  };
}

describe("incident history CSV", () => {
  it("writes a header row and one row per incident", () => {
    const csv = incidentHistoryCsv([incident(), incident({ id: "incident-2", title: "Second" })]);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe(INCIDENT_HISTORY_CSV_HEADERS.join(","));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("Sends are timing out");
    expect(lines[2]).toContain("Second");
  });

  it("computes the open hours and leaves empty fields for what never happened", () => {
    const [header, row] = incidentHistoryCsv([incident()]).trimEnd().split("\n");
    const cells = row.split(",");
    const at = (name: string) => cells[header.split(",").indexOf(name)];
    expect(at("open_hours")).toBe("26");
    expect(at("notifications_sent")).toBe("0");
    expect(at("escalations")).toBe("0");
    expect(at("unread_notifications")).toBe("0");
    expect(at("recipients")).toBe("");
    expect(at("first_notification_at")).toBe("");
    expect(at("last_notification_at")).toBe("");
    expect(at("recovery")).toBe("patch");
  });

  it("counts what was delivered, including an escalation and anything still unread", () => {
    const [header, row] = incidentHistoryCsv([
      incident({
        notifications: [
          {
            userId: "user-b",
            recipient: "Bea",
            stage: "first",
            day: "2026-11-06",
            sentAt: "2026-11-06T07:30:00.000Z",
            readAt: "2026-11-06T07:35:00.000Z",
            summary: "first",
          },
          {
            userId: "user-a",
            recipient: "Ada",
            stage: "escalation",
            day: "2026-11-12",
            sentAt: "2026-11-12T07:30:00.000Z",
            readAt: null,
            summary: "escalation",
          },
        ],
      }),
    ])
      .trimEnd()
      .split("\n");
    const cells = row.split(",");
    const at = (name: string) => cells[header.split(",").indexOf(name)];
    expect(at("notifications_sent")).toBe("2");
    expect(at("escalations")).toBe("1");
    expect(at("unread_notifications")).toBe("1");
    expect(at("recipients")).toBe("Ada; Bea");
    expect(at("first_notification_at")).toBe("2026-11-06T07:30:00.000Z");
    expect(at("last_notification_at")).toBe("2026-11-12T07:30:00.000Z");
  });

  it("quotes commas, quotes and newlines instead of breaking the columns", () => {
    const [header, row] = incidentHistoryCsv([
      incident({
        title: 'Sends, retries and "drops"\nacross lines',
        trigger: "Because, reasons",
      }),
    ])
      .trimEnd()
      .split("\n");
    expect(row).toContain('"Sends, retries and ""drops""');
    expect(header.split(",")).toHaveLength(INCIDENT_HISTORY_CSV_HEADERS.length);
    // The quoted newline keeps the record intact when read by a CSV parser.
    expect(row.startsWith("resolved,high,")).toBe(true);
  });

  it("defuses a spreadsheet formula in an exported cell", () => {
    const csv = incidentHistoryCsv([incident({ title: "=HYPERLINK(\"http://example.test\")" })]);
    expect(csv).toContain("'=HYPERLINK");
  });

  it("names the file by the day it was exported", () => {
    expect(incidentHistoryCsvFileName("2026-11-13T04:30:00.000Z")).toBe(
      "incident-history-2026-11-13.csv",
    );
  });

  it("links the export to the same filters, without the page", () => {
    const href = exportHref("ws-1", {
      severity: "high",
      status: "resolved",
      query: "timeout",
      from: "2026-11-01",
      to: "2026-11-30",
      openFrom: "2026-10-01",
      openTo: "2026-10-31",
      page: 4,
    });
    const url = new URL(href, "https://example.test");
    expect(url.pathname).toBe("/workspace/ws-1/improvements/incidents/export");
    expect(url.searchParams.get("severity")).toBe("high");
    expect(url.searchParams.get("status")).toBe("resolved");
    expect(url.searchParams.get("query")).toBe("timeout");
    expect(url.searchParams.get("from")).toBe("2026-11-01");
    expect(url.searchParams.get("to")).toBe("2026-11-30");
    expect(url.searchParams.get("open_from")).toBe("2026-10-01");
    expect(url.searchParams.get("open_to")).toBe("2026-10-31");
    expect(url.searchParams.get("page")).toBeNull();

    expect(
      exportHref("ws-1", {
        severity: null,
        status: null,
        query: null,
        from: null,
        to: null,
        openFrom: null,
        openTo: null,
        page: 1,
      }),
    ).toBe("/workspace/ws-1/improvements/incidents/export");
  });
});

describe("notification trail CSV", () => {
  const delivered = (overrides: Partial<ClosedIncident> = {}): ClosedIncident =>
    incident({
      notifications: [
        {
          userId: "user-b",
          recipient: "Bea",
          stage: "reminder",
          day: "2026-11-07",
          sentAt: "2026-11-07T07:30:00.000Z",
          readAt: "2026-11-07T09:00:00.000Z",
          summary: "second delivery, with a comma",
        },
        {
          userId: "user-a",
          recipient: "Ada",
          stage: "first",
          day: "2026-11-06",
          sentAt: "2026-11-06T07:30:00.000Z",
          readAt: "2026-11-06T07:35:00.000Z",
          summary: "first delivery",
        },
      ],
      ...overrides,
    });

  it("writes one row per delivery, oldest first, with the incident on each row", () => {
    const csv = incidentNotificationCsv([delivered(), delivered({ id: "incident-2", title: "Second" })]);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe(INCIDENT_NOTIFICATION_CSV_HEADERS.join(","));
    expect(lines).toHaveLength(5);
    // First incident, oldest notification first.
    expect(lines[1]).toContain("Ada");
    expect(lines[2]).toContain("Bea");
    expect(lines[3]).toContain("Second");
    expect(lines[1]).toContain("Sends are timing out");
  });

  it("carries the stage, day, recipient and read state on each row", () => {
    const [header, first] = incidentNotificationCsv([delivered()]).trimEnd().split("\n");
    const cells = first.split(",");
    const at = (name: string) => cells[header.split(",").indexOf(name)];
    expect(at("stage")).toBe("first");
    expect(at("reminder_day")).toBe("2026-11-06");
    expect(at("recipient")).toBe("Ada");
    expect(at("sent_at")).toBe("2026-11-06T07:30:00.000Z");
    expect(at("read_at")).toBe("2026-11-06T07:35:00.000Z");
    expect(at("closed_at")).toBe("2026-11-06T11:00:00.000Z");
  });

  it("leaves empty fields for a row from before the schedule and an unnamed member", () => {
    const csv = incidentNotificationCsv([
      delivered({
        notifications: [
          {
            userId: "abcdef123456",
            recipient: null,
            stage: null,
            day: null,
            sentAt: "2026-11-05T07:30:00.000Z",
            readAt: null,
            summary: "delivered before reminder stages existed",
          },
        ],
      }),
    ]);
    const [header, row] = csv.trimEnd().split("\n");
    const at = (name: string) => row.split(",")[header.split(",").indexOf(name)];
    expect(at("stage")).toBe("");
    expect(at("reminder_day")).toBe("");
    expect(at("read_at")).toBe("");
    expect(at("recipient")).toBe("member abcdef12");
  });

  it("quotes a summary that contains a comma", () => {
    const csv = incidentNotificationCsv([delivered()]);
    expect(csv).toContain('"second delivery, with a comma"');
  });

  it("counts every delivery across incidents", () => {
    expect(incidentNotificationRowCount([])).toBe(0);
    expect(
      incidentNotificationRowCount([delivered(), delivered({ notifications: [] })]),
    ).toBe(2);
  });

  it("names the notifications file by the day it was exported", () => {
    expect(incidentNotificationCsvFileName("2026-11-13T05:30:00.000Z")).toBe(
      "incident-notifications-2026-11-13.csv",
    );
  });

  it("links the notification export to the same filters", () => {
    const href = notificationExportHref("ws-1", {
      severity: "critical",
      status: "dismissed",
      query: "timeout",
      from: "2026-11-01",
      to: "2026-11-30",
      openFrom: null,
      openTo: null,
      page: 3,
    });
    const url = new URL(href, "https://example.test");
    expect(url.pathname).toBe("/workspace/ws-1/improvements/incidents/notifications/export");
    expect(url.searchParams.get("severity")).toBe("critical");
    expect(url.searchParams.get("status")).toBe("dismissed");
    expect(url.searchParams.get("query")).toBe("timeout");
    expect(url.searchParams.get("from")).toBe("2026-11-01");
    expect(url.searchParams.get("page")).toBeNull();
  });
});

describe("notification trail recipient filter", () => {
  const trail = (): ClosedIncident =>
    incident({
      notifications: [
        {
          userId: "user-a",
          recipient: "Ada",
          stage: "first",
          day: "2026-11-06",
          sentAt: "2026-11-06T07:30:00.000Z",
          readAt: null,
          summary: "for Ada",
        },
        {
          userId: "user-b",
          recipient: "Bea",
          stage: "first",
          day: "2026-11-06",
          sentAt: "2026-11-06T07:30:00.000Z",
          readAt: null,
          summary: "for Bea",
        },
      ],
    });

  it("keeps only the chosen person's deliveries and drops incidents left empty", () => {
    const filtered = filterIncidentNotificationsByRecipient(
      [trail(), incident({ id: "incident-2", notifications: [trail().notifications[1]] })],
      "user-a",
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("incident-1");
    expect(filtered[0].notifications.map((row) => row.recipient)).toEqual(["Ada"]);

    const csv = incidentNotificationCsv(filtered);
    expect(csv).toContain("for Ada");
    expect(csv).not.toContain("for Bea");
  });

  it("leaves the incidents it was given untouched", () => {
    const original = [trail()];
    const filtered = filterIncidentNotificationsByRecipient(original, "user-a");
    expect(original[0].notifications).toHaveLength(2);
    expect(filtered[0]).not.toBe(original[0]);
    expect(filtered[0].notifications).toHaveLength(1);
  });

  it("returns nothing for someone who was never notified", () => {
    expect(filterIncidentNotificationsByRecipient([trail()], "user-c")).toEqual([]);
    expect(incidentNotificationRowCount(filterIncidentNotificationsByRecipient([trail()], "user-c"))).toBe(0);
  });

  it("carries the recipient in the export link and leaves the plain link alone", () => {
    const filters = {
      severity: null,
      status: null,
      query: null,
      from: null,
      to: null,
      openFrom: null,
      openTo: null,
      page: 1,
    };
    expect(notificationExportHref("ws-1", filters)).toBe(
      "/workspace/ws-1/improvements/incidents/notifications/export",
    );
    const scoped = new URL(notificationExportHref("ws-1", filters, "user-a"), "https://example.test");
    expect(scoped.searchParams.get("recipient")).toBe("user-a");

    const withFilters = new URL(
      notificationExportHref("ws-1", { ...filters, severity: "high" }, "user-a"),
      "https://example.test",
    );
    expect(withFilters.searchParams.get("severity")).toBe("high");
    expect(withFilters.searchParams.get("recipient")).toBe("user-a");
    expect(withFilters.searchParams.get("page")).toBeNull();
  });
});
