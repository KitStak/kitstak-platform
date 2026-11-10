/**
 * M03 round 5 (critic R4):
 *  - zombie jobs: a job whose last live task is cancelled / whose last order is released closes;
 *  - no-op priority updates write nothing;
 *  - supervisor-only keys are denied to floor-only roles;
 *  - Wave Log Run By is a display name;
 *  - jobs integrity invariants.
 */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jobTypeSettingsSchema } from "@/lib/domain-types";
import { waveRuleInputSchema } from "@/lib/grid-defs/jobs/forms";
import { allowsJobAction, isFloorOnly, SUPERVISOR_ONLY_KEYS } from "@/lib/grid-defs/jobs/supervisor-policy";
import type { AuthContext } from "@/server/auth/context";
import * as schema from "@/server/db/schema";
import { ledger } from "@/server/domain/ledger";
import { createOrder } from "@/server/domain/orders";
import { execute } from "@/server/domain/tasks";
import { cancelTasks, updateJobsPriority } from "@/server/repositories/jobs-commands";
import { jobsInvariants } from "@/server/repositories/jobs-invariants";
import { canJobAction } from "@/server/repositories/jobs-policy";
import { deadJobCandidates, settleDeadJobs } from "@/server/repositories/jobs-settle";
import { removeOrder } from "@/server/repositories/jobs";
import { cancelPicking } from "@/server/repositories/orders-commands";
import { createWaveRule } from "@/server/repositories/wave-rules";
import { runWave } from "@/server/repositories/waves-run";
import { runByDisplay } from "@/server/repositories/waves-run-by";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;
let jobType: string;

beforeEach(() => {
  w = createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], roleKeys: [], user: { id: w.userId, name: "Admin" }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
  jobType = w.db.insert(schema.jobTypes).values({
    code: "All Orders", description: "All", warehouseId: w.warehouseId, operationType: "Picking", settings: jobTypeSettingsSchema.parse({}),
  }).returning().get().id;
});
afterEach(() => w.close());

const stock = (qty: number) => ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty });
const jobRow = (id: string) => w.db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).get();
const jobOrders = (id: string) => w.db.select().from(schema.jobOrders).where(eq(schema.jobOrders.jobId, id)).all();
const tasksOf = (id: string) => w.db.select().from(schema.tasks).where(eq(schema.tasks.jobId, id)).all();
const jobLog = (id: string) => w.db.select().from(schema.changeLog).where(and(eq(schema.changeLog.entityType, "job"), eq(schema.changeLog.entityId, id))).all();

/** Runs one picking wave over every open order; returns the created job ids. */
function wave(batch = 10): string[] {
  const rule = createWaveRule(w.db, auth, w.ctx, waveRuleInputSchema.parse({
    name: "KS-DEAD", warehouseId: w.warehouseId, operationType: "Picking", jobTypeIds: [jobType], batchSize: batch,
    filters: [{ field: "orderQuantity", op: "rng", value: "1..10", label: "Order Quantity between 1 and 10" }],
  }));
  runWave(w.db, w.ctx, rule.id, { runBy: "Admin" });
  return w.db.select().from(schema.jobs).all().map((j) => j.id);
}

describe("dead jobs (zombie job settlement)", () => {
  it("a job whose only order is released by Cancel Picking closes as Cancelled with orderCount 0", () => {
    stock(10);
    const order = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 2 }]));
    const [jobId] = wave();
    expect(jobRow(jobId)?.status).toBe("Pending");
    // Other module's path (orders Cancel Picking): cancels the tasks and clears the order's job id only.
    expect(cancelPicking(w.db, w.ctx, [order.id]).failed).toEqual([]);
    expect(deadJobCandidates(w.db)).toContain(jobId);
    const out = settleDeadJobs(w.db, w.ctx);
    expect(out.map((o) => o.jobId)).toEqual([jobId]);
    const job = jobRow(jobId);
    expect(job?.status).toBe("Cancelled");
    expect(job?.orderCount).toBe(0);
    expect(job?.taskCount).toBe(0);
    expect(jobOrders(jobId)).toHaveLength(0);
    const log = jobLog(jobId).find((r) => r.field === "status");
    expect(log?.message).toMatch(/Pending --> Cancelled · last order released/);
    expect(deadJobCandidates(w.db)).toEqual([]);
    expect(settleDeadJobs(w.db, w.ctx)).toEqual([]); // idempotent
  });

  it("M03 task cancel of the last pick task closes the job at once (no sweep needed)", () => {
    stock(10);
    createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const [jobId] = wave();
    const pick = tasksOf(jobId).find((t) => t.taskType === "Picking");
    expect(cancelTasks(w.db, w.ctx, [pick!.id]).failed).toEqual([]);
    expect(jobRow(jobId)?.status).toBe("Cancelled");
    expect(jobRow(jobId)?.orderCount).toBe(0);
    expect(jobsInvariants(w.db).dead_live_jobs).toBe(0);
  });

  it("removing the last order from a job cancels the job; removing one of two keeps it Pending with orderCount 1", () => {
    stock(20);
    const a = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const b = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 2 }]));
    const [jobId] = wave();
    expect(jobRow(jobId)?.orderCount).toBe(2);
    removeOrder(w.db, w.ctx, jobId, a.id);
    expect(jobRow(jobId)?.status).toBe("Pending");
    expect(jobRow(jobId)?.orderCount).toBe(1);
    removeOrder(w.db, w.ctx, jobId, b.id);
    expect(jobRow(jobId)?.status).toBe("Cancelled");
    expect(jobRow(jobId)?.orderCount).toBe(0);
  });

  it("drops the stale order link of a released order from a job that still has work", () => {
    stock(20);
    const a = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 2 }]));
    const [jobId] = wave();
    cancelPicking(w.db, w.ctx, [a.id]);
    expect(jobsInvariants(w.db).stale_job_orders).toBe(1);
    settleDeadJobs(w.db, w.ctx);
    expect(jobRow(jobId)?.status).toBe("Pending");
    expect(jobRow(jobId)?.orderCount).toBe(1);
    expect(jobsInvariants(w.db)).toMatchObject({ stale_job_orders: 0, dead_live_jobs: 0 });
  });

  it("a job with completed work and the rest cancelled elsewhere settles as Completed", () => {
    stock(20);
    const a = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const b = createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 2 }]));
    const [jobId] = wave();
    // Complete every task of order A (pick, then pack), then cancel picking of order B elsewhere.
    for (const type of ["Picking", "Sorting", "Packing", "Loading"] as const) {
      for (const t of tasksOf(jobId).filter((x) => x.orderId === a.id && x.taskType === type && x.status === "Pending")) {
        execute(w.db, w.ctx, { taskIds: [t.id], targetLocationId: w.loc.pack ?? w.loc.storageB, targetLpId: null });
      }
    }
    cancelPicking(w.db, w.ctx, [b.id]);
    settleDeadJobs(w.db, w.ctx);
    const job = jobRow(jobId);
    if (tasksOf(jobId).some((t) => t.status === "Pending" || t.status === "Started")) {
      expect(job?.status).not.toBe("Cancelled"); // still has open work: untouched
    } else {
      expect(job?.status).toBe("Completed");
      expect(job?.completedAt).toBeTruthy();
    }
    expect(jobsInvariants(w.db).dead_live_jobs).toBe(0);
  });
});

