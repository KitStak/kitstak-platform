/** Orders-outbound parity loop round 6 (critic r5, 8.5): tag diffs, audit refresh, partial ship, job type match, shortage reasons, hold reason, duplicate dates, log zone, weight. */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { ledger } from "@/server/domain/ledger";
import { createOrder, createOrderBodySchema, duplicateOrder, rebaseExpectedShipDate } from "@/server/repositories/orders-commands";
import { runOrderBulk } from "@/server/repositories/orders-bulk";
import { getOrderDetail } from "@/server/repositories/orders";
import { formatLogDateTime } from "@/server/repositories/orders-change-log";
import { bucketBlocker, describeLineShortage, explainShortages, shipPreview, type BucketFacts } from "@/server/repositories/orders-outbound-insights";
import { partialShipNote, unshippedAfterShip } from "@/lib/grid-defs/orders/ship-partial";
import { tagApplyDiff, tagApplyError } from "@/components/orders/bulk/order-tag-popover";
import { bestJobType, isShortage } from "@/components/orders/bulk/order-job-modal";
import { shipConfirmText } from "@/components/orders/bulk/order-eligibility";
import { formatOrderWeight } from "@/components/orders/orders-columns";
import { ORDER_INVALIDATE } from "@/components/orders/orders-client";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

describe("tag apply diffs (single-row tagging no longer sends mode 'set')", () => {
  it("one order: adds the new ticks and removes the unticked ones", () => {
    expect(tagApplyDiff(["vip", "rush"], ["rush", "old"], 1)).toEqual({ add: ["vip"], remove: ["old"] });
    expect(tagApplyDiff(["vip"], [], 1)).toEqual({ add: ["vip"], remove: [] });
    expect(tagApplyDiff([], ["vip"], 1)).toEqual({ add: [], remove: ["vip"] });
  });
  it("several orders: add only, other tags kept", () => {
    expect(tagApplyDiff(["vip"], ["old"], 3)).toEqual({ add: ["vip"], remove: [] });
  });
  it("schema errors become business copy", () => {
    expect(tagApplyError(new Error('Invalid option: expected one of "add"|"remove"'))).toMatch(/could not be applied/);
    expect(tagApplyError(new Error("Tag not found"))).toBe("Tag not found");
  });
});

describe("audit views refresh after every order mutation", () => {
  it("ORDER_INVALIDATE covers the change-log drawer, activity timeline and ledger", () => {
    const keys = ORDER_INVALIDATE.map((k) => k[0]);
    expect(keys).toEqual(expect.arrayContaining(["grid", "order", "order-counts", "change-log", "timeline-ledger"]));
  });
});

describe("partial shipment wording", () => {
  const line = (quantity: number, packed: number, extra: Partial<{ cancelled: number; shipped: number }> = {}) => ({
    sku: "APX-TEE-WHT-M", quantity, packedQuantity: packed, cancelledQuantity: extra.cancelled ?? 0, shippedQuantity: extra.shipped ?? 0,
  });
  it("names what stays behind", () => {
    expect(unshippedAfterShip(line(2, 1))).toBe(1);
    expect(unshippedAfterShip(line(3, 1, { shipped: 1 }))).toBe(1);
    expect(partialShipNote([line(2, 1)])).toBe("Partially shipped: 1 of 2 units of APX-TEE-WHT-M remains");
    expect(partialShipNote([line(2, 2)])).toBeNull();
    expect(partialShipNote([line(3, 2, { cancelled: 1 })])).toBeNull();
  });
  it("the confirm stops promising Shipped & Canceled for partial orders", () => {
    expect(shipConfirmText(1)).toMatch(/move to Shipped & Canceled/);
    expect(shipConfirmText(1, 1)).toMatch(/Partially Shipped and stays in the backlog/);
    expect(shipConfirmText(3, 1)).toMatch(/^3 orders will be shipped\. 2 orders ship in full/);
  });
});

describe("job type pre-selection and shortage detection", () => {
  it("picks the type matching the most orders; ties keep the last-used type", () => {
    expect(bestJobType([{ id: "multi", n: 0 }, { id: "single", n: 1 }], "multi")).toBe("single");
    expect(bestJobType([{ id: "multi", n: 1 }, { id: "single", n: 1 }], "multi")).toBe("multi");
    expect(bestJobType([{ id: "multi", n: 0 }, { id: "single", n: -1 }], "multi")).toBe("multi");
  });
  it("recognises allocation failures", () => {
    expect(isShortage("Order SO1 could not be fully allocated; it is in Shortage.")).toBe(true);
    expect(isShortage("Eliminated by Job Type 'Multi Item Orders' Condition(s)")).toBe(false);
  });
  it("classifies blocked buckets in the allocation order", () => {
    const b: BucketFacts = { free: 5, locationCode: "A", areaType: "Picking", isActive: true, isLocked: false, preventAllocation: false, damaged: false, countLocked: false, lotMismatch: false, passesRule: true };
    expect(bucketBlocker(b)).toBeNull();
    expect(bucketBlocker({ ...b, isLocked: true })).toBe("locked");
    expect(bucketBlocker({ ...b, passesRule: false })).toBe("rule");
    expect(bucketBlocker({ ...b, damaged: true, isLocked: true })).toBe("damaged");
    expect(describeLineShortage({ sku: "X", need: 1, allocatable: 0, otherClientQty: 4, ruleName: "Pick face", blocked: [
      { reason: "locked", qty: 36, locations: ["A-01-01-1"], areas: ["Picking"] },
      { reason: "rule", qty: 589, locations: ["C-01-01-1"], areas: ["Storage"] },
    ] })).toBe("X needs 1, 0 allocatable: 36 in locked location A-01-01-1; 589 excluded by the allocation rule 'Pick face' (Storage area); 4 belong to another client.");
  });
});

