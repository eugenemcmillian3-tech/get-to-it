# Operations

Everything an owner needs to run GET TO IT: configuration, health, logs, migrations,
backup, restore, account controls, test isolation and the release checklist.

Two rules come before all of it:

1. **Nothing in this document authorizes touching production.** Restoring a
   production database, rotating a live key or deploying is a separate, explicit
   decision.
2. **A restore is tested on isolated data first.** `npm run test:restore` starts a
   throwaway Postgres, replays every migration and runs the restore and
   authorization drill there. It never connects to the hosted project.

## Configuration reference

| Variable | Required | Exposure | Read in | If missing |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | browser-safe | `src/lib/supabase/config.ts` | Every page shows the setup notice; nothing pretends to work |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | browser-safe | same | Same |
| `SUPABASE_SERVICE_ROLE_KEY` | for platform recovery and exception monitoring | **server only** | `/api/platform/health/run`, `src/lib/observability/report-exception.ts` | Recovery stays disabled and unhandled server exceptions are not recorded; the app still works |
| `OLLAMA_API_KEY` | no | **server only** | `src/lib/ai/ollama.ts` at call time | AI panels explain the missing key; templates, exports and imports still work |
| `STRIPE_SECRET_KEY` | no | **server only** | `src/lib/credits/stripe.ts` | Checkout shows a setup message; nothing charges |
| `STRIPE_WEBHOOK_SECRET` | no | **server only** | `src/app/api/stripe/webhook/route.ts` | The webhook returns 503 |
| `CREDIT_RPC_TOKEN` | no | **server only** | webhook route | The webhook returns 503 |
| `RESEND_API_KEY` | no | **server only** | `src/lib/credits/receipt.ts` | A completed purchase is recorded but no receipt email is sent |
| `RESEND_FROM` | no | **server only** | `src/lib/credits/receipt.ts` | Receipts send from the documented `no-reply@mail.network-x-ai.win` sender |
| `STRIPE_ALLOW_LIVE` | no | **server only** | `src/lib/credits/stripe.ts` | A `sk_live_` key is refused |
| `CRON_SECRET` | for scheduled recovery | **server only** | `/api/reminders/run`, `/api/platform/health/run` | Both scheduler endpoints return 503; in-app delivery still works |
| `PLATFORM_SELF_HEALING` | no | **server only** | `src/lib/platform-health.ts` | Defaults to enabled; set to `false` to disable the recovery route |
| `GIT_REVISION` | recommended | public through `/api/health` | `src/lib/revision.ts` | Health reports `revision: "unknown"` |
| `GIT_DIRTY` | optional | public | `src/lib/revision.ts` | Dirty state is not reported |
| `DEPLOYMENT_VAULT_KEY` | for Phase 24 | **server only** | `src/lib/deploy/vault.ts` | Provider connections and deployment plans cannot be saved; no fallback key is used |
| `SUPABASE_OAUTH_CLIENT_ID` | for Phase 26 | **server only** | `src/lib/deploy/supabase-oauth.ts` | The OAuth connect button explains that Supabase OAuth is not configured |
| `SUPABASE_OAUTH_CLIENT_SECRET` | for Phase 26 | **server only** | same | Same |
| `SUPABASE_OAUTH_REDIRECT_URI` | for Phase 26 | **server only** | same | The route falls back to the request origin; set this in production so the callback exactly matches the registered URL |

Database-side configuration:

| Setting | Where | Notes |
| --- | --- | --- |
| AI allowances (`per_user_daily`, `global_daily`, `in_flight_seconds`) | `public.ai_limits`, one row | `per_user_daily = 0` means no free plan; change only with a pricing decision |
| Credit pack prices | `public.credit_packs` | $0.10 per credit, five packs; the table constrains amount to credits × 10 cents |
| Operation rate card | `RATE_CARD_DRAFT.md` + `0035_operation_budgets.sql` | Applied to production; live billing remains off. Fixed per-operation credits, build/workflow/swarm budgets. `ai_prices` remains empty |
| `credit_webhook` secret | `public.app_secrets` | Must equal `CREDIT_RPC_TOKEN`; the webhook has no signed-in user |
| Owners | `public.app_owners` | Only these accounts may open `/owner` |

