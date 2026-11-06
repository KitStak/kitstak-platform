/**
 * Ordering helpers: fractional positions for drops, range selection, and multi-item moves.
 * Pure.
 */
import { generateKeyBetween } from 'fractional-indexing';

export interface Positioned {
  readonly id: string;
  readonly position: string;
}

export interface Placement {
  readonly afterId?: string;
  readonly beforeId?: string;
  /** Position the server will (most likely) assign — used for the optimistic update. */
  readonly position: string;
}

const byPosition = (a: Positioned, b: Positioned) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

function between(lower: string | null, upper: string | null): string {
  try {
    return generateKeyBetween(lower, upper);
  } catch {
    // Corrupt/legacy keys: fall back to appending.
    return generateKeyBetween(lower, null);
  }
}

/**
 * Placement that drops `movingIds` at `index` of the target sibling list (index counted in the
 * list WITHOUT the moving entries). Returns null when the drop is a no-op.
 */
export function placementAt(
  siblings: readonly Positioned[],
  movingIds: ReadonlySet<string>,
  index: number,
): Placement | null {
  const others = [...siblings].filter((entry) => !movingIds.has(entry.id)).sort(byPosition);
  const clamped = Math.max(0, Math.min(index, others.length));
  const prev = others[clamped - 1] ?? null;
  const next = others[clamped] ?? null;
  const position = between(prev?.position ?? null, next?.position ?? null);
  if (movingIds.size === 1) {
    const [only] = movingIds;
    const current = siblings.find((entry) => entry.id === only);
    const ordered = [...siblings].sort(byPosition);
    const currentIndex = current ? ordered.findIndex((entry) => entry.id === only) : -1;
    if (current && currentIndex >= 0) {
      const before = ordered[currentIndex - 1] ?? null;
      const after = ordered[currentIndex + 1] ?? null;
      if ((before?.id ?? null) === (prev?.id ?? null) && (after?.id ?? null) === (next?.id ?? null))
        return null;
    }
  }
  if (prev) return { afterId: prev.id, position };
  if (next) return { beforeId: next.id, position };
  return { position };
}

/** Index in the "others" list for a drop relative to a target row (before/after it). */
export function dropIndex(
  siblings: readonly Positioned[],
  movingIds: ReadonlySet<string>,
  targetId: string,
  side: 'before' | 'after',
): number {
  const others = [...siblings].filter((entry) => !movingIds.has(entry.id)).sort(byPosition);
  const index = others.findIndex((entry) => entry.id === targetId);
  if (index < 0) return others.length;
  return side === 'before' ? index : index + 1;
}

/** Sequential positions for several items dropped together, preserving their order. */
export function chainPositions(start: Placement, count: number, upper: string | null): string[] {
  const out: string[] = [start.position];
  for (let index = 1; index < count; index += 1) out.push(between(out[index - 1] ?? null, upper));
  return out;
}

/** Ids between `anchorId` and `targetId` (inclusive) in `orderedIds`; falls back to the target. */
export function rangeIds(orderedIds: readonly string[], anchorId: string | null, targetId: string): string[] {
  const end = orderedIds.indexOf(targetId);
  const start = anchorId ? orderedIds.indexOf(anchorId) : -1;
  if (end < 0) return [];
  if (start < 0) return [targetId];
  const [lo, hi] = start <= end ? [start, end] : [end, start];
  return orderedIds.slice(lo, hi + 1);
}

/** Toggle `ids` as a block: select all when any is unselected, otherwise deselect all. */
export function toggleMany(selected: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const next = new Set(selected);
  for (const id of ids) {
    if (allSelected) next.delete(id);
    else next.add(id);
  }
  return next;
}

export function toggleOne(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Tri-state of a header checkbox for `ids`. */
export function selectionState(
  selected: ReadonlySet<string>,
  ids: readonly string[],
): boolean | 'indeterminate' {
  if (ids.length === 0) return false;
  let count = 0;
  for (const id of ids) if (selected.has(id)) count += 1;
  if (count === 0) return false;
  return count === ids.length ? true : 'indeterminate';
}
