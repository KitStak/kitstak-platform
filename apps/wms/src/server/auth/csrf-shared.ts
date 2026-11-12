/**
 * CSRF double-submit contract — PURE module, safe to import from client code.
 *
 * CLIENT CONTRACT (implemented by F4 `src/lib/api-client.ts` → `apiFetch`):
 *   1. For every request whose method is not GET/HEAD/OPTIONS, send header
 *      `x-csrf-token: <value of the ks_csrf cookie>` (use `readCsrfTokenFromCookie(document.cookie)`).
 *   2. If the cookie is missing, call `GET /api/auth/csrf` first (it sets the cookie and
 *      returns `{ success: true, data: { token } }`), then send that token.
 *   3. If a mutation fails with HTTP 403 and envelope `code === "CSRF"`, refresh the token once
 *      via `GET /api/auth/csrf` and retry the request once.
 *   4. Exempt: `POST /api/auth/login`, `/api/auth/forgot`, `/api/auth/reset` (no session yet;
 *      origin-checked instead). The login response also sets a fresh `ks_csrf` cookie and
 *      returns `data.csrfToken`.
 * The cookie is SameSite=Strict, not httpOnly (so the page can read it), Secure in production.
 * The proxy issues the cookie on page navigations when it is absent.
 */

export const CSRF_COOKIE = 'ks_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const CSRF_SAFE_METHODS: readonly string[] = ['GET', 'HEAD', 'OPTIONS'];
/** 32 random bytes, base64url-encoded => 43 chars. */
export const CSRF_TOKEN_BYTES = 32;
export const CSRF_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
/** Cookie lifetime; the token is not secret-bound to the session, so it can outlive one. */
export const CSRF_MAX_AGE_SECONDS = 12 * 60 * 60;

export function isSafeMethod(method: string): boolean {
  return CSRF_SAFE_METHODS.includes(method.toUpperCase());
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** New random token (Web Crypto: works in Node, the proxy and the browser). */
export function generateCsrfToken(): string {
  const bytes = new Uint8Array(CSRF_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export function isWellFormedCsrfToken(value: string | null | undefined): value is string {
  return typeof value === 'string' && CSRF_TOKEN_RE.test(value);
}

/** Extracts the `ks_csrf` value from a `document.cookie`-style string. */
export function readCsrfTokenFromCookie(cookieString: string): string | null {
  for (const part of cookieString.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === CSRF_COOKIE) {
      const value = decodeURIComponent(part.slice(index + 1).trim());
      return isWellFormedCsrfToken(value) ? value : null;
    }
  }
  return null;
}

/** Constant-time string comparison (no early exit on the first differing char). */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
