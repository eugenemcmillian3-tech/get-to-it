import { describe, expect, it } from "vitest";
import {
  BUILD_ROLES,
  canReviewChangeset,
  changesetIsStale,
  checksPassed,
  integrationChecks,
  permissionsFor,
  roleFromWorkspace,
  secretLikeProblem,
  type BuildRoomChangeset,
} from "@/lib/build-room";

function changeset(overrides: Partial<BuildRoomChangeset> = {}): BuildRoomChangeset {
  return {
    id: "c1",
    author_id: "author",
    author_kind: "human",
    agent_role: null,
    title: "Edit page",
    description: "",
    status: "in_review",
    base_version: 1,
    base_digest: "a".repeat(32),
    base_files: [{ path: "app/page.tsx", content: "old" }],
    files: [{ path: "app/page.tsx", content: "new" }],
    content_digest: "b".repeat(32),
    diff: "diff",
    checks: [],
    conflict_files: [],
    reviewed_digest: null,
    approved_by: null,
    approved_at: null,
    merged_version: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("build room contract", () => {
  it("maps workspace roles and keeps explicit roles distinct", () => {
    expect(roleFromWorkspace("owner")).toBe("maintainer");
    expect(roleFromWorkspace("admin")).toBe("maintainer");
    expect(roleFromWorkspace("member")).toBe("contributor");
    expect(BUILD_ROLES).toContain("reviewer");
    expect(BUILD_ROLES).toContain("viewer");
  });

  it("gives viewers no write, review, merge or share permission", () => {
    expect(permissionsFor("viewer")).toEqual({
      canCreateChanges: false,
      canReview: false,
      canMerge: false,
      canManageMembers: false,
      canShare: false,
    });
    expect(permissionsFor("reviewer").canReview).toBe(true);
    expect(permissionsFor("reviewer").canMerge).toBe(false);
    expect(permissionsFor("contributor").canCreateChanges).toBe(true);
    expect(permissionsFor("maintainer").canMerge).toBe(true);
  });

  it("refuses self-review and reviewers on stale states", () => {
    expect(canReviewChangeset(changeset(), { id: "author", role: "owner" })).toBe(false);
    expect(canReviewChangeset(changeset(), { id: "other", role: "viewer" })).toBe(false);
    expect(canReviewChangeset(changeset(), { id: "other", role: "reviewer" })).toBe(true);
    expect(canReviewChangeset(changeset({ status: "approved" }), { id: "other", role: "reviewer" })).toBe(false);
  });

  it("detects stale approval when reviewed content no longer matches", () => {
    expect(changesetIsStale(changeset({ status: "approved", reviewed_digest: "b".repeat(32) }))).toBe(false);
    expect(changesetIsStale(changeset({ status: "approved", reviewed_digest: "c".repeat(32) }))).toBe(true);
    expect(changesetIsStale(changeset({ status: "in_review", reviewed_digest: "c".repeat(32) }))).toBe(false);
  });

  it("rejects secret-like text and unsafe paths", () => {
    expect(secretLikeProblem("const api_key = 'sk_live_1234567890'")).not.toBeNull();
    expect(secretLikeProblem("-----BEGIN PRIVATE KEY-----")).not.toBeNull();
    expect(secretLikeProblem("A normal review note.")).toBeNull();

    const checks = integrationChecks([{ path: "../escape.ts", content: "ok" }], "Unsafe");
    expect(checksPassed(checks)).toBe(false);
    expect(checks.find((check) => check.name === "paths")?.status).toBe("failed");
  });

  it("requires a non-empty, all-passing integration result", () => {
    const files = [{ path: "app/page.tsx", content: "export default function Page(){return null}" }];
    const checks = integrationChecks(files, "Safe change");
    expect(checks).toHaveLength(5);
    expect(checksPassed(checks)).toBe(true);
    expect(checksPassed([])).toBe(false);
    expect(checksPassed([{ ...checks[0], status: "failed" }])).toBe(false);
  });
});
