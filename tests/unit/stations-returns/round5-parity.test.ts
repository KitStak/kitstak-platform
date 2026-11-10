/**
 * Round 5 (parity loop): Return Process enforcement against what actually shipped (lot, expiry,
 * production date, serial, pack type), guarded short close + reopen, damaged-to-Picking guard,
 * RMA photo grouping, Packing Warnings on the pack screen, and the station capture model.
 */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { allocateOrders } from "@/server/domain/allocation";
import { createJobsFromOrders } from "@/server/domain/jobs";
import { ledger } from "@/server/domain/ledger";
import { createOrder } from "@/server/domain/orders";
import { shipOrders } from "@/server/domain/shipping";
import { execute } from "@/server/domain/tasks";
import { DEFAULT_RETURN_RULES } from "@/lib/grid-defs/admin/return-rules";
import { packContext } from "@/server/repositories/packing";
import { acknowledgeWarning, toPackingWarning } from "@/server/repositories/packing-warnings";
import { getReturnDetail, insertRma, type ScopedCtx } from "@/server/repositories/returns";
import { damagedTargetError, receiveManual, receiveManualSchema, receiveRma, receiveRmaSchema, reopenReturn, returnRuleErrors, shortfallOf } from "@/server/repositories/returns-receive";
import { shippedAttributes } from "@/server/repositories/returns-shipped";
import { itemsFromRma, itemsPayload, parseSerials, shortAfterReceive, validateItems } from "@/components/returns/return-station-model";
import { mapServerItemErrors, photoFileName } from "@/components/returns/return-receive-flow";
import { photoGroups } from "@/components/returns/rma-photos-model";
import { mediaKind, seenKey, warningDue, type PackWarningInfo } from "@/components/packing/pack-warning-model";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

let w: World;
let ctx: ScopedCtx;
beforeEach(() => { w = createWorld(); ctx = { ...w.ctx, scope: { warehouseIds: [w.warehouseId], clientIds: "all" } } as ScopedCtx; });
afterEach(() => w.close());

const track = (patch: Partial<typeof schema.products.$inferInsert>) => w.db.update(schema.products).set(patch).where(eq(schema.products.id, w.productId)).run();

/** Ships `qty` units from a stock bucket with the given attributes (pick → pack → ship). */
function shipped(qty: number, stock: { lotNumber?: string; expiryDate?: string; productionDate?: string } = {}): { orderId: string; lineId: string } {
  ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: qty + 2, ...stock });
  const o = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: qty }]));
  allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
  const { jobIds: [jobId] } = createJobsFromOrders(w.db, w.ctx, { orderIds: [o.id], jobTypeId: w.jobTypeId });
  for (const [type, loc] of [["Picking", w.loc.pick], ["Packing", w.loc.pack]] as const) {
    const ids = w.db.select().from(schema.tasks).where(and(eq(schema.tasks.jobId, jobId ?? ""), eq(schema.tasks.taskType, type))).all().map((t) => t.id);
    if (ids.length) execute(w.db, w.ctx, { taskIds: ids, targetLocationId: loc });
  }
  expect(shipOrders(w.db, w.ctx, { orderIds: [o.id], requireLabel: false }).failed).toEqual([]);
  const line = w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, o.id)).get();
  return { orderId: o.id, lineId: line?.id ?? "" };
}