Never put a `service_role` key, a Stripe secret, an Ollama key, a GitHub,
Vercel or Supabase credential, or a webhook token in `NEXT_PUBLIC_*`, client
code, a repository file or chat. The server needs `SUPABASE_SERVICE_ROLE_KEY`
only for the sanitized exception sink; all ordinary data access uses the anon key
plus RLS.

### Deployment credentials

Phase 24 uses one GitHub fine-grained token limited to one repository (Contents
read/write), one Vercel token limited to the chosen account/team and project,
and two Supabase Postgres connection strings for different development and
production projects. Use a dedicated migration role rather than the `postgres`
superuser and include `sslmode=require`. Generate
`DEPLOYMENT_VAULT_KEY` with 32 random bytes (base64) or 64 hex characters and
keep it server-side. Rotating it makes existing sealed connections unreadable;
reconnect them instead of restoring the old key.

Phase 26 adds an optional account-level Supabase OAuth path. Create an OAuth
app in the Supabase organization settings, enable the scopes for
`organizations:read`, `projects:read`, `projects:write`, `secrets:read` and
`database:write`, and register the exact callback URL
`/api/integrations/supabase/callback`. Set the client ID, secret and callback
URL as `SUPABASE_OAUTH_CLIENT_ID`, `SUPABASE_OAUTH_CLIENT_SECRET` and
`SUPABASE_OAUTH_REDIRECT_URI`. The OAuth grant belongs to the signed-in person;
projects stay in their Supabase organization and Supabase bills them. Access and
refresh tokens are sealed with `DEPLOYMENT_VAULT_KEY`, and the browser only sees
the safe account view. Revoking the account deletes its sealed tokens and revokes
project connections that depended on it. OAuth-connected plans run migrations
through the Management API, so no database password is stored and Vercel does not
need a direct Postgres connection. A free Supabase account still allows two
active projects, and this app's current plan uses two projects per generated app.

A deployment plan never contains a token or value. Approval requires typing
`DEPLOY` and is bound to the plan fingerprint. Pre-deploy checks run against the
pinned snapshot; repository, migration, environment and hosting actions happen
only after that approval. Preview plans never apply production migrations. A
hosting API success is not success until the smoke check passes. There is no
automatic retry of actions that may already have created a resource, and
redeploying an application snapshot does not reverse database changes.

Provider tokens and environment values are sealed in Postgres with AES-256-GCM;
the browser has no select grant on the sealed columns. Disconnecting deletes the
sealed copy, but it cannot revoke a credential still held by the provider —
revoke or rotate it there as well.

### Improvement workspace

Phase 25 stores project memory, change requests, skills, selected error records
and evaluations in owner-only tables. Memory must never contain a credential,
token, private key, database URL or environment value; the app refuses those and
memory is never interpreted as a permission grant.

Changes are fixture-implemented in this phase. A change starts from an exact
base digest, changes at most six files, preserves the rest, and stays isolated
until tests pass, a preview is running, the owner approves the diff, and an
explicit merge writes one new reversible source version. A merge never deploys.
Production deployment remains the separate Phase 24 `DEPLOY` approval.

Observability is opt-in per project. Only selected errors are pasted into the
protected form; emails, ids, IP addresses, tokens and database URLs are redacted
before storage. Do not paste database dumps, user rows or full production data,
and do not send such data to an AI provider. The selected error can propose a
bounded repair request, which still needs every normal approval.

Skills record a verified procedure and its fixed permissions. They cannot deploy,
install arbitrary tools, change provider connections or skip approvals.

## Health check

`GET /api/health` returns JSON and no secrets:

