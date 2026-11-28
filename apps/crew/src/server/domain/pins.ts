/**
 * Kiosk PINs, badges and link tokens (docs/crew/SPEC.md 5.2 and 6.2). PINs are scrypt with a salt,
 * stored as `salt:hash` (the Pulse `verifyKioskPin` format). Badges are a SHA-256 of what the
 * scanner reads. Link tokens are random, shown once, and only their SHA-256 is kept. Pure module
 * (node:crypto only), so unit tests cover it.
 */
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

export const PIN_LENGTHS = [4, 6] as const;
export type PinLength = (typeof PIN_LENGTHS)[number];

/** Easy to guess PINs that are never handed out: one digit repeated, or a straight run. */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true;
  const digits = [...pin].map(Number);
  const up = digits.every((digit, index) => index === 0 || digit === ((digits[index - 1] ?? 0) + 1) % 10);
  const down = digits.every((digit, index) => index === 0 || digit === ((digits[index - 1] ?? 0) + 9) % 10);
  return up || down;
}

/** A random starting PIN of `length` digits that is not easy to guess. */
export function generatePin(length: PinLength = 4): string {
  for (;;) {
    let pin = '';
    for (let i = 0; i < length; i += 1) pin += String(randomInt(0, 10));
    if (!isWeakPin(pin)) return pin;
  }
}

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(pin, salt, 32).toString('hex')}`;
}

export function verifyPin(stored: string | null | undefined, pin: string): boolean {
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(pin, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** What a badge scanner reads, trimmed, as a SHA-256 hex. Null for an empty value. */
export function hashBadge(value: string | null | undefined): string | null {
  const clean = value?.trim();
  if (!clean) return null;
  return createHash('sha256').update(clean).digest('hex');
}

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** A new link token: 32 random bytes, URL safe. The first 6 characters are kept to tell links apart. */
export function newLinkToken(): { readonly token: string; readonly hash: string; readonly prefix: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token), prefix: token.slice(0, 6) };
}