const receive = (returnOrderId: string, item: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  receiveRma(w.db, ctx, receiveRmaSchema.parse({ returnOrderId, stationLocationId: w.loc.returns, items: [{ productId: w.productId, quantity: 1, disposition: "Restock", ...item }], ...extra }));

describe("Return Process: lot / expiry / production date match against the ledger", () => {
  it("reads the lot that actually shipped (order line had no requested lot) and rejects one that never shipped", () => {
    track({ trackLot: true });
    const { orderId, lineId } = shipped(2, { lotNumber: "LOT-A" });
    expect(w.db.select().from(schema.orderLines).where(eq(schema.orderLines.id, lineId)).get()?.lotNumber).toBeNull();
    expect(shippedAttributes(w.db, orderId).get(w.productId)?.lots).toEqual(["LOT-A"]);
    const rma = insertRma(w.db, ctx, { shipmentOrderId: orderId, lines: [{ orderLineId: lineId, quantity: 2 }] });
    expect(() => receive(rma.id, { lotNumber: "LOT-NEVER-SHIPPED" })).toThrow(/Lot LOT-NEVER-SHIPPED was not shipped/);
    // Blank lot on a tracked SKU: required while the match rule is on.
    expect(() => receive(rma.id, {})).toThrow(/Enter the lot number/);
    const ok = receive(rma.id, { lotNumber: "lot-a" }, { complete: false });
    expect(ok.status).toBe("Started");
    const detail = getReturnDetail(w.db, ctx.scope, rma.id);
    expect(detail.lines[0]?.trackLot).toBe(true);
    expect(detail.lines[0]?.shipped?.lots).toEqual(["LOT-A"]);
  });

  it("expiry and production dates must be ones that shipped (date part compared)", () => {
    track({ trackExpiry: true, trackProductionDate: true });
    const { orderId, lineId } = shipped(1, { expiryDate: "2027-03-31", productionDate: "2026-01-15" });
    const rma = insertRma(w.db, ctx, { shipmentOrderId: orderId, lines: [{ orderLineId: lineId, quantity: 1 }] });
    expect(() => receive(rma.id, { expiryDate: "2030-01-01", productionDate: "2026-01-15" })).toThrow(/Expiry date 2030-01-01 was not shipped/);
    expect(() => receive(rma.id, { expiryDate: "2027-03-31" })).toThrow(/Enter the production date/);
    expect(() => receive(rma.id, { expiryDate: "2027-03-31", productionDate: "2025-12-01" })).toThrow(/Production date 2025-12-01 was not shipped/);
    expect(receive(rma.id, { expiryDate: "2027-03-31T00:00:00.000Z", productionDate: "2026-01-15" }).status).toBe("Completed");
  });

  it("switching the rule off accepts any lot", () => {
    track({ trackLot: true });
    const { orderId, lineId } = shipped(1, { lotNumber: "LOT-A" });
    const errs = returnRuleErrors(w.db, { id: orderId, warehouseId: w.warehouseId }, w.warehouseId, [{ productId: w.productId, quantity: 1, lotNumber: "LOT-Z" }]);
    expect(errs["items.0.lotNumber"]?.[0]).toMatch(/Lot \/ batch number match/);
    w.db.update(schema.companySettings).set({ defaults: { returnRules: { ...DEFAULT_RETURN_RULES, lotNumberMatch: false } } as never }).run();
    void lineId;
    expect(returnRuleErrors(w.db, { id: orderId, warehouseId: w.warehouseId }, w.warehouseId, [{ productId: w.productId, quantity: 1, lotNumber: "LOT-Z" }])).toEqual({});
  });
});

describe("Return Process: serial and pack type match", () => {
  it("rejects a serial that never shipped on the order, keyed on the serials field", () => {
    const { orderId } = shipped(1);
    w.db.insert(schema.serialNumbers).values({ productId: w.productId, warehouseId: w.warehouseId, clientId: w.clientId, primarySerial: "SN-SHIPPED", status: "Shipped",
      orderLineId: w.db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, orderId)).get()?.id ?? null }).run();
    const errs = returnRuleErrors(w.db, { id: orderId, warehouseId: w.warehouseId }, w.warehouseId, [{ productId: w.productId, quantity: 1, serials: ["SN-NEVER"] }]);
    expect(errs["items.0.serials"]?.[0]).toMatch(/Serial SN-NEVER was not shipped/);
    expect(returnRuleErrors(w.db, { id: orderId, warehouseId: w.warehouseId }, w.warehouseId, [{ productId: w.productId, quantity: 1, serials: ["sn-shipped"] }])).toEqual({});
  });

  it("rejects a pack type other than the one shipped", () => {
    const { orderId } = shipped(1);
    const shippedPack = shippedAttributes(w.db, orderId).get(w.productId)?.packTypes[0] ?? "";
    expect(shippedPack).not.toBe("");
    const errs = returnRuleErrors(w.db, { id: orderId, warehouseId: w.warehouseId }, w.warehouseId, [{ productId: w.productId, quantity: 1, packType: "Case-of-12" }]);
    expect(errs["items.0.packType"]?.[0]).toMatch(/Pack type Case-of-12 was not shipped/);
    expect(returnRuleErrors(w.db, { id: orderId, warehouseId: w.warehouseId }, w.warehouseId, [{ productId: w.productId, quantity: 1, packType: shippedPack }])).toEqual({});
  });
});

