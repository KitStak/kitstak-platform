/**
 * Count jobs (M07): Create Job (plan → Ready To Count, split by Batch Size (Location)),
 * Create Recount (new line + new job; the original becomes Recount Created).
 *
 * Jobs / tasks rows are inserted here exactly like the foundation seed does for count
 * jobs (REQ-3 asks foundation for a domain helper); status changes go through the state
 * machines and `rollupJob`.
 */
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { asc } from "@/server/db/order";
import { z } from "zod";
import { jobTypeSettingsSchema, parseSettings } from "@/lib/domain-types";
import { lineRecountReason, planCreateJobReason } from "@/lib/grid-defs/counts/count-math";
import * as schema from "@/server/db/schema";
import { notFoundError } from "@/server/api/errors";
import type { AuthContext } from "@/server/auth/context";
import { hasWarehouse } from "@/server/auth/scope";
import * as changeLog from "@/server/domain/change-log";
import * as sequences from "@/server/domain/sequences";
import { describeError, DomainError } from "@/server/domain/errors";
import { assertUserInWarehouse } from "@/server/domain/jobs";
import { rollupJob } from "@/server/domain/progress";
import { ORPHANED_LINE } from "./counts-grids";
import { recordCountEvent, recordJobEvent } from "./counts-events";
import { getCountLine, getCountPlanRow, lineLabel, movePlan, moveLine, rollupCountPlan, type CountLineRow, type CountPlanRow } from "@/server/domain/task-handlers/count";
import type { BulkResult, DomainCtx, Tx } from "@/server/domain/types";
import { dbAll, dbGet, forEachSeq, mapSeq, withWriteTx } from "@/server/db/sql";

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
export async function countJobTypes(tx: Tx, warehouseId: string): Promise<{ id: string; code: string; description: string; autoUpdateNoDifference: boolean; instantCount: boolean }[]> {
  return (await tx.select().from(schema.jobTypes)
    .where(and(eq(schema.jobTypes.warehouseId, warehouseId), eq(schema.jobTypes.operationType, "Count"), eq(schema.jobTypes.isActive, true)))
    .orderBy(asc(schema.jobTypes.code)))
    .map((t) => {
      const s = parseSettings(jobTypeSettingsSchema, t.settings).count;
      return { id: t.id, code: t.code, description: t.description, autoUpdateNoDifference: s.autoUpdateNoDifferenceLines, instantCount: s.instantCount };
    });
}

/**
 * Create Job never dead-ends: when a warehouse has no active Count job type, a user who may create job
 * types gets the default "Cycle Count" type (same settings as the seed) in one click. Idempotent: an
 * existing active Count type is returned instead.
 */
