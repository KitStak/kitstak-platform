/**
 * Round 4 (critic R4): job / task Assign eligibility (server-side 400, 3-character search),
 * all-cancelled orders released from a live job, AI wave message wording, interval bounds and
 * warehouse-time formatting.
 */
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jobTypeSettingsSchema } from "@/lib/domain-types";
import { waveRuleInputSchema } from "@/lib/grid-defs/jobs/forms";
import { formatInZone, MIN_REPEAT_MINUTES, timesForPeriod } from "@/lib/grid-defs/jobs/schedule";
import type { AuthContext } from "@/server/auth/context";
import * as schema from "@/server/db/schema";
import { ledger } from "@/server/domain/ledger";
import { createOrder } from "@/server/domain/orders";
import { assignJobs } from "@/server/repositories/jobs-commands";
import { getJobDetail } from "@/server/repositories/jobs";
import { assignTasks } from "@/server/repositories/tasks";
import { createWaveRule } from "@/server/repositories/wave-rules";
import { assertEligibleAssignee, searchAssignees } from "@/server/repositories/wave-rules-options";
import { aiWaveMessage, runWave } from "@/server/repositories/waves-run";
import { isBusyError, withBusyRetry } from "@/server/repositories/jobs-read-retry";
import { createWorld, orderInput, type World } from "../foundation/domain/fixtures";

let w: World;
let auth: AuthContext;
let clerk: string;
let viewer: string;
let client: string;
let multiType: string;

beforeEach(() => {
  w = createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId, name: "Admin" }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
  const exec = w.db.insert(schema.roles).values({ key: "clerk", name: "Clerk", category: "Operation" }).returning().get().id;
  const view = w.db.insert(schema.roles).values({ key: "finance", name: "Finance viewer", category: "Operation" }).returning().get().id;
  const clientRole = w.db.insert(schema.roles).values({ key: "client", name: "Client", category: "Client" }).returning().get().id;
  w.db.insert(schema.rolePermissions).values([
    { roleId: exec, permission: "fulfillment.task_details.execute_task" },
    { roleId: clientRole, permission: "fulfillment.task_details.execute_task" },
  ]).run();
  const user = (email: string, name: string, roleId: string, extra: Partial<typeof schema.users.$inferInsert> = {}) => {
    const id = w.db.insert(schema.users).values({ email, name, passwordHash: "x", role: "operator", ...extra }).returning().get().id;
    w.db.insert(schema.userRoles).values({ userId: id, roleId }).run();
    w.db.insert(schema.userWarehouses).values({ userId: id, warehouseId: w.warehouseId }).run();
    return id;
  };
  clerk = user("thao@x.io", "Thao Nguyen", exec);
  viewer = user("grace@x.io", "Grace Whitmore", view, { role: "viewer" });
  client = user("dana@apex.io", "Dana Whitfield", clientRole, { userType: "Client" });
  multiType = w.db.insert(schema.jobTypes).values({
    code: "Multi Item Orders", description: "Multi", warehouseId: w.warehouseId, operationType: "Picking", settings: jobTypeSettingsSchema.parse({ orderScope: "All Orders" }),
  }).returning().get().id;
});
afterEach(() => w.close());

function waveJob(orders = 2): { jobId: string; orderIds: string[] } {
  ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: w.loc.storageA, qty: 50 });
  const orderIds = Array.from({ length: orders }, () => createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }])).id);
  const rule = createWaveRule(w.db, auth, w.ctx, waveRuleInputSchema.parse({ name: "KS-ASSIGN", warehouseId: w.warehouseId, operationType: "Picking", jobTypeIds: [multiType] }));
  runWave(w.db, w.ctx, rule.id, { runBy: "Admin" });
  const job = w.db.select().from(schema.jobs).all()[0];
  if (!job) throw new Error("no job");
  return { jobId: job.id, orderIds };
}

