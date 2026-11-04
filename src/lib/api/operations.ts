import {
  buildProjectFiles,
  buildSpecDraft,
  composeSpec,
  intakeProblems,
  summarizeChanges,
  type AppSpec,
} from "@/lib/app-builder";
import {
  ApiError,
  createProjectBodySchema,
  deploymentProposalBodySchema,
  encodeCursor,
  guardResultError,
  requestFingerprint,
  specificationBodySchema,
  type PageCursor,
} from "@/lib/api/contracts";
import { callApiRpc, type ApiSupabase, type RpcResult } from "@/lib/api/server";
import { webhookEnvelope, webhookHeaders } from "@/lib/api/webhooks";
import { apiWebhookAad, decryptSecret } from "@/lib/deploy/vault";
import {
  buildDeploymentPlan,
  extractEnvRequirements,
  planHash,
  planProblems,
  DeploymentError,
  type DeploymentFile,
  type DeploymentTarget,
  type GitHubTarget,
  type SupabaseTarget,
  type VercelTarget,
} from "@/lib/deployments";
import { isUuid } from "@/lib/validation";

/**
 * The single operation layer used by REST routes and the MCP gateway.
 *
 * Every function passes the token hash to a security-definer RPC that
 * re-verifies the credential, scope, project and rate limit. Generation is the
 * existing deterministic scaffolder. Nothing here runs project code, spends
 * credits, approves a plan or deploys.
 */

const WEBHOOK_TIMEOUT_MS = 5_000;
const MAX_DELIVERIES_PER_REQUEST = 3;

function unwrap(result: RpcResult): RpcResult {
  const error = guardResultError(result);
  if (error) throw error;
  return result;
}

function projectId(value: string): string {
  if (!isUuid(value)) {
    throw new ApiError("not_found", { message: "No matching project is available to this credential." });
  }
  return value;
}

function jobId(value: string): string {
  if (!isUuid(value)) {
    throw new ApiError("not_found", { message: "No matching job is available to this credential." });
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function validationError(message: string, details?: Record<string, unknown>): ApiError {
  return new ApiError("invalid_request", { message, ...(details ? { details } : {}) });
}

// ---------------------------------------------------------------------------
// Projects and specifications
// ---------------------------------------------------------------------------

export async function createProject(
  client: ApiSupabase,
  keyHash: string,
  idempotencyKey: string,
  body: unknown,
): Promise<RpcResult> {
  const parsed = createProjectBodySchema.safeParse(body);
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Check the intake fields.");
  }

  const problems = intakeProblems(parsed.data);
  if (problems.length > 0) throw validationError(problems.join(" "));

  const spec = buildSpecDraft(parsed.data);
  try {
    buildProjectFiles(spec, { name: parsed.data.name, purpose: parsed.data.purpose });
  } catch (error) {
    throw validationError(
      error instanceof Error ? error.message : "That intake cannot produce a valid project.",
    );
  }

  const result = unwrap(
    await callApiRpc(client, "api_create_project", {
      p_key_hash: keyHash,
      p_idempotency_key: idempotencyKey,
      p_request_hash: requestFingerprint(parsed.data),
      p_intake: parsed.data,
      p_spec: spec,
    }),
  );

  return {
    project: result.project,
    specification: result.specification,
    replayed: result.replayed === true,
    request_id: result.request_id,
  };
}

export async function submitSpecification(
  client: ApiSupabase,
  keyHash: string,
  projectIdInput: string,
  idempotencyKey: string,
  body: unknown,
): Promise<RpcResult> {
  const id = projectId(projectIdInput);
  const parsed = specificationBodySchema.safeParse(body);
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Check the specification fields.");
  }

  const context = unwrap(
    await callApiRpc(client, "api_project_context", {
      p_key_hash: keyHash,
      p_project_id: id,
      p_scope: "specs:write",
    }),
  );
  const project = asRecord(context.project);
  const latest = asRecord(context.latest_specification);
  const latestSpec = asRecord(latest.spec) as unknown as Partial<AppSpec>;

  const composed = composeSpec(
    parsed.data,
    typeof project.design_preferences === "string" ? project.design_preferences : "",
    typeof project.definition_of_done === "string" ? project.definition_of_done : "",
  );
  const spec: AppSpec = {
    ...composed,
    purpose:
      typeof latestSpec.purpose === "string"
        ? latestSpec.purpose
        : typeof project.purpose === "string"
          ? project.purpose
          : composed.purpose,
    stack: "nextjs-typescript-tailwind",
  };

  if (spec.entities.length === 0 && spec.pages.length <= 1) {
    throw validationError("Add at least one page or one data entity before saving.");
  }

  try {
    buildProjectFiles(spec, {
      name: typeof project.name === "string" ? project.name : "App",
      purpose: typeof project.purpose === "string" ? project.purpose : spec.purpose,
    });
  } catch (error) {
    throw validationError(
      error instanceof Error ? error.message : "That specification cannot produce a valid project.",
    );
  }

  const result = unwrap(
    await callApiRpc(client, "api_save_spec", {
      p_key_hash: keyHash,
      p_project_id: id,
      p_idempotency_key: idempotencyKey,
      p_request_hash: requestFingerprint({ project_id: id, ...parsed.data }),
      p_spec: spec,
    }),
  );

  return {
    specification: result.specification,
    project: result.project,
    replayed: result.replayed === true,
    request_id: result.request_id,
  };
}

