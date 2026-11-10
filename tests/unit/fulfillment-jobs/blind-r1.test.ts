/**
 * M03 blind-judge repair round 1:
 *  - wave-rule names are unique per warehouse; change log and drawer use display values
 *    ("orderDate" → "Shipment order date");
 *  - Dynamic Replenishment: pack-type conversion (Case → Each) and LP swap, pick → put phases;
 *  - Task Details: a task without its own client shows its order's client; location count
 *    tasks list one row per location/SKU line with that line's client;
 *  - copy helpers (wave job-type help, execute target hint).
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jobTypeSettingsSchema } from "@/lib/domain-types";
import { canonicalOrderByField, waveOrderByLabel } from "@/lib/grid-defs/jobs/conditions";
import { waveRuleInputSchema } from "@/lib/grid-defs/jobs/forms";
import type { AuthContext } from "@/server/auth/context";
import * as schema from "@/server/db/schema";
import { ledger } from "@/server/domain/ledger";
import { createReplenishmentJob } from "@/server/domain/task-handlers/replenishment";
import { execute } from "@/server/domain/tasks";
import { EMPTY_GRID_QUERY } from "@/server/query/grid-query";
import { listTasks } from "@/server/repositories/tasks";
import { createWaveRule, updateWaveRule } from "@/server/repositories/wave-rules";
import { jobTypesCopy, targetHint } from "@/lib/grid-defs/jobs/copy";
import { createOrder } from "@/server/domain/orders";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;

beforeEach(() => {
  w = createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], roleKeys: [], user: { id: w.userId, name: "Ada Admin", email: "admin@test.io" }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
});
afterEach(() => w.close());

const ruleInput = (name: string, extra: Record<string, unknown> = {}) => waveRuleInputSchema.parse({
  name, warehouseId: w.warehouseId, operationType: "Picking", jobTypeIds: [w.jobTypeId], ...extra,
});

describe("wave rules", () => {
  it("rejects a duplicate name in the same warehouse (case and spaces ignored)", () => {
    createWaveRule(w.db, auth, w.ctx, ruleInput("D2C Daily Waves"));
    expect(() => createWaveRule(w.db, auth, w.ctx, ruleInput("  d2c daily waves "))).toThrow(/already exists in this warehouse/);
    const other = createWaveRule(w.db, auth, w.ctx, ruleInput("Rush"));
    expect(() => updateWaveRule(w.db, auth, w.ctx, other.id, { ...ruleInput("D2C DAILY WAVES"), version: other.version })).toThrow(/already exists/);
    // Saving a rule under its own name is fine.
    expect(updateWaveRule(w.db, auth, w.ctx, other.id, { ...ruleInput("Rush"), priority: "High", version: other.version }).priority).toBe("High");
  });

  it("labels order-by keys, including legacy ones, and logs edits in display values", () => {
    expect(waveOrderByLabel("orderDate")).toBe("Shipment order date");
    expect(canonicalOrderByField("orderDate")).toBe("shipmentOrderDate");
    expect(waveOrderByLabel("priority")).toBe("Priority");
    const rule = createWaveRule(w.db, auth, w.ctx, ruleInput("Labels", { orderBy: [{ field: "priority", dir: "desc" }] }));
    updateWaveRule(w.db, auth, w.ctx, rule.id, { ...ruleInput("Labels", { orderBy: [{ field: "orderDate", dir: "asc" }] }), version: rule.version });
    const rows = w.db.select().from(schema.changeLog).where(eq(schema.changeLog.entityId, rule.id)).all();
    const orderBy = rows.find((r) => r.field === "orderBy");
    expect(orderBy?.message).toBe("Order By is modified. Priority (descending) --> Shipment order date (ascending)");
    expect(rows.some((r) => /orderDate|[0-9a-f]{8}-[0-9a-f]{4}/.test(r.message ?? ""))).toBe(false);
  });
});

describe("dynamic replenishment", () => {
  function replenType(settings: Record<string, unknown>): string {
    return w.db.insert(schema.jobTypes).values({
      code: "Dynamic Replenishment", description: "Dyn", warehouseId: w.warehouseId, operationType: "Replenishment",
      settings: jobTypeSettingsSchema.parse({ replenishment: { type: "Dynamic", flow: "Pick & Put", ...settings } }),
    }).returning().get().id;
  }
  function levels(max: number) {
    w.db.insert(schema.productReplenishmentLevels).values({ productId: w.productId, warehouseId: w.warehouseId, minLevel: 5, maxLevel: max }).run();
  }
  const tasksOf = (jobId: string) => w.db.select().from(schema.tasks).where(eq(schema.tasks.jobId, jobId)).all().sort((a, b) => a.taskNo - b.taskNo);

  it("picks full cases, puts eaches (pack-type conversion), and keeps the ledger whole", () => {
    w.db.insert(schema.productPackTypes).values({ productId: w.productId, packType: "Case", kind: "Hierarchical", uomQty: 12 }).run();
    ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 100, packType: "Each" });
    ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageB, qty: 2, packType: "Each" });
    levels(30); // need = 30 - 2 = 28 → 2 cases (24) + 4 eaches
    const res = createReplenishmentJob(w.db, w.ctx, { warehouseId: w.warehouseId, jobTypeId: replenType({ allowHigherPackTypeConversion: true }) });
    const [cases, eaches] = tasksOf(res.jobId as string);
    expect(cases).toMatchObject({ packType: "Case", toPackType: "Each", plannedQty: 2, packTypeConversionApplied: true, replenishmentPhase: "Replenishment Pick Phase" });
    expect(eaches).toMatchObject({ packType: "Each", plannedQty: 4, packTypeConversionApplied: false });

    execute(w.db, w.ctx, { taskIds: [cases.id], targetLocationId: w.loc.storageA === w.loc.pick ? w.loc.pack : w.loc.pick, targetLpId: null });
    const put = tasksOf(res.jobId as string).find((t) => t.replenishmentPhase === "Replenishment Put Phase");
    expect(put).toMatchObject({ packType: "Each", plannedQty: 24, packTypeConversionApplied: true, targetLocationId: w.loc.storageB });
    execute(w.db, w.ctx, { taskIds: [put!.id], targetLocationId: w.loc.storageB, targetLpId: null });
    const face = w.db.select().from(schema.inventory).where(eq(schema.inventory.locationId, w.loc.storageB)).all().reduce((s, r) => s + r.onHand, 0);
    expect(face).toBe(26);
    expect(ledger.reconcileLedger(w.db)).toEqual([]);
  });

  it("swaps a whole reserve LP into the pick face (LP swap)", () => {
    const type = w.db.insert(schema.lpTypes).values({ warehouseId: w.warehouseId, code: "PLT", numberPrefix: "LP", numberLength: 6 }).returning().get().id;
    const lp = w.db.insert(schema.licensePlates).values({ number: "LP000001", warehouseId: w.warehouseId, lpTypeId: type, locationId: w.loc.storageA }).returning().get().id;
    ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, lpId: lp, qty: 10, packType: "Each" });
    levels(20);
    const res = createReplenishmentJob(w.db, w.ctx, { warehouseId: w.warehouseId, jobTypeId: replenType({ enableLpSwap: true, flow: "Direct Put" }) });
    const [task] = tasksOf(res.jobId as string);
    expect(task).toMatchObject({ lpSwap: true, plannedQty: 10, sourceLpId: lp, replenishmentPhase: "Direct Put" });
    execute(w.db, w.ctx, { taskIds: [task.id], targetLocationId: w.loc.storageB, targetLpId: null });
    expect(w.db.select().from(schema.licensePlates).where(eq(schema.licensePlates.id, lp)).get()?.locationId).toBe(w.loc.storageB);
    expect(tasksOf(res.jobId as string)[0]).toMatchObject({ status: "Completed", lpSwap: true, targetLpId: lp });
    expect(ledger.reconcileLedger(w.db)).toEqual([]);
  });
});

describe("task grids", () => {
  function bareJob(operationType: "Count" | "Picking"): string {
    return w.db.insert(schema.jobs).values({
      id: crypto.randomUUID(), code: `Job${Math.floor(Math.random() * 1e6)}`, warehouseId: w.warehouseId, clientId: null, jobType: operationType,
      jobTypeId: w.jobTypeId, operationType, status: "Pending", priority: "None",
    }).returning().get().id;
  }

  it("lists a location count task as one row per SKU, each with its own client", () => {
    ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 7 });
    const beta = w.db.insert(schema.products).values({ clientId: w.otherClientId, sku: "BETA-01", barcode: "B1", name: "Beta", category: "General", weightOz: 1, lengthIn: 1, widthIn: 1, heightIn: 1, price: 1, status: "Active" }).returning().get().id;
    ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.otherClientId, productId: beta, locationId: w.loc.storageA, qty: 3 });
    w.db.insert(schema.tasks).values({ taskNo: 1, jobId: bareJob("Count"), warehouseId: w.warehouseId, taskType: "Count", status: "Pending", priority: "None", plannedQty: 10, sourceLocationId: w.loc.storageA }).run();
    const { rows, total } = listTasks(w.db, auth, "count", { ...EMPTY_GRID_QUERY, pageSize: 50 });
    expect(total).toBe(2);
    expect(rows.map((r) => [r.sku, r.client, r.initialPackQty, r.plannedQty]).sort()).toEqual([["BETA-01", "BETA Inc", 3, 3], ["MLT-WIDGET-01", "ACME Inc", 7, 7]]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
    expect(rows.every((r) => !String(r.client).includes(","))).toBe(true);
  });

  it("shows the order's client on a task of a multi-client job", () => {
    const beta = w.db.insert(schema.products).values({ clientId: w.otherClientId, sku: "BETA-02", barcode: "B2", name: "Beta", category: "General", weightOz: 1, lengthIn: 1, widthIn: 1, heightIn: 1, price: 1, status: "Active" }).returning().get().id;
    const order = createOrder(w.db, w.ctx, orderInput(w, [{ productId: beta, quantity: 1 }], { clientId: w.otherClientId })).id;
    w.db.insert(schema.tasks).values({ taskNo: 2, jobId: bareJob("Picking"), warehouseId: w.warehouseId, clientId: null, orderId: order, taskType: "Picking", status: "Pending", priority: "None", plannedQty: 1, productId: w.productId }).run();
    const { rows } = listTasks(w.db, auth, "order", { ...EMPTY_GRID_QUERY, pageSize: 50 });
    expect(rows[0]?.client).toBe("BETA Inc");
  });
});

describe("copy", () => {
  it("is specific to the wave operation and the task type", () => {
    expect(jobTypesCopy("Cycle Count")).toMatch(/count plan/);
    expect(jobTypesCopy("Replenishment")).toMatch(/pick faces/);
    expect(jobTypesCopy("Cycle Count")).not.toMatch(/Orders are matched/);
    expect(jobTypesCopy("Picking")).toMatch(/Orders are matched/);
    expect(targetHint(["Loading"])).toMatch(/loading dock/);
    expect(targetHint(["Loading"])).not.toMatch(/picked units/);
    expect(targetHint(["Picking"])).toMatch(/picked units/);
  });
});
