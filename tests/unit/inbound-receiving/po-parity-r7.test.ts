/**
 * M05 round 7 (critic round 3, score 8): PO serial pre-advice import / removal, the
 * putaway-algorithm stamp when the drawer's suggestion predates the lot, Cancel order
 * short-closing a Started PO with receipts, the Actual Receiving Date entry after a cancelled
 * receipt, the one date-time rule, label expansion and the drawer's single Receive gate.
 */
import { and, eq, isNull, or } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { cancelPurchaseOrderOutcome, createPurchaseOrder, deletePurchaseOrder } from "@/server/repositories/purchase-orders-commands";
import { getPurchaseOrder, purchaseOrdersByIds, SHORT_CLOSE_HINT } from "@/server/repositories/purchase-orders";
import { putawayAlgorithmFor, receivePurchaseOrder, suggestForLine } from "@/server/repositories/purchase-orders-receive";
import { preAdviseSerial, preAdvisedByLine, preAdvisedCounts, removePreAdvisedSerials } from "@/server/repositories/purchase-orders-serials";
import { cancelReceipt } from "@/server/repositories/receipts";
import { createVendor } from "@/server/repositories/vendors";
import { handler as poSerialHandler } from "@/server/imports/handlers/po-serials";
import { poCreateSchema, receiveBodySchema } from "@/lib/grid-defs/receiving/po-schemas";
import { formatZoned } from "@/lib/grid-defs/receiving/zoned-time";
import { vendorFormSchema } from "@/lib/grid-defs/receiving/vendors";
import { expandLabels } from "@/components/receiving/po-label-print-modal";
import { receiveBlockedReason } from "@/components/receiving/receive-items-drawer";
import { cancelCopy, cancelReason, removeSerialsReason } from "@/components/receiving/po-list-page";
import type { PoLineRow } from "@/components/receiving/receiving-shared";
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
let vendorSeq = 0;
function createPo(code: string, qty = 10) {
  const v = createVendor(w.db, w.ctx, auth.scope, vendorFormSchema.parse({ clientId: w.clientId, displayName: `Acme ${++vendorSeq}`, vendorName: "Acme LLC", useShipAsBilling: true, shipping: address }));
  return createPurchaseOrder(w.db, w.ctx, auth.scope, poCreateSchema.parse({
    warehouseId: w.warehouseId, clientId: w.clientId, code, poType: "Purchase Order", poDate: "2026-11-09T15:00:00.000Z", vendorId: v.id,
    lines: [{ productId: w.productId, packType: "Each", orderedQuantity: qty, unitCost: 1 }],
  }));
}
const receive = (poId: string, lineId: string, quantity: number, locationId: string, extra: Record<string, unknown> = {}) =>
  receivePurchaseOrder(w.db, w.ctx, auth.scope, poId, receiveBodySchema.parse({ lines: [{ lineId, quantity, locationId, ...extra }] }));
const log = (id: string) => w.db.select().from(schema.changeLog).where(or(eq(schema.changeLog.entityId, id), eq(schema.changeLog.parentEntityId, id))).all();
const txnOf = (receiptId: string) => w.db.select().from(schema.inventoryTransactions).where(eq(schema.inventoryTransactions.receiptId, receiptId)).get();

