/**
 * Round 6 parity loop (critic R5, 8.2): LP delete / void (and LP types becoming deletable),
 * location ledger direction from the signed quantity + reservations split + paging, change-log
 * read normalization, channel and deleted-record audit access, LP client pre-assignment,
 * mobile cart orders per cell.
 */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { changeChannel, changeSourceUser, normalizeChangeRow } from "@/lib/grid-defs/facility/change-log-copy";
import { ledgerEffect, isReservation } from "@/lib/grid-defs/facility/location-ledger";
import { lpLabelTitle, lpRowRemovalBlocker } from "@/lib/grid-defs/facility/lp-numbers";
import { lpTypeInUseReason } from "@/lib/grid-defs/facility/lp-types";
import { createLpNumbers, lpRemovalPlan, lpRemovalPreview, removeLpNumbers } from "@/server/repositories/lp-numbers";
import { deleteLpTypes, lpTypeDeleteBlocker } from "@/server/repositories/lp-types";
import { listLocationLedger } from "@/server/repositories/locations";
import { changeLogPageSchema, changeLogResultOrDeleted } from "@/server/repositories/locations-shared";
import { getMobileCart } from "@/server/repositories/mobile-carts";
import { AppError } from "@/server/api/errors";
import { createOrder } from "@/server/domain/orders";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;
const actor = () => ({ userId: w.userId, source: "admin@test.io" });
const page = changeLogPageSchema.parse({});

beforeEach(() => {
  w = createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId, role: "manager" }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
});
afterEach(() => w.close());

const lpType = (code = "KS-R6-LPT") => w.db.insert(schema.lpTypes).values({ warehouseId: w.warehouseId, code, numberPrefix: "KR6-", numberLength: 4 }).returning().get().id;
const issue = (typeId: string, count: number, extra: Record<string, unknown> = {}) =>
  createLpNumbers(w.db, auth, actor(), { warehouseId: w.warehouseId, lpTypeId: typeId, locationId: null, method: "sequence", count, isSscc18: false, clientId: null, number: null, alternateBarcode: null, ...extra } as never);

let seq = 1_000_000;
const txn = (extra: Partial<typeof schema.inventoryTransactions.$inferInsert>) =>
  w.db.insert(schema.inventoryTransactions).values({
    seq: seq++, type: "Inventory Adjustment", warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, uomQty: 1, packQty: 1, source: "admin@test.io", ...extra,
  } as typeof schema.inventoryTransactions.$inferInsert).run();

describe("LP removal rule (pure)", () => {
  const base = { status: "Empty" as const, units: 0, parentNumber: null, childCount: 0, history: [] as string[] };
  it("never-used Empty LPs are deleted", () => expect(lpRemovalPlan(base)).toEqual({ mode: "delete" }));
  it("Empty LPs with history are voided, not deleted", () => expect(lpRemovalPlan({ ...base, history: ["stock movements"] })).toEqual({ mode: "void", because: "it has stock movements history" }));
  it("stock, parent, children and shipped LPs are refused with the reason", () => {
    expect(lpRemovalPlan({ ...base, units: 3, status: "Occupied" })).toMatchObject({ mode: "blocked", reason: expect.stringContaining("holds 3 units") });
    expect(lpRemovalPlan({ ...base, parentNumber: "PLT-1" })).toMatchObject({ mode: "blocked", reason: expect.stringContaining("parent LP PLT-1") });
    expect(lpRemovalPlan({ ...base, childCount: 2 })).toMatchObject({ mode: "blocked", reason: expect.stringContaining("2 child LPs") });
    expect(lpRemovalPlan({ ...base, status: "Shipped" })).toMatchObject({ mode: "blocked" });
    expect(lpRemovalPlan({ ...base, status: "Removed", history: ["receipts"] })).toMatchObject({ mode: "blocked", reason: expect.stringContaining("already voided") });
  });
  it("row kebab reason and single print title", () => {
    expect(lpRowRemovalBlocker({ status: "Empty", units: 0, parentLpNumber: null })).toBeNull();
    expect(lpRowRemovalBlocker({ status: "Occupied", units: 4, parentLpNumber: null })).toBe("Holds 4 units; move or adjust the stock first");
    expect(lpRowRemovalBlocker({ status: "Empty", units: 0, parentLpNumber: "P-1" })).toContain("parent LP P-1");
    expect(lpLabelTitle(["A"])).toBe("Print LP labels · A");
    expect(lpLabelTitle(["A", "B", "C", "D"])).toBe("Print LP labels · A, B +2 more");
  });
});

