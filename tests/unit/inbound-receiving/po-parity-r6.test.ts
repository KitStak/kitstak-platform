/** M05 round 6: Actual Receiving Date audit trail through receive + receive-all. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { createPurchaseOrder } from "@/server/repositories/purchase-orders-commands";
import { receiveAll, receivePurchaseOrder, suggestForOpenLines } from "@/server/repositories/purchase-orders-receive";
import { createVendor } from "@/server/repositories/vendors";
import { poCreateSchema, receiveBodySchema } from "@/lib/grid-defs/receiving/po-schemas";
import { vendorFormSchema } from "@/lib/grid-defs/receiving/vendors";
import { createWorld, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;
beforeEach(() => {
  w = createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
});
afterEach(() => w.close());

const address = { name: "Dock", line1: "1 Supply Way", line2: "", postalCode: "38118", city: "Memphis", phone: "", country: "US", state: "TN" };
function createPo(code: string) {
  const v = createVendor(w.db, w.ctx, auth.scope, vendorFormSchema.parse({ clientId: w.clientId, displayName: "Acme", vendorName: "Acme LLC", useShipAsBilling: true, shipping: address }));
  return createPurchaseOrder(w.db, w.ctx, auth.scope, poCreateSchema.parse({
    warehouseId: w.warehouseId, clientId: w.clientId, code, poType: "Purchase Order", poDate: "2026-11-09T15:00:00.000Z", vendorId: v.id,
    lines: [{ productId: w.productId, packType: "Each", orderedQuantity: 5, unitCost: 1 }],
  }));
}
const log = (id: string) => w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, id)).all();

describe("Actual Receiving Date: receive 1, receive 1, receive all", () => {
  it("logs exactly one (empty) --> date entry at completion", () => {
    const po = createPo("KS-R6-PO-1");
    const lineId = po.lines[0]?.id ?? "";
    const one = () => receiveBodySchema.parse({ lines: [{ lineId, quantity: 1, locationId: w.loc.storageA }] });
    receivePurchaseOrder(w.db, w.ctx, auth.scope, po.id, one());
    receivePurchaseOrder(w.db, w.ctx, auth.scope, po.id, one());
    expect(log(po.id).filter((l) => l.field === "receivedAt")).toEqual([]);
    const r = receiveAll(w.db, w.ctx, auth.scope, po.id);
    expect(r.status).toBe("Completed");
    const entries = log(po.id).filter((l) => l.field === "receivedAt");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.fromValue).toBe("(empty)");
  });
});

describe("API defaults", () => {
  it("defaults an omitted pack type to the product's base pack type", () => {
    const v = createVendor(w.db, w.ctx, auth.scope, vendorFormSchema.parse({ clientId: w.clientId, displayName: "Acme 2", vendorName: "Acme 2 LLC", useShipAsBilling: true, shipping: address }));
    const po = createPurchaseOrder(w.db, w.ctx, auth.scope, poCreateSchema.parse({
      warehouseId: w.warehouseId, clientId: w.clientId, code: "KS-R6-PO-2", poType: "Purchase Order", poDate: "2026-11-09T15:00:00.000Z", vendorId: v.id,
      lines: [{ productId: w.productId, orderedQuantity: 2, unitCost: 1 }],
    }));
    const uom = w.db.select({ uom: schema.products.uom }).from(schema.products).where(eq(schema.products.id, w.productId)).get()?.uom;
    expect(po.lines[0]?.packType).toBe(uom);
    expect(po.lines[0]?.uomQuantity).toBe(1);
  });

  it("suggests putaway for every open line when no line id is given", () => {
    const po = createPo("KS-R6-PO-3");
    const out = suggestForOpenLines(w.db, auth.scope, po.id);
    expect(out.map((l) => l.lineId)).toEqual(po.lines.map((l) => l.id));
    expect(out[0]?.remaining).toBe(5);
  });
});
