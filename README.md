# GET TO IT

**From “I should” to “I did.”**

GET TO IT helps you name what you've been putting off, turn it into a goal you can
plan around, and keep the work you actually do.

This repository contains **Phases 1 to 8 and 10 to 35**: accounts, goals, tasks,
a saved-work workspace, AI-assisted planning with a reviewable preview,
task-level AI help whose suggestions you accept, edit or reject, an optional
server-side focus timer, a plain-figures progress view, private weekly
check-ins, optional in-app reminders, a template library with goal search,
filters and archiving, small shared workspaces, small workflows that pause for
your review and need an exact-content approval before any connector action, and a
plain data export/import page with an operations guide. See `BUILD_STATUS.md`.
Payments exist only in Stripe test mode. The app is deployed in production; optional integrations without credentials stay in setup mode.

The goal page also has an optional "I'M STUCK" panel that asks an open model for
a starting point through Ollama's cloud API. It needs `OLLAMA_API_KEY`; without
it the panel explains the missing key instead of inventing an answer.

Agent teams have two modes. Fixture mode is free and deterministic. Model mode
maps the six roles to the six configured Ollama models (GLM 5.3 Flash, DeepSeek
V4.1 Flash, MiniMax M3.1 Flash, GPT-OSS 120B, Gemma 4 31B and Nemotron 3 Nano
30B) and reserves two credits per task from a hard run budget. Every model branch
still needs owner review and the normal controlled integration step.

A protected platform recovery pass releases abandoned AI reservations and
re-queues stale agent tasks. It is served by `/api/platform/health/run`, called
every five minutes by the **Platform health recovery** workflow or a host cron,
and authenticated with `CRON_SECRET`. A database or configuration outage is
escalated, never reported as repaired.

## Stack

- Next.js (App Router) + React + TypeScript
- Tailwind CSS v4
- Supabase for authentication and the database (Postgres + Row Level Security)
- Zod for input validation
- Vitest for unit tests

## Setup

1. Create a Supabase project (or use an existing one).
2. In the Supabase SQL editor, run every file in `supabase/migrations/` in
   filename order, from `0001_phase1_init.sql` through
   `0044_agent_models_and_platform_recovery.sql`. Do not stop at an earlier phase: a missing
   later migration leaves Project models, Evaluations, Build Room, Design,
   Releases, Integration Studio, the developer API and Connections returning a
   server error at request time.
   Together they
   create `profiles`, `goals`, `tasks`, `task_results`, the plan and request-limit
   tables, focus sessions, reminders, private templates, partner sharing, the
   credit ledger and payments, optional work preferences, approved daily plans,
   learning paths and exercise records, small shared workspaces with roles,
   shared goals, assignments and comments, workflows with immutable versions,
   run steps and exact-content action approvals, future paths, review
   perspectives, radar signals, missions, outcome reviews, app projects and
   versions, preview workspaces, agent-team queues, provider connections and
   deployment plans, improvement requests, project memory, reusable skills,
   selected error records and change evaluations, imported-app maps, baseline evidence and modernization proposals, the health probe, the
   triggers that keep them tidy, and the row level security policies.
3. Copy `.env.example` to `.env.local` and fill in your project values
   (Project Settings → API):

   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   ```

   The anon key is browser-safe; access is enforced by RLS. The server-only
   `SUPABASE_SERVICE_ROLE_KEY` is used only to write sanitized unhandled server
   exceptions; never expose it to the browser or put it in a `NEXT_PUBLIC_*`
   variable.

4. Install and run:

   ```bash
   npm install
   npm run dev
   ```

   Without step 3 the app shows a setup notice on every page instead of faking a
   signed-in session or sample data.

### Email confirmation

New accounts may require confirming their email depending on your Supabase
settings. Confirmation links return to `/auth/callback`, which exchanges the
code for a session. For local development you can turn "Confirm email" off under
Authentication → Providers → Email.

Production must use a custom SMTP provider. Supabase's built-in email sender is
rate-limited and is not a production delivery service. Set the project's
**Site URL** and **Redirect URLs** to the deployed origin, and configure
**Authentication → SMTP Settings** with a verified sender before treating signup
as working. The production project uses Resend through the verified
`mail.network-x-ai.win` subdomain; signup, confirmation, and sign-in were
verified end to end on 2026-11-06. The app does not send confirmation mail itself
and does not use the service-role key for email.

The weekly **Email delivery smoke** workflow runs `npm run test:email` against
the production project. It needs the repository secrets
`EMAIL_SMOKE_SUPABASE_URL`, `EMAIL_SMOKE_SUPABASE_ANON_KEY` and
`EMAIL_SMOKE_SERVICE_ROLE_KEY`.

Resend posts delivery events to `/api/webhooks/resend`. The endpoint verifies
the Svix signature with the server-only `RESEND_WEBHOOK_SECRET`, then uses
`GITHUB_ALERT_TOKEN` and `GITHUB_ALERT_REPO` to open the same deduplicated
GitHub issue for bounced, complained, failed, suppressed or delivery-delayed
email. The hourly **Resend delivery monitor** remains a reconciliation fallback
and uses a repository `RESEND_API_KEY` secret; the webhook is the real-time path.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (Next.js config) |
| `npm test` | Vitest unit tests |
| `npm run test:e2e` | Authenticated HTTP crawl against a running app; creates and deletes a disposable Supabase user |
| `npm run test:functional` | Browser smoke test for a workflow server action, task reopen and cross-account export/import; creates and deletes two disposable users |
| `npm run test:seats` | Browser team-seat regression for removal, pending-invitation cancellation and seat reuse; seeds a disposable two-seat entitlement and creates and deletes two disposable users |
| `npm run test:email` | Production signup, confirmation-email delivery, confirmation-link and sign-in check; creates and deletes a disposable user and mailbox |

### Authenticated HTTP E2E

`npm run test:e2e` exercises the signed-in application over HTTP: it creates a
confirmed disposable Supabase account, signs in, seeds one goal, task and app
project, crawls the workspace routes (including Connections, Integration Studio,
Design, Build Room and Releases), checks the API contracts, then deletes the
seeded rows and the account. It needs the app running at
`http://127.0.0.1:3100` (override with `E2E_BASE_URL`) and every migration applied.

The runner needs a Supabase service-role key in its process environment:

```bash
E2E_SERVICE_ROLE_KEY=... npm run test:e2e
```

Pass the key only to this command or to your CI secret store. The runner does
not read it from `.env.local`, and the application must never receive it. Use a
dedicated test project: the service-role key bypasses Row Level Security, and
the runner deletes the account it created. Without the key it exits with a setup
message instead of touching the project. This is an HTTP and API check, not a
browser visual or keyboard-accessibility test.

### Browser functional smoke test

`npm run test:functional` drives the signed-in browser through the workflow input
server action, reopens a completed task, downloads a JSON export, imports it into
a second disposable account, and checks that the two accounts' rows stay
separate. By default it stops before the AI draft, so it needs no
`OLLAMA_API_KEY` and spends no AI request.

Set `E2E_FULL_WORKFLOW=1` to continue through the AI draft, review and
checkpoint. The running app must have `OLLAMA_API_KEY`, and the run spends one AI
request. The weekly CI schedule enables this mode automatically; pull request and
push runs keep the default.

Install Chromium once with `npx playwright install --with-deps chromium`. The app
must be running, every migration must be applied, and the same
`E2E_SERVICE_ROLE_KEY` is required; both temporary accounts are deleted on every
exit path. This is not a visual or keyboard-accessibility audit.

### Team-seat browser regression

`npm run test:seats` removes a member through the workspace UI, verifies the
freed seat, invites and cancels a replacement, confirms the invitation link
remains copyable, and re-invites the removed member. It needs the app running,
the same `E2E_SERVICE_ROLE_KEY`, and an explicit fixture opt-in:

```bash
E2E_ALLOW_BILLING_FIXTURE=1 npm run test:seats
```

The opt-in allows the drill to seed a disposable paid `team_seats` purchase and
entitlement directly in the test database. No payment is made and no AI credits
are added. The disposable workspace and both accounts are removed on every exit
path. Run it only against the dedicated E2E project.

### CI

Two workflows cover pushes to `main`, pull requests and a weekly E2E check:

- `.github/workflows/ci.yml` runs typecheck, lint, unit tests, a dependency
  audit at high severity and the secret scan. It needs no secrets and also runs
  for fork pull requests.
- `.github/workflows/e2e.yml` runs the authenticated crawl, the browser
  functional smoke test, and the team-seat browser regression. Its Monday 06:17
  UTC schedule runs the AI draft/review/checkpoint path. A manual dispatch can
  request the same path with `full_workflow: true`. Both full-workflow paths need
  `OLLAMA_API_KEY` and spend one AI request. It skips fork and Dependabot pull
  requests because GitHub withholds secrets from them.

Branch protection requires a pull request and the `checks` status for `main`.
Administrators are subject to the rule, so a direct push or admin merge cannot
bypass it. `authenticated-e2e` remains advisory because it skips fork pull
requests.

### Repository security

Secret scanning and push protection, Dependabot alerts and security updates, and
CodeQL default setup are enabled. Dependabot checks `npm` and GitHub Actions
weekly. Report a vulnerability privately through the advisory flow described in
[`SECURITY.md`](SECURITY.md); do not open a public issue.

Add these repository secrets before enabling the E2E workflow:

| Secret | Value |
| --- | --- |
| `E2E_SUPABASE_URL` | URL of the dedicated test project |
| `E2E_SUPABASE_ANON_KEY` | Its anon key |
| `E2E_SUPABASE_SERVICE_ROLE_KEY` | Its service-role key |
| `OLLAMA_API_KEY` | Required for the weekly full-workflow run and a `full_workflow` manual dispatch; otherwise optional |

Apply every migration to that project first. The workflow builds and starts the
app on port 3100, then runs the crawl, the browser smoke test and the team-seat
regression. The app process
receives only the URL and anon key; the service-role key is scoped to the test
steps so the running app never sees it. A normal failed run still deletes its
accounts and rows; a hard cancellation can leave the uniquely named test accounts
behind.

## AI help (Ollama)

The goal page can ask an open model for a small next step, using the goal, the
time available today, the blocker and the tasks already written. Requests go to
Ollama's cloud API from server code only.

1. Create a key at <https://ollama.com/settings/keys>.
2. Add it to `.env.local` (gitignored):

   ```
   OLLAMA_API_KEY=...
   ```

3. Restart `npm run dev` and use **I'M STUCK** on any goal.

The key is read on the server and never sent to the browser. Without a key the
panel returns a clear setup message; it never shows sample output. Models on
offer live in `src/lib/ai/models.ts` (default `glm-5.3-flash`, plus DeepSeek
V4.1 Flash, MiniMax M3.1 Flash, GPT-OSS 120B, Gemma 4 31B and Nemotron 3 Nano
30B, all cloud variants).

To check the connection from a terminal, with the same client the app uses:

```bash
node --env-file=.env.local scripts/ollama-check.mjs
```

## AI planning (Phase 2)

The goal page has **Help me plan this goal**. It sends the goal, the time
available today, the deadline, the blocker and the tasks you already have to the
same Ollama model, and asks for either up to three clarification questions or a
plan of 3–7 tasks. Each task carries a title, instructions, a first action, an
expected deliverable and an estimated number of minutes.

What the flow guarantees:

- **Nothing is saved until you approve it.** The plan is a preview held in the
  browser. You can edit every field, remove tasks, or discard it.
- **Your existing work is never replaced.** Saving appends new tasks. Completed
  tasks, in-progress tasks and saved workspace content are untouched.
- **Regenerating asks first.** It replaces the preview only, and only after the
  new plan passes validation. A failed, timed-out or invalid generation leaves
  the preview you were editing exactly where it was.
- **Stale saves are rejected.** The preview carries a fingerprint of the goal.
  If a task is added, completed or edited between preview and save, the save is
  refused with an explanation instead of overwriting newer work.
- **Double submits save once.** Each preview has an idempotency key that the
  database enforces.
- **Model output is validated, never trusted.** Replies must parse as JSON and
  match the plan schema (3–7 tasks, every field present, distinct titles, whole
  minute estimates). Anything else is an error, never a plan and never sample
  output.

### AI request limits

