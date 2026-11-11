/**
 * M08 blind-judge repair round 1: the Kit step "no components" error is load-aware, Create Kit
 * confirms one scan per source location, a picking job without Picking tasks can't build kits
 * (and the history repair writes the missing tasks), and quantity messages pluralise.
 */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { EMPTY_FORM, NO_COMPONENTS_PREFIX, validateForm, type WoForm } from "@/components/work-orders/wizard/wo-form";
import { groupOfScan, sourceScanGroups } from "@/lib/grid-defs/work-orders/kit-steps";
import { createKitReason } from "@/lib/grid-defs/work-orders/work-order-model";
import { DomainError } from "@/server/domain/errors";
import { createWorkOrder } from "@/server/repositories/work-orders";
import { allocateWorkOrder, createKit, repairMissingPickTasks, repairWorkOrderHistory } from "@/server/repositories/work-orders-commands";
import { createKitWorld, stock, woInput, type KitWorld } from "./kit-world";

describe("wizard Kit step: no stale 'no components' error", () => {
  const form: WoForm = { ...EMPTY_FORM, warehouseId: "wh", clientId: "cl", code: "WO1", type: "Work Order with Picking", kitProductId: "k", kitSku: "K-1" };
  it("does not flag an empty component list while the kit is still loading", () => {
    const res = validateForm(form, [], { componentsLoaded: false });
    expect(res.ok ? {} : res.errors).not.toHaveProperty("kitProductId");
  });
  it("still flags a loaded kit that really has no components", () => {
    const res = validateForm(form, []);
    expect(res.ok ? "" : res.errors.kitProductId).toMatch(new RegExp(`^${NO_COMPONENTS_PREFIX}`));
  });
  it("is valid once the components are known", () => {
    expect(validateForm(form, [{ productId: "c1", sku: "C-1" }]).ok).toBe(true);
  });
});

describe("Create Kit: one scan per source location", () => {
  const comps = [
    { id: "a", locationCode: "A-01-01", lpNumber: null },
    { id: "b", locationCode: "b-02-01", lpNumber: "LP0001" },
    { id: "c", locationCode: "A-01-01", lpNumber: null },
    { id: "d", locationCode: null, lpNumber: null },
  ];
  it("groups components by source location; FEFO components need no scan", () => {
    const g = sourceScanGroups(comps, false, "KIT-01");
    expect(g.map((x) => x.label)).toEqual(["A-01-01", "B-02-01"]);
    expect(g[0]?.componentIds).toEqual(["a", "c"]);
    expect(g[1]?.codes).toEqual(["B-02-01", "LP0001"]);
  });
  it("an LP scan confirms its location's group; unknown codes match nothing", () => {
    const g = sourceScanGroups(comps, false, null);
    expect(groupOfScan(g, " lp0001 ")?.label).toBe("B-02-01");
    expect(groupOfScan(g, "Z-99")).toBeNull();
  });
  it("with picking, the kitting area is the one source for every component", () => {
    const g = sourceScanGroups(comps, true, "KIT-01");
    expect(g).toHaveLength(1);
    expect(g[0]?.componentIds).toEqual(["a", "b", "c", "d"]);
  });
});

describe("createKitReason: a picking job without Picking tasks", () => {
  const row = { status: "In Process", type: "Work Order with Picking", requestedQty: 15, processedQty: 0 } as const;
  it("blocks Create Kit when nothing is picked and no picking task exists", () => {
    expect(createKitReason({ ...row, pickTaskCount: 0, pickDoneCount: 0, inKittingAreaQty: 0 } as never, { canForcePicks: true })).toMatch(/no picking tasks exist/);
  });
  it("keeps the old behaviour when the task count is unknown (list rows)", () => {
    expect(createKitReason(row as never, { canForcePicks: true })).toBeNull();
  });
});

let w: KitWorld;
beforeEach(async () => {
  w = await createKitWorld();
  await stock(w, w.productId, 30);
  await stock(w, w.product2Id, 12, w.loc.storageB);
});
afterEach(() => w.close());

