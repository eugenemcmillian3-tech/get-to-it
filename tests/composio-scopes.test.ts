import { describe, expect, it } from "vitest";
import {
  COMPOSIO_DISALLOWED_SCOPES,
  COMPOSIO_TOOLKITS,
  COMPOSIO_TOOLKIT_SCOPES,
  composioRequiredScopes,
  composioScopeProblem,
  normalizeComposioScopes,
} from "@/lib/composio/contracts";

describe("composio scope policy", () => {
  it("asks GitHub for repo and nothing else", () => {
    expect(composioRequiredScopes("github")).toEqual(["repo"]);
    expect(COMPOSIO_TOOLKIT_SCOPES.github).toEqual(["repo"]);
  });

  it("asks Slack for the three scopes its first workflow needs", () => {
    expect(composioRequiredScopes("slack")).toEqual([
      "channels:read",
      "groups:read",
      "chat:write",
    ]);
  });

  it("asks Notion for nothing, because it has no scopes to narrow", () => {
    expect(composioRequiredScopes("notion")).toEqual([]);
    expect(composioScopeProblem("notion", [])).toBeNull();
    expect(composioScopeProblem("notion", undefined)).toBeNull();
  });

  it("leaves toolkits without a stated policy alone", () => {
    const withoutPolicy = COMPOSIO_TOOLKITS.map((toolkit) => toolkit.slug).filter(
      (slug) => !composioRequiredScopes(slug),
    );
    for (const slug of ["github", "slack", "notion"]) {
      expect(withoutPolicy).not.toContain(slug);
    }
    for (const slug of withoutPolicy) {
      expect(composioScopeProblem(slug, ["anything"])).toBeNull();
    }
  });

  it("never states a scope this build refuses", () => {
    for (const scopes of Object.values(COMPOSIO_TOOLKIT_SCOPES)) {
      for (const scope of scopes) {
        expect(COMPOSIO_DISALLOWED_SCOPES as readonly string[]).not.toContain(scope);
      }
    }
  });

  it("reads scopes from either provider shape", () => {
    expect(normalizeComposioScopes("repo, workflow")).toEqual(["repo", "workflow"]);
    expect(normalizeComposioScopes(["repo", "repo", " Workflow "])).toEqual([
      "repo",
      "workflow",
    ]);
    expect(normalizeComposioScopes(undefined)).toEqual([]);
    expect(normalizeComposioScopes({ repo: true })).toEqual([]);
  });

  it("accepts exactly the allowed scopes", () => {
    expect(composioScopeProblem("github", ["repo"])).toBeNull();
    expect(composioScopeProblem("github", "repo")).toBeNull();
    expect(composioScopeProblem("github", ["repo", "repo"])).toBeNull();
  });

  it("rejects Composio's broad default set for GitHub", () => {
    const defaults = [
      "repo",
      "user",
      "gist",
      "notifications",
      "project",
      "workflow",
      "codespace",
    ];
    expect(composioScopeProblem("github", defaults)).toBe(
      "also requests codespace, gist, notifications, project, user, workflow",
    );
  });

  it("rejects a set that is missing the scope the workflow needs", () => {
    expect(composioScopeProblem("github", [])).toBe("does not request repo");
    expect(composioScopeProblem("github", ["read:org"])).toBe("does not request repo");
  });

  it("rejects Slack's write scopes that no workflow uses", () => {
    const needed = ["channels:read", "groups:read", "chat:write"];
    expect(composioScopeProblem("slack", needed)).toBeNull();
    expect(composioScopeProblem("slack", [...needed, "files:write"])).toBe(
      "also requests files:write",
    );
    expect(composioScopeProblem("slack", [...needed, "pins:write", "calls:write"])).toBe(
      "also requests calls:write, pins:write",
    );
    expect(composioScopeProblem("slack", ["chat:write"])).toBe(
      "does not request channels:read, groups:read",
    );
  });

  it("refuses any scope on Notion, which exposes none", () => {
    expect(composioScopeProblem("notion", "read_content")).toBe(
      "also requests read_content",
    );
    expect(composioScopeProblem("notion", ["insert_content"])).toBe(
      "also requests insert_content",
    );
  });
});
