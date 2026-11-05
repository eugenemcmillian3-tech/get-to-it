# Workspaces (Phase 13)

A workspace is a small shared place for work that is genuinely shared. It is
separate from your personal goals, not a view onto them. This document is the
permission matrix and the boundary rules the implementation follows; it was
written before the migration.

## Permission matrix

| Capability | Owner | Admin | Member |
| --- | --- | --- | --- |
| See the workspace, its members, shared goals, tasks, comments and activity log | Yes | Yes | Yes |
| Rename the workspace / edit its description | Yes | No | No |
| Delete the workspace | Yes | No | No |
| Invite a member | Yes | No | No |
| Cancel a pending invitation | Yes | No | No |
| Remove a member | Yes | No | No |
| Change a member's role | Yes | No | No |
| Transfer ownership | Yes | No | No |
| Leave the workspace | Yes — only after transferring ownership | Yes | Yes |
| Create a shared goal | Yes | Yes | No |
| Edit a shared goal's title or outcome | Yes | Yes | No |
| Archive / restore a shared goal | Yes | Yes | No |
| Delete a shared goal | Yes | Yes | No |
| Create a task in a shared goal | Yes | Yes | Yes |
| Assign a task to any active member | Yes | Yes | No |
| Assign a task to themselves | Yes | Yes | Yes |
| Leave a task unassigned | Yes | Yes | Yes |
| Edit a task's title | Yes | Yes | Only a task assigned to them |
| Change a task's status | Yes | Yes | Only a task assigned to them |
| Reassign a task | Yes | Yes | Only to themselves or unassigned |
| Delete a task | Yes | Yes | No |
| Comment on a task | Yes | Yes | Yes |
| Delete their own comment | Yes | Yes | Yes |
| Delete anyone's comment | Yes | Yes | No |
| Choose their own notification preferences | Yes | Yes | Yes |
| Read another member's notification preferences | No | No | No |

Two rules hold regardless of role:

- **Exactly one active owner.** Promoting someone else to owner demotes the
  current owner to admin in the same step. The last owner cannot be removed, and
  cannot leave until ownership is transferred. Their defined resolution is:
  transfer ownership, then leave — or delete the workspace.
- **No self-promotion.** Roles are written only by an owner through a
  security-definer function. Members cannot update membership rows at all.

## Data boundaries

| Data | Where it lives | Who can read it |
| --- | --- | --- |
| Personal goals, tasks, saved work, reflections, learning records, AI conversations, focus sessions | The existing personal tables | Only the person, exactly as before |
| Shared goals and tasks | `workspace_goals`, `workspace_tasks` | Active members of that workspace |
| Task comments | `workspace_task_comments` | Active members of that workspace |
| Membership, invitations, roles | `workspace_members`, `workspace_invitations` | Active members see the member list; only the owner sees pending invitations |
| Notification preferences | `workspace_notification_prefs` | The member themselves |
| Membership/permission audit | `workspace_events` | Active members (kinds and roles only, never private content) |

- **Personal goals stay personal.** A workspace never links to, reads from, or
  counts a person's personal goals. Its progress view counts only workspace rows.
- **Sharing is a copy with a confirmation.** Creating a shared goal from one of
  your personal goals requires ticking an explicit confirmation in the form. The
  app copies the title and desired outcome you are looking at into a new
  workspace-owned row and records `source_goal_id` for provenance only. Editing or
  deleting either copy afterwards changes nothing on the other side.
- **Nothing else travels.** Task notes, saved work, AI chats, weekly reflections,
  focus sessions and learning records are never copied into a workspace, and no
  workspace function selects from those tables.
- **Workspace-owned vs personal.** A workspace goal and task belong to the
  workspace. They are not in your dashboard, your plan, your templates, or your
  partner sharing. A personal goal and task are not visible to any workspace.

## What happens when a member leaves

Leaving and removal are the same shape, with different causes:

1. The membership row becomes `left` or `removed` and the person loses access on
   the next request. Every read and write policy checks for an **active**
   membership, so revocation does not wait for a cache.
2. Their task assignments in that workspace are cleared. The tasks stay, now
   unassigned and visible to the remaining members.
3. Their comments stay, attributed to a former member by user id; the UI shows
   "Former member" rather than inventing a new name.
4. Goals and tasks they created stay workspace-owned. Contributions are not
   deleted on the way out.
5. Their notification preferences row is kept but does nothing while they have no
   access. A removed person may be invited again; accepting restores the invited
   role.
6. Ownership cannot leave with them: the single-owner rule above applies.

Deleting a workspace removes its shared goals, tasks, comments, notifications,
invitations and audit log. Personal records are untouched.

## Notifications

Notifications are created server-side, never by the browser, and only for three
events: a task assigned to you, a comment on a task you are assigned or created,
and a membership/permission change that concerns you. Each member has three
switches (`assignments`, `comments`, `membership`), all on by default, stored per
workspace, and readable only by that member.

The delivery channel is the existing in-app inbox on the workspace page. There is
no email, SMS or push delivery in GET TO IT. There is no reminder-style scheduler
and no digest: an event creates one in-app row, and the person marks it read.

## AI usage in workspaces

- **Usage belongs to the person, not the workspace.** Phase 13 adds no AI entry
  point inside a workspace. Every AI feature stays personal and keeps charging the
  signed-in person.
- The database still enforces the prepaid credit ledger, the global daily
  ceiling and the one-request-at-a-time rule. There is no free allowance.
  Nothing in this phase adds a `workspace_id` to `ai_requests` or a way to spend
  someone else's credits.
- There is deliberately **no unmetered team AI path**: no shared credit pool and
  no endpoint that skips `reserve_ai_request`. Build workspaces, workflow runs and
  swarms carry hard per-run budgets charged by the same reservation transaction.
  Swarms remain fixture-only with a zero-credit budget. Any new AI path must use
  the acting person's identity and one of those budgets.

## Not included

Enterprise SSO, custom roles beyond the three above, public or discoverable
workspaces, employee surveillance, productivity ranking, and cross-workspace
access of any kind.