// ---------------------------------------------------------------------------
// Build jobs
// ---------------------------------------------------------------------------

export async function startBuildJob(
  client: ApiSupabase,
  keyHash: string,
  projectIdInput: string,
  idempotencyKey: string,
): Promise<RpcResult> {
  const id = projectId(projectIdInput);

  const created = unwrap(
    await callApiRpc(client, "api_start_build_job", {
      p_key_hash: keyHash,
      p_project_id: id,
      p_idempotency_key: idempotencyKey,
      p_request_hash: requestFingerprint({ project_id: id }),
    }),
  );

  const job = asRecord(created.job);
  const createdJobId = typeof job.id === "string" ? job.id : "";
  if (!createdJobId) throw new ApiError("internal_error");

  // The bounded deterministic generation runs now so the API is usable without
  // a background worker. Polling the same stable id remains supported, and a
  // replay returns the same job instead of starting a second build. A key with
  // builds:write alone can start a build; reading status afterwards needs
  // builds:read, so this response never calls the read operation.
  const processed = job.status === "queued"
    ? await claimAndProcessJob(client, keyHash, createdJobId)
    : null;

  const settled = asRecord(processed?.job);
  const deliveries = await deliverQueuedDeliveries(
    client,
    keyHash,
    id,
    processed?.deliveries,
  );

  return {
    job: settled.id ? settled : job,
    deliveries,
    replayed: created.replayed === true,
    request_id: processed?.request_id ?? created.request_id,
  };
}

