import { parseIdempotencyKey } from "@/lib/api/contracts";
import { apiErrorResponse, apiJson, readJsonBody } from "@/lib/api/http";
import { requestDeploymentProposal } from "@/lib/api/operations";
import { apiSupabase, bearerToken, hashApiToken } from "@/lib/api/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Creates a draft proposal only. Approval and deployment stay in the web app. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    const keyHash = hashApiToken(bearerToken(request));
    const idempotencyKey = parseIdempotencyKey(request.headers.get("idempotency-key"));
    const body = await readJsonBody(request);
    const data = await requestDeploymentProposal(
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
