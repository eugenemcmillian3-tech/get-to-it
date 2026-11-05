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
| `OLLAMA_API_KEY` | no | **server only** | `src/lib/ai/ollama.ts` at call time | AI panels explain the missing key; templates, exports and imports still work |
| `STRIPE_SECRET_KEY` | no | **server only** | `src/lib/credits/stripe.ts` | Checkout shows a setup message; nothing charges |
| `STRIPE_WEBHOOK_SECRET` | no | **server only** | `src/app/api/stripe/webhook/route.ts` | The webhook returns 503 |
| `CREDIT_RPC_TOKEN` | no | **server only** | webhook route | The webhook returns 503 |
| `STRIPE_ALLOW_LIVE` | no | **server only** | `src/lib/credits/stripe.ts` | A `sk_live_` key is refused |
| `CRON_SECRET` | no | **server only** | `/api/reminders/run` | The scheduler endpoint returns 503; in-app delivery still works |
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
| Operation rate card | `RATE_CARD_DRAFT.md` + `0035_operation_budgets.sql` | Approved for implementation, not live. Fixed per-operation credits, build/workflow/swarm budgets. `ai_prices` remains empty; migration, live billing and deployment still need separate approval |
| `credit_webhook` secret | `public.app_secrets` | Must equal `CREDIT_RPC_TOKEN`; the webhook has no signed-in user |
| Owners | `public.app_owners` | Only these accounts may open `/owner` |

Never put a `service_role` key, a Stripe secret, an Ollama key, a GitHub,
Vercel or Supabase credential, or a webhook token in `NEXT_PUBLIC_*`, client
code, a repository file or chat. The app needs no `service_role` key at all.

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
  "checks": { "database": "ok", "configuration": "configured" },
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
webhook or that any feature works.

## Logs

`src/lib/log.ts` writes one JSON line per event: timestamp, event name, outcome,
short code and small counts. It accepts only keys matching `^[a-z][a-z0-9_]*$` and
values that are numbers, booleans or short `[a-zA-Z0-9_.:-]` strings. Free text is
dropped, not truncated, so a goal title, saved work, reflection, email, prompt or
token cannot reach host logs through this path.

Events currently logged: `health_check`, `export_json`, `export_csv`,
`import_preview`, `import_commit`.

Existing `console.error` calls keep the provider's short message and an error code;
they never print a key or a row. Log retention is whatever the host provides; this
project keeps no separate log store.

## Migrations

- Files live in `supabase/migrations/` and are applied in filename order, once each:
  `0001` … `0024_phase25_improvement.sql`.
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

Recommended cadence: daily automated backups if the plan provides them, plus a
manual export before any migration. A person's own data can be exported from
`/data` at any time; that is not a substitute for a database backup.

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

Then check by hand, and record the result rather than assuming it:

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

What this does **not** cover: there is no automated accessibility audit, no browser
end-to-end suite, no load test, no penetration test, and no email deliverability
test. The secret scan is a pattern check on tracked files; it is not a security
audit, and passing it does not mean the deployment is secure.

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
- Health checks cover the app and the database only, not Stripe, Ollama or email.
- Restore drills run on the same schema but not the same data volume as production.
- Agent-team execution is request-scoped fixture work, not a background worker. A
  click advances at most the configured number of tasks; pausing stops future
  work but does not interrupt a request already in progress. The security review
  is a pattern review, not a complete audit, and no paid multi-agent run exists.
