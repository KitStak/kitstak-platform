/** M06 inventory: row actions, transfers, rule guards, attributes, read models — in-memory migrated DB. */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import { ledger } from "@/server/domain/ledger";
import { allocateOrders } from "@/server/domain/allocation";
import { createOrder } from "@/server/domain/orders";
import { EMPTY_GRID_QUERY, type GridQuery } from "@/server/query/grid-query";
import {
  addInventory, changeAttributes, changeAttributesSchema, changeQuantity, quantityChangeSchema, transferLocation, transferLp, transferProduct,
} from "@/server/repositories/inventory-commands";
import { getBucketDetail, listBuckets } from "@/server/repositories/inventory-by-location";
import { listTotalInventory } from "@/server/repositories/inventory-total";
import { listAtp } from "@/server/repositories/inventory-atp";
import { locationSummary, inventoryReasons, productOptions } from "@/server/repositories/inventory-lookups";
import { openOrdersFor, openOrdersHref } from "@/server/repositories/inventory-open-orders";
import { createWorld, locationRow, orderInput, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;
let reasonId: string;

beforeEach(() => {
  w = createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
  reasonId = w.db.insert(schema.lookupValues).values({ type: "adjustment_reason", name: "Inventory quantity discrepancy" }).returning().get().id;
  w.db.insert(schema.lookupValues).values({ type: "damage_reason", name: "Damaged" }).run();
});
afterEach(() => w.close());

const ctx = () => ({ ...w.ctx, scope: auth.scope });
const stock = (qty: number, locationId = w.loc.storageA, productId = w.productId) =>
  ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId, locationId, qty }).bucket;
const bucket = (id: string) => w.db.select().from(schema.inventory).where(eq(schema.inventory.id, id)).get();
const onHandAt = (locationId: string, productId = w.productId) =>
  w.db.select().from(schema.inventory).where(and(eq(schema.inventory.locationId, locationId), eq(schema.inventory.productId, productId))).all().reduce((s, b) => s + b.onHand, 0);
const clean = () => expect(ledger.reconcileLedger(w.db)).toEqual([]);
const q = (extra: Partial<GridQuery> = {}): GridQuery => ({ ...EMPTY_GRID_QUERY, pageSize: 100, ...extra });
const total = (field: "undamagedQty" | "totalQty" | "damagedQty") => listTotalInventory(w.db, auth, q()).rows.find((r) => r.productId === w.productId)?.[field];
const atp = () => listAtp(w.db, auth, q()).rows.find((r) => r.productId === w.productId);

describe("Adjust (acceptance: 20 → 18 with reason)", () => {
  it("posts Inventory Adjustment −2 with reason and user, and drops totals and ATP by 2", () => {
    const b = stock(20);
    const atpBefore = atp()?.currentAtp ?? 0;
    const res = changeQuantity(w.db, ctx(), b.id, { mode: "adjust", qty: 18, reasonId, version: bucket(b.id)?.version });
    expect(res).toMatchObject({ from: 20, to: 18, delta: -2 });
    expect(bucket(b.id)?.onHand).toBe(18);
    expect(total("totalQty")).toBe(18);
    expect(atp()?.currentAtp).toBe(atpBefore - 2);
    const txn = getBucketDetail(w.db, auth, b.id).transactions[0];
    expect(txn).toMatchObject({ type: "Inventory Adjustment", reason: "Inventory quantity discrepancy", user: "Admin" });
    const log = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.parentEntityId, w.loc.storageA)).all();
    expect(log.some((l) => l.field === "quantity")).toBe(true);
    clean();
  });

  it("rejects a stale version with CONFLICT and the same quantity with VALIDATION", () => {
    const b = stock(20);
    expect(() => changeQuantity(w.db, ctx(), b.id, { mode: "adjust", qty: 18, version: 999 })).toThrow(/changed/i);
    expect(() => changeQuantity(w.db, ctx(), b.id, { mode: "adjust", qty: 20 })).toThrow(/equals the current/);
  });

  it("requires a reason when the warehouse says so", () => {
    w.db.update(schema.warehouses).set({ mandatoryAdjustmentReason: true }).where(eq(schema.warehouses.id, w.warehouseId)).run();
    const b = stock(5);
    expect(() => changeQuantity(w.db, ctx(), b.id, { mode: "add", qty: 1 })).toThrow(/reason is required/);
    expect(changeQuantity(w.db, ctx(), b.id, { mode: "add", qty: 1, reasonId }).to).toBe(6);
    expect(inventoryReasons(w.db, auth).mandatoryReason[w.warehouseId]).toBe(true);
  });

  it("add and remove change on-hand; remove can't exceed free stock", () => {
    const b = stock(10);
    expect(changeQuantity(w.db, ctx(), b.id, { mode: "add", qty: 4 }).to).toBe(14);
    expect(changeQuantity(w.db, ctx(), b.id, { mode: "remove", qty: 3 }).to).toBe(11);
    expect(() => changeQuantity(w.db, ctx(), b.id, { mode: "remove", qty: 50 })).toThrow();
    clean();
  });

  it("validates the request schema", () => {
    expect(quantityChangeSchema.safeParse({ mode: "add", qty: 0 }).success).toBe(false);
    expect(quantityChangeSchema.safeParse({ mode: "adjust", qty: 0 }).success).toBe(true);
    expect(quantityChangeSchema.safeParse({ mode: "remove", qty: 1.5 }).success).toBe(false);
  });
});

