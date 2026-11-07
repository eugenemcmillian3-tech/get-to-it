import { inflateRawSync } from "node:zlib";

import { crc32 } from "@/lib/zip";
import {
  AppImportError,
  IMPORT_LIMITS,
} from "./app-import-constants";

export type ZipEntry = {
  path: string;
  /** UTF-8 text, or null when the entry is binary / not valid UTF-8. */
  content: string | null;
  bytes: number;
};

export type ZipReadResult = {
  entries: ZipEntry[];
  expandedBytes: number;
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_EOCD_SEARCH = 65_536;

function fail(message: string): never {
  throw new AppImportError(message);
}

function u16(buffer: Buffer, offset: number): number {
  return buffer.readUInt16LE(offset);
}

function u32(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset);
}

/**
 * Paths in an archive are untrusted. This deliberately permits secret-looking
 * paths (they are excluded later) but rejects anything that could escape the
 * extraction root, including Windows separators, absolute paths and `..`.
 */
export function isSafeArchivePath(raw: string): boolean {
  if (raw.length < 1 || raw.length > IMPORT_LIMITS.maxPathChars) return false;
  if (raw.includes("\\") || raw.includes("\u0000")) return false;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return false;
  if (raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) return false;

  const parts = raw.split("/");
  if (parts.length > IMPORT_LIMITS.maxPathDepth) return false;
  for (const part of parts) {
    if (!part || part === "." || part === "..") return false;
    if (part.length > 64) return false;
    if (part.endsWith(".")) return false;
  }
  return true;
}

function decodeName(bytes: Buffer, flags: number): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Bit 11 says UTF-8, but old ZIP writers leave it unset. Refusing invalid
    // encodings is safer than guessing a legacy code page for source paths.
    if ((flags & 0x0800) !== 0) fail("The archive contains a file name that is not valid UTF-8.");
    try {
      return new TextDecoder("utf-8").decode(bytes);
    } catch {
      fail("The archive contains an unreadable file name.");
    }
  }
}

function decodeContent(bytes: Buffer): string | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.includes("\u0000") ? null : text;
  } catch {
    return null;
  }
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const start = Math.max(0, buffer.length - MAX_EOCD_SEARCH);
  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (u32(buffer, offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

/**
 * Minimal ZIP reader. It supports stored and deflated entries, verifies CRCs,
 * rejects ZIP64/encrypted/multi-disk archives, and refuses symbolic links.
 * It never extracts to disk and never runs anything.
 */
export function extractZip(
  input: Uint8Array,
  limits: { maxEntries?: number; maxExpandedBytes?: number } = {},
): ZipReadResult {
  const buffer = Buffer.from(input);
  const maxEntries = limits.maxEntries ?? IMPORT_LIMITS.maxEntries;
  const maxExpandedBytes = limits.maxExpandedBytes ?? IMPORT_LIMITS.maxExpandedBytes;

  if (buffer.length < 22) fail("That archive is not a valid ZIP file.");
  if (buffer.length > IMPORT_LIMITS.maxArchiveBytes) {
    fail(`The archive is larger than ${Math.floor(IMPORT_LIMITS.maxArchiveBytes / 1024 / 1024)} MB.`);
  }

  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) fail("That file is not a readable ZIP archive.");

  const diskNumber = u16(buffer, eocd + 4);
  const centralDisk = u16(buffer, eocd + 6);
  const diskEntries = u16(buffer, eocd + 8);
  const totalEntries = u16(buffer, eocd + 10);
  const centralSize = u32(buffer, eocd + 12);
  const centralOffset = u32(buffer, eocd + 16);

  if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
    fail("Multi-disk ZIP archives are not supported.");
  }
  if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    fail("ZIP64 archives are not supported; re-create the archive without ZIP64.");
  }
  if (totalEntries > maxEntries) {
    fail(`The archive contains more than ${maxEntries} entries.`);
  }
  if (centralOffset + centralSize > buffer.length) {
    fail("The ZIP central directory is truncated.");
  }

  let cursor = centralOffset;
  let expandedBytes = 0;
  const entries: ZipEntry[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > buffer.length || u32(buffer, cursor) !== CENTRAL_SIGNATURE) {
      fail("The ZIP central directory is damaged.");
    }

    const flags = u16(buffer, cursor + 8);
    const method = u16(buffer, cursor + 10);
    const expectedCrc = u32(buffer, cursor + 16);
    const compressedSize = u32(buffer, cursor + 20);
    const uncompressedSize = u32(buffer, cursor + 24);
    const nameLength = u16(buffer, cursor + 28);
    const extraLength = u16(buffer, cursor + 30);
    const commentLength = u16(buffer, cursor + 32);
    const externalAttributes = u32(buffer, cursor + 38);
    const localOffset = u32(buffer, cursor + 42);
    const next = cursor + 46 + nameLength + extraLength + commentLength;

    if (next > buffer.length) fail("The ZIP central directory is truncated.");
    if ((flags & 0x0001) !== 0) fail("Encrypted ZIP entries are not supported.");
    if (method !== 0 && method !== 8) fail("That archive uses an unsupported ZIP compression method.");
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      fail("ZIP64 archives are not supported.");
    }

    const rawName = decodeName(buffer.subarray(cursor + 46, cursor + 46 + nameLength), flags);
    const isDirectory = rawName.endsWith("/");
    const path = isDirectory ? rawName.slice(0, -1) : rawName;
    if (!path || !isSafeArchivePath(path)) {
      fail(`The archive contains an unsafe path: ${path.slice(0, 80) || "(empty)"}.`);
    }

    const mode = (externalAttributes >>> 16) & 0xffff;
    if ((mode & 0xf000) === 0xa000) {
      fail(`The archive contains a symbolic link, which is not allowed: ${path.slice(0, 80)}.`);
    }

    if (!isDirectory) {
      if (seen.has(path)) fail(`The archive contains a duplicate path: ${path.slice(0, 80)}.`);
      seen.add(path);
      expandedBytes += uncompressedSize;
      if (expandedBytes > maxExpandedBytes) {
        fail(`The archive expands beyond ${Math.floor(maxExpandedBytes / 1024 / 1024)} MB.`);
      }

      if (localOffset + 30 > buffer.length || u32(buffer, localOffset) !== LOCAL_SIGNATURE) {
        fail(`The archive entry is damaged: ${path.slice(0, 80)}.`);
      }
      const localNameLength = u16(buffer, localOffset + 26);
      const localExtraLength = u16(buffer, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > buffer.length) fail(`The archive entry is truncated: ${path.slice(0, 80)}.`);

      let content: Buffer;
      try {
        const compressed = buffer.subarray(dataStart, dataEnd);
        content = method === 0
          ? Buffer.from(compressed)
          : inflateRawSync(compressed, { maxOutputLength: Math.max(1, maxExpandedBytes) });
      } catch {
        fail(`The archive entry could not be decompressed: ${path.slice(0, 80)}.`);
      }

      if (content.length !== uncompressedSize) {
        fail(`The archive entry has an unexpected size: ${path.slice(0, 80)}.`);
      }
      if ((crc32(content) >>> 0) !== (expectedCrc >>> 0)) {
        fail(`The archive entry failed its integrity check: ${path.slice(0, 80)}.`);
      }

      entries.push({
        path,
        content: decodeContent(content),
        bytes: content.length,
      });
    }

    cursor = next;
  }

  return { entries, expandedBytes };
}