describe("short close is confirmed, logged and reopenable", () => {
  it("Complete with units outstanding is refused until confirmed; then logged per line and reopenable", () => {
    const { orderId, lineId } = shipped(3);
    const rma = insertRma(w.db, ctx, { shipmentOrderId: orderId, lines: [{ orderLineId: lineId, quantity: 3 }] });
    expect(() => receive(rma.id, {})).toThrow(/2 units not received will be closed as short/);
    expect(getReturnDetail(w.db, ctx.scope, rma.id).receivedQty).toBe(0);
    const res = receive(rma.id, {}, { shortClose: true, shortCloseReason: "Customer kept 2" });
    expect(res.status).toBe("Completed");
    const d = getReturnDetail(w.db, ctx.scope, rma.id);
    expect(d.shortQty).toBe(2);
    expect(d.note).toMatch(/Short closed .*2 units not received \(Customer kept 2\)/);
    const log = w.db.select().from(schema.changeLog).where(and(eq(schema.changeLog.parentEntityId, rma.id), eq(schema.changeLog.field, "shortClosedQty"))).all();
    expect(log.map((l) => [l.fromValue, l.toValue])).toEqual([["0", "2"]]);
    // Reopen → Started; the rest can be received.
    const re = reopenReturn(w.db, ctx, rma.id, { reason: "Second box arrived" });
    expect(re).toMatchObject({ status: "Started", reopenedUnits: 2 });
    expect(receive(rma.id, { quantity: 2 }).status).toBe("Completed");
    expect(getReturnDetail(w.db, ctx.scope, rma.id).shortQty).toBe(0);
    const all = w.db.select().from(schema.changeLog).where(and(eq(schema.changeLog.parentEntityId, rma.id), eq(schema.changeLog.field, "shortClosedQty"))).all();
    expect(all.map((l) => [l.fromValue, l.toValue])).toEqual([["0", "2"], ["2", "0"]]);
    expect(() => reopenReturn(w.db, ctx, rma.id, { reason: "again" })).toThrow(/nothing to reopen/);
    expect(ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("only a Completed RMA can be reopened", () => {
    const { orderId, lineId } = shipped(1);
    const rma = insertRma(w.db, ctx, { shipmentOrderId: orderId, lines: [{ orderLineId: lineId, quantity: 1 }] });
    expect(() => reopenReturn(w.db, ctx, rma.id, { reason: "x" })).toThrow(/Only a completed return can be reopened/);
  });

  it("shortfallOf counts what this receive leaves outstanding", () => {
    const lines = [{ id: "a", requestedQty: 3, returnedQty: 1, sku: "A" }, { id: "b", requestedQty: 1, returnedQty: 1, sku: "B" }];
    expect(shortfallOf(lines, new Map([["a", 1]]))).toEqual({ total: 1, lines: [{ id: "a", sku: "A", short: 1 }] });
    expect(shortfallOf(lines, new Map([["a", 2]])).total).toBe(0);
  });
});

describe("damaged returns never land in a Picking face", () => {
  it("refuses Damaged into a Picking location, allows Storage and the station", () => {
    const { orderId, lineId } = shipped(2);
    const rma = insertRma(w.db, ctx, { shipmentOrderId: orderId, lines: [{ orderLineId: lineId, quantity: 2 }] });
    const reason = w.db.insert(schema.lookupValues).values({ type: "damage_reason", name: "Crushed" }).returning().get();
    expect(() => receive(rma.id, { disposition: "Damaged", damageReasonId: reason.id }, { targetLocationId: w.loc.storageB, complete: false })).toThrow(/can't be received into Picking location/);
    expect(receive(rma.id, { disposition: "Damaged", damageReasonId: reason.id }, { targetLocationId: w.loc.storageA, complete: false }).status).toBe("Started");
    // Restock into Picking stays allowed.
    expect(receive(rma.id, {}, { targetLocationId: w.loc.storageB }).status).toBe("Completed");
    expect(damagedTargetError("Restock", { targetAreaType: "Picking", targetCode: "P" })).toBeNull();
  });

  it("Return Manually applies the same guard", () => {
    const reason = w.db.insert(schema.lookupValues).values({ type: "damage_reason", name: "Wet" }).returning().get();
    expect(() => receiveManual(w.db, ctx, receiveManualSchema.parse({ warehouseId: w.warehouseId, clientId: w.clientId, stationLocationId: w.loc.returns, targetLocationId: w.loc.storageB,
      items: [{ productId: w.productId, quantity: 1, disposition: "Damaged", damageReasonId: reason.id }] }))).toThrow(/Picking location/);
  });
});

describe("Packing Warnings", () => {
  it("packContext carries the order's warning; acknowledgement is change-logged on the order", () => {
    ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 3 });
    const o = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
    const { jobIds: [jobId] } = createJobsFromOrders(w.db, w.ctx, { orderIds: [o.id], jobTypeId: w.jobTypeId });
    const picks = w.db.select().from(schema.tasks).where(and(eq(schema.tasks.jobId, jobId ?? ""), eq(schema.tasks.taskType, "Picking"))).all().map((t) => t.id);
    execute(w.db, w.ctx, { taskIds: picks, targetLocationId: w.loc.pick });
    const wt = w.db.insert(schema.lookupValues).values({ type: "packing_warning_type", name: "Fragile", meta: { warningText: "Bubble wrap every unit", showWhen: "close_pack", skipConfirmation: false, mediaLinks: ["https://cdn.example.com/wrap.png", "javascript:alert(1)"] } }).returning().get();
    w.db.update(schema.shipmentOrders).set({ packingWarningTypeId: wt.id }).where(eq(schema.shipmentOrders.id, o.id)).run();
    const pw = packContext(w.db, ctx.scope, o.id).packingWarning;
    expect(pw).toMatchObject({ name: "Fragile", text: "Bubble wrap every unit", trigger: "close_pack", triggerLabel: "Close pack is triggered", skipConfirmation: false, mediaLinks: ["https://cdn.example.com/wrap.png"] });
    acknowledgeWarning(w.db, ctx, { orderId: o.id, warningTypeId: wt.id, trigger: "close_pack", stationId: w.loc.pack });
    const row = w.db.select().from(schema.changeLog).where(and(eq(schema.changeLog.entityId, o.id), eq(schema.changeLog.field, "packingWarningAcknowledged"))).get();
    expect(row?.message).toMatch(/Packing warning "Fragile" is acknowledged by the packer \(Close pack is triggered at PACK-01\)/);
    // A stale warning id is refused.
    expect(() => acknowledgeWarning(w.db, ctx, { orderId: o.id, warningTypeId: w.productId, trigger: "close_pack" })).toThrow(/has changed/);
    // Inactive types are not shown.
    w.db.update(schema.lookupValues).set({ isActive: false }).where(eq(schema.lookupValues.id, wt.id)).run();
    expect(packContext(w.db, ctx.scope, o.id).packingWarning).toBeNull();
  });

  it("toPackingWarning defaults and the client gate", () => {
    const pw = toPackingWarning({ id: "w1", name: "Gift", meta: null });
    expect(pw).toMatchObject({ text: "This order is marked \"Gift\". Pack it accordingly.", trigger: "order_displayed", skipConfirmation: false, mediaLinks: [] });
    const info: PackWarningInfo = { ...pw };
    expect(warningDue(info, "order_displayed", new Set())).toBe(true);
    expect(warningDue(info, "close_pack", new Set())).toBe(false);
    expect(warningDue(info, "order_displayed", new Set([seenKey(info)]))).toBe(false);
    expect(warningDue(null, "order_displayed", new Set())).toBe(false);
    expect(mediaKind("https://x/y.JPG?v=1")).toBe("image");
    expect(mediaKind("https://x/clip.mp4")).toBe("video");
    expect(mediaKind("https://x/guide")).toBe("link");
  });
});

describe("station capture model (tracking, short close, errors) and photos", () => {
  const line = { id: "l1", productId: "p1", sku: "SKU-1", name: "One", imageUrl: null, requestedQty: 3, returnedQty: 0, trackLot: true, trackSerial: true,
    shipped: { lots: ["LOT-A"], expiryDates: [], productionDates: [], packTypes: ["Each"], serials: ["S1", "S2", "S3"] } };

  it("prefills a single shipped lot and validates lot / serials against what shipped", () => {
    const [item] = itemsFromRma([line]);
    expect(item?.lotNumber).toBe("LOT-A");
    const scanned = [{ ...item!, quantity: 2, lotNumber: "LOT-X", serials: ["S1"] }];
    const v = validateItems(scanned, DEFAULT_RETURN_RULES);
    expect(v.errors.l1).toMatchObject({ lotNumber: "LOT-X was not shipped on the order", serials: "Scan 2 serials (one per unit); 1 entered" });
    const v2 = validateItems([{ ...item!, quantity: 1, serials: ["S9"] }], DEFAULT_RETURN_RULES);
    expect(v2.errors.l1?.serials).toMatch(/S9 was not shipped/);
    expect(validateItems([{ ...item!, quantity: 1, serials: ["s1"] }], DEFAULT_RETURN_RULES).message).toBeNull();
    expect(itemsPayload([{ ...item!, quantity: 1, serials: ["S1"] }], true)[0]).toMatchObject({ lotNumber: "LOT-A", serials: ["S1"] });
    expect(parseSerials("S1, S2\nS2;S3")).toEqual(["S1", "S2", "S3"]);
  });

  it("reports the shortfall Complete would close, and maps server item errors onto rows", () => {
    const [item] = itemsFromRma([line]);
    const items = [{ ...item!, quantity: 1 }];
    expect(shortAfterReceive(items)).toEqual({ total: 2, lines: [{ sku: "SKU-1", short: 2 }] });
    expect(mapServerItemErrors(items, { "items.0.lotNumber": ["Lot X was not shipped"], "items.5.serials": ["ignored"] })).toEqual({ l1: { lotNumber: "Lot X was not shipped" } });
  });

  it("groups RMA photos by line from the SKU file-name prefix", () => {
    const att = (id: string, fileName: string, mime = "image/jpeg") => ({ id, documentType: "Other", fileId: `f-${id}`, fileName, mime, createdAt: "2026-11-10T00:00:00Z" });
    expect(photoFileName("SKU-1", "box.jpg")).toBe("SKU-1 · box.jpg");
    const groups = photoGroups([att("1", photoFileName("SKU-10", "a.jpg")), att("2", photoFileName("SKU-1", "b.jpg")), att("3", "invoice.pdf", "application/pdf")], ["SKU-1", "SKU-10"]);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.displayName)])).toEqual([["Line SKU-1", ["b.jpg"]], ["Line SKU-10", ["a.jpg"]], ["General", ["invoice.pdf"]]]);
    expect(groups[2]?.items[0]?.isImage).toBe(false);
  });
});
