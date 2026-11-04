# Composio connections

GET TO IT lets a signed-in owner connect an external account to one app project
and let an agent role request a specific tool. A connection is not an execution
permission: every call is proposed with exact arguments and approved by the
owner for those exact arguments.

## What is supported

| Integration | Toolkit slug | Connection | Operations |
| --- | --- | --- | --- |
| GitHub | `github` | Composio-managed OAuth | Tools discovered from the connected account; grants are capped at five per connection |
| Notion | `notion` | Composio-managed OAuth | Tools discovered from the connected account; grants are capped at five per connection |

Tool names and input schemas are **not hard-coded**. After an account is
connected, "Discover tools" calls Composio and stores the returned catalogue for
that connection. Only those exact slugs can be granted. This avoids inventing
tool names and automatically follows the toolkit version Composio serves.

A toolkit is shown as available only because its connection flow, discovery and
approval path are implemented. There is no unrestricted "run any tool" action.

## SDK and runtime

- SDK: `@composio/core@0.28.0` (the v3 generation). Do **not** install the
  deprecated `composio-core` v1 package.
- ESM-only. Node `22.22.3` or newer is required; this project runs on Node 26.
- Composio is called only from server actions and Node route handlers. The API
  key is never bundled into the browser or generated projects.
- Session IDs are stored server-side per project and toolkit and rehydrated with
  `composio.use(sessionId)`. Session MCP URLs are never displayed or logged.

## Setup

1. Create a project in the Composio dashboard and copy its API key.
2. Add these server-only variables (for local development, `.env.local`):

   ```sh
   COMPOSIO_API_KEY=...
   APP_ORIGIN=https://your-app.example.com
   ```

   `APP_ORIGIN` must be the exact public origin users open. The callback URL is
   `{APP_ORIGIN}/api/composio/callback`. Localhost over HTTP is accepted only for
   `localhost` and `127.0.0.1`.
3. In the Composio project, allow the callback URL above for the GitHub and
   Notion toolkits (managed OAuth is the default).
4. Apply the migration:

   ```sh
   supabase/migrations/0033_composio_connections.sql
   ```

5. Open a project → **Connections** → **Connect GitHub** or **Connect Notion**.
6. After the callback, click **Discover tools**, then grant one or more tools to
   an agent role.
7. Create or open an agent-team task for that role, then prepare a tool action
   with the exact JSON arguments. Approve it, then run it.

## Authorization flow

- The app starts an attempt server-side with a random 64-hex state. Only the
  state hash is stored, and it expires after 15 minutes.
- The return destination is stored server-side and must be that project's
  connections page. A query parameter cannot redirect elsewhere.
- The callback requires the signed-in owner, the matching one-time state and a
  provider connected-account ID. The adapter then asks Composio for the account
  and verifies its `userId` matches the app user and its toolkit matches the
  attempt. Provider query parameters alone are never accepted as proof.
- Cancelled and expired attempts are recorded and never create a connection.
- A connected-account ID is globally unique, so it cannot be claimed by a second
  account.

## Grants and approval

- A grant is `(connection, tool slug, agent role)`. Only enabled grants for the
  current project, role and tool can be proposed.
- A proposal must reference a real agent task for that same role. The task
  provides the project/task boundary; the browser cannot supply a user id.
- Arguments are a JSON object, at most 16 KB. The SHA-256 of the stored argument
  object is recorded. Approval sets an approval hash; it does not allow editing
  the arguments.
- There is no RPC to change a proposal's arguments. A changed argument set is a
  new proposal and needs a new approval.
- The approval preview names the connection, account, role, task and complete
  argument JSON.
- Running an action requires an `approved` row. A conditional claim moves it to
  `executing` once; a second request is refused.
- A timeout, abort or network failure is stored as `uncertain`, never retried.
  An in-flight row can be marked uncertain after a minute; check the provider
  before preparing another action.
- Success and failure results are bounded and redacted for token-, secret-,
  password-, cookie- and key-shaped fields before storage.

## Limits and accounting

- 5 enabled tool grants per connection.
- 50 discovered tools cached per connection.
- 20 pending proposals per project and 50 proposals per user per day.
- One in-flight external call per user.
- 100 external calls and 25 external writes per project per day. Every
  execution is conservatively counted as a write because tool metadata does not
  reliably distinguish reads from writes.
- External-tool usage is stored in `app_composio_usage` and is **separate** from
  AI request credits. Composio and the connected providers may charge for usage;
  this app does not assume they are free.

## Disconnecting

- **Revoke access** calls Composio's `connectedAccounts.revoke` first. Only after
  Composio confirms does the local connection become `revoked`; grants are
  disabled and pending proposals are cancelled.
- **Remove locally** marks the connection `removed` and disables grants without
  contacting the provider. The external authorization remains in place; remove
  it in the provider's own settings if desired. The UI states this distinction.
- If revocation fails, the local connection is left in place and the error says
  so. It never pretends the provider token was revoked.

## Project credentials vs generated apps

Connections here are for **GET TO IT while helping build a project**. They are
never copied into generated source, previews, downloads or prompts. If a
generated app needs its own runtime integration, that requires a separate
configuration plan and an explicit decision about who owns those credentials.
The current build does not generate or embed the owner's Composio key.

## Security boundaries

- Owner-only RLS on all seven tables; table writes are revoked and happen only
  through `security definer` functions that re-check `auth.uid()` and project
  ownership.
- No provider token, API key or session MCP URL is stored in these tables.
- Provider results and error text are redacted and size-bounded.
- External content returned by a tool is untrusted. It cannot approve another
  action, create a grant or change project settings.
- Every execution has a durable record: user/project, connection, tool, role,
  task, argument hash, approval, status, provider result reference, error
  category and timestamps.

## Testing

Routine tests use stubs and pure contracts. The isolated restore drill covers:

- cross-user connection and action denial;
- a forged connected-account ID;
- cancelled and expired authorization;
- an inactive connection;
- a role/tool that is not granted;
- approval bypass and direct argument edits;
- changed arguments under the same idempotency key;
- duplicate proposals, claims and completions;
- a provider-timeout `uncertain` outcome with no retry;
- quota enforcement;
- disconnect behaviour and pending cancellation;
- RLS isolation.

No live provider message, repository write or deployment is performed by the
test suite.

## Known limitations

- The agent-team workers are deterministic fixtures and do not contain a model
  tool-calling loop. The "Request a tool action" form is the bounded proposal
  path the agent layer calls; it does not give a model an execution meta-tool.
- Tool input schemas are not rendered as a generated form; the owner supplies the
  JSON object. The discovered tool description is shown, and changes require a
  new proposal.
- Composio's live catalogue, connection status and execution were not exercised
  against a real API key in this workspace. Tests use stubs and the database
  drill. Run one connection against a Composio development project before
  relying on a toolkit in production.
- Provider-side revocation can fail or be delayed; the UI reports that instead
  of assuming success.
