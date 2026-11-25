/**
 * "Where was this person going?" (review round 3). PURE: shared by the proxy, which notes the page
 * that was asked for, and by the session guards, which send a signed out person to sign in and
 * back to exactly that page.
 *
 * Why a request header: the signed in shell is a layout, and a layout is not told the path or the
 * query of the page inside it. Without this, every signed out visit went to `/login?next=/` and
 * landed on the launcher, so the one button of the failed payment email ("Update card",
 * `/billing?fix=payment`) lost both the page and the `fix=payment` that puts the card in focus.
 *
 * The proxy always overwrites the header, so a value sent by a browser never reaches the server
 * code. The guards still run it through `safeNextPath`, which only lets same origin paths through.
 */
export const RETURN_TO_HEADER = 'x-kitstak-return-to';

/** Longer than any real page address of the Portal. A longer one falls back to the page's own default. */
const MAX_RETURN_TO_LENGTH = 1000;

/** Query keys that belong to the framework's own page fetches, never to the page a person asked for. */
const INTERNAL_QUERY_KEYS = ['_rsc'];

/**
 * The path and query of a page request, as the `next` of a sign in redirect. null when it is too
 * long to carry. `search` is the raw query with or without its leading question mark.
 */
export function returnToOf(pathname: string, search: string): string | null {
  if (!pathname.startsWith('/')) return null;
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  for (const key of INTERNAL_QUERY_KEYS) params.delete(key);
  const query = params.toString();
  const full = query ? `${pathname}?${query}` : pathname;
  return full.length > MAX_RETURN_TO_LENGTH ? null : full;
}