/** A seeded-style with-picking work order: allocated, job with only the Kitting task. */
async function seededInProcess() {
  const wo = await createWorkOrder(w.db, w.wctx, woInput(w, { type: "Work Order with Picking", requestedQty: 3, code: "KS-SEED-1", components: [{ componentProductId: w.productId }, { componentProductId: w.product2Id }] }));
  expect((await allocateWorkOrder(w.db, w.wctx, wo.id)).status).toBe("In Process");
  await w.db.update(schema.inventoryAllocations).set({ taskId: null }).where(eq(schema.inventoryAllocations.workOrderId, wo.id));
  await w.db.delete(schema.tasks).where(and(eq(schema.tasks.workOrderId, wo.id), eq(schema.tasks.taskType, "Picking")));
  return wo;
}
const picksOf = async (id: string) => await w.db.select().from(schema.tasks).where(and(eq(schema.tasks.workOrderId, id), eq(schema.tasks.taskType, "Picking")));

describe("with-picking work order whose job holds no Picking tasks", () => {
  it("refuses Create Kit (nothing reached the kitting area), even with completePendingPicks", async () => {
    const wo = await seededInProcess();
    const fresh = (await w.db.select().from(schema.workOrders).where(eq(schema.workOrders.id, wo.id)).limit(1))[0];
    let err: unknown;
    try {
      await createKit(w.db, w.wctx, { workOrderId: wo.id, version: fresh?.version, qty: 1, locationId: w.kittingLocId, lpId: null, lotNumber: null, expiryDate: null, productionDate: null, completePendingPicks: true });
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe("INVALID_STATE");
    expect((err as Error).message).toMatch(/no picking tasks/);
  });

  it("the history repair writes one Picking task per allocation, linked, Kitting last, idempotently", async () => {
    const wo = await seededInProcess();
    expect((await repairWorkOrderHistory(w.db, w.wctx)).pickTasks).toEqual(["KS-SEED-1"]);
    const picks = await picksOf(wo.id);
    expect(picks).toHaveLength(2);
    expect(picks.every((t) => t.status === "Pending" && t.targetLocationId && t.sourceLocationId && t.allocationId)).toBe(true);
    const allocs = await w.db.select().from(schema.inventoryAllocations).where(eq(schema.inventoryAllocations.workOrderId, wo.id));
    expect(allocs.every((a) => a.taskId && picks.some((t) => t.id === a.taskId))).toBe(true);
    const kitting = (await w.db.select().from(schema.tasks).where(and(eq(schema.tasks.workOrderId, wo.id), eq(schema.tasks.taskType, "Kitting"))).limit(1))[0];
    expect(kitting?.sequence).toBeGreaterThan(Math.max(...picks.map((t) => t.sequence ?? 0)));
    const job = (await w.db.select().from(schema.jobs).where(eq(schema.jobs.workOrderId, wo.id)).limit(1))[0];
    expect(job?.taskCount).toBe(3);
    expect(await repairMissingPickTasks(w.db, w.wctx)).toEqual([]);
    // After the repair the ordinary gate applies: open picks block a plain build.
    const fresh = (await w.db.select().from(schema.workOrders).where(eq(schema.workOrders.id, wo.id)).limit(1))[0];
    await expect(async () => await createKit(w.db, w.wctx, { workOrderId: wo.id, version: fresh?.version, qty: 1, locationId: w.kittingLocId, lpId: null, lotNumber: null, expiryDate: null, productionDate: null })).rejects.toThrow(/not yet picked/);
  });
});

describe("server source scan: several sources", () => {
  it("accepts one scan per source location, comma-separated, and rejects an unknown one", async () => {
    const wo = await createWorkOrder(w.db, w.wctx, woInput(w, { code: "KS-MULTI-1", requestedQty: 1, components: [
      { componentProductId: w.productId, locationId: w.loc.storageA }, { componentProductId: w.product2Id, locationId: w.loc.storageB },
    ] }));
    const base = { workOrderId: wo.id, qty: 1, locationId: w.kittingLocId, lpId: null, lotNumber: null, expiryDate: null, productionDate: null };
    await expect(async () => await createKit(w.db, w.wctx, { ...base, sourceScan: "A-01-01, Z-99" })).rejects.toThrow(/Z-99 is not a source/);
    const locA = (await w.db.select().from(schema.locations).where(eq(schema.locations.id, w.loc.storageA)).limit(1))[0]?.code ?? "";
    const locB = (await w.db.select().from(schema.locations).where(eq(schema.locations.id, w.loc.storageB)).limit(1))[0]?.code ?? "";
    expect((await createKit(w.db, w.wctx, { ...base, sourceScan: `${locA}, ${locB}` })).processedQty).toBe(1);
  });
});