async function claimAndProcessJob(
  client: ApiSupabase,
  keyHash: string,
  id: string,
): Promise<RpcResult | null> {
  const claim = await callApiRpc(client, "api_claim_job", {
    p_key_hash: keyHash,
    p_job_id: id,
  });

  if (claim.ok !== true) return null;

  const spec = asRecord(claim.spec) as unknown as AppSpec;
  const project = asRecord(claim.project);

  try {
    const files = buildProjectFiles(spec, {
      name: typeof project.name === "string" ? project.name : "App",
      purpose: typeof project.purpose === "string" ? project.purpose : spec.purpose,
    });
    const summary = summarizeChanges([], files).summary;

    return await callApiRpc(client, "api_complete_job", {
      p_key_hash: keyHash,
      p_job_id: id,
      p_files: files,
      p_summary: `API build: ${summary}`,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message.length <= 1000
        ? error.message
        : "The deterministic generator could not produce a valid project.";
    return await callApiRpc(client, "api_fail_job", {
      p_key_hash: keyHash,
      p_job_id: id,
      p_error_code: "build_failed",
      p_error_message: message,
    }).catch(() => null);
  }
}

export async function getJob(
  client: ApiSupabase,
  keyHash: string,
  jobIdInput: string,
  options: { deliver?: boolean } = {},
): Promise<RpcResult> {
  const id = jobId(jobIdInput);
  const result = unwrap(
    await callApiRpc(client, "api_get_job", { p_key_hash: keyHash, p_job_id: id }),
  );

  const job = asRecord(result.job);
  const deliveries =
    options.deliver === false
      ? []
      : await deliverQueuedDeliveries(
          client,
          keyHash,
          typeof job.project_id === "string" ? job.project_id : "",
          result.deliveries,
        );

  return {
    job: result.job,
    deliveries,
    request_id: result.request_id,
  };
}

export async function listJobs(
  client: ApiSupabase,
  keyHash: string,
  projectIdInput: string,
  limit: number,
  cursor: PageCursor | null,
): Promise<RpcResult> {
  const id = projectId(projectIdInput);
  const result = unwrap(
    await callApiRpc(client, "api_list_jobs", {
      p_key_hash: keyHash,
      p_project_id: id,
      p_limit: limit,
      p_cursor_created: cursor?.created_at ?? null,
      p_cursor_id: cursor?.id ?? null,
    }),
  );

  return {
    jobs: result.jobs,
    next_cursor: nextCursor(result.next_cursor),
    request_id: result.request_id,
  };
}

export async function cancelJob(
  client: ApiSupabase,
  keyHash: string,
  jobIdInput: string,
): Promise<RpcResult> {
  const id = jobId(jobIdInput);
  const result = unwrap(
    await callApiRpc(client, "api_cancel_job", { p_key_hash: keyHash, p_job_id: id }),
  );
  return { job: result.job, request_id: result.request_id };
}

export async function getArtifacts(
  client: ApiSupabase,
  keyHash: string,
  jobIdInput: string,
  limit: number,
  cursorValue: string | null,
): Promise<RpcResult> {
  const id = jobId(jobIdInput);
  const result = unwrap(
    await callApiRpc(client, "api_get_artifacts", {
      p_key_hash: keyHash,
      p_job_id: id,
      p_limit: limit,
      p_cursor: cursorValue,
    }),
  );

  return {
    job_id: result.job_id,
    version: result.version,
    file_count: result.file_count,
    files: result.files,
    next_cursor: result.next_cursor ?? null,
    request_id: result.request_id,
  };
}

/** Queues and immediately runs a just-created queued job, if one is present. */
export async function processQueuedJob(
  client: ApiSupabase,
  keyHash: string,
  id: string,
): Promise<RpcResult | null> {
  return claimAndProcessJob(client, keyHash, id);
}

// ---------------------------------------------------------------------------
// Previews
// ---------------------------------------------------------------------------

export async function listPreviews(
  client: ApiSupabase,
  keyHash: string,
  projectIdInput: string,
  limit: number,
  cursor: PageCursor | null,
): Promise<RpcResult> {
  const id = projectId(projectIdInput);
  const result = unwrap(
    await callApiRpc(client, "api_list_previews", {
      p_key_hash: keyHash,
      p_project_id: id,
      p_limit: limit,
      p_cursor_created: cursor?.created_at ?? null,
      p_cursor_id: cursor?.id ?? null,
    }),
  );

  return {
    previews: result.previews,
    next_cursor: nextCursor(result.next_cursor),
    request_id: result.request_id,
  };
}

function nextCursor(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.created_at !== "string" || typeof record.id !== "string") return null;
  return encodeCursor({ created_at: record.created_at, id: record.id });
}

// ---------------------------------------------------------------------------
// Deployment proposals
// ---------------------------------------------------------------------------

export async function requestDeploymentProposal(
  client: ApiSupabase,
  keyHash: string,
  projectIdInput: string,
  idempotencyKey: string,
  body: unknown,
): Promise<RpcResult> {
  const id = projectId(projectIdInput);
  const parsed = deploymentProposalBodySchema.safeParse(body);
  if (!parsed.success) {
    throw validationError(parsed.error.issues[0]?.message ?? "Choose preview or production.");
  }
  const target: DeploymentTarget = parsed.data.target;

  const inputs = unwrap(
    await callApiRpc(client, "api_deployment_inputs", {
      p_key_hash: keyHash,
      p_project_id: id,
    }),
  );

  const project = asRecord(inputs.project);
  const version = Number(project.current_version ?? 0);
  const files = Array.isArray(inputs.files)
    ? (inputs.files as DeploymentFile[]).filter(
        (file) =>
          file && typeof file.path === "string" && typeof file.content === "string",
      )
    : [];

  if (!Number.isInteger(version) || version < 1 || files.length === 0) {
    throw validationError(
      "Generate project files in the web app before requesting a deployment proposal.",
    );
  }

  const connections = new Map(
    (Array.isArray(inputs.connections) ? inputs.connections : []).map((row) => {
      const record = asRecord(row);
      return [String(record.provider ?? ""), record] as const;
    }),
  );
  const github = connections.get("github");
  const vercel = connections.get("vercel");
  const supabase = connections.get("supabase");
  if (!github || !vercel || !supabase) {
    throw validationError(
      "Connect GitHub, Vercel and Supabase for this project in the web app before requesting a proposal.",
    );
  }

  const gh = asRecord(github.metadata);
  const vc = asRecord(vercel.metadata);
  const sb = asRecord(supabase.metadata);
  const environment = target === "production" ? "production" : "preview";
  const envNames = asRecord(inputs.env_names);
  const setNames = Array.isArray(envNames[environment])
    ? (envNames[environment] as unknown[]).filter(
        (name): name is string => typeof name === "string",
      )
    : [];

  const githubTarget: GitHubTarget = {
    provider: "github",
    login: typeof gh.login === "string" ? gh.login : String(github.account_label ?? "github"),
    full_name: String(github.external_ref ?? ""),
    branch: typeof gh.branch === "string" ? gh.branch : typeof gh.default_branch === "string" ? gh.default_branch : "main",
    private: gh.private === true,
    repo_id: typeof gh.repo_id === "number" ? gh.repo_id : null,
  };
  const vercelTarget: VercelTarget = {
    provider: "vercel",
    account: String(vercel.account_label ?? "vercel"),
    project_id: String(vercel.external_ref ?? ""),
    project_name: typeof vc.project_name === "string" ? vc.project_name : String(vercel.account_label ?? "vercel"),
    team_id: typeof vc.team_id === "string" ? vc.team_id : null,
  };
  const supabaseTarget: SupabaseTarget = {
    provider: "supabase",
    account: String(supabase.account_label ?? "supabase"),
    development_ref: String(sb.development_ref ?? "development"),
    production_ref: String(sb.production_ref ?? "production"),
    target_ref:
      target === "production"
        ? String(sb.production_ref ?? "production")
        : String(sb.development_ref ?? "development"),
  };

  let plan;
  try {
    plan = buildDeploymentPlan({
      projectId: id,
      projectName: String(project.name ?? "App"),
      target,
      version,
      files,
      github: githubTarget,
      vercel: vercelTarget,
      supabase: supabaseTarget,
      envRequirements: extractEnvRequirements(files),
      setEnvNames: setNames,
    });
  } catch (error) {
    throw validationError(
      error instanceof DeploymentError ? error.message : "The deployment plan could not be built.",
    );
  }

  if (plan.source.digest.length !== 64) {
    throw new ApiError("internal_error");
  }

  const result = unwrap(
    await callApiRpc(client, "api_create_deployment_proposal", {
      p_key_hash: keyHash,
      p_project_id: id,
      p_target: target,
      p_plan: plan,
      p_plan_hash: planHash(plan),
      p_snapshot_version: version,
      p_digest: plan.source.digest,
      p_snapshot: files,
      p_idempotency_key: idempotencyKey,
      p_request_hash: requestFingerprint({ project_id: id, target }),
    }),
  );

  return {
    proposal: result.proposal,
    warnings: planProblems(plan),
    replayed: result.replayed === true,
    request_id: result.request_id,
  };
}

// ---------------------------------------------------------------------------
// Webhook delivery (bounded, idempotent, never blocks the result on failure)
// ---------------------------------------------------------------------------

export type SafeDelivery = {
  id: string;
  event: string;
  url: string;
  delivered: boolean;
  attempts: number | null;
};

async function deliverQueuedDeliveries(
  client: ApiSupabase,
  keyHash: string,
  projectIdValue: string,
  raw: unknown,
): Promise<SafeDelivery[]> {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const safe: SafeDelivery[] = [];
  for (const item of raw.slice(0, MAX_DELIVERIES_PER_REQUEST)) {
    const delivery = asRecord(item);
    const id = typeof delivery.id === "string" ? delivery.id : "";
    const webhookId = typeof delivery.webhook_id === "string" ? delivery.webhook_id : "";
    const url = typeof delivery.url === "string" ? delivery.url : "";
    const event = typeof delivery.event === "string" ? delivery.event : "";
    const sealed = typeof delivery.secret_sealed === "string" ? delivery.secret_sealed : "";
    if (!id || !webhookId || !url || !event) continue;

    let delivered = false;
    let errorMessage = "Webhook signing is not configured on this server.";

    if (sealed && projectIdValue) {
      try {
        const secret = decryptSecret(sealed, apiWebhookAad(projectIdValue, webhookId));
        const payload = asRecord(delivery.payload);
        const envelope = webhookEnvelope({
          deliveryId: id,
          event: event === "build.failed" ? "build.failed" : "build.completed",
          payload,
        });
        const rawBody = JSON.stringify(envelope);
        const response = await fetch(url, {
          method: "POST",
          headers: webhookHeaders({
            secret,
            deliveryId: id,
            event: envelope.type,
            rawBody,
          }),
          body: rawBody,
          redirect: "manual",
          signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        });
        delivered = response.status >= 200 && response.status < 300;
        errorMessage = delivered
          ? ""
          : `The receiver returned HTTP ${response.status}.`;
      } catch {
        errorMessage = "The webhook endpoint could not be reached.";
      }
    }

    const recorded = await callApiRpc(client, "api_record_delivery", {
      p_key_hash: keyHash,
      p_delivery_id: id,
      p_delivered: delivered,
      p_error: delivered ? null : errorMessage,
    }).catch(() => null);

    const deliveryState = recorded ? asRecord(recorded.delivery) : {};
    safe.push({
      id,
      event,
      url,
      delivered,
      attempts:
        typeof deliveryState.attempts === "number" ? deliveryState.attempts : null,
    });
  }

  return safe;
}