```json
{
  "status": "ok",
  "revision": "ee4be62a1b2c",
  "checks": {
    "database": "ok",
    "configuration": "configured",
    "model_provider": "configured",
    "self_healing": "enabled"
  },
  "checked_at": "2026-11-02T08:00:00.000Z"
}
```

- `200 ok` — the app is configured and `public.health_probe()` answered.
- `503 degraded` — `configuration: "missing"` or `database: "unavailable"` says which.
- `cache-control: no-store`; nothing is cached.
- The probe is a security-definer function returning only `{ ok, checked_at }`.
  It selects no table, counts nothing and cannot name a user, goal or key.

A passing health check means the process is alive and the database answers. It does
not prove the migration level, a correct deployment, an email provider, a Stripe
webhook or that any feature works. `model_provider` and `self_healing` are
reported for visibility; they do not change the overall `200`/`503` result.

### Platform self-healing

`GET` or `POST /api/platform/health/run` is the recovery pass. It requires
`Authorization: Bearer $CRON_SECRET`, uses the server-only service-role key, and
returns `no-store` JSON. The **Platform health recovery** GitHub Actions workflow
calls it every five minutes as a fallback; a Vercel cron can call the same route.

It repairs only known recoverable conditions:

- in-flight AI reservations older than `ai_limits.in_flight_seconds` are marked
  failed and their reserved credits and budget are released;
- agent tasks left `running` past their task budget plus 60 seconds are re-queued
  while `attempts < 3`, then marked failed at the retry limit.

A missing database, missing service-role key or failed recovery RPC returns
`503` with an escalation reason; it never reports a false success. The pass does
not deploy, roll back a release, call a model or change task permissions. Set the
GitHub repository variable `PLATFORM_HEALTH_URL` to the deployed origin and the
repository secret `CRON_SECRET` to the same value as the host.

### Production monitor

The **Production monitor** workflow runs every five minutes and checks the
production home and sign-in pages, `/api/health`, the public developer API and
the unauthenticated boundaries of the projects, MCP, reminders and Stripe
webhook routes. It also verifies that the latest successful
`production-backup.yml` run is no more than 36 hours old; this proves the backup
schedule is producing runs, not that every R2 object is retained. It opens or
updates one GitHub issue on failure and closes it after recovery. It is synthetic
HTTP, health and backup-freshness monitoring, not exception-level application
tracing; scheduled GitHub Actions can be delayed.

### Exception monitoring

`src/instrumentation.ts` exports Next.js `onRequestError`. It writes a sanitized
row to `public.error_events` through the server-only
`SUPABASE_SERVICE_ROLE_KEY`: environment, release, runtime, route path, method,
error class name, digest and stack frames. It never sends the error message,
request body, headers, cookies, user id or email. If the key or Supabase URL is
missing, reporting is a no-op and the original error still surfaces.

The table enables RLS with no policies and has no grants for `anon` or
`authenticated`; only `service_role` can write. The scheduled
`.github/workflows/error-monitor.yml` job queries the table through
`PRODUCTION_DATABASE_URL` every 15 minutes, opens `Production exceptions:
unhandled server errors` when the last hour has any rows, updates it while they
continue, and closes it after an hour with none. The issue contains only counts
and timestamps. The same job deletes rows older than 30 days. This covers server
request errors; browser render errors are not collected.

## Logs

`src/lib/log.ts` writes one JSON line per event: timestamp, event name, outcome,
short code and small counts. It accepts only keys matching `^[a-z][a-z0-9_]*$` and
values that are numbers, booleans or short `[a-zA-Z0-9_.:-]` strings. Free text is
dropped, not truncated, so a goal title, saved work, reflection, email, prompt or
token cannot reach host logs through this path.

Events currently logged: `health_check`, `platform_recovery`,
`platform_recovery_ai`, `platform_recovery_tasks`, `export_json`,
`export_csv`, `import_preview`, `import_commit`.

