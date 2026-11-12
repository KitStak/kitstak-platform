/**
 * Optimistic concurrency for product mutations (PURE, client-safe). Every PATCH / status change
 * must say which version it was based on: `version` in the body, or an `If-Match` header
 * (`3`, `"3"` or `W/"3"`). A request with neither is refused, so a client that forgets the
 * version can never silently overwrite someone else's edit.
 */
export const VERSION_REQUIRED_MESSAGE =
  'Version required: send the version you loaded (body `version` or an If-Match header), then retry';

export function parseIfMatch(header: string | null | undefined): number | null {
  if (!header) return null;
  const m = /^\s*(?:W\/)?"?(\d{1,9})"?\s*$/.exec(header);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** The expected version, or null when the caller sent none (or an unusable one). */
export function expectedVersion(bodyVersion: unknown, ifMatch: string | null | undefined): number | null {
  if (typeof bodyVersion === 'number' && Number.isInteger(bodyVersion) && bodyVersion >= 1)
    return bodyVersion;
  return parseIfMatch(ifMatch);
}
