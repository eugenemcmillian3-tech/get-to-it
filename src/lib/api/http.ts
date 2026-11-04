import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
  API_VERSION,
  API_VERSION_HEADER,
  ApiError,
  pageSize,
  decodeCursor,
  type PageCursor,
} from "@/lib/api/contracts";

/** Shared JSON envelope and error translation for every /api/v1 route. */

export function apiJson(
  data: Record<string, unknown>,
  options: { status?: number; requestId?: string } = {},
): NextResponse {
  return NextResponse.json(
    {
      data,
      meta: {
        api_version: API_VERSION,
        ...(options.requestId ? { request_id: options.requestId } : {}),
      },
    },
    {
      status: options.status ?? 200,
      headers: {
        "cache-control": "no-store",
        [API_VERSION_HEADER]: API_VERSION,
      },
    },
  );
}

export function apiErrorResponse(error: unknown): NextResponse {
  const apiError =
    error instanceof ApiError
      ? error
      : new ApiError("internal_error", {
          message: "The request failed. Nothing was silently retried.",
        });

  if (!(error instanceof ApiError)) {
    console.error("Developer API route failed:", (error as Error)?.name ?? "unknown");
  }

  return NextResponse.json(apiError.toBody(), {
    status: apiError.status,
    headers: {
      "cache-control": "no-store",
      [API_VERSION_HEADER]: API_VERSION,
      ...(apiError.status === 429 ? { "retry-after": "60" } : {}),
    },
  });
}

export async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiError("invalid_request", { message: "Send a JSON body with Content-Type: application/json." });
  }
  try {
    return await request.json();
  } catch {
    throw new ApiError("invalid_request", { message: "The JSON body could not be parsed." });
  }
}

export function requestQuery(request: Request): URLSearchParams {
  return new URL(request.url).searchParams;
}

export function paginationFrom(request: Request, fallback = 20): {
  limit: number;
  cursor: PageCursor | null;
  cursorValue: string | null;
} {
  const query = requestQuery(request);
  const cursorValue = query.get("cursor");
  return {
    limit: pageSize(query.get("limit"), fallback),
    cursor: decodeCursor(cursorValue),
    cursorValue,
  };
}

export function invalidCursor(): ApiError {
  return new ApiError("invalid_request", {
    message: "The pagination cursor is not valid. Start again without a cursor.",
  });
}

/** Deterministic request id for errors raised before a database call. */
export function localRequestId(): string {
  return crypto.randomUUID();
}
