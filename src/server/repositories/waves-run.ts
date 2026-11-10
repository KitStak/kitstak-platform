/**
 * Wave execution engine (BUILD_PLAN M03 §3):
 *   1. wave `<ruleSeq>-<runCount>`, Pending → Started → Completed | Failed;
 *   2. select orders by the rule filters, sort by its order-by;
 *   3. match job types in precedence order (unmatched → "Eliminated by Job Type …" exception);
 *   4. allocation.allocateOrders per job type (its algorithm), then jobs.createJobsFromOrders;
 *   5. wave log counts with the invariant met = allocated + shortage.
 * Cycle Count, Replenishment and Order Merge rules have their own branches.
 */
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { jobTypeSettingsSchema, parseSettings, type FilterCondition, type JobTypeSettings } from "@/lib/domain-types";
import type { Priority } from "@/lib/enums";
import type { AppDb } from "@/server/api/db";
import { AppError } from "@/server/api/errors";
import * as schema from "@/server/db/schema";
import { allocation, jobs as jobsDomain, notify, stateMachines } from "@/server/domain";
import { recordUpdate } from "@/server/domain/change-log";
import { evaluateFilters, type Facts } from "@/server/domain/conditions";
import { describeError } from "@/server/domain/errors";
import { orderFacts, sortByClauses, type OrderLineRow, type OrderRow } from "@/server/domain/facts";
import { orderUnits } from "@/server/domain/jobs";
import { waveNumber } from "@/server/domain/sequences";
import { createReplenishmentJob } from "@/server/domain/task-handlers/replenishment";
import type { DomainCtx } from "@/server/domain/types";
import { createCountPlanFromWave } from "./counts-commands";
import { loadWaveRule, stampRun, type WaveRuleRow } from "./wave-rules";

type JobTypeRow = typeof schema.jobTypes.$inferSelect;
export type WaveRow = typeof schema.waves.$inferSelect;

export interface WaveRunResult {
  readonly wave: WaveRow;
  readonly ruleName: string;
  readonly jobIds: readonly string[];
  readonly summary: string;
}

export interface RunOptions {
  /** Display name stored in Run By: the user's name, or "Integration" for the scheduler. */
  readonly runBy: string;
  readonly now?: Date;
  /** Users to notify (defaults to the actor). */
  readonly notifyUserIds?: readonly string[];
}

const ELIGIBLE_STATUSES = ["Open", "Shortage"] as const;

