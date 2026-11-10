/**
 * Warehouse Ops for work orders: Picking/Job Operations (with a dry-run preview) and the
 * Picking List / Batch Picking List print records.
 */
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import type { Scope } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";
import { describeError } from "@/server/domain/errors";
import type { DomainCtx } from "@/server/domain/types";
import type { Priority } from "@/lib/enums";
import { remainingQty } from "@/lib/grid-defs/work-orders/work-order-model";
import { getWorkOrderRows, loadWorkOrder } from "./work-orders";
import { allocateWorkOrderWith, candidateBuckets, componentNeed } from "./work-orders-commands";

export interface PickingOutcome {
  readonly id: string;
  readonly code: string;
  readonly outcome: "allocated" | "shortage" | "failed";
  readonly message: string;
  readonly shortages: readonly { readonly sku: string; readonly need: number; readonly free: number }[];
}

export interface PickingResult {
  readonly succeeded: readonly string[];
  readonly failed: readonly { readonly id: string; readonly code: string; readonly message: string }[];
  readonly outcomes: readonly PickingOutcome[];
  readonly jobTypes: readonly { readonly id: string; readonly code: string; readonly name: string; readonly warehouseId: string }[];
  readonly dryRun: boolean;
}

class Rollback extends Error {}

function shortagesOf(db: AppDb, scope: Scope, id: string): PickingOutcome["shortages"] {
  const wo = loadWorkOrder(db, scope, id);
  const comps = db.select({ c: schema.workOrderComponents, sku: schema.products.sku }).from(schema.workOrderComponents)
    .innerJoin(schema.products, eq(schema.products.id, schema.workOrderComponents.componentProductId))
    .where(eq(schema.workOrderComponents.workOrderId, wo.id)).all();
  return comps.flatMap(({ c, sku }) => {
    const need = componentNeed(wo, c);
    const free = candidateBuckets(db, wo, c).reduce((s, b) => s + b.onHand - b.allocated, 0);
    return need > free ? [{ sku, need, free }] : [];
  });
}

/**
 * Allocates each work order in its own savepoint. With `dryRun` everything is rolled back
 * and the caller gets the would-be outcome per work order (the modal's preview step).
 */