describe("Allocated rows", () => {
  it("only Stock rows accept row actions", () => {
    stock(10);
    const order = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 4 }]));
    allocateOrders(w.db, w.ctx, { orderIds: [order.id], warehouseId: w.warehouseId });
    const rows = listBuckets(w.db, auth, q()).rows.filter((r) => r.productId === w.productId);
    const allocated = rows.find((r) => r.allocatedQty > 0);
    expect(allocated).toBeDefined();
    const detail = getBucketDetail(w.db, auth, allocated!.id);
    expect(detail.allocations[0]?.orderCode).toBe(order.code);
    // Open SO deep link resolves exactly this order
    const open = openOrdersFor(w.db, auth, { productId: w.productId, warehouseId: w.warehouseId });
    expect(open.map((o) => o.code)).toEqual([order.code]);
    const href = new URL(openOrdersHref(open, { sku: "MLT-WIDGET-01" }), "http://x");
    expect(href.pathname).toBe("/orders");
    expect(Object.fromEntries(href.searchParams)).toEqual({ "f.sku": "eq:MLT-WIDGET-01", "f.status": `in:${open[0]!.status}` });
    expect(new URL(openOrdersHref([], { sku: "X", warehouseId: "w1" }), "http://x").searchParams.get("f.status")?.startsWith("in:Open,Shortage,On Hold,")).toBe(true);
    const nonStock = rows.find((r) => r.status !== "Stock");
    if (nonStock) expect(() => changeQuantity(w.db, ctx(), nonStock.id, { mode: "add", qty: 1 })).toThrow(/can't be changed/);
  });
});

describe("Transfers", () => {
  it("Transfer Product moves a partial quantity as Inventory Movement", () => {
    const b = stock(20);
    const res = transferProduct(w.db, ctx(), { inventoryId: b.id, qty: 5, target: { kind: "location", id: w.loc.storageB } });
    expect(res.moved).toEqual([{ sku: "MLT-WIDGET-01", qty: 5, from: "A-01-01", to: "A-02-01" }]);
    expect(onHandAt(w.loc.storageA)).toBe(15);
    expect(onHandAt(w.loc.storageB)).toBe(5);
    const txn = w.db.select().from(schema.inventoryTransactions).all().at(-1);
    expect(txn?.type).toBe("Inventory Movement");
    clean();
  });

  it("blocks a transfer into an only-1-SKU location that holds another SKU, naming the rule", () => {
    const strict = w.db.insert(schema.locations).values(locationRow(w.warehouseId, "MLT1-A-01", { onlyOneSku: true })).returning().get().id;
    stock(3, strict, w.product2Id);
    const b = stock(10);
    expect(() => transferProduct(w.db, ctx(), { inventoryId: b.id, qty: 2, target: { kind: "location", id: strict } }))
      .toThrow("Location MLT1-A-01 allows only 1 SKU (holds MLT-GADGET-02).");
    expect(onHandAt(w.loc.storageA)).toBe(10);
  });

  it("rejects an over-quantity transfer with the Logiwa copy and leaves stock untouched", () => {
    const b = stock(21);
    expect(() => transferProduct(w.db, ctx(), { inventoryId: b.id, qty: 99, target: { kind: "location", id: w.loc.storageB } }))
      .toThrow("The entered transfer quantity exceeds the existing inventory amount.");
    expect(onHandAt(w.loc.storageA)).toBe(21);
    clean();
  });

  it("rejects moving to the same place", () => {
    const b = stock(4);
    expect(() => transferProduct(w.db, ctx(), { inventoryId: b.id, qty: 1, target: { kind: "location", id: w.loc.storageA } })).toThrow(/already in/);
  });

  it("Transfer Location moves every SKU and lists each one", () => {
    stock(6);
    stock(2, w.loc.storageA, w.product2Id);
    const summary = locationSummary(w.db, auth, w.loc.storageA);
    expect(summary).toMatchObject({ skuCount: 2, skuLabel: "Multi", packQty: 8 });
    const res = transferLocation(w.db, ctx(), { fromLocationId: w.loc.storageA, target: { kind: "location", id: w.loc.storageB } });
    expect(res.moved.map((m) => [m.sku, m.qty])).toEqual([["MLT-GADGET-02", 2], ["MLT-WIDGET-01", 6]]);
    expect(onHandAt(w.loc.storageA) + onHandAt(w.loc.storageA, w.product2Id)).toBe(0);
    expect(() => transferLocation(w.db, ctx(), { fromLocationId: w.loc.storageA, target: { kind: "location", id: w.loc.storageB } })).toThrow(/empty/);
    clean();
  });

  it("Transfer LP moves an LP with its stock to another location", () => {
    const lpTypeId = w.db.insert(schema.lpTypes).values({ code: "PLT", description: "Pallet", warehouseId: w.warehouseId, numberPrefix: "PLT", numberLength: 6 }).returning().get().id;
    const lpId = w.db.insert(schema.licensePlates).values({ number: "LP0001", warehouseId: w.warehouseId, lpTypeId, locationId: w.loc.storageA }).returning().get().id;
    ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, lpId, qty: 7 });
    const res = transferLp(w.db, ctx(), { lpId, target: { kind: "location", id: w.loc.storageB } });
    expect(res.totalQty).toBe(7);
    expect(onHandAt(w.loc.storageB)).toBe(7);
    clean();
  });
});

