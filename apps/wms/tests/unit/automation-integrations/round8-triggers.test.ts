/**
 * Round 4 parity loop (M12): every workflow trigger is dispatched (one active workflow per
 * trigger writes a workflow_runs row), PO conditions/test, and the new allocation fields
 * (Is Partial, Precartonization Type, Number of Boxes, pack-type preferences, full LPs).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import type { Scope } from "@/server/auth/scope";
import { WORKFLOW_TRIGGERS } from "@/lib/enums";
import { channelSettingsSchema } from "@/lib/domain-types";
import { actionsForTrigger, conditionCatalogForTrigger, workflowSaveSchema, type WorkflowTrigger } from "@/lib/grid-defs/integrations/workflows";
import { fieldDef, INVENTORY_CONDITION_FIELDS, ORDER_CONDITION_FIELDS } from "@/lib/grid-defs/integrations/rule-fields";
import { allocateOrders } from "@/server/domain/allocation";
import { splitAllocationPreferences } from "@/server/domain/allocation-preferences";
import { orderFacts } from "@/server/domain/facts";
import { createJobsFromOrders } from "@/server/domain/jobs";
import { ledger } from "@/server/domain/ledger";
import { createOrder, updateOrder } from "@/server/domain/orders/create-update";
import { createLabel, shipOrders } from "@/server/domain/shipping";
import { execute } from "@/server/domain/tasks";
import { runChannelMethod } from "@/server/integrations/runtime/channel-runtime";
import { createAlgorithm } from "@/server/repositories/algorithms";
import { applyShipmentOrderRow } from "@/server/repositories/orders-import";
import { createPurchaseOrder } from "@/server/repositories/purchase-orders-commands";
import { createWorkflow, testOrderOptions, testWorkflow } from "@/server/repositories/workflows";
import { algorithmSaveSchema } from "@/lib/grid-defs/integrations/algorithms";
import { poCreateSchema } from "@/lib/grid-defs/receiving/po-schemas";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;
const actor = () => ({ userId: w.userId, source: "admin@test.io" });

beforeEach(async () => {
  w = await createWorld();
  const scope: Scope = { warehouseIds: [w.warehouseId], clientIds: "all" };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
});
afterEach(() => w.close());

async function activeWorkflow(trigger: WorkflowTrigger, name = `WF ${trigger}`) {
  const action = actionsForTrigger(trigger).includes("Add Tag")
    ? { action: "Add Tag" as const, params: { tag: `T-${trigger.replace(/\s+/g, "")}` } }
    : { action: "Notify Users" as const, params: { userIds: [w.userId] } };
  return await createWorkflow(w.db, auth, actor(), workflowSaveSchema.parse({ name, trigger, match: "All", isActive: true, stopProcessing: false, conditions: [], actions: [action] }));
}
const runsOf = async (workflowId: string) => await w.db.select().from(schema.workflowRuns).where(eq(schema.workflowRuns.workflowId, workflowId));

async function vendorId(): Promise<string> {
  return (await w.db.insert(schema.vendors).values({ clientId: w.clientId, displayName: "Acme Supply", vendorName: "Acme Supply LLC" } as typeof schema.vendors.$inferInsert).returning())[0].id;
}
async function createPo(code = "PO-WF-1") {
  return await createPurchaseOrder(w.db, w.ctx, auth.scope, poCreateSchema.parse({
    warehouseId: w.warehouseId, clientId: w.clientId, code, poType: "Purchase Order", poDate: new Date().toISOString(), vendorId: await vendorId(),
    lines: [{ productId: w.productId, packType: "Each", orderedQuantity: 10, unitCost: 2.5 }],
  }));
}

/** Order taken through allocation, pick, pack and label -> Ready to Ship. */
async function readyToShip(): Promise<string> {
  await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 5 });
  const o = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 2 }]));
  await allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
  const { jobIds: [jobId] } = await createJobsFromOrders(w.db, w.ctx, { orderIds: [o.id], jobTypeId: w.jobTypeId });
  const tasks = await w.db.select().from(schema.tasks).where(eq(schema.tasks.jobId, jobId as string));
  await execute(w.db, w.ctx, { taskIds: tasks.filter((t) => t.taskType === "Picking").map((t) => t.id), targetLocationId: w.loc.pick });
  await execute(w.db, w.ctx, { taskIds: tasks.filter((t) => t.taskType === "Packing").map((t) => t.id), targetLocationId: w.loc.pack });
  await createLabel(w.db, w.ctx, { orderId: o.id, carrierConnectionId: w.carrierConnectionId, carrierServiceId: w.serviceIds.ground, packages: [{ weightOz: 20, length: 10, width: 8, height: 4 }] }, { files: w.files });
  return o.id;
}

