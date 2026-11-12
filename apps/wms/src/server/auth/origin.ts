/**
 * Same-origin enforcement for state-changing API requests (blueprint §1.4).
 *
 * The double-submit CSRF token (`ks_csrf` + `x-csrf-token`) is retired: Better Auth's
 * own origin/trusted-origins checks protect /api/auth/*, and `defineRoute()` keeps this
 * origin check for every other mutation. Cookies are SameSite=Lax, so the origin check
 * is the backstop for the cross-site POSTs Lax still allows (top-level form posts).
 */
export type OriginFailureReason = 'cross_origin';

export type OriginCheck = { readonly ok: true } | { readonly ok: false; readonly reason: OriginFailureReason };

/** Safe methods never change state and skip the origin requirement. */
export function isSafeMethod(method: string): boolean {
  const upper = method.toUpperCase();
  return upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS';
}

function trustProxy(): boolean {
  return process.env.TRUST_PROXY === '1';
}

/** The host the client addressed (honours x-forwarded-host only when TRUST_PROXY=1). */
export function requestHost(request: Request): string | null {
  const forwarded = trustProxy() ? request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() : undefined;
  return forwarded || request.headers.get('host') || safeUrlHost(request.url);
}

function safeUrlHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Rejects requests a browser marks as cross-site. Requests without Origin/Sec-Fetch-Site
 * (curl, server-to-server) pass this check — they cannot carry a victim's cookies.
 *
 * Accepted residual (auth review 2026-11-11, L2): this is a CSRF control only. It is no
 * barrier to a non-browser attacker, so endpoints behind it must still carry their own
 * authn/rate limits, and header-derived addresses (`auditIp`) stay data, never trust.
 */
export function isSameOriginRequest(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin || origin === 'null') return origin !== 'null';
  const host = requestHost(request);
  return host !== null && safeUrlHost(origin) === host;
}

/** Full check for state-changing requests. Safe methods always pass. */
export function verifyOrigin(request: Request): OriginCheck {
  if (isSafeMethod(request.method)) return { ok: true };
  return isSameOriginRequest(request) ? { ok: true } : { ok: false, reason: 'cross_origin' };
}