Existing `console.error` calls keep the provider's short message and an error code;
they never print a key or a row. Log retention is whatever the host provides. The
exception sink described above stores only sanitized class, path and stack-frame
metadata; it is not a general log store.

## Migrations

- Files live in `supabase/migrations/` and are applied in filename order, once each:
  `0001` … `0044_agent_models_and_platform_recovery.sql`.
- Production migration history was reconciled on 2026-11-07: rows
  `0034_credit_pricing` (`20261107000000`) and `0035_operation_budgets`
  (`20261107000001`) were added after schema verification, without re-running
  either migration. `0036_error_events` (`20261107035600`) was recorded after the
  table was applied; RLS is enabled and only `service_role` has access.
- They are forward-only. There are no down migrations, and no rollback has been
  tested. Treat every migration as one-way.
- Migrations are written to be re-runnable where possible (`create table if not
  exists`, `drop policy if exists`, `create or replace function`), but re-running a
  migration that alters data is not guaranteed to be harmless.
- A failed migration leaves whatever it committed. Supabase runs each migration in
  a transaction only when the whole file is one transaction; several of these files
  contain intentional `do` blocks and statements that commit separately.
- **Rolling back** means restoring a backup into a new project (below), then
  pointing the app at it. Do not attempt a hand-written inverse migration on
  production.

Verifying a migration level without touching data:

```sql
select count(*) from information_schema.tables
 where table_schema = 'public'
   and table_name in ('goals','tasks','workflows','action_records');

select public.health_probe();

select conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conname = 'ai_requests_kind_check';
```

## Backup

What to back up:

1. **The Postgres database** — the whole project database, including the `auth`
   schema, because accounts live there. Supabase's dashboard backups (or a
   `pg_dump` with a direct connection string) are the supported routes.
2. **The environment** — variable names and values in the host's secret store.
   They are not in the database and not in git.
3. **The source revision** — the commit that was deployed (`GIT_REVISION`), so a
   restore can be matched to code.

What is not in a database backup: host configuration, DNS, Stripe dashboard
settings, the Ollama account and any secret value. A restore is incomplete without
those.

Recommended cadence: daily automated backups, plus a manual export before any
migration. The **Production backup and restore test** workflow dumps the
database, restores it into a disposable Postgres, encrypts it and uploads it to
R2; verify the latest run and retention before relying on it. A person's own data
can be exported from `/data` at any time; that is not a substitute for a
database backup.

## Restore

**Never restore over the production database without explicit approval from the
owner.** The safe path is a new project:

1. Create a new Supabase project (or a new empty database).
2. Restore the dump into it. This recreates `auth.users`, so accounts and sessions
   come back as they were at backup time.
3. Run any migrations newer than the backup, in order.
4. Point the app's `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` at
   the new project, and set the server secrets again (they are not in the dump).
5. Open `/api/health` and confirm `status: "ok"`.
6. Sign in with a known account, open `/data`, and export: this proves reads work
   without writing anything.
7. Only then switch DNS or the deployment's environment, and say plainly which
   revision and which backup timestamp are live.

Testing a restore **before** trusting it:

```bash
npm run test:restore
```

That starts an embedded Postgres in `.restore-data/` (gitignored), creates a
database named `restore_test`, replays every migration from scratch, seeds two
temporary accounts, and runs `tests/restore.integration.test.ts`:

- the migrations apply to an empty database;
- an export contains only the seeded account's rows, with local references and no
  owner ids;
- re-importing that export is additive and leaves the original goal, tasks and
  preferences untouched;
- Row Level Security still hides one account from the other, and cross-account
  writes are refused;
- `health_probe()` answers;
- `delete_my_account('DELETE')` removes the account's rows and the account, keeps
  the shared usage counter unchanged, and leaves the other account alone.