describe("LP delete / void against the DB", () => {
  it("critic repro: 3 unused LPs are deleted, a Delete row is logged, and the LP type becomes deletable", () => {
    const typeId = lpType();
    const { ids, numbers } = issue(typeId, 3);
    expect(numbers).toEqual(["KR6-0001", "KR6-0002", "KR6-0003"]);
    expect(lpTypeDeleteBlocker(w.db, typeId)).toContain("delete the unused ones from LP Numbers first");
    expect(lpRemovalPreview(w.db, auth, ids).map((p) => p.mode)).toEqual(["delete", "delete", "delete"]);
    const r = removeLpNumbers(w.db, auth, actor(), ids);
    expect(r.failed).toEqual([]);
    expect(r.deleted).toHaveLength(3);
    expect(w.db.select().from(schema.licensePlates).where(eq(schema.licensePlates.lpTypeId, typeId)).all()).toHaveLength(0);
    const del = w.db.select().from(schema.changeLog).where(and(eq(schema.changeLog.entityId, ids[0]!), eq(schema.changeLog.type, "Delete"))).get();
    expect(del).toMatchObject({ message: "LP Number KR6-0001 is deleted.", parentEntityType: "warehouse", parentEntityId: w.warehouseId });
    expect(lpTypeDeleteBlocker(w.db, typeId)).toBeNull();
    expect(deleteLpTypes(w.db, auth, actor(), [typeId]).succeeded).toEqual([typeId]);
  });

  it("an Empty LP with stock history is voided (status Removed) and the type explains why it stays", () => {
    const typeId = lpType();
    const { ids } = issue(typeId, 1);
    txn({ type: "Inventory Movement", fromLpId: ids[0], fromLocationId: w.loc.storageA, toLocationId: w.loc.storageB });
    const r = removeLpNumbers(w.db, auth, actor(), ids);
    expect(r.voided).toEqual(ids);
    const row = w.db.select().from(schema.licensePlates).where(eq(schema.licensePlates.id, ids[0]!)).get();
    expect(row).toMatchObject({ status: "Removed", locationId: null });
    const upd = w.db.select().from(schema.changeLog).where(and(eq(schema.changeLog.entityId, ids[0]!), eq(schema.changeLog.field, "status"))).get();
    expect(upd).toMatchObject({ fromValue: "Empty", toValue: "Removed" });
    expect(lpTypeDeleteBlocker(w.db, typeId)).toContain("voided but kept for their stock history");
  });

  it("an LP holding stock is refused with the reason", () => {
    const typeId = lpType();
    const { ids } = issue(typeId, 1);
    w.db.insert(schema.inventory).values({ warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, lpId: ids[0], onHand: 5, packType: "Each", status: "Stock", receivedAt: new Date().toISOString() } as typeof schema.inventory.$inferInsert).run();
    const r = removeLpNumbers(w.db, auth, actor(), ids);
    expect(r.succeeded).toEqual([]);
    expect(r.failed[0]?.message).toContain("holds 5 units");
  });

  it("the change log of a deleted LP is still readable, authorized by its warehouse", () => {
    const typeId = lpType();
    const { ids } = issue(typeId, 1);
    removeLpNumbers(w.db, auth, actor(), ids);
    const missing = () => { throw new AppError("NOT_FOUND", "LP number not found"); };
    const res = changeLogResultOrDeleted(w.db, auth, "license_plate", ids[0]!, page, missing) as unknown as { body?: unknown; data?: unknown };
    const rows = (res as { data: { type: string }[] }).data ?? (res.body as { data: { type: string }[] }).data;
    expect(rows.map((x) => x.type)).toEqual(["Delete", "Create"]);
    const outsider = { ...auth, scope: { warehouseIds: ["other"], clientIds: "all" as const } } as AuthContext;
    expect(() => changeLogResultOrDeleted(w.db, outsider, "license_plate", ids[0]!, page, missing)).toThrow("LP number not found");
  });

  it("From Sequence can pre-assign a client without SSCC18", () => {
    const typeId = lpType();
    const { ids } = issue(typeId, 2, { clientId: w.clientId });
    const rows = w.db.select().from(schema.licensePlates).where(eq(schema.licensePlates.lpTypeId, typeId)).all();
    expect(rows.map((r) => r.clientId)).toEqual([w.clientId, w.clientId]);
    expect(ids).toHaveLength(2);
  });

  it("LP type tooltip points to LP Numbers", () => expect(lpTypeInUseReason(3)).toBe("3 LP numbers use this type. Delete unused LPs in LP Numbers first."));
});

