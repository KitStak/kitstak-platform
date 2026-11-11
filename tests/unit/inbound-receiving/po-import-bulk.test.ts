/** M05 import handler (purchase orders + vendors) and full receive into the default receiving location. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { handler as poImport, resolvePoType } from "@/server/imports/handlers/purchase-orders";
import { getPurchaseOrder } from "@/server/repositories/purchase-orders";
import { receiveAll } from "@/server/repositories/purchase-orders-receive";
import { receiptsForPurchaseOrder } from "@/server/repositories/receipts";
import { createWorld, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;

beforeEach(async () => {
  w = await createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
});
afterEach(() => w.close());

const importCtx = (rowNumber: number) => ({ db: w.db, auth, actor: { userId: w.userId, source: "admin@test.io" }, batchId: "batch-1", rowNumber });
const row = (extra: Record<string, unknown> = {}) => ({
  poCode: "KS-TEST-IMP-1", clientCode: "ACME", warehouseCode: "MLT1", sku: "MLT-WIDGET-01", quantity: 5, unitCost: 2, packType: "Each",
  vendorName: "KS-TEST Imported Vendor", ...extra,
});

describe("purchase order import", () => {
  it("creates the PO and a missing vendor, then appends lines to the same Pending PO", async () => {
    const first = await poImport.apply(importCtx(1), row());
    expect(first.message).toContain("vendor KS-TEST Imported Vendor");
    const second = await poImport.apply(importCtx(2), row({ sku: "MLT-GADGET-02", quantity: 3, unitCost: 4 }));
    expect(second.entityId).toBe(first.entityId);

    const po = await getPurchaseOrder(w.db, auth.scope, first.entityId as string);
    expect(po.status).toBe("Pending");
    expect(po.lines).toHaveLength(2);
    expect(po.totalQuantity).toBe(8);
    expect(po.purchasePrice).toBe(22);
    const vendors = await w.db.select().from(schema.vendors).where(eq(schema.vendors.clientId, w.clientId));
    expect(vendors.filter((v) => v.displayName === "KS-TEST Imported Vendor")).toHaveLength(1);
  });

  it("reuses an existing vendor and rejects unknown clients, SKUs and PO types", async () => {
    await poImport.apply(importCtx(1), row());
    const again = await poImport.apply(importCtx(2), row({ poCode: "KS-TEST-IMP-2" }));
    expect(again.message).not.toContain("vendor");
    await expect(async () => await poImport.apply(importCtx(3), row({ poCode: "X1", clientCode: "NOPE" }))).rejects.toThrow(/Client "NOPE" not found/);
    await expect(async () => await poImport.apply(importCtx(4), row({ poCode: "X2", sku: "MISSING" }))).rejects.toThrow(/SKU "MISSING" not found/);
    expect(() => resolvePoType("weird")).toThrow(/Unknown PO type/);
    expect(resolvePoType("transfer")).toBe("Transfer Order");
  });
});

describe("bulk receive PO", () => {
  it("receives every open line into the warehouse's default receiving location and completes the PO", async () => {
    const { entityId } = await poImport.apply(importCtx(1), row());
    await poImport.apply(importCtx(2), row({ sku: "MLT-GADGET-02", quantity: 3 }));
    const result = await receiveAll(w.db, w.ctx, auth.scope, entityId as string);
    expect(result.status).toBe("Completed");
    expect(result.receivedUnits).toBe(8);
    const receipts = await receiptsForPurchaseOrder(w.db, auth.scope, entityId as string);
    expect(receipts).toHaveLength(2);
    expect(new Set(receipts.map((r) => r.locationCode))).toEqual(new Set(["RCV-01"]));
    const po = await getPurchaseOrder(w.db, auth.scope, entityId as string);
    expect(po.completedAt).toBeTruthy();
    await expect(async () => await receiveAll(w.db, w.ctx, auth.scope, entityId as string)).rejects.toThrow();
  });
});
