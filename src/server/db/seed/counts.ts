/**
 * Counting replay: six count plans across the lifecycle (Pending, Ready To Count, Count
 * Started, Count Completed, Inventory Updated with a recount line, Cancelled) plus one
 * instant count. Plans that reach Inventory Updated post ledger Count transactions.
 */
import { and, eq, gt, sql } from "drizzle-orm";
import type { CountPlanStatus } from "@/lib/enums";
import * as schema from "@/server/db/schema";
import { changeLog, ledger, sequences, stateMachines } from "@/server/domain";
import type { DomainCtx, Tx } from "@/server/domain/types";
import { jobTypeKey } from "./config";
import { lookupId } from "./lookups";
import { HOUR_MS, MINUTE_MS, isoOf, utcAt } from "./runtime";
import { actor, txAt, type Id } from "./types";
import { noteFailure, operatorFor, type World } from "./world";

interface CountSpec {
  readonly target: CountPlanStatus;
  readonly daysAgo: number;
  readonly description: string;
  readonly zoneOffset: number;
  readonly instant?: boolean;
  readonly recount?: boolean;
  /** Saved from the AI suggestion (ABC / velocity), so the AI Plan filter and badge have data. */
  readonly ai?: boolean;
}

const SPECS: readonly CountSpec[] = [
  { target: "Cancelled", daysAgo: 16, description: "Zone D aisle 2 - cancelled (peak week)", zoneOffset: 0 },
  { target: "Inventory Updated", daysAgo: 9, description: "Weekly cycle count - zone C aisle 1", zoneOffset: 6, recount: true },
  { target: "Inventory Updated", daysAgo: 5, description: "Instant count - pick face variance", zoneOffset: 14, instant: true },
  { target: "Count Completed", daysAgo: 2, description: "Weekly cycle count - zone C aisle 3", zoneOffset: 20 },
  { target: "Count Started", daysAgo: 0, description: "Weekly cycle count - zone D aisle 1", zoneOffset: 28 },
  { target: "Ready To Count", daysAgo: 1, description: "Fast movers spot check - zone A", zoneOffset: 36, ai: true },
  // Offset chosen so no location is held by two open plans (db:verify open_count_overlap).
  { target: "Pending", daysAgo: 0, description: "AI suggested - class A velocity count", zoneOffset: 60, ai: true },
  { target: "Pending", daysAgo: 0, description: "Month-end count - bulk floor", zoneOffset: 44 },
];

const PATH_TO: Readonly<Record<CountPlanStatus, readonly CountPlanStatus[]>> = {
  "Pending": [], "Ready To Count": ["Ready To Count"], "Count Started": ["Ready To Count", "Count Started"],
  "Count Completed": ["Ready To Count", "Count Started", "Count Completed"],
  "Inventory Updated": ["Ready To Count", "Count Started", "Count Completed", "Inventory Updated"], "Cancelled": ["Cancelled"],
};

function locationsFor(w: World, spec: CountSpec): Id[] {
  const fac = w.facility.MLT1;
  const pool = spec.instant ? [...fac.pickFaces.values()] : fac.reserve;
  const n = spec.instant ? 1 : 5;
  return Array.from({ length: n }, (_, i) => pool[(spec.zoneOffset + i * 3) % pool.length]);
}

function insertLine(tx: Tx, planId: Id, locationId: Id, status: CountPlanStatus | "Recount Created", extra: Partial<typeof schema.countPlanLines.$inferInsert> = {}): Id {
  const stock = tx.select().from(schema.inventory).where(and(eq(schema.inventory.locationId, locationId), gt(schema.inventory.onHand, 0))).all();
  return tx.insert(schema.countPlanLines).values({
    planId, locationId, status, initialStockQty: stock.reduce((s, b) => s + b.onHand, 0), ...extra,
  }).returning({ id: schema.countPlanLines.id }).get().id;
}

/** Counts a line's buckets; returns the entries' (bucket, counted) pairs. */
function countLine(tx: Tx, ctx: DomainCtx, lineId: Id, locationId: Id, variance: (i: number) => number): { bucketId: Id; counted: number; system: number }[] {
  const buckets = tx.select().from(schema.inventory).where(and(eq(schema.inventory.locationId, locationId), gt(schema.inventory.onHand, 0))).all();
  const out = buckets.map((b, i) => {
    const counted = Math.max(b.allocated, b.onHand + variance(i));
    tx.insert(schema.countLineEntries).values({
      lineId, productId: b.productId, locationId, lpId: b.lpId, lotNumber: b.lotNumber, expiryDate: b.expiryDate, damageReason: b.damageReason,
      packType: b.packType, systemQty: b.onHand, countedQty: counted, countedBy: ctx.source,
    }).run();
    return { bucketId: b.id, counted, system: b.onHand };
  });
  const counted = out.reduce((s, e) => s + e.counted, 0);
  tx.update(schema.countPlanLines).set({ countedQty: counted, approvedStockQty: out.reduce((s, e) => s + e.system, 0), approvedCountQty: counted, countUserId: ctx.userId,
    startedAt: isoOf(Date.now()), completedAt: isoOf(Date.now() + 4 * MINUTE_MS) }).where(eq(schema.countPlanLines.id, lineId)).run();
  return out;
}