describe("putaway algorithm stamp", () => {
  it("stamps a followed suggestion even when the drawer's suggestion predates the lot", () => {
    w.db.update(schema.products).set({ trackLot: true }).where(eq(schema.products.id, w.productId)).run();
    const po = createPo("KS-R7-ALG");
    const lineId = po.lines[0]?.id ?? "";
    const s = suggestForLine(w.db, auth.scope, po.id, lineId, 4, {});
    const top = s.suggestions[0];
    expect(top).toBeDefined();
    const r = receive(po.id, lineId, 4, top?.locationId ?? "", { lotNumber: "LOT-A", fromSuggestion: true, suggestBasis: { qty: 4, lot: null, expiry: null, damageReason: null } });
    expect(txnOf(r.receiptIds[0] ?? "")?.algorithmName).toBe(s.algorithm);
  });

  it("re-runs with the basis, then without lot / expiry, and returns null for a location the algorithm never suggests", () => {
    const po = createPo("KS-R7-ALG2");
    const line = w.db.select().from(schema.purchaseOrderLines).where(eq(schema.purchaseOrderLines.purchaseOrderId, po.id)).get();
    if (!line) throw new Error("line");
    const s = suggestForLine(w.db, auth.scope, po.id, line.id, 2, {});
    const hit = putawayAlgorithmFor(w.db, { warehouseId: w.warehouseId }, line, { quantity: 2, locationId: s.suggestions[0]?.locationId ?? "", lotNumber: "X", expiryDate: null, damageReason: null, suggestBasis: { qty: 2 } });
    expect(hit?.algorithmName).toBe(s.algorithm);
    expect(putawayAlgorithmFor(w.db, { warehouseId: w.warehouseId }, line, { quantity: 2, locationId: "no-such-location", lotNumber: null, expiryDate: null, damageReason: null })).toBeNull();
  });

  it("never stamps a line that did not follow the suggestion", () => {
    const po = createPo("KS-R7-ALG3");
    const lineId = po.lines[0]?.id ?? "";
    const top = suggestForLine(w.db, auth.scope, po.id, lineId, 1, {}).suggestions[0];
    const r = receive(po.id, lineId, 1, top?.locationId ?? "", { fromSuggestion: false });
    expect(txnOf(r.receiptIds[0] ?? "")?.algorithmName ?? null).toBeNull();
  });
});

describe("Cancel order short-closes a Started PO with receipts", () => {
  it("keeps the received stock and closes the PO as Completed with the reason logged", () => {
    const po = createPo("KS-R7-SC", 10);
    const lineId = po.lines[0]?.id ?? "";
    const r = receive(po.id, lineId, 4, w.loc.storageA);
    const out = cancelPurchaseOrderOutcome(w.db, w.ctx, auth.scope, po.id);
    expect(out.shortClosed).toBe(true);
    expect(out.cancelledUnits).toBe(6);
    expect(out.row.status).toBe("Completed");
    expect(out.row.receivedAt).not.toBeNull();
    const receipt = w.db.select().from(schema.receipts).where(and(eq(schema.receipts.id, r.receiptIds[0] ?? ""), isNull(schema.receipts.cancelledAt))).get();
    expect(receipt?.quantity).toBe(4);
    const stock = w.db.select().from(schema.inventory).where(and(eq(schema.inventory.productId, w.productId), eq(schema.inventory.locationId, w.loc.storageA))).get();
    expect(stock?.onHand).toBe(4);
    const entries = log(po.id);
    expect(entries.some((e) => e.field === "statusChangeReason" && /Open balance cancelled: 6 units/.test(e.toValue ?? ""))).toBe(true);
    expect(entries.filter((e) => e.field === "receivedAt")).toHaveLength(1);
  });

  it("still cancels a PO without receipts", () => {
    const po = createPo("KS-R7-C");
    const out = cancelPurchaseOrderOutcome(w.db, w.ctx, auth.scope, po.id);
    expect(out.shortClosed).toBe(false);
    expect(out.row.status).toBe("Cancelled");
  });

  it("points the status modal to Completed / short-close and lets the menu run", () => {
    const po = createPo("KS-R7-SC2");
    receive(po.id, po.lines[0]?.id ?? "", 1, w.loc.storageA);
    const d = getPurchaseOrder(w.db, auth.scope, po.id);
    expect(d.statusReasons.Cancelled).toBe(SHORT_CLOSE_HINT);
    const [row] = purchaseOrdersByIds(w.db, auth.scope, [po.id]);
    if (!row) throw new Error("row");
    expect(cancelReason([row])).toBeNull();
    expect(cancelCopy([row]).title).toMatch(/open balance/);
    expect(cancelCopy([{ ...row, activeReceipts: 0 }]).title).toBe(`Cancel ${row.code}?`);
  });
});

describe("Actual Receiving Date after a cancelled receipt", () => {
  it("logs (empty) --> date when the final receipt completes the PO", () => {
    const po = createPo("KS-R7-ARD", 5);
    const lineId = po.lines[0]?.id ?? "";
    const first = receive(po.id, lineId, 2, w.loc.storageA);
    cancelReceipt(w.db, w.ctx, auth.scope, first.receiptIds[0] ?? "");
    receive(po.id, lineId, 1, w.loc.storageA);
    const done = receive(po.id, lineId, 4, w.loc.storageA);
    expect(done.status).toBe("Completed");
    const entries = log(po.id).filter((l) => l.field === "receivedAt");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.fromValue).toBe("(empty)");
    expect(entries[0]?.message).toMatch(/^Actual Receiving Date is modified\. \(empty\) --> \d{4}\/\d{2}\/\d{2} /);
  });
});