The test refuses to run unless `current_database()` contains `restore_test`, so it
cannot be pointed at the live project by accident. It needs the `embedded-postgres`
development dependency; if it cannot start in a restricted environment, the drill
is reported as not run rather than assumed to pass.

### Phase 37 knowledge harness

```bash
npm run test:knowledge
```

`scripts/knowledge-harness.mjs` starts its own embedded Postgres in
`.knowledge-data/`, creates a database named `knowledge_test`, replays every
migration, and runs `tests/knowledge.integration.test.ts`. It reads no project
URL or service key, and the test refuses to run unless `current_database()`
contains `knowledge_test` on a local host, so it cannot reach the hosted project.

The harness checks the rules the migrations enforce, not the interface:

- the seven knowledge tables exist with RLS on and clients hold `SELECT` only;
- verification needs a written basis and refuses AI suggestions and hypotheses;
- one workspace's entries, evidence and retrieval stay invisible to another;
- a transfer proposal is visible to both workspaces only, and only an owner or
  admin of the target may approve it, including the NULL-role case that 0052
  fixed, where a non-member's approval used to succeed;
- a non-member cannot purge another workspace's entries;
- superseding records both version links, and a retraction marks the linked
  recommendation invalid and drops the entry out of retrieval while the approved
  copy in the other workspace keeps standing;
- retention purge deletes linked versions, and deleting a workspace clears the
  `transferred_from` link instead of raising (the case 0053 fixed);
- client roles cannot write, recorded evidence cannot be deleted, and deleting an
  account removes its workspace and knowledge.
- a caller with no project role cannot create a build task, review a
  changeset, or link a project into a workspace they do not belong to.

CI runs this on every pull request and on every push to `main`, inside the
`checks` job, so a migration that reopens one of these guards fails the build
rather than waiting for someone to run the drill by hand.

### Role guard audit

```bash
npm run check:role-guards
```

`scripts/sql-role-guard-audit.mjs` reads the latest definition of every function
across the migrations and fails when a role guard can pass for a caller with no
role: `v_role not in ('owner','admin')` is `NULL`, not false, when there is no
role, so `if ... then raise` never runs. This defect shipped twice — in the
Phase 37 knowledge functions (0052) and in the Phase 28 build room (0054) — and
the same scan generated `0054`, so the check and the fix share one rule set. It
runs in CI beside the drills.

## Account controls

Deleting an account from **Settings** removes the `auth.users` row. Cascades do the
rest.

| Data | On account deletion | Why |
| --- | --- | --- |
| Profile, email, sign-in record | Deleted | No account remains |
| Goals, tasks, saved results | Deleted | Private content |
| Focus sessions, weekly reflections, daily check-ins | Deleted | Private content |
| Preferences, reminders, templates, daily plans | Deleted | Private settings |
| AI request rows, learning paths, workflows, runs, action records, future paths and their scenarios, reviews and their perspectives, and radar topics and signals, and missions with their evidence, decisions, tasks, outcomes and suggestions, and outcome reviews with their observations, forecasts and improvement records, and app projects with their specifications, generated files and version snapshots | Deleted | Private content and history |
| Workspaces you own | Deleted with their goals, tasks, comments and notifications | Nobody else can inherit an ownerless workspace |
| App projects, specifications, files, versions, preview workspace runs, and agent-team runs with tasks, branches, integration evidence and events | Deleted | Private content and history |
| Workspace membership elsewhere | Deleted; your comments and created tasks stay attributed to a former member | Shared work belongs to the workspace |
| Partnership rows and encouragement messages | Deleted on both sides | The thread is shared, and ending it revokes access |
| Partnership reports you filed | Kept for you while the account exists | Reports are for a person to read |
| Feedback you sent | **Anonymised**: `user_id` set to null, message kept | Feedback is a product record, not a profile |
| Credit ledger rows | **Retained without the account**, with the account reference removed | Accounting record of credits bought and spent; unused credits are not refunded |
| Shared daily AI counter (`ai_usage_daily`) | **Retained as a number** | If it were rebuilt from `ai_requests`, deleting an account would hand shared allowance back |
| Operational logs | Retained as event names and counts | No content is logged |
| Database backups | Retained until the backup retention window expires | Deleted rows can still exist in older backups; there is no per-row purge |