describe("dates, zones and weights", () => {
  it("duplicate keeps the lead time from the new order date", () => {
    const now = new Date("2026-11-10T09:53:00Z");
    expect(rebaseExpectedShipDate("2026-11-10T09:00:00Z", "2026-11-11T09:00:00Z", now)).toBe("2026-11-11T09:53:00.000Z");
    expect(rebaseExpectedShipDate("2026-11-10T09:00:00Z", "2026-11-09T09:00:00Z", now)).toBeNull();
    expect(rebaseExpectedShipDate("2026-11-10T09:00:00Z", null, now)).toBeNull();
  });
  it("log values carry the zone abbreviation, also for values formatted before r6", () => {
    expect(formatLogDateTime("2026-11-10T10:43:51Z", "America/Chicago")).toBe("11/10/2026 4:43:51 AM CST");
    expect(formatLogDateTime("11/10/2026 4:43:51 AM", "America/Chicago")).toBe("11/10/2026 4:43:51 AM CST");
    expect(formatLogDateTime("KS-R4 note", "America/Chicago")).toBe("KS-R4 note");
  });
  it("weights group thousands with 2 decimals", () => {
    expect(formatOrderWeight(40000.8 * 16)).toBe("40,000.80 lb");
    expect(formatOrderWeight(6.5)).toBe("6.50 oz");
  });
});

describe("repository flows", () => {
  let w: World;
  const scope = () => ({ warehouseIds: [w.warehouseId], clientIds: "all" as const });
  beforeEach(() => {
    w = createWorld();
  });
  afterEach(() => w.close());
  const mk = (qty = 2, extra: Record<string, unknown> = {}) => createOrder(w.db, w.ctx, createOrderBodySchema.parse(orderInput(w, [{ productId: w.productId, quantity: qty }], extra)));

  it("hold reason is logged, noted and shown on the detail", () => {
    const o = mk();
    const res = runOrderBulk("hold", w.db, w.ctx, { ids: [o.id], reason: "Address check with customer" });
    expect(res.succeeded).toEqual([o.id]);
    const detail = getOrderDetail(w.db, { scope: scope() }, o.id);
    expect(detail?.hold?.reason).toBe("Address check with customer");
    const logs = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, o.id)).all().map((r) => r.message);
    expect(logs).toContain("Hold reason: Address check with customer");
    const notes = w.db.select().from(schema.entityNotes).where(eq(schema.entityNotes.entityId, o.id)).all();
    expect(notes.some((n) => n.body === "Hold reason: Address check with customer")).toBe(true);
    runOrderBulk("release", w.db, w.ctx, { ids: [o.id] });
    expect(getOrderDetail(w.db, { scope: scope() }, o.id)?.hold).toBeNull();
  });

  it("duplicate never expects shipment before its order date", () => {
    const o = mk(2, { expectedShipDate: "2020-01-01T00:00:00.000Z" });
    const copy = duplicateOrder(w.db, w.ctx, o.id);
    const row = w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, copy.id)).get();
    if (row?.expectedShipDate) expect(Date.parse(row.expectedShipDate)).toBeGreaterThanOrEqual(Date.parse(row.orderDate));
  });

  it("explains a shortage caused by a locked location", () => {
    ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 7 });
    w.db.update(schema.locations).set({ isLocked: true }).where(eq(schema.locations.id, w.loc.storageA)).run();
    const o = mk(2);
    const out = explainShortages(w.db, scope(), [o.id]);
    expect(out[o.id]?.summary).toMatch(/needs 2, 0 allocatable: 7 in locked location/);
    const ok = mk(1);
    w.db.update(schema.locations).set({ isLocked: false }).where(eq(schema.locations.id, w.loc.storageA)).run();
    expect(explainShortages(w.db, scope(), [ok.id])[ok.id]).toBeUndefined();
  });

  it("ship preview counts Packed allocations (what shipOrders consumes), in scope", () => {
    const o = mk(2);
    // The line counter alone doesn't ship anything: no Packed / Loaded allocation yet.
    w.db.update(schema.orderLines).set({ packedQuantity: 1 }).where(eq(schema.orderLines.orderId, o.id)).run();
    expect(shipPreview(w.db, scope(), [o.id]).partial[o.id]).toMatch(/^Partially shipped: 2 of 2 units of .+ remain$/);
    expect(shipPreview(w.db, { warehouseIds: [], clientIds: "all" }, [o.id]).partial).toEqual({});
  });
});
