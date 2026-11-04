import {
  INTEGRATION_LIMITS,
  type IntegrationOperation,
} from "@/lib/integrations/registry";

/**
 * OpenAPI 3 JSON import.
 *
 * Only a JSON document is accepted. YAML, Swagger 2, remote references and
 * examples are not fetched or executed. Descriptions are stored for display,
 * never copied into generated code or interpreted as instructions.
 */

export class OpenApiImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenApiImportError";
  }
}

type Json = Record<string, unknown>;

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function safePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (!path.startsWith("/") || path.length > 300) return null;
  if (path.includes("\\") || path.includes("..") || path.includes("//")) return null;
  if (path.split("/").length > 9) return null;
  if (!/^\/[A-Za-z0-9_{}./-]*$/.test(path)) return null;
  return path;
}

function functionName(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value : fallback;
  const cleaned = raw
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  const base = cleaned === "" ? "operation" : /^[0-9]/.test(cleaned) ? `op_${cleaned}` : cleaned;
  return /^[a-z]/.test(base) ? base : base.charAt(0).toLowerCase() + base.slice(1);
}

function typeFromSchema(schema: unknown, depth = 0): string {
  if (depth > 4 || !isObject(schema)) return "unknown";
  const type = schema.type;
  if (type === "string") return "string";
  if (type === "number" || type === "integer") return "number";
  if (type === "boolean") return "boolean";
  if (type === "array") return `Array<${typeFromSchema(schema.items, depth + 1)}>`;
  if (type === "object" || isObject(schema.properties)) {
    const properties = isObject(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required)
      ? new Set(schema.required.filter((item): item is string => typeof item === "string"))
      : new Set<string>();
    const fields: string[] = [];
    for (const [name, child] of Object.entries(properties).slice(0, 30)) {
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) continue;
      fields.push(`${name}${required.has(name) ? "" : "?"}: ${typeFromSchema(child, depth + 1)};`);
    }
    return fields.length > 0 ? `{ ${fields.join(" ")} }` : "Record<string, unknown>";
  }
  if (Array.isArray(type) && type.length > 0) {
    return [...new Set(type.filter((item): item is string => typeof item === "string"))]
      .map((item) => typeFromSchema({ type: item }, depth + 1))
      .join(" | ") || "unknown";
  }
  return "unknown";
}

function schemaForContent(value: unknown): string {
  if (!isObject(value)) return "unknown";
  const content = value.content;
  if (!isObject(content)) return "unknown";
  const json = content["application/json"];
  if (!isObject(json)) return "unknown";
  return typeFromSchema(json.schema);
}

function operationResponses(value: unknown): string {
  if (!isObject(value)) return "unknown";
  for (const key of ["200", "201", "202", "204", "default"]) {
    const response = value[key];
    if (!isObject(response)) continue;
    const type = schemaForContent(response);
    if (type !== "unknown") return type;
  }
  return "unknown";
}

function pathParameters(value: unknown, path: string): string[] {
  const names = new Set<string>();
  for (const match of path.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) names.add(match[1]);
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!isObject(item) || item.in !== "path") continue;
      if (typeof item.name === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(item.name)) {
        names.add(item.name);
      }
    }
  }
  return [...names].slice(0, 12);
}

export type ParsedOpenApi = {
  title: string;
  version: string;
  baseUrl: string;
  operations: IntegrationOperation[];
};

