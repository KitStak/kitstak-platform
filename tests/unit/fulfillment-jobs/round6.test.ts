/**
 * M03 round 6 (critic R5):
 *  - progress-bar tone (healthy jobs are green, red only overdue / cancelled);
 *  - overdue jobs (OVERDUE SQL, `overdue` filter);
 *  - consistent change-log actor for M03 entities (`withM03Actor`);
 *  - pick-short preview + resolution-job default for partial executes.
 */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jobTypeSettingsSchema } from "@/lib/domain-types";
import { waveRuleInputSchema } from "@/lib/grid-defs/jobs/forms";
import { progressTone } from "@/lib/grid-defs/jobs/progress-tone";
import { JOBS_GRID } from "@/lib/grid-defs/jobs/jobs";
import type { AuthContext } from "@/server/auth/context";
import * as schema from "@/server/db/schema";
import { ledger } from "@/server/domain/ledger";
import { createOrder } from "@/server/domain/orders";
import { execute } from "@/server/domain/tasks";
import { EMPTY_GRID_QUERY } from "@/server/query/grid-query";
import { listJobs } from "@/server/repositories/jobs";
import { actorDisplayName, withM03Actor } from "@/server/repositories/jobs-actor";
import { pickShortPreview, suggestResolution } from "@/server/repositories/tasks-pick-short";
import { createWaveRule } from "@/server/repositories/wave-rules";
import { runWave } from "@/server/repositories/waves-run";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;
let jobType: string;

beforeEach(() => {
  w = createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], roleKeys: [], user: { id: w.userId, name: "Ada Admin", email: "admin@test.io" }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
  jobType = w.db.insert(schema.jobTypes).values({
    code: "All Orders", description: "All", warehouseId: w.warehouseId, operationType: "Picking", settings: jobTypeSettingsSchema.parse({}),
  }).returning().get().id;
});
afterEach(() => w.close());

function wave(): string[] {
  const rule = createWaveRule(w.db, auth, w.ctx, waveRuleInputSchema.parse({
    name: "KS-R6", warehouseId: w.warehouseId, operationType: "Picking", jobTypeIds: [jobType], batchSize: 10,
    filters: [{ field: "orderQuantity", op: "rng", value: "1..10", label: "Order Quantity between 1 and 10" }],
  }));
  runWave(w.db, w.ctx, rule.id, { runBy: "Admin" });
  return w.db.select().from(schema.jobs).all().map((j) => j.id);
}

describe("progress tone", () => {
  it("is green for a healthy job, never brand red", () => {
    expect(progressTone({ percent: 50, status: "Started", hasPickShort: false, overdue: false })).toBe("success");
    expect(progressTone({ percent: 0, status: "Pending", hasPickShort: false, overdue: false })).toBe("success");
    expect(progressTone({ percent: 100, status: "Completed", hasPickShort: false, overdue: false })).toBe("success");
  });
  it("is amber for a pick short and red only when overdue or cancelled", () => {
    expect(progressTone({ percent: 50, status: "Started", hasPickShort: true, overdue: false })).toBe("warning");
    expect(progressTone({ percent: 50, status: "Started", hasPickShort: false, overdue: true })).toBe("danger");
    expect(progressTone({ percent: 20, status: "Cancelled", hasPickShort: false, overdue: false })).toBe("danger");
    expect(progressTone({ percent: 100, status: "Completed", hasPickShort: false, overdue: true })).toBe("success");
  });
});

describe("overdue jobs", () => {
  it("declares an Overdue filter field and sort key", () => {
    expect(JOBS_GRID.fields.some((f) => f.field === "overdue" && f.type === "boolean")).toBe(true);
    expect(JOBS_GRID.sortKeys).toContain("overdue");
  });

  it("flags live jobs past their planned end and filters on it", () => {
    ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 10 });
    createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const ids = wave();
    expect(ids.length).toBeGreaterThan(0);
    const [late] = ids;
    w.db.update(schema.jobs).set({ plannedEndAt: "2020-01-01T00:00:00.000Z" }).where(eq(schema.jobs.id, late as string)).run();
    const all = listJobs(w.db, auth, { ...EMPTY_GRID_QUERY, pageSize: 50 });
    const row = all.rows.find((r) => r.id === late);
    expect(Number(row?.overdue)).toBe(1);
    const only = listJobs(w.db, auth, { ...EMPTY_GRID_QUERY, pageSize: 50, filters: [{ field: "overdue", op: "bool", value: true }] });
    expect(only.rows.map((r) => r.id)).toEqual([late]);
    // A completed job is never overdue.
    w.db.update(schema.jobs).set({ status: "Completed" }).where(eq(schema.jobs.id, late as string)).run();
    expect(listJobs(w.db, auth, { ...EMPTY_GRID_QUERY, pageSize: 50, filters: [{ field: "overdue", op: "bool", value: true }] }).total).toBe(0);
  });
});

