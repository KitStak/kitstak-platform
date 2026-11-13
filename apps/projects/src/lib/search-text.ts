/** Pure text helpers for search results (comment snippets). Used by the /search page (nav team). */

/** `@[Maya Chen](user:…)` → `@Maya Chen`, markdown noise removed. */
export function commentPlainText(body: string): string {
  return body
    .replace(/@\[([^\]]+)\]\(user:[0-9a-f-]+\)/gi, '@$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ~160 characters around the first match, with ellipses when cut. */
export function excerptAround(text: string, query: string, size = 160): string {
  const lower = text.toLowerCase();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  let at = lower.indexOf(query.toLowerCase());
  if (at < 0) at = Math.min(...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0), Number.POSITIVE_INFINITY);
  if (!Number.isFinite(at) || at < 0) at = 0;
  const start = Math.max(0, at - Math.floor(size / 3));
  const end = Math.min(text.length, start + size);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}
