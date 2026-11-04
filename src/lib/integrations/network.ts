import { lookup } from "node:dns/promises";
import net from "node:net";

/**
 * Server-only network guard for user-supplied API URLs.
 *
 * The OpenAPI importer never fetches a URL. A connection test may fetch a base
 * URL, and that path goes through these checks: http/https only, no credentials
 * in the URL, private and link-local destinations refused, redirects checked
 * again, a hard timeout, and a bounded response body.
 */

export const NETWORK_LIMITS = {
  requestTimeoutMs: 8_000,
  maxResponseBytes: 262_144,
  maxRedirects: 3,
  maxUrlChars: 2_048,
} as const;

export class IntegrationNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationNetworkError";
  }
}

export type HostResolver = (hostname: string) => Promise<string[]>;
export type FetchLike = typeof fetch;

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.google",
  "instance-data",
  "host.docker.internal",
  "kubernetes.default",
  "kubernetes.default.svc",
]);

function normaliseIp(value: string): string {
  return value.trim().toLowerCase().replace(/^\[|\]$/g, "");
}

export function isPrivateAddress(raw: string): boolean {
  const address = normaliseIp(raw);
  const version = net.isIP(address);
  if (version === 4) {
    const octets = address.split(".").map(Number);
    if (octets.length !== 4 || octets.some((item) => Number.isNaN(item))) return true;
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true; // multicast and reserved
    return false;
  }
  if (version === 6) {
    if (address === "::" || address === "::1") return true;
    if (address.startsWith("fc") || address.startsWith("fd")) return true; // unique local
    if (/^fe[89ab]/.test(address)) return true; // link-local
    if (address.startsWith("ff")) return true; // multicast
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true;
}

function hostnameProblem(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "") return "The URL needs a host name.";
  if (BLOCKED_HOSTS.has(host)) return "That is a private or platform-internal host.";
  if (
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa")
  ) {
    return "That is a private or platform-internal host.";
  }
  return null;
}

export function urlShapeProblem(raw: string): string | null {
  const value = raw.trim();
  if (value === "") return "Enter the API base URL.";
  if (value.length > NETWORK_LIMITS.maxUrlChars) return "That URL is too long.";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "Use a complete http or https URL.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Only http and https URLs are allowed.";
  }
  if (url.username !== "" || url.password !== "") {
    return "Do not put a username or password in the URL. Use the credential field.";
  }
  const hostProblem = hostnameProblem(url.hostname);
  if (hostProblem) return hostProblem;
  if (net.isIP(url.hostname) && isPrivateAddress(url.hostname)) {
    return "Private, loopback and metadata addresses are not allowed.";
  }
  const port = url.port === "" ? null : Number(url.port);
  if (port !== null && (port < 80 || (port > 443 && port < 1024) || port > 65535)) {
    return "Use port 80, 443, or an unprivileged port above 1023.";
  }
  return null;
}

async function defaultResolver(hostname: string): Promise<string[]> {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((item) => item.address);
}

export async function assertPublicHttpUrl(
  raw: string,
  options: { resolver?: HostResolver } = {},
): Promise<URL> {
  const problem = urlShapeProblem(raw);
  if (problem) throw new IntegrationNetworkError(problem);

  const url = new URL(raw.trim());
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new IntegrationNetworkError("Private, loopback and metadata addresses are not allowed.");
    }
    return url;
  }

  let addresses: string[];
  try {
    addresses = await (options.resolver ?? defaultResolver)(host);
  } catch {
    throw new IntegrationNetworkError("That host could not be resolved. Nothing was fetched.");
  }
  if (addresses.length === 0) {
    throw new IntegrationNetworkError("That host did not resolve to an address.");
  }
  if (addresses.some((address) => isPrivateAddress(address))) {
    throw new IntegrationNetworkError("That host resolves to a private or internal address.");
  }
  return url;
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new IntegrationNetworkError("The response is too large to inspect safely.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

export type PublicFetchResult = {
  status: number;
  text: string;
  finalUrl: string;
};

export async function fetchPublicUrl(
  raw: string,
  options: {
    fetchImpl?: FetchLike;
    resolver?: HostResolver;
    maxBytes?: number;
    timeoutMs?: number;
    headers?: Record<string, string>;
  } = {},
): Promise<PublicFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBytes = options.maxBytes ?? NETWORK_LIMITS.maxResponseBytes;
  let current = raw.trim();

  for (let redirect = 0; redirect <= NETWORK_LIMITS.maxRedirects; redirect += 1) {
    await assertPublicHttpUrl(current, { resolver: options.resolver });

    let response: Response;
    try {
      response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "User-Agent": "get-to-it-integration-test",
          // Never forward a credential to a redirect target. A same-origin
          // redirect that requires auth will safely fail the connection test.
          ...(redirect === 0 ? options.headers ?? {} : {}),
        },
        signal: AbortSignal.timeout(options.timeoutMs ?? NETWORK_LIMITS.requestTimeoutMs),
      });
    } catch (error) {
      if (error instanceof IntegrationNetworkError) throw error;
      throw new IntegrationNetworkError("The API could not be reached. Nothing was retried.");
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new IntegrationNetworkError("The API returned a redirect without a destination.");
      }
      current = new URL(location, current).toString();
      if (redirect === NETWORK_LIMITS.maxRedirects) {
        throw new IntegrationNetworkError("The API redirected too many times.");
      }
      continue;
    }

    return {
      status: response.status,
      text: await readLimited(response, maxBytes),
      finalUrl: current,
    };
  }

  throw new IntegrationNetworkError("The API redirected too many times.");
}

export async function probePublicApi(input: {
  url: string;
  apiKey?: string | null;
  fetchImpl?: FetchLike;
  resolver?: HostResolver;
}): Promise<{ ok: boolean; status: number | null; message: string }> {
  const headers: Record<string, string> = {};
  if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`;
  try {
    const result = await fetchPublicUrl(input.url, {
      fetchImpl: input.fetchImpl,
      resolver: input.resolver,
      maxBytes: 32_768,
      headers,
    });
    if (result.status >= 200 && result.status < 400) {
      return { ok: true, status: result.status, message: `Reached the API (HTTP ${result.status}).` };
    }
    if (result.status === 401 || result.status === 403) {
      return {
        ok: false,
        status: result.status,
        message: `The API was reached but rejected the credential (HTTP ${result.status}).`,
      };
    }
    return {
      ok: false,
      status: result.status,
      message: `The API was reached but returned HTTP ${result.status}.`,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      message: error instanceof Error ? error.message.slice(0, 300) : "The API test failed safely.",
    };
  }
}