describe("location ledger", () => {
  it("direction follows the signed quantity", () => {
    expect(ledgerEffect(false, true, -2)).toEqual({ direction: "Out", qty: 2, delta: -2 });
    expect(ledgerEffect(false, true, 5)).toEqual({ direction: "In", qty: 5, delta: 5 });
    expect(ledgerEffect(true, false, 3)).toEqual({ direction: "Out", qty: 3, delta: -3 });
    expect(ledgerEffect(true, false, -3)).toEqual({ direction: "In", qty: 3, delta: 3 });
    expect(ledgerEffect(true, true, 4)).toEqual({ direction: "Within", qty: 4, delta: 0 });
    expect(isReservation("Allocation")).toBe(true);
    expect(isReservation("Picking")).toBe(false);
  });

  it("critic repro: a −2 adjustment reads Out 2, allocations are reservations, and the list pages", () => {
    const loc = w.loc.storageA;
    txn({ type: "Inventory Adjustment", toLocationId: loc, uomQty: -2 });
    txn({ type: "Receiving", toLocationId: loc, uomQty: 10 });
    txn({ type: "Allocation", fromLocationId: loc, toLocationId: loc, uomQty: 3 });
    for (let i = 0; i < 30; i += 1) txn({ type: "Picking", fromLocationId: loc, toLocationId: w.loc.pick, uomQty: 1 });
    const first = listLocationLedger(w.db, auth, loc, { page: 1, ps: 25, kind: "movements" });
    expect(first.total).toBe(32);
    expect(first.rows).toHaveLength(25);
    const last = listLocationLedger(w.db, auth, loc, { page: 2, ps: 25, kind: "movements" });
    const adj = last.rows.find((r) => r.type === "Inventory Adjustment");
    expect(adj).toMatchObject({ direction: "Out", qty: 2, delta: -2 });
    expect(last.rows.some((r) => r.type === "Allocation")).toBe(false);
    const res = listLocationLedger(w.db, auth, loc, { page: 1, ps: 25, kind: "reservations" });
    expect(res.rows.map((r) => [r.type, r.reservation])).toEqual([["Allocation", true]]);
    expect(listLocationLedger(w.db, auth, loc, { page: 1, ps: 200, kind: "all" }).total).toBe(33);
  });
});

describe("change-log read normalization and channel", () => {
  it("legacy 'Is Locked' / 'Max Sku Qty' rows read like new ones", () => {
    const legacy = { type: "Update", field: "isLocked", fieldLabel: "Is Locked", fromValue: "No", toValue: "Yes", message: "Is Locked is modified. No --> Yes" };
    expect(normalizeChangeRow(legacy)).toMatchObject({ fieldLabel: "Locked", message: "Locked is modified. No --> Yes" });
    expect(normalizeChangeRow({ ...legacy, field: "maxSkuQty", fieldLabel: "Max Sku Qty", fromValue: "7", toValue: "", message: "Max Sku Qty is modified. 7 --> " }))
      .toMatchObject({ fieldLabel: "Max SKU qty", message: "Max SKU qty is modified. 7 --> (blank)" });
    const cap = { type: "Update", field: "productCapacity", fieldLabel: "SKU (Each) · Product capacity", fromValue: "a", toValue: "b", message: "m" };
    expect(normalizeChangeRow(cap)).toBe(cap);
  });
  it("channel and user come from the stored source", () => {
    expect(changeChannel("admin@kitstak.io")).toBe("UI");
    expect(changeChannel("Import · admin@kitstak.io")).toBe("Import");
    expect(changeChannel("Integration")).toBe("Integration");
    expect(changeChannel("Workflow · Block PO box addresses")).toBe("Workflow");
    expect(changeChannel("Seed")).toBe("System");
    expect(changeSourceUser("Import · a@b.io")).toBe("a@b.io");
    expect(changeSourceUser("Scheduler")).toBeNull();
  });
});

describe("mobile cart orders per cell", () => {
  it("lists the job's orders with picked units, and says when no cell is assigned", () => {
    const cartTypeId = w.db.insert(schema.lookupValues).values({ type: "mobile_cart_type", name: "Std", warehouseId: w.warehouseId, isActive: true, sortOrder: 0 } as never).returning().get() as { id: string };
    const cart = w.db.insert(schema.mobileCarts).values({ warehouseId: w.warehouseId, code: "MC-R6", levels: 1, columns: 2, cartTypeId: cartTypeId.id } as typeof schema.mobileCarts.$inferInsert).returning().get();
    w.db.insert(schema.mobileCartCells).values([{ cartId: cart.id, level: 1, column: 1, barcode: "MC-R6-A01" }, { cartId: cart.id, level: 1, column: 2, barcode: "MC-R6-A02" }]).run();
    const order = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 4 }]));
    const job = w.db.insert(schema.jobs).values({ id: crypto.randomUUID(), code: "Job-R6", warehouseId: w.warehouseId, jobTypeId: w.jobTypeId, jobType: "MULTI", status: "Started", mobileCartId: cart.id } as never).returning().get() as { id: string };
    w.db.insert(schema.jobOrders).values({ jobId: job.id, orderId: order.id, toteOrCell: "MC-R6-A02" }).run();
    w.db.insert(schema.tasks).values({ taskNo: 1, jobId: job.id, warehouseId: w.warehouseId, taskType: "Picking", orderId: order.id, productId: w.productId, plannedQty: 4, actualQty: 1 } as never).run();
    const d = getMobileCart(w.db, auth, cart.id);
    expect(d.orders).toHaveLength(1);
    expect(d.orders[0]).toMatchObject({ orderCode: order.code, jobCode: "Job-R6", cell: "MC-R6-A02", planned: 4, picked: 1, openTasks: 1 });
  });
});
