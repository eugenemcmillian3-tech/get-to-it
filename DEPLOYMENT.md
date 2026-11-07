# Deployment

GET TO IT deploys from the `main` branch of `eugenemcmillian3-tech/get-to-it` to the Vercel project `get-to-it-wvpy`.

- Vercel Git auto-deploy is enabled for `main`; pushes to `main` deploy production automatically. Do not run manual production deploys.
- Production URL: https://get-to-it-wvpy.vercel.app
- Production revision at last verification: `ac7dedd6dde4` on 2026-11-07; `/api/health` is the source of truth for the currently deployed revision.
- Vercel project ID: `prj_7ZFE4kOPQgsrubitOv1cDcIMPCOx`
- Vercel production branch: `main`
- Supabase project: `qhlzjhdcnlokbsdsrqqy` (created through the Vercel Supabase integration)
- Supabase migration history: tracked history ends at `0033_composio_connections.sql` (13 recorded rows). The 0034/0035 schema effects are present in production (five active packs, `per_user_daily = 0`, four-argument `reserve_ai_request`), but those versions are **not recorded** in `supabase_migrations.schema_migrations`. Reconcile the history before the next migration.
- Pending production migrations: none identified beyond the history gap above. See [Pricing rollout](#pricing-rollout-0034-and-0035) below.
- Auth callback: `https://get-to-it-wvpy.vercel.app/auth/callback`
- Vercel environment names: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DEPLOYMENT_VAULT_KEY`, `CRON_SECRET`, `CREDIT_RPC_TOKEN`, `SUPABASE_OAUTH_REDIRECT_URI`

Optional credentials configured in production as of 2026-11-04: `SUPABASE_OAUTH_CLIENT_ID`, `SUPABASE_OAUTH_CLIENT_SECRET` and `COMPOSIO_API_KEY`.

Optional credentials not configured in production: `OLLAMA_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PREVIEW_RUNNER_URL`, `PREVIEW_RUNNER_TOKEN` and `PREVIEW_SIGNING_SECRET`. The app stays in setup mode for those features rather than pretending they work. The Vercel Supabase integration also supplies server-only `POSTGRES_*` connection values and `SUPABASE_SERVICE_ROLE_KEY`; none of those are browser-exposed.

The previous Vercel and Supabase projects are no longer the deployment target. Never put a Supabase service-role key in the browser or repository. Keep commits authored with the GitHub account's noreply address so Vercel's Git-author check accepts them.

## Pricing rollout (0034 and 0035)

**Status:** approved for implementation, not authorized to execute. Nothing in this
section applies a migration, enables live billing or deploys. Every step below
needs a separate owner decision, and production must have a current backup first.

The two migrations are order-dependent:

1. `0034_credit_pricing.sql` — five active packs at exactly $0.10 per credit and
   `per_user_daily = 0`.
2. `0035_operation_budgets.sql` — per-operation reservation prices, budget columns,
   atomic budget locking, and credit/budget release on failure or timeout.

`0035` replaces `reserve_ai_request(text, text)` with
`reserve_ai_request(text, text, text, uuid)` and keeps `finish_ai_request` at its
existing signature. The new function has defaults for the budget arguments.

### Preconditions

- [ ] Owner approves the production rollout separately from the code approval.
- [ ] PR #15 is reviewed, its checks pass, and the exact commit to deploy is recorded.
- [ ] A database backup or Supabase snapshot exists and its timestamp is recorded.
- [ ] The production audit still shows **0 credit purchases, 0 paid payments, 0
      credit-ledger rows and 0 outstanding credit balance**. If not, stop: this
      rollout assumes there is no historical balance to reprice.
- [ ] Current `public.ai_limits` values and `public.credit_packs` rows are recorded.
- [ ] `0034` and `0035` have been applied successfully to a disposable staging
      project first.
- [ ] The staging authenticated E2E passes against the migrated schema.
- [ ] The owner confirms that live Stripe remains **off** for this rollout.

### Staging rehearsal

Use a disposable Supabase project, never the production project. Apply every
migration from `0001` through `0035` in filename order, then configure the staging
URL and anon key.

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run test:restore
```

The restore drill starts its own embedded Postgres and cannot connect to the
hosted project. It should report 26 passing tests, including the 2-credit repair
and workflow-budget release cases.

Start the app with the staging environment and run the no-AI browser smoke:

```bash
NEXT_PUBLIC_SUPABASE_URL=... \
NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
E2E_SERVICE_ROLE_KEY=... \
E2E_BASE_URL=http://127.0.0.1:3100 \
npm run test:functional
```

The default smoke does not spend an AI request. On staging, also check by hand:

- [ ] A new account has zero credits and its first AI action is blocked without
      creating an `ai_requests` row.
- [ ] The credits page lists all ten operations with both credits and dollars.
- [ ] A workflow started with the default budget shows `10` credits available.
- [ ] A workflow started with a non-default budget persists that value.
- [ ] A failed model call releases the credit and restores the workflow budget.
- [ ] A build workspace has a 6-credit budget and refuses a fourth repair attempt.
- [ ] A swarm run shows `0 / 0` credits and makes no paid model call.

Do not use the production project for any staging write, test account or AI call.

### Production sequence

1. **Record the starting point.** Save `/api/health`, the deployed revision, the
   backup timestamp, current `ai_limits`, and the zero-balance audit result.
2. **Stop new paid AI work during the schema window.** Record the current
   `global_daily` value, then set `global_daily = 0` for the window and restore it
   only after the new app deployment is healthy. With zero credit balances, no
   paid AI should run anyway; this is a guard, not a revenue control.
3. **Apply `0034_credit_pricing.sql` first**, then **`0035_operation_budgets.sql`**,
   in the Supabase SQL editor. Apply each file once and inspect the result before
   continuing. Do not run a hand-edited version.
4. **Verify the schema before deploying the app.** Run the queries below. A failed
   check stops the rollout; do not deploy and hope the app handles a missing
   column.
5. **Merge PR #15.** Vercel auto-deploys `main`; do not run a manual production
   deploy. Record the deployed commit and set `GIT_REVISION` to that commit if the
   host does not supply it.
6. **Restore the recorded `global_daily` value** only after the app is healthy.
7. **Keep live billing off.** Do not set `STRIPE_ALLOW_LIVE`, do not install a
   `sk_live_` key, and do not point a live webhook at production as part of this
   rollout. Checkout may remain unavailable or use an explicitly configured test
   key.
8. **Verify with read-only checks and ordinary product paths**, not by granting
   credits or editing the ledger. Use a controlled test account only if the owner
   approves it.

### Verification queries

```sql
-- Five active packs, each at exactly ten cents per credit.
select count(*) as active_packs,
       bool_and(amount_cents = credits * 10) as all_ten_cents
  from public.credit_packs
 where active;

-- No free daily allowance.
select per_user_daily, global_daily, in_flight_seconds
  from public.ai_limits
 where id = 1;

-- The new reservation signature and unchanged finish signature exist.
select to_regprocedure('public.reserve_ai_request(text,text,text,uuid)') as reserve_fn,
       to_regprocedure('public.finish_ai_request(uuid,text,text,integer,integer)') as finish_fn;

-- Budget columns and defaults.
select table_name, column_name, column_default, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'workflow_runs' and column_name in ('credit_budget', 'credits_spent'))
     or (table_name = 'app_workspaces' and column_name in ('credit_budget', 'credits_spent'))
     or (table_name = 'app_team_runs' and column_name in ('credit_budget', 'credits_spent'))
     or (table_name = 'ai_requests' and column_name in ('budget_kind', 'budget_id')))
 order by table_name, column_name;

-- The limits allow three build attempts and a ten-credit workflow.
select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conname in (
   'workflow_runs_credit_budget_range',
   'app_workspaces_credit_budget_range',
   'app_workspaces_iterations_check',
   'app_workspaces_ai_requests_check',
   'app_team_runs_credit_budget_range',
   'ai_requests_budget_kind_check',
   'ai_requests_budget_pair_check'
 )
 order by conname;

-- Expected: the health probe answers; ai_prices is still empty; no balances moved.
select public.health_probe();
select count(*) as provider_price_rows from public.ai_prices;
select count(*) as ledger_rows from public.credit_ledger;
```

Expected pack defaults are 50, 100, 250, 500 and 1,000 credits; workflow default
budget is 10, build default is 6, and swarm default is 0.

### Product smoke checks

- [ ] `/api/health` returns `200` with `status: "ok"` and the intended revision.
- [ ] Sign-in works and a new account shows zero credits.
- [ ] An AI action with zero credits is refused and creates no `ai_requests` row.
- [ ] The credits page shows the operation prices and dollar equivalents.
- [ ] A workflow starts, saves input and reaches its review/checkpoint steps.
- [ ] A workflow with a non-default budget stores the selected limit.
- [ ] A workflow at its budget receives a clear refusal, not a model call.
- [ ] A failing build repair releases both the 2 credits and the budget slot.
- [ ] A swarm run shows its zero-credit budget and makes no paid call.
- [ ] Results, settings and billing history remain available at zero credits.
- [ ] No new Stripe live payment or subscription was created.

### Rollback and recovery

**Application rollback does not reverse a database migration.** Redeploying a
previous Vercel build leaves `0034`/`0035` in place. The prior app can only be
used if it is verified against the new function signature; in particular, confirm
on staging that its two-argument `reserve_ai_request` call resolves to the new
function with default budget arguments. If it does not, source rollback is not a
safe database rollback.

- **App-only defect after a successful migration:** roll Vercel back to the prior
  deployment, keep the schema, and stop AI work until the mismatch is understood.
- **Migration failure or bad budget data:** stop new AI work, restore the recorded
  backup into a new Supabase project, point the app's URL/anon key and server
  secrets at it, and verify `/api/health` plus a read-only export. Do not attempt
  a handwritten inverse migration on production.
- **New reservation function missing or broken:** this can block all AI work. Stop
  traffic, restore the database snapshot, and redeploy the matching app revision.
  Do not leave a half-applied `0035` in place.
- **Live billing was never enabled:** leave it off. No live-key rollback is needed.
- **If live billing is later enabled and must be stopped:** unset
  `STRIPE_ALLOW_LIVE`, remove the live key, rotate the webhook signing secret, and
  confirm checkout is unavailable. Reconcile any real payments and refunds in the
  Stripe dashboard; never edit `credit_ledger` by hand.

## Production go/no-go record

Copy this section into the release record or PR comment at execution time. Leave
it unfilled until then. A blank required field means **NO-GO**, not an implied
approval. This record does not authorize execution and never authorizes live
billing.

### Release

- PR: #15
- Migration order: `0034_credit_pricing.sql`, then
  `0035_operation_budgets.sql`
- Staging evidence: [PR #15 staging rehearsal](https://github.com/eugenemcmillian3-tech/get-to-it/pull/15#issuecomment-6649338569)
- Commit to deploy: `________________`
- Vercel deployment ID after merge: `________________`
- Production revision before: `ab5a3968da18` (checked 2026-11-05T04:16:50Z)
- Production migration head before: `0033_composio_connections.sql` (confirmed;
  four-argument reservation absent)

### Approvals and baseline

| Required item | Evidence to record | Value |
| --- | --- | --- |
| Owner approval to execute | Name, date/time UTC, explicit scope | `Not granted — preflight only (2026-11-05)` |
| Live billing decision | Must be **NO** for this rollout | `NO — live Stripe remains off` |
| Backup or snapshot | Reference and timestamp | `Free plan; no platform backups/PITR; CLI token lacks database_write — owner-run dump required (blocker)` |
| Zero-balance audit | Purchases, paid payments, ledger rows | `0 payments; 0 paid; 0 refunded; 0 ledger rows` |
| Ledger balance | Sum of all deltas, expected `0` | `0` |
| AI limits before | `per_user_daily`, `global_daily`, `in_flight_seconds` | `15 / 200 / 120 seconds (pre-0034)` |
| Current pack catalogue | Pre-0034 values | `3 active: starter 20/$5; steady 60/$12; deep 150/$25` |
| Reservation schema | Pre-0035 state | `2-arg present; 4-arg absent` |
| PR checks | Run URL and result for the final commit | `de5d20f — all checks passed` |
| Staging rehearsal | 35 migrations, `26/26` restore, `13/13` functional | `Passed — PR #15 comment` |
| Production health | `/api/health` status and revision | `200 ok; ab5a3968da18; 2026-11-05T04:16:50Z` |
| Stripe configuration | No live key and `STRIPE_ALLOW_LIVE` unset | `Not verified — Vercel project inaccessible; keep live off` |

### Backup remediation

**Current status (2026-11-07):** the scheduled **Production backup and restore
test** workflow completed successfully on 2026-11-06. R2 contains an encrypted
dump, `SHA256SUMS` and metadata under
`production/2026/11/06/run-42172505397/` (dump size 180,551 bytes), and the
workflow's restore-into-disposable-Postgres step succeeded; its metadata reports
`restore_verified=yes` for source revision `ff741d9`. Verify retention and an
owner-approved restore before relying on this as the disaster recovery path. The 2026-11-05 preflight below is retained as history.

Historical preflight (2026-11-05): the organization was on the **Free** plan.
The production database was 19 MB and had no Storage buckets or objects. Free
projects have no automatic backups or PITR, so the missing backup was a hard
rollout blocker at that time.
Use one of these paths, then record the reference and a successful restore test.

**Option A — logical dump (no plan change, recommended).** Run from the owner's
secure shell with a direct or session-pooler connection string. Do not paste the
connection string into chat or commit it.

```bash
export SUPABASE_DB_URL='postgresql://...'
supabase db dump --remote="$SUPABASE_DB_URL" -f roles.sql --role-only
supabase db dump --remote="$SUPABASE_DB_URL" -f schema.sql
supabase db dump --remote="$SUPABASE_DB_URL" -f data.sql --use-copy --data-only \
  -x "storage.buckets_vectors" -x "storage.vector_indexes"
sha256sum roles.sql schema.sql data.sql > SHA256SUMS
```

Encrypt and store the files off-site. Storage objects are not included; the
current bucket count is zero, but verify again before dumping. Restore into a
disposable Postgres 17 or Supabase project, not over production or staging:

```bash
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file roles.sql --file schema.sql \
  --command 'SET session_replication_role = replica' \
  --file data.sql --dbname "$RESTORE_DB_URL"
```

Verify the migration head, table counts, `health_probe()`, RLS policies, and a
signed-in read before treating the dump as restorable. Free plans are limited to
two active projects, so free a slot or use a local Postgres 17 instance.

**Option B — upgrade the organization to Pro.** Pro includes 7 days of daily
physical backups, restorable from the dashboard, but the docs do not document a
user-triggered on-demand backup and physical daily backups are not downloadable.
Wait for a completed daily backup, then restore-test it. Pro is $25/month plus
compute; PITR is a separate add-on (about $100/month for 7-day retention,
requires Small compute) and replaces daily backups. This is unnecessary for one
migration if Option A is tested.

The agent workspace's scoped Management API token is read-only. A dry run of
`supabase db dump --remote=qhlzjhdcnlokbsdsrqqy` stopped at login-role
initialization with `403 missing database_write`. Do not rotate the database
password or create a temporary role to bypass this; run the dump from the
owner's shell with a direct or session-pooler URL, or use a scoped token
explicitly granted `database_write`.

Branching and read replicas are not backups: branches are data-less by default,
and replicas have no versioned restore history. Do not use either as the gate.

Official references: [backups](https://supabase.com/docs/guides/platform/backups),
[pricing](https://supabase.com/pricing), and
[CLI backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

### Execution log

| Step | UTC | Operator | Result | Evidence |
| --- | --- | --- | --- | --- |
| Record `global_daily`; set it to `0` for the schema window | `________` | `________` | `________` | `________` |
| Apply `0034_credit_pricing.sql` once | `________` | `________` | `________` | `________` |
| Apply `0035_operation_budgets.sql` once | `________` | `________` | `________` | `________` |
| Run schema verification; stop on any mismatch | `________` | `________` | `________` | `________` |
| Merge PR #15; record the automatic Vercel deployment | `________` | `________` | `________` | `________` |
| Verify `/api/health` and the product smoke checks | `________` | `________` | `________` | `________` |
| Restore the recorded `global_daily` value | `________` | `________` | `________` | `________` |
| Confirm Stripe live remains off | `________` | `________` | `________` | `________` |

### Verification results

- [ ] Five active packs: 50/$5, 100/$10, 250/$25, 500/$50, 1,000/$100.
- [ ] `credit_packs_retail_value` holds for every active pack.
- [ ] `per_user_daily = 0`; no signup or trial grant exists.
- [ ] `reserve_ai_request(text, text, text, uuid)` and the existing
      `finish_ai_request` signature exist.
- [ ] Workflow budget defaults to 10; build to 6; swarm is fixed at 0.
- [ ] Build limits allow three attempts and six credits, with release on failure.
- [ ] `health_probe()` succeeds; `credit_ledger` and `ai_prices` remain empty.
- [ ] The legacy two-argument reservation call resolves against the new function.
- [ ] Zero-credit authenticated work is refused without creating `ai_requests`.
- [ ] Sign-in, a workflow run, a completed task, export and import still work.
- [ ] No live Stripe payment, subscription or key was created.

Attach or link the SQL output and smoke-test output here:
`________________________________________________________________`

### Rollback record

- Trigger and time (UTC): `________________________________`
- Decision owner: `________________________________`
- Application rollback target (prior Vercel deployment): `________________`
- Was the prior app verified against the new function signature? `____`
- Database restore backup/target project: `________________`
- Was live Stripe ever enabled? `____`
- Customer impact and follow-up owner: `________________`

If the database must be restored, stop AI work first, restore the recorded backup
into a new project, re-point the app and run read-only checks. Do not attempt a
handwritten inverse of `0034` or `0035`, and never edit `credit_ledger` by hand.

### Final sign-off

- Decision: **NO-GO**
- Approved by: `Not approved — preflight only`
- Date/time UTC: `2026-11-05T04:16:50Z`
- Conditions or open risks: `No backup or snapshot is available (Free plan, PITR disabled; scoped CLI token lacks database_write); complete and restore-test the Backup remediation path with an owner-run direct connection; owner approval not granted; Stripe live configuration not verifiable through the Vercel integration.`
- Next review: `After a fresh backup/snapshot, owner approval and Stripe-off confirmation.`

## Live Stripe gate

This rollout must **not** turn on real money. The current production configuration
has no Stripe secret, so checkout shows a setup message.

Before any future live billing decision:

- [ ] Operation prices and budgets have been live and observed in test mode.
- [ ] `STRIPE_SECRET_KEY` is an `sk_test_` key and `STRIPE_WEBHOOK_SECRET` is the
      matching test endpoint secret.
- [ ] `CREDIT_RPC_TOKEN` is set and the same value is stored in
      `public.app_secrets` under `credit_webhook`.
- [ ] The Stripe endpoint points at `/api/stripe/webhook` and subscribes to
      `checkout.session.completed`, `checkout.session.expired` and
      `charge.refunded`.
- [ ] A test purchase grants exactly the pack credits once, a duplicate event is
      ignored, and a refund only succeeds when the balance covers it.
- [ ] Production still has no outstanding customer balance that would be
      repriced by a pack change.
- [ ] The owner explicitly approves taking real money.

Only then may a live key be installed. `STRIPE_ALLOW_LIVE` must be exactly `true`;
any other value deliberately refuses a `sk_live_` key. Rotate the webhook secret and
`CREDIT_RPC_TOKEN` together, with a short checkout outage, rather than leaving one
side stale. Never place a key or token in a repository file, a `NEXT_PUBLIC_*`
variable or chat.
