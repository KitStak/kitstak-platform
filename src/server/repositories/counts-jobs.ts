/**
 * Count jobs (M07): Create Job (plan → Ready To Count, split by Batch Size (Location)),
 * Create Recount (new line + new job; the original becomes Recount Created).
 *
 * Jobs / tasks rows are inserted here exactly like the foundation seed does for count
 * jobs (REQ-3 asks foundation for a domain helper); status changes go through the state
 * machines and `rollupJob`.
 */
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { jobTypeSettingsSchema, parseSettings } from "@/lib/domain-types";
import { lineRecountReason, planCreateJobReason } from "@/lib/grid-defs/counts/count-math";
import * as schema from "@/server/db/schema";
import { notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { hasWarehouse } from "@/server/auth/scope";
import { changeLog, sequences } from "@/server/domain";
import { describeError, DomainError } from "@/server/domain/errors";
import { assertUserInWarehouse } from "@/server/domain/jobs";
import { rollupJob } from "@/server/domain/progress";
import { getCountLine, getCountPlanRow, lineLabel, movePlan, moveLine, rollupCountPlan, type CountLineRow, type CountPlanRow } from "@/server/domain/task-handlers/count";
import type { BulkResult, DomainCtx, Tx } from "@/server/domain/types";

export const createCountJobSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1, "Select at least one count plan").max(1000),
  jobTypeId: z.string().min(1, "Choose a job type").max(64),
  batchSize: z.number().int("Whole numbers only").min(1, "At least 1").max(1000, "At most 1000"),
  assigneeUserId: z.string().min(1).max(64).nullish(),
});
export type CreateCountJobInput = z.output<typeof createCountJobSchema>;

export type CountJobsResult = BulkResult & { readonly jobIds: readonly string[] };

type JobTypeRow = typeof schema.jobTypes.$inferSelect;

/** Active Count job types of a warehouse (Create Job dropdown). */
export function countJobTypes(tx: Tx, warehouseId: string): { id: string; code: string; description: string; autoUpdateNoDifference: boolean; instantCount: boolean }[] {
  return tx.select().from(schema.jobTypes)
    .where(and(eq(schema.jobTypes.warehouseId, warehouseId), eq(schema.jobTypes.operationType, "Count"), eq(schema.jobTypes.isActive, true)))
    .orderBy(asc(schema.jobTypes.code)).all()
    .map((t) => {
      const s = parseSettings(jobTypeSettingsSchema, t.settings).count;
      return { id: t.id, code: t.code, description: t.description, autoUpdateNoDifference: s.autoUpdateNoDifferenceLines, instantCount: s.instantCount };
    });
}

function loadCountJobType(tx: Tx, jobTypeId: string, warehouseId: string): JobTypeRow {
  const jt = tx.select().from(schema.jobTypes).where(eq(schema.jobTypes.id, jobTypeId)).get();
  if (!jt) throw new DomainError("NOT_FOUND", "Job type not found");
  if (jt.operationType !== "Count") throw new DomainError("VALIDATION", `Job type ${jt.code} is not a count job type.`);
  if (!jt.isActive) throw new DomainError("INVALID_STATE", `Job type ${jt.code} is inactive.`);
  if (jt.warehouseId !== warehouseId) throw new DomainError("VALIDATION", `Job type ${jt.code} belongs to another warehouse.`);
  return jt;
}

export function defaultCountJobType(tx: Tx, warehouseId: string, instant = false): JobTypeRow {
  const types = countJobTypes(tx, warehouseId);
  const pick = (instant ? types.find((t) => t.instantCount) : types.find((t) => !t.instantCount)) ?? types[0];
  if (!pick) throw new DomainError("INVALID_STATE", "No count job type is set up for this warehouse. Add one under Settings → Job Types.");
  return loadCountJobType(tx, pick.id, warehouseId);
}

const nextTaskNo = (tx: Tx): number => (tx.get<{ n: number | null }>(sql`SELECT MAX(task_no) AS n FROM tasks`)?.n ?? 0) + 1;

