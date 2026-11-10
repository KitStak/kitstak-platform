/**
 * Integration credential vault: AES-256-GCM, keyed by `INTEGRATION_KEY` (32-byte hex/base64)
 * or, when absent, an HKDF of `SESSION_SECRET`. Outside production a fixed dev key keeps local
 * data readable. Ciphertext format: `v1.<iv b64url>.<tag b64url>.<data b64url>`.
 * Plaintext never leaves the server; the UI only ever sees `last4`.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const DEV_KEY = Buffer.from("6b697473746b732d6465762d696e746567726174696f6e2d6b65792d30303031", "hex");

function resolveKey(): Buffer {
  const raw = process.env.INTEGRATION_KEY?.trim();
  if (raw) {
    const buf = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (buf.length !== 32) throw new Error("INTEGRATION_KEY must be 32 bytes (64 hex characters or base64)");
    return buf;
  }
  const secret = process.env.SESSION_SECRET?.trim();
  if (secret) return Buffer.from(hkdfSync("sha256", secret, "kitstaks", "integration-credentials", 32));
  if (process.env.NODE_ENV === "production") throw new Error("INTEGRATION_KEY or SESSION_SECRET is required to store integration credentials");
  return DEV_KEY;
}

export type Credentials = Readonly<Record<string, string>>;

export function encryptCredentials(value: Credentials): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", resolveKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptCredentials(token: string | null | undefined): Credentials | null {
  if (!token) return null;
  const [version, iv, tag, data] = token.split(".");
  if (version !== "v1" || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", resolveKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const text = Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return null;
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([, v]) => typeof v === "string")) as Credentials;
  } catch {
    return null;
  }
}

/** Last 4 characters of each secret field, for `••••1234` display. */
export function credentialHints(value: Credentials | null): Readonly<Record<string, string>> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v.length > 0).map(([k, v]) => [k, v.slice(-4)]));
}

/** Merges an edit: blank fields keep the stored secret. */
export function mergeCredentials(stored: Credentials | null, edit: Readonly<Record<string, string | null | undefined>>): Credentials {
  const out: Record<string, string> = { ...(stored ?? {}) };
  for (const [k, v] of Object.entries(edit)) if (typeof v === "string" && v.trim()) out[k] = v.trim();
  return out;
}
