/**
 * Fractional ranking for manual ordering (tasks, statuses, sections, spaces…). Ranks are
 * base-62 strings that sort lexicographically (`ORDER BY position COLLATE "C"`), so moving one
 * item writes one row. Wraps the `fractional-indexing` package.
 */
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/** A rank strictly between `before` and `after` (either may be null for an open end). */
export function rankBetween(before: string | null | undefined, after: string | null | undefined): string {
  const lo = before ?? null;
  const hi = after ?? null;
  if (lo !== null && hi !== null && lo >= hi) {
    // Out-of-order neighbours (concurrent edits): fall back to just after `lo`.
    return generateKeyBetween(lo, null);
  }
  return generateKeyBetween(lo, hi);
}

/** A rank after the last item (append). */
export function rankAfter(last: string | null | undefined): string {
  return generateKeyBetween(last ?? null, null);
}

/** A rank before the first item (prepend). */
export function rankBefore(first: string | null | undefined): string {
  return generateKeyBetween(null, first ?? null);
}

/** `count` evenly spread ranks between two bounds (bulk insert, template instantiation). */
export function ranksBetween(count: number, before: string | null = null, after: string | null = null): string[] {
  if (count <= 0) return [];
  return generateNKeysBetween(before, after, count);
}

/** Compare ranks the way Postgres `COLLATE "C"` does (byte order). */
export function compareRank(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Rank for dropping an item at `index` in an already-sorted list of ranks (the moved item
 * must not be in `ranks`). Used by drag and drop: `rankForIndex(siblings.map(s => s.position), dropIndex)`.
 */
export function rankForIndex(ranks: readonly string[], index: number): string {
  const clamped = Math.max(0, Math.min(index, ranks.length));
  return rankBetween(clamped > 0 ? ranks[clamped - 1] : null, clamped < ranks.length ? ranks[clamped] : null);
}
