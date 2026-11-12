/**
 * Inventory replay: daily dynamic replenishment (reserve -> pick face, ledger Replenishment,
 * with jobs and tasks), inventory adjustments with reasons, damage write-downs, and the
 * nightly inventory snapshots of the last 7 days.
 */
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { asc } from "@/server/db/order";
import * as schema from "@/server/db/schema";
import { changeLog, ledger, putaway, sequences } from "@/server/domain";
import type { DomainCtx, Tx } from "@/server/domain/types";
import { snapshotWarehouse } from "@/server/scheduler/tasks/snapshot";
import type { WarehouseCode } from "../seed-orders";
import { jobTypeKey } from "./config";
import { lookupId } from "./lookups";
import { REPLAY_DAYS } from "./outbound";
import { HOUR_MS, MINUTE_MS, isoOf, utcAt, weekdayOf } from "./runtime";
import { actor, txAt, type Id } from "./types";
import { facilityOf, noteFailure, operatorFor, type World } from "./world";
import { dbGet, forEachSeq } from "@/server/db/sql";

const nextTaskNo = async (tx: Tx): Promise<number> => ((await dbGet<{ n: number | null }>(tx, sql`SELECT MAX(task_no) AS n FROM tasks`))?.n ?? 0) + 1;

interface ReplenMove {
  readonly productId: Id;
  readonly clientId: Id;
  readonly sourceId: Id;
  readonly sourceLocationId: Id;
  readonly targetLocationId: Id;
  readonly qty: number;
  readonly packType: string;
}

async function planMoves(w: World, tx: Tx, code: WarehouseCode): Promise<ReplenMove[]> {
  const fac = facilityOf(w, code);
  const serial = new Set(w.catalog.products.filter((p) => p.trackSerial).map((p) => p.id));
  const out: ReplenMove[] = [];
  for (const t of await putaway.dynamicReplenishmentTargets(tx, fac.id)) {
    const face = fac.pickFaces.get(t.productId);
    if (!face || serial.has(t.productId) || t.targetAvailable >= t.min || t.openTaskQty > 0) continue;
    let need = t.max - t.targetAvailable;
    const sources = await tx.select().from(schema.inventory).where(and(
      eq(schema.inventory.productId, t.productId), eq(schema.inventory.warehouseId, fac.id), eq(schema.inventory.status, "Stock"),
      isNull(schema.inventory.damageReason), gt(sql`${schema.inventory.onHand} - ${schema.inventory.allocated}`, 0), inArray(schema.inventory.locationId, [...fac.reserve]),
    )).orderBy(asc(schema.inventory.expiryDate), asc(schema.inventory.receivedAt));
    for (const s of sources) {
      if (need <= 0) break;
      const qty = Math.min(need, s.onHand - s.allocated);
      out.push({ productId: t.productId, clientId: s.clientId ?? "", sourceId: s.id, sourceLocationId: s.locationId, targetLocationId: face, qty, packType: s.packType });
      need -= qty;
    }
  }
  return out.slice(0, 18);
}

async function runReplenishment(w: World, tx: Tx, code: WarehouseCode, atMs: number, execute: boolean): Promise<void> {
  const moves = await planMoves(w, tx, code);
  if (moves.length === 0) return;
  const fac = facilityOf(w, code);
  const user = operatorFor(w, code, weekdayOf(atMs));
  const ctx: DomainCtx = actor(user);
  const jobTypeId = w.config.jobTypes.get(jobTypeKey(fac.id, "Dynamic Replenishment")) ?? null;
  const units = moves.reduce((s, m) => s + m.qty, 0);
  const job = (await tx.insert(schema.jobs).values({
    id: crypto.randomUUID(), code: await sequences.next(tx, "job"), warehouseId: fac.id, jobType: "Dynamic Replenishment", jobTypeId, operationType: "Replenishment",
    status: execute ? "Started" : "Pending", assignedToUserId: user.id, unitCount: units, ruleName: "Min/Max pick-face replenishment",
    plannedStartAt: isoOf(atMs), plannedEndAt: isoOf(atMs + HOUR_MS), startedAt: execute ? isoOf(atMs) : null, taskCount: moves.length, createdBy: null,
  }).returning())[0];
  await changeLog.recordCreate(tx, ctx, { entityType: "job", entityId: job.id, entityCode: job.code });
  let taskNo = await nextTaskNo(tx);
  await forEachSeq(moves, async (m, i) => {
    const task = (await tx.insert(schema.tasks).values({
      taskNo: taskNo++, jobId: job.id, warehouseId: fac.id, clientId: m.clientId, taskType: "Replenishment", status: "Pending", sequence: i + 1,
      productId: m.productId, packType: m.packType, plannedQty: m.qty, sourceLocationId: m.sourceLocationId, targetLocationId: m.targetLocationId,
      replenishmentPhase: "Direct Put", assigneeUserId: user.id, plannedStartAt: isoOf(atMs), plannedFinishAt: isoOf(atMs + (i + 1) * 4 * MINUTE_MS),
    }).returning({ id: schema.tasks.id }))[0];
    if (!execute) return;
    const product = w.catalog.products.find((p) => p.id === m.productId);
    await ledger.move(tx, ctx, { inventoryId: m.sourceId, qty: m.qty, toLocationId: m.targetLocationId, toLpId: null, toPackType: product?.uom, type: "Replenishment",
      refs: { jobId: job.id, taskId: task.id, algorithmName: "REPLENISHMENT_ALGORITHM", algorithmRuleName: "Replenish assigned pick faces" } });
    const done = isoOf(atMs + (i + 1) * 4 * MINUTE_MS);
    await tx.update(schema.tasks).set({ status: "Completed", actualQty: m.qty, startedAt: isoOf(atMs + i * 4 * MINUTE_MS), finishedAt: done, executedByUserId: user.id })
      .where(eq(schema.tasks.id, task.id));
  });
  if (execute) {
    await tx.update(schema.jobs).set({ status: "Completed", completedAt: isoOf(atMs + moves.length * 4 * MINUTE_MS), completedUnits: units, completedTaskCount: moves.length })
      .where(eq(schema.jobs.id, job.id));
  }
}

