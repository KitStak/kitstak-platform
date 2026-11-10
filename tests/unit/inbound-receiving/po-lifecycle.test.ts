/** M05 purchase order lifecycle against an in-memory migrated DB: create → partial receive → cancel receipt → full receive, guards, vendors. */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { ledger } from "@/server/domain/ledger";
import { CANCEL_COMPLETED_PO_MESSAGE } from "@/server/domain/ledger";
import { EMPTY_GRID_QUERY } from "@/server/query/grid-query";
import { getPurchaseOrder, listPurchaseOrders, poCodeTaken } from "@/server/repositories/purchase-orders";
import { cancelPurchaseOrder, changePurchaseOrderStatus, createPurchaseOrder, deletePurchaseOrder, updatePurchaseOrder } from "@/server/repositories/purchase-orders-commands";
import { receiveAll, receivePurchaseOrder } from "@/server/repositories/purchase-orders-receive";
import { cancelReceipt, listReceipts, receiptsForPurchaseOrder } from "@/server/repositories/receipts";
import { createVendor, listVendors, setVendorActive, updateVendor } from "@/server/repositories/vendors";
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
const vendor = (clientId = w.clientId, displayName = "Acme Supply") =>
  createVendor(w.db, w.ctx, auth.scope, vendorFormSchema.parse({ clientId, displayName, vendorName: `${displayName} LLC`, useShipAsBilling: true, shipping: address }));

function createPo(code = "KS-E2E-PO-1", vendorId = vendor().id) {
  return createPurchaseOrder(w.db, w.ctx, auth.scope, poCreateSchema.parse({
    warehouseId: w.warehouseId, clientId: w.clientId, code, poType: "Purchase Order", poDate: new Date().toISOString(), vendorId,
    lines: [
      { productId: w.productId, packType: "Each", orderedQuantity: 10, unitCost: 2.5 },
      { productId: w.product2Id, packType: "Each", orderedQuantity: 4, unitCost: 7.25 },
    ],
  }));
}

const receiveBody = (lineId: string, quantity: number, locationId: string, extra: Record<string, unknown> = {}) =>
  receiveBodySchema.parse({ lines: [{ lineId, quantity, locationId, ...extra }] });
const onHandAt = (locationId: string, productId = w.productId) =>
  w.db.select().from(schema.inventory).where(and(eq(schema.inventory.locationId, locationId), eq(schema.inventory.productId, productId))).all();

describe("purchase order create", () => {
  it("creates a Pending PO with Purchase Price = Σ qty × price and line change-log rows", () => {
    const po = createPo();
    expect(po.status).toBe("Pending");
    expect(po.lines).toHaveLength(2);
    expect(po.totalQuantity).toBe(14);
    expect(po.purchasePrice).toBe(54);
    expect(po.vendorName).toBe("Acme Supply");
    expect(w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, po.id)).all()).toHaveLength(1);
    const lineLogs = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.parentEntityId, po.id)).all();
    expect(lineLogs.map((l) => l.message)).toEqual(expect.arrayContaining([expect.stringMatching(/^MLT-WIDGET-01 -> .* --> 10$/)]));
    expect(listPurchaseOrders(w.db, auth, { ...EMPTY_GRID_QUERY, q: "KS-E2E-PO-1", qm: "eq" }).total).toBe(1);
  });

  it("flags a duplicate PO number (inline check and DUPLICATE on create)", () => {
    const v = vendor();
    createPo("KS-DUP-1", v.id);
    expect(poCodeTaken(w.db, "ks-dup-1").taken).toBe(true);
    expect(() => createPo("KS-DUP-1", v.id)).toThrowError(/already exists/);
  });

  it("never accepts another client's vendor", () => {
    const other = vendor(w.otherClientId, "Beta Parts");
    expect(() => createPo("KS-X-1", other.id)).toThrowError(/vendor of this client/);
  });

  it("raises CONFLICT on a stale edit and logs header changes", () => {
    const po = createPo();
    const values = { ...poCreateSchema.parse({ warehouseId: w.warehouseId, clientId: w.clientId, code: po.code, poType: "Transfer Order", poDate: po.poDate, vendorId: po.vendorId, lines: po.lines.map((l) => ({ id: l.id, productId: l.productId, packType: l.packType, orderedQuantity: l.orderedQuantity, unitCost: l.unitCost })) }) };
    const updated = updatePurchaseOrder(w.db, w.ctx, auth.scope, po.id, { ...values, version: po.version });
    expect(updated.poType).toBe("Transfer Order");
    expect(() => updatePurchaseOrder(w.db, w.ctx, auth.scope, po.id, { ...values, version: po.version })).toThrowError();
  });
});

