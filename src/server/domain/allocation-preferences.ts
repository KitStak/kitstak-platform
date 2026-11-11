/**
 * Allocation inventory "preference" conditions (Logiwa: Prioritize Same Pack Type,
 * Prioritize Higher Pack Type, Only Allocate Full LPs). Authored by M12, additive to
 * `allocation.ts` `planLine`.
 *
 * These are not bucket filters: they depend on the order line being planned. A condition
 * `{ field, comparator: "equals", value: true }` switches the preference on; it is removed
 * from the regular bucket evaluation.
 *   - prioritizeSamePackType: buckets whose pack type equals the line's pack type rank first.
 *   - prioritizeHigherPackType: buckets in larger pack types (product pack type UOM qty) rank first.
 *   - onlyAllocateFullLps: only stock on a license plate, and only whole LPs: every unit on the LP
 *     is this product, free, and fits in what the line still needs.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { RuleCondition } from "@/lib/domain-types";
import * as schema from "@/server/db/schema";
import type { InventoryRow } from "./ledger/bucket";
import type { OrderLineRow } from "./facts";
import type { Tx } from "./types";

export const ALLOCATION_PREFERENCE_FIELDS = ["prioritizeSamePackType", "prioritizeHigherPackType", "onlyAllocateFullLps"] as const;
export type AllocationPreferenceField = (typeof ALLOCATION_PREFERENCE_FIELDS)[number];
export type AllocationPreferences = Readonly<Record<AllocationPreferenceField, boolean>>;

const PREF = new Set<string>(ALLOCATION_PREFERENCE_FIELDS);

const isOn = (c: RuleCondition): boolean => {
  if (c.comparator === "isNotEmpty") return true;
  if (c.comparator !== "equals" && c.comparator !== "in") return false;
  const v = Array.isArray(c.value) ? c.value[0] : c.value;
  return v === true || v === "true" || v === "Yes";
};

/** Splits preference flags from the bucket filter conditions. */
export function splitAllocationPreferences(conditions: readonly RuleCondition[]): { conditions: RuleCondition[]; prefs: AllocationPreferences } {
  const prefs: Record<AllocationPreferenceField, boolean> = { prioritizeSamePackType: false, prioritizeHigherPackType: false, onlyAllocateFullLps: false };
  const rest: RuleCondition[] = [];
  for (const c of conditions) {
    if (PREF.has(c.field)) prefs[c.field as AllocationPreferenceField] ||= isOn(c);
    else rest.push(c);
  }
  return { conditions: rest, prefs };
}

export const hasPreferences = (p: AllocationPreferences): boolean => p.prioritizeSamePackType || p.prioritizeHigherPackType || p.onlyAllocateFullLps;

interface WithBucket { readonly bucket: InventoryRow }

/** Stable re-rank: same pack type first, then higher pack type; ties keep the order-by ranking. */
export async function rankByPackType<C extends WithBucket>(tx: Tx, line: OrderLineRow, ranked: readonly C[], prefs: AllocationPreferences): Promise<C[]> {
  if (!prefs.prioritizeSamePackType && !prefs.prioritizeHigherPackType) return [...ranked];
  const uom = new Map<string, number>();
  if (prefs.prioritizeHigherPackType) {
    const ppt = schema.productPackTypes;
    for (const r of await tx.select({ packType: ppt.packType, uomQty: ppt.uomQty }).from(ppt).where(eq(ppt.productId, line.productId))) uom.set(r.packType, r.uomQty);
  }
  const size = (c: C): number => uom.get(c.bucket.packType ?? "") ?? 1;
  return ranked.map((c, i) => ({ c, i })).sort((a, b) => {
    if (prefs.prioritizeSamePackType) {
      const sa = a.c.bucket.packType === line.packType ? 0 : 1;
      const sb = b.c.bucket.packType === line.packType ? 0 : 1;
      if (sa !== sb) return sa - sb;
    }
    if (prefs.prioritizeHigherPackType) {
      const d = size(b.c) - size(a.c);
      if (d !== 0) return d;
    }
    return a.i - b.i;
  }).map((x) => x.c);
}

export interface FullLpSlice<C> { readonly candidate: C; readonly qty: number }

/**
 * Whole-LP selection: walks LPs in ranking order and takes an LP only when all of its stock
 * (every inventory row on it) is this product, unallocated, unused in this run and fits in `need`.
 */
export async function planFullLps<C extends WithBucket>(tx: Tx, line: OrderLineRow, ranked: readonly C[], need: number, used: ReadonlyMap<string, number>): Promise<FullLpSlice<C>[]> {
  const order: string[] = [];
  const groups = new Map<string, C[]>();
  for (const c of ranked) {
    const lp = c.bucket.lpId;
    if (!lp) continue;
    if (!groups.has(lp)) { groups.set(lp, []); order.push(lp); }
    groups.get(lp)?.push(c);
  }
  if (order.length === 0) return [];
  const inv = schema.inventory;
  const all = (await tx.select({ id: inv.id, lpId: inv.lpId, productId: inv.productId, onHand: inv.onHand, allocated: inv.allocated })
    .from(inv).where(and(inArray(inv.lpId, order)))).filter((r) => r.onHand > 0);
  const byLp = new Map<string, typeof all>();
  for (const r of all) if (r.lpId) byLp.set(r.lpId, [...(byLp.get(r.lpId) ?? []), r]);
  const out: FullLpSlice<C>[] = [];
  let left = need;
  for (const lp of order) {
    if (left <= 0) break;
    const rows = byLp.get(lp) ?? [];
    const cands = groups.get(lp) ?? [];
    const eligibleIds = new Set(cands.map((c) => c.bucket.id));
    // Every row on the LP must be a candidate (same product, Stock, eligible location/lot) and untouched.
    const whole = rows.length > 0 && rows.every((r) => eligibleIds.has(r.id) && r.productId === line.productId && r.allocated === 0 && !(used.get(r.id) ?? 0));
    if (!whole) continue;
    const total = rows.reduce((s, r) => s + r.onHand, 0);
    if (total > left) continue;
    for (const c of cands) out.push({ candidate: c, qty: c.bucket.onHand });
    left -= total;
  }
  return out;
}