describe("every workflow trigger is dispatched", () => {
  it("covers all five triggers in the enum", () => {
    expect([...WORKFLOW_TRIGGERS].sort()).toEqual(["Order Shipped", "Purchase Order Created", "Shipment Order Created", "Shipment Order Imported", "Shipment Order Updated"]);
  });

  it("Shipment Order Created fires on a manual/API create", async () => {
    const wf = await activeWorkflow("Shipment Order Created");
    const imported = await activeWorkflow("Shipment Order Imported");
    const o = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    expect((await runsOf(wf.id)).map((r) => r.entityId)).toEqual([o.id]);
    expect(await runsOf(imported.id)).toHaveLength(0);
  });

  it("Shipment Order Updated fires on an edit", async () => {
    const o = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const wf = await activeWorkflow("Shipment Order Updated");
    const row = (await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, o.id)).limit(1))[0];
    await updateOrder(w.db, w.ctx, { id: o.id, version: row?.version ?? 1, patch: { note: "edited" } });
    expect((await runsOf(wf.id)).length).toBeGreaterThan(0);
  });

  it("Shipment Order Imported fires for an Excel/CSV import row", async () => {
    const wf = await activeWorkflow("Shipment Order Imported");
    const created = await activeWorkflow("Shipment Order Created");
    const client = (await w.db.select().from(schema.clients).where(eq(schema.clients.id, w.clientId)).limit(1))[0];
    const wh = (await w.db.select().from(schema.warehouses).where(eq(schema.warehouses.id, w.warehouseId)).limit(1))[0];
    const res = await applyShipmentOrderRow({ db: w.db, auth, actor: actor(), batchId: "batch-1", rowNumber: 1 }, {
      orderCode: "IMP-1", sku: "MLT-WIDGET-01", quantity: 1, clientCode: client?.code ?? "", warehouseCode: wh?.code ?? "",
      shipToName: "Jane", shipToAddress1: "1 Main", shipToCity: "Memphis", shipToPostalCode: "38118", shipToState: "TN", shipToCountry: "US",
    });
    expect((await runsOf(wf.id)).map((r) => r.entityId)).toEqual([res.entityId]);
    // Created workflows still run for every new order, after the Imported ones.
    expect((await runsOf(created.id)).map((r) => r.entityId)).toEqual([res.entityId]);
    expect((await runsOf(wf.id))[0]?.at <= ((await runsOf(created.id))[0]?.at ?? "")).toBe(true);
  });

  it("Shipment Order Imported fires for a channel download", async () => {
    const wf = await activeWorkflow("Shipment Order Imported");
    const settings = channelSettingsSchema.parse({ paymentStatuses: ["paid", "pending"], orders: { download: true, createNonexistentProducts: true, partialOrders: true } });
    const c = (await w.db.insert(schema.channelConnections).values({ provider: "shopify", storeName: "KS-TEST Sandbox", clientId: w.clientId, distribution: "API", status: "Completed", settings }).returning())[0];
    await w.db.insert(schema.channelLocationMappings).values({ connectionId: c.id, channelLocationId: "sbx-loc-main", channelLocationName: "Main", warehouseId: w.warehouseId });
    const m = (await w.db.insert(schema.channelMethods).values({ connectionId: c.id, method: "Download Orders", status: "Active", intervalMinutes: 15 }).returning())[0];
    const run = await runChannelMethod(w.db, m.id, { manual: true });
    expect(run.success).toBeGreaterThan(0);
    expect((await runsOf(wf.id)).length).toBe(run.success);
  });

  it("Purchase Order Created fires on PO create and notifies with a PO link", async () => {
    const wf = await activeWorkflow("Purchase Order Created");
    const po = await createPo();
    const runs = await runsOf(wf.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ entityType: "purchase_order", entityId: po.id, matched: true, actionsApplied: ["Notify Users"] });
    const note = (await w.db.select().from(schema.notifications).where(eq(schema.notifications.userId, w.userId))).at(-1);
    expect(note?.href).toBe(`/receiving/${po.id}`);
  });

  it("Order Shipped fires on ship confirm and tags the order", async () => {
    const wf = await activeWorkflow("Order Shipped");
    const id = await readyToShip();
    const res = await shipOrders(w.db, w.ctx, { orderIds: [id] });
    expect(res.failed).toEqual([]);
    expect(await runsOf(wf.id)).toMatchObject([{ entityId: id, matched: true, actionsApplied: ["Add Tag"] }]);
  });
});

