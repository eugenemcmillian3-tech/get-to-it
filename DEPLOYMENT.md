# Deployment

GET TO IT deploys from the `main` branch of `eugenemcmillian3-tech/get-to-it` to the Vercel project `get-to-it-wvpy`.

- Vercel Git auto-deploy is enabled for `main`; pushes to `main` deploy production automatically. Do not run manual production deploys.

- Production URL: https://get-to-it-wvpy.vercel.app
- Production revision at last verification: `c04c0f5` on 2026-11-04; `/api/health` is the source of truth for the currently deployed revision.
- Vercel project ID: `prj_7ZFE4kOPQgsrubitOv1cDcIMPCOx`
- Vercel production branch: `main`
- Supabase project: `qhlzjhdcnlokbsdsrqqy` (created through the Vercel Supabase integration)
- Supabase migrations: all 33 files through `0033_composio_connections.sql` applied; 129 public tables. The tracked migration history contains `0028`–`0033`; earlier files were applied outside migration tracking.
- Auth callback: `https://get-to-it-wvpy.vercel.app/auth/callback`
- Vercel environment names: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DEPLOYMENT_VAULT_KEY`, `CRON_SECRET`, `CREDIT_RPC_TOKEN`, `SUPABASE_OAUTH_REDIRECT_URI`

Optional credentials configured in production as of 2026-11-04: `SUPABASE_OAUTH_CLIENT_ID`, `SUPABASE_OAUTH_CLIENT_SECRET` and `COMPOSIO_API_KEY`.

Optional credentials not configured in production: `OLLAMA_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PREVIEW_RUNNER_URL`, `PREVIEW_RUNNER_TOKEN` and `PREVIEW_SIGNING_SECRET`. The app stays in setup mode for those features rather than pretending they work. The Vercel Supabase integration also supplies server-only `POSTGRES_*` connection values and `SUPABASE_SERVICE_ROLE_KEY`; none of those are browser-exposed.

The previous Vercel and Supabase projects are no longer the deployment target. Never put a Supabase service-role key in the browser or repository. Keep commits authored with the GitHub account's noreply address so Vercel's Git-author check accepts them.
