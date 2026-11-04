import { isSafeProjectPath, type AppSpec } from "@/lib/app-builder";

/** Phase 28 — Project Build Room roles, checks and safe display helpers. */

export const BUILD_ROLES = ["owner", "maintainer", "contributor", "reviewer", "viewer"] as const;
export type BuildRole = (typeof BUILD_ROLES)[number];

export const BUILD_ROLE_LABELS: Record<BuildRole, string> = {
  owner: "Project owner",
  maintainer: "Maintainer",
  contributor: "Contributor",
  reviewer: "Reviewer",
  viewer: "Viewer",
};

export const BUILD_ROLE_NOTES: Record<BuildRole, string> = {
  owner: "Full project control, membership, merging and sharing.",
  maintainer: "Can review, merge, manage contributors and share previews.",
  contributor: "Can create and edit their own isolated changesets and comments.",
  reviewer: "Can comment and review changes, but cannot edit or merge.",
  viewer: "Read-only access. No changeset, review, merge or sharing controls.",
};

export type BuildPermissions = {
  canCreateChanges: boolean;
  canReview: boolean;
  canMerge: boolean;
  canManageMembers: boolean;
  canShare: boolean;
};

export function permissionsFor(role: BuildRole): BuildPermissions {
  return {
    canCreateChanges: ["owner", "maintainer", "contributor"].includes(role),
    canReview: ["owner", "maintainer", "reviewer"].includes(role),
    canMerge: ["owner", "maintainer"].includes(role),
    canManageMembers: ["owner", "maintainer"].includes(role),
    canShare: ["owner", "maintainer"].includes(role),
  };
}

/** Existing workspace roles map to the closest project role. */
export function roleFromWorkspace(role: "owner" | "admin" | "member"): BuildRole {
  return role === "owner" || role === "admin" ? "maintainer" : "contributor";
}

export type BuildRoomFile = { path: string; content: string };

export type BuildRoomProject = {
  id: string;
  name: string;
  purpose: string;
  status: string;
  current_version: number;
  workspace_id: string | null;
  updated_at: string;
};

export type BuildRoomMember = {
  user_id: string;
  role: BuildRole;
  status: "active" | "removed";
  display_name: string;
};

export type BuildRoomTask = {
  id: string;
  title: string;
  description: string;
  status: "queued" | "active" | "blocked" | "review" | "done" | "cancelled";
  assignee_kind: "human" | "agent";
  assignee_id: string | null;
  agent_role: string | null;
  scope_paths: string[];
  created_by: string;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type BuildRoomAgentTask = {
  id: string;
  role: string;
  objective: string;
  status: string;
  changed_files: string[];
  updated_at: string;
};

export type BuildRoomChangeset = {
  id: string;
  author_id: string;
  author_kind: "human" | "agent";
  agent_role: string | null;
  title: string;
  description: string;
  status: "draft" | "in_review" | "approved" | "rejected" | "conflict" | "merged" | "cancelled";
  base_version: number;
  base_digest: string;
  base_files: BuildRoomFile[];
  files: BuildRoomFile[];
  content_digest: string;
  diff: string;
  checks: BuildRoomCheck[];
  conflict_files: string[];
  reviewed_digest: string | null;
  approved_by: string | null;
  approved_at: string | null;
  merged_version: number | null;
  created_at: string;
  updated_at: string;
};

export type BuildRoomReview = {
  id: string;
  changeset_id: string;
  requested_by: string;
  reviewer_id: string | null;
  status: "pending" | "approved" | "changes_requested" | "dismissed";
  snapshot_digest: string;
  note: string;
  created_at: string;
  decided_at: string | null;
};

export type BuildRoomComment = {
  id: string;
  changeset_id: string | null;
  file_path: string | null;
  author_id: string;
  author_kind: "human" | "agent";
  body: string;
  created_at: string;
};

export type BuildRoomPresence = {
  user_id: string;
  status: string;
  last_seen_at: string;
};

export type BuildRoomVersion = {
  version: number;
  summary: string;
  created_at: string;
};

export type BuildRoomDeployment = {
  id: string;
  target: "preview" | "production";
  status: string;
  snapshot_version: number;
  deployment_url: string | null;
  created_at: string;
};

export type BuildRoomWorkspace = {
  status: string;
  expires_at: string | null;
  last_error: string | null;
  updated_at: string;
};

export type BuildRoomShare = {
  id: string;
  expires_at: string;
  created_at: string;
};

export type BuildRoomData = {
  role: BuildRole;
  project: BuildRoomProject;
  permissions: BuildPermissions;
  approvedSpec: { version: number; approved_at: string; spec: AppSpec } | null;
  files: BuildRoomFile[];
  versions: BuildRoomVersion[];
  deployments: BuildRoomDeployment[];
  workspace: BuildRoomWorkspace | null;
  members: BuildRoomMember[];
  workspaceMembers: { user_id: string; role: string; display_name: string }[];
  tasks: BuildRoomTask[];
  agentTasks: BuildRoomAgentTask[];
  changesets: BuildRoomChangeset[];
  reviews: BuildRoomReview[];
  comments: BuildRoomComment[];
  presence: BuildRoomPresence[];
  shares: BuildRoomShare[];
};

export type BuildRoomCheck = {
  name: string;
  label: string;
  status: "passed" | "failed" | "skipped";
  code: number | null;
  log: string;
};

const SECRET_PATTERNS = [
  /\b(?:api[_-]?key|secret|token|password)\b\s*[:=]\s*["']?[^\s"']{8,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}/,
  /\bpostgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@/i,
  /\bservice_role\b/i,
];

/** Comments and changesets must not carry credentials into shared surfaces. */
export function secretLikeProblem(value: string): string | null {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(value)) {
      return "That text looks like it contains a secret. Remove the credential before saving.";
    }
  }
  return null;
}

