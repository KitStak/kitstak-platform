/**
 * Content-Security-Policy for every Pulse page (same shape as `apps/crm/src/server/http/csp.ts`).
 * Pure, with no server imports, so `src/proxy.ts` can use it. Scripts run only with the nonce of
 * the request (`strict-dynamic` lets a trusted script load the next chunk). `unsafe-eval` and
 * websockets are for `next dev` only: React needs eval for its debug tools and hot reload needs a
 * socket. `style-src 'unsafe-inline'` covers the inline `style` attributes that Radix, charts
 * and the virtual lists write; it never allows a script.
 *
 * What the app really loads: its own scripts, styles and fonts (Inter is served from this origin
 * by `next/font`), `data:` and `blob:` images, people's avatars (any https address), and fetches
 * to its own origin (`/api/v1`, `/api/auth`). Links to Portal, CRM, WMS and Projects are plain
 * page moves, so they need no entry here.
 */

/** The request header a server component reads the nonce from (see `src/app/layout.tsx`). */
export const NONCE_HEADER = 'x-nonce';

export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export function buildContentSecurityPolicy(nonce: string, isDev: boolean): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'blob:', 'data:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", ...(isDev ? ['ws:', 'wss:'] : [])],
    'media-src': ["'self'", 'blob:'],
    'worker-src': ["'self'", 'blob:'],
    'frame-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    'manifest-src': ["'self'"],
  };
  const parts = Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`);
  if (!isDev) parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}

/**
 * Policy for `/api/*` answers. JSON needs nothing, so nothing is allowed. A route that sends its
 * own page (a report to print) sets its own header, and that one wins.
 */
export const API_CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