describe("Change attributes", () => {
  it("Damage Reason → Damaged on 3 units moves them out of Undamaged and Current ATP", () => {
    const b = stock(20);
    const before = { undamaged: total("undamagedQty"), atp: atp()?.currentAtp ?? 0 };
    const res = changeAttributes(w.db, ctx(), { ids: [b.id], attribute: "damageReason", value: "Damaged", qty: 3 });
    expect(res.failed).toEqual([]);
    expect(total("undamagedQty")).toBe((before.undamaged ?? 0) - 3);
    expect(total("damagedQty")).toBe(3);
    expect(atp()?.currentAtp).toBe(before.atp - 3);
    clean();
  });

  it("changes the lot on every selected row and reports per-row failures", () => {
    w.db.update(schema.products).set({ trackLot: true }).where(eq(schema.products.id, w.productId)).run();
    const a = stock(5);
    const b = stock(5, w.loc.storageB);
    const res = changeAttributes(w.db, ctx(), { ids: [a.id, b.id, "missing"], attribute: "lotNumber", value: "LOT-7" });
    expect(res.succeeded).toHaveLength(2);
    expect(res.failed.map((f) => f.id)).toEqual(["missing"]);
    expect(listBuckets(w.db, auth, q()).rows.filter((r) => r.lotNumber === "LOT-7")).toHaveLength(2);
    clean();
  });

  it("rejects unknown damage reasons and bad dates", () => {
    const a = stock(5);
    expect(() => changeAttributes(w.db, ctx(), { ids: [a.id], attribute: "damageReason", value: "Nope" })).toThrow(/not a damage reason/);
    expect(changeAttributesSchema.safeParse({ ids: [a.id], attribute: "expiryDate", value: "12/01/2027" }).success).toBe(false);
    expect(changeAttributesSchema.safeParse({ ids: [a.id, "b"], attribute: "lotNumber", value: "x", qty: 1 }).success).toBe(false);
  });
});

describe("Add Inventory", () => {
  it("adds stock with tracked attributes and enforces them", () => {
    w.db.update(schema.products).set({ trackLot: true }).where(eq(schema.products.id, w.productId)).run();
    const base = { warehouseId: w.warehouseId, locationId: w.loc.storageA, clientId: w.clientId, productId: w.productId, packType: "Each", qty: 4 };
    expect(productOptions(w.db, auth, w.productId).trackLot).toBe(true);
    expect(() => addInventory(w.db, ctx(), base)).toThrow(/tracked attributes/);
    const res = addInventory(w.db, ctx(), { ...base, lotNumber: "L1", reasonId });
    expect(res.to).toBe(4);
    expect(() => addInventory(w.db, ctx(), { ...base, lotNumber: "L1", clientId: w.otherClientId })).toThrow(/another client/);
    clean();
  });
});