describe("trigger-specific builder rules", () => {
  it("uses PO fields for PO triggers and rejects order fields there", () => {
    expect(conditionCatalogForTrigger("Purchase Order Created")).toBe("purchaseOrder");
    expect(actionsForTrigger("Order Shipped")).toEqual(["Add Tag", "Notify Users"]);
    const bad = workflowSaveSchema.safeParse({ name: "x", trigger: "Purchase Order Created", match: "All", isActive: true, stopProcessing: false,
      conditions: [{ field: "customerName", comparator: "contains", value: "x" }], actions: [{ action: "Notify Users", params: { userIds: ["u"] } }] });
    expect(bad.success).toBe(false);
  });

  it("evaluates PO conditions and tests against a purchase order (rolled back)", async () => {
    const po = await createPo("PO-TEST-9");
    const body = workflowSaveSchema.parse({ name: "Big PO", trigger: "Purchase Order Created", match: "All", isActive: true, stopProcessing: false,
      conditions: [{ field: "orderQuantity", comparator: "gte", value: 5 }, { field: "sku", comparator: "equals", value: "MLT-WIDGET-01" }],
      actions: [{ action: "Notify Users", params: { userIds: [w.userId] } }] });
    const before = (await w.db.select().from(schema.notifications)).length;
    const res = await testWorkflow(w.db, auth, actor(), body, po.id);
    expect(res).toMatchObject({ orderCode: "PO-TEST-9", matched: true });
    expect(res.actions[0]?.applied).toBe(true);
    expect((await w.db.select().from(schema.notifications)).length).toBe(before);
    expect((await testOrderOptions(w.db, auth, "PO-TEST", "po")).map((o) => o.id)).toContain(po.id);
  });
});

describe("allocation order fields", () => {
  it("lists Is Partial, Precartonization Type and Number of Boxes with facts", async () => {
    for (const k of ["isPartial", "precartonizationType", "numberOfBoxes"]) expect(fieldDef("order", k)).toBeDefined();
    const o = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 3 }, { productId: w.product2Id, quantity: 1 }]));
    const row = (await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, o.id)).limit(1))[0];
    if (!row) throw new Error("order");
    expect(await orderFacts(w.db, row)).toMatchObject({ isPartial: false, precartonizationType: "None", numberOfBoxes: 1 });
    // The widget ships in its own box: 3 own boxes + 1 shared box for the gadget.
    await w.db.insert(schema.productPackTypes).values({ productId: w.productId, packType: "Each", kind: "Primary", useOwnBox: true });
    expect(await orderFacts(w.db, row)).toMatchObject({ precartonizationType: "Mixed", numberOfBoxes: 4 });
    // Partly allocated (one line held, the other not yet) -> Is Partial.
    await w.db.update(schema.orderLines).set({ allocatedQuantity: 3 }).where(and(eq(schema.orderLines.orderId, o.id), eq(schema.orderLines.productId, w.productId)));
    expect((await orderFacts(w.db, row)).isPartial).toBe(true);
  });
});