export function runPicking(db: AppDb, ctx: DomainCtx & { scope: Scope }, input: { ids: readonly string[]; jobTypeId?: string | null; assigneeUserId?: string | null; priority?: Priority; dryRun?: boolean }): PickingResult {
  const rows = getWorkOrderRows(db, ctx.scope, input.ids);
  const codes = new Map(rows.map((r) => [r.id, r.code]));
  const outcomes: PickingOutcome[] = [];
  const run = (tx: AppDb) => {
    for (const id of [...new Set(input.ids)]) {
      const code = codes.get(id) ?? id;
      try {
        const shortages = shortagesOf(tx, ctx.scope, id);
        const res = tx.transaction((inner) => allocateWorkOrderWith(inner, ctx, id, { jobTypeId: input.jobTypeId, assigneeUserId: input.assigneeUserId, priority: input.priority }));
        outcomes.push(res.status === "In Process"
          ? { id, code, outcome: "allocated", message: "Components allocated; picking job created", shortages: [] }
          : { id, code, outcome: "shortage", message: `${res.shortageQty} component unit${res.shortageQty === 1 ? "" : "s"} short`, shortages });
      } catch (error) {
        outcomes.push({ id, code, outcome: "failed", message: describeError(error).message, shortages: [] });
      }
    }
  };
  if (input.dryRun) {
    try {
      db.transaction((tx) => {
        run(tx);
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  } else {
    run(db);
  }
  const warehouseIds = [...new Set(rows.map((r) => r.warehouseId))];
  const jobTypes = warehouseIds.length
    ? db.select().from(schema.jobTypes).where(and(inArray(schema.jobTypes.warehouseId, warehouseIds), eq(schema.jobTypes.operationType, "Work Order"), eq(schema.jobTypes.isActive, true))).orderBy(asc(schema.jobTypes.code)).all()
      .map((j) => ({ id: j.id, code: j.code, name: j.description, warehouseId: j.warehouseId }))
    : [];
  return {
    succeeded: outcomes.filter((o) => o.outcome === "allocated").map((o) => o.id),
    failed: outcomes.filter((o) => o.outcome !== "allocated").map((o) => ({ id: o.id, code: o.code, message: o.message })),
    outcomes,
    jobTypes,
    dryRun: Boolean(input.dryRun),
  };
}

/* ---------------------------------------------------------- pick lists */

export interface PickListLine {
  readonly locationCode: string;
  readonly sku: string;
  readonly name: string;
  readonly quantity: number;
  readonly uom?: string;
  readonly lpNumber?: string;
  readonly lotNumber?: string;
  readonly expiryDate?: string;
  readonly orderCode?: string;
  readonly walkingPathPriority?: number;
}

export interface PickListRecord {
  readonly code: string;
  readonly warehouseName?: string;
  readonly jobType?: string;
  readonly assignee?: string;
  readonly createdAt?: string;
  readonly orderCount?: number;
  readonly lines: readonly PickListLine[];
}

const opt = (v: string | null | undefined): string | undefined => (v ? v : undefined);

function linesFor(db: AppDb, scope: Scope, id: string): { lines: PickListLine[]; warehouseName: string; jobType?: string; assignee?: string; createdAt: string; code: string } {
  const wo = loadWorkOrder(db, scope, id);
  const warehouseName = db.select({ name: schema.warehouses.name }).from(schema.warehouses).where(eq(schema.warehouses.id, wo.warehouseId)).get()?.name ?? "";
  const t = schema.tasks;
  const tasks = db.select({ t, p: schema.products, loc: schema.locations, lp: schema.licensePlates.number }).from(t)
    .innerJoin(schema.products, eq(schema.products.id, t.productId))
    .innerJoin(schema.locations, eq(schema.locations.id, t.sourceLocationId))
    .leftJoin(schema.licensePlates, eq(schema.licensePlates.id, t.sourceLpId))
    .where(and(eq(t.workOrderId, wo.id), eq(t.taskType, "Picking"), inArray(t.status, ["Pending", "Started"]))).all();
  const job = wo.jobId ? db.select({ j: schema.jobs, name: schema.users.name }).from(schema.jobs).leftJoin(schema.users, eq(schema.users.id, schema.jobs.assignedToUserId)).where(eq(schema.jobs.id, wo.jobId)).get() : undefined;
  if (tasks.length > 0) {
    return {
      code: wo.code, warehouseName, jobType: job?.j.jobType, assignee: opt(job?.name), createdAt: wo.createdAt,
      lines: tasks.map(({ t: task, p, loc, lp }) => ({
        locationCode: loc.code, sku: p.sku, name: p.name, quantity: task.plannedQty - task.actualQty, uom: p.uom, lpNumber: opt(lp),
        lotNumber: opt(task.lotNumber), expiryDate: opt(task.expiryDate), orderCode: wo.code, walkingPathPriority: loc.walkingPathPriority,
      })).filter((l) => l.quantity > 0),
    };
  }
  // Every pick already done (e.g. Completed with picking): reprint what was picked, for audit or
  // rework, instead of planning new picks (Logiwa prints whenever there is a selection).
  const done = db.select({ t, p: schema.products, loc: schema.locations, lp: schema.licensePlates.number }).from(t)
    .innerJoin(schema.products, eq(schema.products.id, t.productId))
    .innerJoin(schema.locations, eq(schema.locations.id, t.sourceLocationId))
    .leftJoin(schema.licensePlates, eq(schema.licensePlates.id, t.sourceLpId))
    .where(and(eq(t.workOrderId, wo.id), eq(t.taskType, "Picking"), eq(t.status, "Completed"))).all();
  if (done.length > 0) {
    return {
      code: wo.code, warehouseName, jobType: `${job?.j.jobType ?? "Work Order Picking"} (reprint, picked)`, assignee: opt(job?.name), createdAt: wo.createdAt,
      lines: done.map(({ t: task, p, loc, lp }) => ({
        locationCode: loc.code, sku: p.sku, name: p.name, quantity: task.actualQty || task.plannedQty, uom: p.uom, lpNumber: opt(lp),
        lotNumber: opt(task.lotNumber), expiryDate: opt(task.expiryDate), orderCode: wo.code, walkingPathPriority: loc.walkingPathPriority,
      })).filter((l) => l.quantity > 0),
    };
  }
  // Completed with no pick tasks on record: reprint from the Kitting consumption (where each
  // component was actually taken from), never a new FEFO plan.
  if (wo.status === "Completed") {
    const x = schema.inventoryTransactions;
    const used = db.select({ x, p: schema.products, loc: schema.locations, lp: schema.licensePlates.number }).from(x)
      .innerJoin(schema.products, eq(schema.products.id, x.productId))
      .innerJoin(schema.locations, eq(schema.locations.id, x.fromLocationId))
      .leftJoin(schema.licensePlates, eq(schema.licensePlates.id, x.fromLpId))
      .where(and(eq(x.workOrderId, wo.id), eq(x.type, "Kitting"), ne(x.productId, wo.kitProductId), isNull(x.toLocationId))).all();
    return {
      code: wo.code, warehouseName, jobType: `${job?.j.jobType ?? "Work Order Picking"} (reprint, consumed)`, assignee: opt(job?.name), createdAt: wo.createdAt,
      lines: used.map(({ x: row, p, loc, lp }) => ({
        locationCode: loc.code, sku: p.sku, name: p.name, quantity: Math.abs(row.uomQty), uom: p.uom, lpNumber: opt(lp),
        lotNumber: opt(row.fromLot), expiryDate: opt(row.fromExpiry), orderCode: wo.code, walkingPathPriority: loc.walkingPathPriority,
      })).filter((l) => l.quantity > 0),
    };
  }
  // No job yet: plan from the chosen sources, else FEFO candidates (what picking would take).
  const comps = db.select({ c: schema.workOrderComponents, p: schema.products }).from(schema.workOrderComponents)
    .innerJoin(schema.products, eq(schema.products.id, schema.workOrderComponents.componentProductId))
    .where(eq(schema.workOrderComponents.workOrderId, wo.id)).all();
  const lines: PickListLine[] = [];
  const locCode = new Map(db.select({ id: schema.locations.id, code: schema.locations.code, wpp: schema.locations.walkingPathPriority }).from(schema.locations).where(eq(schema.locations.warehouseId, wo.warehouseId)).all().map((l) => [l.id, l]));
  for (const { c, p } of comps) {
    let left = remainingQty(wo) * c.componentQty;
    for (const b of candidateBuckets(db, wo, c)) {
      if (left <= 0) break;
      const take = Math.min(left, b.onHand - b.allocated);
      const loc = locCode.get(b.locationId);
      lines.push({ locationCode: loc?.code ?? "-", sku: p.sku, name: p.name, quantity: take, uom: p.uom, lotNumber: opt(b.lotNumber), expiryDate: opt(b.expiryDate), orderCode: wo.code, walkingPathPriority: loc?.wpp });
      left -= take;
    }
    if (left > 0) lines.push({ locationCode: "NO STOCK", sku: p.sku, name: p.name, quantity: left, uom: p.uom, orderCode: wo.code });
  }
  return { code: wo.code, warehouseName, jobType: job?.j.jobType, assignee: opt(job?.name), createdAt: wo.createdAt, lines };
}

export function buildPickLists(db: AppDb, scope: Scope, ids: readonly string[], consolidated: boolean): PickListRecord[] {
  const per = ids.map((id) => linesFor(db, scope, id)).filter((r) => r.lines.length > 0);
  if (!consolidated) return per.map((r) => ({ code: r.code, warehouseName: r.warehouseName, jobType: r.jobType ?? "Work Order Picking", assignee: r.assignee, createdAt: r.createdAt, orderCount: 1, lines: r.lines }));
  if (per.length === 0) return [];
  const first = per[0];
  return [{
    code: per.length === 1 ? (first?.code ?? "") : `${first?.code ?? ""}+${per.length - 1}`, warehouseName: first?.warehouseName, jobType: "Work Order Batch Picking",
    createdAt: new Date().toISOString(), orderCount: per.length, lines: per.flatMap((r) => r.lines),
  }];
}
