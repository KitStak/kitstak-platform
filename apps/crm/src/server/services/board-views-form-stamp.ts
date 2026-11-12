/**
 * Signed render stamp for public forms (time trap). The GET hands out `<issuedAtMs>.<hmac>`
 * bound to the form token; the POST must echo it so the server — not the client — measures how
 * long the respondent took. Pure (secret is injected) so it is unit-testable without a DB.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

const STAMP_RE = /^(\d{10,16})\.([A-Za-z0-9_-]{20,100})$/;

function signature(secret: string, token: string, issuedAt: number): string {
  return createHmac('sha256', secret).update(`public-form:${token}:${issuedAt}`).digest('base64url');
}

export function issueRenderStamp(secret: string, token: string, now: number): string {
  return `${now}.${signature(secret, token, now)}`;
}

/** Elapsed ms since a valid stamp was issued for `token`; null if absent, malformed or forged. */
export function verifyRenderStamp(secret: string, token: string, stamp: string | undefined, now: number): number | null {
  if (!stamp) return null;
  const match = STAMP_RE.exec(stamp);
  if (!match) return null;
  const issuedAt = Number(match[1]);
  const expected = Buffer.from(signature(secret, token, issuedAt));
  const given = Buffer.from(match[2] ?? '');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return now - issuedAt;
}