export async function ensureDefaultCountJobType(tx: Tx, ctx: DomainCtx, auth: AuthContext, warehouseId: string): Promise<Awaited<ReturnType<typeof countJobTypes>>[number]> {
  if (!hasWarehouse(auth.scope, warehouseId)) throw notFoundError("Warehouse");
  const existing = (await countJobTypes(tx, warehouseId))[0];
  if (existing) return existing;
  const taken = new Set((await tx.select({ code: schema.jobTypes.code }).from(schema.jobTypes).where(eq(schema.jobTypes.warehouseId, warehouseId))).map((r) => r.code.toLowerCase()));
  let code = "Cycle Count";
  for (let i = 2; taken.has(code.toLowerCase()); i++) code = `Cycle Count ${i}`;
  const settings = jobTypeSettingsSchema.parse({ count: { autoUpdateNoDifferenceLines: true } });
  const row = (await tx.insert(schema.jobTypes).values({
    code, description: "Default count job type (created from Create Job)", warehouseId, operationType: "Count", template: settings.template, settings, createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning())[0];
  await changeLog.recordCreate(tx, ctx, { entityType: "job_type", entityId: row.id, entityCode: row.code });
  return (await countJobTypes(tx, warehouseId)).find((t) => t.id === row.id) ?? { id: row.id, code, description: row.description, autoUpdateNoDifference: true, instantCount: false };
}

async function loadCountJobType(tx: Tx, jobTypeId: string, warehouseId: string): Promise<JobTypeRow> {
  const jt = (await tx.select().from(schema.jobTypes).where(eq(schema.jobTypes.id, jobTypeId)).limit(1))[0];
  if (!jt) throw new DomainError("NOT_FOUND", "Job type not found");
  if (jt.operationType !== "Count") throw new DomainError("VALIDATION", `Job type ${jt.code} is not a count job type.`);
  if (!jt.isActive) throw new DomainError("INVALID_STATE", `Job type ${jt.code} is inactive.`);
  if (jt.warehouseId !== warehouseId) throw new DomainError("VALIDATION", `Job type ${jt.code} belongs to another warehouse.`);
  return jt;
}

export async function defaultCountJobType(tx: Tx, warehouseId: string, instant = false): Promise<JobTypeRow> {
  const types = await countJobTypes(tx, warehouseId);
  const pick = (instant ? types.find((t) => t.instantCount) : types.find((t) => !t.instantCount)) ?? types[0];
  if (!pick) throw new DomainError("INVALID_STATE", "No count job type is set up for this warehouse. Add one under Settings → Job Types.");
  return await loadCountJobType(tx, pick.id, warehouseId);
}

/** Open lines of a started plan whose count task is gone (job cancelled from the Jobs page). */
export async function orphanedLines(tx: Tx, planId: string): Promise<CountLineRow[]> {
  return await mapSeq((await dbAll<{ id: string }>(tx, sql`
    SELECT l.id FROM count_plan_lines l WHERE l.plan_id = ${planId} AND ${sql.raw(ORPHANED_LINE)}`)), async (r) => await getCountLine(tx, r.id));
}

const nextTaskNo = async (tx: Tx): Promise<number> => ((await dbGet<{ n: number | null }>(tx, sql`SELECT MAX(task_no) AS n FROM tasks`))?.n ?? 0) + 1;

/** Inserts one Count job with a task per line, links the lines and rolls the job up. */
export async function insertCountJob(tx: Tx, ctx: DomainCtx, jobType: JobTypeRow, plan: CountPlanRow, lines: readonly CountLineRow[], assigneeUserId: string | null): Promise<string> {
  const now = Date.now();
  const job = (await tx.insert(schema.jobs).values({
    id: crypto.randomUUID(), code: await sequences.next(tx, "job"), warehouseId: plan.warehouseId, jobType: jobType.code, jobTypeId: jobType.id,
    operationType: "Count", status: "Pending", assignedToUserId: assigneeUserId, countPlanId: plan.id, waveRuleId: plan.waveRuleId,
    plannedStartAt: new Date(now).toISOString(), plannedEndAt: new Date(now + 3_600_000).toISOString(), createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning())[0];
  await changeLog.recordCreate(tx, ctx, { entityType: "job", entityId: job.id, entityCode: job.code });
  let taskNo = await nextTaskNo(tx);
  await forEachSeq(lines, async (l, i) => {
    await tx.insert(schema.tasks).values({
      taskNo: taskNo++, jobId: job.id, warehouseId: plan.warehouseId, taskType: "Count", status: "Pending", sequence: i + 1,
      countPlanId: plan.id, countLineId: l.id, productId: l.productId, sourceLocationId: l.locationId, sourceLpId: l.lpId,
      plannedQty: l.initialStockQty, assigneeUserId, plannedStartAt: job.plannedStartAt, createdBy: ctx.userId, updatedBy: ctx.userId,
    });
  });
  await rollupJob(tx, ctx, job.id);
  return job.id;
}

async function stockAt(tx: Tx, locationId: string, productId: string | null): Promise<number> {
  return (await dbGet<{ n: number | null }>(tx, productId
    ? sql`SELECT SUM(on_hand) AS n FROM inventory WHERE location_id = ${locationId} AND product_id = ${productId} AND on_hand > 0`
    : sql`SELECT SUM(on_hand) AS n FROM inventory WHERE location_id = ${locationId} AND on_hand > 0`))?.n ?? 0;
}

/** SKU lines without a location expand to one line per location that holds the SKU. */
async function expandSkuLines(tx: Tx, ctx: DomainCtx, plan: CountPlanRow, lines: CountLineRow[]): Promise<CountLineRow[]> {
  const out: CountLineRow[] = [];
  for (const line of lines) {
    if (line.locationId || !line.productId) {
      const fresh = line.locationId ? await stockAt(tx, line.locationId, line.productId) : line.initialStockQty;
      out.push((await tx.update(schema.countPlanLines).set({ initialStockQty: fresh }).where(eq(schema.countPlanLines.id, line.id)).returning())[0]);
      continue;
    }
    const where = and(eq(schema.inventory.productId, line.productId), eq(schema.inventory.warehouseId, plan.warehouseId), gt(schema.inventory.onHand, 0));
    const locs = await tx.select({ locationId: schema.inventory.locationId, qty: sql<number>`SUM(${schema.inventory.onHand})`, path: schema.locations.walkingPathPriority, code: schema.locations.code })
      .from(schema.inventory).innerJoin(schema.locations, eq(schema.locations.id, schema.inventory.locationId))
      .where(where).groupBy(schema.inventory.locationId, schema.locations.id).orderBy(sql`${schema.locations.walkingPathPriority} ASC NULLS FIRST`, schema.locations.code);
    if (locs.length === 0) { out.push(line); continue; }
    await forEachSeq(locs, async (l, i) => {
      if (i === 0) {
        out.push((await tx.update(schema.countPlanLines).set({ locationId: l.locationId, initialStockQty: Number(l.qty), updatedBy: ctx.userId }).where(eq(schema.countPlanLines.id, line.id)).returning())[0]);
      } else {
        out.push((await tx.insert(schema.countPlanLines).values({ planId: plan.id, productId: line.productId, locationId: l.locationId, status: "Pending", initialStockQty: Number(l.qty), createdBy: ctx.userId, updatedBy: ctx.userId }).returning())[0]);
      }
    });
  }
  return out;
}

/** Lines grouped by location (walking path order), then split into jobs of `batchSize` locations. */
export async function batchByLocation(tx: Tx, lines: readonly CountLineRow[], batchSize: number): Promise<CountLineRow[][]> {
  const ids = [...new Set(lines.flatMap((l) => (l.locationId ? [l.locationId] : [])))];
  const order = new Map<string, number>();
  if (ids.length) {
    (await tx.select({ id: schema.locations.id }).from(schema.locations).where(inArray(schema.locations.id, ids))
      .orderBy(schema.locations.walkingPathPriority, schema.locations.code)).forEach((r, i) => order.set(r.id, i));
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

export interface CountJobPreview { readonly planId: string; readonly code: string; readonly units: number; readonly lines: number; readonly cancelled: number }

/**
 * Create Job preview without writing: the batch units (distinct locations, after SKU lines expand to
 * every location that stocks the SKU) of each Pending plan. Jobs = ceil(units / batch size).
 */
export async function previewCountJobs(tx: Tx, auth: AuthContext, ids: readonly string[]): Promise<CountJobPreview[]> {
  return await mapSeq([...new Set(ids)], async (id) => {
    const plan = await ownPlan(tx, auth, id);
    const pending = plan.status === "Pending"
      ? await tx.select().from(schema.countPlanLines).where(and(eq(schema.countPlanLines.planId, plan.id), eq(schema.countPlanLines.status, "Pending")))
      : await orphanedLines(tx, plan.id);
    const units = new Set<string>();
    let lines = 0;
    for (const l of pending) {
      if (l.locationId || !l.productId) { units.add(l.locationId ?? `line:${l.id}`); lines += 1; continue; }
      const locs = await tx.select({ locationId: schema.inventory.locationId }).from(schema.inventory)
        .where(and(eq(schema.inventory.productId, l.productId), eq(schema.inventory.warehouseId, plan.warehouseId), gt(schema.inventory.onHand, 0)))
        .groupBy(schema.inventory.locationId);
      if (locs.length === 0) { units.add(`sku:${l.productId}`); lines += 1; continue; }
      for (const r of locs) units.add(r.locationId);
      lines += locs.length;
    }
    // Cancelled lines get no task; reported so the modal matches Location Details, which lists them.
    const cancelled = (await tx.select({ n: sql<number>`count(*)` }).from(schema.countPlanLines).where(and(eq(schema.countPlanLines.planId, plan.id), eq(schema.countPlanLines.status, "Cancelled"))).limit(1))[0]?.n ?? 0;
    return { planId: plan.id, code: plan.code, units: units.size, lines, cancelled: Number(cancelled) };
  });
}

async function ownPlan(tx: Tx, auth: AuthContext, id: string): Promise<CountPlanRow> {
  const plan = (await tx.select().from(schema.countPlans).where(eq(schema.countPlans.id, id)).limit(1))[0];
  if (!plan || !hasWarehouse(auth.scope, plan.warehouseId)) throw notFoundError("Count plan");
  return plan;
}

/** Creates the jobs for one Pending plan and moves it (and its lines) to Ready To Count. */
export async function createJobsForPlan(tx: Tx, ctx: DomainCtx, plan: CountPlanRow, input: Pick<CreateCountJobInput, "jobTypeId" | "batchSize" | "assigneeUserId">): Promise<string[]> {
  const orphans = plan.status === "Pending" ? [] : await orphanedLines(tx, plan.id);
  const reason = planCreateJobReason(plan.status, orphans.length);
  if (reason) throw new DomainError("INVALID_STATE", `${plan.code}: ${reason.toLowerCase()}.`);
  const jobType = await loadCountJobType(tx, input.jobTypeId, plan.warehouseId);
  if (input.assigneeUserId) await assertUserInWarehouse(tx, input.assigneeUserId, plan.warehouseId);
  if (plan.status !== "Pending") return await reissueOrphanedLines(tx, ctx, plan, orphans, jobType, input);
  const pending = await tx.select().from(schema.countPlanLines).where(and(eq(schema.countPlanLines.planId, plan.id), eq(schema.countPlanLines.status, "Pending")));
  if (pending.length === 0) throw new DomainError("INVALID_STATE", `${plan.code} has no lines to count.`);
  const lines = await expandSkuLines(tx, ctx, plan, pending);
  const jobIds: string[] = [];
  for (const batch of await batchByLocation(tx, lines, input.batchSize)) {
    const jobId = await insertCountJob(tx, ctx, jobType, plan, batch, input.assigneeUserId ?? null);
    for (const l of batch) await moveLine(tx, ctx, await getCountLine(tx, l.id), "Ready To Count", { jobId });
    await recordJobEvent(tx, ctx, plan, jobId, "created", { batchSize: input.batchSize });
    jobIds.push(jobId);
  }
  await movePlan(tx, ctx, await getCountPlanRow(tx, plan.id), "Ready To Count");
  return jobIds;
}

/**
 * Re-creates count jobs for an open plan whose job was cancelled: each orphaned line keeps its
 * status (Ready to Count / Count Started) and gets a fresh Pending task in a new job.
 */
async function reissueOrphanedLines(tx: Tx, ctx: DomainCtx, plan: CountPlanRow, orphans: readonly CountLineRow[], jobType: JobTypeRow, input: Pick<CreateCountJobInput, "batchSize" | "assigneeUserId">): Promise<string[]> {
  const jobIds: string[] = [];
  for (const batch of await batchByLocation(tx, orphans, input.batchSize)) {
    const jobId = await insertCountJob(tx, ctx, jobType, plan, batch, input.assigneeUserId ?? null);
    await tx.update(schema.countPlanLines).set({ jobId, updatedBy: ctx.userId, version: sql`${schema.countPlanLines.version} + 1` })
      .where(inArray(schema.countPlanLines.id, batch.map((l) => l.id)));
    await recordJobEvent(tx, ctx, plan, jobId, "reissued", { batchSize: input.batchSize });
    jobIds.push(jobId);
  }
  const codes = (await tx.select({ code: schema.jobs.code }).from(schema.jobs).where(inArray(schema.jobs.id, jobIds))).map((j) => j.code);
  await changeLog.recordUpdate(tx, ctx, {
    entityType: "count_plan", entityId: plan.id, entityCode: plan.code,
    before: { reissuedLines: 0, countJobs: "" }, after: { reissuedLines: orphans.length, countJobs: codes.join(", ") },
  });
  return jobIds;
}

export async function createCountJobs(tx: Tx, ctx: DomainCtx, auth: AuthContext, input: CreateCountJobInput): Promise<CountJobsResult> {
  const jobIds: string[] = [];
  const succeeded: string[] = [];
  const failed: { id: string; code: string; message: string }[] = [];
  for (const id of [...new Set(input.ids)]) {
    try {
      await withWriteTx(tx, async (inner) => {
        jobIds.push(...await createJobsForPlan(inner, ctx, await ownPlan(inner, auth, id), input));
      });
      succeeded.push(id);
    } catch (e) {
      failed.push({ id, ...describeError(e) });
    }
  }
  return { succeeded, failed, jobIds };
}

/* --------------------------------------------------------------- recount */
export async function createRecounts(tx: Tx, ctx: DomainCtx, auth: AuthContext, lineIds: readonly string[], assigneeUserId: string | null = null): Promise<CountJobsResult> {
  const failed: { id: string; code: string; message: string }[] = [];
  const byPlan = new Map<string, CountLineRow[]>();
  for (const id of [...new Set(lineIds)]) {
    try {
      const line = await getCountLine(tx, id);
      const plan = await ownPlan(tx, auth, line.planId);
      const reason = lineRecountReason(line.status, plan.operationType);
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
      await withWriteTx(tx, async (inner) => {
        const plan = await getCountPlanRow(inner, planId);
        const sourceJob = lines[0]?.jobId ? (await inner.select().from(schema.jobs).where(eq(schema.jobs.id, lines[0].jobId)).limit(1))[0] : undefined;
        const jobType = sourceJob?.jobTypeId ? await loadCountJobType(inner, sourceJob.jobTypeId, plan.warehouseId) : await defaultCountJobType(inner, plan.warehouseId);
        const created: CountLineRow[] = [];
        for (const line of lines) {
          const fresh = (await inner.insert(schema.countPlanLines).values({
            planId, locationId: line.locationId, productId: line.productId, lpId: line.lpId, status: "Ready To Count",
            initialStockQty: line.locationId ? await stockAt(inner, line.locationId, line.productId) : 0, isRecountLine: true, recountOfLineId: line.id,
            createdBy: ctx.userId, updatedBy: ctx.userId,
          }).returning())[0];
          await changeLog.recordLine(inner, ctx, {
            entityType: "count_plan", entityId: planId, entityCode: plan.code, lineEntityType: "count_line", lineEntityId: fresh.id,
            lineLabel: await lineLabel(inner, fresh), field: "status", from: "—", to: "Ready To Count",
          });
          await moveLine(inner, ctx, line, "Recount Created", { recounted: true });
          created.push(fresh);
        }
        const jobId = await insertCountJob(inner, ctx, jobType, plan, created, assigneeUserId ?? sourceJob?.assignedToUserId ?? null);
        await inner.update(schema.countPlanLines).set({ jobId }).where(inArray(schema.countPlanLines.id, created.map((c) => c.id)));
        const newJob = (await inner.select({ code: schema.jobs.code }).from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1))[0];
        for (const line of lines) {
          await recordCountEvent(inner, ctx, { planId, planCode: plan.code, line: { id: line.id, label: await lineLabel(inner, line) }, text: `Recount created in job ${newJob?.code ?? "—"}; this count is superseded until the recount is done` });
        }
        await recordJobEvent(inner, ctx, plan, jobId, "recount", { recountOf: await mapSeq(lines, async (l) => await lineLabel(inner, l)) });
        await rollupCountPlan(inner, ctx, planId);
        jobIds.push(jobId);
      });
      succeeded.push(...lines.map((l) => l.id));
    } catch (e) {
      failed.push(...lines.map((l) => ({ id: l.id, ...describeError(e) })));
    }
  }
  return { succeeded, failed, jobIds };
}