describe("assign eligibility", () => {
  it("rejects viewer and client-portal users with a validation error, accepts warehouse operators", () => {
    const { jobId } = waveJob(1);
    expect(() => assignJobs(w.db, w.ctx, [jobId], viewer)).toThrow(/Grace Whitmore can't be assigned/);
    expect(() => assignJobs(w.db, w.ctx, [jobId], client)).toThrow(/can't be assigned/);
    try {
      assertEligibleAssignee(w.db, client, [w.warehouseId]);
    } catch (e) {
      expect((e as { code?: string }).code).toBe("VALIDATION");
    }
    const ok = assignJobs(w.db, w.ctx, [jobId], clerk);
    expect(ok.failed).toEqual([]);
    expect(w.db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).get()?.assignedToUserId).toBe(clerk);
  });

  it("applies the same rule to task assign", () => {
    const { jobId } = waveJob(1);
    const task = w.db.select().from(schema.tasks).where(eq(schema.tasks.jobId, jobId)).all()[0];
    if (!task) throw new Error("no task");
    expect(() => assignTasks(w.db, w.ctx, { ids: [task.id], userId: viewer })).toThrow(/can't be assigned/);
    expect(assignTasks(w.db, w.ctx, { ids: [task.id], userId: clerk }).succeeded).toEqual([task.id]);
  });

  it("searches eligible users only, from 3 characters", () => {
    expect(searchAssignees(w.db, w.warehouseId, "th")).toEqual([]);
    expect(searchAssignees(w.db, w.warehouseId, "tha").map((u) => u.label)).toEqual(["Thao Nguyen"]);
    expect(searchAssignees(w.db, w.warehouseId, "gra")).toEqual([]);
    expect(searchAssignees(w.db, w.warehouseId, "apex")).toEqual([]);
  });
});

describe("job detail released orders", () => {
  it("marks an order whose job tasks are all cancelled as released and drops it from the live count", () => {
    const { jobId, orderIds } = waveJob(2);
    const [gone, kept] = orderIds as [string, string];
    w.db.update(schema.tasks).set({ status: "Cancelled" }).where(and(eq(schema.tasks.jobId, jobId), eq(schema.tasks.orderId, gone))).run();
    const d = getJobDetail(w.db, auth, jobId);
    expect(d.orders.find((o) => o.id === gone)?.released).toBe(true);
    expect(d.orders.find((o) => o.id === kept)?.released).toBe(false);
    expect(d.job.orderCount).toBe(1);
    expect(d.history.releasedOrderCount).toBe(1);
  });
});

describe("AI wave message", () => {
  it("never shows an arrow when the rounded walk is unchanged", () => {
    expect(aiWaveMessage(6, 133.2, 132.9, 0.2)).toBe("AI optimized 6 jobs: routes were already the shortest walk (133 m)");
    expect(aiWaveMessage(2, 200, 150, 25)).toBe("AI optimized 2 jobs: walk 200 m → 150 m (−25%)");
    expect(aiWaveMessage(0, 0, 0, 0)).toMatch(/no allocated orders/);
  });
});

describe("schedule helpers", () => {
  it("has a 5-minute interval floor and labels warehouse time", () => {
    expect(MIN_REPEAT_MINUTES).toBe(5);
    expect(timesForPeriod(5, "14:00", "22:00")).toHaveLength(97);
    expect(formatInZone("2026-11-10T19:00:00.000Z", "America/New_York")).toBe("11/10/2026 2:00 PM EST");
  });

  it("retries busy reads and rethrows other errors", async () => {
    let n = 0;
    const out = await withBusyRetry(() => {
      n += 1;
      if (n < 3) throw Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
      return "ok";
    });
    expect(out).toBe("ok");
    expect(isBusyError(new Error("x"))).toBe(false);
    await expect(withBusyRetry(() => { throw new Error("boom"); })).rejects.toThrow("boom");
  });
});
