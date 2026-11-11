/**
 * M05 putaway worklist: received stock still in a receiving location, the grid grammar
 * (filters / sort / paging / totals), count-lock flags, scan-to-confirm (partial and whole LP),
 * bulk putaway, the quantity field rules and the slow-load grid state.
 */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { parseGridQuery } from "@/server/query/grid-query";
import { createPurchaseOrder } from "@/server/repositories/purchase-orders-commands";
import { receivePurchaseOrder } from "@/server/repositories/purchase-orders-receive";
import { bulkPutaway, confirmPutaway, confirmPutawaySchema, listPutawayTasks, suggestPutaway } from "@/server/repositories/putaway-worklist";
import { createVendor } from "@/server/repositories/vendors";
import { poCreateSchema, receiveBodySchema } from "@/lib/grid-defs/receiving/po-schemas";
import { formatDwell, putawayQtyIssue } from "@/lib/grid-defs/receiving/putaway";
import { vendorFormSchema } from "@/lib/grid-defs/receiving/vendors";
import { breadcrumbsFor } from "@/config/route-registry";
import { slowLoadError } from "@/components/receiving/receiving-shared";
import { suggestionHeader } from "@/components/receiving/putaway-worklist-page";
import { createWorld, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;
beforeEach(async () => {
  w = await createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
});
afterEach(() => w.close());

const q = (qs = "") => parseGridQuery(qs).query;

async function receivedPo(code: string, qty: number) {
  const address = { name: "Dock", line1: "1 Supply Way", line2: "", postalCode: "38118", city: "Memphis", phone: "", country: "US", state: "TN" };
  const v = await createVendor(w.db, w.ctx, auth.scope, vendorFormSchema.parse({ clientId: w.clientId, displayName: `V ${code}`, vendorName: "V LLC", useShipAsBilling: true, shipping: address }));
  const po = await createPurchaseOrder(w.db, w.ctx, auth.scope, poCreateSchema.parse({
    warehouseId: w.warehouseId, clientId: w.clientId, code, poType: "Purchase Order", poDate: "2026-11-09T15:00:00.000Z", vendorId: v.id,
    lines: [{ productId: w.productId, packType: "Each", orderedQuantity: qty, unitCost: 1 }],
  }));
  await receivePurchaseOrder(w.db, w.ctx, auth.scope, po.id, receiveBodySchema.parse({ lines: [{ lineId: po.lines[0]?.id ?? "", quantity: qty, locationId: w.loc.receiving }] }));
  return po;
}
const inRecv = async () => (await w.db.select().from(schema.inventory).where(and(eq(schema.inventory.locationId, w.loc.receiving), eq(schema.inventory.productId, w.productId)))).reduce((n, r) => n + r.onHand, 0);

async function lockReceiving(code = "CNT-T1") {
  const planId = crypto.randomUUID();
  await w.db.insert(schema.countPlans).values({ id: planId, code, warehouseId: w.warehouseId, scheduledAt: "2026-11-10T00:00:00.000Z", lockLocations: true, countType: "Location", status: "Pending" });
  await w.db.insert(schema.countPlanLines).values({ planId, locationId: w.loc.receiving, status: "Pending" });
}

describe("putaway worklist", () => {
  it("lists receiving-area stock with warehouse, zone, PO link and moves a partial quantity", async () => {
    const po = await receivedPo("KS-PW-1", 8);
    const list = await listPutawayTasks(w.db, auth, q());
    const row = list.rows.find((r) => r.fromLocationCode === "RCV-01" && r.qty === 8);
    expect(row).toBeDefined();
    expect(row?.purchaseOrderId).toBe(po.id);
    expect(row?.warehouseName).not.toBe("");
    expect(row?.warehouseTimeZone).toBeTruthy();
    expect(row?.blockedReason).toBeNull();
    expect(list.units).toBeGreaterThanOrEqual(8);
    expect((await suggestPutaway(w.db, auth, row!.id)).suggestions.every((s) => s.locationId !== w.loc.receiving)).toBe(true);
    const moved = await confirmPutaway(w.db, auth, w.ctx, { inventoryId: row!.id, locationCode: "a-01-01", qty: 3 });
    expect(moved.locationCode).toBe("A-01-01");
    expect(moved.totalQty).toBe(3);
    expect(await inRecv()).toBe(5);
    const txn = await w.db.select().from(schema.inventoryTransactions).where(eq(schema.inventoryTransactions.toLocationId, w.loc.storageA));
    expect(txn.length).toBeGreaterThan(0);
  });

  it("speaks the grid grammar: filters, sort, paging and an honest total", async () => {
    await receivedPo("KS-PW-G1", 2);
    await receivedPo("KS-PW-G2", 5);
    const all = await listPutawayTasks(w.db, auth, q());
    const byPo = await listPutawayTasks(w.db, auth, q("f.poNumber=eq:KS-PW-G2"));
    expect(byPo.rows.every((r) => r.poNumber === "KS-PW-G2")).toBe(true);
    expect(byPo.total).toBe(byPo.rows.length);
    const byWh = await listPutawayTasks(w.db, auth, q(`f.warehouseId=in:${w.warehouseId}`));
    expect(byWh.total).toBe(all.total);
    const sorted = (await listPutawayTasks(w.db, auth, q("sort=-qty"))).rows.map((r) => r.qty);
    expect([...sorted].sort((a, b) => b - a)).toEqual(sorted);
    const paged = await listPutawayTasks(w.db, auth, q("ps=100&page=1"));
    expect(paged.total).toBe(all.total);
    await expect(async () => await listPutawayTasks(w.db, auth, q("sort=nope"))).rejects.toThrow(/Cannot sort/);
    expect((await listPutawayTasks(w.db, auth, q("f.dwellHours=gte:0"))).total).toBe(all.total);
  });

  it("rejects unknown and same locations", async () => {
    await receivedPo("KS-PW-2", 2);
    const row = (await listPutawayTasks(w.db, auth, q("q=rcv-01"))).rows[0]!;
    await expect(async () => await confirmPutaway(w.db, auth, w.ctx, { inventoryId: row.id, locationCode: "NOPE", qty: 1 })).rejects.toThrow(/doesn't exist/);
    await expect(async () => await confirmPutaway(w.db, auth, w.ctx, { inventoryId: row.id, locationCode: "RCV-01", qty: 1 })).rejects.toThrow(/storage location/);
  });

  it("flags count-locked source locations and refuses to move them", async () => {
    await receivedPo("KS-PW-L", 4);
    await lockReceiving("CNT-T1");
    const row = (await listPutawayTasks(w.db, auth, q())).rows.find((r) => r.fromLocationCode === "RCV-01")!;
    expect(row.blockedReason).toMatch(/locked by count plan CNT-T1/);
    expect((await listPutawayTasks(w.db, auth, q("f.locked=bool:true"))).total).toBeGreaterThan(0);
    await expect(async () => await confirmPutaway(w.db, auth, w.ctx, { inventoryId: row.id, locationCode: "A-01-01", qty: 1 })).rejects.toThrow(/CNT-T1/);
  });

  it("bulk puts tasks away to one location and reports failures per task", async () => {
    await receivedPo("KS-PW-B1", 3);
    await receivedPo("KS-PW-B2", 4);
    const rows = (await listPutawayTasks(w.db, auth, q("q=rcv-01"))).rows;
    const out = await bulkPutaway(w.db, auth, w.ctx, { items: [...rows.map((r) => ({ inventoryId: r.id, version: r.version })), { inventoryId: "missing" }], locationCode: "A-01-01" });
    expect(out.succeeded.length).toBe(rows.length);
    expect(out.failed.map((f) => f.id)).toEqual(["missing"]);
    expect(out.moved.every((m) => m.to === "A-01-01")).toBe(true);
    expect(await inRecv()).toBe(0);
  });

  it("requires a quantity unless the whole LP moves", () => {
    expect(confirmPutawaySchema.safeParse({ inventoryId: "x", locationCode: "A" }).success).toBe(false);
    expect(confirmPutawaySchema.safeParse({ inventoryId: "x", locationCode: "A", wholeLp: true }).success).toBe(true);
    const bad = confirmPutawaySchema.safeParse({ inventoryId: "x", locationCode: "A", qty: 0 });
    expect(bad.success ? "" : bad.error.issues[0]?.message).toBe("Enter a quantity of at least 1");
  });
});

describe("putaway UI helpers", () => {
  it("keeps an empty quantity empty and explains the limit", () => {
    expect(putawayQtyIssue("", 5, "Each")).toBe("Enter a quantity");
    expect(putawayQtyIssue("0", 5, "Each")).toBe("Enter a quantity of at least 1");
    expect(putawayQtyIssue("2.5", 5, "Each")).toBe("Use a whole number");
    expect(putawayQtyIssue("6", 5, "Each")).toBe("At most 5 Each can be moved");
    expect(putawayQtyIssue("5", 5, "Each")).toBeNull();
  });
  it("humanizes the algorithm and appends the rule", () => {
    expect(suggestionHeader("SAME_SKU_EMPTY_LOCATION_ALGORITHM", "Empty storage location")).toBe("Same SKU, empty location · Empty storage location");
    expect(suggestionHeader(null, null)).toBe("");
  });
  it("formats dwell", () => {
    expect(formatDwell(0)).toBe("< 1 h");
    expect(formatDwell(5)).toBe("5 h");
    expect(formatDwell(72)).toBe("3 d");
  });
  it("crumbs /receiving/putaway as Putaway, not Purchase Order Details", () => {
    const crumbs = breadcrumbsFor("/receiving/putaway");
    expect(crumbs.at(-1)?.label).toBe("Putaway");
  });
});

describe("slow first load", () => {
  it("keeps real errors and adds a retryable message only when slow", () => {
    expect(slowLoadError("boom", true)).toBe("boom");
    expect(slowLoadError(null, false)).toBeNull();
    expect(slowLoadError(null, true)).toMatch(/longer than usual/);
  });
});
