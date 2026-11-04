# Deployment

GET TO IT deploys from the `main` branch of `eugenemcmillian3-tech/get-to-it` to the Vercel project `get-to-it-wvpy`.

- Vercel Git auto-deploy is enabled for `main`; pushes to `main` deploy production automatically. Do not run manual production deploys.

- Production URL: https://get-to-it-wvpy.vercel.app
- Vercel project ID: `prj_7ZFE4kOPQgsrubitOv1cDcIMPCOx`
- Vercel production branch: `main`
- Supabase project: `qhlzjhdcnlokbsdsrqqy` (created through the Vercel Supabase integration)
- Supabase migrations: all 27 files through `0027_phase26_supabase_oauth.sql` applied; 94 public tables.
- Auth callback: `https://get-to-it-wvpy.vercel.app/auth/callback`
- Vercel environment names: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DEPLOYMENT_VAULT_KEY`, `CRON_SECRET`, `CREDIT_RPC_TOKEN`, `SUPABASE_OAUTH_REDIRECT_URI`

External credentials that are not configured in this project yet: `OLLAMA_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_OAUTH_CLIENT_ID`, `SUPABASE_OAUTH_CLIENT_SECRET` and the `PREVIEW_RUNNER_*` pair. The app stays in setup mode for those features rather than pretending they work.

The previous Vercel and Supabase projects are no longer the deployment target. Never put a Supabase service-role key in the browser or repository. Keep commits authored with the GitHub account's noreply address so Vercel's Git-author check accepts them.