describe("PO serial pre-advice", () => {
  const serialProduct = () => w.db.update(schema.products).set({ trackSerial: true }).where(eq(schema.products.id, w.productId)).run();

  it("attaches serials up to one per ordered unit and rejects duplicates and untracked SKUs", () => {
    const po = createPo("KS-R7-SN", 2);
    expect(() => preAdviseSerial(w.db, w.ctx, auth.scope, { poCode: po.code, sku: "MLT-WIDGET-01", serial: "SN-1" })).toThrowError(/not serial tracked/);
    serialProduct();
    preAdviseSerial(w.db, w.ctx, auth.scope, { poCode: po.code.toLowerCase(), sku: "mlt-widget-01", serial: "SN-1" });
    expect(() => preAdviseSerial(w.db, w.ctx, auth.scope, { poCode: po.code, sku: "MLT-WIDGET-01", serial: "sn-1" })).toThrowError(/already pre-advised/);
    preAdviseSerial(w.db, w.ctx, auth.scope, { poCode: po.code, sku: "MLT-WIDGET-01", serial: "SN-2" });
    expect(() => preAdviseSerial(w.db, w.ctx, auth.scope, { poCode: po.code, sku: "MLT-WIDGET-01", serial: "SN-3" })).toThrowError(/already has 2 serial numbers/);
    expect(() => preAdviseSerial(w.db, w.ctx, auth.scope, { poCode: "NOPE", sku: "MLT-WIDGET-01", serial: "SN-9" })).toThrowError(/not found/);
    expect(() => preAdviseSerial(w.db, w.ctx, auth.scope, { poCode: po.code, sku: "MLT-GADGET-02", serial: "SN-9" })).toThrowError(/not serial tracked|not on/);
    expect(preAdvisedCounts(w.db, [po.id]).get(po.id)).toBe(2);
    const lines = preAdvisedByLine(w.db, po.id);
    expect(lines.get(po.lines[0]?.id ?? "")?.map((x) => x.serial)).toEqual(["SN-1", "SN-2"]);
    expect(getPurchaseOrder(w.db, auth.scope, po.id).preAdvisedSerials).toBe(2);
    expect(log(po.id).filter((e) => /Serial/.test(e.message ?? "")).length).toBeGreaterThanOrEqual(2);
  });

  it("marks received serials, removes the pre-advice and lets a Pending PO with serials be deleted", () => {
    serialProduct();
    const po = createPo("KS-R7-SN2", 2);
    const lineId = po.lines[0]?.id ?? "";
    preAdviseSerial(w.db, w.ctx, auth.scope, { poCode: po.code, sku: "MLT-WIDGET-01", serial: "SN-A" });
    preAdviseSerial(w.db, w.ctx, auth.scope, { poCode: po.code, sku: "MLT-WIDGET-01", serial: "SN-B" });
    receive(po.id, lineId, 1, w.loc.storageA, { serials: ["SN-A"] });
    const flags = preAdvisedByLine(w.db, po.id).get(lineId)?.map((x) => [x.serial, x.received]);
    expect(flags).toEqual([["SN-A", true], ["SN-B", false]]);
    expect(removePreAdvisedSerials(w.db, w.ctx, auth.scope, po.id).removed).toBe(2);
    expect(() => removePreAdvisedSerials(w.db, w.ctx, auth.scope, po.id)).toThrowError(/no pre-advised/);
    // The received serial stays registered on its receipt.
    expect(w.db.select().from(schema.serialNumbers).where(eq(schema.serialNumbers.primarySerial, "SN-A")).get()).toBeDefined();

    const pending = createPo("KS-R7-SN3", 1);
    preAdviseSerial(w.db, w.ctx, auth.scope, { poCode: pending.code, sku: "MLT-WIDGET-01", serial: "SN-C" });
    deletePurchaseOrder(w.db, w.ctx, auth.scope, pending.id);
    expect(w.db.select().from(schema.purchaseOrderSerials).all().filter((s) => s.serial === "SN-C")).toHaveLength(0);
  });

  it("rejects a serial that already exists in stock, and runs through the import handler", () => {
    serialProduct();
    const po = createPo("KS-R7-SN4", 3);
    receive(po.id, po.lines[0]?.id ?? "", 1, w.loc.storageA, { serials: ["SN-X"] });
    expect(() => preAdviseSerial(w.db, w.ctx, auth.scope, { poCode: po.code, sku: "MLT-WIDGET-01", serial: "SN-X" })).toThrowError(/already exists/);
    expect(poSerialHandler.configured).toBe(true);
    const out = poSerialHandler.apply({ db: w.db, auth, actor: { userId: w.userId, source: "import" }, batchId: "b", rowNumber: 2 }, { poCode: po.code, sku: "MLT-WIDGET-01", serialNumber: "SN-Y" });
    expect(out.entityId).toBe(po.id);
    expect(out.message).toMatch(/SN-Y added to KS-R7-SN4/);
  });

  it("gates Remove serial number on selected POs having pre-advice", () => {
    expect(removeSerialsReason([{ preAdvisedSerials: 0 }])).toMatch(/pre-advised/);
    expect(removeSerialsReason([{ preAdvisedSerials: 0 }, { preAdvisedSerials: 3 }])).toBeNull();
  });
});