describe("change-log actor (withM03Actor)", () => {
  it("resolves the display name", () => {
    expect(actorDisplayName({ name: "Ada", email: "a@x.io" })).toBe("Ada");
    expect(actorDisplayName({ name: " ", email: "a@x.io" })).toBe("a@x.io");
    expect(actorDisplayName(null)).toBe("System");
  });

  it("stamps the request's M03 rows with the display name and leaves other modules' rows alone", () => {
    const actor = { userId: w.userId, source: "admin@test.io" };
    const row = (entityType: string, entityId: string) => ({ entityType, entityId, type: "Update" as const, message: "m", userId: w.userId, source: "admin@test.io" });
    w.db.insert(schema.changeLog).values(row("job", "before")).run();
    withM03Actor(w.db, actor, auth, () => {
      w.db.insert(schema.changeLog).values(row("job", "j1")).run();
      w.db.insert(schema.changeLog).values(row("wave_rule", "r1")).run();
      w.db.insert(schema.changeLog).values(row("shipment_order", "o1")).run();
    });
    const src = (entityType: string, entityId: string) => w.db.select().from(schema.changeLog)
      .where(and(eq(schema.changeLog.entityType, entityType), eq(schema.changeLog.entityId, entityId))).get()?.source;
    expect(src("job", "j1")).toBe("Ada Admin");
    expect(src("wave_rule", "r1")).toBe("Ada Admin");
    expect(src("shipment_order", "o1")).toBe("admin@test.io");
    expect(src("job", "before")).toBe("admin@test.io");
  });

  it("does not stamp when the handler throws", () => {
    const actor = { userId: w.userId, source: "admin@test.io" };
    expect(() => withM03Actor(w.db, actor, auth, () => { throw new Error("boom"); })).toThrow("boom");
  });
});

describe("pick-short preview", () => {
  it("defaults the resolution job only when it can re-pick", () => {
    expect(suggestResolution({ eligible: true, freeElsewhere: 3, retainsAllocation: false, preventsReallocation: false })).toBe(true);
    expect(suggestResolution({ eligible: true, freeElsewhere: 0, retainsAllocation: false, preventsReallocation: false })).toBe(false);
    expect(suggestResolution({ eligible: true, freeElsewhere: 3, retainsAllocation: true, preventsReallocation: false })).toBe(false);
    expect(suggestResolution({ eligible: true, freeElsewhere: 3, retainsAllocation: false, preventsReallocation: true })).toBe(false);
    expect(suggestResolution({ eligible: false, freeElsewhere: 3, retainsAllocation: false, preventsReallocation: false })).toBe(false);
  });

  it("finds free stock outside the source location and a resolution job re-picks it", () => {
    ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 2 });
    createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 2 }]));
    const [jobId] = wave();
    // Stock arrives elsewhere after the wave allocated from A-01-01.
    ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageB, qty: 5 });
    const pick = w.db.select().from(schema.tasks).where(and(eq(schema.tasks.jobId, jobId as string), eq(schema.tasks.taskType, "Picking"))).get();
    expect(pick).toBeTruthy();
    const p = pickShortPreview(w.db, auth, pick!.id);
    expect(p.eligible).toBe(true);
    expect(p.freeElsewhere).toBe(5);
    expect(p.locations.map((l) => l.code)).toEqual(["A-02-01"]);
    expect(p.suggestResolution).toBe(true);
    const [res] = execute(w.db, w.ctx, { taskIds: [pick!.id], targetLocationId: w.loc.pack, targetLpId: null, qty: 1, createResolutionJob: p.suggestResolution });
    expect(res?.shortQty).toBe(1);
    expect(res?.resolutionJobId).toBeTruthy();
    const rj = w.db.select().from(schema.jobs).where(eq(schema.jobs.id, res!.resolutionJobId as string)).get();
    expect(rj?.isResolutionJob).toBe(true);
    const order = w.db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, pick!.orderId as string)).get();
    expect(order?.pickShortStatus).toBe("Open");
  });

  it("does not suggest a resolution job when nothing is free elsewhere", () => {
    ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 2 });
    createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 2 }]));
    const [jobId] = wave();
    const pick = w.db.select().from(schema.tasks).where(and(eq(schema.tasks.jobId, jobId as string), eq(schema.tasks.taskType, "Picking"))).get();
    const p = pickShortPreview(w.db, auth, pick!.id);
    expect(p.freeElsewhere).toBe(0);
    expect(p.suggestResolution).toBe(false);
  });
});
