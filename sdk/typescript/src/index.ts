/**
 * GET TO IT TypeScript SDK — matches the /api/v1 developer API.
 *
 * Zero runtime dependencies. Works in Node 18+ and browsers with fetch.
 * The SDK never stores or logs the API key, never retries a POST with a new
 * idempotency key, and cannot approve or deploy a plan.
 */

export const API_VERSION = "2026-11-01";

export type ApiScope =
  | "projects:write"
  | "specs:write"
  | "builds:write"
  | "builds:read"
  | "previews:read"
  | "deployments:propose";

export type AppProject = {
  id: string;
  name: string;
  status: string;
  current_version: number;
};

export type Specification = {
  id: string;
  version: number;
  approved: boolean;
};

export type CreateProjectInput = {
  name: string;
  purpose: string;
  target_users: string;
  workflows: string;
  required_pages: string;
  entities?: string;
  auth_requirements: "supabase" | "none";
  integrations?: string;
  design_preferences?: string;
  definition_of_done: string;
};

export type SpecificationInput = {
  features: string;
  exclusions?: string;
  pages: string;
  entities?: string;
  integrations?: string;
  acceptance_checks?: string;
  auth_requirements: "supabase" | "none";
};

export type BuildJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type BuildJob = {
  id: string;
  status: BuildJobStatus;
  kind: string;
  project_id: string;
  spec_version: number;
  result_version: number | null;
  file_count: number | null;
  summary: string | null;
  error: { code: string; message: string } | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type WebhookDelivery = {
  id: string;
  event: string;
  url: string;
  delivered: boolean;
  attempts: number | null;
};

export type ArtifactFile = { path: string; content: string };

export type Preview = {
  id: string;
  kind: "workspace" | "deployment";
  status: string;
  created_at: string;
  url: string | null;
  detail: string | null;
  version: number | null;
};

export type DeploymentProposal = {
  id: string;
  project_id: string;
  target: "preview" | "production";
  status: "draft";
  approval_required: true;
  approved: false;
  snapshot_version: number;
  snapshot_digest: string;
  plan_hash: string;
  plan: Record<string, unknown>;
  notice: string;
};

export type RequestOptions = {
  idempotencyKey?: string;
  signal?: AbortSignal;
};

export class GettiApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { requestId?: string; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = "GettiApiError";
    this.status = status;
    this.code = code;
    this.requestId = options.requestId;
    this.details = options.details;
  }
}

export type GettiClientOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  apiVersion?: string;
};

type Envelope<T> = { data: T; meta?: { api_version?: string; request_id?: string } };

