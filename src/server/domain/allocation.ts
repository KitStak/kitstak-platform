/**
 * Order allocation (BUILD_PLAN F5 `allocation.ts`).
 *
 * Rules of the warehouse's active Allocation algorithm are evaluated in If / If-else order:
 *   1. order conditions select the rule (first match wins);
 *   2. inventory conditions filter the candidate buckets;
 *   3. order-by ranks the rest (default FEFO).
 * Misses are written to `order_line_shortages` and `allocation_exceptions` with the Logiwa
 * explanation strings.
 */
import { and, asc, eq, gt, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { OrderByClause, RuleCondition } from "@/lib/domain-types";
import * as schema from "@/server/db/schema";
import { recordLine, recordUpdate } from "./change-log";
import { evaluateConditions } from "./conditions";
import { DomainError, describeError } from "./errors";
import { bucketFacts, orderFacts, sortByClauses, type OrderLineRow, type OrderRow } from "./facts";
import { planFullLps, rankByPackType, splitAllocationPreferences } from "./allocation-preferences";
import { allocate, releaseAllocation } from "./ledger/allocations";
import { notCountLocked } from "./ledger/count-locks";
import { ACTIVE_ALLOCATION_STATUSES, type InventoryRow } from "./ledger/bucket";
import type { LocationRow } from "./ledger/rules";
import { stateMachines } from "./state-machines";
import { orderTypeFlags } from "./so-type-flags";
// Runtime-only use (inside allocateOne), so the orders ⇄ allocation module cycle is safe.
import { createBackorder } from "./orders/commands";
import { checkScope, nowIso, type BulkResult, type DomainCtx, type Tx } from "./types";

export { evaluateConditions } from "./conditions";

export const MANUAL_ALLOCATION = "Manual Allocation";
export const EXPLANATION_SHORTAGE = "Shortage";
export const EXPLANATION_OUT_OF_STOCK = "Order bypassed: All items are currently out of stock";
export const eliminatedBy = (ruleNames: readonly string[]): string => `Eliminated by '${ruleNames.join("', '")}' Condition(s)`;

export interface AllocationRule {
  readonly name: string;
  readonly conditions: readonly RuleCondition[];
  readonly inventoryConditions: readonly RuleCondition[];
  readonly orderBy: readonly OrderByClause[];
}

export const DEFAULT_ALLOCATION_RULE: AllocationRule = {
  name: "Default",
  conditions: [],
  inventoryConditions: [
    { field: "inventoryDamageReason", comparator: "isEmpty", value: null },
    { field: "isAllowOnlyDamaged", comparator: "equals", value: false },
  ],
  orderBy: [
    { field: "inventoryExpiryDate", dir: "asc" },
    { field: "inventoryReceivingDate", dir: "asc" },
    { field: "walkingPathPriority", dir: "asc" },
  ],
};

export interface LoadedAlgorithm {
  readonly id: string | null;
  readonly name: string;
  readonly rules: readonly AllocationRule[];
}

export function loadAllocationAlgorithm(tx: Tx, warehouseId: string, algorithmId?: string | null): LoadedAlgorithm {
  const a = schema.algorithms;
  const algo = algorithmId
    ? tx.select().from(a).where(eq(a.id, algorithmId)).get()
    : tx.select().from(a).where(and(eq(a.warehouseId, warehouseId), eq(a.kind, "Allocation"), eq(a.status, "Active"))).orderBy(asc(a.createdAt)).get();
  if (algorithmId && (!algo || algo.kind !== "Allocation")) throw new DomainError("NOT_FOUND", "Allocation algorithm not found");
  if (!algo) return { id: null, name: "Default", rules: [DEFAULT_ALLOCATION_RULE] };
  const rules = tx.select().from(schema.algorithmRules)
    .where(and(eq(schema.algorithmRules.algorithmId, algo.id), eq(schema.algorithmRules.isActive, true)))
    .orderBy(asc(schema.algorithmRules.sequence)).all()
    .map((r) => ({ name: r.name, conditions: r.conditions, inventoryConditions: r.inventoryConditions ?? [], orderBy: r.orderBy.length > 0 ? r.orderBy : DEFAULT_ALLOCATION_RULE.orderBy }));
  return { id: algo.id, name: algo.name, rules: rules.length > 0 ? rules : [DEFAULT_ALLOCATION_RULE] };
}

interface Candidate { readonly bucket: InventoryRow; readonly location: LocationRow; readonly lpNumber: string | null }

function candidates(tx: Tx, order: OrderRow, line: OrderLineRow, excludeLocationIds: readonly string[] = []): Candidate[] {
  const i = schema.inventory;
  const l = schema.locations;
  const conds = [
    eq(i.warehouseId, order.warehouseId), eq(i.clientId, order.clientId), eq(i.productId, line.productId), eq(i.status, "Stock"),
    gt(sql`${i.onHand} - ${i.allocated}`, 0), eq(l.isActive, true), eq(l.isLocked, false), eq(l.preventAllocation, false), isNull(i.damageReason),
    notCountLocked(l.id),
  ];
  if (line.lotNumber) conds.push(eq(i.lotNumber, line.lotNumber));
  if (line.expiryDate) conds.push(eq(i.expiryDate, line.expiryDate));
  if (line.productionDate) conds.push(eq(i.productionDate, line.productionDate));
  if (line.pinnedLocationId) conds.push(eq(i.locationId, line.pinnedLocationId));
  if (line.pinnedLpId) conds.push(eq(i.lpId, line.pinnedLpId));
  if (excludeLocationIds.length > 0) conds.push(notInArray(i.locationId, [...excludeLocationIds]));
  return tx.select({ bucket: i, location: l, lpNumber: schema.licensePlates.number }).from(i)
    .innerJoin(l, eq(l.id, i.locationId)).leftJoin(schema.licensePlates, eq(schema.licensePlates.id, i.lpId))
    .where(and(...conds)).all();
}

const remainingNeed = (line: OrderLineRow): number => line.quantity - line.cancelledQuantity - line.allocatedQuantity;

interface PlannedSlice { readonly line: OrderLineRow; readonly inventoryId: string; readonly qty: number }
interface LinePlan { readonly line: OrderLineRow; readonly need: number; readonly slices: readonly PlannedSlice[]; readonly short: number }

function planLine(tx: Tx, order: OrderRow, line: OrderLineRow, rule: AllocationRule, used: Map<string, number>, exclude: readonly string[] = []): LinePlan {
  const need = remainingNeed(line);
  // Pack-type / full-LP preferences are line-dependent, so they are split from the bucket filters (M12).
  const { conditions: filters, prefs } = splitAllocationPreferences(rule.inventoryConditions);
  const eligible = candidates(tx, order, line, exclude)
    .filter((c) => evaluateConditions(filters, bucketFacts(c.bucket, c.location, c.lpNumber)));
  const ranked = rankByPackType(tx, line, sortByClauses(eligible, rule.orderBy, (c) => bucketFacts(c.bucket, c.location, c.lpNumber)), prefs);
  const slices: PlannedSlice[] = [];
  if (prefs.onlyAllocateFullLps) {
    let taken = 0;
    for (const s of planFullLps(tx, line, ranked, need, used)) {
      used.set(s.candidate.bucket.id, (used.get(s.candidate.bucket.id) ?? 0) + s.qty);
      slices.push({ line, inventoryId: s.candidate.bucket.id, qty: s.qty });
      taken += s.qty;
    }
    return { line, need, slices, short: need - taken };
  }
  let left = need;
  for (const c of ranked) {
    if (left <= 0) break;
    const free = c.bucket.onHand - c.bucket.allocated - (used.get(c.bucket.id) ?? 0);
    if (free <= 0) continue;
    const take = Math.min(free, left);
    used.set(c.bucket.id, (used.get(c.bucket.id) ?? 0) + take);
    slices.push({ line, inventoryId: c.bucket.id, qty: take });
    left -= take;
  }
  return { line, need, slices, short: left };
}

/** Free undamaged stock of a product in the warehouse, ignoring rule filters. */
function stockSummary(tx: Tx, order: OrderRow, productId: string): { free: number; damaged: number; onHand: number } {
  const i = schema.inventory;
  const row = tx.select({
    onHand: sql<number>`COALESCE(SUM(${i.onHand}), 0)`,
    damaged: sql<number>`COALESCE(SUM(${i.damaged}), 0)`,
    free: sql<number>`COALESCE(SUM(CASE WHEN ${i.status} = 'Stock' AND ${i.damageReason} IS NULL THEN ${i.onHand} - ${i.allocated} ELSE 0 END), 0)`,
  }).from(i).where(and(eq(i.warehouseId, order.warehouseId), eq(i.clientId, order.clientId), eq(i.productId, productId))).get();
  return { free: Number(row?.free ?? 0), damaged: Number(row?.damaged ?? 0), onHand: Number(row?.onHand ?? 0) };
}

export interface AllocateOrdersInput {
  readonly orderIds: readonly string[];
  readonly warehouseId: string;
  readonly algorithmId?: string | null;
  readonly waveId?: string | null;
  readonly waveNo?: string | null;
  readonly waveRuleName?: string | null;
  /** Display name of who ran it; defaults to ctx.source. */
  readonly runBy?: string;
  /** "full" (default): an order is allocated only when every line can be; "partial" keeps what fits. */
  readonly mode?: "full" | "partial";
}

export interface AllocateOrdersResult extends BulkResult {
  readonly allocated: readonly string[];
  readonly shortage: readonly string[];
  readonly exceptions: number;
}

interface RunInfo { readonly input: AllocateOrdersInput; readonly algo: LoadedAlgorithm; readonly runBy: string; readonly waveNo: string }

function writeException(tx: Tx, run: RunInfo, order: OrderRow, explanation: string, rule: string | null, extra: { productId?: string; inventoryQty?: number; lineQty?: number } = {}): void {
  tx.insert(schema.allocationExceptions).values({
    orderId: order.id, waveId: run.input.waveId ?? null, waveNo: run.waveNo, waveRuleName: run.input.waveRuleName ?? null,
    algorithmName: run.algo.name, algorithmRuleName: rule, shortageProductId: extra.productId ?? null,
    inventoryUomQty: extra.inventoryQty ?? null, orderLineQty: extra.lineQty ?? null, explanation,
    runBy: run.runBy, warehouseId: order.warehouseId, clientId: order.clientId,
  }).run();
}

export interface RecordExceptionInput {
  readonly orderId: string;
  readonly warehouseId: string;
  readonly clientId: string | null;
  readonly waveId: string | null;
  readonly waveNo: string;
  readonly waveRuleName: string | null;
  readonly explanation: string;
  readonly runBy: string;
  readonly algorithmName?: string | null;
  readonly algorithmRuleName?: string | null;
}

/**
 * Writes one `allocation_exceptions` row (same shape `allocateOrders` writes), e.g. wave
 * execution's "Eliminated by Job Type '…' Condition(s)" (docs/requests/fulfillment-jobs.md REQ-2).
 */
export function recordException(tx: Tx, input: RecordExceptionInput): void {
  if (!input.clientId) throw new DomainError("VALIDATION", "An allocation exception needs the order's client.");
  tx.insert(schema.allocationExceptions).values({
    orderId: input.orderId, waveId: input.waveId, waveNo: input.waveNo, waveRuleName: input.waveRuleName,
    algorithmName: input.algorithmName ?? null, algorithmRuleName: input.algorithmRuleName ?? null,
    explanation: input.explanation, runBy: input.runBy, warehouseId: input.warehouseId, clientId: input.clientId,
  }).run();
}

export const MANUAL_ALLOCATION_WORK_ORDER = "Manual Allocation - Work Order";
export const WORK_ORDER_ALGORITHM_NAME = "Work order components";

export interface RecordWorkOrderExceptionInput {
  readonly workOrder: { readonly id: string; readonly warehouseId: string; readonly clientId: string };
  readonly productId: string;
  readonly inventoryQty: number;
  readonly requiredQty: number;
  /** Defaults to "Manual Allocation - Work Order". */
  readonly waveNo?: string;
  readonly explanation: string;
}

/** Short-component row for work-order allocation (docs/requests/work-orders-kitting.md REQ-2). */
export function recordWorkOrderException(tx: Tx, ctx: DomainCtx, input: RecordWorkOrderExceptionInput): void {
  tx.insert(schema.allocationExceptions).values({
    orderId: input.workOrder.id, waveId: null, waveNo: input.waveNo || MANUAL_ALLOCATION_WORK_ORDER, waveRuleName: null,
    algorithmName: WORK_ORDER_ALGORITHM_NAME, algorithmRuleName: null, shortageProductId: input.productId,
    inventoryUomQty: input.inventoryQty, orderLineQty: input.requiredQty, explanation: input.explanation,
    runBy: ctx.source, warehouseId: input.workOrder.warehouseId, clientId: input.workOrder.clientId,
  }).run();
}

function setOrderStatus(tx: Tx, ctx: DomainCtx, order: OrderRow, status: OrderRow["status"]): void {
  if (order.status === status) return;
  const next = stateMachines.shipmentOrder.transition(order.status, status);
  const after = tx.update(schema.shipmentOrders).set({ status: next, updatedBy: ctx.userId, version: sql`${schema.shipmentOrders.version} + 1` })
    .where(eq(schema.shipmentOrders.id, order.id)).returning().get();
  recordUpdate(tx, ctx, { entityType: "shipment_order", entityId: order.id, entityCode: order.code, before: { status: order.status }, after: { status: after.status } });
}

/** Logs "SKU -> Allocated Qty is modified. a --> b" on the order (REQ-R4-1, Logiwa AllocatedUOMQuantity). */
function logLineAllocation(tx: Tx, ctx: DomainCtx, order: OrderRow, lineId: string, before: number, after: number): void {
  if (before === after) return;
  const row = tx.select({ sku: schema.products.sku }).from(schema.orderLines)
    .innerJoin(schema.products, eq(schema.products.id, schema.orderLines.productId)).where(eq(schema.orderLines.id, lineId)).get();
  recordLine(tx, ctx, { entityType: "shipment_order", entityId: order.id, entityCode: order.code, lineEntityType: "order_line",
    lineEntityId: lineId, lineLabel: row?.sku ?? "Line", field: "allocatedQuantity", from: before, to: after });
}

/** Commits planned slices: allocation rows, ledger Allocation txns, line allocated qty. */
function commitSlices(tx: Tx, ctx: DomainCtx, order: OrderRow, slices: readonly PlannedSlice[], meta: { algorithmId: string | null; algorithmName: string; ruleName: string; waveId?: string | null; jobId?: string | null }): void {
  const perLine = new Map<string, number>();
  for (const s of slices) {
    allocate(tx, ctx, {
      inventoryId: s.inventoryId, qty: s.qty, orderId: order.id, orderLineId: s.line.id, algorithmId: meta.algorithmId,
      ruleName: meta.ruleName, waveId: meta.waveId, jobId: meta.jobId, refs: { algorithmName: meta.algorithmName, algorithmRuleName: meta.ruleName },
    });
    perLine.set(s.line.id, (perLine.get(s.line.id) ?? 0) + s.qty);
  }
  for (const [lineId, qty] of perLine) {
    const row = tx.update(schema.orderLines).set({ allocatedQuantity: sql`${schema.orderLines.allocatedQuantity} + ${qty}`, updatedBy: ctx.userId })
      .where(eq(schema.orderLines.id, lineId)).returning({ q: schema.orderLines.allocatedQuantity }).get();
    if (row) logLineAllocation(tx, ctx, order, lineId, row.q - qty, row.q);
  }
}

function recordShortages(tx: Tx, run: RunInfo, order: OrderRow, plans: readonly LinePlan[], ruleName: string): void {
  const now = nowIso();
  const summaries = plans.map((p) => ({ plan: p, stock: stockSummary(tx, order, p.line.productId) }));
  if (summaries.every((s) => s.stock.free <= 0)) writeException(tx, run, order, EXPLANATION_OUT_OF_STOCK, ruleName);
  for (const { plan, stock } of summaries) {
    if (plan.short <= 0) continue;
    const reason = stock.free < plan.need ? "Insufficient Inventory" : "No Eligible Stock Found";
    // Logiwa's "Missing triggered": a pick-short (missing log) on this order + product led here.
    const missingTriggered = Boolean(tx.select({ id: schema.missingLog.id }).from(schema.missingLog)
      .where(and(eq(schema.missingLog.orderId, order.id), eq(schema.missingLog.productId, plan.line.productId))).limit(1).get());
    const values = {
      orderId: order.id, orderLineId: plan.line.id, reason, missingTriggered, shortageQty: plan.short, freeQty: Math.max(0, stock.free),
      damagedQty: stock.damaged, onHandQty: stock.onHand, lastTrialAt: now, resolvedAt: null,
    } as const;
    tx.insert(schema.orderLineShortages).values(values)
      .onConflictDoUpdate({ target: schema.orderLineShortages.orderLineId, set: values }).run();
    writeException(tx, run, order, EXPLANATION_SHORTAGE, ruleName, { productId: plan.line.productId, inventoryQty: Math.max(0, stock.free), lineQty: plan.need });
  }
}

function resolveShortages(tx: Tx, orderId: string): void {
  tx.update(schema.orderLineShortages).set({ resolvedAt: nowIso() })
    .where(and(eq(schema.orderLineShortages.orderId, orderId), isNull(schema.orderLineShortages.resolvedAt))).run();
}

type OrderOutcome = "allocated" | "shortage";

function allocateOne(tx: Tx, ctx: DomainCtx, run: RunInfo, orderId: string): OrderOutcome {
  const order = tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, orderId)).get();
  if (!order || order.deletedAt) throw new DomainError("NOT_FOUND", "Shipment order not found");
  checkScope(ctx, order, "Shipment order");
  if (order.warehouseId !== run.input.warehouseId) throw new DomainError("VALIDATION", `Order ${order.code} belongs to another warehouse.`);
  if (order.status !== "Open" && order.status !== "Shortage") {
    throw new DomainError("INVALID_STATE", `Order ${order.code} is ${order.status}; only Open or Shortage orders can be allocated.`);
  }
  if (order.workflowBlocked === "Fully") throw new DomainError("INVALID_STATE", `Order ${order.code} is blocked by a workflow.`);
  const lines = tx.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, order.id)).all().filter((l) => remainingNeed(l) > 0);
  const facts = orderFacts(tx, order);
  const rule = run.algo.rules.find((r) => evaluateConditions(r.conditions, facts));
  if (!rule) {
    writeException(tx, run, order, eliminatedBy(run.algo.rules.map((r) => r.name)), null);
    if (order.status === "Open") setOrderStatus(tx, ctx, order, "Shortage");
    return "shortage";
  }
  const used = new Map<string, number>();
  const plans = lines.map((line) => planLine(tx, order, line, rule, used));
  const short = plans.some((p) => p.short > 0);
  const meta = { algorithmId: run.algo.id, algorithmName: run.algo.name, ruleName: rule.name, waveId: run.input.waveId };
  // Shipment Order Type: "Allow partial allocation" / "Create back order" keep what is available.
  const typeFlags = orderTypeFlags(tx, order.orderTypeId);
  const keepPartial = run.input.mode === "partial" || typeFlags.has("allowPartialAllocation") || typeFlags.has("createBackOrder");
  const slices = plans.flatMap((p) => p.slices);
  if (!short || keepPartial) commitSlices(tx, ctx, order, slices, meta);
  if (short) {
    recordShortages(tx, run, order, plans, rule.name);
    setOrderStatus(tx, ctx, order, "Shortage");
    // "Create back order": the short quantity moves to <code>-BO<n>; the order itself is released to picking.
    if (typeFlags.has("createBackOrder") && slices.length > 0) {
      createBackorder(tx, ctx, { orderId: order.id });
      return "allocated";
    }
    return "shortage";
  }
  resolveShortages(tx, order.id);
  setOrderStatus(tx, ctx, order, "Ready to Pick");
  return "allocated";
}

