import crypto from "node:crypto";
import { DeploymentError } from "@/lib/deployments";

/**
 * Server-only secret vault for provider tokens and environment values.
 *
 * AES-256-GCM with a project/provider (or project/environment/name) associated
 * data value. Ciphertext is safe to store in Postgres; the key never leaves the
 * server environment. There is no fallback key and no plaintext logging.
 */

const PREFIX = "v1";

export function decodeVaultKey(raw: string | undefined = process.env.DEPLOYMENT_VAULT_KEY): Buffer {
  if (!raw || raw.trim() === "") {
    throw new DeploymentError(
      "The deployment vault is not configured. Set DEPLOYMENT_VAULT_KEY to a server-only 32-byte base64 or 64-character hex value.",
    );
  }
  const value = raw.trim();
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(value)) key = Buffer.from(value, "hex");
  else key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new DeploymentError("DEPLOYMENT_VAULT_KEY must decode to exactly 32 bytes.");
  }
  return key;
}

export function vaultConfigured(): boolean {
  try {
    decodeVaultKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecretWithKey(plaintext: string, key: Buffer, associatedData: string): string {
  if (plaintext === "") throw new DeploymentError("A secret cannot be empty.");
  if (key.length !== 32) throw new DeploymentError("The vault key must be 32 bytes.");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(associatedData, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecretWithKey(payload: string, key: Buffer, associatedData: string): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) throw new DeploymentError("Stored secret format is invalid.");
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ciphertext = Buffer.from(parts[3], "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw new Error("bad lengths");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(associatedData, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new DeploymentError("Stored secret could not be decrypted.");
  }
}

export function encryptSecret(plaintext: string, associatedData: string): string {
  return encryptSecretWithKey(plaintext, decodeVaultKey(), associatedData);
}

export function decryptSecret(payload: string, associatedData: string): string {
  return decryptSecretWithKey(payload, decodeVaultKey(), associatedData);
}

export function connectionAad(projectId: string, provider: string): string {
  return `connection:${projectId}:${provider}`;
}

export function environmentAad(projectId: string, environment: string, name: string): string {
  return `environment:${projectId}:${environment}:${name}`;
}

export function supabaseAccountAad(userId: string): string {
  return `supabase-account:${userId}`;
}

export function supabaseOAuthStateAad(stateHash: string): string {
  return `supabase-oauth-state:${stateHash}`;
}
