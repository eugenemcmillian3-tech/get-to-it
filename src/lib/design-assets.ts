import { createHash } from "node:crypto";
import { DESIGN_LIMITS } from "@/lib/design";

/**
 * Uploaded design references are treated as potentially active content. Only
 * raster PNG, JPEG and WebP are accepted; SVG, HTML and any script-capable file
 * are refused. Nothing is executed or fetched from a URL.
 */

export const DESIGN_ASSET_KINDS = [
  { id: "screenshot" as const, label: "Screenshot" },
  { id: "wireframe" as const, label: "Wireframe" },
  { id: "asset" as const, label: "Permitted design asset" },
];

export type DesignAssetKind = (typeof DESIGN_ASSET_KINDS)[number]["id"];
export type AllowedAssetMime = "image/png" | "image/jpeg" | "image/webp";

export class DesignAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DesignAssetError";
  }
}

export type AssetMeta = {
  name: string;
  mime: AllowedAssetMime;
  bytes: number;
  sha256: string;
  content_base64: string;
  attribution: string;
  license_note: string;
};

function clean(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function safeAssetName(value: string): string | null {
  const name = clean(value, DESIGN_LIMITS.maxAssetNameChars);
  if (name.length === 0) return null;
  return name;
}

export function detectRasterMime(bytes: Uint8Array): AllowedAssetMime | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export function activeContentProblem(bytes: Uint8Array, mime: string): string | null {
  const lower = mime.toLowerCase();
  if (lower.includes("svg") || lower.includes("html") || lower.includes("javascript")) {
    return "SVG, HTML and script-capable files are refused because they can be active content.";
  }
  const beginning = new TextDecoder().decode(bytes.slice(0, 160)).trim().toLowerCase();
  if (beginning.startsWith("<svg") || beginning.startsWith("<html") || beginning.startsWith("<!doctype")) {
    return "That file contains active markup. Upload a PNG, JPEG or WebP screenshot instead.";
  }
  return null;
}

export function validateAssetBytes(input: {
  name: string;
  declaredType: string;
  bytes: Uint8Array;
  attribution: string;
  licenseNote: string;
  permissionConfirmed: boolean;
}): AssetMeta {
  if (!input.permissionConfirmed) {
    throw new DesignAssetError("Confirm that you have permission to use this asset.");
  }
  const name = safeAssetName(input.name);
  if (!name) throw new DesignAssetError("Give the asset a short file name.");
  if (input.bytes.byteLength === 0) throw new DesignAssetError("That file is empty.");
  if (input.bytes.byteLength > DESIGN_LIMITS.maxAssetBytes) {
    throw new DesignAssetError(`Assets are limited to ${DESIGN_LIMITS.maxAssetBytes.toLocaleString()} bytes.`);
  }
  const active = activeContentProblem(input.bytes, input.declaredType);
  if (active) throw new DesignAssetError(active);
  const detected = detectRasterMime(input.bytes);
  if (!detected) {
    throw new DesignAssetError("Only genuine PNG, JPEG or WebP images are accepted.");
  }
  if (input.declaredType && input.declaredType !== detected) {
    throw new DesignAssetError("The file extension or declared type does not match its image contents.");
  }
  const attribution = clean(input.attribution, DESIGN_LIMITS.maxAttributionChars);
  const licenseNote = clean(input.licenseNote, DESIGN_LIMITS.maxAttributionChars);
  return {
    name,
    mime: detected,
    bytes: input.bytes.byteLength,
    sha256: createHash("sha256").update(input.bytes).digest("hex"),
    content_base64: Buffer.from(input.bytes).toString("base64"),
    attribution,
    license_note: licenseNote,
  };
}

export function assetDataUrl(mime: string, base64: string): string | null {
  if (mime !== "image/png" && mime !== "image/jpeg" && mime !== "image/webp") return null;
  return `data:${mime};base64,${base64}`;
}
