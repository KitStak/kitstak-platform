/** M12 repositories against a test DB: algorithms, workflows + executors, channel runtime, monitoring release, presets. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import type { AuthContext } from "@/server/auth/context";
import type { Scope } from "@/server/auth/scope";
import { createOrder } from "@/server/domain/orders/create-update";
import { channelSettingsSchema } from "@/lib/domain-types";
import { createAlgorithm, deleteAlgorithms, testPutaway, updateAlgorithm } from "@/server/repositories/algorithms";
import { createWorkflow, testWorkflow } from "@/server/repositories/workflows";
import { createPreset, deletePresets } from "@/server/repositories/rate-shopping";
import { releaseBlocked, listingExceptionRows } from "@/server/repositories/monitoring";
import { retryMissingOrders, runChannelMethod } from "@/server/integrations/runtime/channel-runtime";
import { algorithmSaveSchema } from "@/lib/grid-defs/integrations/algorithms";
import { workflowSaveSchema } from "@/lib/grid-defs/integrations/workflows";
import { presetSaveSchema } from "@/lib/grid-defs/integrations/rate-shopping";
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

describe("algorithms", () => {
  const putaway = (name: string, extra: Record<string, unknown> = {}) => algorithmSaveSchema.parse({
    kind: "Putaway", name, warehouseId: w.warehouseId, status: "Active",
    rules: [{ name: "Same SKU", conditions: [{ field: "isReceivingProcess", comparator: "equals", value: true }], actions: [{ action: "suggestEmptyLocation" }], orderBy: [{ field: "walkingPathPriority", dir: "asc" }] }], ...extra,
  });

  it("makes the previous replenishment algorithm passive and keeps one active", async () => {
    const a = await createAlgorithm(w.db, auth, actor(), putaway("Repl A", { isDynamicReplenishment: true }));
    const b = await createAlgorithm(w.db, auth, actor(), putaway("Repl B", { isDynamicReplenishment: true }));
    expect(b.notes[0]).toContain("Repl A is now passive");
    expect((await w.db.select().from(schema.algorithms).where(eq(schema.algorithms.id, a.algorithm.id)).limit(1))[0]?.status).toBe("Passive");
    await expect(async () => await updateAlgorithm(w.db, auth, actor(), b.algorithm.id, { ...putaway("Repl B", { isDynamicReplenishment: false }), version: b.algorithm.version })).rejects.toThrow(/At least one replenishment algorithm/);
  });

  it("tests a putaway draft without writing and names the winning rule", async () => {
    const before = (await w.db.select().from(schema.algorithms)).length;
    const res = await testPutaway(w.db, auth, null, { warehouseId: w.warehouseId, productId: w.productId, qty: 2, isReceiving: true, draft: { warehouseId: w.warehouseId, rules: putaway("x").rules } });
    expect(res.rule).toBe("Same SKU");
    expect(res.suggestions.length).toBeGreaterThan(0);
    expect((await w.db.select().from(schema.algorithms)).length).toBe(before);
  });

  it("blocks deleting a system algorithm", async () => {
    const a = await createAlgorithm(w.db, auth, actor(), putaway("Sys"));
    await w.db.update(schema.algorithms).set({ isSystem: true }).where(eq(schema.algorithms.id, a.algorithm.id));
    const res = await deleteAlgorithms(w.db, auth, actor(), [a.algorithm.id]);
    expect(res.failed[0]?.message).toMatch(/System algorithms/);
  });
});

describe("workflows", () => {
  const wf = (extra: Record<string, unknown>) => workflowSaveSchema.parse({
    name: "Block PO Box", trigger: "Shipment Order Created", match: "Any", isActive: true, stopProcessing: false,
    conditions: [{ field: "customerName", comparator: "contains", value: "PO" }], actions: [{ action: "Block Order", params: {} }, { action: "Set Priority", params: { priority: "High" } }, { action: "Add Tag", params: { tag: "Review" } }], ...extra,
  });

  it("blocks a matching new order fully and Release clears it", async () => {
    await createWorkflow(w.db, auth, actor(), wf({}));
    const order = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }], { customerName: "PO Holder" }));
    const row = (await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, order.id)).limit(1))[0];
    expect(row?.workflowBlocked).toBe("Fully");
    expect(row?.priority).toBe("High");
    const res = await releaseBlocked(w.db, auth, actor(), [order.id]);
    expect(res.succeeded).toEqual([order.id]);
    expect((await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, order.id)).limit(1))[0]?.workflowBlocked).toBe("None");
  });

  it("tests against an order and rolls everything back", async () => {
    const order = await createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }], { customerName: "PO Test", shipAddress: "PO Box 12" }));
    const res = await testWorkflow(w.db, auth, actor(), wf({ conditions: [{ field: "shipAddress", comparator: "contains", value: "PO Box" }] }), order.id);
    expect(res.matched).toBe(true);
    expect(res.blockType).toBe("Fully");
    expect(res.changes.map((c) => c.field)).toContain("Priority");
    expect((await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, order.id)).limit(1))[0]?.priority).toBe("None");
  });
});

describe("rate shopping presets", () => {
  it("creates a preset limited to client services and deletes it", async () => {
    const p = await createPreset(w.db, auth, actor(), presetSaveSchema.parse({ name: "Cheapest", description: "Lowest", warehouseId: w.warehouseId, clientId: w.clientId, isActive: true, method: "Cheapest", showErrors: false, useAllServices: false, serviceIds: [w.serviceIds.ground] }));
    expect(p.services.filter((s) => s.selected).map((s) => s.id)).toEqual([w.serviceIds.ground]);
    expect((await deletePresets(w.db, auth, actor(), [p.id])).succeeded).toEqual([p.id]);
  });
});

describe("channel runtime (sandbox store)", () => {
  async function sandboxConnection() {
    const settings = channelSettingsSchema.parse({ paymentStatuses: ["paid", "pending"], orders: { download: true }, products: { download: true } });
    const c = (await w.db.insert(schema.channelConnections).values({ provider: "shopify", storeName: "KS-TEST Sandbox", clientId: w.clientId, distribution: "API", status: "Completed", settings }).returning())[0];
    await w.db.insert(schema.channelLocationMappings).values({ connectionId: c.id, channelLocationId: "sbx-loc-main", channelLocationName: "Main", warehouseId: w.warehouseId });
    const orders = (await w.db.insert(schema.channelMethods).values({ connectionId: c.id, method: "Download Orders", status: "Active", intervalMinutes: 15 }).returning())[0];
    const products = (await w.db.insert(schema.channelMethods).values({ connectionId: c.id, method: "Download Products", status: "Active", intervalMinutes: 1440 }).returning())[0];
    return { c, orders, products };
  }

  it("downloads orders, records missing SKUs and retries them", async () => {
    const { c, orders } = await sandboxConnection();
    await w.db.insert(schema.channelRuns).values([1, 2].map(() => ({ methodId: orders.id, connectionId: c.id, method: "Download Orders", status: "No Data" as const, startedAt: new Date().toISOString() })));
    // Run 3 without Simulate error: the scheduled sandbox never fails on purpose (critic R4).
    const clean = await runChannelMethod(w.db, orders.id, { manual: true });
    expect(clean.error).toBe(0);
    const run = await runChannelMethod(w.db, orders.id, { manual: true, simulateError: true });
    expect(run.success).toBeGreaterThan(0);
    expect(run.error).toBe(1);
    const created = await w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.channelConnectionId, c.id));
    expect(created.length).toBe(clean.success + run.success);
    expect(created.every((o) => o.storeName === "KS-TEST Sandbox")).toBe(true);
    const missing = await w.db.select().from(schema.channelMissingOrders).where(eq(schema.channelMissingOrders.connectionId, c.id));
    // Stored with the product's brand spelling, so API, export and webhooks never say "KitStaks".
    expect(missing[0]?.lastErrorCode).toBe("One or more SKUs in the order were not found in KitStak");
    expect(JSON.parse(missing[0]?.payload ?? "{}").simulated).toBe(true);
    const again = await runChannelMethod(w.db, orders.id, { manual: true });
    expect(again.status).not.toBe("Failed");

    const sku = /SKU not found: (\S+)/.exec((await w.db.select().from(schema.channelRunItems)).find((i) => !i.success)?.errorMessage ?? "")?.[1] ?? "";
    await w.db.insert(schema.products).values({ clientId: w.clientId, sku, barcode: sku, name: sku, category: "General", weightOz: 8, lengthIn: 4, widthIn: 4, heightIn: 2, price: 10, status: "Active" });
    const retry = await retryMissingOrders(w.db, [missing[0]?.id ?? ""]);
    expect(retry.succeeded).toHaveLength(1);
  });

  it("downloads products into listings and flags none as exceptions", async () => {
    const { products } = await sandboxConnection();
    const run = await runChannelMethod(w.db, products.id, { manual: true });
    expect(run.status).toBe("Successful");
    expect((await w.db.select().from(schema.productListings)).length).toBe(run.success);
    expect(await listingExceptionRows(w.db, auth)).toHaveLength(0);
  });
});
