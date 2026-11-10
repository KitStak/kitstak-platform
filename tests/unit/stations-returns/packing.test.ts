/** M04 Packing Station: scan resolution, pack context, validation, Complete (multi-box), Report Issue. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { Scope } from "@/server/auth/scope";
import { allocateOrders } from "@/server/domain/allocation";
import { createJobsFromOrders } from "@/server/domain/jobs";
import { ledger } from "@/server/domain/ledger";
import { createOrder } from "@/server/domain/orders";
import { execute } from "@/server/domain/tasks";
import { completePacking, completePackingSchema, packContext, reportIssue, validatePackages, type PackLine } from "@/server/repositories/packing";
import { packingKpis, packingStations, readyToPackOrders, resolveScan } from "@/server/repositories/packing-scan";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

let w: World;
let scope: Scope;
const previousFilesDir = process.env.KITSTAK_FILES_DIR;

beforeEach(() => {
  w = createWorld();
  process.env.KITSTAK_FILES_DIR = w.filesRoot;
  scope = { warehouseIds: [w.warehouseId], clientIds: "all" } as unknown as Scope;
});
afterEach(() => {
  w.close();
  process.env.KITSTAK_FILES_DIR = previousFilesDir;
});

const ctx = () => ({ ...w.ctx, scope });
const order = (id: string) => w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, id)).get();

/** Allocated + picked to the tote location, Packing tasks still pending -> Ready to Pack. */
function readyToPack(lines: { productId: string; quantity: number }[]): string {
  for (const l of lines) ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: l.productId, locationId: w.loc.storageA, qty: l.quantity + 2 });
  const o = createOrder(w.db, w.ctx, orderInput(w, lines));
  allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
  const { jobIds: [jobId] } = createJobsFromOrders(w.db, w.ctx, { orderIds: [o.id], jobTypeId: w.jobTypeId });
  const tasks = w.db.select().from(schema.tasks).where(eq(schema.tasks.jobId, jobId)).all();
  execute(w.db, w.ctx, { taskIds: tasks.filter((t) => t.taskType === "Picking").map((t) => t.id), targetLocationId: w.loc.pick });
  return o.id;
}

const line = (over: Partial<PackLine>): PackLine => ({
  orderLineId: "l1", productId: "p1", sku: "SKU-1", name: "n", imageUrl: null, packType: "Each", ordered: 2, toPack: 2, packed: 0, weightOz: 8,
  scanCodes: ["sku-1"], trackSerial: false, captureLot: false, captureExpiry: false, lotNumber: null, expiryDate: null, pickedSerials: [], packingInstructions: null,
  ...over,
});
const pkg = (items: { orderLineId: string; qty: number }[]) => ({ shipmentPackageId: null, length: 10, width: 8, height: 4, weightOz: 20, items });

describe("validatePackages", () => {
  it("blocks over-pack, short pack and unknown items", () => {
    const lines = [line({})];
    expect(() => validatePackages(lines, { packages: [pkg([{ orderLineId: "l1", qty: 3 }])], captures: [] })).toThrow(/Over-packing is blocked/);
    expect(() => validatePackages(lines, { packages: [pkg([{ orderLineId: "l1", qty: 1 }])], captures: [] })).toThrow(/Pack every item/);
    expect(() => validatePackages(lines, { packages: [pkg([{ orderLineId: "zz", qty: 1 }])], captures: [] })).toThrow(/not on this order/);
    expect(() => validatePackages(lines, { packages: [pkg([{ orderLineId: "l1", qty: 1 }]), pkg([{ orderLineId: "l1", qty: 1 }])], captures: [] })).not.toThrow();
  });

  it("requires serials, unique and picked, plus lot/expiry when captured during packing", () => {
    const serial = [line({ trackSerial: true, pickedSerials: ["S1", "S2"] })];
    const two = [pkg([{ orderLineId: "l1", qty: 2 }])];
    expect(() => validatePackages(serial, { packages: two, captures: [{ orderLineId: "l1", serials: ["S1"] }] })).toThrow(/scan 2 serial/);
    expect(() => validatePackages(serial, { packages: two, captures: [{ orderLineId: "l1", serials: ["S1", "s1"] }] })).toThrow(/scanned twice/);
    expect(() => validatePackages(serial, { packages: two, captures: [{ orderLineId: "l1", serials: ["S1", "S9"] }] })).toThrow(/S9 was not picked/);
    expect(() => validatePackages(serial, { packages: two, captures: [{ orderLineId: "l1", serials: ["S2", "S1"] }] })).not.toThrow();
    const lot = [line({ captureLot: true, captureExpiry: true })];
    expect(() => validatePackages(lot, { packages: two, captures: [] })).toThrow(/lot number/);
    expect(() => validatePackages(lot, { packages: two, captures: [{ orderLineId: "l1", serials: [], lotNumber: "L1" }] })).toThrow(/expiry/);
  });

  it("schema requires carrier and service when a label is wanted", () => {
    const base = { orderId: "o", stationId: "s", packages: [pkg([{ orderLineId: "l1", qty: 1 }])] };
    expect(completePackingSchema.safeParse(base).success).toBe(false);
    expect(completePackingSchema.safeParse({ ...base, withLabel: false }).success).toBe(true);
  });
});