function setPlanStatus(tx: Tx, ctx: DomainCtx, planId: Id, code: string, from: CountPlanStatus, to: CountPlanStatus, stamp: Partial<typeof schema.countPlans.$inferInsert> = {}): void {
  const status = stateMachines.countPlan.transition(from, to);
  tx.update(schema.countPlans).set({ status, ...stamp, updatedBy: ctx.userId }).where(eq(schema.countPlans.id, planId)).run();
  changeLog.recordUpdate(tx, ctx, { entityType: "count_plan", entityId: planId, entityCode: code, before: { status: from }, after: { status } });
}

function countJob(w: World, tx: Tx, spec: CountSpec, planId: Id, lines: readonly { id: Id; locationId: Id }[], atMs: number, done: boolean): void {
  const fac = w.facility.MLT1;
  const user = operatorFor(w, "MLT1", spec.zoneOffset);
  const code = spec.instant ? "Instant Count" : "Cycle Count";
  const job = tx.insert(schema.jobs).values({
    id: crypto.randomUUID(), code: sequences.next(tx, "job"), warehouseId: fac.id, jobType: code, jobTypeId: w.config.jobTypes.get(jobTypeKey(fac.id, code)) ?? null,
    operationType: "Count", status: done ? "Completed" : spec.target === "Count Started" ? "Started" : "Pending", assignedToUserId: user.id, countPlanId: planId,
    ruleName: spec.instant ? null : w.config.waveRules.count.name, waveRuleId: spec.instant ? null : w.config.waveRules.count.id, taskCount: lines.length,
    // Matches the task rows below (rollupJob rule): Count Started seeds ceil(n/2) tasks Completed.
    completedTaskCount: done ? lines.length : spec.target === "Count Started" ? Math.ceil(lines.length / 2) : 0, plannedStartAt: isoOf(atMs), startedAt: spec.target === "Ready To Count" ? null : isoOf(atMs), completedAt: done ? isoOf(atMs + HOUR_MS) : null,
  }).returning({ id: schema.jobs.id }).get();
  const maxNo = tx.get<{ n: number | null }>(sql`SELECT MAX(task_no) AS n FROM tasks`)?.n ?? 0;
  lines.forEach((l, i) => {
    const started = spec.target === "Count Started" && i < Math.ceil(lines.length / 2);
    tx.insert(schema.tasks).values({
      taskNo: maxNo + i + 1, jobId: job.id, warehouseId: fac.id, taskType: "Count", status: done || started ? "Completed" : "Pending", sequence: i + 1,
      countPlanId: planId, countLineId: l.id, sourceLocationId: l.locationId, assigneeUserId: user.id, executedByUserId: done || started ? user.id : null,
      plannedStartAt: isoOf(atMs), finishedAt: done || started ? isoOf(atMs + (i + 1) * 6 * MINUTE_MS) : null,
    }).run();
    tx.update(schema.countPlanLines).set({ jobId: job.id }).where(eq(schema.countPlanLines.id, l.id)).run();
  });
}

