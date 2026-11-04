import { NextResponse } from "next/server";
import {
  API_VERSION,
  ApiError,
  MCP_TOOLS,
  MCP_UNTRUSTED_NOTICE,
  decodeCursor,
  mcpTool,
  parseIdempotencyKey,
} from "@/lib/api/contracts";
import {
  createProject,
  getArtifacts,
  getJob,
  listPreviews,
  requestDeploymentProposal,
  startBuildJob,
  submitSpecification,
} from "@/lib/api/operations";
import { apiSupabase, bearerToken, hashApiToken } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Optional MCP gateway over the same operations, credential, scopes, quotas and
 * owner approvals as REST. There is no privileged tool and no separate executor.
 * Tool output is untrusted data; the server instructions say so explicitly.
 */

type JsonRpcId = string | number | null;

function rpcResult(id: JsonRpcId, result: Record<string, unknown>) {
  return NextResponse.json(
    { jsonrpc: "2.0", id, result },
    { headers: { "cache-control": "no-store" } },
  );
}

function rpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  options: { status?: number; data?: Record<string, unknown> } = {},
) {
  return NextResponse.json(
    { jsonrpc: "2.0", id, error: { code, message, ...(options.data ? { data: options.data } : {}) } },
    { status: options.status ?? 200, headers: { "cache-control": "no-store" } },
  );
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function integerValue(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

async function runTool(
  name: string,
  args: Record<string, unknown>,
  idempotencyHeader: string | null,
  keyHash: string,
): Promise<Record<string, unknown>> {
  const client = apiSupabase();
  const idempotencyKey = () =>
    parseIdempotencyKey(
      typeof args.idempotency_key === "string" ? args.idempotency_key : idempotencyHeader,
    );

  switch (name) {
    case "create_project":
      return createProject(client, keyHash, idempotencyKey(), args);
    case "submit_specification":
      return submitSpecification(
        client,
        keyHash,
        typeof args.project_id === "string" ? args.project_id : "",
        idempotencyKey(),
        args,
      );
    case "start_build":
      return startBuildJob(
        client,
        keyHash,
        typeof args.project_id === "string" ? args.project_id : "",
        idempotencyKey(),
      );
    case "get_job":
      return getJob(client, keyHash, typeof args.job_id === "string" ? args.job_id : "");
    case "get_artifacts":
      return getArtifacts(
        client,
        keyHash,
        typeof args.job_id === "string" ? args.job_id : "",
        integerValue(args.limit, 25, 60),
        typeof args.cursor === "string" ? args.cursor : null,
      );
    case "list_previews": {
      const cursorValue = typeof args.cursor === "string" ? args.cursor : null;
      const cursor = decodeCursor(cursorValue);
      if (cursorValue && !cursor) {
        throw new ApiError("invalid_request", {
          message: "The pagination cursor is not valid.",
        });
      }
      return listPreviews(
        client,
        keyHash,
        typeof args.project_id === "string" ? args.project_id : "",
        integerValue(args.limit, 20, 50),
        cursor,
      );
    }
    case "request_deployment_proposal":
      return requestDeploymentProposal(
        client,
        keyHash,
        typeof args.project_id === "string" ? args.project_id : "",
        idempotencyKey(),
        { target: args.target },
      );
    default:
      throw new ApiError("not_implemented");
  }
}

export async function POST(request: Request) {
  let keyHash: string;
  try {
    keyHash = hashApiToken(bearerToken(request));
  } catch (error) {
    const apiError = error instanceof ApiError ? error : new ApiError("unauthenticated");
    return rpcError(null, -32001, apiError.message, {
      status: apiError.status,
      data: { code: apiError.code },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, "The JSON-RPC body could not be parsed.", { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return rpcError(null, -32600, "Send one JSON-RPC request object.", { status: 400 });
  }

  const message = body as Record<string, unknown>;
  const id =
    typeof message.id === "string" || typeof message.id === "number" ? message.id : null;
  const method = typeof message.method === "string" ? message.method : "";
  const params = objectValue(message.params);

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "gettoit-developer-api", version: API_VERSION },
      instructions: `${MCP_UNTRUSTED_NOTICE} This gateway exposes seven bounded project operations. It cannot run shell commands, spend credits, approve plans or deploy.`,
    });
  }

  if (method === "notifications/initialized") {
    return new NextResponse(null, { status: 202, headers: { "cache-control": "no-store" } });
  }

  if (method === "ping") {
    return rpcResult(id, {});
  }

  if (method === "tools/list") {
    return rpcResult(id, {
      tools: MCP_TOOLS.map((tool) => ({
        name: tool.name,
        description: `${tool.description} Required scope: ${tool.scope}. ${MCP_UNTRUSTED_NOTICE}`,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: tool.scope.endsWith(":read"),
          destructiveHint: false,
          openWorldHint: false,
        },
      })),
    });
  }

  if (method === "tools/call") {
    const name = typeof params.name === "string" ? params.name : "";
    if (!mcpTool(name)) {
      return rpcError(id, -32602, `Unknown tool: ${name || "(none)"}`);
    }
    const args = objectValue(params.arguments);
    try {
      const data = await runTool(name, args, request.headers.get("idempotency-key"), keyHash);
      return rpcResult(id, {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        isError: false,
      });
    } catch (error) {
      const apiError = error instanceof ApiError ? error : new ApiError("internal_error");
      if (!(error instanceof ApiError)) {
        console.error("MCP tool failed:", (error as Error)?.name ?? "unknown");
      }
      return rpcResult(id, {
        content: [
          {
            type: "text",
            text: JSON.stringify(apiError.toBody(), null, 2),
          },
        ],
        isError: true,
        _meta: { code: apiError.code, status: apiError.status },
      });
    }
  }

  return rpcError(id, -32601, `Unknown method: ${method || "(none)"}`);
}

export function GET() {
  return rpcError(null, -32601, "Use POST for the MCP JSON-RPC endpoint.", { status: 405 });
}
