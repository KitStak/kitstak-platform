/**
 * TOTP (RFC 6238 / RFC 4226, HMAC-SHA1, 6 digits, 30 s step) for multi-factor sign-in. PURE
 * apart from `crypto` — no DB access. Foundation wiring (a `users.mfa_secret` column, the
 * login second step and Company Settings › Security "Require MFA") is requested in
 * docs/requests/admin-settings.md REQ-R5-3; this module is the verified core it plugs into.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("Invalid base32 secret");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Uint8Array.from(out);
}

/** 160-bit random secret, base32 (what authenticator apps expect). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

/** HOTP value for a counter (RFC 4226 dynamic truncation). */
export function hotp(secret: Uint8Array, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(msg).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const code = (((mac[offset] ?? 0) & 0x7f) << 24) | ((mac[offset + 1] ?? 0) << 16) | ((mac[offset + 2] ?? 0) << 8) | (mac[offset + 3] ?? 0);
  return String(code % 10 ** digits).padStart(digits, "0");
}

export function totp(secretBase32: string, at: Date = new Date(), digits = TOTP_DIGITS): string {
  return hotp(base32Decode(secretBase32), Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS), digits);
}

/**
 * Constant-time check of a 6-digit code within ±`window` steps (clock drift). Returns the
 * matched counter so callers can reject replay of the same step, or null.
 */
export function verifyTotp(secretBase32: string, code: string, at: Date = new Date(), window = 1): number | null {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;
  const secret = base32Decode(secretBase32);
  const counter = Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS);
  let matched: number | null = null;
  for (let delta = -window; delta <= window; delta += 1) {
    const expected = Buffer.from(hotp(secret, counter + delta));
    if (timingSafeEqual(expected, Buffer.from(normalized)) && matched === null) matched = counter + delta;
  }
  return matched;
}

/** `otpauth://` URI for the enrollment QR code. */
export function otpauthUri(issuer: string, accountEmail: string, secretBase32: string): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}
