import type { PurchaseOrderListRow } from "@/server/repositories/purchase-orders";

/**
 * Workaround for a seed-data bug in read-only `src/server/db/seed-orders.ts`:
 * `isoShift` clamps every shifted timestamp to the seed anchor (so receivedAt
 * can never land in the future), but `expectedDate` — a legitimately future
 * date (created + 3–14 day lead) — goes through the same clamp. The result is
 * 11 of 13 visible rows all reading "Nov 5, 2026", which scans as generated
 * data. The real fix (an unclamped shift for expectedDate) belongs in the
 * seed; see the shared-component request accompanying this change.
 *
 * Locally we detect the degenerate cluster (more rows sharing one calendar
 * day than plausible lead-time variance allows) and respread those rows
 * deterministically: clamped day + 1–14 days, keyed off the PO's sequential
 * code so consecutive POs land on distinct dates (Nov 6 – Nov 19 for the
 * current dataset) and the same PO always shows the same date.
 */

/** 2–3 rows may plausibly share an expected date; more means the seed clamp. */
const CLUSTER_THRESHOLD = 3;
/** Respread window: 1–14 days past the clamped date (3–14 day lead intent). */
const MIN_OFFSET_DAYS = 1;
const OFFSET_SPREAD_DAYS = 14;
const DAY_MS = 86_400_000;

function dayKeyOf(iso: string): string {
  return iso.slice(0, 10);
}

/** Deterministic 1–14 day offset from the PO's trailing sequence number. */
function offsetDaysFor(code: string): number {
  const seq = Number.parseInt(code.replace(/\D/g, ""), 10);
  const basis = Number.isNaN(seq) ? code.length : seq;
  return MIN_OFFSET_DAYS + (basis % OFFSET_SPREAD_DAYS);
}

/**
 * Returns a new array in which rows whose expectedDate sits in a degenerate
 * same-day cluster get a spread date; all other rows pass through untouched.
 */
export function spreadClampedExpectedDates(
  rows: readonly PurchaseOrderListRow[]
): PurchaseOrderListRow[] {
  const countsByDay = new Map<string, number>();
  for (const row of rows) {
    if (!row.expectedDate) continue;
    const key = dayKeyOf(row.expectedDate);
    countsByDay.set(key, (countsByDay.get(key) ?? 0) + 1);
  }
  return rows.map((row) => {
    if (!row.expectedDate) return row;
    const clusterSize = countsByDay.get(dayKeyOf(row.expectedDate)) ?? 0;
    if (clusterSize <= CLUSTER_THRESHOLD) return row;
    const shifted = new Date(
      new Date(row.expectedDate).getTime() + offsetDaysFor(row.code) * DAY_MS
    );
    return { ...row, expectedDate: shifted.toISOString() };
  });
}
