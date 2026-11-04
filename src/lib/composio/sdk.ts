import { COMPOSIO_MIN_NODE, checkNodeSupport } from "@/lib/composio/contracts";

/**
 * Lazily loaded Composio client.
 *
 * The SDK is ESM-only and server-only. It is imported dynamically so a build
 * or a page render without COMPOSIO_API_KEY never loads it, and the browser
 * bundle can never contain it. The API key is read at call time.
 */

export class ComposioConfigError extends Error {
  code: "missing-key" | "unsupported-runtime" | "missing-origin" | "sdk";

  constructor(code: ComposioConfigError["code"], message: string) {
    super(message);
    this.name = "ComposioConfigError";
    this.code = code;
  }
}

export type ComposioSessionLike = {
  sessionId: string;
  authorize(
    toolkit: string,
    options: { callbackUrl: string },
  ): Promise<{ redirectUrl?: string }>;
  execute(
    toolSlug: string,
    args: Record<string, unknown>,
    options?: unknown,
    requestOptions?: { signal?: AbortSignal },
  ): Promise<{
    data?: unknown;
    error?: string | null;
    logId?: string;
    resultType?: string;
  }>;
};

export type ComposioConnectedAccountLike = {
  id?: unknown;
  status?: unknown;
  userId?: unknown;
  user_id?: unknown;
  toolkit?: { slug?: unknown; name?: unknown } | null;
  toolkitSlug?: unknown;
  toolkit_slug?: unknown;
  alias?: unknown;
  name?: unknown;
};

export type ComposioClientLike = {
  create(userId: string, config: Record<string, unknown>): Promise<ComposioSessionLike>;
  use(sessionId: string): Promise<ComposioSessionLike>;
  connectedAccounts: {
    get(id: string): Promise<ComposioConnectedAccountLike>;
    revoke(id: string): Promise<unknown>;
  };
  tools: {
    getRawComposioTools(options: {
      toolkits: string[];
      limit: number;
    }): Promise<unknown>;
  };
};

type SdkModule = {
  Composio: new (options: { apiKey: string; allowTracking?: boolean }) => unknown;
};

let cached: { key: string; client: ComposioClientLike } | null = null;

export function getComposioApiKey(): string | null {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) return null;
  const trimmed = key.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isComposioConfigured(): boolean {
  return getComposioApiKey() !== null && getAppOrigin() !== null;
}

/** Absolute public origin for the provider callback. Never derived from Host. */
export function getAppOrigin(): string | null {
  const raw = process.env.APP_ORIGIN;
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(trimmed)) return null;
  if (trimmed.startsWith("http://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function requireAppOrigin(): string {
  const origin = getAppOrigin();
  if (!origin) {
    throw new ComposioConfigError(
      "missing-origin",
      "APP_ORIGIN must be an absolute public URL, for example https://app.example.com. The OAuth callback is built from it.",
    );
  }
  return origin;
}

export async function getComposioClient(): Promise<ComposioClientLike> {
  const key = getComposioApiKey();
  if (!key) {
    throw new ComposioConfigError(
      "missing-key",
      "COMPOSIO_API_KEY is not set, so no connection can be started. Add it as a server-only environment variable.",
    );
  }

  const support = checkNodeSupport();
  if (!support.supported) {
    throw new ComposioConfigError("unsupported-runtime", support.message);
  }

  if (cached && cached.key === key) return cached.client;

  try {
    const sdk = (await import("@composio/core")) as unknown as SdkModule;
    const client = new sdk.Composio({
      apiKey: key,
      // No product telemetry from this app by default.
      allowTracking: false,
    }) as ComposioClientLike;
    cached = { key, client };
    return client;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    throw new ComposioConfigError(
      "sdk",
      `The Composio SDK could not be loaded on this runtime (${reason}). Node ${COMPOSIO_MIN_NODE} or newer is required.`,
    );
  }
}

export function sessionIdOf(session: ComposioSessionLike): string {
  return typeof session.sessionId === "string" ? session.sessionId : "";
}
