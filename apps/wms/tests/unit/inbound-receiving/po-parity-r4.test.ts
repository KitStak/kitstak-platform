/** M05 round 4: Actual Receiving Date audit trail on partial receipts; Next blocked while the PO number check is pending. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { createPurchaseOrder } from "@/server/repositories/purchase-orders-commands";
import { getPurchaseOrder } from "@/server/repositories/purchase-orders";
import { receivePurchaseOrder } from "@/server/repositories/purchase-orders-receive";

import { createVendor } from "@/server/repositories/vendors";
import { poCreateSchema, receiveBodySchema } from "@/lib/grid-defs/receiving/po-schemas";
import { vendorFormSchema } from "@/lib/grid-defs/receiving/vendors";
import { CODE_CHECK_PENDING, detailsCanProceed, emptyValues } from "@/components/receiving/wizard/po-form-model";
import { createWorld, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;

beforeEach(async () => {
  w = await createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
});
afterEach(() => w.close());

const address = { name: "Dock", line1: "1 Supply Way", line2: "", postalCode: "38118", city: "Memphis", phone: "", country: "US", state: "TN" };
const vendor = async () => await createVendor(w.db, w.ctx, auth.scope, vendorFormSchema.parse({ clientId: w.clientId, displayName: "Acme Supply", vendorName: "Acme Supply LLC", useShipAsBilling: true, shipping: address }));
async function createPo(code = "KS-R2-PO-1") {
  return await createPurchaseOrder(w.db, w.ctx, auth.scope, poCreateSchema.parse({
    warehouseId: w.warehouseId, clientId: w.clientId, code, poType: "Purchase Order", poDate: "2026-11-09T15:00:00.000Z", vendorId: (await vendor()).id,
    lines: [
      { productId: w.productId, packType: "Each", orderedQuantity: 10, unitCost: 2.5 },
      { productId: w.product2Id, packType: "Each", orderedQuantity: 4, unitCost: 7.25 },
    ],
  }));
}
const receiveBody = (lineId: string, quantity: number, locationId: string, extra: Record<string, unknown> = {}) =>
  receiveBodySchema.parse({ lines: [{ lineId, quantity, locationId, ...extra }] });
const poLog = async (id: string) => await w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, id));

describe("Actual Receiving Date change log", () => {
  it("writes no entry for partial receipts and exactly one set entry on completion", async () => {
    const po = await createPo("KS-R4-PO-1");
    const [l1, l2] = po.lines;
    await receivePurchaseOrder(w.db, w.ctx, auth.scope, po.id, receiveBody(l1?.id ?? "", 3, w.loc.storageA));
    await receivePurchaseOrder(w.db, w.ctx, auth.scope, po.id, receiveBody(l1?.id ?? "", 3, w.loc.storageA));
    expect((await getPurchaseOrder(w.db, auth.scope, po.id)).receivedAt).toBeNull();
    expect((await poLog(po.id)).filter((l) => l.field === "receivedAt")).toEqual([]);
    await receivePurchaseOrder(w.db, w.ctx, auth.scope, po.id, { lines: [
      ...receiveBody(l1?.id ?? "", 4, w.loc.storageA).lines, ...receiveBody(l2?.id ?? "", 4, w.loc.storageA).lines,
    ], allowOverReceipt: false, allowExpired: false });
    const entries = (await poLog(po.id)).filter((l) => l.field === "receivedAt");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toMatch(/^Actual Receiving Date is modified\. \(empty\) --> \d{4}\/\d{2}\/\d{2} /);
    expect((await getPurchaseOrder(w.db, auth.scope, po.id)).status).toBe("Completed");
  });
});

describe("PO number check gate", () => {
  it("blocks step 1 while the uniqueness check is pending and clears once it returns free", () => {
    const base = { ...emptyValues({ warehouseId: w.warehouseId, clientId: w.clientId }), code: "KS-R4-NEW", poDate: "2026-11-09T15:00:00.000Z" };
    expect(detailsCanProceed({ ...base, codeChecking: true })).toBe(CODE_CHECK_PENDING);
    expect(detailsCanProceed({ ...base, codeChecking: false })).toBe(true);
    expect(detailsCanProceed({ ...base, codeChecking: false, codeConflict: "This purchase order code already exists" })).toBe("This purchase order code already exists");
  });
});