/** Inserts one Count job with a task per line, links the lines and rolls the job up. */
export function insertCountJob(tx: Tx, ctx: DomainCtx, jobType: JobTypeRow, plan: CountPlanRow, lines: readonly CountLineRow[], assigneeUserId: string | null): string {
  const now = Date.now();
  const job = tx.insert(schema.jobs).values({
    id: crypto.randomUUID(), code: sequences.next(tx, "job"), warehouseId: plan.warehouseId, jobType: jobType.code, jobTypeId: jobType.id,
    operationType: "Count", status: "Pending", assignedToUserId: assigneeUserId, countPlanId: plan.id, waveRuleId: plan.waveRuleId,
    plannedStartAt: new Date(now).toISOString(), plannedEndAt: new Date(now + 3_600_000).toISOString(), createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning().get();
  changeLog.recordCreate(tx, ctx, { entityType: "job", entityId: job.id, entityCode: job.code });
  let taskNo = nextTaskNo(tx);
  lines.forEach((l, i) => {
    tx.insert(schema.tasks).values({
      taskNo: taskNo++, jobId: job.id, warehouseId: plan.warehouseId, taskType: "Count", status: "Pending", sequence: i + 1,
      countPlanId: plan.id, countLineId: l.id, productId: l.productId, sourceLocationId: l.locationId, sourceLpId: l.lpId,
      plannedQty: l.initialStockQty, assigneeUserId, plannedStartAt: job.plannedStartAt, createdBy: ctx.userId, updatedBy: ctx.userId,
    }).run();
  });
  rollupJob(tx, ctx, job.id);
  return job.id;
}

function stockAt(tx: Tx, locationId: string, productId: string | null): number {
  return tx.get<{ n: number | null }>(productId
    ? sql`SELECT SUM(on_hand) AS n FROM inventory WHERE location_id = ${locationId} AND product_id = ${productId} AND on_hand > 0`
    : sql`SELECT SUM(on_hand) AS n FROM inventory WHERE location_id = ${locationId} AND on_hand > 0`)?.n ?? 0;
}

/** SKU lines without a location expand to one line per location that holds the SKU. */
function expandSkuLines(tx: Tx, ctx: DomainCtx, plan: CountPlanRow, lines: CountLineRow[]): CountLineRow[] {
  const out: CountLineRow[] = [];
  for (const line of lines) {
    if (line.locationId || !line.productId) {
      const fresh = line.locationId ? stockAt(tx, line.locationId, line.productId) : line.initialStockQty;
      out.push(tx.update(schema.countPlanLines).set({ initialStockQty: fresh }).where(eq(schema.countPlanLines.id, line.id)).returning().get());
      continue;
    }
    const where = and(eq(schema.inventory.productId, line.productId), eq(schema.inventory.warehouseId, plan.warehouseId), gt(schema.inventory.onHand, 0));
    const locs = tx.select({ locationId: schema.inventory.locationId, qty: sql<number>`SUM(${schema.inventory.onHand})`, path: schema.locations.walkingPathPriority, code: schema.locations.code })
      .from(schema.inventory).innerJoin(schema.locations, eq(schema.locations.id, schema.inventory.locationId))
      .where(where).groupBy(schema.inventory.locationId).orderBy(schema.locations.walkingPathPriority, schema.locations.code).all();
    if (locs.length === 0) { out.push(line); continue; }
    locs.forEach((l, i) => {
      if (i === 0) {
        out.push(tx.update(schema.countPlanLines).set({ locationId: l.locationId, initialStockQty: Number(l.qty), updatedBy: ctx.userId }).where(eq(schema.countPlanLines.id, line.id)).returning().get());
      } else {
        out.push(tx.insert(schema.countPlanLines).values({ planId: plan.id, productId: line.productId, locationId: l.locationId, status: "Pending", initialStockQty: Number(l.qty), createdBy: ctx.userId, updatedBy: ctx.userId }).returning().get());
      }
    });
  }
  return out;
}

/** Lines grouped by location (walking path order), then split into jobs of `batchSize` locations. */
export function batchByLocation(tx: Tx, lines: readonly CountLineRow[], batchSize: number): CountLineRow[][] {
  const ids = [...new Set(lines.flatMap((l) => (l.locationId ? [l.locationId] : [])))];
  const order = new Map<string, number>();
  if (ids.length) {
    tx.select({ id: schema.locations.id }).from(schema.locations).where(inArray(schema.locations.id, ids))
      .orderBy(schema.locations.walkingPathPriority, schema.locations.code).all().forEach((r, i) => order.set(r.id, i));
  }
  const groups = new Map<string, CountLineRow[]>();
  for (const l of lines) {
    const key = l.locationId ?? `sku:${l.productId ?? l.id}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  const sorted = [...groups.entries()].sort(([a], [b]) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9) || a.localeCompare(b)).map(([, g]) => g);
  const out: CountLineRow[][] = [];
  for (let i = 0; i < sorted.length; i += batchSize) out.push(sorted.slice(i, i + batchSize).flat());
  return out;
}

function ownPlan(tx: Tx, auth: AuthContext, id: string): CountPlanRow {
  const plan = tx.select().from(schema.countPlans).where(eq(schema.countPlans.id, id)).get();
  if (!plan || !hasWarehouse(auth.scope, plan.warehouseId)) throw notFoundError("Count plan");
  return plan;
}

/** Creates the jobs for one Pending plan and moves it (and its lines) to Ready To Count. */
export function createJobsForPlan(tx: Tx, ctx: DomainCtx, plan: CountPlanRow, input: Pick<CreateCountJobInput, "jobTypeId" | "batchSize" | "assigneeUserId">): string[] {
  const reason = planCreateJobReason(plan.status);
  if (reason) throw new DomainError("INVALID_STATE", `${plan.code}: ${reason.toLowerCase()}.`);
  const jobType = loadCountJobType(tx, input.jobTypeId, plan.warehouseId);
  if (input.assigneeUserId) assertUserInWarehouse(tx, input.assigneeUserId, plan.warehouseId);
  const pending = tx.select().from(schema.countPlanLines).where(and(eq(schema.countPlanLines.planId, plan.id), eq(schema.countPlanLines.status, "Pending"))).all();
  if (pending.length === 0) throw new DomainError("INVALID_STATE", `${plan.code} has no lines to count.`);
  const lines = expandSkuLines(tx, ctx, plan, pending);
  const jobIds: string[] = [];
  for (const batch of batchByLocation(tx, lines, input.batchSize)) {
    const jobId = insertCountJob(tx, ctx, jobType, plan, batch, input.assigneeUserId ?? null);
    for (const l of batch) moveLine(tx, ctx, getCountLine(tx, l.id), "Ready To Count", { jobId });
    jobIds.push(jobId);
  }
  movePlan(tx, ctx, getCountPlanRow(tx, plan.id), "Ready To Count");
  return jobIds;
}

export function createCountJobs(tx: Tx, ctx: DomainCtx, auth: AuthContext, input: CreateCountJobInput): CountJobsResult {
  const jobIds: string[] = [];
  const succeeded: string[] = [];
  const failed: { id: string; code: string; message: string }[] = [];
  for (const id of [...new Set(input.ids)]) {
    try {
      tx.transaction((inner) => {
        jobIds.push(...createJobsForPlan(inner, ctx, ownPlan(inner, auth, id), input));
      });
      succeeded.push(id);
    } catch (e) {
      failed.push({ id, ...describeError(e) });
    }
  }
  return { succeeded, failed, jobIds };
}

/* --------------------------------------------------------------- recount */
export function createRecounts(tx: Tx, ctx: DomainCtx, auth: AuthContext, lineIds: readonly string[], assigneeUserId: string | null = null): CountJobsResult {
  const failed: { id: string; code: string; message: string }[] = [];
  const byPlan = new Map<string, CountLineRow[]>();
  for (const id of [...new Set(lineIds)]) {
    try {
      const line = getCountLine(tx, id);
      const plan = ownPlan(tx, auth, line.planId);
      const reason = lineRecountReason(line.status);
      if (reason) throw new DomainError("INVALID_STATE", reason);
      if (plan.status === "Cancelled" || plan.status === "Inventory Updated") throw new DomainError("INVALID_STATE", `Count plan ${plan.code} is ${plan.status.toLowerCase()}.`);
      byPlan.set(plan.id, [...(byPlan.get(plan.id) ?? []), line]);
    } catch (e) {
      failed.push({ id, ...describeError(e) });
    }
  }
  const succeeded: string[] = [];
  const jobIds: string[] = [];
  for (const [planId, lines] of byPlan) {
    try {
      tx.transaction((inner) => {
        const plan = getCountPlanRow(inner, planId);
        const sourceJob = lines[0]?.jobId ? inner.select().from(schema.jobs).where(eq(schema.jobs.id, lines[0].jobId)).get() : undefined;
        const jobType = sourceJob?.jobTypeId ? loadCountJobType(inner, sourceJob.jobTypeId, plan.warehouseId) : defaultCountJobType(inner, plan.warehouseId);
        const created: CountLineRow[] = [];
        for (const line of lines) {
          const fresh = inner.insert(schema.countPlanLines).values({
            planId, locationId: line.locationId, productId: line.productId, lpId: line.lpId, status: "Ready To Count",
            initialStockQty: line.locationId ? stockAt(inner, line.locationId, line.productId) : 0, isRecountLine: true, recountOfLineId: line.id,
            createdBy: ctx.userId, updatedBy: ctx.userId,
          }).returning().get();
          changeLog.recordLine(inner, ctx, {
            entityType: "count_plan", entityId: planId, entityCode: plan.code, lineEntityType: "count_line", lineEntityId: fresh.id,
            lineLabel: lineLabel(inner, fresh), field: "status", from: "—", to: "Ready To Count",
          });
          moveLine(inner, ctx, line, "Recount Created", { recounted: true });
          created.push(fresh);
        }
        const jobId = insertCountJob(inner, ctx, jobType, plan, created, assigneeUserId ?? sourceJob?.assignedToUserId ?? null);
        inner.update(schema.countPlanLines).set({ jobId }).where(inArray(schema.countPlanLines.id, created.map((c) => c.id))).run();
        rollupCountPlan(inner, ctx, planId);
        jobIds.push(jobId);
      });
      succeeded.push(...lines.map((l) => l.id));
    } catch (e) {
      failed.push(...lines.map((l) => ({ id: l.id, ...describeError(e) })));
    }
  }
  return { succeeded, failed, jobIds };
}