export function allocateOrders(tx: Tx, ctx: DomainCtx, input: AllocateOrdersInput): AllocateOrdersResult {
  const algo = loadAllocationAlgorithm(tx, input.warehouseId, input.algorithmId);
  const run: RunInfo = { input, algo, runBy: input.runBy ?? ctx.source, waveNo: input.waveNo ?? MANUAL_ALLOCATION };
  const before = tx.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM allocation_exceptions`)?.n ?? 0;
  const allocated: string[] = [];
  const shortage: string[] = [];
  const failed: { id: string; code: string; message: string }[] = [];
  for (const id of [...new Set(input.orderIds)]) {
    try {
      const outcome = tx.transaction((inner) => allocateOne(inner, ctx, run, id));
      (outcome === "allocated" ? allocated : shortage).push(id);
    } catch (error) {
      failed.push({ id, ...describeError(error) });
    }
  }
  const after = tx.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM allocation_exceptions`)?.n ?? 0;
  return { succeeded: allocated, failed, allocated, shortage, exceptions: after - before };
}

/**
 * Allocates up to `qty` more of a line from stock outside `excludeLocationIds` (pick-short
 * resolution). Returns the allocated quantity.
 */
export function reallocateLine(tx: Tx, ctx: DomainCtx, input: { orderLineId: string; excludeLocationIds: readonly string[]; jobId?: string | null }): number {
  const line = tx.select().from(schema.orderLines).where(eq(schema.orderLines.id, input.orderLineId)).get();
  if (!line) throw new DomainError("NOT_FOUND", "Order line not found");
  const order = tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, line.orderId)).get();
  if (!order) throw new DomainError("NOT_FOUND", "Shipment order not found");
  const algo = loadAllocationAlgorithm(tx, order.warehouseId);
  const rule = algo.rules.find((r) => evaluateConditions(r.conditions, orderFacts(tx, order))) ?? DEFAULT_ALLOCATION_RULE;
  const plan = planLine(tx, order, line, rule, new Map(), input.excludeLocationIds);
  commitSlices(tx, ctx, order, plan.slices, { algorithmId: algo.id, algorithmName: algo.name, ruleName: rule.name, jobId: input.jobId });
  return plan.slices.reduce((s, x) => s + x.qty, 0);
}

