/**
 * SQL helpers for record search providers: case-insensitive contains / starts-with
 * matching with LIKE wildcards in the user's text escaped.
 */
import { sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

const LIKE_ESCAPE = "\\";

/** Escapes `\`, `%` and `_` so user text matches literally inside a LIKE pattern. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `${LIKE_ESCAPE}${ch}`);
}

/** `column LIKE '%q%'` (case-insensitive for ASCII in SQLite). */
export function containsText(column: SQLiteColumn, q: string): SQL {
  return sql`${column} LIKE ${`%${escapeLike(q)}%`} ESCAPE ${LIKE_ESCAPE}`;
}

/** Sort key: 0 = exact, 1 = prefix, 2 = contains (lower ranks first). */
export function matchRank(column: SQLiteColumn, q: string): SQL<number> {
  return sql<number>`CASE WHEN lower(${column}) = lower(${q}) THEN 0 WHEN ${column} LIKE ${`${escapeLike(q)}%`} ESCAPE ${LIKE_ESCAPE} THEN 1 ELSE 2 END`;
}

/** `count(*)` expression for "See all N" totals. */
export const COUNT_ALL: SQL<number> = sql<number>`count(*)`;
