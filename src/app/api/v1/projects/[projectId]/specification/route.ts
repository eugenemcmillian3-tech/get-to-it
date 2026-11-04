import { ApiError, parseIdempotencyKey } from "@/lib/api/contracts";
import { apiErrorResponse, apiJson, readJsonBody } from "@/lib/api/http";
import { submitSpecification } from "@/lib/api/operations";
import { apiSupabase, bearerToken, hashApiToken } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function submit(request: Request, projectId: string) {
  try {
    const keyHash = hashApiToken(bearerToken(request));
    const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
    const body = await readJsonBody(request);
    const data = await submitSpecification(
      apiSupabase(),
      keyHash,
      projectId,
      idempotencyKey,
      body,
    );
    return apiJson(data, { status: 201, requestId: String(data.request_id ?? "") });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  return submit(request, projectId);
}

/** PUT is accepted as an alias so clients can treat this as an upsert. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  return submit(request, projectId);
}

export function PATCH() {
  return apiErrorResponse(new ApiError("method_not_allowed"));
}