function runCount(w: World, tx: Tx, spec: CountSpec, atMs: number): void {
  const ctx = actor(w.access.manager);
  const counter = actor(operatorFor(w, "MLT1", spec.zoneOffset));
  const code = spec.instant ? sequences.instantCountCode(new Date(atMs)) : sequences.next(tx, "count");
  const plan = tx.insert(schema.countPlans).values({
    code, warehouseId: w.facility.MLT1.id, description: spec.description, scheduledAt: isoOf(spec.target === "Pending" ? atMs + 26 * HOUR_MS : atMs),
    countType: "Location", operationType: spec.instant ? "Instant Count" : "Cycle Count", waveRuleId: spec.instant ? null : w.config.waveRules.count.id, isAi: spec.ai ?? false, createdBy: ctx.userId,
  }).returning().get();
  changeLog.recordCreate(tx, ctx, { entityType: "count_plan", entityId: plan.id, entityCode: code });
  const reasonId = lookupId(w.lookups, "adjustment_reason", "Cycle count correction");
  const steps = PATH_TO[spec.target];
  const lineStatus = (s: CountPlanStatus): CountPlanStatus => (s === "Count Started" ? "Count Started" : s);
  const lines = locationsFor(w, spec).map((locationId) => ({ id: insertLine(tx, plan.id, locationId, steps.length > 0 ? lineStatus(spec.target) : "Pending"), locationId }));
  if (spec.target !== "Pending" && spec.target !== "Cancelled") countJob(w, tx, spec, plan.id, lines, atMs, spec.target === "Count Completed" || spec.target === "Inventory Updated");
  let status: CountPlanStatus = "Pending";
  for (const to of steps) {
    if (to === "Count Started") setPlanStatus(tx, ctx, plan.id, code, status, to, { startedAt: isoOf(atMs) });
    else if (to === "Count Completed") {
      for (const [i, l] of lines.entries()) countLine(tx, counter, l.id, l.locationId, (j) => ((i + j) % 4 === 1 ? -1 : (i + j) % 7 === 3 ? 2 : 0));
      setPlanStatus(tx, ctx, plan.id, code, status, to, { completedAt: isoOf(atMs + HOUR_MS) });
    } else if (to === "Inventory Updated") {
      applyCount(w, tx, ctx, spec, plan.id, lines, reasonId);
      setPlanStatus(tx, ctx, plan.id, code, status, to, { inventoryUpdatedAt: isoOf(atMs + 2 * HOUR_MS), inventoryUpdatedBy: ctx.userId });
    } else setPlanStatus(tx, ctx, plan.id, code, status, to);
    status = to;
  }
  if (spec.target === "Count Started") {
    lines.slice(0, Math.ceil(lines.length / 2)).forEach((l) => {
      countLine(tx, counter, l.id, l.locationId, () => 0);
      tx.update(schema.countPlanLines).set({ status: "Count Completed" }).where(eq(schema.countPlanLines.id, l.id)).run();
    });
  }
  if (spec.target === "Cancelled") tx.update(schema.countPlanLines).set({ status: "Cancelled" }).where(eq(schema.countPlanLines.planId, plan.id)).run();
}

function applyCount(w: World, tx: Tx, ctx: DomainCtx, spec: CountSpec, planId: Id, lines: readonly { id: Id; locationId: Id }[], reasonId: Id): void {
  const serial = new Set(w.catalog.products.filter((p) => p.trackSerial).map((p) => p.id));
  lines.forEach((l, i) => {
    const entries = tx.select().from(schema.countLineEntries).where(eq(schema.countLineEntries.lineId, l.id)).all();
    let lineId = l.id;
    if (spec.recount && i === 0 && entries.some((e) => e.countedQty !== e.systemQty)) {
      tx.update(schema.countPlanLines).set({ status: "Recount Created", recounted: true }).where(eq(schema.countPlanLines.id, l.id)).run();
      lineId = insertLine(tx, planId, l.locationId, "Inventory Updated", { isRecountLine: true, recountOfLineId: l.id, note: "Recount requested: variance above 1%." });
      countLine(tx, ctx, lineId, l.locationId, (j) => (j === 0 ? -1 : 0));
    }
    const final = tx.select().from(schema.countLineEntries).where(eq(schema.countLineEntries.lineId, lineId)).all();
    for (const e of final) {
      const bucket = tx.select().from(schema.inventory).where(and(eq(schema.inventory.locationId, e.locationId), eq(schema.inventory.productId, e.productId),
        eq(schema.inventory.packType, e.packType), gt(schema.inventory.onHand, 0))).all().find((b) => b.lotNumber === e.lotNumber && b.lpId === e.lpId && b.damageReason === e.damageReason);
      if (!bucket || e.countedQty === bucket.onHand || e.countedQty < bucket.allocated || serial.has(bucket.productId)) continue;
      ledger.adjustTo(tx, ctx, { inventoryId: bucket.id, targetQty: e.countedQty, type: "Count", adjustmentReasonId: reasonId, refs: { countPlanId: planId, note: "Cycle count variance" } });
    }
    tx.update(schema.countPlanLines).set({ inventoryUpdatedAt: isoOf(Date.now()), inventoryUpdatedBy: ctx.userId })
      .where(and(eq(schema.countPlanLines.planId, planId), eq(schema.countPlanLines.status, "Inventory Updated"))).run();
  });
}

export function scheduleCounts(w: World): number {
  SPECS.forEach((spec, i) => {
    const at = utcAt(spec.daysAgo, spec.daysAgo === 0 ? 14 : 19, 5 * i);
    w.queue.schedule(at, `count ${spec.description}`, () => {
      try {
        txAt(w.env, at, (tx) => runCount(w, tx, spec, at));
      } catch (error) {
        noteFailure(w, `count ${spec.description}`, error);
      }
    });
  });
  return SPECS.length;
}
