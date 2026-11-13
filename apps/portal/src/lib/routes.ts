/**
 * Characters that never belong in a redirect path: control characters and whitespace (browsers
 * strip tabs and newlines when parsing a URL, so `/<tab>/evil.example` becomes `//evil.example`)
 * and backslashes (treated as forward slashes).
 */
const UNSAFE_PATH_CHARACTERS = /[\u0000-\u0020\u007f\\]/;

/** Only allow same-origin relative redirects (prevents open redirects via ?next=). */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next) return fallback;
  if (UNSAFE_PATH_CHARACTERS.test(next)) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  if (/^\/(login|signup)(\/|\?|$)/.test(next)) return fallback;
  return next;
}

/**
 * Where to send someone after a step that another KitStak app may have sent them to (the CRM
 * redirects here for a required password change). Accepts a portal path, or an absolute URL
 * whose origin is exactly one of `allowedOrigins`; anything else becomes `fallback`, so the
 * portal can never be used to bounce a signed-in user to an outside site.
 */
export function safeReturnUrl(
  next: string | null | undefined,
  allowedOrigins: readonly string[],
  fallback = '/',
): string {
  if (!next) return fallback;
  if (next.startsWith('/')) {
    const path = safeNextPath(next, fallback);
    return /^\/change-password(\/|\?|$)/.test(path) ? fallback : path;
  }
  let url: URL;
  try {
    url = new URL(next);
  } catch {
    return fallback;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return fallback;
  if (url.username !== '' || url.password !== '') return fallback;
  const allowed = allowedOrigins.some((origin) => {
    try {
      return new URL(origin).origin === url.origin;
    } catch {
      return false;
    }
  });
  return allowed ? url.toString() : fallback;
}
