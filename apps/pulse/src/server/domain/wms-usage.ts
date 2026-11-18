/**
 * Pure planning for "parts used, from the warehouse" (no database here, so it is unit tested).
 *
 * The warehouse says how many of one part a work order used on each day. Pulse keeps one
 * material usage row per part and day, with the stable ref `woc:<componentId>:<date>`. A pull
 * works out what to add, change, move or take out so Pulse matches the warehouse, and running it
 * again changes nothing.
 *
 * Quantities are exact integers scaled by 1000 (`quantityToScaled`), never floats.
 */

/** Stable ref for one part of one work order on one day. */
export const wmsUsageRef = (componentId: string, date: string): string => `woc:${componentId}:${date}`;

/** The day inside a ref this pull writes, or an older `woc:<id>:<date>:<count>` ref. Null for anything else. */
export function refDate(ref: string | null, componentId: string): string | null {
  if (!ref) return null;
  const prefix = `woc:${componentId}:`;
  if (!ref.startsWith(prefix)) return null;
  const date = ref.slice(prefix.length, prefix.length + 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

export interface UsageDay {
  readonly date: string;
  /** Quantity x 1000. */
  readonly qty: bigint;
}

/**
 * Parts used per day for one part. Ledger days come first. When the ledger adds up to less than
 * the warehouse count, the rest goes on `fallbackDate` (the build day). When it adds up to more,
 * the latest days are cut back, so the total always equals the warehouse count.
 */
export function usageDays(ledger: readonly UsageDay[], consumed: bigint, fallbackDate: string): UsageDay[] {
  const byDate = new Map<string, bigint>();
  for (const day of ledger) if (day.qty !== BigInt(0)) byDate.set(day.date, (byDate.get(day.date) ?? BigInt(0)) + day.qty);
  const days = [...byDate.entries()].filter(([, qty]) => qty > BigInt(0)).map(([date, qty]) => ({ date, qty })).sort((a, b) => a.date.localeCompare(b.date));
  const total = days.reduce((sum, day) => sum + day.qty, BigInt(0));
  const target = consumed > BigInt(0) ? consumed : BigInt(0);
  if (total < target) {
    const rest = target - total;
    const same = days.find((day) => day.date === fallbackDate);
    if (same) same.qty += rest;
    else days.push({ date: fallbackDate, qty: rest });
    days.sort((a, b) => a.date.localeCompare(b.date));
  } else if (total > target) {
    let over = total - target;
    for (let index = days.length - 1; index >= 0 && over > BigInt(0); index -= 1) {
      const day = days[index]!;
      const cut = day.qty < over ? day.qty : over;
      day.qty -= cut;
      over -= cut;
    }
  }
  return days.filter((day) => day.qty > BigInt(0));
}

export interface ExistingUsageRow {
  readonly id: string;
  readonly date: string;
  readonly qty: bigint;
  readonly ref: string | null;
}

export interface UsagePlan {
  readonly create: readonly UsageDay[];
  /** Change the quantity, or move the row to another day (new date and ref). */
  readonly update: readonly { id: string; date: string; qty: bigint; ref: string }[];
  readonly remove: readonly string[];
  /** Days that should have parts but sit in a closed month. Left alone, never an error. */
  readonly skippedClosed: number;
}

/**
 * What to write so Pulse matches the warehouse for one part.
 *
 * - `own`: rows this pull wrote before (a `woc:<componentId>:` ref, old or new form).
 * - `other`: warehouse rows for the same part that came another way (an import, the sample
 *   data). They are counted, never changed: the same day first, then the earliest days.
 * - Rows in a closed month are never changed and count as already there.
 */
export function planUsage(componentId: string, wanted: readonly UsageDay[], own: readonly ExistingUsageRow[], other: readonly UsageDay[], isClosed: (date: string) => boolean): UsagePlan {
  const need = new Map<string, bigint>();
  for (const day of wanted) need.set(day.date, (need.get(day.date) ?? BigInt(0)) + day.qty);
  const dates = () => [...need.keys()].sort();
  const take = (date: string, qty: bigint): bigint => {
    const have = need.get(date) ?? BigInt(0);
    const used = have < qty ? have : qty;
    if (used > BigInt(0)) need.set(date, have - used);
    return qty - used;
  };
  const fixed: UsageDay[] = [...other, ...own.filter((row) => isClosed(row.date)).map((row) => ({ date: row.date, qty: row.qty }))];
  for (const row of fixed) {
    let left = take(row.date, row.qty);
    for (const date of dates()) {
      if (left <= BigInt(0)) break;
      left = take(date, left);
    }
  }

  const movable = own.filter((row) => !isClosed(row.date));
  const used = new Set<string>();
  const update: { id: string; date: string; qty: bigint; ref: string }[] = [];
  const create: UsageDay[] = [];
  let skippedClosed = 0;
  const open = dates().filter((date) => (need.get(date) ?? BigInt(0)) > BigInt(0));
  const pending: string[] = [];
  // First pass: a row already on the right day (best: the right ref) keeps its place.
  for (const date of open) {
    if (isClosed(date)) {
      skippedClosed += 1;
      continue;
    }
    const ref = wmsUsageRef(componentId, date);
    const row = movable.find((item) => !used.has(item.id) && item.ref === ref) ?? movable.find((item) => !used.has(item.id) && item.date === date && refDate(item.ref, componentId) !== null);
    if (!row) {
      pending.push(date);
      continue;
    }
    used.add(row.id);
    const qty = need.get(date)!;
    if (row.qty !== qty || row.ref !== ref || row.date !== date) update.push({ id: row.id, date, qty, ref });
  }
  // Second pass: a row on a wrong day is moved; when none is left, a new row is added.
  for (const date of pending) {
    const qty = need.get(date)!;
    const row = movable.find((item) => !used.has(item.id));
    if (row) {
      used.add(row.id);
      update.push({ id: row.id, date, qty, ref: wmsUsageRef(componentId, date) });
    } else create.push({ date, qty });
  }
  const remove = movable.filter((row) => !used.has(row.id)).map((row) => row.id);
  return { create, update, remove, skippedClosed };
}
