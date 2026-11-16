/**
 * HTTP status gates for document requests.
 *
 * With cacheComponents the (app) shell streams before a page can call `notFound()`, so the
 * response is already committed to 200. The proxy runs before rendering, so it applies the
 * real status here (BUILD_PLAN 0.3: 403 page for unauthorized routes, 404 for missing records)
 * while the page still renders its own in-shell 403/404 view.
 *
 * Only full document loads are gated. RSC (client-side) requests keep 200, because the
 * router treats a non-OK RSC response as a hard navigation.
 */

export const FORBIDDEN_PATH = '/forbidden';

/** Path segments under a record route that are pages, not record ids. */
const RESERVED_SEGMENTS: ReadonlySet<string> = new Set(['new', 'shipped', 'returns']);

/** A record detail route and how to check that its record exists. */
export interface RecordGate {
  readonly pattern: RegExp;
  /** `headers`: the request's, so the check runs in the session org's warehouse. */
  readonly exists: (key: string, headers?: Headers) => Promise<boolean>;
}

/** Shipment order detail: `/orders/<uuid>` or `/orders/<code>` (SO010840). */
const ORDER_GATE: RecordGate = {
  pattern: /^\/orders\/([^/]+)\/?$/,
  exists: async (key, headers) => {
    const { orderExists } = await import('./order-exists');
    return orderExists(key, headers);
  },
};

export const RECORD_GATES: readonly RecordGate[] = [ORDER_GATE];

/** Header names Next sets on client-router (RSC) fetches. */
const RSC_HEADERS: readonly string[] = ['rsc', 'next-router-prefetch', 'next-router-state-tree'];

/** True for a browser document load (GET, not an RSC/prefetch fetch). */
export function isDocumentRequest(method: string, headers: Headers): boolean {
  if (method !== 'GET') return false;
  return !RSC_HEADERS.some((name) => headers.has(name));
}

/** Pure: the record key a pathname addresses, or null when no gate applies. */
export function matchRecordGate(
  pathname: string,
  gates: readonly RecordGate[] = RECORD_GATES,
): { readonly gate: RecordGate; readonly key: string } | null {
  for (const gate of gates) {
    const match = gate.pattern.exec(pathname);
    const raw = match?.[1];
    if (!raw) continue;
    let key: string;
    try {
      key = decodeURIComponent(raw);
    } catch {
      return { gate, key: raw };
    }
    if (RESERVED_SEGMENTS.has(key.toLowerCase())) return null;
    return { gate, key };
  }
  return null;
}

/**
 * The status a signed-in document request should carry, or null for the default 200.
 * A failing lookup never blocks the page: the page itself still decides what to render.
 */
export async function documentStatusFor(
  pathname: string,
  gates: readonly RecordGate[] = RECORD_GATES,
  headers?: Headers,
): Promise<403 | 404 | null> {
  if (pathname === FORBIDDEN_PATH) return 403;
  const hit = matchRecordGate(pathname, gates);
  if (!hit) return null;
  try {
    return (await hit.gate.exists(hit.key, headers)) ? null : 404;
  } catch {
    return null;
  }
}