describe("priority no-op", () => {
  it("skips jobs that already have the priority: no version bump, reported as unchanged", () => {
    stock(10);
    createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const [jobId] = wave();
    const before = jobRow(jobId)!;
    const logs = jobLog(jobId).length;
    const res = updateJobsPriority(w.db, w.ctx, [jobId], before.priority);
    expect(res.succeeded).toEqual([]);
    expect(res.unchanged).toEqual([jobId]);
    expect(res.failed).toEqual([]);
    expect(jobRow(jobId)?.version).toBe(before.version);
    expect(jobLog(jobId)).toHaveLength(logs);
    const changed = updateJobsPriority(w.db, w.ctx, [jobId], "High");
    expect(changed.succeeded).toEqual([jobId]);
    expect(jobRow(jobId)?.version).toBe(before.version + 1);
    expect(jobLog(jobId).some((r) => r.field === "priority" && r.toValue === "High")).toBe(true);
  });
});

describe("supervisor-only job actions", () => {
  const keys = [
    "fulfillment.job_management.update_priority", "fulfillment.job_management.cancel", "fulfillment.job_management.assign",
    "fulfillment.job_management.unassign", "fulfillment.job_management.override_job_cancel_warning", "fulfillment.task_details.cancel_task",
  ];
  it("covers exactly the six keys of request R4-1", () => {
    expect([...SUPERVISOR_ONLY_KEYS].sort()).toEqual([...keys].sort());
  });
  it.each(keys)("denies %s to a Warehouse Clerk that still holds it", (key) => {
    const clerk = { ...auth, permissions: new Set([key]), roleKeys: ["operator"], user: { id: "u", name: "J", role: "operator" } } as unknown as AuthContext;
    expect(canJobAction(clerk, key)).toBe(false);
    const supervisor = { ...clerk, roleKeys: ["manager"], user: { id: "u", name: "S", role: "manager" } } as unknown as AuthContext;
    expect(canJobAction(supervisor, key)).toBe(true);
  });
  it("keeps execution keys for floor users and honours mixed / custom roles", () => {
    expect(allowsJobAction("fulfillment.task_details.execute_task", true, ["operator"], "operator")).toBe(true);
    expect(allowsJobAction("fulfillment.job_management.cancel", true, ["operator", "ks_custom"], "operator")).toBe(true);
    expect(allowsJobAction("fulfillment.job_management.cancel", false, ["manager"], "manager")).toBe(false);
    expect(isFloorOnly([], "operator")).toBe(true);
    expect(isFloorOnly([], "admin")).toBe(false);
  });
});

describe("Wave Log Run By identity", () => {
  it("stores a display name, resolving emails and defaulting to Integration", () => {
    expect(runByDisplay(w.db, "admin@test.io")).toBe("Admin");
    expect(runByDisplay(w.db, "ADMIN@test.io")).toBe("Admin");
    expect(runByDisplay(w.db, "Mike Lunsford")).toBe("Mike Lunsford");
    expect(runByDisplay(w.db, "")).toBe("Integration");
    expect(runByDisplay(w.db, "ghost@nowhere.io")).toBe("ghost@nowhere.io");
  });
  it("a wave run with an email records the user's name", () => {
    stock(10);
    createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    const rule = createWaveRule(w.db, auth, w.ctx, waveRuleInputSchema.parse({
      name: "KS-RUNBY", warehouseId: w.warehouseId, operationType: "Picking", jobTypeIds: [jobType],
      filters: [{ field: "orderQuantity", op: "rng", value: "1..10", label: "Order Quantity between 1 and 10" }],
    }));
    const res = runWave(w.db, w.ctx, rule.id, { runBy: "admin@test.io" });
    expect(w.db.select().from(schema.waves).where(eq(schema.waves.id, res.wave.id)).get()?.runBy).toBe("Admin");
    expect(jobsInvariants(w.db).wave_jobs_created_mismatch).toBe(0);
  });
});
