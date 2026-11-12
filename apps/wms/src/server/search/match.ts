/**
 * SQL helpers for record search providers: case-insensitive contains / starts-with
 * matching with LIKE wildcards in the user's text escaped.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

const LIKE_ESCAPE = '\\';

/** Escapes `\`, `%` and `_` so user text matches literally inside a LIKE pattern. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `${LIKE_ESCAPE}${ch}`);
}

/**
 * A document-code query such as `PO0002`, `so-10916` or `PO 22`: a letter prefix plus a number.
 * Returns the upper-cased prefix and the number without leading zeros, or null. PURE.
 */
export function parseCodeQuery(q: string): { readonly prefix: string; readonly digits: string } | null {
  const m = /^([A-Za-z]{1,6})[-_ ]?0*(\d{1,12})$/.exec(q.trim());
  if (!m || !m[1] || m[2] === undefined) return null;
  return { prefix: m[1].toUpperCase(), digits: m[2] };
}

/**
 * Zero-insensitive code prefix: `PO0002` and `PO22` both find `PO002210`, because codes are
 * zero-padded to different widths than people type them.
 */
function codeNumberMatch(column: PgColumn, q: string): SQL | null {
  const code = parseCodeQuery(q);
  if (!code) return null;
  const n = code.prefix.length;
  return sql`(upper(substr(${column}, 1, ${n})) = ${code.prefix} AND ltrim(substr(${column}, ${n + 1}), '0') ILIKE ${`${escapeLike(code.digits)}%`} ESCAPE ${LIKE_ESCAPE})`;
}

/** `column ILIKE '%q%'` (SQLite LIKE was case-insensitive), plus zero-insensitive code prefixes. */
export function containsText(column: PgColumn, q: string): SQL {
  const contains = sql`${column} ILIKE ${`%${escapeLike(q)}%`} ESCAPE ${LIKE_ESCAPE}`;
  const code = codeNumberMatch(column, q);
  return code ? sql`(${contains} OR ${code})` : contains;
}

/** Sort key: 0 = exact, 1 = prefix, 2 = contains (lower ranks first). */
export function matchRank(column: PgColumn, q: string): SQL<number> {
  return sql<number>`CASE WHEN lower(${column}) = lower(${q}) THEN 0 WHEN ${column} ILIKE ${`${escapeLike(q)}%`} ESCAPE ${LIKE_ESCAPE} THEN 1 ELSE 2 END`;
}

/** `count(*)` expression for "See all N" totals. */
export const COUNT_ALL: SQL<number> = sql<number>`count(*)`;
