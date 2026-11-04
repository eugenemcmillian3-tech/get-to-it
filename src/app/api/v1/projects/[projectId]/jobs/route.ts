import { ApiError, parseIdempotencyKey } from "@/lib/api/contracts";
import {
  apiErrorResponse,
  apiJson,
  invalidCursor,
  paginationFrom,
} from "@/lib/api/http";
import { listJobs, startBuildJob } from "@/lib/api/operations";
import { apiSupabase, bearerToken, hashApiToken } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const keyHash = hashApiToken(bearerToken(request));
    const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
    const data = await startBuildJob(apiSupabase(), keyHash, projectId, idempotencyKey);
    return apiJson(data, { status: 202, requestId: String(data.request_id ?? "") });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const keyHash = hashApiToken(bearerToken(request));
    const page = paginationFrom(request, 20);
    if (page.cursorValue && !page.cursor) throw invalidCursor();

    const data = await listJobs(apiSupabase(), keyHash, projectId, page.limit, page.cursor);
    return apiJson(data, { requestId: String(data.request_id ?? "") });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export function DELETE() {
  return apiErrorResponse(new ApiError("method_not_allowed"));
}