export function scheduleReplenishment(w: World): number {
  let n = 0;
  for (let daysAgo = REPLAY_DAYS - 1; daysAgo >= 0; daysAgo -= 1) {
    const at = utcAt(daysAgo, 12, 0);
    const dow = weekdayOf(at);
    if (dow === 0 || dow === 6) continue;
    for (const code of ["MLT1", "KS2"] as const) {
      if (code === "KS2" && dow !== 2 && dow !== 4) continue;
      const execute = daysAgo > 0;
      const when = execute ? at : utcAt(0, 15, 10);
      if (w.queue.schedule(when, `replenish ${code}`, async () => await txAt(w.env, when, async (tx) => await runReplenishment(w, tx, code, when, execute)))) n += 1;
    }
  }
  return n;
}

/* ------------------------------------------------------------ adjustments */

interface AdjustmentPlan {
  readonly daysAgo: number;
  readonly hour: number;
  readonly reason: "Inventory is missing" | "Inventory quantity discrepancy" | "Damage";
  readonly delta: number;
}

const ADJUSTMENTS: readonly AdjustmentPlan[] = [
  { daysAgo: 27, hour: 19, reason: "Inventory quantity discrepancy", delta: -2 },
  { daysAgo: 24, hour: 15, reason: "Damage", delta: 2 },
  { daysAgo: 21, hour: 20, reason: "Inventory is missing", delta: -1 },
  { daysAgo: 17, hour: 14, reason: "Inventory quantity discrepancy", delta: 3 },
  { daysAgo: 13, hour: 18, reason: "Damage", delta: 1 },
  { daysAgo: 10, hour: 16, reason: "Inventory is missing", delta: -3 },
  { daysAgo: 6, hour: 19, reason: "Inventory quantity discrepancy", delta: -1 },
  { daysAgo: 4, hour: 14, reason: "Damage", delta: 3 },
  { daysAgo: 2, hour: 20, reason: "Inventory quantity discrepancy", delta: 2 },
  { daysAgo: 1, hour: 15, reason: "Inventory is missing", delta: -2 },
];

async function adjustOne(w: World, tx: Tx, plan: AdjustmentPlan, index: number): Promise<void> {
  const fac = w.facility.MLT1;
  const ctx = actor(index % 2 === 0 ? w.access.manager : operatorFor(w, "MLT1", index));
  const faces = [...fac.pickFaces.values()];
  const serial = new Set(w.catalog.products.filter((p) => p.trackSerial).map((p) => p.id));
  const candidates = (await tx.select().from(schema.inventory).where(and(inArray(schema.inventory.locationId, faces), eq(schema.inventory.status, "Stock"),
    isNull(schema.inventory.damageReason), gt(sql`${schema.inventory.onHand} - ${schema.inventory.allocated}`, 5))))
    .filter((b) => !serial.has(b.productId));
  const bucket = candidates[(index * 11) % Math.max(1, candidates.length)];
  if (!bucket) return;
  if (plan.reason === "Damage") {
    const moved = await ledger.changeAttributes(tx, ctx, { inventoryId: bucket.id, qty: plan.delta, damageReason: "Warehouse Handling Damage", refs: { note: "Dropped during replenishment; packaging torn." } });
    if (fac.damaged) await ledger.move(tx, ctx, { inventoryId: moved.target.id, qty: plan.delta, toLocationId: fac.damaged, refs: { note: "Moved to damaged cage" } });
    return;
  }
  await ledger.adjustTo(tx, ctx, { inventoryId: bucket.id, targetQty: bucket.onHand + plan.delta, adjustmentReasonId: lookupId(w.lookups, "adjustment_reason", plan.reason),
    refs: { note: plan.delta < 0 ? "Short on bin audit" : "Found during bin audit" } });
}

export function scheduleAdjustments(w: World): number {
  ADJUSTMENTS.forEach((plan, i) => {
    const at = utcAt(plan.daysAgo, plan.hour, 10 + i);
    w.queue.schedule(at, `adjust ${i}`, async () => {
      try {
        await txAt(w.env, at, async (tx) => await adjustOne(w, tx, plan, i));
      } catch (error) {
        noteFailure(w, `adjust ${i}`, error);
      }
    });
  });
  return ADJUSTMENTS.length;
}

/* -------------------------------------------------------------- snapshots */

/** Nightly snapshots at 00:02 Louisville time for the last 7 nights. */
export function scheduleSnapshots(w: World): number {
  let n = 0;
  for (let daysAgo = 6; daysAgo >= 0; daysAgo -= 1) {
    const at = utcAt(daysAgo, 5, 2);
    if (w.queue.schedule(at, "snapshot", async () => await txAt(w.env, at, async (tx) => {
      for (const fac of [w.facility.MLT1, w.facility.KS2]) await snapshotWarehouse(tx, fac.id, isoOf(at));
    }))) n += 1;
  }
  return n;
}
