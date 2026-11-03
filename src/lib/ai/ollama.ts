/**
 * Server-only Ollama cloud client.
 *
 * The API key must never reach the browser: only server components, server
 * actions and scripts import this module. It deliberately has no imports so it
 * can also be loaded by the plain Node check script.
 */

export const OLLAMA_HOST = "https://ollama.com";

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

/**
 * Token counts as the provider reports them, or null when it reports none.
 * These are usage facts, not money: no price is applied in this layer.
 */
export type AiTokens = {
  input: number | null;
  output: number | null;
};

export type OllamaFailure =
  | "missing-key"
  | "auth"
  | "payment"
  | "not-found"
  | "rate-limit"
  | "server"
  | "network"
  | "timeout"
  | "unexpected";

export class OllamaError extends Error {
  code: OllamaFailure;
  status: number | null;

  constructor(code: OllamaFailure, message: string, status: number | null = null) {
    super(message);
    this.name = "OllamaError";
    this.code = code;
    this.status = status;
  }
}

/** Reads the key at call time, so a missing key never breaks the build. */
export function getOllamaKey(): string | null {
  const key = process.env.OLLAMA_API_KEY;
  if (!key) return null;
  const trimmed = key.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function hasOllamaKey(): boolean {
  return getOllamaKey() !== null;
}

export type ChatOptions = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Ask Ollama for a JSON reply (structured output). */
  format?: "json";
};

/**
 * Sends one non-streaming chat request to https://ollama.com/api/chat with the
 * key in an Authorization: Bearer header and returns the reply text.
 */
export async function chatWithOllama(
  options: ChatOptions,
): Promise<{ content: string; model: string; tokens: AiTokens }> {
  const key = getOllamaKey();
  if (!key) {
    throw new OllamaError(
      "missing-key",
      "OLLAMA_API_KEY is not set, so GET TO IT can't call Ollama.",
    );
  }

  const timeout = AbortSignal.timeout(options.timeoutMs ?? 45_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;

  let response: Response;
  try {
    response = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        stream: false,
        ...(options.format ? { format: options.format } : {}),
        ...(options.temperature === undefined
          ? {}
          : { options: { temperature: options.temperature } }),
      }),
      signal,
    });
  } catch (error) {
    if (isTimeout(error)) {
      throw new OllamaError(
        "timeout",
        "Ollama took too long to answer, so the request was stopped.",
      );
    }
    const reason = error instanceof Error ? error.message : "unknown error";
    throw new OllamaError("network", `Could not reach Ollama: ${reason}`);
  }

  if (!response.ok) {
    throw new OllamaError(
      failureForStatus(response.status),
      `Ollama returned ${response.status} ${response.statusText}`.trim(),
      response.status,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new OllamaError("unexpected", "Ollama sent a reply we couldn't read.");
  }

  const record = payload as {
    model?: unknown;
    message?: { content?: unknown };
    response?: unknown;
    error?: unknown;
    prompt_eval_count?: unknown;
    eval_count?: unknown;
  };

  if (typeof record.error === "string" && record.error.length > 0) {
    throw new OllamaError("unexpected", record.error);
  }

  const content =
    typeof record.message?.content === "string"
      ? record.message.content
      : typeof record.response === "string"
        ? record.response
        : null;

  if (!content || content.trim().length === 0) {
    throw new OllamaError("unexpected", "Ollama sent an empty reply.");
  }

  return {
    content: content.trim(),
    model: typeof record.model === "string" ? record.model : options.model,
    tokens: {
      input: tokenCount(record.prompt_eval_count),
      output: tokenCount(record.eval_count),
    },
  };
}

function tokenCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.trunc(value);
}

function isTimeout(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === "TimeoutError" || name === "AbortError";
}

function failureForStatus(status: number): OllamaFailure {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "payment";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limit";
  return "server";
}

/** Short, user-facing explanation for a failed call. Never includes the key. */
export function ollamaErrorMessage(error: unknown): string {
  if (!(error instanceof OllamaError)) {
    return "We couldn't reach Ollama. Try again in a moment.";
  }

  switch (error.code) {
    case "missing-key":
      return "Ollama isn't connected yet. Add OLLAMA_API_KEY to .env.local and restart the server.";
    case "auth":
      return "Ollama rejected the API key. Check OLLAMA_API_KEY in .env.local.";
    case "payment":
      return "That model isn't included in your Ollama plan. Pick a different model.";
    case "not-found":
      return "Ollama doesn't offer that model on this account. Pick a different model.";
    case "rate-limit":
      return "You've reached an Ollama usage limit. Try again later.";
    case "server":
      return "Ollama had a problem answering. Try again in a moment.";
    case "network":
      return "We couldn't reach Ollama. Check your connection and try again.";
    case "timeout":
      return "That request took too long, so we stopped it. Nothing was changed — try again, or ask for a smaller plan.";
    default:
      return "Ollama sent a reply we couldn't use. Try again.";
  }
}
