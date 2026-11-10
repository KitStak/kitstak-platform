/**
 * M13 critic round 2 (score 7.3) fixes: PO Receiving UOM math from the pack-type hierarchy,
 * dashboard Jobs drilldown scope, disjoint progress parts, per-receiver drilldowns,
 * Channel Sales unsold listings, scatter headroom and associate task mix.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { EMPTY_GRID_QUERY, parseGridQuery, type GridQuery } from "@/server/query/grid-query";
import { listPoReceiving, poUomQuantity } from "@/server/repositories/reports-receiving";
import { listChannelSales } from "@/server/repositories/reports-orders";
import { getLiveDashboard, inListValue, lineParts } from "@/server/repositories/dashboard-live";
import { byTypeOf, receiverHref } from "@/server/repositories/analytics-labor";
import { scatterYMax, scatterYTicks } from "@/components/analytics/scatter-scale";
import { CHOOSER_GUTTER_ID, chooserGutterColumn } from "@/components/reports/report-cells";
import { PO_RECEIVING_DEF } from "@/lib/grid-defs/reports/receiving";
import { CHANNEL_SALES_DEFAULT_FILTER } from "@/lib/grid-defs/reports/orders";
import { createWorld, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;
const q = (qs = ""): GridQuery => ({ ...EMPTY_GRID_QUERY, ...parseGridQuery(qs).query, pageSize: 100 });

beforeEach(() => {
  w = createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(["settings.users.view"]), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
});
afterEach(() => w.close());

let master = 9000;
function poLine(code: string, status: "Started" | "Completed", pack: string, ordered: number, storedRatio: number, received: number, productId = w.productId) {
  const po = w.db.insert(schema.purchaseOrders).values({ code, warehouseId: w.warehouseId, clientId: w.clientId, vendorName: "V", status, totalQuantity: ordered, purchasePrice: 1 }).returning().get();
  const line = w.db.insert(schema.purchaseOrderLines).values({ purchaseOrderId: po.id, productId, orderedQuantity: ordered, unitCost: 1, packType: pack, uomQuantity: storedRatio }).returning().get();
  if (received > 0) {
    master += 1;
    w.db.insert(schema.receipts).values({
      masterId: master, type: "Purchase Order", warehouseId: w.warehouseId, clientId: w.clientId, purchaseOrderId: po.id, purchaseOrderLineId: line.id,
      productId, packType: "Each", quantity: received, uomQuantity: received, locationId: w.loc.receiving, receivedBy: w.userId,
    }).run();
  }
  return line.id;
}

describe("PO Receiving: PO UOM Quantity = ordered × units per pack", () => {
  it("multiplies by the pack ratio and never treats the stored ratio as the line total", () => {
    expect(poUomQuantity(15, 24)).toBe(360);
    expect(poUomQuantity(180, 1)).toBe(180);
    expect(poUomQuantity(7, 0)).toBe(7);
    expect(poUomQuantity(7, null)).toBe(7);
  });

  it("Each lines received in full show no difference; short lines show the real shortfall", () => {
    const full = poLine("PO-FULL", "Completed", "Each", 180, 1, 180);
    const short = poLine("PO-SHORT", "Started", "Each", 348, 1, 2);
    const rows = listPoReceiving(w.db, auth, q()).rows;
    const byId = (id: string) => rows.find((r) => r.rowId === id);
    expect(byId(full)).toMatchObject({ poQty: 180, poUomQty: 180, receivedUomQty: 180, difference: null, hasDifference: false });
    expect(byId(short)).toMatchObject({ poQty: 348, poUomQty: 348, receivedUomQty: 2, difference: -346, hasDifference: true });
    expect(listPoReceiving(w.db, auth, q("f.hasDifference=bool:true")).rows.map((r) => r.rowId)).toEqual([short]);
  });

  it("takes the units per pack from the product's pack-type hierarchy, over the stored ratio", () => {
    w.db.insert(schema.productPackTypes).values({ productId: w.product2Id, packType: "Case", kind: "Hierarchical", uomQty: 24 }).run();
    // Stored ratio disagrees (1): the hierarchy wins.
    const id = poLine("PO-CASE", "Started", "Case", 15, 1, 24, w.product2Id);
    const row = listPoReceiving(w.db, auth, q()).rows.find((r) => r.rowId === id);
    expect(row).toMatchObject({ unitsPerPack: 24, poUomQty: 360, receivedUomQty: 24, difference: -336 });
  });

  it("puts the quantities the report exists for ahead of the descriptive columns", () => {
    const ids = PO_RECEIVING_DEF.columns.map((c) => c.id);
    expect(ids.slice(0, 8)).toEqual(["poCode", "sku", "packType", "poQty", "unitsPerPack", "poUomQty", "receivedUomQty", "difference"]);
    expect(ids.indexOf("warehouse")).toBeGreaterThan(ids.indexOf("difference"));
  });
});

describe("dashboard progress and jobs", () => {
  it("order-line parts are disjoint and add up to the total", () => {
    const parts = lineParts({ total: 108, packed: 11, picked: 30 });
    expect(parts.map((p) => p.count)).toEqual([11, 19, 78]);
    expect(parts.reduce((a, p) => a + p.count, 0)).toBe(108);
    expect(parts.every((p) => p.href === undefined)).toBe(true);
    expect(lineParts({ total: 5, packed: 9, picked: 2 }).map((p) => p.count)).toEqual([5, 0, 0]);
  });

  it("escapes commas in in-list values", () => {
    expect(inListValue(["MLT1 - Memphis", "A, B"])).toBe("in:MLT1%20-%20Memphis,A%5C%2C%20B");
  });

  it("jobs drilldowns keep a multi-warehouse selection and the Status tab counts what it opens", () => {
    const w2 = w.db.insert(schema.warehouses).values({ code: "NYC1", name: "New York", addressLine: "1", city: "NY", state: "NY", postalCode: "1", timezone: "America/New_York", mandatoryAdjustmentReason: false }).returning().get().id;
    const job = (code: string, status: string, warehouseId: string, extra: Record<string, unknown> = {}) =>
      w.db.insert(schema.jobs).values({ id: crypto.randomUUID(), code, warehouseId, jobType: "Picking", status: status as "Pending", ...extra }).run();
    job("J1", "Pending", w.warehouseId);
    job("J2", "In Progress", w2);
    job("J3", "Cancelled", w.warehouseId);
    job("J4", "Completed", w2, { completedAt: new Date().toISOString() });
    job("J5", "Completed", w2, { completedAt: "2020-01-01T00:00:00.000Z" });
    const scope = { warehouseIds: [w.warehouseId, w2], clientIds: "all" as const };
    const a = { ...auth, scope, viewScope: scope } as AuthContext;
    const d = getLiveDashboard(w.db, a, { warehouseIds: [w.warehouseId, w2], clientIds: [] });
    const status = d.jobs.status;
    expect(status.map((r) => r.name).sort()).toEqual(["Completed", "Pending", "Started"]);
    expect(status.reduce((s, r) => s + r.jobQty, 0)).toBe(3);
    expect(status.find((r) => r.name === "Completed")?.href).toContain("f.completedAt=date:custom:");
    for (const r of [...status, ...d.jobs.priority, ...d.jobs.type]) {
      expect(r.href).toContain("f.warehouse=in:");
      expect(decodeURIComponent(r.href)).toContain("Memphis");
      expect(decodeURIComponent(r.href)).toContain("New York");
    }
    expect(d.jobs.priority.reduce((s, r) => s + r.jobQty, 0)).toBe(2);
  });
});

describe("labor drilldowns and chart helpers", () => {
  const r = { fromIso: "2026-11-01T05:00:00.000Z", toIso: "2026-11-10T05:00:00.000Z", from: "2026-11-01", to: "2026-11-09", clientIds: [] as string[] };
  it("per-receiver links name the receiver and keep the warehouse", () => {
    const withFilter = receiverHref(r, ["wh1"], "Thao Nguyen", true);
    expect(withFilter).toContain("/receiving/history?");
    expect(withFilter).toContain("f.receivedBy=eq:Thao%20Nguyen");
    expect(withFilter).toContain("f.warehouseId=in:wh1");
    const fallback = receiverHref(r, ["wh1"], "Thao Nguyen", false);
    expect(fallback).toContain("/reports/user-performance?");
    expect(fallback).toContain("f.user=eq:Thao%20Nguyen");
    expect(fallback).toContain("f.activityDate=date:custom:2026-11-01..2026-11-09");
    expect(receiverHref(r, ["wh1"], "A", false)).not.toBe(receiverHref(r, ["wh1"], "B", false));
  });

  it("scatter Y axis leaves headroom above the top point", () => {
    expect(scatterYMax([11.3, 9, 8])).toBeGreaterThanOrEqual(13);
    expect(scatterYMax([12])).toBeGreaterThan(12 * 1.1);
    expect(scatterYMax([])).toBe(1);
    expect(scatterYTicks([11.3, 9, 8])).toEqual([0, 5, 10, 15]);
  });

  it("task mix lists the most frequent type first", () => {
    expect(byTypeOf({ byType: new Map([["Packing", 3], ["Picking", 12]]) })).toBe("Picking:12,Packing:3");
  });

  it("report grids reserve a fixed sticky-right gutter for the column chooser", () => {
    const g = chooserGutterColumn();
    expect(g.id).toBe(CHOOSER_GUTTER_ID);
    expect(g.enableSorting).toBe(false);
    expect(g.meta?.sticky).toBe("right");
  });
});

describe("Channel Sales: unsold listings", () => {
  it("are not attributed to a warehouse and are hidden by the default chip", () => {
    const cc = w.db.insert(schema.channelConnections).values({ provider: "shopify", storeName: "Main store", clientId: w.clientId, settings: {} as never }).returning().get();
    w.db.insert(schema.productListings).values({ channelConnectionId: cc.id, clientId: w.clientId, productId: w.productId, sellerSku: "S1", channelProductId: "1", name: "Listing" }).run();
    const all = listChannelSales(w.db, auth, q()).rows;
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ warehouse: "Not sold yet", warehouseId: null, soldQty: 0, hasSales: false });
    expect(listChannelSales(w.db, auth, q(CHANNEL_SALES_DEFAULT_FILTER)).total).toBe(0);
  });
});
