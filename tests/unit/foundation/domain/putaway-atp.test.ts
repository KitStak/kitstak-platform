/** Putaway suggestions, dynamic replenishment, ATP, address verification, stubs. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { normalizeCountry, normalizeState, verifyAddress, verifyWithCarrier } from "@/server/domain/address-verification";
import { allocateOrders } from "@/server/domain/allocation";
import { computeAtp, getAtp } from "@/server/domain/atp";
import * as domain from "@/server/domain";
import { ledger } from "@/server/domain/ledger";
import { createOrder } from "@/server/domain/orders";
import { findPutawayAction, PUTAWAY_ACTIONS } from "@/server/domain/putaway-actions";
import { dynamicReplenishmentTargets, suggestLocations } from "@/server/domain/putaway";
import { createCountPlanFromWave } from "@/server/repositories/counts-commands";
import { allocateWorkOrder } from "@/server/repositories/work-orders-commands";
import { getWorkflowActionExecutor } from "@/server/workflows/actions";
import { createWorld, locationRow, orderInput, type World } from "./fixtures";

let w: World;
beforeEach(() => { w = createWorld(); });
afterEach(() => w.close());

const stock = (qty: number, locationId: string, extra: Record<string, unknown> = {}, productId = w.productId) =>
  ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId, locationId, qty, ...extra }).bucket;
const suggest = (extra: Record<string, unknown> = {}) =>
  suggestLocations(w.db, { warehouseId: w.warehouseId, productId: w.productId, qty: 2, isReceiving: true, fromLocationId: w.loc.receiving, ...extra });

describe("putaway", () => {
  it("lists all 38 actions and resolves them by key or label", () => {
    expect(PUTAWAY_ACTIONS).toHaveLength(38);
    expect(new Set(PUTAWAY_ACTIONS.map((a) => a.key)).size).toBe(38);
    expect(findPutawayAction("Suggest an empty location")?.key).toBe("suggestEmptyLocation");
    expect(findPutawayAction("suggestSameSku")?.label).toBe("Suggest a location that has the same SKU");
    expect(findPutawayAction("nope")).toBeUndefined();
  });

  it("falls back to default rules: same SKU first, then empty locations", () => {
    expect(suggest().rule).toBe("Default Empty Location");
    stock(1, w.loc.storageB);
    const r = suggest();
    expect(r.rule).toBe("Default Same SKU");
    expect(r.suggestions[0]).toMatchObject({ locationId: w.loc.storageB, score: 100 });
    expect(r.suggestions[0].reasons).toContain("Suggest a location that has the same SKU");
    const dmg = suggest({ damageReason: "Wet" });
    expect(dmg.suggestions.map((s) => s.code)).toEqual(["DMG-01"]);
    expect(() => suggest({ qty: 0 })).toThrow(/positive/);
    expect(() => suggestLocations(w.db, { warehouseId: w.warehouseId, productId: "x", qty: 1, isReceiving: false })).toThrow(/Product not found/);
  });

  it("walks an algorithm rule chain with conditions, actions and order-by", () => {
    const zone = w.db.insert(schema.lookupValues).values({ type: "location_zone", name: "Bulk", warehouseId: w.warehouseId }).returning().get();
    const bulk1 = w.db.insert(schema.locations).values(locationRow(w.warehouseId, "BULK-1", { locationZoneId: zone.id, abcCode: "A", volume: 1000, walkingPathPriority: 50 })).returning().get().id;
    const bulk2 = w.db.insert(schema.locations).values(locationRow(w.warehouseId, "BULK-2", { locationZoneId: zone.id, abcCode: "A", volume: 1000, walkingPathPriority: 40 })).returning().get().id;
    const algo = w.db.insert(schema.algorithms).values({ name: "Put", warehouseId: w.warehouseId, kind: "Putaway" }).returning().get();
    w.db.insert(schema.algorithmRules).values([
      { algorithmId: algo.id, sequence: 1, name: "Receiving to bulk", conditions: [{ field: "isReceivingProcess", comparator: "equals", value: true }],
        actions: [{ action: "suggestLocationZone", value: [zone.id] }, { action: "Suggest a location with the selected ABC Code", value: "A" }, { action: "configureVolumetricPutaway" }, { action: "checkSameClient" }, { action: "unknownThing" }],
        orderBy: [{ field: "walkingPathPriority", dir: "desc" }] },
      { algorithmId: algo.id, sequence: 2, name: "Exact", conditions: [], actions: [{ action: "suggestExactLocation", value: "A-02-01" }], orderBy: [] },
    ]).run();
    const r = suggest();
    expect(r.algorithm).toBe("Put");
    expect(r.suggestions.map((s) => s.locationId)).toEqual([bulk1, bulk2]);
    expect(r.trace.some((t) => t.message.includes("Unknown action"))).toBe(true);
    const moving = suggest({ isReceiving: false });
    expect(moving.rule).toBe("Exact");
    expect(moving.trace[0]).toMatchObject({ matched: false });
    expect(moving.suggestions[0].code).toBe("A-02-01");
    expect(() => suggest({ algorithmId: "nope" })).toThrow(/not found/);
  });

  it("evaluates check actions against location contents", () => {
    const ctxFor = (code: string, extra: Partial<typeof schema.locations.$inferInsert> = {}) => w.db.insert(schema.locations).values(locationRow(w.warehouseId, code, extra)).returning().get().id;
    const capped = ctxFor("CAPX", { capacityType: "Maximum Unit Quantity", maxCapacityQty: 3 });
    stock(2, capped);
    const algo = w.db.insert(schema.algorithms).values({ name: "Checks", warehouseId: w.warehouseId, kind: "Putaway" }).returning().get();
    const rule = (name: string, actions: { action: string; value?: unknown }[]) => w.db.insert(schema.algorithmRules).values({ algorithmId: algo.id, sequence: 1, name, conditions: [], actions, orderBy: [] }).run();
    rule("cap", [{ action: "suggestExactLocation", value: [capped] }, { action: "checkLocationCapacity" }, { action: "checkLocationCapacityType" }, { action: "checkMaxSkuCount" },
      { action: "checkSameLotBatchNumber" }, { action: "checkSameExpiryDate" }, { action: "checkSameDamagedReason" }, { action: "checkSameProductionDate" },
      { action: "checkSameReceivingDate" }, { action: "checkSameProductGroup" }, { action: "checkSameProductType" }, { action: "checkAssignedSkus" }, { action: "checkMaxLocationsPerSku", value: 1 },
      { action: "suggestSameSkuSamePackType" }, { action: "suggestSelectedPackType" }]);
    expect(suggestLocations(w.db, { warehouseId: w.warehouseId, productId: w.productId, qty: 1, isReceiving: true, algorithmId: algo.id }).suggestions.map((s) => s.locationId)).toEqual([capped]);
    const over = suggestLocations(w.db, { warehouseId: w.warehouseId, productId: w.productId, qty: 2, isReceiving: true, algorithmId: algo.id });
    expect(over.suggestions).toEqual([]);
    expect(over.trace[0].message).toMatch(/No location/);
  });

  it("computes dynamic replenishment targets", () => {
    w.db.insert(schema.productReplenishmentLevels).values({ productId: w.productId, warehouseId: w.warehouseId, minLevel: 2, maxLevel: 10 }).run();
    w.db.update(schema.products).set({ replenishmentMax: 4, replenishmentMin: 1 }).where(eq(schema.products.id, w.product2Id)).run();
    stock(3, w.loc.storageB);
    stock(20, w.loc.storageA);
    const o = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 5 }]));
    expect(o.status).toBe("Open");
    const jobId = crypto.randomUUID();
    w.db.insert(schema.jobs).values({ id: jobId, code: "J1", warehouseId: w.warehouseId, jobType: "R", status: "Pending" }).run();
    w.db.insert(schema.tasks).values({ taskNo: 1, jobId, warehouseId: w.warehouseId, taskType: "Replenishment", productId: w.productId, plannedQty: 4, actualQty: 1 }).run();
    const rows = dynamicReplenishmentTargets(w.db, w.warehouseId);
    const widget = rows.find((r) => r.productId === w.productId);
    expect(widget).toMatchObject({ max: 10, openOrderQty: 5, targetAvailable: 3, openTaskQty: 3, toReplenish: 9 });
    expect(rows.find((r) => r.productId === w.product2Id)?.toReplenish).toBe(4);
    expect(dynamicReplenishmentTargets(w.db, w.warehouseId, { onlyNeeded: true })).toHaveLength(2);
    expect(dynamicReplenishmentTargets(w.db, "none")).toHaveLength(1);
  });
});

describe("ATP", () => {
  it("computes the formulas from components", () => {
    expect(computeAtp({ productId: "p", warehouseId: "w", clientId: "c", total: 10, damaged: 2, allocatedSo: 3, openSo: 5, openPo: 4, onHand: 7, pickable: 2 }))
      .toMatchObject({ undamaged: 8, currentAtp: 3, plannedAtp: 7, sellable: 2, unallocatedSo: 2 });
  });

  it("aggregates stock, demand and supply from the database", () => {
    stock(6, w.loc.storageA);
    stock(2, w.loc.damaged, { damageReason: "Wet" });
    stock(3, w.loc.pick);
    const o = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 4 }]));
    allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
    const po = w.db.insert(schema.purchaseOrders).values({ code: "PO7", warehouseId: w.warehouseId, clientId: w.clientId, vendorName: "V", status: "Pending", totalQuantity: 5, purchasePrice: 1 }).returning().get();
    w.db.insert(schema.purchaseOrderLines).values({ purchaseOrderId: po.id, productId: w.productId, orderedQuantity: 5, unitCost: 1 }).run();
    const [row] = getAtp(w.db, { productIds: [w.productId] });
    expect(row).toMatchObject({ total: 11, damaged: 2, allocatedSo: 4, openSo: 4, openPo: 5, undamaged: 9, currentAtp: 5, plannedAtp: 10, pickable: 2, onHand: 9 });
    expect(getAtp(w.db, { warehouseIds: [] })).toEqual([]);
    expect(getAtp(w.db, { clientIds: [w.otherClientId] })).toEqual([]);
  });
});

describe("address verification", () => {
  it("normalizes and flags", () => {
    expect(normalizeState("Arkansas")).toBe("AR");
    expect(normalizeState("tn.")).toBe("TN");
    expect(normalizeState("")).toBeNull();
    expect(normalizeCountry("u.s.a.")).toBe("United States");
    const po = verifyAddress({ line1: "PO Box 12", city: "Memphis", state: "TN", postalCode: "38118", country: "US" });
    expect(po).toMatchObject({ status: "Partially Verified", isPoBox: true });
    const apo = verifyAddress({ line1: "Unit 1", city: "APO", state: "AE", postalCode: "09001", country: "US" });
    expect(apo.isMilitary).toBe(true);
    const bad = verifyAddress({ line1: "", city: "", state: "ZZ", postalCode: "ABC", country: "US" });
    expect(bad.status).toBe("Failed");
    expect(bad.notes.length).toBeGreaterThanOrEqual(4);
    expect(verifyAddress({ line1: "1 Rd", city: "Paris", postalCode: "75001", country: "France" }).status).toBe("Partially Verified");
  });

  it("layers a carrier validator", async () => {
    const carrier = { validateAddress: async () => ({ status: "Verified" as const, notes: ["carrier ok"], normalized: { line1: "X", line2: null, city: "c", state: "TN", postalCode: "38118", country: "United States" }, isPoBox: false, isMilitary: false }) };
    const r = await verifyWithCarrier({ line1: "1 Main", line2: "Apt 2", city: "Memphis", state: "Tennessee", postalCode: "38118", country: "US" }, carrier);
    expect(r.notes).toContain("carrier ok");
    expect(r.notes.some((n) => n.includes("merged"))).toBe(true);
    expect((await verifyWithCarrier({ line1: "", city: "", postalCode: "", country: "US" }, carrier)).status).toBe("Failed");
  });
});

describe("handoffs and barrel", () => {
  it("delegate to the owning modules", () => {
    // M07 implemented the count-from-wave handoff: an empty wave is refused with a clear message
    expect(() => createCountPlanFromWave(w.db, w.ctx, { warehouseId: w.warehouseId, waveId: "w", waveRuleId: "r", countType: "Location" })).toThrow(/found no locations to count/);
    expect(() => allocateWorkOrder(w.db, w.ctx, "wo")).toThrow(/Work order not found/);
    expect(getWorkflowActionExecutor("Block Order")).toBeTypeOf("function"); // registered by M12
    expect(getWorkflowActionExecutor("No Such Action" as Parameters<typeof getWorkflowActionExecutor>[0])).toBeUndefined();
    expect(domain.ledger.add).toBeTypeOf("function");
    expect(domain.sequences.next).toBeTypeOf("function");
  });
});
