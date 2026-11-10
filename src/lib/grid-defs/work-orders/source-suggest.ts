/**
 * FEFO/FIFO source suggestion for "without picking" work order components.
 * Order: earliest expiry first (no expiry last), then earliest production date, then the
 * server's bucket order (FIFO by receipt). Prefer the first bucket that covers the whole
 * quantity; if none does, the bucket with the most free stock. Buckets in a location that
 * an open count plan locks (`lockedBy`) are never suggested: stock can't leave them.
 */
export interface SuggestBucket {
  readonly id: string;
  readonly expiryDate: string | null;
  readonly productionDate: string | null;
  readonly freeQty: number;
  /** Code of the count plan that locks the bucket's location, if any. */
  readonly lockedBy?: string | null;
}

const key = (v: string | null): string => (v ? v.slice(0, 10) : "9999-12-31");

export function fefoOrder<B extends SuggestBucket>(buckets: readonly B[]): B[] {
  return buckets
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.freeQty > 0 && !b.lockedBy)
    .sort((x, y) => key(x.b.expiryDate).localeCompare(key(y.b.expiryDate)) || key(x.b.productionDate).localeCompare(key(y.b.productionDate)) || x.i - y.i)
    .map(({ b }) => b);
}

export function suggestSource<B extends SuggestBucket>(buckets: readonly B[], need: number): B | null {
  const ordered = fefoOrder(buckets);
  if (ordered.length === 0) return null;
  const covering = ordered.find((b) => b.freeQty >= need);
  if (covering) return covering;
  return ordered.reduce((best, b) => (b.freeQty > best.freeQty ? b : best));
}

/* ------------------------------------------------------------ disassemble */

export interface LocatedBucket {
  readonly id: string;
  readonly locationId: string;
  readonly lpId: string | null;
  readonly onHand: number;
  readonly freeQty: number;
  readonly lockedBy?: string | null;
}

/**
 * Default kit stock for Disassemble: the bucket at the work order's output location (where its
 * kits were built) with the most free stock, else the first unlocked bucket, else the first.
 */
export function defaultKitBucket<B extends LocatedBucket>(buckets: readonly B[], preferLocationId: string | null): B | null {
  const usable = buckets.filter((b) => !b.lockedBy && b.freeQty > 0);
  const atOutput = preferLocationId ? usable.filter((b) => b.locationId === preferLocationId) : [];
  if (atOutput.length) return atOutput.reduce((best, b) => (b.freeQty > best.freeQty ? b : best));
  return usable[0] ?? buckets[0] ?? null;
}

/** On-hand of a product at one location (and LP when given); 0 when none is there. */
export function componentStockAt(buckets: readonly LocatedBucket[], locationId: string, lpId: string | null): number {
  return buckets.filter((b) => b.locationId === locationId && (!lpId || b.lpId === lpId)).reduce((sum, b) => sum + b.onHand, 0);
}