describe("scan and list", () => {
  it("lists packing stations and resolves location/order scans with Logiwa errors", () => {
    expect(packingStations(w.db, scope, w.warehouseId).map((s) => s.code)).toContain("PACK-01");
    const id = readyToPack([{ productId: w.productId, quantity: 2 }]);
    const code = order(id)?.code as string;
    const byLoc = resolveScan(w.db, scope, { warehouseId: w.warehouseId, mode: "location", code: "TOTE-01" });
    expect(byLoc.orders.map((o) => o.id)).toEqual([id]);
    expect(byLoc.orders[0]?.unitsToPack).toBe(2);
    expect(resolveScan(w.db, scope, { warehouseId: w.warehouseId, mode: "order", code: code.toLowerCase() }).orders[0]?.packable).toBe(true);
    expect(() => resolveScan(w.db, scope, { warehouseId: w.warehouseId, mode: "location", code: "A-02-01" })).toThrow(/No allocated order found/);
    expect(() => resolveScan(w.db, scope, { warehouseId: w.warehouseId, mode: "order", code: "SO-NOPE" })).toThrow(/No order found/);
    expect(() => resolveScan(w.db, scope, { warehouseId: w.warehouseId, mode: "tote", code: "LP-NOPE" })).toThrow(/No tote found/);
    expect(readyToPackOrders(w.db, scope, { warehouseId: w.warehouseId }).map((r) => r.code)).toEqual([code]);
    expect(packingKpis(w.db, scope, w.warehouseId, w.userId).ordersToPack).toBe(1);
  });

  it("hides other warehouses (scope)", () => {
    const other = { warehouseIds: ["elsewhere"], clientIds: "all" } as unknown as Scope;
    expect(() => packingStations(w.db, other, w.warehouseId)).toThrow();
  });
});

describe("complete packing", () => {
  it("packs into two boxes: ledger Packing, master + child labels, Ready to Ship", async () => {
    const id = readyToPack([{ productId: w.productId, quantity: 1 }, { productId: w.product2Id, quantity: 1 }]);
    const c = packContext(w.db, scope, id);
    expect(c.lines).toHaveLength(2);
    const [a, b] = c.lines;
    if (!a || !b) throw new Error("lines");
    const res = await completePacking(w.db, ctx(), completePackingSchema.parse({
      orderId: id, stationId: w.loc.pack, version: c.order.version, carrierConnectionId: w.carrierConnectionId, carrierServiceId: w.serviceIds.ground,
      packages: [pkg([{ orderLineId: a.orderLineId, qty: 1 }]), pkg([{ orderLineId: b.orderLineId, qty: 1 }])],
    }));
    expect(res.labelError).toBeNull();
    expect(res.status).toBe("Ready to Ship");
    expect(res.packedUnits).toBe(2);
    expect(res.shipments).toHaveLength(2);
    expect(res.masterTrackingNumber).toBeTruthy();
    expect(res.shipments.every((s) => s.masterTrackingNumber === res.masterTrackingNumber)).toBe(true);
    expect(new Set(res.shipments.map((s) => s.trackingNumber)).size).toBe(2);
    const txns = w.db.select().from(schema.inventoryTransactions).where(eq(schema.inventoryTransactions.orderId, id)).all();
    expect(txns.filter((t) => t.type === "Packing")).toHaveLength(2);
    expect(ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("rejects a stale version and a second completion", async () => {
    const id = readyToPack([{ productId: w.productId, quantity: 1 }]);
    const c = packContext(w.db, scope, id);
    const body = { orderId: id, stationId: w.loc.pack, withLabel: false, packages: [pkg([{ orderLineId: c.lines[0]?.orderLineId as string, qty: 1 }])] };
    await expect(completePacking(w.db, ctx(), completePackingSchema.parse({ ...body, version: c.order.version + 5 }))).rejects.toThrow(/changed since you opened it/);
    const ok = await completePacking(w.db, ctx(), completePackingSchema.parse(body));
    expect(ok.status).toBe("Ready to Ship");
    await expect(completePacking(w.db, ctx(), completePackingSchema.parse(body))).rejects.toThrow(/can't be packed/);
  });
});

describe("report issue", () => {
  it("moves picked stock to the hospital location and opens Pack Short", () => {
    const id = readyToPack([{ productId: w.productId, quantity: 2 }]);
    const res = w.db.transaction((tx) => reportIssue(tx, ctx(), { orderId: id, hospitalLocationId: w.loc.returns, note: "Box crushed" }));
    expect(res.movedUnits).toBe(2);
    expect(res.hospitalCode).toBe("RET-01");
    expect(order(id)?.packShortStatus).toBe("Open");
    const atHospital = w.db.select().from(schema.inventory).where(eq(schema.inventory.locationId, w.loc.returns)).all().reduce((s, r) => s + r.onHand, 0);
    expect(atHospital).toBe(2);
    expect(() => w.db.transaction((tx) => reportIssue(tx, ctx(), { orderId: id, hospitalLocationId: w.loc.returns, note: "again" }))).toThrow(/No picked stock/);
    expect(ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("keeps a pack-short-open order out of scans, List & Select and Complete", async () => {
    const id = readyToPack([{ productId: w.productId, quantity: 1 }]);
    const code = order(id)?.code as string;
    const c = packContext(w.db, scope, id);
    w.db.transaction((tx) => reportIssue(tx, ctx(), { orderId: id, hospitalLocationId: w.loc.returns, note: "Torn" }));
    expect(() => resolveScan(w.db, scope, { warehouseId: w.warehouseId, mode: "order", code })).toThrow(/open pack short issue/);
    expect(readyToPackOrders(w.db, scope, { warehouseId: w.warehouseId })).toEqual([]);
    const body = { orderId: id, stationId: w.loc.pack, withLabel: false, packages: [pkg([{ orderLineId: c.lines[0]?.orderLineId as string, qty: 1 }])] };
    await expect(completePacking(w.db, ctx(), completePackingSchema.parse(body))).rejects.toThrow(/open pack short issue/);
  });
});