describe("one date-time rule", () => {
  it("formats instants in the warehouse zone, labelled", () => {
    expect(formatZoned("2026-11-10T06:02:44.000Z", "America/New_York")).toBe("2026/11/10 1:02 AM EST");
    expect(formatZoned("2026-11-10T05:59:03.000Z", "America/Chicago")).toBe("2026/11/09 11:59 PM CST");
    expect(formatZoned("2026-11-10T06:02:44.000Z", "Not/AZone")).toBe("2026/11/10 6:02 AM UTC");
    expect(formatZoned(null, "UTC")).toBe("");
  });
});

describe("label expansion", () => {
  const lines = [
    { poCode: "PO1", record: { sku: "A" }, ordered: 15, received: 4 },
    { poCode: "PO1", record: { sku: "B" }, ordered: 2, received: 0 },
  ];
  it("prints one label per line by default and per unit with Use as line quantity", () => {
    expect(expandLabels(lines, { useLineQty: false, basis: "ordered", copies: 1 }).labels).toBe(2);
    expect(expandLabels(lines, { useLineQty: false, basis: "ordered", copies: 3 }).labels).toBe(6);
    expect(expandLabels(lines, { useLineQty: true, basis: "ordered", copies: 1 }).labels).toBe(17);
    const received = expandLabels(lines, { useLineQty: true, basis: "received", copies: 1 });
    expect(received.labels).toBe(4);
    expect(received.records.every((r) => r.sku === "A")).toBe(true);
  });
});

describe("Receive gate", () => {
  const line = (over: Partial<PoLineRow> = {}): PoLineRow => ({
    id: "l1", productId: "p", sku: "CPL-BAG-MED-12", productName: "Bag", barcode: "", imageUrl: null, uom: "Each", packType: "Each", uomQuantity: 1,
    orderedQuantity: 10, receivedQuantity: 0, damagedQuantity: 0, unitCost: 1, totalPrice: 10, receivingLocationId: null, receivingLocationCode: null,
    lotNumber: null, expiryDate: null, productionDate: null, lpTypeId: null, lpTypeCode: null, lpNumber: null, note: null,
    tracking: { lot: true, expiry: false, production: false, serial: false }, version: 1, ...over,
  });
  const values = (over: Record<string, unknown> = {}) => ({
    allowOverReceipt: false, allowExpired: false,
    lines: [{ include: true, lineId: "l1", quantity: 2, locationId: "loc", locationCode: "A", lpMode: "none", lpId: null, lpLabel: null, lpTypeId: null, lotNumber: null, expiryDate: null, productionDate: null, damageReason: null, damageImageFileId: null, damageImageName: null, serials: [], note: null, fromSuggestion: false, suggestBasis: null, suggestedIds: [], ...over }],
  });
  it("blocks on a missing lot with the SKU named, the same way as an invalid quantity", () => {
    expect(receiveBlockedReason([line()], values())).toMatch(/CPL-BAG-MED-12 is lot tracked/);
    expect(receiveBlockedReason([line()], values({ quantity: 0, lotNumber: "L1" }))).toMatch(/^CPL-BAG-MED-12: Enter a quantity/);
    expect(receiveBlockedReason([line()], values({ lotNumber: "L1" }))).toBeNull();
    expect(receiveBlockedReason([line()], values({ lotNumber: "L1", quantity: 12 }))).toMatch(/Confirm the over-receipt/);
  });
});