Every AI entry point (**I'M STUCK** and **Help me plan this goal**) goes through
the same server-enforced allowance, stored in Postgres:

- a per-user daily allowance,
- a global daily allowance,
- one AI request in flight per user.

The defaults live in `public.ai_limits` (0 free requests per person, 200 requests
per day globally, 120 second in-flight timeout). Zero free requests is the pricing
decision: there is no free plan. Every AI request is paid from prepaid credits,
and an account starts with none. The browser cannot read or write that table, and
cannot insert, update or delete `ai_requests` rows at all: requests are reserved
by security-definer functions, so limits cannot be raised or reset from the
client.

These are **request limits and credit controls**, not a claim that every operation
costs the same number of credits. The approval gate for the model-specific rate card is in
[`PRICING.md`](PRICING.md).

## Task workspace help (Phase 3)

Open any task and the workspace offers **Help me start**, **Explain this step**,
**Draft with me**, **Review my work**, plus an **I'M STUCK** block with four
options: make this smaller, give me an example, explain what to do first, and
suggest another approach.

What the flow guarantees:

- **Only this task's context is sent.** The task and its goal, the deadline,
  today's available time, what has been in the way, and the notes saved for that
  task. No other tasks, and nothing about the account.
- **Nothing is applied for you.** The answer appears in a card marked *Not
  saved*. You can edit it, add it to your notes, or discard it.
- **Your notes survive.** A failed, timed-out or unusable reply leaves the
  editor exactly as it was. Adding a suggestion appends to your text; it never
  replaces or truncates what you already wrote.
- **Nothing is completed automatically.** Adding a suggestion only fills the
  notes box. Saving still needs the ordinary **Save work** button, and **Mark
  complete** stays a separate choice you make yourself.
- **Answers are text, never markup.** HTML tags, code fences and control
  characters are stripped before the reply reaches the browser, and nothing
  generated is ever executed.
- **Same request limits.** Task help reserves a request through the same
  database functions as planning and goal help: one allowance per account per
  day, a global daily ceiling, and one request in flight at a time.

## Focus timer (Phase 4)

The task workspace has an optional timer: **Start**, **Pause**, **Resume**,
**Finish**. It is deliberately server-owned.

- **Time is derived from stored timestamps.** A session keeps `started_at`, the
  seconds banked by finished stretches, and the start of the current running
  stretch. Elapsed time is calculated in Postgres. The browser never sends a
  duration, and the ticking number on screen is only a projection of the
  server's figure.
- **A close or refresh loses nothing.** The session is a database row, so
  closing the browser leaves it running from the timestamps already stored. Come
  back and pause or finish it. A session left open for more than 12 hours is
  closed automatically at the time it had reached, and one session can never
  count more than 8 hours.
- **No duplicates, no double counting.** One open session per person is enforced
  by a partial unique index, and each transition only fires from the state it
  belongs to, banking the running stretch in the same statement that clears it.
  A repeated click, a second tab or a slow retry returns the same session
  instead of adding time.
- **Browsers cannot write sessions at all.** Inserts, updates and deletes are
  revoked; every transition goes through a security-definer function.
- **Time never completes a task.** No trigger or action connects a session to a
  task's status. Only you can mark work complete.

## Progress, resuming and check-ins (Phase 4)

**Your progress** shows four separate figures — completed tasks, tasks with
saved work, completed goals and recorded focus time. There is no productivity
score and no wellbeing score anywhere in the app.

**Continue where you left off** shows one unfinished task (something already in
progress first, otherwise the first thing on the list), a smaller version of it,
and a way in. No streaks, no missed-day counts, no comment on how long it has
been.

**Weekly check-in** asks three optional questions — what moved forward, what got
in the way, and your next useful step — and saves them as a private row for the
current week (Monday, UTC, chosen by the server). Writing a reflection changes
nothing in your plan.

## Data model

| Table | Purpose |
| --- | --- |
| `profiles` | One row per account, created by an `auth.users` trigger. Holds the display name. |
| `goals` | Owner, title, desired outcome, optional deadline, time available today, optional blocker, optional category, and `archived_at` (archived goals are set aside, not deleted). |
| `tasks` | Owner, goal, title, status (`todo` / `in_progress` / `completed`), `completed_at`, plus optional plan detail (`instructions`, `first_action`, `expected_deliverable`, `estimated_minutes`) and `origin` (`manual` / `ai_plan`). |
| `task_results` | One saved workspace per task: the notes/results content and when it was last saved. |
| `ai_plans` | An approved plan: goal, model, task count. Its id is the idempotency key for the save. |
| `ai_requests` | One row per AI attempt, used to count daily allowances and to enforce one request at a time. |
| `ai_limits` | Server-only allowance configuration (one row). No policies, no grants to browser roles. |
| `focus_sessions` | Optional focus timers: task, goal, status, stored timestamps and banked seconds. Read-only for the browser; transitions run in security-definer functions. |
| `weekly_checkins` | Private reflections, one row per person per week. |
| `goal_templates` | Private, reusable templates saved from your own plans: name, description, desired outcome, category and steps (titles and time estimates only). Owner-only under RLS. |
| `partnership_invitations` | One expiring, single-use token per invitation. The inviter is the only one who can read the row; acceptance runs through a function. |
| `partnerships` | One active partnership per person, enforced by partial unique indexes. Ended partnerships stay as history. |
| `partnership_shares` | Per-person sharing switches and text for one partnership. All off by default; only the owner can read the row. |
| `encouragement_messages` | Short text messages in one thread per partnership, readable only while the partnership is active. |
| `partnership_blocks`, `partnership_reports` | Blocks that stop future invitations, and reports stored for a person to read. |
| `user_preferences` | Optional work habits typed by the person: session length, usual days and hours, task size, reply style, topics, and whether personalisation is on. One row per account, owner-only under RLS. |
| `daily_plans` | One approved selection per person per day: the available minutes, the chosen task ids, and the totals computed by the database. Read-only for the browser; only `save_daily_plan` writes it, and it never changes a task. |
| `learning_plans` | One optional learning path per goal: what to learn, experience, outcome, weekly time and the model that drafted it. Owner-only under RLS. |
| `learning_steps` | Explanations, practice, small projects and checkpoints in order, with edit/skip status and `approved_at` for checkpoints the person approved themselves. |
| `learning_records` | One saved exercise per step: answer, AI feedback, the person's own confidence, a revisit flag and their own completion mark. Feedback, confidence and completion are separate columns. |
| `workspaces` | A small shared workspace: name, description and who created it. Readable only by active members. |
| `workspace_members` | One row per person per workspace, with `owner`/`admin`/`member` and an `active`/`left`/`removed` status. Written only by role-checking functions; one active owner is a unique index. |
| `workspace_invitations` | Single-use, email-addressed, seven-day invitation tokens with the role being offered. Only the owner reads them. |
| `workspace_goals` | Workspace-owned goals. A copied personal goal stores `source_goal_id` for provenance only; no read access to the personal row is granted. |
| `workspace_tasks` | Workspace-owned tasks with an optional active-member assignee and the same explicit completion behaviour as personal tasks. |
| `workspace_task_comments` | Short comments on shared tasks, readable by active members, deletable by the author or an admin. |
| `workspace_notification_prefs` | Each member's own three switches for assignments, comments and membership changes. |
| `workspace_notifications` | The in-app workspace inbox. Created only by database triggers and functions, and readable only by its recipient. |
| `workspace_events` | Membership and permission audit: kind, actor, subject and role. No titles, comment text or private content. |
| `workflows` | A named workflow: goal (optional) and the version new runs start from. Owner-only under RLS. |
| `workflow_versions` | One immutable snapshot of the ordered steps per version. There is no update policy and a trigger refuses updates, so an edit cannot rewrite history. |
| `workflow_runs` | One run: its own copy of the workflow name, version and goal, the current position, a JSON context of inputs and approved text, and the run status. |
| `workflow_run_steps` | The copied steps of one run, each with kind, status, retry policy, attempt count, output and error code. Outputs are kept when a later step fails. |
| `action_records` | What a connector step would send: connector, destination, exact content, its hash, status, attempts and a unique idempotency key per run, step, attempt and content. A partial unique index allows at most one pending, approved, executing or succeeded action per step. |
| `action_approvals` | The single-use approval for one action, holding a copy of the exact connector, destination, content and hash. Updates are limited to stamping consumption by a trigger. |

### Privacy and ownership

- Every table has RLS enabled; policies require `user_id = auth.uid()`.
- Task and saved-result inserts additionally require the parent goal to belong to
  the same user, so a task can't be attached to someone else's goal.
- Server actions re-check the session and scope every read/write by `user.id`
  as defence in depth, and never accept an owner id from the browser.
- A goal, task or saved result that isn't yours resolves to a 404 rather than a
  permission error, so nothing is disclosed.

Isolation, restore and account deletion are now exercised by
`npm run test:restore`, which starts a throwaway embedded Postgres, replays every
migration and runs `tests/restore.integration.test.ts` against it. The drill
refuses to run unless the database is named `restore_test`, so it cannot touch the
hosted project. It no longer needs two real accounts, and it leaves no test rows
in any shared database. What it checks is listed in
[OPERATIONS.md](OPERATIONS.md#test-isolation).

## What Phase 1 includes

- Landing page explaining GET TO IT, with the `LET'S GET TO IT` and `I'M STUCK` actions
- Sign up, sign in, sign out
- Dashboard listing your goals with progress (`completed of total tasks`)
- Goal creation: title, desired outcome, optional deadline, time available today,
  optional “what's stopping you?”
- Goal details with tasks grouped by status, plus goal deletion with confirmation
- Manual task creation, editing (rename / change status), statuses to do / in
  progress / completed
- Task workspace with a notes/results editor, “Save work” without completing, a
  separate “Mark complete”, and “Reopen task”
- Loading, empty, error and saved states; mobile-first layout; keyboard-accessible
  controls and skip link

## What Phase 2 includes

- **Help me plan this goal** on the goal page, with up to three clarification
  questions only when the goal is too vague to plan honestly
- A structured plan of 3–7 tasks: title, instructions, first action, expected
  deliverable, estimated minutes
- An editable preview with save, confirmed regeneration and discard
- Approved plans saved as tasks, shown with their plan detail on the goal page
  and in the task workspace
- Validated model output, clear timeout/provider/invalid-response errors, one
  in-flight request per user, and stale-save rejection
- Database-backed per-user and global daily request limits applied to every AI
  entry point

## What Phase 3 includes

- Task workspace AI actions: help me start, explain this step, draft with me,
  review my work, and the four “I'm stuck” options
- Suggestion cards you can edit, add to your notes, or reject
- Accepted text appended into the notes editor, saved by the existing “Save
  work” action and never completing the task
- Clear provider, timeout and unusable-reply messages that leave editor content
  untouched
- Task-help requests counted by the existing per-user, global and one-at-a-time
  limits

## What Phase 4 includes

- Optional focus timer on every task: start, pause, resume, finish, with elapsed
  time calculated from stored timestamps on the server
- Persisted sessions that survive a refresh or a closed browser, with the
  behaviour spelled out on screen
- One open session per person, idempotent transitions and no double counting
- Progress shown as four separate counts, never a score
- “Continue where you left off” with the next unfinished task and a smaller next
  step
- Private weekly check-ins saved per week, with no change to any plan

## Reminders and daily check-in (Phase 6)

Reminders are optional and **in-app only**. There is no email, SMS or push
channel in GET TO IT, so there is nothing to opt into beyond the feature itself
and nothing leaves the application.

- **Making one.** Open a goal or task and press **Remind me**. A reminder uses
  the time and timezone set in **Settings**. Press it again to turn it off.
- **Settings** (`/settings`): timezone, time of day, which weekdays, quiet hours,
  a master on/off switch, and the optional daily check-in with its own time.
- **Inbox** (`/reminders`): what is unread, with **Open task**, **Snooze** (an
  hour or tomorrow) and **Dismiss**. Snoozes come back on their own.
- **Daily check-in**, when enabled: “What's one thing you want to move forward
today?” One line per local day, saved privately and never applied to a task or
  a plan.

Rules the implementation enforces:

- **Quiet hours defer, they don't drop.** A due reminder inside quiet hours keeps
  its original due time and dedupe key, so it is delivered once when quiet hours
  end — never twice.
- **No duplicate delivery.** Each due slot produces at most one row, because
  `reminder_deliveries.dedupe_key` is unique and the pass inserts with
  `on conflict do nothing`. Re-running the scheduler is safe.
- **Finished and deleted targets are respected.** A completed task's reminder is
  rescheduled instead of sent; a deleted goal or task takes its reminder and
  deliveries with it through cascading foreign keys.
- **Timezone changes are explicit.** Changing the zone or time reschedules future
  reminders; anything already due keeps its original time, and the settings page
  says so.
- **No pressure copy.** Reminders name the thing and offer a way in. There are no
  streaks, no “you missed”, and no invented urgency.
- **Browsers cannot write reminders.** Delivery rows are written only by the
  database functions; the browser has read-only access.

### Scheduled delivery

Delivery does not depend on a browser tab. There are two paths, both calling the
same idempotent database pass:

1. **Opening `/reminders`** runs the pass for that one person, so due items appear
   immediately even with no scheduler configured (this is what makes the feature
   work in local development).
2. **`/api/reminders/run`** runs it for everyone, protected by a bearer secret.

Configuring the scheduler (only needed on a deployment):

- Set `CRON_SECRET` in the host's environment variables. Without it the endpoint
  returns 503 and says so, rather than pretending to have delivered anything.
- `vercel.json` already declares the schedule (`0 7 * * *`, daily). Vercel sends
  `Authorization: Bearer $CRON_SECRET` with cron invocations automatically.
- On Vercel's Hobby plan, cron runs at most once a day, so most in-app delivery
  will come from path 1 until the project is on Pro. Neither plan sends anything
  outside the app.
- Any other host can call the same URL on a schedule with the same header.

## Templates and goal organization (Phase 7)

**The library** (`/templates`) covers six categories — launching a project,
finding a job, creating content, learning a skill, organizing personal tasks and
building a business. Every template has a name, a description, a desired
outcome, suggested steps, an example deliverable per step, and an editable time
estimate.

- **No AI call, ever.** The library is plain text in
  `src/lib/templates/library.ts`. Previewing or using a template costs no
  request and makes no network call, and works with no `OLLAMA_API_KEY` set.
- **Preview, then customise.** A template page shows everything before anything
  is written. The form lets you rename the goal, rewrite the outcome, pick a
  category and deadline, edit each step's name and minutes, or drop a step. Only
  pressing **Create this goal** saves anything.
- **Copies, not links.** Creating from a template inserts a goal and ordinary
  tasks. Editing that goal later cannot change the template, and editing a
  template cannot change goals you already made from it.
- **Examples are labelled.** Every suggested deliverable carries an *Example*
  tag, with a line saying they are starting points rather than requirements.

**Private templates** are saved from a goal you already have: open the goal and
choose **Save this plan as a template**. Only task names, their order and their
time estimates are copied. Saved work, weekly reflections, reminders and AI
answers are never read, and `goal_templates` has no column that could hold them.
Private templates can be previewed, used, edited and deleted at
`/templates/personal/[id]`.

**Organizing goals** on the dashboard:

- **Search** across goal titles and desired outcomes.
- **Status filter**: active, archived or all.
- **Category filter**, matching the template categories.
- **Archive and restore**: archiving keeps the goal and everything inside it and
  moves it out of the default list; restoring puts it back. Archived goals drive
  neither the next-step card nor the progress figures. A reminder you set on a
  goal is independent of archiving, so turn the reminder off on the goal itself
  if you want it quiet while it is set aside.
- **Bounded loading**: results are filtered and paged in the query (8 per page)
  with a total count, so a long list never loads whole.

There is no public gallery, no paid templates and no user-generated public
content: static templates are shipped with the app and personal templates are
visible only to their owner.

## An accountability partner (Phase 8)

One partner at a time, invited by you, sharing nothing until you say so.
Everything on `/partner` starts off.

### Invitations

- **No email is sent.** Creating an invitation produces a link and a code; you
  pass it on yourself. The app never emails a third party.
- **Single use, seven-day expiry.** The token is 128 bits of randomness, stored
  once, and stops working the moment it is accepted, declined or cancelled.
- **No account probing.** Creating an invitation never looks up whether the
  address has an account, so the response cannot be used to test one. Only the
  account with that email can accept, and a forwarded link answers exactly like
  an expired one.
- **Acceptance is required** before either person can see anything.

### What can be shared

Each of these is a separate switch, off by default, saved per partnership:

| Shared when on | Never shared |
| --- | --- |
| Names of up to five active goals | Task notes and saved work |
| Completion counts (tasks done, goals finished) | AI conversations and answers |
| One milestone line you write | Weekly reflections and daily check-ins |
| One written check-in | Focus sessions, timers and totals |

Turning a switch off clears the text behind it, so nothing lingers waiting to
reappear. The partner never reads your tables: their view comes from
`partner_snapshot`, a security-definer function that returns only the fields you
switched on. Row Level Security keeps `partnership_shares` to its owner, so the
raw rows are not reachable even if the interface were bypassed.

### Encouragement

One text thread between the two of you. Up to 300 characters per message, a
short pause between sends, and 20 messages a day each — enforced in the
database, not the browser. No attachments, no public feed, no group, no
external messaging.

### Ending, blocking, reporting

**End partnership** revokes access immediately: the shared view and the thread
stop resolving for both people, and nothing of yours is deleted. **Block** does
the same and stops either person inviting the other again. **Report** stores a
reason and optional note for a person to read; there is no automated moderation
service and nothing is removed automatically, and the interface says so.

## Preferences, personalisation and daily planning (Phase 11)

Settings has an optional **How you like to work** panel: preferred session
length, usual working days and hours, task size, communication style, topics you
want help with, and a preferred reminder schedule. Every field can be left blank,
and a blank field is stored as NULL rather than filled in.

What the flow guarantees:

- **You are the only source.** Nothing is inferred from a reflection, a check-in
  or an AI answer, and no AI answer is stored. If a preference appears, you typed
  it and pressed save.
- **One switch.** Unchecking *Use my preferences to shape suggestions*, or
  pressing **Disable personalisation**, removes every preference line from every
  prompt and every explanation. The saved answers stay, unused.
- **Explainable suggestions.** A suggestion built from preferences says why, in
  the same words everywhere: “Suggested because you selected 15-minute
  sessions.”, “Suggested because you prefer small steps.”, or a line about your
  usual days and hours.
- **A reply style, not a personality.** Concise, encouraging and detailed change
  the wording of an answer. None of them asks the model to assess you, and the
  prompt forbids inferring anything else.
- **No sensitive traits.** The columns are work habits you typed. There is no
  profiling, scoring, diagnosis, medical advice, or comparison with anyone else.
- **The reminder schedule is the existing one.** Saving the panel reschedules
  your future in-app reminders; it never adds a channel. Timezone, quiet hours
  and the daily check-in stay in Reminder settings.

**Plan your day** (`/plan`) asks how much time you have, proposes open tasks from
your active goals, and lets you tick, untick and re-time the list before you
approve it. Selecting more than the time you gave shows a warning and needs a
separate confirmation. Approving writes one `daily_plans` row: tasks, deadlines,
plans and reminders are untouched, and a task you did not pick is simply not in
the selection — never marked abandoned.

Preferences can be reset (clears the values) or deleted (removes the row) from
the same panel. Deleting the row is not deleting your account: the cascade from
`auth.users` handles that separately.

## Workspaces (Phase 13)

A workspace is a small shared place for work that is genuinely shared. It is
separate data, not a window onto anyone's personal goals. The full permission
matrix and boundary rules are in [WORKSPACES.md](WORKSPACES.md).

- **Three roles.** The owner handles membership, roles, workspace settings and
deletion. Admins manage shared goals, tasks and assignments. Members participate
in the shared work: they add tasks, comment, and update tasks assigned to them.
- **One active owner.** Promoting someone to owner demotes the current owner in
the same step. The last owner cannot remove themselves or leave until ownership
is transferred; their other defined resolution is deleting the workspace.
- **Personal stays personal.** A workspace never reads a personal goal, task,
saved result, reflection, learning record, focus session or AI conversation.
Copying a personal goal in requires an explicit confirmation, copies only the
title and desired outcome into a new workspace-owned row, and records where it
came from without linking access.
- **Assignments and comments.** Tasks carry an assignee and a status, and a
completed task keeps the same explicit completion behaviour as a personal task.
Members can take unassigned work themselves; only owners and admins assign work
to other people. Comments are visible to active members and can be deleted by
their author or an admin.
- **Removal is immediate.** Membership writes go through security-definer
functions, and every read policy requires an active membership, so access ends
on the next request. Removal clears that person's assignments; their comments and
anything they created stay with the workspace, attributed to a former member.
- **Notifications are in-app only.** An assignment, a comment on your task, and a
membership change create an inbox row, each subject to your own three switches
(assignments, comments, membership). There is no email, SMS or push delivery and
no scheduler.
- **Audited without content.** Membership and permission changes are logged as a
kind, a role and ids — never a title, a comment or private text.
- **AI stays personal.** Phase 13 adds no AI entry point inside a workspace. Every
AI call still belongs to the signed-in person, is metered by the same
database-enforced allowance and credit ledger, and obeys the global ceiling.
There is no workspace budget, shared pool or unmetered team path.

## Workflows (Phase 14)

A workflow is a short, ordered sequence you run yourself, built from exactly five
step kinds: **user input**, **AI drafting**, **user review**, **approved
connector action** and **completion checkpoint**. The editor is a plain form, not
a visual graph. The starting example is “Prepare a weekly project update”:
select the goal and the completed work, generate a draft, edit and approve it,
optionally save that approved text through a connector, then confirm the run is
finished. Steps can also be copied from one of your private templates, which
supplies names only.

What the flow guarantees:

- **It pauses where a person is needed.** A run waits at input, at review and at
the checkpoint. Only the checkpoint ends the run, and only you can confirm it —
nothing is marked succeeded automatically.
- **Edits never reach a running run.** Saving a workflow writes a new immutable
version. A run copies its steps, name and version number when it starts, so
changing the workflow afterwards leaves that run exactly as it was.
- **Approval is per action, for exact content.** A connector action needs its own
approval row holding the same connector, destination, content and hash. There is
no “approve this workflow” shortcut: approving the draft authorises text, not a
future recipient, destination, amount or content. A trigger refuses to change an
action's content once an approval exists, and consuming an approval is one way.
- **No duplicate external actions.** A partial unique index allows one live or
succeeded action per step, each action carries an idempotency key per attempt,
and execution claims the action with a single conditional status change, so a
double click or a second tab cannot send twice.
- **Recovery is deliberate.** Retry behaviour is set per step (`manual` or
`none`). A retry is refused if an earlier attempt succeeded, is executing, or
ended with an uncertain outcome, because any of those could already have reached
the connector; that state is shown as *outcome uncertain* rather than retried.
New attempts need a new approval.
- **Nothing is lost on failure.** Every step keeps its own output, so a failed
draft, connector call or checkpoint still leaves the inputs, the draft and the
approved text visible and copyable.
- **Your controls.** Preview the steps and the expected action before starting,
cancel the remaining steps, inspect every output, copy a workflow by creating a
new one from the same steps or template, and delete a workflow without touching
existing runs (they keep their name, version, outputs and action records).

**What is not possible by construction.** There is no code step, no arbitrary
HTTP step, no browser automation, no background or scheduled run, no spending and
no publishing. The only connector in this build is an explicitly simulated one:
a connector action records the approved text inside GET TO IT and contacts no
external service. Drafting is metered as its own AI request kind
(`workflow_draft`) under the same per-user, global and one-at-a-time limits as
every other AI entry point.

## Learning mode (Phase 12)

An existing goal can optionally become a learning goal from its page. You say
what you want to learn, your current experience, one concrete outcome and the
time you have each week; GET TO IT drafts a path of short explanations, practice
exercises, a small project and checkpoints.

What the flow guarantees:

- **The path is yours to edit.** Every step can be renamed, rewritten, skipped
  and brought back. Approving a checkpoint is a separate button, and only you can
  press it — no model decides that a checkpoint is met.
- **Generated material is labelled.** Every step carries an AI-generated note,
  and the page says plainly that learning mode does no web research, so there are
  no sources to cite and no references to follow. The prompt forbids inventing
  citations, links, statistics or courses, and tells the model to say when it is
  unsure.
- **No mastery promises.** The prompt forbids promising mastery, fluency or a
  qualification by a date, and no date is displayed as a guarantee.
- **Four separate records.** Your answer, your confidence rating, your own “I
  finished this” mark and the model's feedback are stored in different fields and
  shown separately. Saving feedback is a button, not a side effect; finishing an
  exercise creates no feedback; feedback never changes your confidence; and
  nothing here is a grade, certificate or qualification.
- **Hints before answers.** “Give me a hint” is a separate request whose prompt
  forbids the full answer, and “Review my answer” only turns on once you have
  written something.
- **Unfinished work comes back.** Answers are saved per step, so returning to the
  goal offers the first active step you have not marked finished.
- **Deletion is real.** You can delete one exercise record (answer, feedback and
  confidence for that step) or the whole path and its records. Deleting the goal
  removes the path with it.

Learning mode uses the same database-enforced AI allowance as every other AI
entry point, with its own request kinds (`learning` and `learning_help`), and
supports the optional reply-style preference from Phase 11. It adds no
certificates, no automated high-stakes grading and no rankings.

## AI credits and payments (test mode)

There is no free plan, trial or promotional credit. New accounts start with zero
credits. One credit costs **$0.10**, sold in five one-time packs: $5 for 50, $10
for 100, $25 for 250, $50 for 500 and $100 for 1,000. The current test-mode
reservation is one credit per AI request; that is not the final model-specific
rate card. See [`PRICING.md`](PRICING.md) for the approval gate.

**What is measured, and what is not.** Every AI request records its kind, model,
outcome, error code and timing, plus the token counts the provider reports. The
provider's price per token is *not* invented: the sourced draft is in
[`RATE_CARD_DRAFT.md`](RATE_CARD_DRAFT.md), and production `ai_prices` stays
empty until the owner approves it and the rows are applied. Until then the
dashboard shows cost as unknown, alongside how many requests have no price at
all.

**The ledger is append-only.** `credit_ledger` rows are only ever added. A
balance is the sum of its rows; a trigger refuses an insert that would take the
balance below zero (serialised per person), and update/delete are refused. A
purchase, an AI charge, a release, a refund and an adjustment are all just rows,
so the history reads back exactly.

**Reserve → charge or release.** A credit is reserved inside the same database
call that starts the request, before the model is called. If the request
succeeds, the reservation becomes the charge. If it fails — or a crashed request
is closed out after its in-flight window — the credit is returned, once, because
a request can have at most one charge row and one release row. A timeout is
treated as failed and released: there is no blind retry and no guessing that the
provider did the work.

**Zero balance.** New paid AI work is blocked when the balance is zero. Existing
results, account settings and billing history stay available; there is no free
AI or sample output substituted. The final model-specific operation rate card,
per-operation estimates and aggregate build/swarm/workflow budgets are not
activated by this pricing change.

**Payments.** One provider, Stripe, hosted Checkout, one-time purchases only.
There are no subscription objects and nothing renews. A pending payment row is
created from a database price, the amount never comes from the form, and credits
are added only by `POST /api/stripe/webhook` after the signature is verified
against the raw body. The browser's success page adds nothing, and says so.
Delivery is idempotent three ways over: the provider event id is a primary key,
only a `pending` payment can become `paid`, and there is one purchase row per
payment. Refunds are full and only for unused credits; a refund event that would
leave a negative balance is parked as failed for a person instead of being
applied or retried.

**Turning test mode on.** In `.env.local` (server only, never a `NEXT_PUBLIC_`
variable): a `sk_test_...` key as `STRIPE_SECRET_KEY`, the endpoint's signing
secret as `STRIPE_WEBHOOK_SECRET`, and any long random value as
`CREDIT_RPC_TOKEN`. Store that same token in `public.app_secrets` under the name
`credit_webhook`, because the webhook has no signed-in user and the app does not
use the service-role key for billing. Point a Stripe test-mode webhook at
`/api/stripe/webhook`
for `checkout.session.completed`, `checkout.session.expired` and
`charge.refunded`, and grant yourself the owner role (see **Granting the owner
role** below) to open `/owner`.
A `sk_live_...` key is ignored unless `STRIPE_ALLOW_LIVE=true` is also set:
taking real money is a deliberate step, not a side effect of pasting a key.

**Owner dashboard.** `/owner` shows aggregate counts only — accounts, goals,
tasks, AI outcomes, reported tokens, known versus unknown cost, credits sold and
spent, adjustments, payment states and webhook failures. Access is checked in
the database, not the browser, and no task title, note or saved work is selected.
Manual adjustments require a note and land in the same ledger.

**Granting the owner role.** `public.app_owners` is operator-managed: no route
and no server action writes it, and the browser roles have no grants on the
table, so the dashboard cannot be handed out from the app. Use the script with
the service-role key, addressed by the email the person signs in with — no user
id is pasted into SQL, code or a config file, so there is nothing to keep in
sync when an account is recreated:

```bash
npm run owner:grant -- --list                     # who owns the dashboard today
npm run owner:grant -- --email you@example.com    # grant by email
npm run owner:grant -- --email you@example.com --revoke
```

It needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the
environment (`E2E_SERVICE_ROLE_KEY` is accepted too). Both actions are
idempotent: granting an existing owner and revoking a non-owner report that and
change nothing. The row lands in `public.app_owners` and `app_is_owner()` reads
it on the next request, so `/owner` opens for that account and stays a 404 for
everyone else. The script never prints the key, and it creates no accounts — the
person signs up first.

**Deleting an account** removes the person from the ledger while keeping the
rows as an accounting record; unused credits are not refunded automatically.
No card details are stored anywhere in this app.

## Import my app (Phase 31)

An existing supported app can be imported from an authorized GitHub repository or a
project ZIP. The importer reuses the existing app project storage, encrypted
repository connections, preview sandbox and Phase 25 change-review workflow.

- **Supported stack only.** Next.js App Router, TypeScript and Tailwind CSS at the
  project root. Other frameworks and the pages router are refused with a reason;
  nothing is approximated.
- **Safe inspection.** Archives are bounded by compressed and expanded size,
  entry count and stored-text limits. Path traversal, absolute paths and symbolic
  links are rejected. Secret files are excluded from storage and future model
  context, repository instruction files are excluded, and no install script or
  project code runs during import.
- **Editable map.** Framework and dependencies, routes and components, backend
  operations, database and migrations, auth, integrations, environment-variable
  names, commands and uncertainties are linked to real files. Every finding is
  labelled `inspected` or `inferred`; the JSON map can be corrected without
  touching source.
- **Baseline first.** The existing sandbox records typecheck, lint, test and build
  results before a proposal. Pre-existing failures stay attached to the baseline
  and are never attributed to a later modification.
- **One bounded modernization.** Choose one objective. The proposal names the
  affected files, compatibility concerns, acceptance checks and reversal plan.
  It is a deterministic review scaffold, not an app rewrite. Approval creates a
  Phase 25 change request; the normal plan, patch, test, preview, diff review and
  merge gates still apply. No push or deployment is performed.

The importer never executes a repository's instructions or comments as platform
permissions. The preview sandbox still uses its pinned dependency and command
policy; an unsupported dependency or script is recorded as a blocked baseline
instead of being installed.

## Evaluation workspace (Phase 32)

`/evaluations` compares agent configurations on the same bounded tasks and keeps
the evidence needed to decide whether a routing or role change is justified.

- **Bounded tasks.** Each task records one of the five initial categories (small
  frontend change, backend validation change, bug repair, test generation and
  existing-code explanation), an input snapshot, expected output, deterministic
  acceptance checks, an allowed-tool list, runtime and request limits, and the
  configuration under test. Development examples and held-out tasks are stored
  separately, and the acceptance material is locked after the first run.
- **Synthetic or permitted projects.** The default is a synthetic fixture with no
  customer data or credentials. A generated project snapshot can be used only
  after the owner confirms they are allowed to evaluate it. Phase 32 candidates
  are deterministic fixture outputs, so no provider or model reads the snapshot.
- **Preserved evidence.** Every run records the configured and returned model
  identifiers, prompt version, roles and routing, tool calls, completion, test
  results, runtime, reported token usage, known versus estimated cost, and human
  review. Failed and errored runs stay. Review annotates evidence but cannot
  rewrite it.
- **Trials and separation.** Repeated trials expose variation and the trial count
  is reported. Deterministic checks determine pass/fail; AI-judged opinions are
  labelled separately and never counted. There is no universal intelligence
  score.
- **Capability registry.** Versioned profiles cite evidence run IDs and state
  their limitations, and each profile is scoped to one configuration. The
  registry starts with UI changes and bounded bug repair evidence, and says
  plainly that database changes need human review with no evaluation evidence
  yet.
- **Budget and approval.** Runs require a human-approved trial budget; the whole
  comparison is refused before writing if the budget is short. Phase 32 is
  fixture-only, so known cost is zero and no paid provider call is made.
  Recommendations preserve a rollback snapshot and never edit production
  routing, roles or prompts automatically. Approval records a decision only.

## Versioned project model and change scenarios (Phase 33)

`/build/{projectId}/model` turns the approved specification, stored files,
integration metadata and deployment records into a versioned project model. It
does not call a model or fetch external data.

- **Model contents.** Pages, declared user journeys, routes and services, static
  import edges, data entities and fields, external integrations, preview and
  production environment records, known project constraints, assumptions and
  missing information. Code evidence includes the file path and line.
- **Versioning and staleness.** Each model version stores the spec version,
  project version and a digest of the source it read. A changed spec, file,
  integration or deployment marks the current model stale and blocks new
  scenarios until a fresh version is built. Old versions remain for inspection.
- **Change scenarios.** API changes, new user roles, background jobs and database
  fields are traced through static dependency edges. The output states affected
  components, code/config evidence, assumptions, unknowns, proposed tests, a
  reversible implementation order and reversible experiments. An absent target
  produces an unknown, not an invented dependency.
- **No false precision.** Scenarios are labelled as static narrative, not measured
  results. There are no performance or cost forecasts, and dependency edges do
  not prove runtime behavior.
- **Bounded experiments.** Contract inspection, synthetic-request proposals,
  source-size observation and static failure-path inspection are recorded with
  request and duration limits. Synthetic requests are blocked unless an isolated
  runner is configured; no external URL, production user data or external load
  test is allowed. Static results never claim to be runtime measurements.
- **Approval and task conversion.** An experiment can become a Build Room task
  only after explicit approval. The database function checks ownership, approval,
  duplicate conversion and valid project scope, and creates the task atomically.
- **Version comparison.** Any two retained versions can be compared on the model
  page. Pages, journeys, services and routes, dependencies, data entities,
  integrations, deployment environments, constraints, assumptions and missing
  information show added, removed or changed records with exact before/after
  fields and source evidence. Comparison reads the stored snapshots only; it does
  not re-read project files. A selected comparison can be downloaded as a
  Markdown changelog.
- **Access guarantees.** The `/build/{projectId}/model/changelog` and
  `/build/{projectId}/download` routes are owner-scoped. In separate fixtures,
  the drill verifies the owner's downloads while the workspace link exists and
  after it is removed, parsing the unlinked ZIP to `app/page.tsx`. A member
  whose project membership was removed is denied on both download routes while
  the workspace link and their active workspace role remain, and both stay
  denied for that member after the link is removed. Both refusals use a generic
  `Not found` body naming no project or role. The `/build/{projectId}/room` page
  checks the project role, so a removed member gets its not-found path while the
  owner's page renders the project name and owner role. The isolated restore
  drill asserts all of this against Postgres.

## Tests

`npm test` covers input validation (goals, tasks, saved results, accounts),
progress counting and formatting, and — using fixtures rather than live calls —
the planning parser, save validation, staleness detection and limit messaging.
Task-workspace help gets the same treatment: request and intent validation,
text normalization, suggestion merging, prompt grounding and provider-failure
messages. Phase 4's timer maths, week boundaries, progress figures, next-step
selection and check-in validation are unit tested; the timer transitions,
concurrency and ownership rules are exercised against Postgres, because they
have to run there.

Phase 11's preferences are unit tested through fixtures: parsing and the topic
limits, which saved fields reach a prompt (and that none do when personalisation
is off or nothing was saved), the explanation wording, daily selection and its
non-abandonment notes, and selection ownership checking. The database side was
verified with two temporary accounts: one account's preferences and plans stayed
invisible to the other, a foreign task id was refused, an over-limit selection
needed explicit confirmation, approving a plan left the tasks' status and
`updated_at` unchanged, and deleting an account removed its preferences and
plans.

Learning mode is tested through fixtures for its parser (including paths with no
practice, no checkpoint or duplicate titles), the setup and help schemas, prompt
content (no invented sources, no mastery promises, hint before answer, feedback
kept apart from confidence) and the resume/progress helpers. The database side
was verified with two temporary accounts: answers persisted across updates,
feedback never changed confidence, only checkpoints could be approved, one
account could not read or write another's learning rows, deleting a plan removed
its steps and records, and both new AI request kinds were accepted by the
reservation function.

Workspaces are tested through the documented matrix (a truth table for every
capability and role), the assignment and comment permission helpers, the copy
confirmation schema, member labelling and sorting, shared progress including
archived goals and empty workspaces, notification preference defaults, and the
plain-language refusal copy. The database side was exercised with four temporary
accounts: an owner, an admin, a member and an outsider. The outsider and a member
of another workspace could read no rows; a member could neither create a goal nor
edit membership; an admin could manage goals and assignments but not roles,
invitations or removal; the last owner could neither demote themselves nor
leave; transferring ownership demoted the old owner, who then left and
immediately lost read access while their contributions stayed; removal revoked
access and cleared assignments; a re-invited member could rejoin; an invitation
accepted by the wrong account was refused; the notification switches were
honoured; and deleting a workspace removed its goals, tasks, comments and
notifications. Personal AI metering still charged the person and no
workspace-scoped AI function exists.

Workflows are unit tested through their pure rules: the five step kinds and their
labels, the eight run states, the editor schema (input first, drafting, review
and checkpoint required, a connector action only after a review, a destination
required, at most ten steps), content hashing, idempotency keys per attempt, the
approval comparison for changed content, destination, connector, hash, consumed
or missing approvals, retry refusal for executing, uncertain or succeeded
actions, progress and preserved outputs, template reuse, draft prompts that
forbid invented facts and external actions, draft normalisation, and the error
copy. The simulated connector is tested to contact nothing and to fail on empty
content. The database side was verified with two temporary accounts on the live
schema: versions could not be updated; starting a run copied five steps and
waited for input; a second live action for one step was refused; approved
content could not be changed; an approval could not be consumed twice; a failed
attempt could be superseded but a succeeded action could not be reopened; the
second account saw none of the first account's workflows, versions, runs, steps,
actions or approvals, could neither attach a version, an action nor an approval
to them, and could not start their workflow; editing the workflow left the
running run at its original version with its five steps; deleting the workflow
kept the run with no workflow link; `workflow_draft` was accepted by the AI
reservation function; and deleting a run removed its actions and approvals. All
test rows were rolled back, leaving no accounts or AI usage behind.

## Export, import and operations (Phase 15)

**`/data`** is the whole feature: download a copy of your work, bring a copy back,
and read what account deletion does.

- **What can be exported.** Goals and tasks, saved results, weekly reflections and
  saved preferences, as one documented JSON file and as one CSV per dataset.
  Focus sessions are exported too, but as recorded time only.
- **What is never exported.** Email, password, sessions, account ids, connector
  tokens, AI provider keys, payment credentials, reminders, partner sharing,
  workspaces, AI conversations and other people's rows. Goals and tasks are
  referenced locally (`g1`, `g1-t1`), so an export carries no owner id at all.
- **CSVs are for reading.** A cell that begins with `=`, `+`, `-`, `@` is written
  with a leading apostrophe, so opening an export in a spreadsheet cannot run it.
- **Import is versioned and additive.** Only `format: "get-to-it.export"` version 1
  is accepted. A file is size-checked, schema-checked and count-checked, previewed
  as counts and titles, and only then applied after typing `IMPORT` — and the
  confirmation is tied to the exact preview, so changing the file or options
  afterwards is refused. Goals and tasks become new rows; an existing week's
  reflection is skipped; preferences are replaced only if you tick that box. No
  existing goal, task or saved result is edited or deleted.
- **Ids in a file are never trusted.** Every imported row is created under your own
  account with a new identifier, and an import that carries a `user_id`, connector
  token or payment field is rejected record by record rather than applied.
- **Rejected records are listed.** Validation failures name the kind, label and
  reason, and the valid records still import. Focus sessions in a file are ignored
  with an explanation: their duration comes from server timestamps, so importing
  them would invent time.

Operations live in [OPERATIONS.md](OPERATIONS.md): the configuration reference,
health checks, log policy, forward-only migrations and their rollback limits,
backup and restore steps, the account-deletion matrix, test isolation and the
release checklist.

`GET /api/health` returns `status`, `checks.database`, `checks.configuration` and
the source revision — never a key, host, user or row. `npm run test:restore` starts
an isolated Postgres, replays every migration and runs the restore and
authorization drill; `npm run release:check` runs typecheck, lint, tests, build, a
secret pattern scan and a dependency audit, and prints the revision they belong to.
Those are automated checks, not a security audit.

Export and import are unit tested without a database: the export envelope and
version, owner-scoped rows with local references and no ids, counts, CSV headers,
quoting and the spreadsheet formula guard, the per-dataset CSVs and file names;
then import size, schema and count limits, a wrong format or version, rejection of
`user_id`, connector-token and payment fields, per-record rejection that still
imports the valid records, duplicate weeks, the no-overwrite rules for goal titles,
reflections and preferences, the export-only focus sessions, plan hashing and the
row mapping. The restore drill adds the database side on an isolated Postgres: all
migrations apply to an empty database, an export round-trips additively without
touching existing work, Row Level Security still isolates two accounts after the
restore, cross-account writes are refused, the health probe answers, and deleting
one account removes its rows while leaving the shared usage counter and the other
account untouched.

## Future paths (Phase 16)

**`/futures`** explores a decision or goal you are already weighing, without
claiming to know what will happen.

- **Inputs are yours.** The decision, a horizon from three months to five years,
  available resources, constraints, what success means and what you are uncertain
  about. A goal link is optional and only decides where a chosen action becomes a
  task.
- **Three scenarios, named plainly.** Favorable conditions, expected working
  assumptions and difficult conditions. The middle one is never called likely:
  no model or evidence ranks the three, and nothing in the app produces a
  probability.
- **Eight lists per scenario.** Starting assumptions, possible developments,
  opportunities, risks, early signals to watch, actions useful whatever happens,
  reversible first steps and conditions that would justify changing course.
- **Every line carries an evidence label.** What you provided, a retrieved fact
  with a source you supplied, an assumption, an AI-generated possibility, or an
  unknown. No research tool is connected, so the workspace says plainly that the
  exercise is assumption-based and that nothing was retrieved or fact-checked. A
  `retrieved` line is kept only when its URL appears in text you typed; an
  invented source is dropped, not displayed. Percentages, probabilities,
  guarantees and predictions in generated text are removed the same way.
- **You stay in control.** Every scenario is editable and nothing is saved until
  the whole three-scenario reply validates. Rewriting a line relabels it as yours;
  lines you leave alone keep their original label and source. You can compare the
  three side by side, save which one you lean toward with a rationale and a review
  date, and turn any action into an ordinary task in the linked goal. The task is
  created once per action, never marked done, and can be edited or deleted like
  any other. Deleting the path removes the scenarios and notes but never the
  tasks you chose to keep.
- **Not included.** Guaranteed predictions, unsupported probability percentages,
  automated financial, medical or legal decisions, and any claim to know your
  future. It is thinking support, not advice.

`future_paths`, `future_scenarios` and `future_actions` are owner-only under Row
Level Security. Generation is metered as its own AI request kind under the
existing daily allowance and credit ledger. The pure contract — labels, source
handling, claim removal, parsing, comparison rows and action conversion — is
tested with fixtures, and the restore drill checks that another account can
neither read nor write a path and that a converted task is left intact.

## Think it through (Phase 17)

**`/reviews`** reviews one decision from five fixed perspectives, in order:
planner (how could this work?), critic (what could fail?), research reviewer (what
evidence is missing?), human-impact reviewer (who could benefit or be harmed?) and
synthesizer (what choices and trade-offs remain?).

- **Bounded and sequential.** A review has exactly five stages and makes at most
  five AI requests. The person starts each stage, each stage is one call, and the
  page states the cap and the cost before a review is created. There is no swarm,
  no delegation, no tool use and no external action. The synthesizer re-reads the
  saved answers and costs no sixth call.
- **One shared record.** Every perspective reads the same question, context,
  constraints, priorities and sources. Sources are only links the person typed;
  the app never fetches them. A URL a perspective cites that is not one of those
  links is removed and the claim is relabelled as an assumption rather than shown
  as evidence.
- **Structured output.** Each stage returns proposed options, supporting evidence
  with a basis label, counterarguments, unresolved disagreements, missing
  information, one low-risk experiment with success and stop signals, and
  questions that need human judgment. The synthesizer adds trade-offs and an
  optional recommendation.
- **Transparency without overclaiming.** The page shows each stage's written
  explanation and assumptions, and says plainly that this is a summary rather than
  the model's hidden internal reasoning. It also says that all five perspectives
  are one model: repeated agreement is not independent evidence and is never
  counted as corroboration.
- **Failures and cancellation are visible.** A failed stage is recorded as failed,
  earlier answers stay readable, and the review ends `partial` rather than
  `complete`. Cancelling skips the stages that have not started; a request already
  sent cannot be unsent, and that is stated instead of implying otherwise.
- **Human override.** The person can reject the recommendation and record a
  decision that no perspective proposed. That decision is theirs: it is stored
  with the review, can be changed, and nothing argues with it.

`reviews` and `review_stages` are owner-only under RLS. One stage row per
perspective makes a duplicate answer impossible, and cancelling is a review-level
flag checked before every stage. The pure contract — the five-call cap, stage
order, status rules, source handling, reply validation, prompt shape and outcome
validation — is tested with fixtures, and the restore drill checks ownership and
account deletion.

## What's changing? (Phase 18)

**`/radar`** is an opt-in radar. You choose topics — AI and automation, work and
careers, business and entrepreneurship, education, community needs, technology
and public policy — and you record developments you actually read. Nothing is on
by default.

- **No fetching, no scraping.** This build has no crawler, feed reader, remote
  account link or search integration, and GET TO IT never opens the links you
  record. A signal exists because you typed it after reading the source, and the
  card keeps that source for attribution. Local and private addresses are
  refused, as are links with a username or password in them.
- **Two dates, never merged.** Published is the source's own date and cannot be
  in the future; Recorded here is when you saved it. Anything older than 30 days
  is labelled an older item, not breaking news.
- **Six labels, kept apart.** Announced capability, released capability, research
  result, opinion, speculation and observed change each carry their own
  explanation. An announcement is not shown as a release, and a confident
  promotional claim is not upgraded to a fact.
- **Duplicates refused.** The same source at the same publication date is one
  signal; a unique key per person means a retyped headline cannot add it twice.
- **Personal relevance stays personal.** The explanation names only the topic you
  follow and the goal you connected: “You follow Work and careers and have this
  related goal: …”. Nothing infers a trait, location or circumstance.
- **Actions are yours.** Save for later, dismiss (restorable), mute a topic
  (hides without deleting), explore with scenario planning, create a small
  experiment task, or create a learning goal. Each is a separate press, and no
  signal changes a plan on its own.
- **Not included.** Job-loss predictions, investment signals, fear-based urgency
  and automatic plan changes are absent by design, not merely switched off.

`radar_topics` and `radar_signals` are owner-only under RLS, and inserting a
signal also requires that topic to be followed in the database, not only in the
form. The pure rules — topics, kinds, link and date validation, duplicate keys,
freshness labels, filtering, relevance explanations and preparation text — are
tested with fixtures, and the restore drill checks ownership and account
deletion. No AI request is spent anywhere in this phase.

## Missions (Phase 19)

**`/workspace/[workspaceId]/missions`** adds shared missions to an existing team
workspace. Membership, roles and RLS are the same ones Phase 13 established; a
mission introduces no new access path and is private to its workspace.

- **The record.** A mission states the problem, who is affected, the desired
  outcome, constraints, a category, a named human decision owner and a review
  date. It starts as a draft.
- **Shared tasks.** Members add tasks and assign them to active members. Finishing
  them counts as work completed, which is tracked separately from outcomes.
- **Evidence and assumptions** are separate labels, each with its author and an
  optional source. A personal story can only be stored with a recorded consent
  note; without one the database refuses it, it is excluded from AI input, and a
  share approval is blocked.
- **AI assistance is optional and labelled.** Summaries, questions, plans,
  materials, conflicting assumptions, simplification and measurement ideas are
  each one explicit request, up to the usual daily allowance. The model is told it
  is not a participant: it cannot vote, impersonate anyone, invent consensus,
  publish, contact anyone, or describe completed tasks as impact. Every
  suggestion is stored as an AI suggestion, never as a decision, and people can
  accept, reject or challenge it. Challenges keep the original wording visible.
- **Human decisions** record who approved, when, and any dissent in its own
  words. Only owners and admins record decisions, and only an active member can be
  named as approver. Accepting a suggestion is not a decision.
- **Privacy and removal.** Nothing is auto-published. Only the owner can record a
  share approval, the approval states what could be shared and with whom, and the
  build has no publishing or contacting channel at all. Authors can remove their
  own evidence and outcomes; owners and admins can remove any. Reports go to the
  owner and admins and never leave the workspace.
- **Honest impact.** Work completed, outputs, participant-reported outcomes and
  independently verified outcomes are four separate lists with separate counts.
  A verified outcome needs a source and a named verifier. Completed tasks are
  never presented as social impact, and no score is calculated.
- **Not included.** Automated allocation of essential services, social scoring,
  covert persuasion and claims that AI represents anyone's interests are absent
  by design, not switched off.

`missions` and its seven child tables are owner-scoped through workspace
membership. The pure rules — roles, consent, sharing blockers, outcome separation,
suggestion validation and the assistance prompt — are covered by fixtures, and the
restore drill checks that a removed member loses access to the mission, its
evidence and its outcomes.

## Outcomes and lessons (Phase 20)

**`/outcomes`** compares what you expected with what happened. A review is
started by hand from one of your own goals, future paths or saved reviews; its
expectation is captured at that moment and cannot be edited afterwards.

- **Historical integrity.** The snapshot is stored as JSON and a database trigger
  refuses any update to it, or to the source it points at. Later notes are appended
  to `outcome_observations`, which has no update or delete policy. Nothing rewrites
  an earlier scenario or recommendation to look more accurate in hindsight.
- **The six questions.** What happened, which assumptions held (with a verdict),
  what surprised you, what evidence changed, what you would do differently, and
  the next useful action. Every question is optional and participation is optional.
- **Four separate answers.** Action completed, desired result occurred, expectation
  accuracy and external conditions are four independent columns, so a completed
  action can never be shown as a result. A causation note is invited, and the page
  says plainly that before and after is not proof of cause.
- **Forecasts are optional.** A stated probability (1–99%) is stored with the
  forecast and the resolution; the Brier score is computed per forecast, the method
  is explained, and only that review's resolved forecasts are averaged. Different
  questions are not comparable, and no combined intelligence or performance score
  exists anywhere.
- **Controlled improvement.** Proposals can target planning prompts, template
  structure, clarification questions or review timing. Each needs explicit consent
  and a scoped, consented test set. Approving creates a version; rollback retires
  the active version and restores the previous one, without editing any version.
  The shipped prompts are code and are never changed at runtime, no private content
  is used for training, and permissions and safety rules are never altered.
- **What counts as benefit.** Useful work saved, user-confirmed progress, fewer
  unwanted suggestions and better identification of uncertainty — not engagement
  or time spent.

`outcome_reviews`, `outcome_observations`, `outcome_forecasts`,
`improvement_proposals` and `improvement_versions` are owner-only under RLS. The
pure rules — snapshot capture, scoring, versioning, rollback and consent blockers —
are covered by fixtures, and the restore drill proves another account cannot read a
review and that an appended note cannot be rewritten or removed.

## Configuration and secrets

Three variables are required in production. Billing adds three more, and the app
runs without them — checkout then shows a setup message rather than charging
anyone:

| Variable | Exposure | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | Anonymous key; access is enforced by Row Level Security |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Writes sanitized unhandled server exceptions to `public.error_events`; never expose to the browser |
| `OLLAMA_API_KEY` | **server only** | Ollama cloud API key for the AI features |
| `STRIPE_SECRET_KEY` | **server only** | Stripe secret key; a `sk_test_...` key until you deliberately go live |
| `STRIPE_WEBHOOK_SECRET` | **server only** | Verifies `POST /api/stripe/webhook` |
| `CREDIT_RPC_TOKEN` | **server only** | Capability token the webhook presents; the same value must exist in `public.app_secrets` as `credit_webhook` |
| `STRIPE_ALLOW_LIVE` | **server only** | Set to exactly `true` to permit a live key; anything else refuses live payments |
| `CRON_SECRET` | **server only** | Bearer token for `/api/reminders/run` |
| `GIT_REVISION` | public (health) | The commit this build came from; shown by `/api/health` |

Rules this codebase follows:

- **No `service_role` key in client code or generated projects.** The Next.js
  server uses one only for the sanitized exception sink in
  `src/lib/observability/report-exception.ts`; the AI request limits still depend
  on the browser not having privileged database access.
- The Ollama key is read at call time inside `src/lib/ai/ollama.ts` and used in
  server actions only, so it is never bundled into client JavaScript and a build
  works without it.
- `.env.local` is gitignored; `.env.example` carries names only, never values.
- Nothing prints a key: failure messages name the variable, not its content, and
  the client only ever sees a short human-readable error.

### No sample or demo mode

Production fails visibly rather than pretending:

- Missing Supabase variables → every page shows a setup notice. There is no
  fake signed-in user, no seeded goal and no placeholder data anywhere in `src`.
- Missing Ollama key → AI panels return a setup message. They never show sample
  output, and a failed or unusable reply is an error, not a fallback plan.
- Database errors → an explicit error message; nothing is silently written.

## What gets sent to the AI provider

AI requests go from server code to Ollama's cloud API (`https://ollama.com`) using
whichever model is selected in the picker. Nothing is stored by GET TO IT as a
result of a provider request unless you then choose to save it.

| Entry point | Sent |
| --- | --- |
| **I'M STUCK** (goal page) | Goal title, desired outcome, deadline, today's available time, blocker, open task titles with status, completed task titles |
| **Help me plan this goal** | The same goal fields, plus your answers to up to three clarification questions |
| **Task help** (five actions, four stuck options) | The active task's title, status, estimated minutes, instructions, first action and expected deliverable; the notes saved for that task (first 4,000 characters); the goal title, outcome, deadline, today's time and blocker |

**Not sent:** your email address, display name, account id, password or session,
any Supabase key, the saved notes of other tasks, or the titles of other goals.

Requirements and instructions inside tasks and notes are treated as data, and
the prompts say so explicitly. Provider-side retention and training terms are
Ollama's, not GET TO IT's; check them before inviting other people's work.

## Account deletion and usage accounting

**Dashboard → Delete your account** asks you to type `DELETE`, then removes the
`auth.users` row for your account. Everything owned by it cascades: profile,
goals, tasks, saved work, focus sessions, weekly reflections, plan records and AI
request history.

Two things deliberately survive:

- **The shared daily AI counter.** Global usage lives in `public.ai_usage_daily`,
  which has no foreign key to accounts and is written only by the reservation
  function. If the global total were counted from `ai_requests`, deleting an
  account would delete those rows and hand the shared allowance back — letting
the same requests be spent twice. Per-person counting still comes from
  `ai_requests`, because a deleted person needs no personal allowance.
- **Feedback you sent**, kept with `user_id` set to null: the message remains,
  the account does not.
- **Credit ledger rows**, kept without the account attached, because they are the
  record of credits bought and spent. Any unused credits are removed with the
  account and are not refunded automatically.

Deletion is immediate and has no undo. There is no export step; copy anything you
want to keep before confirming.

## Build an App (Phase 21)

**`/build`** turns a captured app idea into an editable specification and then
into real project files you can read, edit, restore and download.

- **One supported stack.** Next.js, TypeScript and Tailwind CSS. Supabase is added
  only when Supabase accounts are selected. No other framework is supported, and
  nothing claims otherwise.
- **Intake.** Purpose, target users, main workflows, required pages, data entities,
  authentication requirements, external integrations, design preferences and a
  definition of done. A draft specification is built from these answers.
- **Specification, approved before generation.** The editable specification covers
  features and exclusions, pages and navigation, the data model, server-side
  operations, authorization rules, integration requirements, environment-variable
  names and acceptance checks. Generation stays blocked until you approve it. An
  approved version is immutable; revising copies it into a new draft.
- **Real files, not chat blocks.** Files are generated on the server and stored in
  `app_files`, separate from tasks and saved results. The project page shows a file
  tree, a code viewer/editor, the generation status and change summary, and a ZIP
  download with a README, `ACCEPTANCE.md` and an `.env.example` that contains names
  only. No secret or invented credential is written into any file.
- **Versioned and atomic.** Each generation, save and restore writes a complete
  snapshot first and replaces the working tree inside one database function. A
  failed generation keeps the last usable version, and a restore is itself a new
  version, so it can be undone. The newest 20 snapshots are kept.
- **Safe by construction.** Paths are relative, normalised and validated in the app
  and again in Postgres: `..`, absolute paths, backslashes, reserved directories and
  real `.env` files are refused. File, page, entity, integration and total-size
  limits are enforced before any write. Nothing is executed, installed, deployed or
  purchased.
- **Honest generation.** The generated app includes frontend pages, API routes,
  zod validation, visible error states, owner-only migrations when Supabase is
  chosen, and an explicit 501 when persistence is not configured. Integrations are
  labelled **MOCKED** and their stubs make no network call. The README states that
  the result is a scaffold, not production ready.
- **Isolation.** Every project, specification, file and snapshot is owner-only under
  RLS, and the generation functions check ownership themselves.

The generator is deterministic and makes no model call, so it spends no AI requests
and adds no new AI entry point. The same approved specification always produces the
same files, which is what makes path and size validation meaningful.

## Isolated preview workspace (Phase 22)

**`/build/[projectId]/workspace`** runs a generated project away from the app.

- **A separate process, not the Next.js server.** The runner writes each project
to its own directory and executes only fixed commands: materialise the pinned
dependency cache, typecheck, lint, tests when configured, build, and start the
preview. It never accepts a command from the browser.
- **The sandbox is real.** On Linux the runner uses an unprivileged user, mount,
PID, UTS, IPC and network namespace, a tmpfs root, a chroot containing only
`/usr`, TLS certificates and the workspace, `prlimit` caps, a wall-clock timeout
and process-group cleanup. The project cannot see the host filesystem, platform
credentials or another workspace, and the network namespace has no route off
the machine. It requires no Docker and no root; if the host cannot create these
namespaces, the runner refuses to start instead of running code unsandboxed.
- **Pinned dependencies, no install scripts.** Every generated dependency is an
exact version present in the runner's read-only cache. A changed manifest, an
unknown package or a changed check script is refused. No package lifecycle script
runs during a preview.
- **Preview on its own origin.** The app signs a short-lived token bound to the
workspace and project. The preview is served on a separate host with its own
cookie, `Referrer-Policy: no-referrer`, no platform cookie forwarding and a
`frame-ancestors` policy. Unused previews expire; Stop kills the process group
and removes the directory.
- **Bounded repair with evidence.** One click runs one iteration: reserve one AI
request, send the failing check and bounded source files, accept only full
replacements of existing files under `app/`, `components/` or `lib/`, refuse tests
and configuration, save a normal version snapshot, rerun every check, and show
the log, changed files and diff. At most three repair attempts (two credits each,
six credits per workspace), three AI requests, ten minutes and 200,000 characters
of log per workspace. An unresolved failure is reported as unresolved; no error
is hidden and no test is deleted.
- **What this is not.** It is not a public deployment, a production host, a
security certification or a sandbox for arbitrary code. The generated scaffold
is still a scaffold, and a passing check only means those commands passed.

The runner is configured with `PREVIEW_RUNNER_URL`, `PREVIEW_RUNNER_TOKEN`,
`PREVIEW_SIGNING_SECRET` and `PREVIEW_PUBLIC_ORIGIN` on the app, and
`PREVIEW_RUNNER_TOKEN`, `PREVIEW_SIGNING_SECRET`, `PREVIEW_ROOT`,
`PREVIEW_DEPS_DIR` and `PREVIEW_HOST_SUFFIX` on the runner. Start it separately
with `node scripts/preview-runner.mjs`; it must not run inside the web app.
Wildcard DNS and TLS are needed for the preview host pattern.

## Agent-team mode (Phase 23)

**`/build/[projectId]/team`** is an optional team layer over a generated app.
It works from one approved specification and never treats model output as a
completed security audit.

- **Six scoped roles.** Coordinator, frontend, backend, data, QA and security.
  Each task stores its objective, inputs, role, allowed tools, expected
  artifacts, acceptance checks and runtime/AI budget. Frontend may write only
  `app/` and `components/` (not `app/api/`), backend only `app/api/` and `lib/`,
  and data only `supabase/`. QA and security are read-only. No role has a
  deployment, billing, credential or arbitrary-execution tool.
- **A durable queue with explicit states.** Tasks are queued, running, blocked,
  awaiting review, completed, failed or cancelled. The coordinator cannot append
  arbitrary scope: the queue is derived from the approved spec, and every input
  is checked against its pages and entities.
- **Branches and declared ownership.** Each task produces a logical branch of
  full-file proposals. The first task owns a claimed path; a later overlapping
  claim becomes a visible blocker instead of an overwrite. The owner can
  reassign, reject or cancel the later branch. No real Git worktree is created.
- **One controlled integration.** Completed branches are merged together only
  after every code task is completed or rejected. A stale base or duplicate path
  stops the merge before any file is written. A successful merge snapshots a new
  app version with per-file contributor attribution, then runs the sandbox
  typecheck, lint, tests and build. Failed checks are recorded, not hidden.
- **Human oversight.** The page shows who is working, task status, blockers,
  branch files, usage, integration evidence and the oversight log. The owner can
  pause, resume, reassign, reject, approve, resolve a claim conflict or cancel.
  Cancellation marks active and queued tasks cancelled; there is no background
  loop.
- **Bounds.** At most four agents are scheduled per advance, with 24 AI calls,
  1,800 seconds and 24 tasks per run. Execution is request-scoped, not a
  background parallel runtime. No recursive spawning and no unlimited self-retry:
  a schema-invalid model reply is retried at most once, every attempt counts
  against the call budget, and agents cannot change their own permissions. External actions are absent and still require
  explicit approval if added later.
- **Fixture proof.** The built-in workers are deterministic controlled fixtures,
  so collaboration, a deliberate overlap, integration, a stale-branch conflict,
  review and a limit stop are tested without a paid multi-agent call. This is not
  a claim that a live multi-agent model run has happened. The security reviewer
  reports issues; it does not perform a complete audit.

## Deployment integration (Phase 24)

**`/build/[projectId]/deploy`** supports exactly one provider for each role:
GitHub for the repository, Vercel for application hosting, and Supabase for the
development and production databases. No competing provider is connected by
the same project.

- **Scoped, encrypted connections.** Use a GitHub fine-grained token limited to
  the one repository with Contents read/write, a Vercel token limited to the one
  account/team and project, and either a Supabase account OAuth grant or
  dedicated Supabase database roles. Tokens and connection strings are encrypted
  with AES-256-GCM using the server-only `DEPLOYMENT_VAULT_KEY`; browser roles
  cannot select the sealed columns. A connection belongs to one project and is
  never reused automatically. Disconnect deletes the stored copy and tells you to
  revoke or rotate the credential at the provider as well.
- **Bring your own Supabase account.** Create a Supabase OAuth app with the
  Management API scopes, then set `SUPABASE_OAUTH_CLIENT_ID`,
  `SUPABASE_OAUTH_CLIENT_SECRET` and the exact
  `SUPABASE_OAUTH_REDIRECT_URI`. The deploy page's **Connect Supabase account**
  button stores an encrypted per-user grant, lists the person's organizations
  and projects, and attaches two different projects to the app. The projects and
  billing stay with that person's Supabase account. The OAuth path runs approved
  migrations through the Management API, so no database password is stored and
  Vercel does not need a direct Postgres connection. The original two-connection-
  string form remains available as a fallback.
- **A plan before external changes.** The plan lists the repository and branch,
  exact source version/digest and paths, hosting account/project, both database
  targets, environment-variable names, proposed migrations, repository and
  deployment visibility, known and unknown costs, and rollback limitations. A
  destructive production migration blocks automatic approval.
- **Environment requirements come from code.** `process.env.*` and `.env.example`
  are scanned; `NEXT_PUBLIC_*` is labelled public, everything else server-only.
  Values are entered through protected fields, encrypted before storage, never
  returned to the page, never written into the plan and never sent to a model or
  build log.
- **Explicit approval.** Typing `DEPLOY` approves the fingerprint of that exact
  plan. Changed files, providers, environment names or migrations invalidate the
  approval. Pre-deploy checks run against the pinned snapshot first; a failing
  check changes nothing externally.
- **The pipeline is staged and honest.** Approval enables: GitHub commit →
  production migrations (only for a production plan) → Vercel environment upsert
  → Vercel deployment → status polling → smoke check. A Vercel API success remains
  `deploying` until the deployed page passes a smoke check. Partial failures name
  what may already have happened; the app does not blindly repeat resource
  creation.
- **Preview and production stay separate.** A preview plan points at the
  development database and never applies production migrations. Application
  rollback does not reverse a database migration. A previous stored source
  snapshot can be turned into a new plan and deployed only after fresh checks and
  approval.
- **Result evidence.** A successful result shows the deployed URL, source commit,
  Vercel deployment id, pre-deploy and smoke-check results, migration state and
  known limitations. A successful hosting request is not treated as proof the app
  works.

## Improvement workspace (Phase 25)

**`/build/[projectId]/improve`** handles an incremental change without regenerating
the application. The workflow is: inspect the current tree, clarify a vague
request, propose a bounded plan, approve it, create an isolated change workspace,
apply a fixture patch, run tests, start a preview, review the diff, merge into a
new reversible source version, then approve deployment separately through Phase
24.

- **Bounded by construction.** A change starts from an exact base digest and
  changes at most six files. The existing tree is the base; unrelated files are
  preserved byte-for-byte. There is no call that regenerates the full app.
- **The fixture is explicit.** Dashboard and mobile-navigation requests produce
  real bounded source edits. Bug, dependency and integration requests produce a
  reviewable fixture page or a clearly labelled integration stub; the interface
  does not claim an arbitrary fix is complete. This is a deterministic Phase 25
  fixture, not a live model-based engineer.
- **No shortcut to merge.** Plan approval, isolated tests, a running preview,
  diff approval and a merge are separate human steps. A failed test or preview
  cannot be reviewed for merge. Merge refuses a changed base, writes one new
  `app_versions` snapshot through `replace_app_files`, and is reversible from the
  project's version list.
- **Project memory is editable, never authority.** Architecture decisions,
  integrations, conventions, limitations, test commands, deployment
  configuration names and prior procedures are explicit records. A credential,
  token, private key or database URL is refused. Repository text cannot grant a
  permission or bypass an approval.
- **Reusable skills are bounded.** A merged change can become a versioned skill
  with purpose, supported stack, fixed permissions, inputs, outputs, tests and
  limitations. Skills cannot deploy, install arbitrary tools or skip plan/test/
  diff approval.
- **Observability is opt-in and manual.** A project owner explicitly enables a
  release label and pastes selected errors. Emails, ids, IP addresses, tokens and
  database URLs are redacted before storage. No full database, user rows or
  production data is sent to an AI provider; a selected redacted error can
  propose a bounded repair request.
- **Automation is capped.** Level 1 only suggests; level 2 prepares and previews
  a patch; level 3 runs the approved bounded implementation/test/preview steps.
  No level includes deployment, and production deployment remains the separate
  Phase 24 `DEPLOY` approval.
- **Evaluation is factual.** Accepted and rejected changes, test outcomes,
  recorded regressions, runtime, AI calls and successful deployments are counted
  separately. More generated code or more agents are not treated as success.

## Known limitations

- **Improvement implementation is fixture-only and has not been run against a
  real deployment.** The workflow, bounded patch application, preview, diff,
  version merge and approval boundaries are tested with fixtures. Arbitrary bug
  fixes and dependency upgrades are not claimed. No live model or external
  deployment was used for Phase 25.
- **Deployment integration requires real provider accounts and has been tested
  with stubs, not a real external write.** GitHub, Vercel and Supabase adapters
  have fixture-tested request shapes and error redaction; no token was used and no
  repository, environment, migration or deployment was created in this phase.
- **Application rollback is not database rollback.** Redeploying an earlier
  source snapshot does not reverse migrations, restore data, rewrite GitHub
  history or move aliases automatically.
- **Agent-team mode is fixture-only.** The six roles, durable queue, file-claim rules, controlled integration and human controls are implemented and tested, but the workers do not call a model. Branches are logical file proposals rather than Git worktrees, no paid multi-agent run has been made, and the security review is issue-finding, not a complete audit.
- **Preview isolation is host-dependent.** The runner is tested on this Linux host with unprivileged user namespaces. A host that blocks them, or a serverless app host, cannot run it; the app then says the runner is unavailable rather than executing code unsafely. A real deployment needs a separate Linux runner host and wildcard preview DNS, neither of which is provided here.
- **Generated apps are scaffolds.** The one supported stack is fixture-tested for
  structure, path safety, limits and version preservation, but no generated project
  is installed, built or run here. A successful generation is not evidence that the
  app works, and it is not production ready.

- **AI quality is not guaranteed, and live AI calls are not part of the test
  suite.** Parsing, validation and error handling are fixture-tested; whether a
  given model writes a good plan is a judgement call, not an assertion.
- **Auth email depends on Supabase settings.** With confirmation on, the
  confirmation link must work from the deployed hostname; without it, accounts
  are usable immediately. No password-reset or email-change screen exists yet.
- **Export, import and backup.** Data can be exported and imported from
  `/data`; account recovery is a database restore, not an import. Scheduled
  encrypted backups are written to R2; see `DEPLOYMENT.md`. Deletion is
  permanent and there is no per-row purge.
- **Timer boundaries.** One session counts at most 8 hours; a session left open
  more than 12 hours is closed at the time it reached. Today/week totals are
  grouped by when a session started, in UTC, so a session crossing midnight
  counts to the day it began.
- **One AI request at a time per account**, and the daily allowances are global
  configuration, not per-plan quotas. These are request counts, not money.
- **Partner invitations are not emailed, and nothing is actively moderated.**
  You copy the link and pass it on; reports are stored for a person to read, so
  blocking is the self-serve control that takes effect immediately.
- **Payments are test mode by design.** Nothing live is enabled, no subscription
  or recurring charge exists, and the prices in `credit_packs` are placeholders
  to confirm before selling. Tax and legal treatment of prepaid credits has not
  been reviewed; no compliance claim is made.
- **The only workflow connector is simulated.** It records the approved text
  inside GET TO IT and contacts nothing, so “saving” through a workflow is a
  rehearsal, not delivery. A real connector would need its own reviewed
executor; the approval and action records are designed to be reused for it.
- **Workflow runs are manual.** Nothing schedules or resumes a run in the
  background, drafting needs `OLLAMA_API_KEY`, and post-failure recovery is a
  button you press rather than an automatic retry.
- **Outcome reviews are self-reported.** They record what you noticed, not a
  controlled measurement. The four answers are separated precisely so the app
  cannot imply that a finished action caused a result.
- **Missions use one model, and AI never governs.** Suggestions are input to a
  human conversation, not a vote or a decision. Accepting one does not approve
  anything, and the group still has to record a decision with a named approver.
- **Radar signals are recorded by hand.** There is no crawler, feed reader or
  search integration, so the radar is only as current as what you add. It is a
  reading log with attribution and dates, not a monitoring service.
- **Reviews use one model, in five separate calls.** The five perspectives are
  not independent reviewers: agreement between them is repeated output, not
  evidence, and the interface says so. A review is a structured second opinion,
  not an audit.
- **Future paths are an assumption-based exercise, not research.** No search or
  retrieval tool is connected, so nothing is fetched or fact-checked; a
  "retrieved fact" survives only when you supplied its URL. Scenarios are not
  predictions, no probability is computed, and no financial, medical or legal
  decision is made for you. A review date is a note to yourself, not a scheduled
  reminder.
- **Import is additive, never a merge.** It cannot replace an account, reconcile
  two copies of a goal or import focus time; restoring an account is a database
  restore, not an import. An existing week's reflection is reported as skipped
  rather than overwritten.
- **No offline mode, and no external notifications.** Reminders are in-app rows;
  there is no email, SMS or push delivery, and the app needs a network connection.
- **Templates are starting points, not a marketplace.** Static templates are
  hand-written, so they reflect one reasonable approach rather than research.
  Personal templates copy task names and time estimates only; saved work,
  reflections and AI answers are deliberately left out, so a template is not a
  backup of a goal.
- **Scheduled passes are only as frequent as the host allows.** On a Hobby Vercel
  plan the cron runs daily, so delivery is otherwise driven by opening the
  reminders page. Reminder times are therefore best-effort to the minute, never a
  guarantee.
- **Accessibility is designed for but not audited.** Keyboard paths, labels and
  live regions exist; there has been no formal WCAG audit.
- **Real-browser checks are outstanding.** They are listed as an owner checklist
  in the release note rather than marked as passed.
- **No analytics and no paid billing.** A scheduled GitHub Actions monitor
  checks health, API boundaries and backup freshness. Unhandled server request
  errors are written to a sanitized Supabase `error_events` table, and a scheduled
  workflow opens a GitHub issue while they occur; browser errors are not
  collected. Server logs are whatever the host collects.
- **Feedback is stored, not emailed.** Read it in the `feedback` table.

## Deployment

GET TO IT is deployed at https://get-to-it-wvpy.vercel.app. `/api/health` is the
source of truth for the live revision. See `DEPLOYMENT.md` for the production
target, migrations, backups and rollback constraints, and `OPERATIONS.md` for
the release checklist.

## Private pilot

See [`PILOT.md`](PILOT.md) for invitation text, the four questions worth asking,
what to watch for, and the rule that no participant results are claimed before
they exist.

## Mission control (Phase 34)

Mission control attaches to an existing workspace mission at
`/workspace/{workspaceId}/missions/{missionId}/control`. It connects the
mission's human-defined outcome to existing app projects, deliverables,
dependencies, accountable people, review dates and bounded agent jobs. Projects
must be linked explicitly; mission control never creates a project, task or job
on its own.

The page suggests a dependency-aware work order and parallel groups, and names
missing owners, missing review dates, cycles and resource conflicts. It states
its assumptions and says plainly that the order is not a guaranteed schedule.

Execution reuses the existing project task/queue system and adds mission-level
limits for parallel jobs, total jobs, agent calls and runtime. The smaller of the
project and mission allowances always wins. A job waits for its job and milestone
dependencies, duplicate dedupe keys are refused, a failed dependency pauses
downstream work, cancellation propagates, recovery pauses stale running jobs,
and completed artifacts are preserved. There is no autonomous background loop,
external write or deployment.

Scope changes, external writes, deployments and permission increases are
escalated as separate approval records. A different owner or admin must decide;
a requester cannot approve their own request, and an agent cannot approve its own
permission increase. The dashboard reports progress by deliverable, blocked
dependencies, pending decisions, disagreements, resource use, saved test evidence
and upcoming reviews. It does not rank people or compute a surveillance-style
productivity score.


## Experiment workspace (Phase 35)

The experiment workspace lives at `/workspace/{workspaceId}/experiments`. It
turns a future-facing idea into one bounded question, an explicit hypothesis,
target users, existing evidence, assumptions, a smallest prototype, success and
failure criteria, time and resource limits, privacy and consent requirements,
stop conditions, an AI disclosure and a review date. An experiment can link an
existing mission, future path, radar signal, learning goal or outcome review;
linking never creates another record or grants access to it.

The planning assistant compares approaches, names missing evidence or decisions,
proposes a smallest prototype, prepares interview questions and suggests a next
step from the recorded review. It works from the saved fields and fixed rules,
makes no model call and invents no participant, quote or result. The interface
shows participants where AI assistance is involved.

Participation is voluntary. Feedback cannot be stored without recorded consent,
an identifiable quote also needs explicit permission to quote it, and
publication needs a separate approval. Observations are append-only and labelled
as measured, participant opinion, failure or still unknown; the summary never
turns an opinion into a measurement. High-stakes human-subject research
(medical, legal, financial, safety, crisis or work with minors) is refused by
this generic workflow.

An owner or admin can approve a prototype. That creates an ordinary app-builder
project and specification, with no separate execution path; sandbox, test and
deployment approvals are unchanged. Real outreach, publication, paid activity
and deployment each require their own approval, a requester cannot approve their
own request, and approval never performs the external action. The outcome review
keeps the original hypothesis and records what was built, observed, failed and
remains unknown before a person chooses continue, revise or stop. A deployed
prototype is not treated as proof of social benefit.

## Reading the credit ledger

`credit_ledger` is append-only: a balance is the sum of its rows, and no row is
ever updated or deleted. When a payment row is deleted the ledger row survives
with `payment_id` set to null, so `owner_metrics()` still counts those credits as
sold while `payments_paid` and `revenue_cents` drop to zero. A purchase made in
test mode and later cleaned up therefore shows as credits sold with no matching
payment: visible in the totals, not corrupt.

Corrections are new rows with reason `adjustment`. `credit_ledger_guard` requires
a non-null `user_id`, so an orphaned purchase cannot be reversed anonymously.
Either decide which account the correction belongs to, or leave the row as
history.

## MAGI outcome orchestration (Phase 36)

Orchestration carries an approved goal from planning to verification and a human
outcome decision. It references an existing mission, experiment, learning goal,
radar signal, scenario or earlier review by id; a new goal is stored as an
existing-style mission. Nothing is copied into a second store.

`supabase/migrations/0048_phase36_magi_orchestration.sql` adds the contract,
task, evidence, checkpoint, event and review tables. Contracts are versioned and
immutable once approved: approval binds to one version and fingerprint, and a
material change (spending, scope, recipients, data access, consent, targets,
external effects, time, criteria or tools) needs a new version and its own
approval. `orchestration_transition` repeats the lifecycle table server-side, and
client roles have no `update` grant on the lifecycle tables: status moves,
reservations, verification and the outcome decision happen only through the
security-definer functions.

Spending is integer micro-credits (1 000 000 = 1 credit = $0.10 retail), using
the existing rate card. `orchestration_reserve_task` locks the orchestration row,
so two concurrent tasks cannot reserve past the authorized maximum; failure
releases the unused reservation and charges nothing. Agent output never marks a
task verified: verification needs a matching, passing automated test, direct
observation or human judgment, and agent consensus is refused as independent
verification.

**This migration is applied to the production Supabase project**
(`qhlzjhdcnlokbsdsrqqy`), with explicit approval, on 2026-11-11. The management
API takes inline SQL, so the single committed file was applied as four tracked
chunks: `0048_phase36_a_schema`, `_b_rpcs`, `_c_review_and_rls` and
`_d_tighten_grants`. The migration history therefore carries four rows for one
file; every statement is idempotent, so re-running this file against a fresh
database is still the intended path. Older drift is still there and unrelated:
`0045`-`0047` are in effect on that project but were never recorded, so the
history table stops at `0044` before these four rows.

Verified on the hosted project afterwards: 7 tables with RLS enabled and 13
policies; 16 functions whose body hashes match this file byte-for-byte; 31
foreign keys; `authenticated` holding only `select` and `insert` (`select` alone
on `orchestration_reviews`), with no `update`, `delete` or `truncate`, and `anon`
holding nothing. Nothing was deployed: the orchestration routes start working
only once this branch is merged and built, and no prototype was generated,
published or measured, and no external action was performed.

`0049_phase36_plan_window` follows it: `0048` allowed a plan to be inserted only
while an orchestration was `draft` or `awaiting_approval`, but the page offers
"Draft the bounded plan" as soon as a contract is approved, which is `ready`, so
the ordinary create-submit-approve-plan flow always failed. The window now runs
through `ready` and stops at execution; the approved contract, the task guard and
the reservation ceiling are unchanged.

`0050_phase36_approvals_survive_account_deletion` relaxes the three approval
checks and the review guard so deleting an account can null `approved_by` and
`decided_by`: before it, anyone who had approved a contract, decided a
checkpoint or recorded a review could not be deleted at all (23514), which broke
both account deletion and the E2E sweep.

The file was executed first against a disposable PostgreSQL 18 instance with the
Supabase-provided objects stubbed: the DDL applied and re-applied cleanly, and 56
RLS/RPC checks passed for cross-tenant access, contract approval, budget
reservation and release, the external-action gate, verification, immutability and
review gating. That harness could not model Supabase's default privileges, which
grant `ALL` on new `public` tables to `authenticated`; on the hosted project that
left `update`, `delete` and `truncate` in place despite the narrower `grant`
statements, so they are now revoked explicitly, as `0046` did for
`app_projects`.

## Evidence-backed knowledge layer (Phase 37)

The knowledge layer sits on top of records that already exist: experiments and
their reviews, outcome reviews, learning records, goals, mission workspaces,
orchestration reviews and project models. It links them by id and never copies
them into a competing store.

`supabase/migrations/0051_phase37_knowledge_layer.sql` adds `knowledge_entries`,
`knowledge_sources`, `knowledge_evidence`, `knowledge_impacts`,
`knowledge_corrections`, `knowledge_transfers` and `knowledge_events`.

An entry is either a claim or a reusable procedure, typed as a user preference,
a project fact, a participant opinion, a measured observation, a tested
procedure, a hypothesis or an AI suggestion. Those types are stored separately
and none of them silently becomes another. An AI suggestion and a hypothesis can
never be marked `supported` as written: the check constraint refuses it, and
`knowledge_set_verification` refuses it with an explanation. Marking something
supported also needs a person (the entry owner or a workspace owner/admin), a
written basis of at least ten characters and at least one recorded supporting
item or a source that still exists. No function accepts agent consensus as
verification.

Sources and evidence are appended, never edited: `knowledge_evidence` refuses
`delete` and every `update` except the nulling of an author id when an account is
deleted, mirroring `0050`. Verification, sentence-level corrections, new
versions and retractions are security-definer functions. Client roles hold
`select` only on all seven tables, so no status can be moved by a direct write;
the same default-grant caveat as `0048` applies and the write privileges are
revoked explicitly.

Versions are immutable: superseding creates a new unverified row and marks the
older one `superseded`, which is no longer presented as current guidance or
returned by retrieval. Accepting a correction supersedes the entry with the
proposed wording; accepting a dispute retracts it. Retraction also sets
`invalidated_at` on every linked decision in `knowledge_impacts`, so the
recommendations built on it are listed for revisiting rather than silently left
looking sound.

A transfer is a proposal in `knowledge_transfers`. It records the similarities,
the differences, an evidence summary and an assumption that needs a new test,
and only an owner or admin of the target workspace can approve it. On approval a
new entry is created there with `transferred_from_id`, a `transfer` source row,
provenance naming the source workspace, the evidence *counts* rather than the
evidence text, and limitations that say it was verified only in the source
workspace and is not yet tested here. Participant feedback, personal records and
artifacts are never copied.

`knowledge_retrieve` is a security-*invoker* function: row-level security still
applies, membership is re-checked in the query, and retracted or superseded
entries are excluded. The pages additionally ask only for records in the current
workspace, so a link never grants access to the record it points at.

**This migration is applied to the production Supabase project**
(`qhlzjhdcnlokbsdsrqqy`), with explicit approval, on 2026-11-11. The management
API takes inline SQL, so the committed file was applied as four tracked chunks:
`0051_phase37_knowledge_layer` (tables, guards, source authorization and the
create/source/evidence functions), `0051_phase37_knowledge_rest` (verification,
versions, retraction, corrections, transfers, impacts, purge, retrieval, RLS,
policies and grants), `0051_phase37_tighten_guard_grants` (no role may execute
the trigger functions) and `0051_phase37_guard_body_match`, which restored the
explanatory comments in `knowledge_entries_guard` so the stored body hashes to
the committed file. The history therefore carries four rows for one file; every
statement is idempotent, so re-running the file against a fresh database is still
the intended path.

Verified on the hosted project afterwards: 7 tables with RLS enabled and 7
policies, all `select`; 30 foreign keys; 17 functions, all 17 matching this file's
bodies byte-for-byte; `authenticated` holds only `select` on every table and
`anon` nothing; the fifteen callable functions are executable by `authenticated`
and none by `anon`; the two guard triggers are executable by no client role,
which is correct because they only fire from their own tables; and
`knowledge_retrieve` is the only function that is neither `security definer` nor
a trigger. All seven tables were empty at the end of verification.

`0052_phase37_role_null_guards` follows it, applied to the same project.
`v_role not in ('owner', 'admin')` is `NULL` — not false — when the caller is not a
member at all, so the guard never fired: a non-member could approve a transfer
into a workspace they did not belong to, and could purge entries past retention
in any workspace. Both functions now test the null role explicitly, and
`knowledge_set_verification` rejects a null status instead of silently resetting
to unverified. Found by driving the flow with two accounts; proven live
afterwards — the requester gets 400, the target owner's approval succeeds, and a
retraction marks the linked recommendation invalid.

`0053_phase37_link_cascade_guard` fixes the identity guard's last hole: the
version links (`supersedes_id`, `superseded_by_id`, `transferred_from_id`) are
`ON DELETE SET NULL`, and the cascade's clearing update was refused, so retention
purge and workspace deletion failed for any superseded or transferred entry.
Clearing a link and filling an empty one are allowed now; rewiring an existing
link is not.

`0054_phase28_role_null_guards` applies the same NULL-role fix to the Phase 28
build room, where a non-member could create or cancel a build task, review,
merge or rebase a changeset, and link a project into a workspace they were not a
member of. The build-room guards now reject a null role, and
`npm run check:role-guards` fails CI if any function reintroduces the pattern.

`0055_phase28_null_role_lookup_guards` closes the two shapes the first audit pass
could not see: a role lookup (`workspace_role(...)`, `app_project_role(...)`,
which is NULL for a caller who is not a member) and a compound condition whose
role half is NULL. It covers eleven guards, including a stranger creating a
changeset or share link in any project and any signed-in user cancelling another
workspace's mission job.

Checks run for this phase: `tsc --noEmit`, `eslint` on the new files, the full
`vitest run` (930 passing) including the new pure-rule suite in
`tests/knowledge.test.ts` (validity, promotion refusal, verification
permissions, versioning, corrections, transfer rules and copy, retrieval
authorization, invalidation, retention and source health), and the catalog
verification above. No knowledge entry has been created in production yet, so
the functions have not been exercised against live data.