What is **not** kept: no analytics profile, no behavioural shadow record, no
anonymised goal content, no derived summary of private work. Anonymisation is
limited to feedback, and retention is limited to accounting counters and the ledger.

Disconnecting an integration (Stripe, a connector) is separate from deleting the
account: revoking a key stops future calls but does not remove rows already written.
The only connector in this build is simulated and stores nothing external.

## Test isolation

Destructive checks no longer run against the live application database.

- The old `supabase/tests/rls_ownership_checks.sql` script, which needed two real
  accounts and a live project, has been removed.
- `npm run test:restore` uses an isolated embedded Postgres with a database named
  `restore_test`, and the test refuses any other database name.
- The drill does not clear production usage records, does not change shared
  quotas, and does not reuse published credentials: it creates its own roles,
  accounts and rows inside a throwaway cluster.
- The live project was used only to apply migrations and verify schema shape with
  read-only queries; no destructive routine is kept there.

`npm test` covers the pure export, import, workflow, workspace, learning and
planning rules with fixtures and makes no network or database calls.

Pricing-specific rollout and rollback steps, including the `0034`/`0035` order and
the live Stripe gate, are in [`DEPLOYMENT.md`](DEPLOYMENT.md#pricing-rollout-0034-and-0035).

## Release checklist

Run:

```bash
npm run release:check
npm run test:restore
```

`release:check` prints the source revision and runs: typecheck, lint, unit tests,
production build, secret pattern scan and `npm audit --omit=dev --audit-level=high`.
It exits non-zero if any step fails. `test:restore` is separate because it needs a
database.

The `authenticated-e2e` check is advisory on pull requests, so a green PR is not
enough for release. After merging, check out or pull `main` and run:

```bash
npm run check:e2e:post-merge
```

Pass the merged commit explicitly if `HEAD` is not the merge commit:

```bash
npm run check:e2e:post-merge -- --commit <merge-sha>
```

The check fetches `origin/main` if the merge commit is missing locally, then waits
for the push-triggered **Authenticated E2E** run for that commit, exits non-zero
on failure or timeout, and prints the run URL. On success it also prints a
copyable release-record block with the merge revision and run URL filled in. It
uses the GitHub CLI, so authenticate with `gh auth login` (or provide `GH_TOKEN`)
first. Record the URL in the release record below.

The CI quality gate runs `npm audit --audit-level=high` over both development and
production dependencies. `release:check` keeps its production-only audit because
it checks the shipped runtime; the CI gate also catches tooling advisories such as
the one that affected `minimatch`.

The browser smoke test (`npm run test:functional`) automates the workflow-input
server action, task reopen and the export/import isolation check. Set
`E2E_FULL_WORKFLOW=1` with `OLLAMA_API_KEY` available to the app to run the AI
draft, review and checkpoint path as well; that spends one AI request. The weekly
scheduled E2E run enables this mode automatically, and a manual dispatch can
request it with `full_workflow: true`. The full workflow item below remains a
manual check for the release record.

`npm run test:email` automates the confirmation path. It creates a disposable
mail.tm inbox, signs up through the production Supabase project, waits for the
Resend-delivered confirmation email, follows the link, signs in as the confirmed
user, and deletes the user and inbox. It needs `EMAIL_SMOKE_SUPABASE_URL`,
`EMAIL_SMOKE_SUPABASE_ANON_KEY` and `EMAIL_SMOKE_SERVICE_ROLE_KEY`; locally it
falls back to `NEXT_PUBLIC_SUPABASE_*`, `E2E_SERVICE_ROLE_KEY` or
`SUPABASE_SERVICE_ROLE_KEY`. The weekly **Email delivery smoke** workflow runs it
with repository secrets.

The real-time Resend webhook is `/api/webhooks/resend`. Resend signs every
delivery with Svix headers; the route verifies the signature against the raw body
before parsing, then maps `email.bounced`, `email.complained`, `email.failed`,
`email.suppressed` and `email.delivery_delayed` to the same GitHub issue format.
It needs the server-only `RESEND_WEBHOOK_SECRET`, `GITHUB_ALERT_TOKEN` and
`GITHUB_ALERT_REPO` variables. The token should be scoped to issues:write for
this repository. Invalid signatures, missing configuration and GitHub failures
are not acknowledged, so Resend can retry. The issue contains the Resend email
id, event and timestamp only; recipient addresses and message bodies are not
included.

The hourly **Resend delivery monitor** workflow remains a reconciliation
fallback. It runs `node scripts/resend-monitor.mjs`, reads recent messages from
the Resend API and opens the same issue if the webhook missed an event. It needs
the repository secret `RESEND_API_KEY` and the `issues: write` permission.
Re-running it reuses an existing issue, so a bad email does not create a new
issue every hour. Both paths claim a deterministic per-email label before creating
the issue, so a duplicate event is rejected immediately even while GitHub issue
search and listing are catching up. The label is attached to the issue; do not
delete these `resend-…` labels while their alerts are active.

Then check by hand, and record the result rather than assuming it:

- [ ] **Post-merge E2E:** `npm run check:e2e:post-merge` passes for the merged
      commit; record the merge revision and run URL in the release record below.
- [ ] Sign in, create a goal, a task and saved work; complete and reopen the task.
- [ ] Run a workflow through input, draft, review, approval and checkpoint.
- [ ] Export JSON from `/data`, then preview and import it into a second account.
- [ ] Delete that second account and confirm the first is untouched.
- [ ] Keyboard only: skip link, header, forms, dialogs, `/data` file input and
      confirmation field, with a visible focus ring throughout.
- [ ] Mobile widths 360 px and 414 px: no horizontal scroll, tap targets usable.
- [ ] Error recovery: a missing `OLLAMA_API_KEY` shows a setup message; stopping the
      database makes `/api/health` return 503 and pages show an error, not a crash.
- [ ] `/api/health` shows the revision you intended to release.

What this does **not** cover: there is no automated accessibility audit, no
browser end-to-end suite, no load test and no penetration test. Email delivery
has a scheduled smoke test; it is not a full deliverability or reputation audit.
The secret scan is a pattern check on tracked files; it is not a security audit,
and passing it does not mean the deployment is secure.


### Role lookups and compound guards

The audit also resolves the two shapes the first pass could not see: a role
lookup call (`public.workspace_role(...)`, `public.app_project_role(...)`, which
returns NULL for a caller who is not a member) and a compound condition
(`if kind = 'agent' and v_role not in (...)`). A NULL role in either makes the
whole condition NULL, so the guard never runs.

`0055_phase28_null_role_lookup_guards` fixes the eleven sites that remained. A
stranger could create a changeset or a share link in any project, submit or
cancel a changeset they did not author, and any signed-in user could claim,
finish, cancel or recover another workspace's mission jobs and decide its
approvals. Each guard now reads `(role is null or role not in (...))`, with the
parentheses added so compound precedence is unchanged.

The scan treats any comparison against a role value (`('owner', 'admin')`) as a
role guard, so a membership held in a variable that is not named `*role` is
still caught; `--dir` points the same check at a fixture tree, which is how the
rule is tested without editing the real migrations.

### Schema drift

`npm run check:schema-drift` compares every live function body with the latest
definition in `supabase/migrations`, ignoring whitespace. It needs a direct
Postgres connection in `SCHEMA_DRIFT_DATABASE_URL`; without one it warns in the
CI summary and exits 0, and with `SCHEMA_DRIFT_REQUIRED=1` it exits 1 instead.
Record the connection string as the repository secret `SUPABASE_DB_URL`, which
the workflow already maps to that variable; until it exists, the step reports
"nothing was compared" rather than a pass. The check found and repaired two
stored-body drifts left by the `pg_get_functiondef` migrations, so it is worth
arming.

The same check compares row-level security policies, constraints and indexes
against `supabase/schema.snapshot.json`. Regenerate that file with
`npm run schema:snapshot` whenever a migration adds, drops or alters one of those
objects; `npm run test:knowledge` fails if the committed snapshot no longer
matches a fresh replay. An object present on only one side always fails. A
definition that differs only in text is reported rather than failed unless
`SCHEMA_DRIFT_STRICT_DEFS=1` is set, because the snapshot is generated on the
embedded engine and a different PostgreSQL major version can format a deparsed
definition differently.

`npm run release:check` includes `schema-snapshot.mjs --check`, so a release
fails when the committed snapshot no longer matches the migrations instead of
shipping a stale baseline.

`npm run check:nullable-guards` fails when a guard compares a parameter, a local
or an inequality against a value set without a null check, such as
`p_decision not in ('approved', 'rejected')` or `p_status <> 'completed'`. A
null there skips a validation rather than granting access, but the null then
reaches the statement that follows, so `0056_nullable_validation_guards` makes
each one reject a missing value explicitly instead of relying on a column
constraint to catch it.

### Release record

Use the **Release record** GitHub issue template, or copy this table into the
release PR or operations log at execution time. Leave it unfilled until then; a
blank required field means **NO-GO**.

| Field | Value |
| --- | --- |
| Release date (UTC) | `________` |
| Pre-merge source revision (`npm run release:check`) | `________` |
| PR | `________` |
| Merge revision on `main` | `________` |
| Post-merge E2E run URL | `________` |
| Post-merge E2E result | `________` |
| Production deployment ID | `________` |
| Production `/api/health` revision | `________` |
| Manual smoke checks | `________` |
| Rollback / backup reference (if applicable) | `________` |
| Approved by / UTC | `________` |

The post-merge E2E row must reference the push run on `main` for the merge
revision, not the advisory pull-request run. `npm run check:e2e:post-merge` prints
that URL.

## Repository security

Secret scanning and push protection, Dependabot alerts and security updates, and
CodeQL default setup are enabled on the public repository. Dependabot checks
`npm` and GitHub Actions weekly. Report a vulnerability through the private
advisory flow in `SECURITY.md`, never a public issue.

## Known operational limitations

- Branch protection requires a pull request and the `checks` status for `main`.
  Administrators are subject to the rule, so direct pushes and admin merges
  cannot bypass it. `authenticated-e2e` remains advisory because it skips fork
  pull requests.
- No down migrations; rollback is restore-based.
- One database, no read replica and no point-in-time recovery beyond what the host
  provides.
- No background worker for imports or exports: both run inside one request and are
  bounded (2 MB / 200 goals / 1,000 tasks / 300 reflections, 8 MB export).
- No per-row purge in backups.
- Health checks cover the app and the database only, not Stripe, Ollama or email;
  use the scheduled email smoke test, Resend webhook and fallback monitor for
  delivery checks.
- The Resend webhook handles delivery failures in real time; the hourly monitor
  remains a reconciliation fallback. Neither measures inbox placement or sender
  reputation.
- Exception monitoring covers unhandled server request errors only. Browser
  render errors, handled errors and provider-side failures are not collected;
  the GitHub issue monitor polls every 15 minutes and is not real-time.
- Restore drills run on the same schema but not the same data volume as production.
- Agent-team execution is request-scoped fixture work, not a background worker. A
  click advances at most the configured number of tasks; pausing stops future
  work but does not interrupt a request already in progress. The security review
  is a pattern review, not a complete audit, and no paid multi-agent run exists.