/** Releases every unpicked allocation of an order. Picked stock stays committed. */
export function deallocateOrder(tx: Tx, ctx: DomainCtx, order: OrderRow): number {
  const allocs = tx.select().from(schema.inventoryAllocations)
    .where(and(eq(schema.inventoryAllocations.orderId, order.id), eq(schema.inventoryAllocations.status, "Allocated"))).all();
  const perLine = new Map<string, number>();
  for (const a of allocs) {
    releaseAllocation(tx, ctx, { allocationId: a.id });
    if (a.orderLineId) perLine.set(a.orderLineId, (perLine.get(a.orderLineId) ?? 0) + a.qty);
  }
  for (const [lineId, qty] of perLine) {
    const prev = tx.select({ q: schema.orderLines.allocatedQuantity }).from(schema.orderLines).where(eq(schema.orderLines.id, lineId)).get()?.q ?? 0;
    tx.update(schema.orderLines).set({ allocatedQuantity: sql`MAX(${schema.orderLines.allocatedQuantity} - ${qty}, 0)`, updatedBy: ctx.userId })
      .where(eq(schema.orderLines.id, lineId)).run();
    logLineAllocation(tx, ctx, order, lineId, prev, Math.max(prev - qty, 0));
  }
  resolveShortages(tx, order.id);
  const stillHeld = tx.select({ id: schema.inventoryAllocations.id }).from(schema.inventoryAllocations)
    .where(and(eq(schema.inventoryAllocations.orderId, order.id), inArray(schema.inventoryAllocations.status, [...ACTIVE_ALLOCATION_STATUSES]))).get();
  if (!stillHeld && (order.status === "Ready to Pick" || order.status === "Shortage")) {
    setOrderStatus(tx, ctx, order, "Open");
  }
  return allocs.reduce((s, a) => s + a.qty, 0);
}

export function deallocate(tx: Tx, ctx: DomainCtx, input: { orderIds: readonly string[] }): BulkResult {
  const succeeded: string[] = [];
  const failed: { id: string; code: string; message: string }[] = [];
  for (const id of [...new Set(input.orderIds)]) {
    try {
      tx.transaction((inner) => {
        const order = inner.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, id)).get();
        if (!order || order.deletedAt) throw new DomainError("NOT_FOUND", "Shipment order not found");
        checkScope(ctx, order, "Shipment order");
        if (order.jobId) throw new DomainError("INVALID_STATE", `Order ${order.code} is in a job. Remove it from the job or cancel the job first.`);
        if (order.status !== "Ready to Pick" && order.status !== "Shortage") {
          throw new DomainError("INVALID_STATE", `Order ${order.code} is ${order.status}; only Ready to Pick or Shortage orders can be deallocated.`);
        }
        deallocateOrder(inner, ctx, order);
      });
      succeeded.push(id);
    } catch (error) {
      failed.push({ id, ...describeError(error) });
    }
  }
  return { succeeded, failed };
}