describe("allocation inventory preferences", () => {
  const fields = ["prioritizeSamePackType", "prioritizeHigherPackType", "onlyAllocateFullLps"];
  it("lists the three preference fields and splits them from bucket filters", () => {
    for (const k of fields) expect(INVENTORY_CONDITION_FIELDS.some((d) => d.key === k)).toBe(true);
    expect(ORDER_CONDITION_FIELDS.some((d) => d.key === "isPartial")).toBe(true);
    const { conditions, prefs } = splitAllocationPreferences([
      { field: "onlyAllocateFullLps", comparator: "equals", value: true }, { field: "areaType", comparator: "in", value: ["Storage"] },
      { field: "prioritizeSamePackType", comparator: "equals", value: false },
    ]);
    expect(conditions.map((c) => c.field)).toEqual(["areaType"]);
    expect(prefs).toEqual({ onlyAllocateFullLps: true, prioritizeSamePackType: false, prioritizeHigherPackType: false });
  });

  async function allocationAlgo(inventoryConditions: { field: string; comparator: "equals"; value: boolean }[]) {
    return await createAlgorithm(w.db, auth, actor(), algorithmSaveSchema.parse({
      kind: "Allocation", name: "Prefs", warehouseId: w.warehouseId, status: "Active",
      rules: [{ name: "Prefs rule", conditions: [], inventoryConditions, orderBy: [{ field: "walkingPathPriority", dir: "asc" }] }],
    }));
  }
  const allocatedFrom = async (orderId: string) => await w.db.select({ inv: schema.inventory, qty: schema.inventoryAllocations.qty }).from(schema.inventoryAllocations)
    .innerJoin(schema.inventory, eq(schema.inventory.id, schema.inventoryAllocations.inventoryId)).where(eq(schema.inventoryAllocations.orderId, orderId));

  it("Prioritize Same Pack Type takes the line's pack type first", async () => {
    await allocationAlgo([{ field: "prioritizeSamePackType", comparator: "equals", value: true }]);
    await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 10, packType: "Each" });
    await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageB, qty: 10, packType: "Case" });
    const o = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 2, packType: "Case" } as { productId: string; quantity: number }]));
    await allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
    expect((await allocatedFrom(o.id)).map((a) => a.inv.packType)).toEqual(["Case"]);
  });

  it("Only Allocate Full LPs skips loose stock and LPs larger than the need", async () => {
    await allocationAlgo([{ field: "onlyAllocateFullLps", comparator: "equals", value: true }]);
    const type = (await w.db.insert(schema.lpTypes).values({ warehouseId: w.warehouseId, code: "T-PAL", numberPrefix: "LP", numberLength: 4 }).returning())[0];
    const lp = async (number: string) => (await w.db.insert(schema.licensePlates).values({ number, warehouseId: w.warehouseId, lpTypeId: type.id, locationId: w.loc.storageA }).returning())[0].id;
    const big = await lp("LP-BIG");
    const exact = await lp("LP-EXACT");
    await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 20 });
    await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 9, lpId: big });
    await ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 4, lpId: exact });
    // Need 4: the 9-unit LP doesn't fit, the loose 20 aren't on an LP, the 4-unit LP is taken whole.
    const o = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 4 }]));
    await allocateOrders(w.db, w.ctx, { orderIds: [o.id], warehouseId: w.warehouseId });
    expect((await allocatedFrom(o.id)).map((a) => [a.inv.lpId, a.qty])).toEqual([[exact, 4]]);
    // Need 5 with only the 9-unit LP left: nothing fits whole, so the line is short.
    const o2 = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 5 }]));
    await allocateOrders(w.db, w.ctx, { orderIds: [o2.id], warehouseId: w.warehouseId });
    expect(await allocatedFrom(o2.id)).toEqual([]);
    expect((await w.db.select().from(schema.orderLineShortages).where(eq(schema.orderLineShortages.orderId, o2.id)).limit(1))[0]?.shortageQty).toBe(5);
  });
});