function pathProblem(path: string): string | null {
  if (!isSafeProjectPath(path)) return `Unsafe project path: ${path.slice(0, 80)}`;
  if (path === ".env" || path === ".env.local" || path === ".env.production") {
    return `Secret environment file refused: ${path}`;
  }
  return null;
}

export function integrationChecks(files: BuildRoomFile[], title: string): BuildRoomCheck[] {
  const checks: BuildRoomCheck[] = [];
  const unique = new Set(files.map((file) => file.path));

  checks.push({
    name: "files",
    label: "File set is bounded",
    status: files.length >= 1 && files.length <= 60 && unique.size === files.length ? "passed" : "failed",
    code: null,
    log: `${files.length} file(s); ${unique.size} unique path(s).`,
  });

  const unsafe = files.map((file) => pathProblem(file.path)).filter((value): value is string => value !== null);
  checks.push({
    name: "paths",
    label: "Paths are safe",
    status: unsafe.length === 0 ? "passed" : "failed",
    code: null,
    log: unsafe.length === 0 ? "No traversal, absolute path or secret env file." : unsafe.join(" "),
  });

  const large = files.filter((file) => file.content.length > 60_000);
  checks.push({
    name: "size",
    label: "File sizes are bounded",
    status: large.length === 0 ? "passed" : "failed",
    code: null,
    log: large.length === 0 ? "Every file is at most 60000 characters." : large.map((file) => file.path).join(", "),
  });

  const secretFile = files.find((file) => secretLikeProblem(file.content) !== null || secretLikeProblem(file.path) !== null);
  const titleSecret = secretLikeProblem(title) !== null;
  checks.push({
    name: "secrets",
    label: "No obvious secret values",
    status: !secretFile && !titleSecret ? "passed" : "failed",
    code: null,
    log: secretFile
      ? `Potential secret in ${secretFile.path}; the value is not repeated here.`
      : titleSecret
        ? "The title contains a secret-like value."
        : "Pattern check only; this is not a complete security audit.",
  });

  checks.push({
    name: "review",
    label: "Human review required",
    status: "passed",
    code: null,
    log: "The merge RPC requires an approved review matching the exact content digest.",
  });

  return checks;
}

export function checksPassed(checks: BuildRoomCheck[]): boolean {
  return checks.length > 0 && checks.every((check) => check.status === "passed");
}

export function changesetIsStale(changeset: BuildRoomChangeset): boolean {
  return changeset.status === "approved" && changeset.reviewed_digest !== changeset.content_digest;
}

export function canReviewChangeset(
  changeset: BuildRoomChangeset,
  user: { id: string; role: BuildRole },
): boolean {
  return (
    permissionsFor(user.role).canReview &&
    changeset.author_id !== user.id &&
    changeset.status === "in_review"
  );
}

export function roleLabel(role: string): string {
  return BUILD_ROLE_LABELS[role as BuildRole] ?? role;
}

export function taskStatusLabel(status: BuildRoomTask["status"]): string {
  return status === "review" ? "Awaiting review" : status[0].toUpperCase() + status.slice(1);
}

export function suggestChangesetTitle(path: string): string {
  return `Edit ${path}`.slice(0, 200);
}
