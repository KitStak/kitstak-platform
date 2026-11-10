/**
 * Kitting replay: eight work orders across the statuses. Completed work orders consume
 * their components (ledger Kitting out) and produce kits at KIT-01 (ledger Kitting in),
 * which are then moved to the kit's pick face; In Process ones hold component allocations.
 */
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import type { WorkOrderStatus } from "@/lib/enums";
import * as schema from "@/server/db/schema";
import { changeLog, ledger, sequences, stateMachines } from "@/server/domain";
import type { DomainCtx, Tx } from "@/server/domain/types";
import { KIT_DEFS } from "./catalog-data";
import { jobTypeKey } from "./config";
import { HOUR_MS, MINUTE_MS, dateOf, isoOf, utcAt } from "./runtime";
import { actor, txAt, type Id } from "./types";
import { noteFailure, operatorFor, type World } from "./world";

interface WoSpec {
  readonly sku: string;
  readonly qty: number;
  readonly target: WorkOrderStatus;
  readonly daysAgo: number;
  readonly note: string;
}

const SPECS: readonly WoSpec[] = [
  { sku: "VLT-KIT-DESK", qty: 12, target: "Completed", daysAgo: 22, note: "Back-to-school desk bundle restock" },
  { sku: "PXP-KIT-TRAVEL", qty: 6, target: "Cancelled", daysAgo: 18, note: "Cancelled: client is winding down the travel kit" },
  { sku: "CPL-KIT-SAMPLER", qty: 24, target: "Completed", daysAgo: 14, note: "Holiday sampler pre-build" },
  { sku: "HRB-KIT-GIFT", qty: 20, target: "Completed", daysAgo: 9, note: "Gift box build for the November promo" },
  { sku: "HRB-KIT-GIFT", qty: 400, target: "Shortage", daysAgo: 3, note: "Black Friday gift box build - waiting on beans" },
  { sku: "VLT-KIT-DESK", qty: 10, target: "In Process", daysAgo: 1, note: "Weekly desk bundle build" },
  { sku: "APX-KIT-TEE3", qty: 15, target: "In Process", daysAgo: 0, note: "Tee 3-pack for the Shopify bundle launch" },
  { sku: "NOVA-KIT-ROAD", qty: 10, target: "Open", daysAgo: 0, note: "Road Warrior kit for the CES sample program" },
];

const freeBuckets = (tx: Tx, warehouseId: Id, productId: Id) => tx.select().from(schema.inventory).where(and(
  eq(schema.inventory.warehouseId, warehouseId), eq(schema.inventory.productId, productId), eq(schema.inventory.status, "Stock"),
  isNull(schema.inventory.damageReason), gt(sql`${schema.inventory.onHand} - ${schema.inventory.allocated}`, 0),
)).orderBy(asc(schema.inventory.expiryDate), asc(schema.inventory.receivedAt)).all();

const freeTotal = (tx: Tx, warehouseId: Id, productId: Id): number => freeBuckets(tx, warehouseId, productId).reduce((s, b) => s + b.onHand - b.allocated, 0);

function setStatus(tx: Tx, ctx: DomainCtx, id: Id, code: string, from: WorkOrderStatus, to: WorkOrderStatus, stamp: Partial<typeof schema.workOrders.$inferInsert>): WorkOrderStatus {
  const status = stateMachines.workOrder.transition(from, to);
  tx.update(schema.workOrders).set({ status, ...stamp, updatedBy: ctx.userId }).where(eq(schema.workOrders.id, id)).run();
  changeLog.recordUpdate(tx, ctx, { entityType: "work_order", entityId: id, entityCode: code, before: { status: from }, after: { status } });
  return status;
}

/** Takes `qty` units of a component out of stock (FEFO) as Kitting, or allocates them to the work order. */
function takeComponent(tx: Tx, ctx: DomainCtx, warehouseId: Id, productId: Id, qty: number, wo: { id: Id; componentId: Id }, mode: "consume" | "allocate"): void {
  let left = qty;
  for (const b of freeBuckets(tx, warehouseId, productId)) {
    if (left <= 0) break;
    const take = Math.min(left, b.onHand - b.allocated);
    if (mode === "consume") ledger.consume(tx, ctx, { inventoryId: b.id, qty: take, type: "Kitting", refs: { workOrderId: wo.id, note: "Component consumed by work order" } });
    else ledger.allocate(tx, ctx, { inventoryId: b.id, qty: take, workOrderId: wo.id, workOrderComponentId: wo.componentId, ruleName: "Work order components" });
    left -= take;
  }
}

function kittingJob(w: World, tx: Tx, woId: Id, spec: WoSpec, atMs: number, done: boolean, userId: Id): Id {
  const fac = w.facility.MLT1;
  return tx.insert(schema.jobs).values({
    id: crypto.randomUUID(), code: sequences.next(tx, "job"), warehouseId: fac.id, jobType: "Work Order Picking",
    jobTypeId: w.config.jobTypes.get(jobTypeKey(fac.id, "Work Order Picking")) ?? null, operationType: "Work Order", workOrderId: woId,
    status: done ? "Completed" : "Started", assignedToUserId: userId, unitCount: spec.qty, completedUnits: done ? spec.qty : 0, taskCount: 1, completedTaskCount: done ? 1 : 0,
    startedAt: isoOf(atMs), completedAt: done ? isoOf(atMs + 3 * HOUR_MS) : null, plannedStartAt: isoOf(atMs), plannedEndAt: isoOf(atMs + 4 * HOUR_MS),
  }).returning({ id: schema.jobs.id }).get().id;
}

