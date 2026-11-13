import { describe, expect, it } from "vitest";
import {
  formatIncidentMoment,
  incidentDuration,
  notificationStageLabel,
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