describe("Grid reads", () => {
  it("Total Inventory aggregates to All Warehouses without a warehouse filter and splits with one", () => {
    stock(5);
    stock(3, w.loc.storageB);
    const all = listTotalInventory(w.db, auth, q()).rows.find((r) => r.productId === w.productId);
    expect(all).toMatchObject({ warehouse: "All Warehouses", totalQty: 8, warehouseId: null });
    const split = listTotalInventory(w.db, auth, q({ filters: [{ field: "warehouse", op: "in", values: [w.warehouseId] }] })).rows.find((r) => r.productId === w.productId);
    expect(split).toMatchObject({ warehouseId: w.warehouseId, totalQty: 8 });
  });

  it("By-location grid filters, searches and sorts by grid grammar", () => {
    stock(5);
    stock(3, w.loc.storageB, w.product2Id);
    expect(listBuckets(w.db, auth, q({ q: "MLT-GAD", qm: "sw" })).total).toBe(1);
    expect(listBuckets(w.db, auth, q({ filters: [{ field: "totalQty", op: "rng", min: "4", max: "10" }] })).rows.map((r) => r.sku)).toEqual(["MLT-WIDGET-01"]);
    expect(listBuckets(w.db, auth, q({ sort: [{ field: "totalQty", dir: "asc" }] })).rows.map((r) => r.totalQty)).toEqual([3, 5]);
    expect(() => listBuckets(w.db, auth, q({ sort: [{ field: "nope", dir: "asc" }] }))).toThrow(/Cannot sort/);
  });

  it("hides out-of-scope warehouses", () => {
    stock(5);
    const none = { ...auth, scope: { warehouseIds: [], clientIds: "all" }, viewScope: { warehouseIds: [], clientIds: "all" } } as unknown as AuthContext;
    expect(listBuckets(w.db, none, q()).total).toBe(0);
    expect(() => getBucketDetail(w.db, none, listBuckets(w.db, auth, q()).rows[0].id)).toThrow();
  });
});

describe("count-plan location locks (critic R2 #1)", () => {
  const lock = (locationId: string) => {
    const p = w.db.insert(schema.countPlans).values({ code: "KS-LOCK-1", warehouseId: w.warehouseId, scheduledAt: "2026-11-09", lockLocations: true, countType: "Location" as never }).returning().get();
    w.db.insert(schema.countPlanLines).values({ planId: p.id, locationId }).run();
    return p;
  };

  it("blocks Add / Adjust / Remove / header Add / Change Attributes in a locked location, like transfers", () => {
    const b = stock(21);
    lock(w.loc.storageA);
    expect(() => changeQuantity(w.db, ctx(), b.id, { mode: "add", qty: 1 })).toThrow(/locked by count plan KS-LOCK-1/);
    expect(() => changeQuantity(w.db, ctx(), b.id, { mode: "adjust", qty: 20, reasonId })).toThrow(/locked by count plan/);
    expect(() => changeQuantity(w.db, ctx(), b.id, { mode: "remove", qty: 1 })).toThrow(/locked by count plan/);
    expect(() => addInventory(w.db, ctx(), { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 1, packType: "Each" } as never)).toThrow(/locked by count plan/);
    const res = changeAttributes(w.db, ctx(), { ids: [b.id], attribute: "lotNumber", value: "LOT-9" } as never);
    expect(res.failed.length).toBe(1);
    expect(bucket(b.id)?.onHand).toBe(21);
    expect(listBuckets(w.db, auth, q()).rows.find((r) => r.id === b.id)?.countLockPlan).toBe("KS-LOCK-1");
    clean();
  });

  it("leaves other locations writable and exposes no lock", () => {
    const b = stock(5);
    lock(w.loc.storageB);
    expect(changeQuantity(w.db, ctx(), b.id, { mode: "add", qty: 1 }).to).toBe(6);
    expect(listBuckets(w.db, auth, q()).rows.find((r) => r.id === b.id)?.countLockPlan).toBeNull();
  });
});

describe("calendar date validation (round 3)", () => {
  it("rejects impossible dates and accepts real ones", async () => {
    const { isValidIsoDate } = await import("@/server/repositories/inventory-commands");
    expect(isValidIsoDate("2026-13-45")).toBe(false);
    expect(isValidIsoDate("2026-02-31")).toBe(false);
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2028-02-29")).toBe(true);
    expect(isValidIsoDate("2026-12-31")).toBe(true);
    expect(changeAttributesSchema.safeParse({ ids: ["x"], attribute: "expiryDate", value: "2026-13-45" }).success).toBe(false);
    expect(changeAttributesSchema.safeParse({ ids: ["x"], attribute: "expiryDate", value: "2026-11-30" }).success).toBe(true);
  });
});

