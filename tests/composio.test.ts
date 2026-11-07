import { describe, expect, it } from "vitest";
import {
  COMPOSIO_LIMITS,
  COMPOSIO_TOOLKIT_SLUGS,
  actionArgumentsHash,
  approvalCoversAction,
  canCancelAction,
  canUseGrant,
  checkNodeSupport,
  completionForThrownError,
  composioUserId,
  isComposioToolkit,
  isValidConnectedAccountId,
  isValidToolSlug,
  parseActionArguments,
  providerErrorCategory,
  redactProviderResult,
  safeProviderMessage,
  stateHash,
  stateMatchesHash,
} from "@/lib/composio/contracts";

const HASH = "a".repeat(64);

describe("Composio contracts", () => {
  it("exposes the managed-auth toolkit catalog", () => {
    expect(COMPOSIO_TOOLKIT_SLUGS).toHaveLength(45);
    expect(isComposioToolkit("github")).toBe(true);
    expect(isComposioToolkit("notion")).toBe(true);
    expect(isComposioToolkit("slack")).toBe(true);
    expect(isComposioToolkit("googlecalendar")).toBe(true);
    expect(isComposioToolkit("microsoft_teams")).toBe(true);
    expect(isComposioToolkit("google_search_console")).toBe(true);
    expect(isComposioToolkit("xero")).toBe(false);
    expect(isComposioToolkit("GITHUB")).toBe(false);
  });

  it("accepts only well-formed tool slugs for the right toolkit", () => {
    expect(isValidToolSlug("github", "GITHUB_CREATE_AN_ISSUE")).toBe(true);
    expect(isValidToolSlug("notion", "NOTION_CREATE_NOTION_PAGE")).toBe(true);
    expect(isValidToolSlug("slack", "SLACK_SEND_MESSAGE")).toBe(true);
    expect(isValidToolSlug("googlecalendar", "GOOGLECALENDAR_CREATE_EVENT")).toBe(true);
    expect(isValidToolSlug("microsoft_teams", "MICROSOFT_TEAMS_GET_MY_PROFILE")).toBe(true);
    expect(isValidToolSlug("google_search_console", "GOOGLE_SEARCH_CONSOLE_LIST_SITES")).toBe(true);
    expect(isValidToolSlug("github", "NOTION_CREATE_NOTION_PAGE")).toBe(false);
    expect(isValidToolSlug("googlecalendar", "GMAIL_SEND_EMAIL")).toBe(false);
    expect(isValidToolSlug("github", "github_create_issue")).toBe(false);
    expect(isValidToolSlug("github", "GITHUB_")).toBe(false);
    expect(isValidToolSlug("github", "GITHUB_X; DROP TABLE")).toBe(false);
  });

  it("validates connected account ids", () => {
    expect(isValidConnectedAccountId("ca_abc123")).toBe(true);
    expect(isValidConnectedAccountId("ca_")).toBe(false);
    expect(isValidConnectedAccountId("acct_123")).toBe(false);
    expect(isValidConnectedAccountId("ca_abc<script>")).toBe(false);
  });

  it("derives the provider user id from the app user only", () => {
    expect(composioUserId("11111111-2222-3333-4444-555555555555")).toBe(
      "gettoit_11111111222233334444555555555555",
    );
  });

  it("parses only bounded JSON objects", () => {
    expect(parseActionArguments('{"owner":"org"}')).toMatchObject({ ok: true });
    expect(parseActionArguments("[]")).toMatchObject({ ok: false });
    expect(parseActionArguments('"text"')).toMatchObject({ ok: false });
    expect(parseActionArguments("not json")).toMatchObject({ ok: false });
    expect(parseActionArguments("")).toMatchObject({ ok: false });
    expect(parseActionArguments('{"__proto__":{"a":1}}')).toMatchObject({ ok: false });
    expect(parseActionArguments(JSON.stringify({ body: "x".repeat(17_000) }))).toMatchObject({
      ok: false,
    });
  });

  it("hashes arguments deterministically", () => {
    const value = { owner: "org", repo: "repo" };
    expect(actionArgumentsHash(value)).toMatch(/^[a-f0-9]{64}$/);
    expect(actionArgumentsHash(value)).toBe(actionArgumentsHash({ ...value }));
    expect(actionArgumentsHash(value)).not.toBe(actionArgumentsHash({ ...value, repo: "other" }));
  });

  it("binds the authorization state by hash", () => {
    const state = "b".repeat(64);
    expect(stateHash(state)).toMatch(/^[a-f0-9]{64}$/);
    expect(stateMatchesHash(state, stateHash(state))).toBe(true);
    expect(stateMatchesHash(state, "c".repeat(64))).toBe(false);
    expect(stateMatchesHash(state, "not-a-hash")).toBe(false);
  });

  it("redacts credential-shaped fields and bounds output", () => {
    const result = redactProviderResult({
      id: "123",
      access_token: "secret-value",
      nested: { refresh_token: "another", note: "keep" },
      rows: Array.from({ length: 30 }, (_, index) => index),
      text: "x".repeat(5_000),
    });
    expect(result.redacted).toBe(true);
    expect(result.truncated).toBe(true);
    const serialized = JSON.stringify(result.value);
    expect(serialized).not.toContain("secret-value");
    expect(serialized).not.toContain("another");
    expect(serialized).toContain("[redacted]");
    expect(serialized).toContain("keep");
  });

  it("maps provider messages to small error categories", () => {
    expect(providerErrorCategory("Input required for this tool")).toBe("needs_input");
    expect(providerErrorCategory("401 Unauthorized")).toBe("auth");
    expect(providerErrorCategory("429 rate limit")).toBe("rate_limit");
    expect(providerErrorCategory("Request timed out")).toBe("timeout");
    expect(providerErrorCategory("fetch failed")).toBe("network");
    expect(providerErrorCategory("something odd")).toBe("unknown");
  });

  it("never echoes provider tokens in stored error text", () => {
    expect(safeProviderMessage("bad token ca_abcdef123456 and Bearer abc.def-123")).not.toMatch(
      /ca_abcdef123456|abc\.def-123/,
    );
  });

  it("treats a timeout or network failure as uncertain, not failed", () => {
    expect(completionForThrownError(new Error("The operation timed out"))).toEqual({
      status: "uncertain",
      code: "timeout",
    });
    expect(completionForThrownError(new Error("fetch failed"))).toEqual({
      status: "uncertain",
      code: "network",
    });
    expect(completionForThrownError(new Error("401 Unauthorized"))).toEqual({
      status: "failed",
      code: "auth",
    });
  });

  it("requires a matching, enabled grant for the exact role and tool", () => {
    const grant = { enabled: true, role: "frontend" as const, tool_slug: "GITHUB_CREATE_AN_ISSUE" };
    expect(
      canUseGrant({
        grant,
        role: "frontend",
        toolSlug: "GITHUB_CREATE_AN_ISSUE",
        connectionActive: true,
      }).ok,
    ).toBe(true);
    expect(
      canUseGrant({
        grant,
        role: "qa",
        toolSlug: "GITHUB_CREATE_AN_ISSUE",
        connectionActive: true,
      }).ok,
    ).toBe(false);
    expect(
      canUseGrant({
        grant,
        role: "frontend",
        toolSlug: "GITHUB_LIST_PULL_REQUESTS",
        connectionActive: true,
      }).ok,
    ).toBe(false);
    expect(
      canUseGrant({
        grant: { ...grant, enabled: false },
        role: "frontend",
        toolSlug: "GITHUB_CREATE_AN_ISSUE",
        connectionActive: true,
      }).ok,
    ).toBe(false);
    expect(
      canUseGrant({
        grant,
        role: "frontend",
        toolSlug: "GITHUB_CREATE_AN_ISSUE",
        connectionActive: false,
      }).ok,
    ).toBe(false);
  });

  it("counts an approval only for an approved action with both hashes present", () => {
    const base = {
      status: "approved" as const,
      argumentsHash: HASH,
      approvalHash: "b".repeat(64),
      approvedAt: "2026-11-04T00:00:00.000Z",
    };
    expect(approvalCoversAction(base)).toBe(true);
    expect(approvalCoversAction({ ...base, status: "proposed" })).toBe(false);
    expect(approvalCoversAction({ ...base, approvalHash: null })).toBe(false);
    expect(approvalCoversAction({ ...base, approvedAt: null })).toBe(false);
    expect(approvalCoversAction({ ...base, argumentsHash: "not-a-hash" })).toBe(false);
  });

  it("cancels only proposals that have not started", () => {
    expect(canCancelAction("proposed")).toBe(true);
    expect(canCancelAction("approved")).toBe(true);
    expect(canCancelAction("executing")).toBe(false);
    expect(canCancelAction("succeeded")).toBe(false);
  });

  it("checks the SDK's Node floor", () => {
    expect(checkNodeSupport("22.22.3").supported).toBe(true);
    expect(checkNodeSupport("22.22.4").supported).toBe(true);
    expect(checkNodeSupport("23.0.0").supported).toBe(true);
    expect(checkNodeSupport("22.21.9").supported).toBe(false);
    expect(checkNodeSupport("20.11.0").supported).toBe(false);
    const current = checkNodeSupport("22.22.3");
    expect(current.supported).toBe(true);
    expect("message" in current).toBe(false);
  });

  it("keeps the documented limits small and separate from AI credits", () => {
    expect(COMPOSIO_LIMITS.maxEnabledGrantsPerConnection).toBe(5);
    expect(COMPOSIO_LIMITS.maxArgumentsBytes).toBe(16_384);
    expect(COMPOSIO_LIMITS.maxCallsPerDay).toBe(100);
    expect(COMPOSIO_LIMITS.maxWritesPerDay).toBe(25);
  });
});
