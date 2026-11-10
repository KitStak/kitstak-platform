/**
 * Blind-judge repair round 1 (facility-config): put-to-cart cell assignment (REQ-R10-6), cell
 * naming, seed location structure from the code, zone put-away settings (priority, max locations
 * per SKU), the phone card summary and the change-log query key.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { assignJobToCart, planCellAssignments, reclaimCartCells, releaseCart } from "@/server/domain/mobile-cart-cells";
import { zoneSpreadAllows } from "@/server/domain/putaway-actions";
import { cellBarcode, cellDisplayName } from "@/lib/grid-defs/facility/mobile-carts";
import { ZONE_PUTAWAY_SETTINGS_ENFORCED } from "@/lib/grid-defs/admin/lookups";
import { locationStructure } from "@/server/db/seed/facility";
import { LOCATION_ZONES, LOCATION_ZONE_SETTINGS } from "@/server/db/seed/lookups";
import { locationWhere } from "@/components/locations/location-card-list";
import { changeLogKey } from "@/components/facility/facility-shared";
import { cartJobCandidates, getMobileCart } from "@/server/repositories/mobile-carts";
import { createOrder } from "@/server/domain/orders";
import { DomainError } from "@/server/domain/errors";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;

beforeEach(() => {
  w = createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId, role: "manager" }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
});
afterEach(() => w.close());

function cart(code: string, levels: number, columns: number, allowMultipleJob = false) {
  const typeId = (w.db.insert(schema.lookupValues).values({ type: "mobile_cart_type", name: `T-${code}`, warehouseId: w.warehouseId, isActive: true, sortOrder: 0 } as never).returning().get() as { id: string }).id;
  const row = w.db.insert(schema.mobileCarts).values({ warehouseId: w.warehouseId, code, levels, columns, cartTypeId: typeId, allowMultipleJob } as typeof schema.mobileCarts.$inferInsert).returning().get();
  const cells = [];
  for (let l = 1; l <= levels; l += 1) for (let c = 1; c <= columns; c += 1) cells.push({ cartId: row.id, level: l, column: c, barcode: cellBarcode(code, l, c) });
  w.db.insert(schema.mobileCartCells).values(cells).run();
  return row;
}
function job(code: string, orders: number, status = "Pending") {
  const j = w.db.insert(schema.jobs).values({ id: crypto.randomUUID(), code, warehouseId: w.warehouseId, jobTypeId: w.jobTypeId, jobType: "MULTI", operationType: "Picking", status } as never).returning().get() as { id: string };
  const ids: string[] = [];
  for (let i = 0; i < orders; i += 1) {
    const o = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    w.db.insert(schema.jobOrders).values({ jobId: j.id, orderId: o.id }).run();
    ids.push(o.id);
  }
  return { id: j.id, orderIds: ids };
}

describe("cell naming is one scheme", () => {
  it("display A01 is the end of the barcode MC-01-A01", () => {
    expect(cellDisplayName(1, 1)).toBe("A01");
    expect(cellDisplayName(2, 3)).toBe("B03");
    expect(cellBarcode("mc-01", 2, 3)).toBe("MC-01-B03");
    expect(cellBarcode("MC-01", 2, 3).endsWith(cellDisplayName(2, 3))).toBe(true);
  });
});

describe("put-to-cart (REQ-R10-6)", () => {
  it("plans orders onto free cells in order and refuses when cells run out", () => {
    expect(planCellAssignments([{ id: "o1" }, { id: "o2" }], [{ id: "c1" }, { id: "c2" }, { id: "c3" }])?.map((p) => `${p.order.id}:${p.cell.id}`)).toEqual(["o1:c1", "o2:c2"]);
    expect(planCellAssignments([{ id: "o1" }, { id: "o2" }], [{ id: "c1" }])).toBeNull();
  });

  it("writes both sides of the link, occupies the cart and shows the orders in their cells", () => {
    const c = cart("MC-J1", 2, 2);
    const j = job("Job-J1", 3);
    const r = assignJobToCart(w.db, w.ctx, { cartId: c.id, jobId: j.id });
    expect(r.assignments.map((a) => a.display)).toEqual(["A01", "A02", "B01"]);
    expect(r.assignments[0]?.barcode).toBe("MC-J1-A01");
    const jo = w.db.select().from(schema.jobOrders).where(eq(schema.jobOrders.jobId, j.id)).all();
    expect(jo.every((x) => x.toteOrCell?.startsWith("MC-J1-"))).toBe(true);
    expect(w.db.select().from(schema.jobs).where(eq(schema.jobs.id, j.id)).get()?.mobileCartId).toBe(c.id);
    const d = getMobileCart(w.db, auth, c.id);
    expect(d.status).toBe("Occupied");
    expect(d.orders).toHaveLength(3);
    expect(d.orders.every((o) => o.cell?.startsWith("MC-J1-"))).toBe(true);
    expect(d.cells.filter((x) => x.orderCode).length).toBe(3);
    const log = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, c.id)).all();
    expect(log.length).toBeGreaterThan(0);
  });

  it("is idempotent, blocks a second job on a single-job cart and refuses a job too big for the cart", () => {
    const c = cart("MC-J2", 1, 2);
    const j = job("Job-J2", 2);
    assignJobToCart(w.db, w.ctx, { cartId: c.id, jobId: j.id });
    expect(assignJobToCart(w.db, w.ctx, { cartId: c.id, jobId: j.id }).assignments).toHaveLength(0);
    const other = job("Job-J2b", 1);
    expect(() => assignJobToCart(w.db, w.ctx, { cartId: c.id, jobId: other.id })).toThrow(/in use by Job-J2/);
    const small = cart("MC-J2s", 1, 1);
    const big = job("Job-J2c", 2);
    expect(() => assignJobToCart(w.db, w.ctx, { cartId: small.id, jobId: big.id })).toThrow(/has 2 orders but cart MC-J2s has only 1 free cells/);
    const closed = job("Job-J2d", 1, "Completed");
    expect(() => assignJobToCart(w.db, w.ctx, { cartId: small.id, jobId: closed.id })).toThrow(DomainError);
  });

  it("reclaims cells whose order left the cart, and Empty cart frees everything", () => {
    const c = cart("MC-J3", 1, 2, true);
    const j = job("Job-J3", 2);
    assignJobToCart(w.db, w.ctx, { cartId: c.id, jobId: j.id });
    w.db.update(schema.shipmentOrders).set({ status: "Shipped" }).where(eq(schema.shipmentOrders.id, j.orderIds[0] as string)).run();
    expect(getMobileCart(w.db, auth, c.id).cells.filter((x) => x.orderCode).length).toBe(1);
    expect(reclaimCartCells(w.db, c.id)).toBe(1);
    const r = releaseCart(w.db, w.ctx, c.id);
    expect(r).toMatchObject({ cartCode: "MC-J3", freedCells: 1, releasedJobs: ["Job-J3"] });
    const d = getMobileCart(w.db, auth, c.id);
    expect(d.status).toBe("Available");
    expect(d.cells.every((x) => !x.orderCode)).toBe(true);
    expect(w.db.select().from(schema.jobOrders).where(eq(schema.jobOrders.jobId, j.id)).all().every((x) => x.toteOrCell === null)).toBe(true);
  });

  it("lists open picking jobs that can take the cart", () => {
    const c = cart("MC-J4", 1, 4);
    job("Job-J4", 2);
    job("Job-J4x", 1, "Cancelled");
    expect(cartJobCandidates(w.db, auth, c.id).map((x) => x.code)).toEqual(["Job-J4"]);
  });
});

describe("seed data (blind judge J1)", () => {
  it("location structure follows the code: A-01-02-1 is aisle A, rack 01, column 2, level 1", () => {
    expect(locationStructure({ zone: "A", aisle: "01", bay: "02", level: "1" })).toEqual({ aisle: "A", rack: "01", column: 2, level: "1" });
    expect(locationStructure({ zone: "Dock", aisle: "00", bay: "00", level: "1" })).toEqual({ aisle: "", rack: null, column: 0, level: "1" });
    expect(locationStructure({ zone: "Bulk", aisle: "00", bay: "03", level: "1" }).rack).toBeNull();
  });
  it("every seeded zone has a code, a priority and a max locations per SKU", () => {
    for (const z of LOCATION_ZONES) {
      const s = LOCATION_ZONE_SETTINGS[z];
      expect(s.code).toBeTruthy();
      expect(s.priority).toBeGreaterThan(0);
      expect(s.maxLocationsPerSku).toBeGreaterThan(0);
    }
  });
});

describe("zone put-away settings are live", () => {
  it("the zone page no longer marks them Coming soon", () => expect(ZONE_PUTAWAY_SETTINGS_ENFORCED).toBe(true));
  it("max locations per SKU refuses a new location once the zone holds the SKU in that many", () => {
    const holds = new Set(["l1", "l2"]);
    const byZone = new Map([["zA", 2]]);
    expect(zoneSpreadAllows({ location: { id: "l3", locationZoneId: "zA" }, zoneMaxLocationsPerSku: 2 }, holds, byZone)).toBe(false);
    expect(zoneSpreadAllows({ location: { id: "l1", locationZoneId: "zA" }, zoneMaxLocationsPerSku: 2 }, holds, byZone)).toBe(true);
    expect(zoneSpreadAllows({ location: { id: "l3", locationZoneId: "zA" }, zoneMaxLocationsPerSku: 3 }, holds, byZone)).toBe(true);
    expect(zoneSpreadAllows({ location: { id: "l3", locationZoneId: "zA" }, zoneMaxLocationsPerSku: null }, holds, byZone)).toBe(true);
  });
});

describe("UI helpers", () => {
  it("phone card summary reads the structure", () => {
    expect(locationWhere({ warehouseCode: "MLT1", locationZone: "A", aisle: "A", rack: "01", level: "1" })).toBe("MLT1 · Zone A · Aisle A · Rack 01 · Level 1");
    expect(locationWhere({ warehouseCode: "MLT1", locationZone: null, aisle: "", rack: null, level: null })).toBe("MLT1");
  });
  it("prefetch and drawer share one change-log cache key", () => {
    expect(changeLogKey("/api/locations/x/change-log", 1)).toEqual(["entity-change-log", "/api/locations/x/change-log", 1, { page: 1, ps: 20 }]);
  });
});
