/**
 * Inventory data hygiene (M06): checks and one-time repairs for ledger buckets.
 *
 *   - untracked-attribute: a bucket carries a lot, expiry or production date that its product
 *     does not track (tracking was turned off later, or an older write path ignored the flag).
 *   - bad-date: expiry / production is not a real "YYYY-MM-DD" ("2026-02-31", "2026-13-45",
 *     or a full timestamp).
 *   - empty-bucket: on-hand 0, nothing allocated, and nothing (allocation, serial, live receipt)
 *     references it. Emptied buckets are pruned by new operations; these are older leftovers.
 *
 * Repairs go through the ledger (`changeAttributes`, a type "Attributes Change" row per bucket),
 * so history and `reconcileLedger` stay intact. Empty buckets are deleted with the same guard as
 * `pruneEmptyBuckets` (transaction rows keep their ids). Allocated units are relabelled together
 * with their allocation (`ledger.move` with `allocationId`), so the order keeps its reservation
 * on the corrected bucket; a bucket the ledger refuses to change is reported in `skipped`.
 */
import { sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { ledger } from "@/server/domain/ledger";
import { systemCtx, type DomainCtx } from "@/server/domain/types";
import { isValidIsoDate, pruneEmptyBuckets } from "./inventory-commands";
import { dbAll, dbGet, withWriteTx } from "@/server/db/sql";

export type HygieneCheck = "untracked-attribute" | "bad-date" | "empty-bucket" | "fixture-stock";

export interface HygieneIssue {
  readonly check: HygieneCheck;
  readonly id: string;
  readonly message: string;
}

interface BucketFacts {
  readonly id: string;
  readonly sku: string;
  readonly onHand: number;
  readonly allocated: number;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly productionDate: string | null;
  readonly trackLot: number;
  readonly trackExpiry: number;
  readonly trackProductionDate: number;
  readonly bucketKey: string;
}

async function bucketFacts(db: AppDb): Promise<BucketFacts[]> {
  return await dbAll<BucketFacts>(db, sql`SELECT i.id, p.sku, i.on_hand AS "onHand", i.allocated, i.lot_number AS "lotNumber",
      i.expiry_date AS "expiryDate", i.production_date AS "productionDate", i.bucket_key AS "bucketKey",
      p.track_lot AS "trackLot", p.track_expiry AS "trackExpiry", p.track_production_date AS "trackProductionDate"
    FROM inventory i JOIN products p ON p.id = i.product_id`);
}

/** Attribute fields of a bucket that must be cleared (untracked) or fixed (impossible date). */
export function attributeProblems(b: Pick<BucketFacts, "lotNumber" | "expiryDate" | "productionDate" | "trackLot" | "trackExpiry" | "trackProductionDate">): {
  readonly untracked: readonly ("lotNumber" | "expiryDate" | "productionDate")[];
  readonly badDates: readonly ("expiryDate" | "productionDate")[];
} {
  const untracked: ("lotNumber" | "expiryDate" | "productionDate")[] = [];
  const badDates: ("expiryDate" | "productionDate")[] = [];
  if (b.lotNumber && !b.trackLot) untracked.push("lotNumber");
  if (b.expiryDate && !b.trackExpiry) untracked.push("expiryDate");
  if (b.productionDate && !b.trackProductionDate) untracked.push("productionDate");
  if (b.expiryDate && !isValidIsoDate(b.expiryDate)) badDates.push("expiryDate");
  if (b.productionDate && !isValidIsoDate(b.productionDate)) badDates.push("productionDate");
  return { untracked, badDates };
}

/** "2027-05-08T05:00:00.000Z" → "2027-05-08" when the date part is real; otherwise null (cleared). */
export function repairDate(v: string): string | null {
  const head = v.slice(0, 10);
  return isValidIsoDate(head) ? head : null;
}

async function isEmptyUnreferenced(db: AppDb, b: BucketFacts): Promise<boolean> {
  if (b.onHand !== 0 || b.allocated !== 0 || b.bucketKey.startsWith("legacy:")) return false;
  const held = await dbGet<{ n: number }>(db, sql`SELECT
      (SELECT COUNT(*) FROM inventory_allocations a WHERE a.inventory_id = ${b.id})
    + (SELECT COUNT(*) FROM serial_numbers s WHERE s.inventory_id = ${b.id})
    + (SELECT COUNT(*) FROM receipts r JOIN inventory_transactions t ON t.id = r.inventory_transaction_id
        WHERE r.cancelled_at IS NULL AND t.to_inventory_id = ${b.id}) AS n`);
  return (held?.n ?? 0) === 0;
}

const LABEL = { lotNumber: "lot", expiryDate: "expiry", productionDate: "production date" } as const;
const HYGIENE_NOTE = "Data hygiene: cleared untracked / invalid attributes";

/** Active allocations holding stock in a bucket (Allocated / Picked / … — anything the ledger can carry). */
async function activeAllocationsOf(db: AppDb, inventoryId: string): Promise<{ id: string; qty: number }[]> {
  return await dbAll<{ id: string; qty: number }>(db, sql`SELECT id, qty FROM inventory_allocations
    WHERE inventory_id = ${inventoryId} AND status IN ('Allocated', 'Picked', 'Sorted', 'Packed', 'Loaded') AND qty > 0`);
}

/** Read-only: every hygiene problem in the inventory table. */
export async function findInventoryHygieneIssues(db: AppDb): Promise<HygieneIssue[]> {
  const issues: HygieneIssue[] = [];
  for (const b of await bucketFacts(db)) {
    const { untracked, badDates } = attributeProblems(b);
    if (untracked.length > 0) {
      issues.push({ check: "untracked-attribute", id: b.id, message: `${b.sku} doesn't track ${untracked.map((k) => LABEL[k]).join(", ")} but the bucket has ${untracked.map((k) => `${LABEL[k]} ${b[k]}`).join(", ")} (on-hand ${b.onHand})` });
    }
    for (const k of badDates) issues.push({ check: "bad-date", id: b.id, message: `${b.sku} ${LABEL[k]} "${b[k]}" is not a real date` });
    if (await isEmptyUnreferenced(db, b)) issues.push({ check: "empty-bucket", id: b.id, message: `${b.sku} bucket is empty and unreferenced` });
  }
  return issues;
}

export interface HygieneRepairResult {
  readonly repaired: number;
  readonly deleted: number;
  readonly skipped: readonly HygieneIssue[];
}

/**
 * Fixes what `findInventoryHygieneIssues` reports. Each bucket runs in its own savepoint: one that
 * cannot change (count-locked location, non-Stock status) is reported in `skipped` and the rest go on.
 */
export async function repairInventoryHygiene(db: AppDb, ctx: DomainCtx = systemCtx("Data hygiene")): Promise<HygieneRepairResult> {
  let repaired = 0;
  const skipped: HygieneIssue[] = [];
  const emptyIds: string[] = [];
  for (const b of await bucketFacts(db)) {
    const { untracked, badDates } = attributeProblems(b);
    const patch: { lotNumber?: string | null; expiryDate?: string | null; productionDate?: string | null } = {};
    for (const k of badDates) patch[k] = repairDate(b[k] as string);
    for (const k of untracked) patch[k] = null;
    if (Object.keys(patch).length > 0) {
      if (b.onHand === 0) {
        // Nothing to move: an empty bucket with a bad attribute is either pruned below or fixed in place.
        if (b.allocated === 0) emptyIds.push(b.id);
      } else {
        const free = b.onHand - b.allocated;
        try {
          await withWriteTx(db, async (inner) => {
            // Allocated units move WITH their allocation (ledger.move + allocationId), so the order keeps its
            // reservation on the relabelled bucket. Each move posts its own "Attributes Change" row.
            for (const alloc of await activeAllocationsOf(inner, b.id)) {
              await ledger.move(inner, ctx, { inventoryId: b.id, qty: alloc.qty, allocationId: alloc.id, ...patch, type: "Attributes Change", refs: { note: HYGIENE_NOTE } });
            }
            if (free > 0) await ledger.changeAttributes(inner, ctx, { inventoryId: b.id, qty: free, ...patch, refs: { note: HYGIENE_NOTE } });
            await pruneEmptyBuckets(inner, [b.id]);
          });
          repaired += 1;
        } catch (error) {
          skipped.push({ check: untracked.length ? "untracked-attribute" : "bad-date", id: b.id, message: `${b.sku}: ${error instanceof Error ? error.message : String(error)}` });
        }
      }
    } else if (b.onHand === 0 && b.allocated === 0) {
      emptyIds.push(b.id);
    }
  }
  const deleted = (await withWriteTx(db, async (inner) => await pruneEmptyBuckets(inner, emptyIds))).length;
  return { repaired, deleted, skipped };
}

/* ------------------------------------------------------------ test-fixture stock purge */

/** Location codes that only automated critic / e2e runs create. */
export const FIXTURE_LOCATION_RE = /^KS-(CRIT|E2E)-/i;

export interface FixtureStock {
  readonly id: string;
  readonly sku: string;
  readonly location: string;
  readonly free: number;
  readonly allocated: number;
}

/**
 * Stock sitting in test-fixture locations (KS-CRIT-* / KS-E2E-*) that has not been touched for
 * `idleMinutes`, so a suite that is still running keeps its data. Buyer-facing views (By Location,
 * ATP) otherwise show e.g. "MLT-WIDGET-01 · 5 in KS-CRIT-R4W20005".
 */
export async function findFixtureStock(db: AppDb, now: Date = new Date(), idleMinutes = 60): Promise<FixtureStock[]> {
  const cutoff = new Date(now.getTime() - idleMinutes * 60_000).toISOString();
  return (await dbAll<{ id: string; sku: string; location: string; onHand: number; allocated: number; touched: string | null }>(db, sql`
      SELECT i.id, p.sku, l.code AS location, i.on_hand AS "onHand", i.allocated, COALESCE(i.updated_at, i.received_at) AS touched
      FROM inventory i JOIN products p ON p.id = i.product_id JOIN locations l ON l.id = i.location_id
      WHERE i.on_hand > 0 AND (l.code ILIKE 'KS-CRIT-%' OR l.code ILIKE 'KS-E2E-%')`))
    .filter((r) => FIXTURE_LOCATION_RE.test(r.location) && (r.touched === null || r.touched < cutoff))
    .map((r) => ({ id: r.id, sku: r.sku, location: r.location, free: r.onHand - r.allocated, allocated: r.allocated }));
}

export interface FixturePurgeResult {
  readonly removed: number;
  readonly units: number;
  readonly skipped: readonly HygieneIssue[];
}

/**
 * Removes the free units of idle fixture stock through the ledger (one "Inventory Adjustment"
 * row per bucket, reason "Inventory quantity discrepancy" when present, note "Test fixture purge"),
 * then prunes the emptied buckets. Allocated units are left alone and reported: their order has
 * to be cancelled by its owner first. Safe to run more than once.
 */
export async function purgeFixtureStock(db: AppDb, ctx: DomainCtx = systemCtx("Data hygiene"), now: Date = new Date(), idleMinutes = 60): Promise<FixturePurgeResult> {
  const reason = (await dbAll<{ id: string }>(db, sql`SELECT id FROM lookup_values WHERE type = 'adjustment_reason' AND name = 'Inventory quantity discrepancy' AND is_active = true LIMIT 1`))[0]?.id ?? null;
  let removed = 0;
  let units = 0;
  const skipped: HygieneIssue[] = [];
  for (const s of await findFixtureStock(db, now, idleMinutes)) {
    if (s.free <= 0) {
      skipped.push({ check: "fixture-stock", id: s.id, message: `${s.sku} in ${s.location}: ${s.allocated} allocated unit(s) kept; cancel the order first` });
      continue;
    }
    try {
      await withWriteTx(db, async (inner) => {
        await ledger.adjustTo(inner, ctx, { inventoryId: s.id, targetQty: s.allocated, adjustmentReasonId: reason, refs: { adjustmentReasonId: reason, note: "Test fixture purge" } });
        await pruneEmptyBuckets(inner, [s.id]);
      });
      removed += 1;
      units += s.free;
    } catch (error) {
      skipped.push({ check: "fixture-stock", id: s.id, message: `${s.sku} in ${s.location}: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return { removed, units, skipped };
}
