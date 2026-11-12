/** M06 round 3 (critic 7.8): calendar dates, mixed bulk selections, reason direction, untracked attributes, hygiene repair. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { ledger } from "@/server/domain/ledger";
import { addInventory, changeQuantity } from "@/server/repositories/inventory-commands";
import { attributeProblems, findInventoryHygieneIssues, repairDate, repairInventoryHygiene } from "@/server/repositories/inventory-hygiene";
import { formatCalendarDate, formatInstantDate, gridDatePattern, parseCalendarDate } from "@/components/inventory/inventory-dates";
import { partitionSelection, skippedSummary, type BucketRow } from "@/components/inventory/by-location-types";
import { transferInputReason } from "@/components/inventory/transfer-product-drawer";
import { reasonAllows, reasonDirection } from "@/lib/grid-defs/inventory/reason-direction";
import { DEFAULT_FORMAT_PREFERENCES } from "@/lib/format";
import { createWorld, type World } from "../foundation/domain/fixtures";

const prefs = DEFAULT_FORMAT_PREFERENCES;

describe("calendar dates never shift a day", () => {
  it("formats YYYY-MM-DD as the same calendar day, zero-padded", () => {
    expect(gridDatePattern(prefs)).toBe("MM/DD/YYYY");
    expect(formatCalendarDate("2026-02-28", prefs)).toBe("02/28/2026");
    expect(formatCalendarDate("2026-01-01", prefs)).toBe("01/01/2026");
    expect(formatCalendarDate("2026-12-31T00:00:00.000Z", prefs)).toBe("12/31/2026");
  });
  it("rejects impossible dates instead of rolling them over", () => {
    expect(parseCalendarDate("2026-02-31")).toBeNull();
    expect(parseCalendarDate("2026-13-45")).toBeNull();
    expect(formatCalendarDate("2026-02-31", prefs)).toBe("2026-02-31");
    expect(formatCalendarDate(null, prefs)).toBe("—");
  });
  it("shows an instant's local calendar day (same as the date-time column)", () => {
    const local = new Date(2026, 10, 9, 22, 46);
    expect(formatInstantDate(local.toISOString(), prefs)).toBe("11/09/2026");
  });
});

const row = (over: Partial<BucketRow>): BucketRow => ({
  id: "r", sku: "SKU", location: "A-01", status: "Stock", countLockPlan: null, freeQty: 5, ...over,
} as unknown as BucketRow);

describe("bulk actions on a mixed selection", () => {
  it("keeps eligible rows and lists the skipped ones with reasons", () => {
    const p = partitionSelection([
      row({ id: "1" }), row({ id: "2", status: "Packed" }), row({ id: "3", countLockPlan: "CNT-1" }), row({ id: "4", freeQty: 0 }), row({ id: "5" }),
    ]);
    expect(p.eligible.map((r) => r.id)).toEqual(["1", "5"]);
    expect(p.skipped.map((s) => s.reason)).toEqual(["status", "count", "allocated"]);
    expect(skippedSummary(p)).toBe("3 of 5 selected rows will be skipped (1 not Stock, 1 count-locked, 1 fully allocated).");
    expect(skippedSummary(partitionSelection([row({ id: "1" })]))).toBeNull();
  });
  it("keeps Transfer disabled until quantity and destination are valid", () => {
    expect(transferInputReason(null, 5, null)).toBe("Enter the quantity to transfer");
    expect(transferInputReason(6, 5, { kind: "location", id: "x" })).toBe("Only 5 available");
    expect(transferInputReason(2, 5, null)).toBe("Pick where to move it");
    expect(transferInputReason(2, 5, { kind: "location", id: "x" })).toBeNull();
  });
});

describe("adjustment reason direction", () => {
  it("uses meta.direction, then a name default", () => {
    expect(reasonDirection("Inventory is missing")).toBe("decrease");
    expect(reasonDirection("Inventory found")).toBe("increase");
    expect(reasonDirection("Inventory quantity discrepancy")).toBe("both");
    expect(reasonDirection("Inventory is missing", { direction: "both" })).toBe("both");
    expect(reasonAllows("decrease", 1)).toBe(false);
    expect(reasonAllows("decrease", -1)).toBe(true);
    expect(reasonAllows("increase", -1)).toBe(false);
    expect(reasonAllows("both", 3)).toBe(true);
    expect(reasonAllows("decrease", null)).toBe(true);
  });
});

describe("ledger writes (in-memory DB)", () => {
  let w: World;
  beforeEach(async () => { w = await createWorld(); });
  afterEach(() => w.close());
  const stock = async (qty: number, attrs: { lotNumber?: string | null; expiryDate?: string | null } = {}) =>
    (await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty, ...attrs })).bucket;

  it("refuses a decrease reason for an increase on the server", async () => {
    const missing = (await w.db.insert(schema.lookupValues).values({ type: "adjustment_reason", name: "Inventory is missing" }).returning())[0].id;
    const b = await stock(4);
    await expect(async () => await changeQuantity(w.db, w.ctx, b.id, { mode: "adjust", qty: 5, reasonId: missing, version: b.version })).rejects.toThrow(/decrease reason/);
    const res = await changeQuantity(w.db, w.ctx, b.id, { mode: "adjust", qty: 3, reasonId: missing, version: b.version });
    expect(res.to).toBe(3);
    expect(await ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("Add Inventory refuses attributes the product doesn't track", async () => {
    const base = { warehouseId: w.warehouseId, locationId: w.loc.storageA, clientId: w.clientId, productId: w.productId, packType: "Each", qty: 2 };
    await expect(async () => await addInventory(w.db, w.ctx, { ...base, lotNumber: "LOT-QA-01" })).rejects.toThrow(/doesn't track/);
    await expect(async () => await addInventory(w.db, w.ctx, { ...base, expiryDate: "2026-02-28" })).rejects.toThrow(/doesn't track/);
    expect((await addInventory(w.db, w.ctx, base)).to).toBe(2);
  });

  it("finds and repairs untracked attributes, bad dates and empty buckets through the ledger", async () => {
    const lot = await stock(2, { lotNumber: "LOT-QA-01" });
    const exp = await stock(3, { expiryDate: "2027-05-08T05:00:00.000Z" });
    const empty = await stock(1, { lotNumber: "OLD" });
    await ledger.adjustTo(w.db, w.ctx, { inventoryId: empty.id, targetQty: 0 });
    const checks = (await findInventoryHygieneIssues(w.db)).map((i) => `${i.check}:${i.id}`);
    expect(checks).toContain(`untracked-attribute:${lot.id}`);
    expect(checks).toContain(`bad-date:${exp.id}`);
    expect(checks).toContain(`empty-bucket:${empty.id}`);

    const res = await repairInventoryHygiene(w.db, w.ctx);
    expect(res.skipped).toEqual([]);
    expect(res.deleted).toBeGreaterThanOrEqual(1);
    expect(await findInventoryHygieneIssues(w.db)).toEqual([]);
    const live = (await w.db.select().from(schema.inventory).where(eq(schema.inventory.productId, w.productId))).filter((b) => b.onHand > 0);
    expect(live.reduce((s, b) => s + b.onHand, 0)).toBe(5);
    expect(live.every((b) => b.lotNumber === null && b.expiryDate === null)).toBe(true);
    const types = (await w.db.select().from(schema.inventoryTransactions)).map((t) => t.type);
    expect(types).toContain("Attributes Change");
    expect(await ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("knows which attribute problems a bucket has", () => {
    expect(attributeProblems({ lotNumber: "L", expiryDate: "2026-13-45", productionDate: null, trackLot: 0, trackExpiry: 1, trackProductionDate: 0 }))
      .toEqual({ untracked: ["lotNumber"], badDates: ["expiryDate"] });
    expect(repairDate("2027-05-08T05:00:00.000Z")).toBe("2027-05-08");
    expect(repairDate("2026-02-31")).toBeNull();
  });
});
