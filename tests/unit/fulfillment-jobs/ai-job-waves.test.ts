/**
 * Round 3 (parity loop): AI Job waves end to end, the AI optimizer, SLA planned windows and
 * role-scoped assignees.
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { waveRuleInputSchema } from "@/lib/grid-defs/jobs/forms";
import { formatWaveCountdown } from "@/lib/grid-defs/jobs/schedule";
import type { AuthContext } from "@/server/auth/context";
import * as schema from "@/server/db/schema";
import { ledger } from "@/server/domain/ledger";
import { createOrder } from "@/server/domain/orders";
import { groupForAi, locationPoint, optimizeRoute, routeLength, type AiOrder, type PickLocation } from "@/server/repositories/jobs-ai-optimizer";
import { listJobs } from "@/server/repositories/jobs";
import { listTasks } from "@/server/repositories/tasks";
import { createWaveRule } from "@/server/repositories/wave-rules";
import { assignableForWarehouse } from "@/server/repositories/wave-rules-options";
import { assertRuleRunnable, completeAiWave, runWave } from "@/server/repositories/waves-run";
import { EMPTY_GRID_QUERY } from "@/server/query/grid-query";
import { createWorld, locationRow, orderInput, type World } from "../foundation/domain/fixtures";

const loc = (id: string, aisle: string, rack: string, bay: string, walk: number): PickLocation => ({ id, code: `${aisle}-${rack}-${bay}`, aisle, rack, bay, walkingPathPriority: walk });

describe("AI optimizer (pure)", () => {
  it("never returns a route longer than the walking-path baseline", () => {
    const stops = [loc("1", "A", "04", "05", 1), loc("2", "D", "01", "01", 2), loc("3", "A", "01", "01", 3), loc("4", "D", "04", "05", 4), loc("5", "B", "02", "03", 5)].map(locationPoint);
    const baseline = [0, 1, 2, 3, 4];
    const order = optimizeRoute(stops, baseline);
    expect([...order].sort()).toEqual(baseline);
    expect(routeLength(order.map((i) => stops[i]!))).toBeLessThanOrEqual(routeLength(baseline.map((i) => stops[i]!)) + 1e-9);
    expect(routeLength(order.map((i) => stops[i]!))).toBeLessThan(routeLength(baseline.map((i) => stops[i]!)));
  });

  it("groups singles, identical orders and the rest into the three AI job types", () => {
    const p = locationPoint(loc("x", "A", "01", "01", 1));
    const orders: AiOrder[] = [
      { id: "s1", units: 1, signature: "p1×1", points: [p] },
      { id: "s2", units: 1, signature: "p2×1", points: [p] },
      { id: "i1", units: 2, signature: "p1×2", points: [p] },
      { id: "i2", units: 2, signature: "p1×2", points: [p] },
      { id: "m1", units: 3, signature: "p1×1,p2×2", points: [p] },
    ];
    const groups = groupForAi(orders, 20);
    expect(groups).toEqual([
      { aiType: "AI-SingleItemBatchPick", orderIds: ["s1", "s2"] },
      { aiType: "AI-IdenticalOrderBatchPick", orderIds: ["i1", "i2"] },
      { aiType: "AI-OrderBasedPickPack", orderIds: ["m1"] },
    ]);
    expect(groupForAi(orders, 1).filter((g) => g.aiType === "AI-SingleItemBatchPick")).toHaveLength(2);
  });
});

describe("wave countdown", () => {
  it("reads 1d 10:46:40 instead of the zero-padded day format", () => {
    expect(formatWaveCountdown(((24 + 10) * 3600 + 46 * 60 + 40) * 1000)).toBe("1d 10:46:40");
    expect(formatWaveCountdown((2 * 3600 + 5) * 1000)).toBe("02:00:05");
  });
});

let w: World;
let auth: AuthContext;

beforeEach(() => {
  w = createWorld();
  const scope = { warehouseIds: [w.warehouseId], clientIds: "all" as const };
  auth = { scope, viewScope: scope, permissions: new Set<string>(), restrictions: [], user: { id: w.userId, name: "Admin" }, context: { warehouseId: null, clientId: null } } as unknown as AuthContext;
  w.db.insert(schema.apps).values({ key: "ai-jobs", name: "AI Jobs", description: "AI", category: "Operations", isActive: true, settings: { maxOrdersPerJob: 10 } }).run();
});
afterEach(() => w.close());

const aiRule = () => createWaveRule(w.db, auth, w.ctx, waveRuleInputSchema.parse({ name: "AI wave", warehouseId: w.warehouseId, operationType: "AI Job", jobTypeIds: [w.jobTypeId] }));

function stock() {
  const far = w.db.insert(schema.locations).values(locationRow(w.warehouseId, "D-04-05-1", { aisle: "D", rack: "04", bay: "05", areaType: "Storage", walkingPathPriority: 1 })).returning().get().id;
  const near = w.db.insert(schema.locations).values(locationRow(w.warehouseId, "A-01-01-1", { aisle: "A", rack: "01", bay: "01", areaType: "Storage", walkingPathPriority: 2 })).returning().get().id;
  ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.productId, locationId: far, qty: 50 });
  ledger.add(w.db, w.ctx, { warehouseId: w.warehouseId, clientId: w.clientId, productId: w.product2Id, locationId: near, qty: 50 });
}

describe("AI Job wave", () => {
  it("walks Pending → Preparing → Optimizing (deferred) and completes with AI jobs, sequence and SLA", () => {
    stock();
    createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 1 }]));
    createOrder(w.db, w.ctx, orderInput(w, [{ productId: w.productId, quantity: 2 }, { productId: w.product2Id, quantity: 1 }]));
    const r = aiRule();
    let deferred: string | null = null;
    const first = runWave(w.db, w.ctx, r.id, { runBy: "Admin", now: new Date("2026-11-09T10:00:00.000Z"), deferOptimization: (id) => { deferred = id; } });
    expect(first.wave.status).toBe("Optimizing");
    expect(first.summary).toMatch(/is optimizing: 3 met · 3 allocated/);
    expect(() => assertRuleRunnable(w.db, r.id, new Date("2026-11-09T11:00:00.000Z"))).toThrow(/being optimized/);
    expect(deferred).toBe(first.wave.id);

    const done = completeAiWave(w.db, w.ctx, first.wave.id, { runBy: "Admin", now: new Date("2026-11-09T10:00:00.000Z") });
    expect(done?.wave.status).toBe("Completed");
    expect(done?.wave.jobsCreated).toBe(2);
    expect(done?.summary).toMatch(/AI optimized 2 jobs/);
    const jobs = w.db.select().from(schema.jobs).where(eq(schema.jobs.waveId, first.wave.id)).all();
    expect(jobs.map((j) => j.jobType).sort()).toEqual(["AI-OrderBasedPickPack", "AI-SingleItemBatchPick"]);
    expect(completeAiWave(w.db, w.ctx, first.wave.id, { runBy: "Admin" })).toBeNull(); // idempotent

    // SLA: job = created + 1h / + 2h; every task inside the job window.
    for (const job of jobs) {
      expect(Date.parse(job.plannedStartAt!)).toBe(Date.parse(job.createdAt) + 3_600_000);
      expect(Date.parse(job.plannedEndAt!)).toBe(Date.parse(job.createdAt) + 7_200_000);
      for (const t of w.db.select().from(schema.tasks).where(eq(schema.tasks.jobId, job.id)).all()) {
        expect(t.plannedStartAt).toBe(job.plannedStartAt);
        expect(t.plannedFinishAt).toBe(job.plannedEndAt);
      }
    }

    const list = listJobs(w.db, auth, { ...EMPTY_GRID_QUERY, pageSize: 10 });
    const ai = list.rows.filter((row) => row.aiJob);
    expect(ai).toHaveLength(2);
    for (const row of ai) {
      expect(row.originalJobType).toBe("MULTI");
      expect(String(row.aiJobDescription)).toMatch(/^AI-\w+ · \d+ orders? · \d+ stops? · \d+ m walk/);
    }
    const tasks = listTasks(w.db, auth, "order", { ...EMPTY_GRID_QUERY, pageSize: 50 });
    expect(tasks.rows.filter((t) => t.taskType === "Picking").every((t) => typeof t.sequence === "number" && t.aiJobDescription)).toBe(true);
  });

  it("runs with the default AI settings when the AI Jobs app is inactive (built in, not gated)", () => {
    w.db.update(schema.apps).set({ isActive: false }).where(eq(schema.apps.key, "ai-jobs")).run();
    const res = runWave(w.db, w.ctx, aiRule().id, { runBy: "Admin" });
    expect(res.wave.status).not.toBe("Failed");
    expect(res.summary).not.toMatch(/AI Jobs is not active/);
  });
});

describe("assignable users and roles", () => {
  it("lists only operational users who can execute tasks", () => {
    const exec = w.db.insert(schema.roles).values({ key: "clerk", name: "Clerk", category: "Operation" }).returning().get().id;
    const view = w.db.insert(schema.roles).values({ key: "viewer", name: "Viewer", category: "Operation" }).returning().get().id;
    const client = w.db.insert(schema.roles).values({ key: "client", name: "Client", category: "Client" }).returning().get().id;
    w.db.insert(schema.rolePermissions).values([{ roleId: exec, permission: "fulfillment.task_details.execute_task" }, { roleId: client, permission: "fulfillment.task_details.execute_task" }]).run();
    const user = (email: string, roleId: string, extra: Partial<typeof schema.users.$inferInsert> = {}) => {
      const id = w.db.insert(schema.users).values({ email, name: email, passwordHash: "x", role: "operator", ...extra }).returning().get().id;
      w.db.insert(schema.userRoles).values({ userId: id, roleId }).run();
      w.db.insert(schema.userWarehouses).values({ userId: id, warehouseId: w.warehouseId }).run();
      return id;
    };
    const clerk = user("clerk@x.io", exec);
    user("viewer@x.io", view, { role: "viewer" });
    user("client@x.io", client, { userType: "Client" });
    user("api@x.io", exec, { isApiUser: true });
    const res = assignableForWarehouse(w.db, w.warehouseId);
    expect(res.users.map((u) => u.id)).toContain(clerk);
    expect(res.users.map((u) => u.email)).not.toEqual(expect.arrayContaining(["viewer@x.io"]));
    expect(res.users.some((u) => ["viewer@x.io", "client@x.io", "api@x.io"].includes(u.email))).toBe(false);
    expect(res.roles.map((r) => r.name)).toEqual(["Clerk"]);
    expect(() => createWaveRule(w.db, auth, w.ctx, waveRuleInputSchema.parse({
      name: "Bad", warehouseId: w.warehouseId, operationType: "Picking", jobTypeIds: [w.jobTypeId], assignMode: "Roles", assigneeRoleIds: [view],
    }))).toThrow(/can't execute tasks/);
  });

  it("explains a missing warehouse in human words", () => {
    const parsed = waveRuleInputSchema.safeParse({ name: "X", operationType: "Picking", jobTypeIds: ["a"] });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.find((i) => i.path[0] === "warehouseId")?.message).toBe("Choose a warehouse");
  });
});