export function parseOpenApiDocument(text: string): ParsedOpenApi {
  if (typeof text !== "string" || text.trim() === "") {
    throw new OpenApiImportError("Paste or upload a JSON OpenAPI document.");
  }
  if (Buffer.byteLength(text, "utf8") > INTEGRATION_LIMITS.maxSpecBytes) {
    throw new OpenApiImportError(
      `The specification is larger than the ${INTEGRATION_LIMITS.maxSpecBytes} byte limit.`,
    );
  }

  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    throw new OpenApiImportError("That file is not valid JSON. This build accepts OpenAPI 3 JSON, not YAML.");
  }
  if (!isObject(document)) throw new OpenApiImportError("The OpenAPI document must be a JSON object.");

  const version = typeof document.openapi === "string" ? document.openapi : "";
  if (!/^3\.\d+\.\d+$/.test(version)) {
    throw new OpenApiImportError("Only OpenAPI 3.x documents are supported.");
  }

  const paths = document.paths;
  if (!isObject(paths)) throw new OpenApiImportError("The document has no paths object.");
  if (Object.keys(paths).length > INTEGRATION_LIMITS.maxPaths) {
    throw new OpenApiImportError(`A document can contain at most ${INTEGRATION_LIMITS.maxPaths} paths.`);
  }

  const title = cleanText(isObject(document.info) ? document.info.title : "", 120) || "Imported API";
  const servers = Array.isArray(document.servers) ? document.servers : [];
  const server = servers.find((item): item is Json => isObject(item) && typeof item.url === "string");
  const baseUrl = server && typeof server.url === "string" ? server.url.trim().slice(0, 2_000) : "";

  const operations: IntegrationOperation[] = [];
  const used = new Set<string>();

  for (const [rawPath, pathItem] of Object.entries(paths)) {
    if (!isObject(pathItem)) continue;
    const path = safePath(rawPath);
    if (!path) continue;

    for (const method of METHODS) {
      const rawOperation = pathItem[method];
      if (!isObject(rawOperation)) continue;
      if (operations.length >= INTEGRATION_LIMITS.maxOperations) {
        throw new OpenApiImportError(
          `A document can contain at most ${INTEGRATION_LIMITS.maxOperations} operations.`,
        );
      }

      const fallback = `${method}_${path.replace(/[^A-Za-z0-9]+/g, "_")}`;
      let operationId = functionName(rawOperation.operationId, fallback);
      let suffix = 2;
      while (used.has(operationId)) {
        operationId = `${functionName(rawOperation.operationId, fallback)}_${suffix}`;
        suffix += 1;
      }
      used.add(operationId);

      operations.push({
        key: `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase() as IntegrationOperation["method"],
        path,
        operation_id: operationId,
        summary: cleanText(rawOperation.summary, INTEGRATION_LIMITS.maxOperationSummaryChars),
        description: cleanText(
          rawOperation.description,
          INTEGRATION_LIMITS.maxOperationDescriptionChars,
        ),
        path_params: pathParameters(rawOperation.parameters, path),
        request_type: schemaForContent(rawOperation.requestBody),
        response_type: operationResponses(rawOperation.responses),
      });
    }
  }

  if (operations.length === 0) {
    throw new OpenApiImportError("No supported operations were found. Add at least one GET, POST, PUT, PATCH or DELETE operation.");
  }

  return { title, version, baseUrl, operations };
}

function pascal(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("") || "Operation";
}

function operationInputType(operation: IntegrationOperation): string {
  const params = operation.path_params
    .map((name) => `${JSON.stringify(name)}: string;`)
    .join(" ");
  const body = ["post", "put", "patch"].includes(operation.method.toLowerCase())
    ? `body?: ${operation.request_type};`
    : "";
  return params || body ? `{ ${params} ${body} }` : "Record<string, never>";
}

/**
 * Build a server-side TypeScript file from selected operations. Descriptions and
 * examples never enter this output. Values come from environment variables, not
 * from the credential column.
 */
export function generateOpenApiClient(input: {
  name: string;
  slug: string;
  envPrefix: string;
  baseUrl: string;
  hasApiKey: boolean;
  operations: IntegrationOperation[];
}): string {
  const selected = input.operations;
  if (selected.length === 0) {
    throw new OpenApiImportError("Select at least one operation before generating code.");
  }

  const safeLabel = input.name.replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 80) || "Integration";
  const blocks: string[] = [];
  for (const operation of selected) {
    const typeName = `${pascal(operation.operation_id)}Response`;
    const inputType = `${pascal(operation.operation_id)}Input`;
    const pathExpression = operation.path.replace(
      /\{([A-Za-z_][A-Za-z0-9_]*)\}/g,
      (_, name: string) => `\${encodeURIComponent(input[${JSON.stringify(name)}])}`,
    );
    const hasBody = ["POST", "PUT", "PATCH"].includes(operation.method);
    const method = operation.method;

    blocks.push(`export type ${typeName} = ${operation.response_type};
export type ${inputType} = ${operationInputType(operation)};

export async function ${operation.operation_id}(input: ${inputType}): Promise<${typeName}> {
  const baseUrl = process.env.${input.envPrefix}_BASE_URL;
  if (!baseUrl) throw new Error("${input.envPrefix}_BASE_URL is not configured.");
  const apiKey = process.env.${input.envPrefix}_API_KEY;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers.Authorization = \`Bearer \${apiKey}\`;
  ${hasBody ? 'if (input.body !== undefined) headers["Content-Type"] = "application/json";' : ""}
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const url = new URL(base + \`${pathExpression}\`);
  const response = await fetch(url, {
    method: "${method}",
    headers,
    ${hasBody ? "body: input.body === undefined ? undefined : JSON.stringify(input.body)," : ""}
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(\`${safeLabel} ${method} ${operation.path} failed with HTTP \${response.status}.\`);
  }
  ${method === "HEAD" || method === "OPTIONS" ? "return undefined as unknown as " + typeName + ";" : `return (await response.json()) as ${typeName};`}
}`);
  }

  return `// Generated by GET TO IT Integration Studio.
// Server-side wrappers. Do not import this file into client components.
// The API description and examples are untrusted documentation and are not
// executed or copied into this file. Credentials come from environment names.
${blocks.join("\n\n")}
`;
}
