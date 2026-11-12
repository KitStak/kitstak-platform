/**
 * Fractional-index ordering helpers (pure). Positions are base-62 keys compared byte-wise;
 * the DB column uses the "C" collation so `ORDER BY position` matches `a < b` here.
 */
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { BadRequestError } from '@/server/http/errors';

/** A key strictly between `before` and `after` (either may be null for open ends). */
export function positionBetween(before: string | null | undefined, after: string | null | undefined): string {
  const lower = before ?? null;
  const upper = after ?? null;
  if (lower !== null && upper !== null && lower >= upper) {
    throw new BadRequestError('Invalid ordering: "before" must sort ahead of "after"');
  }
  return generateKeyBetween(lower, upper);
}

/** `count` ascending keys between the bounds. */
export function positionsBetween(
  before: string | null | undefined,
  after: string | null | undefined,
  count: number,
): string[] {
  if (count <= 0) return [];
  return generateNKeysBetween(before ?? null, after ?? null, count);
}

/** Key placed after the current last key (append). */
export function positionAfter(last: string | null | undefined): string {
  return generateKeyBetween(last ?? null, null);
}

/** Key placed before the current first key (prepend). */
export function positionBefore(first: string | null | undefined): string {
  return generateKeyBetween(null, first ?? null);
}

/** Ascending keys for a fresh list of `count` entries. */
export function initialPositions(count: number): string[] {
  return positionsBetween(null, null, count);
}

/** Byte-wise comparison matching Postgres `COLLATE "C"`. */
export function comparePositions(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export interface Positioned {
  readonly id: string;
  readonly position: string;
}

/**
 * Resolve a drop target ("place after `afterId`" / "before `beforeId`") inside an ordered
 * sibling list into a new position key. The moved entity must be excluded from `siblings`.
 */
export function resolveMovePosition(
  siblings: readonly Positioned[],
  target: { readonly afterId?: string | null; readonly beforeId?: string | null },
): string {
  const sorted = [...siblings].sort((a, b) => comparePositions(a.position, b.position));
  if (target.afterId) {
    const index = sorted.findIndex((entry) => entry.id === target.afterId);
    if (index === -1) throw new BadRequestError('The "afterId" sibling does not exist');
    return positionBetween(sorted[index]?.position, sorted[index + 1]?.position);
  }
  if (target.beforeId) {
    const index = sorted.findIndex((entry) => entry.id === target.beforeId);
    if (index === -1) throw new BadRequestError('The "beforeId" sibling does not exist');
    return positionBetween(sorted[index - 1]?.position, sorted[index]?.position);
  }
  return positionAfter(sorted.at(-1)?.position);
}