/** Facts the generic order facts do not carry (Is Partial, Number of Boxes). */
function waveFacts(db: AppDb, order: OrderRow, lines: readonly OrderLineRow[]): Facts {
  const base = orderFacts(db, order, lines);
  const boxes = db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM shipments WHERE order_id = ${order.id} AND label_status = 'Active'`)?.n ?? 0;
  return { ...base, isPartial: lines.some((l) => l.allocatedQuantity > 0 && l.allocatedQuantity < l.quantity - l.cancelledQuantity), numberOfBoxes: Number(boxes) };
}

interface Candidate { readonly order: OrderRow; readonly lines: readonly OrderLineRow[]; readonly facts: Facts }

export function selectCandidates(db: AppDb, rule: Pick<WaveRuleRow, "warehouseId" | "filters" | "orderBy">, now: Date): Candidate[] {
  const orders = db.select().from(schema.shipmentOrders).where(and(
    eq(schema.shipmentOrders.warehouseId, rule.warehouseId), inArray(schema.shipmentOrders.status, [...ELIGIBLE_STATUSES]),
    isNull(schema.shipmentOrders.jobId), isNull(schema.shipmentOrders.deletedAt), ne(schema.shipmentOrders.workflowBlocked, "Fully"),
    isNull(schema.shipmentOrders.mergedIntoOrderId),
  )).all();
  const cands = orders.map((order) => {
    const lines = db.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, order.id)).all();
    return { order, lines, facts: waveFacts(db, order, lines) };
  }).filter((c) => orderUnits(c.lines) > 0 && evaluateFilters(rule.filters as FilterCondition[], c.facts, now));
  return sortByClauses(cands, rule.orderBy, (c) => c.facts);
}

/** Order scope + conditions of a picking job type (mirrors `domain/jobs` eligibility). */
export function matchesJobType(cand: Candidate, settings: JobTypeSettings, conditions: readonly FilterCondition[], now: Date): boolean {
  const units = orderUnits(cand.lines);
  if (settings.orderScope === "Single Item Orders" && units !== 1) return false;
  if (settings.orderScope === "Multi-Item Orders" && units < 2) return false;
  return evaluateFilters(conditions, cand.facts, now);
}

export const eliminatedByJobTypes = (codes: readonly string[]): string => `Eliminated by Job Type '${codes.join("', '")}' Condition(s)`;

/**
 * Adapter: writes a job-type elimination row. `allocation_exceptions` is foundation-owned;
 * docs/requests/fulfillment-jobs.md REQ-2 asks for `allocation.recordException()`.
 */
function recordElimination(db: AppDb, wave: WaveRow, rule: WaveRuleRow, order: OrderRow, codes: readonly string[], runBy: string): void {
  db.insert(schema.allocationExceptions).values({
    orderId: order.id, waveId: wave.id, waveNo: wave.waveNo, waveRuleName: rule.name, algorithmName: null, algorithmRuleName: null,
    explanation: eliminatedByJobTypes(codes), runBy, warehouseId: order.warehouseId, clientId: order.clientId,
  }).run();
}

function setWaveStatus(db: AppDb, wave: WaveRow, status: WaveRow["status"], patch: Partial<typeof schema.waves.$inferInsert> = {}): WaveRow {
  const next = stateMachines.wave.transition(wave.status, status);
  return db.update(schema.waves).set({ status: next, ...patch }).where(eq(schema.waves.id, wave.id)).returning().get();
}

function assigneesFor(db: AppDb, rule: WaveRuleRow): string[] {
  if (rule.assignMode === "Users") return [...(rule.assigneeUserIds ?? [])];
  return [];
}

function stampJobs(db: AppDb, ctx: DomainCtx, rule: WaveRuleRow, jobIds: readonly string[]): void {
  if (jobIds.length === 0) return;
  db.update(schema.jobs).set({ ruleName: rule.name, waveRuleId: rule.id }).where(inArray(schema.jobs.id, [...jobIds])).run();
  const users = assigneesFor(db, rule);
  if (users.length > 1) jobIds.forEach((id, i) => jobsDomain.assign(db, ctx, { jobIds: [id], userId: users[i % users.length] as string }));
}

function runPicking(db: AppDb, ctx: DomainCtx, rule: WaveRuleRow, wave: WaveRow, opts: RunOptions, now: Date) {
  const cands = selectCandidates(db, rule, now);
  const types = rule.jobTypeIds.flatMap((id) => db.select().from(schema.jobTypes).where(eq(schema.jobTypes.id, id)).all())
    .filter((t) => t.isActive).map((t) => ({ type: t, settings: parseSettings(jobTypeSettingsSchema, t.settings) }));
  const groups = new Map<string, { type: JobTypeRow; orders: string[] }>();
  let eliminated = 0;
  for (const cand of cands) {
    const hit = types.find((t) => matchesJobType(cand, t.settings, t.type.conditions, now));
    if (!hit) {
      recordElimination(db, wave, rule, cand.order, types.map((t) => t.type.code), opts.runBy);
      eliminated += 1;
      continue;
    }
    const group = groups.get(hit.type.id) ?? { type: hit.type, orders: [] };
    group.orders.push(cand.order.id);
    groups.set(hit.type.id, group);
  }
  const users = assigneesFor(db, rule);
  let allocated = 0;
  const jobIds: string[] = [];
  for (const { type, orders } of groups.values()) {
    const res = allocation.allocateOrders(db, ctx, {
      orderIds: orders, warehouseId: rule.warehouseId, algorithmId: type.allocationAlgorithmId, waveId: wave.id, waveNo: wave.waveNo,
      waveRuleName: rule.name, runBy: opts.runBy,
    });
    allocated += res.allocated.length;
    if (res.allocated.length === 0) continue;
    const created = jobsDomain.createJobsFromOrders(db, ctx, {
      orderIds: res.allocated, jobTypeId: type.id, waveId: wave.id, waveNo: wave.waveNo, priority: rule.priority as Priority,
      assigneeUserId: users.length === 1 ? users[0] : null, now,
    });
    jobIds.push(...created.jobIds);
  }
  stampJobs(db, ctx, rule, jobIds);
  const met = cands.length;
  return { met, allocated, shortage: met - allocated, jobIds, merged: 0, message: eliminated > 0 ? `${eliminated} orders eliminated by job type conditions` : null };
}

function runReplenishment(db: AppDb, ctx: DomainCtx, rule: WaveRuleRow, wave: WaveRow, now: Date) {
  const jobTypeId = rule.jobTypeIds[0];
  if (!jobTypeId) throw new AppError("VALIDATION", "The rule has no replenishment job type.");
  const users = assigneesFor(db, rule);
  const res = createReplenishmentJob(db, ctx, {
    warehouseId: rule.warehouseId, jobTypeId, waveId: wave.id, waveNo: wave.waveNo, ruleName: rule.name, waveRuleId: rule.id,
    priority: rule.priority as Priority, assigneeUserId: users[0] ?? null, now,
  });
  const skipped = res.skipped.length > 0 ? ` · ${res.skipped.length} SKUs skipped (${res.skipped.slice(0, 3).map((s) => `${s.sku}: ${s.reason}`).join("; ")})` : "";
  return { met: 0, allocated: 0, shortage: 0, jobIds: res.jobId ? [res.jobId] : [], merged: 0, message: `${res.taskCount} replenishment tasks created${skipped}` };
}

function runCycleCount(db: AppDb, ctx: DomainCtx, rule: WaveRuleRow, wave: WaveRow) {
  const res = createCountPlanFromWave(db, ctx, {
    warehouseId: rule.warehouseId, waveId: wave.id, waveRuleId: rule.id, countType: rule.countType ?? "Location",
    lockLocations: rule.lockLocations, assigneeUserIds: assigneesFor(db, rule),
  });
  stampJobs(db, ctx, rule, res.jobIds);
  return { met: 0, allocated: 0, shortage: 0, jobIds: res.jobIds, merged: 0, message: `Count plan ${res.code} created with ${res.lineCount} lines` };
}

interface MergeRuleMeta { readonly criteria?: readonly string[] }

/**
 * Order merge (contract documented on `domain/orders.unmergeOrder`): children go On Hold with
 * `mergedIntoOrderId` = master and their lines are copied onto the master with
 * `originalOrderCode`. Adapter until REQ-3 (`orders.mergeOrders`) lands in the domain.
 */
function runOrderMerge(db: AppDb, ctx: DomainCtx, rule: WaveRuleRow, now: Date) {
  const rules = (rule.mergeRuleIds ?? []).flatMap((id) => db.select().from(schema.lookupValues).where(eq(schema.lookupValues.id, id)).all());
  let pool = selectCandidates(db, rule, now).filter((c) => c.order.status === "Open" && !c.order.isMerged);
  const met = pool.length;
  let merged = 0;
  for (const mr of rules) {
    const criteria = ((mr.meta as MergeRuleMeta | null)?.criteria ?? ["client", "customerName", "shipAddress", "shipZip"]).filter(Boolean);
    const groups = new Map<string, Candidate[]>();
    for (const c of pool) {
      const key = criteria.map((k) => String((c.order as Record<string, unknown>)[k === "client" ? "clientId" : k] ?? "").trim().toLowerCase()).join("|");
      if (key.replace(/\|/g, "") === "") continue;
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    const used = new Set<string>();
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const [master, ...children] = [...group].sort((a, b) => a.order.orderDate.localeCompare(b.order.orderDate));
      for (const child of children) {
        for (const line of child.lines) {
          db.insert(schema.orderLines).values({
            orderId: master.order.id, productId: line.productId, quantity: line.quantity - line.cancelledQuantity, unitPrice: line.unitPrice,
            packType: line.packType, uomRatio: line.uomRatio, lotNumber: line.lotNumber, expiryDate: line.expiryDate, originalOrderCode: child.order.code,
            createdBy: ctx.userId, updatedBy: ctx.userId,
          }).run();
        }
        const status = stateMachines.shipmentOrder.transition(child.order.status, "On Hold");
        db.update(schema.shipmentOrders).set({ status, mergedIntoOrderId: master.order.id, updatedBy: ctx.userId, version: sql`${schema.shipmentOrders.version} + 1` }).where(eq(schema.shipmentOrders.id, child.order.id)).run();
        recordUpdate(db, ctx, { entityType: "shipment_order", entityId: child.order.id, entityCode: child.order.code, before: { status: child.order.status, mergedIntoOrderId: null }, after: { status, mergedIntoOrderId: master.order.code } });
        used.add(child.order.id);
        merged += 1;
      }
      const units = db.get<{ q: number }>(sql`SELECT COALESCE(SUM(quantity - cancelled_quantity), 0) AS q FROM order_lines WHERE order_id = ${master.order.id}`)?.q ?? 0;
      db.update(schema.shipmentOrders).set({ isMerged: true, totalQuantity: Number(units), updatedBy: ctx.userId }).where(eq(schema.shipmentOrders.id, master.order.id)).run();
      recordUpdate(db, ctx, { entityType: "shipment_order", entityId: master.order.id, entityCode: master.order.code, before: { isMerged: false }, after: { isMerged: true } });
      used.add(master.order.id);
    }
    pool = pool.filter((c) => !used.has(c.order.id));
  }
  return { met, allocated: 0, shortage: 0, jobIds: [] as string[], merged, message: merged > 0 ? `${merged} orders merged` : "No orders to merge" };
}

export function summarize(wave: Pick<WaveRow, "waveNo" | "ordersMet" | "allocatedOrders" | "jobsCreated" | "shortageOrders" | "mergedOrders" | "status" | "message">, op: string): string {
  if (wave.status === "Failed") return `Wave ${wave.waveNo} failed: ${wave.message ?? "unknown error"}`;
  if (op === "Order Merge") return `Wave ${wave.waveNo} completed: ${wave.ordersMet} met · ${wave.mergedOrders} merged`;
  if (op === "Replenishment" || op === "Cycle Count") return `Wave ${wave.waveNo} completed: ${wave.jobsCreated} jobs · ${wave.message ?? ""}`;
  return `Wave ${wave.waveNo} completed: ${wave.ordersMet} met · ${wave.allocatedOrders} allocated · ${wave.jobsCreated} jobs · ${wave.shortageOrders} shortage`;
}

/** Runs one rule now. The caller owns the transaction. */
export function runWave(db: AppDb, ctx: DomainCtx, ruleId: string, opts: RunOptions): WaveRunResult {
  const now = opts.now ?? new Date();
  const rule = loadWaveRule(db, null, ruleId);
  if (ctx.scope && !ctx.scope.warehouseIds.includes(rule.warehouseId)) throw new AppError("NOT_FOUND", "Wave rule not found");
  const waveNo = waveNumber(rule.ruleSeq, rule.runCount + 1);
  let wave = db.insert(schema.waves).values({ waveNo, waveRuleId: rule.id, warehouseId: rule.warehouseId, status: "Pending", runBy: opts.runBy, runAt: now.toISOString() }).returning().get();
  wave = setWaveStatus(db, wave, "Started");
  let jobIds: readonly string[] = [];
  try {
    const out = db.transaction((tx) => {
      switch (rule.operationType) {
        case "Picking":
        case "AI Job":
          return runPicking(tx, ctx, rule, wave, opts, now);
        case "Replenishment":
          return runReplenishment(tx, ctx, rule, wave, now);
        case "Cycle Count":
          return runCycleCount(tx, ctx, rule, wave);
        case "Order Merge":
          return runOrderMerge(tx, ctx, rule, now);
      }
    });
    jobIds = out.jobIds;
    wave = setWaveStatus(db, wave, "Completed", {
      ordersMet: out.met, allocatedOrders: out.allocated, shortageOrders: out.shortage, jobsCreated: out.jobIds.length, mergedOrders: out.merged,
      message: out.message, finishedAt: new Date().toISOString(),
    });
  } catch (error) {
    wave = setWaveStatus(db, wave, "Failed", { message: describeError(error).message.slice(0, 500), finishedAt: new Date().toISOString() });
  }
  stampRun(db, ctx, rule, waveNo, opts.runBy, now);
  const summary = summarize(wave, rule.operationType);
  const recipients = opts.notifyUserIds ?? (ctx.userId ? [ctx.userId] : []);
  if (recipients.length > 0) {
    notify(db, recipients, {
      kind: "wave.completed", title: wave.status === "Failed" ? `Wave ${waveNo} failed` : `Wave ${waveNo} completed`, body: `${rule.name}: ${summary}`,
      href: `/jobs/wave-log?q=${encodeURIComponent(waveNo)}&qm=eq`, severity: wave.status === "Failed" ? "error" : "success",
    });
  }
  return { wave, ruleName: rule.name, jobIds, summary };
}
