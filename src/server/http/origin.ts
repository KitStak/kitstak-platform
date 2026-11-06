/**
 * CSRF defence for cookie-authenticated mutations: the request must come from a trusted
 * origin. Pure function, used by both `src/proxy.ts` and `withApi`.
 */

export const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isMutatingMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

export type OriginCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Rules (for mutating methods only):
 * - `Origin` present → must equal the request's own origin or a trusted origin.
 * - `Origin` absent  → allowed only when `Sec-Fetch-Site` is absent or same-origin/none
 *   (non-browser clients such as server-to-server calls send neither header; browsers always
 *   send `Origin` on cross-origin POST/PUT/PATCH/DELETE).
 */
export function checkRequestOrigin(
  method: string,
  headers: Headers,
  requestUrl: string,
  trustedOrigins: readonly string[],
): OriginCheck {
  if (!isMutatingMethod(method)) return { ok: true };

  const allowed = new Set<string>(trustedOrigins);
  try {
    allowed.add(new URL(requestUrl).origin);
  } catch {
    return { ok: false, reason: 'Invalid request URL' };
  }

  const origin = headers.get('origin');
  if (origin && origin !== 'null') {
    return allowed.has(origin) ? { ok: true } : { ok: false, reason: `Untrusted origin ${origin}` };
  }
  if (origin === 'null') return { ok: false, reason: 'Opaque origin' };

  const fetchSite = headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return { ok: false, reason: `Cross-site request (${fetchSite})` };
  }
  return { ok: true };
}
