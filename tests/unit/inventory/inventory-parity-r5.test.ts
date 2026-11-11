/** M06 round 5 (critic 6.6): hygiene relabels allocated units, search chip, warehouse code label. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { ledger } from "@/server/domain/ledger";
import { findInventoryHygieneIssues, repairInventoryHygiene } from "@/server/repositories/inventory-hygiene";
import { searchChipLabel, warehouseCodeOf } from "@/components/inventory/inventory-search-chip";
import { createWorld, type World } from "../foundation/domain/fixtures";

describe("hygiene repair of allocated units (REQ-R2-32)", () => {
  let w: World;
  beforeEach(async () => { w = await createWorld(); });
  afterEach(() => w.close());

  it("relabels a fully allocated bucket and carries the allocation to the corrected bucket", async () => {
    const b = (await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 3, expiryDate: "2026-02-28" })).bucket;
    const { allocation } = await ledger.allocate(w.db, w.ctx, { inventoryId: b.id, qty: 2 });
    await ledger.allocate(w.db, w.ctx, { inventoryId: b.id, qty: 1 });
    expect((await findInventoryHygieneIssues(w.db)).map((i) => i.check)).toEqual(["untracked-attribute"]);

    const res = await repairInventoryHygiene(w.db, w.ctx);
    expect(res.skipped).toEqual([]);
    expect(res.repaired).toBe(1);
    expect(await findInventoryHygieneIssues(w.db)).toEqual([]);

    const moved = (await w.db.select().from(schema.inventoryAllocations).where(eq(schema.inventoryAllocations.id, allocation.id)).limit(1))[0];
    expect(moved?.inventoryId).not.toBe(b.id);
    expect(moved?.qty).toBe(2);
    expect(moved?.status).toBe("Allocated");
    const target = (await w.db.select().from(schema.inventory).where(eq(schema.inventory.id, moved!.inventoryId)).limit(1))[0];
    expect(target).toMatchObject({ onHand: 3, allocated: 3, expiryDate: null });
    const changes = (await w.db.select().from(schema.inventoryTransactions)).filter((t) => t.type === "Attributes Change");
    expect(changes).toHaveLength(2);
    expect(await ledger.reconcileLedger(w.db)).toEqual([]);
  });
});

describe("toolbar search chip", () => {
  it("names the comparator the way Logiwa does", () => {
    expect(searchChipLabel("eq", "SKU")).toBe("SKU equals");
    expect(searchChipLabel("sw", "SKU or barcode")).toBe("SKU or barcode starts with");
  });
  it("shortens a warehouse label to its code", () => {
    expect(warehouseCodeOf("MLT1 - Main Fulfillment")).toBe("MLT1");
    expect(warehouseCodeOf("All Warehouses")).toBe("All Warehouses");
    expect(warehouseCodeOf("")).toBe("");
  });
});

describe("bucket drawer Transaction History links", () => {
  it("scopes to this row's location in each direction", async () => {
    const { bucketHistoryHref } = await import("@/components/inventory/bucket-drawer");
    const row = { sku: "MLT-WIDGET-01", warehouseId: "wh1", clientId: "c1", location: "MLT1-A-01" };
    const all = decodeURIComponent(bucketHistoryHref(row));
    expect(all).toContain("f.sku=eq:MLT-WIDGET-01");
    expect(all).not.toContain("Location");
    expect(decodeURIComponent(bucketHistoryHref(row, "in"))).toContain("f.targetLocation=eq:MLT1-A-01");
    expect(decodeURIComponent(bucketHistoryHref(row, "out"))).toContain("f.sourceLocation=eq:MLT1-A-01");
  });
});