function runWorkOrder(w: World, tx: Tx, spec: WoSpec, atMs: number): void {
  const fac = w.facility.MLT1;
  const kit = w.catalog.bySku.get(spec.sku);
  const def = KIT_DEFS.find((k) => k.sku === spec.sku);
  if (!kit || !def) return;
  const manager = actor(w.access.manager);
  const builder = operatorFor(w, "MLT1", spec.qty);
  const ctx = actor(builder);
  const code = sequences.next(tx, "workOrder");
  const wo = tx.insert(schema.workOrders).values({
    code, warehouseId: fac.id, clientId: kit.clientId, type: "Work Order with Picking", kitProductId: kit.id, requestedQty: spec.qty, extraNote: spec.note,
    kittingInstructions: "Assemble in the kit's retail box; insert packing card on top; seal with a branded sticker.",
    plannedStartAt: isoOf(atMs + HOUR_MS), plannedFinishAt: isoOf(atMs + 6 * HOUR_MS), outputLocationId: fac.kit, createdBy: manager.userId,
  }).returning().get();
  changeLog.recordCreate(tx, manager, { entityType: "work_order", entityId: wo.id, entityCode: code });
  const components = def.components.map(([sku, per]) => {
    const p = w.catalog.bySku.get(sku);
    if (!p) throw new Error(`Seed kit component ${sku} missing`);
    const id = tx.insert(schema.workOrderComponents).values({ workOrderId: wo.id, componentProductId: p.id, componentQty: per, totalQty: per * spec.qty, packType: p.uom })
      .returning({ id: schema.workOrderComponents.id }).get().id;
    return { id, productId: p.id, total: per * spec.qty };
  });
  if (spec.target === "Open") return;
  if (spec.target === "Cancelled") {
    setStatus(tx, manager, wo.id, code, "Open", "Cancelled", { cancelledAt: isoOf(atMs + 2 * HOUR_MS) });
    return;
  }
  const short = components.some((c) => freeTotal(tx, fac.id, c.productId) < c.total);
  if (spec.target === "Shortage" || short) {
    setStatus(tx, manager, wo.id, code, "Open", "Shortage", {});
    return;
  }
  const done = spec.target === "Completed";
  const jobId = kittingJob(w, tx, wo.id, spec, atMs, done, builder.id);
  setStatus(tx, ctx, wo.id, code, "Open", "In Process", { jobId, actualStartAt: isoOf(atMs) });
  for (const c of components) {
    takeComponent(tx, ctx, fac.id, c.productId, c.total, { id: wo.id, componentId: c.id }, done ? "consume" : "allocate");
    tx.update(schema.workOrderComponents).set(done ? { consumedQty: c.total, pickedQty: c.total, allocatedQty: c.total } : { allocatedQty: c.total }).where(eq(schema.workOrderComponents.id, c.id)).run();
  }
  const taskNo = (tx.get<{ n: number | null }>(sql`SELECT MAX(task_no) AS n FROM tasks`)?.n ?? 0) + 1;
  tx.insert(schema.tasks).values({
    taskNo, jobId, warehouseId: fac.id, clientId: kit.clientId, taskType: "Kitting", status: done ? "Completed" : "Pending", workOrderId: wo.id, productId: kit.id,
    packType: kit.uom, plannedQty: spec.qty, actualQty: done ? spec.qty : 0, targetLocationId: fac.kit, assigneeUserId: builder.id,
    executedByUserId: done ? builder.id : null, startedAt: done ? isoOf(atMs) : null, finishedAt: done ? isoOf(atMs + 3 * HOUR_MS) : null,
  }).run();
  if (!done || !fac.kit) return;
  const lot = kit.trackLot ? `K${dateOf(atMs).replaceAll("-", "").slice(2)}` : null;
  const made = ledger.add(tx, ctx, { warehouseId: fac.id, clientId: kit.clientId, productId: kit.id, locationId: fac.kit, qty: spec.qty, packType: kit.uom, lotNumber: lot,
    type: "Kitting", refs: { workOrderId: wo.id, note: `Built from ${code}` } });
  const face = fac.pickFaces.get(kit.id);
  if (face) ledger.move(tx, ctx, { inventoryId: made.bucket.id, qty: spec.qty, toLocationId: face, refs: { workOrderId: wo.id, note: "Kits put away to pick face" } });
  setStatus(tx, ctx, wo.id, code, "In Process", "Completed", { processedQty: spec.qty, actualFinishAt: isoOf(atMs + 3 * HOUR_MS + 10 * MINUTE_MS), outputLot: lot });
}

export function scheduleWorkOrders(w: World): number {
  SPECS.forEach((spec, i) => {
    const at = utcAt(spec.daysAgo, spec.daysAgo === 0 ? 13 : 12, 15 + i);
    w.queue.schedule(at, `work order ${spec.sku}`, () => {
      try {
        txAt(w.env, at, (tx) => runWorkOrder(w, tx, spec, at));
      } catch (error) {
        noteFailure(w, `work order ${spec.sku}`, error);
      }
    });
  });
  return SPECS.length;
}