describe("critic round 2 (parity loop) fixes", () => {
  const txns = () => w.db.select().from(schema.inventoryTransactions).all();

  it("Remove all units posts −qty, deletes the emptied record and keeps the ledger reconciled", () => {
    const b = stock(1);
    const res = changeQuantity(w.db, ctx(), b.id, { mode: "remove", qty: 1, reasonId });
    expect(res).toMatchObject({ from: 1, to: 0, delta: -1 });
    expect(bucket(b.id)).toBeUndefined();
    const t = txns().at(-1);
    expect(t).toMatchObject({ type: "Inventory Adjustment", uomQty: -1, toInventoryId: b.id, fromInventoryId: null });
    clean();
  });

  it("Adjust to 0 succeeds and deletes the record; adjust-down and remove share the sign convention", () => {
    const a = stock(10);
    changeQuantity(w.db, ctx(), a.id, { mode: "remove", qty: 2 });
    changeQuantity(w.db, ctx(), a.id, { mode: "adjust", qty: 6 });
    const [remove, adjust] = txns().slice(-2);
    expect(Math.sign(remove.uomQty)).toBe(-1);
    expect(Math.sign(adjust.uomQty)).toBe(-1);
    expect(changeQuantity(w.db, ctx(), a.id, { mode: "adjust", qty: 0 }).to).toBe(0);
    expect(bucket(a.id)).toBeUndefined();
    clean();
  });

  it("keeps an emptied bucket that allocations still point at", async () => {
    const { pruneEmptyBuckets } = await import("@/server/repositories/inventory-commands");
    const b = stock(4);
    const order = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 4 }]));
    allocateOrders(w.db, w.ctx, { orderIds: [order.id], warehouseId: w.warehouseId });
    // Force an empty-looking row that still has allocation history: pruning must leave it alone.
    const allocatedBucket = w.db.select().from(schema.inventoryAllocations).all()[0]?.inventoryId ?? b.id;
    expect(pruneEmptyBuckets(w.db, [allocatedBucket])).toEqual([]);
    expect(bucket(allocatedBucket)).toBeDefined();
  });

  it("Transfer Product of the whole row leaves no ghost Stock 0 row behind", () => {
    const b = stock(5);
    transferProduct(w.db, ctx(), { inventoryId: b.id, qty: 5, target: { kind: "location", id: w.loc.storageB } });
    expect(bucket(b.id)).toBeUndefined();
    expect(onHandAt(w.loc.storageB)).toBe(5);
    clean();
  });

  it("validates lot values and refuses lot/expiry on products that don't track them", () => {
    expect(changeAttributesSchema.safeParse({ ids: ["x"], attribute: "lotNumber", value: "<img src=x onerror=alert(1)>" }).success).toBe(false);
    expect(changeAttributesSchema.safeParse({ ids: ["x"], attribute: "lotNumber", value: "LOT-2026/01 #4" }).success).toBe(true);
    const a = stock(5);
    const res = changeAttributes(w.db, ctx(), { ids: [a.id], attribute: "expiryDate", value: "2027-01-31" });
    expect(res.failed[0]?.message).toMatch(/doesn't track expiry dates/);
    expect(bucket(a.id)?.expiryDate ?? null).toBeNull();
  });

  it("placement check flags a count-locked target and an only-1-SKU location that holds another SKU", async () => {
    const { placementCheck } = await import("@/server/repositories/inventory-lookups");
    const strict = w.db.insert(schema.locations).values(locationRow(w.warehouseId, "MLT1-A-01", { onlyOneSku: true })).returning().get().id;
    stock(3, strict, w.product2Id);
    expect(placementCheck(w.db, auth, { kind: "location", id: strict, productIds: [w.productId] }).blocking).toBe("Location MLT1-A-01 allows only 1 SKU (holds MLT-GADGET-02).");
    expect(placementCheck(w.db, auth, { kind: "location", id: strict, productIds: [w.product2Id] }).blocking).toBeNull();
    stock(2, w.loc.storageB);
    const p = w.db.insert(schema.countPlans).values({ code: "KS-LOCK-2", warehouseId: w.warehouseId, scheduledAt: "2026-11-09", lockLocations: true, countType: "Location" as never }).returning().get();
    w.db.insert(schema.countPlanLines).values({ planId: p.id, locationId: w.loc.storageB }).run();
    const locked = placementCheck(w.db, auth, { kind: "location", id: w.loc.storageB, productIds: [w.productId] });
    expect(locked).toMatchObject({ countLockPlan: "KS-LOCK-2" });
    expect(locked.blocking).toMatch(/locked by count plan KS-LOCK-2/);
    expect(locationSummary(w.db, auth, w.loc.storageB).lockMessage).toMatch(/KS-LOCK-2/);
  });
});