describe("receiving", () => {
  it("partial receive 6 of 10 with lot + expiry → Started, one receipt, inventory with the lot", () => {
    w.db.update(schema.products).set({ trackLot: true, trackExpiry: true }).where(eq(schema.products.id, w.productId)).run();
    const po = createPo();
    const line = po.lines.find((l) => l.productId === w.productId);
    if (!line) throw new Error("line missing");
    const expiry = new Date(Date.now() + 180 * 86_400_000).toISOString();
    const res = receivePurchaseOrder(w.db, w.ctx, auth.scope, po.id, receiveBody(line.id, 6, w.loc.storageA, { lotNumber: "L123", expiryDate: expiry }));
    expect(res.status).toBe("Started");
    const after = getPurchaseOrder(w.db, auth.scope, po.id);
    expect(after.status).toBe("Started");
    expect(after.lines.find((l) => l.id === line.id)?.receivedQuantity).toBe(6);
    const buckets = onHandAt(w.loc.storageA);
    expect(buckets.reduce((s, b) => s + b.onHand, 0)).toBe(6);
    expect(buckets[0]?.lotNumber).toBe("L123");
    const receipts = receiptsForPurchaseOrder(w.db, auth.scope, po.id);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.type).toBe("Purchase Order");
    expect(listReceipts(w.db, auth, EMPTY_GRID_QUERY).total).toBe(1);
    expect(ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("blocks a lot-tracked product without a lot (inline field error)", () => {
    w.db.update(schema.products).set({ trackLot: true }).where(eq(schema.products.id, w.productId)).run();
    const po = createPo();
    const line = po.lines.find((l) => l.productId === w.productId);
    if (!line) throw new Error("line missing");
    try {
      receivePurchaseOrder(w.db, w.ctx, auth.scope, po.id, receiveBody(line.id, 1, w.loc.storageA));
      expect.unreachable();
    } catch (error) {
      expect((error as { fieldErrors?: Record<string, string[]> }).fieldErrors?.["lines.0.lotNumber"]?.[0]).toMatch(/lot tracked/);
    }
  });

  it("requires an explicit confirm to over-receive", () => {
    const po = createPo();
    const line = po.lines[1];
    if (!line) throw new Error("line missing");
    expect(() => receivePurchaseOrder(w.db, w.ctx, auth.scope, po.id, receiveBody(line.id, 5, w.loc.storageA))).toThrowError(/remaining/);
    const ok = receivePurchaseOrder(w.db, w.ctx, auth.scope, po.id, { ...receiveBody(line.id, 5, w.loc.storageA), allowOverReceipt: true });
    expect(ok.receivedUnits).toBe(5);
  });

  it("cancel receipt reverses inventory; after a full receive it is blocked", () => {
    const po = createPo();
    const line = po.lines[0];
    if (!line) throw new Error("line missing");
    receivePurchaseOrder(w.db, w.ctx, auth.scope, po.id, receiveBody(line.id, 6, w.loc.storageA));
    const [receipt] = receiptsForPurchaseOrder(w.db, auth.scope, po.id);
    if (!receipt) throw new Error("receipt missing");
    cancelReceipt(w.db, w.ctx, auth.scope, receipt.id);
    expect(onHandAt(w.loc.storageA).reduce((s, b) => s + b.onHand, 0)).toBe(0);
    expect(getPurchaseOrder(w.db, auth.scope, po.id).lines[0]?.receivedQuantity).toBe(0);

    const full = receiveAll(w.db, w.ctx, auth.scope, po.id);
    expect(full.status).toBe("Completed");
    const done = getPurchaseOrder(w.db, auth.scope, po.id);
    expect(done.completedAt).not.toBeNull();
    expect(done.receivedAt).not.toBeNull();
    const active = receiptsForPurchaseOrder(w.db, auth.scope, po.id).find((r) => !r.cancelledAt);
    expect(active?.locationId).toBe(w.loc.receiving);
    expect(active?.cancelBlockedReason).toBe(CANCEL_COMPLETED_PO_MESSAGE);
    expect(() => cancelReceipt(w.db, w.ctx, auth.scope, active?.id ?? "")).toThrowError(CANCEL_COMPLETED_PO_MESSAGE);
    expect(ledger.reconcileLedger(w.db)).toEqual([]);
  });
});

describe("status guards", () => {
  it("cancels Pending, refuses to delete after receipts, and manual status changes follow the machine", () => {
    const v = vendor();
    const a = createPo("KS-A", v.id);
    cancelPurchaseOrder(w.db, w.ctx, auth.scope, a.id);
    expect(getPurchaseOrder(w.db, auth.scope, a.id).status).toBe("Cancelled");
    expect(() => cancelPurchaseOrder(w.db, w.ctx, auth.scope, a.id)).toThrowError(/can't be cancelled/);

    const b = createPo("KS-B", v.id);
    receiveAll(w.db, w.ctx, auth.scope, b.id);
    expect(() => deletePurchaseOrder(w.db, w.ctx, auth.scope, b.id)).toThrowError(/Only Pending/);

    const c = createPo("KS-C", v.id);
    const changed = changePurchaseOrderStatus(w.db, w.ctx, auth.scope, c.id, { status: "Completed", reason: "Closed by vendor", version: c.version });
    expect(changed.status).toBe("Completed");
    expect(changed.allowedStatuses).toEqual([]);

    const d = createPo("KS-D", v.id);
    deletePurchaseOrder(w.db, w.ctx, auth.scope, d.id);
    expect(() => getPurchaseOrder(w.db, auth.scope, d.id)).toThrowError();
  });
});

describe("vendors", () => {
  it("scopes the PO wizard list to the client and blocks deactivation with open POs", () => {
    const mine = vendor();
    vendor(w.otherClientId, "Beta Parts");
    const list = listVendors(w.db, auth, EMPTY_GRID_QUERY, { clientId: w.clientId, activeOnly: true });
    expect(list.rows.map((r) => r.displayName)).toEqual(["Acme Supply"]);
    const po = createPo("KS-V", mine.id);
    expect(() => setVendorActive(w.db, w.ctx, auth.scope, mine.id, false, mine.version)).toThrowError(/open purchase orders/);
    cancelPurchaseOrder(w.db, w.ctx, auth.scope, po.id);
    const off = setVendorActive(w.db, w.ctx, auth.scope, mine.id, false, mine.version);
    expect(off.isActive).toBe(false);
  });

  it("rejects duplicate display names per client and a client change on edit", () => {
    const v = vendor();
    expect(() => vendor()).toThrowError(/already exists/);
    expect(() => updateVendor(w.db, w.ctx, auth.scope, v.id, { ...vendorFormSchema.parse({ clientId: w.otherClientId, displayName: "X", vendorName: "X", useShipAsBilling: true, shipping: address }), version: v.version })).toThrowError(/can't be changed/);
    expect(vendorFormSchema.safeParse({ clientId: w.clientId, displayName: "", vendorName: "", useShipAsBilling: true, shipping: address }).error?.issues[0]?.message).toBe("Vendor display name is required");
  });
});
