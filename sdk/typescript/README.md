# @gettoit/sdk

TypeScript SDK for the GET TO IT developer API, version **2026-11-01**.

It has no runtime dependencies and works in Node 18+ and browsers that have
`fetch` and `crypto.subtle`. Import it from this repository directly:

```ts
import { GettiClient } from "./sdk/typescript/src/index";
```

## Authentication

Create a project-scoped key on the project's **Developer API** page. Grant only
the scopes the client needs. The token (`gti_…`) is displayed once.

```ts
const client = new GettiClient({
  apiKey: process.env.GETTOIT_API_KEY!,
  baseUrl: "https://your-deployment.example.com",
});
```

The key stays in server-side configuration. A key is limited to its project
(plus projects that same key creates with `projects:write`), has an expiry, a
per-minute limit, and every call is attributed to it. It never grants more than
the project owner already has: it cannot approve a deployment, spend credits or
bypass an owner action.

## Create a project, submit a specification, build

```ts
const created = await client.createProject({
  name: "Workshop repairs",
  purpose: "Track repairs for a small workshop.",
  target_users: "Two workshop volunteers",
  workflows: "Log a repair",
  required_pages: "/repairs | Repairs | See repairs",
  entities: "repair: title, notes",
  auth_requirements: "supabase",
  definition_of_done: "A repair can be logged and found again",
});

const projectId = created.project.id;

await client.submitSpecification(projectId, {
  features: "Log a repair\nFind a repair",
  pages: "/repairs | Repairs | See repairs",
  entities: "repair: title, notes",
  auth_requirements: "supabase",
});

// A build job needs an owner-approved specification. The web app owns approval.
const started = await client.startBuild(projectId);
const finished = await client.waitForJob(started.job.id);

if (finished.status !== "succeeded") {
  throw new Error(finished.error?.message ?? "The build did not succeed.");
}

const artifacts = await client.getArtifacts(started.job.id);
console.log(artifacts.version, artifacts.files.map((file) => file.path));
```

`startBuild` accepts an explicit `idempotencyKey`; a retry with the same key and
body returns the same job instead of starting a second build. The SDK generates
one if you omit it. Keep the key with the request when retrying:

```ts
const key = "build-request-2026-11-04-001";
await client.startBuild(projectId, { idempotencyKey: key });
await client.startBuild(projectId, { idempotencyKey: key }); // same job
```

## Deployment proposals

```ts
const { proposal } = await client.requestDeploymentProposal(projectId, "preview");
console.log(proposal.status);            // "draft"
console.log(proposal.approval_required); // true
console.log(proposal.approved);          // false
```

A proposal is **not** deployment permission. It records the exact target, source
version and plan fingerprint for a person to review. Only the project owner can
run pre-deploy checks and approve it in the web app. The API cannot approve,
execute or spend money.

## Error handling

```ts
import { GettiApiError, GettiClient } from "./sdk/typescript/src/index";

try {
  await client.getJob("not-a-job");
} catch (error) {
  if (error instanceof GettiApiError) {
    console.error(error.status, error.code, error.requestId);
    switch (error.code) {
      case "rate_limited":
        // Respect error.details.retry_after_seconds.
        break;
      case "credential_revoked":
      case "credential_expired":
        // Stop retrying; a person must issue a new key.
        break;
      case "insufficient_scope":
        // The key needs a scope the owner did not grant.
        break;
    }
  }
}
```

Statuses: 400 invalid request, 401 credential, 403 scope, 404 not found,
409 conflict or state, 429 rate limit, 500 internal. `request_id` is the usage
record id for support and attribution.

## Webhook verification

Deliveries are signed with HMAC-SHA256 over `` `${t}.${rawBody}` ``:

- `X-GETTOIT-Signature: t=<unix>,v1=<hex>`
- `X-GETTOIT-Event: build.completed | build.failed`
- `X-GETTOIT-Delivery: <stable delivery id>`

Use the raw body bytes. Reject a timestamp outside your tolerance, then discard
a delivery id you have already processed (delivery is at-least-once).

```ts
import { verifyWebhookSignature } from "./sdk/typescript/src/index";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const valid = await verifyWebhookSignature({
    secret: process.env.GETTOIT_WEBHOOK_SECRET!,
    header: request.headers.get("x-gettoit-signature"),
    rawBody,
    toleranceSeconds: 300,
  });
  if (!valid) return new Response("invalid signature", { status: 401 });

  const deliveryId = request.headers.get("x-gettoit-delivery");
  if (deliveryId && (await alreadyProcessed(deliveryId))) {
    return new Response("duplicate", { status: 200 });
  }

  const event = JSON.parse(rawBody) as {
    id: string;
    type: "build.completed" | "build.failed";
    created_at: string;
    data: { job_id: string; project_id: string; result_version?: number; file_count?: number };
  };

  await record(deliveryId ?? event.id, event.data.job_id);
  return new Response("ok", { status: 200 });
}

declare function alreadyProcessed(id: string): Promise<boolean>;
declare function record(deliveryId: string, jobId: string): Promise<void>;
```

Respond with 2xx to stop retries. The platform makes at most five attempts and
never blocks a job result on a failed webhook.

## Pagination

```ts
let cursor: string | null = null;
do {
  const page = await client.listPreviews(projectId, { limit: 20, cursor });
  for (const preview of page.previews) console.log(preview.kind, preview.status);
  cursor = page.next_cursor;
} while (cursor);
```

## Supported versions

| API version | SDK | Status |
| --- | --- | --- |
| `2026-11-01` | 1.0.0 | Supported |

Send `x-gettoit-api-version` to pin a version. A response always reports the
version it used. Unsupported versions are not accepted; there is no automatic
upgrade.
