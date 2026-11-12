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

  it("leaves toolkits without a stated policy alone", () => {
    const withoutPolicy = COMPOSIO_TOOLKITS.map((toolkit) => toolkit.slug).filter(
      (slug) => !composioRequiredScopes(slug),
    );
    expect(withoutPolicy).not.toContain("github");
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
});
