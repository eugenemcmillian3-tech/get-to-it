import { ApiError, parseIdempotencyKey } from "@/lib/api/contracts";
import { apiErrorResponse, apiJson, readJsonBody } from "@/lib/api/http";
import { createProject } from "@/lib/api/operations";
import { apiSupabase, bearerToken, hashApiToken } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const keyHash = hashApiToken(bearerToken(request));
    const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
    const body = await readJsonBody(request);
    const data = await createProject(apiSupabase(), keyHash, idempotencyKey, body);
    return apiJson(data, { status: 201, requestId: String(data.request_id ?? "") });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export function GET() {
  return apiErrorResponse(new ApiError("method_not_allowed"));
}