export function newIdempotencyKey(): string {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.randomUUID) return cryptoObject.randomUUID();
  return `idem_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export class GettiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly apiVersion: string;

  constructor(options: GettiClientOptions) {
    if (!options.apiKey || !options.apiKey.startsWith("gti_")) {
      throw new Error("A project API key starting with gti_ is required.");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "http://localhost:3000").replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.apiVersion = options.apiVersion ?? API_VERSION;
  }

  private async request<T>(
    method: string,
    path: string,
    options: { body?: unknown; idempotencyKey?: string; signal?: AbortSignal } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${this.apiKey}`,
      "x-gettoit-api-version": this.apiVersion,
    };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (error) {
      throw new GettiApiError(
        0,
        "network_error",
        error instanceof Error ? error.message : "The API could not be reached.",
      );
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }

    const payload = (await response.json().catch(() => null)) as
      | Envelope<T>
      | { error?: { code?: string; message?: string; request_id?: string; details?: Record<string, unknown> } }
      | null;

    if (!response.ok) {
      const failure = payload && "error" in payload ? payload.error : undefined;
      throw new GettiApiError(
        response.status,
        failure?.code ?? "http_error",
        failure?.message ?? `The API returned HTTP ${response.status}.`,
        { requestId: failure?.request_id, details: failure?.details },
      );
    }

    if (!payload || !("data" in payload)) {
      throw new GettiApiError(response.status, "invalid_response", "The API response was not in the documented envelope.");
    }
    return payload.data;
  }

  async getServiceInfo(): Promise<{ api: string; version: string; scopes: unknown }> {
    return this.request("GET", "/api/v1");
  }

  async createProject(
    input: CreateProjectInput,
    options: RequestOptions = {},
  ): Promise<{ project: AppProject; specification: Specification; replayed: boolean }> {
    return this.request("POST", "/api/v1/projects", {
      body: input,
      idempotencyKey: options.idempotencyKey ?? newIdempotencyKey(),
      signal: options.signal,
    });
  }

  async submitSpecification(
    projectId: string,
    input: SpecificationInput,
    options: RequestOptions = {},
  ): Promise<{ specification: Specification; project: { id: string; status: string }; replayed: boolean }> {
    return this.request("POST", `/api/v1/projects/${projectId}/specification`, {
      body: input,
      idempotencyKey: options.idempotencyKey ?? newIdempotencyKey(),
      signal: options.signal,
    });
  }

  async startBuild(
    projectId: string,
    options: RequestOptions = {},
  ): Promise<{ job: BuildJob; deliveries: WebhookDelivery[]; replayed: boolean }> {
    return this.request("POST", `/api/v1/projects/${projectId}/jobs`, {
      body: {},
      idempotencyKey: options.idempotencyKey ?? newIdempotencyKey(),
      signal: options.signal,
    });
  }

  async getJob(jobId: string, options: { signal?: AbortSignal } = {}): Promise<{
    job: BuildJob;
    deliveries: WebhookDelivery[];
  }> {
    return this.request("GET", `/api/v1/jobs/${jobId}`, { signal: options.signal });
  }

  async listJobs(
    projectId: string,
    options: { limit?: number; cursor?: string | null; signal?: AbortSignal } = {},
  ): Promise<{ jobs: BuildJob[]; next_cursor: string | null }> {
    return this.request("GET", this.paged(`/api/v1/projects/${projectId}/jobs`, options), {
      signal: options.signal,
    });
  }

  /** Polls until the job is succeeded, failed or canceled. */
  async waitForJob(
    jobId: string,
    options: { intervalMs?: number; timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<BuildJob> {
    const interval = Math.max(250, options.intervalMs ?? 1_000);
    const deadline = Date.now() + (options.timeoutMs ?? 120_000);

    for (;;) {
      const { job } = await this.getJob(jobId, { signal: options.signal });
      if (job.status === "succeeded" || job.status === "failed" || job.status === "canceled") {
        return job;
      }
      if (Date.now() > deadline) {
        throw new GettiApiError(0, "poll_timeout", `Job ${jobId} was still ${job.status} after the polling window.`);
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }

  async cancelJob(jobId: string, options: { signal?: AbortSignal } = {}): Promise<{ job: BuildJob }> {
    return this.request("DELETE", `/api/v1/jobs/${jobId}`, { signal: options.signal });
  }

  async getArtifacts(
    jobId: string,
    options: { limit?: number; cursor?: string | null; signal?: AbortSignal } = {},
  ): Promise<{
    job_id: string;
    version: number;
    file_count: number;
    files: ArtifactFile[];
    next_cursor: string | null;
  }> {
    return this.request("GET", this.paged(`/api/v1/jobs/${jobId}/artifacts`, options), {
      signal: options.signal,
    });
  }

  async listPreviews(
    projectId: string,
    options: { limit?: number; cursor?: string | null; signal?: AbortSignal } = {},
  ): Promise<{ previews: Preview[]; next_cursor: string | null }> {
    return this.request("GET", this.paged(`/api/v1/projects/${projectId}/previews`, options), {
      signal: options.signal,
    });
  }

  /** Creates a draft proposal only. It cannot approve or execute a deployment. */
  async requestDeploymentProposal(
    projectId: string,
    target: "preview" | "production",
    options: RequestOptions = {},
  ): Promise<{ proposal: DeploymentProposal; warnings: string[]; replayed: boolean }> {
    return this.request("POST", `/api/v1/projects/${projectId}/deployment-proposals`, {
      body: { target },
      idempotencyKey: options.idempotencyKey ?? newIdempotencyKey(),
      signal: options.signal,
    });
  }

  private paged(
    path: string,
    options: { limit?: number; cursor?: string | null },
  ): string {
    const query = new URLSearchParams();
    if (options.limit) query.set("limit", String(options.limit));
    if (options.cursor) query.set("cursor", options.cursor);
    const suffix = query.toString();
    return suffix ? `${path}?${suffix}` : path;
  }
}

/**
 * Verifies an X-GETTOIT-Signature header: `t=<unix>,v1=<hmac-sha256-hex>`.
 * Use the raw request body bytes, not a re-serialized object.
 */
export async function verifyWebhookSignature(input: {
  secret: string;
  header: string | null;
  rawBody: string;
  toleranceSeconds?: number;
  nowMs?: number;
}): Promise<boolean> {
  if (!input.header) return false;
  const parts = input.header.split(",").map((part) => part.trim());
  const timestampPart = parts.find((part) => part.startsWith("t="));
  const signatures = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  if (!timestampPart || signatures.length === 0) return false;

  const timestamp = Number(timestampPart.slice(2));
  if (!Number.isInteger(timestamp) || timestamp <= 0) return false;

  const tolerance = input.toleranceSeconds ?? 300;
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - timestamp) > tolerance) return false;

  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(input.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  for (const signature of signatures) {
    if (!/^[a-f0-9]{64}$/i.test(signature)) continue;
    const bytes = new Uint8Array(signature.match(/.{2}/g)!.map((pair) => parseInt(pair, 16)));
    const valid = await globalThis.crypto.subtle.verify(
      "HMAC",
      key,
      bytes,
      encoder.encode(`${timestamp}.${input.rawBody}`),
    );
    if (valid) return true;
  }
  return false;
}
