import { describe, expect, it } from "vitest";
import {
  SLACK_LIST_TOOL,
  SLACK_SEND_TOOL,
  approvalCoversRequest,
  buildSlackMessageDraft,
  channelLabelFromListResult,
  channelProblem,
  draftProblems,
  excludedActionProblem,
  messageFingerprint,
  messageFromProviderResult,
  sendBlocker,
} from "@/lib/connectors/slack-messages";

const draft = {
  channel: "C0123456789",
  text: "*Mission: Narrow viewport hides the approve button*\n\nApproved by a person.",
};

describe("slack message drafts", () => {
  it("derives a bold summary with the record link", () => {
    const built = buildSlackMessageDraft({
      kind: "outcome_review",
      title: "Outcome review: ship it",
      summary: "Eight of ten reviewers found the button.",
      nextStep: "Move the control above the text.",
      link: "https://example.test/workspace/x",
    });

    expect(built.text.startsWith("*Outcome review: Outcome review: ship it*")).toBe(true);
    expect(built.text).toContain("Context: Eight of ten reviewers found the button.");
    expect(built.text).toContain("Proposed next step: Move the control above the text.");
    expect(built.text).toContain("Approved by a person in GET TO IT");
    expect(built.text).toContain("<https://example.test/workspace/x|Open it in GET TO IT>");
    expect(built.channel).toBe("");
  });

  it("accepts public and private channel ids only", () => {
    expect(channelProblem("C0123456789")).toBeNull();
    expect(channelProblem("g0123456789")).toBeNull();
    expect(channelProblem("")).not.toBeNull();
    expect(channelProblem("general")).not.toBeNull();
    expect(channelProblem("GENERAL")).not.toBeNull();
    expect(channelProblem("D0123456789")).not.toBeNull();
    expect(channelProblem("C01234")).not.toBeNull();
  });

  it("refuses a message too short to be a summary", () => {
    const problems = draftProblems({ channel: "C0123456789", text: "too short" });
    expect(problems.join(" ")).toContain("sentence of context");
  });

  it("fingerprints the exact channel and text", () => {
    const first = messageFingerprint(draft);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(messageFingerprint({ ...draft, channel: "c0123456789" })).toBe(first);
    expect(messageFingerprint({ ...draft, channel: "G0123456789" })).not.toBe(first);
    expect(messageFingerprint({ ...draft, text: `${draft.text} And more.` })).not.toBe(first);
  });
});

describe("reading slack results", () => {
  it("accepts a timestamp and permalink from a nested result", () => {
    expect(
      messageFromProviderResult({
        ok: true,
        message: {
          ts: "1699999999.123456",
          permalink: "https://acme.slack.com/archives/C0123456789/p1699999999123456",
        },
      }),
    ).toEqual({
      ts: "1699999999.123456",
      permalink: "https://acme.slack.com/archives/C0123456789/p1699999999123456",
    });
  });

  it("never treats a channel or a number as a posted message", () => {
    expect(messageFromProviderResult({ channel: "C0123456789" })).toBeNull();
    expect(messageFromProviderResult({ ts: 1699999999.123456 })).toBeNull();
    expect(messageFromProviderResult("posted")).toBeNull();
  });

  it("keeps a timestamp without inventing a permalink", () => {
    expect(messageFromProviderResult({ ts: "1699999999.123456" })).toEqual({
      ts: "1699999999.123456",
      permalink: null,
    });
    expect(
      messageFromProviderResult({
        ts: "1699999999.123456",
        permalink: "https://example.com/not-slack",
      }),
    ).toEqual({ ts: "1699999999.123456", permalink: null });
  });

  it("resolves a channel name from the listing", () => {
    expect(
      channelLabelFromListResult(
        { channels: [{ id: "C0123456789", name: "product-updates" }] },
        "c0123456789",
      ),
    ).toBe("product-updates");
    expect(
      channelLabelFromListResult({ channels: [{ id: "C999999999", name: "other" }] }, "C0123456789"),
    ).toBeNull();
    expect(channelLabelFromListResult(null, "C0123456789")).toBeNull();
  });
});

describe("approval and sending", () => {
  const fingerprint = messageFingerprint(draft);

  it("covers only the approved fingerprint", () => {
    expect(
      approvalCoversRequest({
        status: "approved",
        fingerprint,
        approvalFingerprint: fingerprint,
        approvedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      approvalCoversRequest({
        status: "approved",
        fingerprint,
        approvalFingerprint: "f".repeat(64),
        approvedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      approvalCoversRequest({
        status: "draft",
        fingerprint,
        approvalFingerprint: fingerprint,
        approvedAt: null,
      }),
    ).toBe(false);
  });

  it("refuses to send without configuration, a connection or a grant", () => {
    expect(
      sendBlocker({ configured: false, connectionStatus: "active", toolGranted: true })?.code,
    ).toBe("not_configured");
    expect(
      sendBlocker({ configured: true, connectionStatus: "expired", toolGranted: true })?.code,
    ).toBe("connection_inactive");
    expect(
      sendBlocker({ configured: true, connectionStatus: "active", toolGranted: false })?.code,
    ).toBe("tool_not_granted");
    expect(
      sendBlocker({ configured: true, connectionStatus: "active", toolGranted: true }),
    ).toBeNull();
  });

  it("never changes a topic, archives, invites, uploads, pins, reacts or deletes", () => {
    for (const action of [
      "set_channel_topic",
      "archive_channel",
      "invite_user",
      "upload_file",
      "pin_message",
      "add_reaction",
      "delete_message",
    ]) {
      expect(excludedActionProblem(action)).toContain("only posts one approved message");
    }
    expect(excludedActionProblem("send_message")).toBeNull();
  });

  it("names the tools it uses", () => {
    expect(SLACK_SEND_TOOL).toBe("SLACK_SEND_MESSAGE");
    expect(SLACK_LIST_TOOL).toBe("SLACK_LIST_ALL_CHANNELS");
  });
});
