/**
 * Work order repository (M08): grid list, detail, create, update and delete. Status
 * changes go through `stateMachines.workOrder`, codes through `sequences`, and every
 * write records field-level change log rows with human-readable values.
 */
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { AppDb } from "@/server/api/db";
import { AppError, notFoundError, validationError } from "@/server/api/errors";
import { assertInScope, hasClient, hasWarehouse, scopedWhere, type Scope } from "@/server/auth/scope";
import * as schema from "@/server/db/schema";
import { changeLog, sequences } from "@/server/domain";
import type { DomainCtx, Tx } from "@/server/domain/types";
import type { GridQuery } from "@/server/query/grid-query";
import { ageInDays, type WorkOrderInput } from "@/lib/grid-defs/work-orders/work-order-model";
import { assertVersion } from "./platform-common";
import { compileWorkOrderQuery } from "./work-orders-grid";

const wo = schema.workOrders;
export type WorkOrderRecord = typeof schema.workOrders.$inferSelect;
export const WO_ENTITY = "work_order";

export interface TagChipRow { readonly id: string; readonly name: string; readonly color: string }

export interface WorkOrderRow {
  readonly id: string;
  readonly code: string;
  readonly version: number;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly status: WorkOrderRecord["status"];
  readonly age: number;
  readonly operationType: string;
  readonly type: WorkOrderRecord["type"];
  readonly buildFor: WorkOrderRecord["buildFor"];
  readonly shipmentOrderId: string | null;
  readonly shipmentOrderCode: string | null;
  readonly tags: readonly TagChipRow[];
  readonly tagNames: string;
  readonly jobId: string | null;
  readonly jobCode: string | null;
  readonly kitProductId: string;
  readonly kitSku: string;
  readonly kitName: string;
  readonly requestedQty: number;
  readonly processedQty: number;
  readonly extraNote: string | null;
  readonly kittingInstructions: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
  readonly updatedAt: string;
  readonly plannedStartAt: string | null;
  readonly plannedFinishAt: string | null;
  readonly actualStartAt: string | null;
  readonly actualFinishAt: string | null;
  readonly cancelledAt: string | null;
  readonly outputLocationId: string | null;
  readonly outputLot: string | null;
  readonly outputExpiry: string | null;
  readonly customFields: Readonly<Record<string, string | boolean | null>>;
}

function tagsFor(db: AppDb, ids: readonly string[]): Map<string, TagChipRow[]> {
  const out = new Map<string, TagChipRow[]>();
  if (ids.length === 0) return out;
  const rows = db.select({ entityId: schema.entityTags.entityId, id: schema.tags.id, name: schema.tags.name, color: schema.tags.color })
    .from(schema.entityTags).innerJoin(schema.tags, eq(schema.tags.id, schema.entityTags.tagId))
    .where(and(eq(schema.entityTags.entityType, WO_ENTITY), inArray(schema.entityTags.entityId, [...ids]))).orderBy(asc(schema.tags.name)).all();
  for (const r of rows) out.set(r.entityId, [...(out.get(r.entityId) ?? []), { id: r.id, name: r.name, color: r.color }]);
  return out;
}

function hydrate(db: AppDb, records: readonly WorkOrderRecord[], now = new Date()): WorkOrderRow[] {
  if (records.length === 0) return [];
  const whIds = [...new Set(records.map((r) => r.warehouseId))];
  const clIds = [...new Set(records.map((r) => r.clientId))];
  const kitIds = [...new Set(records.map((r) => r.kitProductId))];
  const jobIds = records.flatMap((r) => (r.jobId ? [r.jobId] : []));
  const soIds = records.flatMap((r) => (r.shipmentOrderId ? [r.shipmentOrderId] : []));
  const whs = new Map(db.select({ id: schema.warehouses.id, code: schema.warehouses.code }).from(schema.warehouses).where(inArray(schema.warehouses.id, whIds)).all().map((w) => [w.id, w.code]));
  const cls = new Map(db.select({ id: schema.clients.id, name: schema.clients.name }).from(schema.clients).where(inArray(schema.clients.id, clIds)).all().map((c) => [c.id, c.name]));
  const kits = new Map(db.select({ id: schema.products.id, sku: schema.products.sku, name: schema.products.name }).from(schema.products).where(inArray(schema.products.id, kitIds)).all().map((p) => [p.id, p]));
  const jobs = new Map(jobIds.length ? db.select({ id: schema.jobs.id, code: schema.jobs.code }).from(schema.jobs).where(inArray(schema.jobs.id, jobIds)).all().map((j) => [j.id, j.code]) : []);
  const sos = new Map(soIds.length ? db.select({ id: schema.shipmentOrders.id, code: schema.shipmentOrders.code }).from(schema.shipmentOrders).where(inArray(schema.shipmentOrders.id, soIds)).all().map((s) => [s.id, s.code]) : []);
  const tags = tagsFor(db, records.map((r) => r.id));
  return records.map((r) => {
    const t = tags.get(r.id) ?? [];
    return {
      id: r.id, code: r.code, version: r.version, warehouseId: r.warehouseId, warehouseCode: whs.get(r.warehouseId) ?? "",
      clientId: r.clientId, clientName: cls.get(r.clientId) ?? "", status: r.status, age: ageInDays(r.createdAt, now),
      operationType: r.operationType, type: r.type, buildFor: r.buildFor, shipmentOrderId: r.shipmentOrderId,
      shipmentOrderCode: r.shipmentOrderId ? sos.get(r.shipmentOrderId) ?? null : null, tags: t, tagNames: t.map((x) => x.name).join(", "),
      jobId: r.jobId, jobCode: r.jobId ? jobs.get(r.jobId) ?? null : null, kitProductId: r.kitProductId,
      kitSku: kits.get(r.kitProductId)?.sku ?? "", kitName: kits.get(r.kitProductId)?.name ?? "", requestedQty: r.requestedQty,
      processedQty: r.processedQty, extraNote: r.extraNote, kittingInstructions: r.kittingInstructions, createdAt: r.createdAt,
      createdBy: r.createdBy, updatedAt: r.updatedAt, plannedStartAt: r.plannedStartAt, plannedFinishAt: r.plannedFinishAt,
      actualStartAt: r.actualStartAt, actualFinishAt: r.actualFinishAt, cancelledAt: r.cancelledAt, outputLocationId: r.outputLocationId,
      outputLot: r.outputLot, outputExpiry: r.outputExpiry, customFields: r.customFields ?? {},
    };
  });
}

export interface Paged<T> { readonly rows: readonly T[]; readonly total: number }

/** Grid list in the viewer's (context-narrowed) scope. */
export function listWorkOrders(db: AppDb, scope: Scope, query: GridQuery): Paged<WorkOrderRow> {
  const { where, orderBy } = compileWorkOrderQuery(query);
  const scoped = scopedWhere(wo, scope);
  const cond = and(scoped, where);
  const total = db.select({ n: count() }).from(wo).where(cond).get()?.n ?? 0;
  const records = db.select().from(wo).where(cond).orderBy(...orderBy).limit(query.pageSize).offset((Math.max(1, query.page) - 1) * query.pageSize).all();
  return { rows: hydrate(db, records), total: Number(total) };
}

/** Loads a work order by id or code; cross-scope → 404. */
export function loadWorkOrder(db: AppDb, scope: Scope, idOrCode: string): WorkOrderRecord {
  const record = db.select().from(wo).where(sql`${wo.id} = ${idOrCode} OR ${wo.code} = ${idOrCode}`).get();
  if (!record) throw notFoundError("Work order");
  assertInScope(scope, record, "Work order");
  return record;
}

export function getWorkOrderRow(db: AppDb, scope: Scope, idOrCode: string): WorkOrderRow {
  const [row] = hydrate(db, [loadWorkOrder(db, scope, idOrCode)]);
  if (!row) throw notFoundError("Work order");
  return row;
}

export function getWorkOrderRows(db: AppDb, scope: Scope, ids: readonly string[]): WorkOrderRow[] {
  if (ids.length === 0) return [];
  const records = db.select().from(wo).where(and(inArray(wo.id, [...ids]), scopedWhere(wo, scope))).all();
  return hydrate(db, records);
}

export function nextWorkOrderCode(db: AppDb): string {
  return sequences.peek(db, "workOrder");
}

/* ------------------------------------------------------------- detail */

export interface ComponentRow {
  readonly id: string;
  readonly componentProductId: string;
  readonly sku: string;
  readonly name: string;
  readonly packType: string;
  readonly componentQty: number;
  readonly totalQty: number;
  readonly allocatedQty: number;
  readonly pickedQty: number;
  readonly consumedQty: number;
  /** Live free stock of the component in the work order's warehouse. */
  readonly freeQty: number;
  readonly shortQty: number;
  readonly locationId: string | null;
  readonly locationCode: string | null;
  readonly lpId: string | null;
  readonly lpNumber: string | null;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly productionDate: string | null;
  readonly trackLot: boolean;
  readonly trackExpiry: boolean;
  readonly trackProductionDate: boolean;
}

export function listComponents(db: AppDb, record: WorkOrderRecord): ComponentRow[] {
  const c = schema.workOrderComponents;
  const rows = db.select({ c, p: schema.products, loc: schema.locations.code, lp: schema.licensePlates.number }).from(c)
    .innerJoin(schema.products, eq(schema.products.id, c.componentProductId))
    .leftJoin(schema.locations, eq(schema.locations.id, c.locationId))
    .leftJoin(schema.licensePlates, eq(schema.licensePlates.id, c.lpId))
    .where(eq(c.workOrderId, record.id)).orderBy(asc(schema.products.sku)).all();
  const i = schema.inventory;
  const free = new Map(db.select({ productId: i.productId, free: sql<number>`COALESCE(SUM(${i.onHand} - ${i.allocated}), 0)` }).from(i)
    .where(and(eq(i.warehouseId, record.warehouseId), eq(i.clientId, record.clientId), eq(i.status, "Stock"), sql`${i.damageReason} IS NULL`))
    .groupBy(i.productId).all().map((r) => [r.productId, Number(r.free)]));
  const a = schema.inventoryAllocations;
  const picked = new Map(db.select({ id: a.workOrderComponentId, qty: sql<number>`COALESCE(SUM(${a.qty}), 0)` }).from(a)
    .where(and(eq(a.workOrderId, record.id), eq(a.status, "Picked"))).groupBy(a.workOrderComponentId).all().map((r) => [r.id ?? "", Number(r.qty)]));
  return rows.map(({ c: row, p, loc, lp }) => {
    const remaining = Math.max(0, row.totalQty - row.consumedQty - row.allocatedQty);
    const freeQty = free.get(row.componentProductId) ?? 0;
    return {
      id: row.id, componentProductId: row.componentProductId, sku: p.sku, name: p.name, packType: row.packType, componentQty: row.componentQty,
      totalQty: row.totalQty, allocatedQty: row.allocatedQty, pickedQty: Math.max(row.pickedQty, picked.get(row.id) ?? 0), consumedQty: row.consumedQty,
      freeQty, shortQty: Math.max(0, remaining - freeQty), locationId: row.locationId, locationCode: loc ?? null, lpId: row.lpId,
      lpNumber: lp ?? null, lotNumber: row.lotNumber, expiryDate: row.expiryDate, productionDate: row.productionDate,
      trackLot: p.trackLot, trackExpiry: p.trackExpiry, trackProductionDate: p.trackProductionDate,
    };
  });
}

export interface WorkOrderDetail {
  readonly workOrder: WorkOrderRow;
  readonly kit: { readonly id: string; readonly sku: string; readonly name: string; readonly packType: string; readonly kitType: string | null; readonly trackLot: boolean; readonly trackExpiry: boolean; readonly trackProductionDate: boolean };
  readonly outputLocationCode: string | null;
  readonly components: readonly ComponentRow[];
  readonly job: { readonly id: string; readonly code: string; readonly status: string; readonly jobType: string; readonly taskCount: number; readonly completedTaskCount: number; readonly assigneeName: string | null } | null;
  readonly tasks: readonly { readonly id: string; readonly taskNo: number; readonly taskType: string; readonly status: string; readonly sku: string | null; readonly plannedQty: number; readonly actualQty: number; readonly sourceLocationCode: string | null; readonly targetLocationCode: string | null }[];
  readonly receipts: readonly { readonly id: string; readonly masterId: number; readonly type: string; readonly sku: string; readonly quantity: number; readonly locationCode: string; readonly lotNumber: string | null; readonly receivedAt: string; readonly receivedBy: string; readonly cancelledAt: string | null }[];
  readonly transactions: readonly { readonly id: string; readonly seq: number; readonly type: string; readonly sku: string; readonly qty: number; readonly fromLocationCode: string | null; readonly toLocationCode: string | null; readonly createdAt: string; readonly source: string }[];
  readonly timeline: readonly { readonly id: string; readonly type: string; readonly message: string; readonly source: string; readonly at: string }[];
  readonly exceptions: readonly { readonly id: string; readonly sku: string | null; readonly explanation: string; readonly inventoryQty: number | null; readonly requiredQty: number | null; readonly runAt: string; readonly runBy: string }[];
}

export function getWorkOrderDetail(db: AppDb, scope: Scope, idOrCode: string): WorkOrderDetail {
  const record = loadWorkOrder(db, scope, idOrCode);
  const [row] = hydrate(db, [record]);
  const kit = db.select().from(schema.products).where(eq(schema.products.id, record.kitProductId)).get();
  if (!row || !kit) throw notFoundError("Work order");
  const loc = (id: string | null) => (id ? db.select({ code: schema.locations.code }).from(schema.locations).where(eq(schema.locations.id, id)).get()?.code ?? null : null);
  const job = record.jobId ? db.select({ j: schema.jobs, name: schema.users.name }).from(schema.jobs).leftJoin(schema.users, eq(schema.users.id, schema.jobs.assignedToUserId)).where(eq(schema.jobs.id, record.jobId)).get() : undefined;
  const t = schema.tasks;
  const src = sql<string | null>`(SELECT l.code FROM locations l WHERE l.id = ${t.sourceLocationId})`;
  const tgt = sql<string | null>`(SELECT l.code FROM locations l WHERE l.id = ${t.targetLocationId})`;
  const tasks = db.select({ t, sku: schema.products.sku, src, tgt }).from(t).leftJoin(schema.products, eq(schema.products.id, t.productId))
    .where(eq(t.workOrderId, record.id)).orderBy(asc(t.taskNo)).all()
    .map((r) => ({ id: r.t.id, taskNo: r.t.taskNo, taskType: r.t.taskType, status: r.t.status, sku: r.sku ?? null, plannedQty: r.t.plannedQty, actualQty: r.t.actualQty, sourceLocationCode: r.src, targetLocationCode: r.tgt }));
  const rc = schema.receipts;
  const receipts = db.select({ r: rc, sku: schema.products.sku, loc: schema.locations.code }).from(rc)
    .innerJoin(schema.products, eq(schema.products.id, rc.productId)).innerJoin(schema.locations, eq(schema.locations.id, rc.locationId))
    .where(eq(rc.workOrderId, record.id)).orderBy(desc(rc.receivedAt)).all()
    .map(({ r, sku, loc: code }) => ({ id: r.id, masterId: r.masterId, type: r.type, sku, quantity: r.quantity, locationCode: code, lotNumber: r.lotNumber, receivedAt: r.receivedAt, receivedBy: r.receivedBy, cancelledAt: r.cancelledAt }));
  const it = schema.inventoryTransactions;
  const txCols = db.select().from(it).where(eq(it.workOrderId, record.id)).orderBy(desc(it.seq)).limit(200).all();
  const locCodes = new Map(db.select({ id: schema.locations.id, code: schema.locations.code }).from(schema.locations).where(eq(schema.locations.warehouseId, record.warehouseId)).all().map((l) => [l.id, l.code]));
  const skuOf = new Map<string, string>();
  const skus = (ids: readonly string[]) => {
    const missing = ids.filter((id) => !skuOf.has(id));
    if (missing.length) for (const p of db.select({ id: schema.products.id, sku: schema.products.sku }).from(schema.products).where(inArray(schema.products.id, missing)).all()) skuOf.set(p.id, p.sku);
  };
  skus([...new Set(txCols.map((x) => x.productId))]);
  const transactions = txCols.map((x) => ({
    id: x.id, seq: x.seq, type: x.type, sku: skuOf.get(x.productId) ?? "", qty: x.uomQty,
    fromLocationCode: x.fromLocationId ? locCodes.get(x.fromLocationId) ?? null : null, toLocationCode: x.toLocationId ? locCodes.get(x.toLocationId) ?? null : null,
    createdAt: x.at, source: x.source,
  }));
  const cl = schema.changeLog;
  const timeline = db.select().from(cl).where(sql`(${cl.entityType} = ${WO_ENTITY} AND ${cl.entityId} = ${record.id}) OR (${cl.parentEntityType} = ${WO_ENTITY} AND ${cl.parentEntityId} = ${record.id})`)
    .orderBy(desc(cl.at)).limit(100).all().map((c) => ({ id: c.id, type: c.type, message: c.message, source: c.source, at: c.at }));
  const ae = schema.allocationExceptions;
  const exc = db.select().from(ae).where(eq(ae.orderId, record.id)).orderBy(desc(ae.runAt)).limit(50).all();
  skus(exc.flatMap((e) => (e.shortageProductId ? [e.shortageProductId] : [])));
  const exceptions = exc.map((e) => ({ id: e.id, sku: e.shortageProductId ? skuOf.get(e.shortageProductId) ?? null : null, explanation: e.explanation, inventoryQty: e.inventoryUomQty, requiredQty: e.orderLineQty, runAt: e.runAt, runBy: e.runBy }));
  return {
    workOrder: row,
    kit: { id: kit.id, sku: kit.sku, name: kit.name, packType: kit.uom, kitType: kit.kitType, trackLot: kit.trackLot, trackExpiry: kit.trackExpiry, trackProductionDate: kit.trackProductionDate },
    outputLocationCode: loc(record.outputLocationId),
    components: listComponents(db, record),
    job: job ? { id: job.j.id, code: job.j.code, status: job.j.status, jobType: job.j.jobType, taskCount: job.j.taskCount, completedTaskCount: job.j.completedTaskCount, assigneeName: job.name ?? null } : null,
    tasks, receipts, transactions, timeline, exceptions,
  };
}

/* ----------------------------------------------------------- mutations */

function display(tx: Tx, record: Pick<WorkOrderRecord, "warehouseId" | "clientId" | "kitProductId" | "shipmentOrderId">): Record<string, string | null> {
  const wh = tx.select({ code: schema.warehouses.code }).from(schema.warehouses).where(eq(schema.warehouses.id, record.warehouseId)).get()?.code ?? null;
  const cl = tx.select({ name: schema.clients.name }).from(schema.clients).where(eq(schema.clients.id, record.clientId)).get()?.name ?? null;
  const kit = tx.select({ sku: schema.products.sku }).from(schema.products).where(eq(schema.products.id, record.kitProductId)).get()?.sku ?? null;
  const so = record.shipmentOrderId ? tx.select({ code: schema.shipmentOrders.code }).from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, record.shipmentOrderId)).get()?.code ?? null : null;
  return { warehouseId: wh, clientId: cl, kitProductId: kit, shipmentOrderId: so };
}

/** Snapshot of the editable fields with ids replaced by codes/names (change log values). */
function snapshot(tx: Tx, r: WorkOrderRecord): Record<string, unknown> {
  return {
    code: r.code, type: r.type, buildFor: r.buildFor, requestedQty: r.requestedQty, extraNote: r.extraNote, kittingInstructions: r.kittingInstructions,
    plannedStartAt: r.plannedStartAt, plannedFinishAt: r.plannedFinishAt, actualStartAt: r.actualStartAt, actualFinishAt: r.actualFinishAt,
    customFields: r.customFields, ...display(tx, r),
  };
}

interface Validated {
  readonly kit: typeof schema.products.$inferSelect;
  readonly bom: readonly (typeof schema.kitComponents.$inferSelect & { readonly sku: string; readonly uom: string })[];
}

function validateInput(tx: Tx, scope: Scope, input: WorkOrderInput): Validated {
  const fieldErrors: Record<string, string[]> = {};
  if (!hasWarehouse(scope, input.warehouseId)) fieldErrors.warehouseId = ["Warehouse not found"];
  if (!hasClient(scope, input.clientId)) fieldErrors.clientId = ["Client not found"];
  const kit = tx.select().from(schema.products).where(eq(schema.products.id, input.kitProductId)).get();
  if (!kit || !kit.isKit) fieldErrors.kitProductId = ["Select a kit"];
  else if (kit.clientId !== input.clientId) fieldErrors.kitProductId = ["The kit belongs to another client"];
  else if (kit.kitType !== "Kit to Stock") fieldErrors.kitProductId = ["Only kit-to-stock products can be built by a work order"];
  if (input.buildFor === "SO" && input.shipmentOrderId) {
    const so = tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, input.shipmentOrderId)).get();
    if (!so || so.deletedAt || so.warehouseId !== input.warehouseId || so.clientId !== input.clientId) fieldErrors.shipmentOrderId = ["Select a shipment order of this warehouse and client"];
    else if (so.status === "Shipped" || so.status === "Cancelled" || so.status === "Delivered") fieldErrors.shipmentOrderId = [`Order ${so.code} is ${so.status}`];
  }
  if (Object.keys(fieldErrors).length > 0 || !kit) throw validationError(Object.values(fieldErrors)[0]?.[0] ?? "Check the highlighted fields", fieldErrors);
  const bom = tx.select({ k: schema.kitComponents, sku: schema.products.sku, uom: schema.products.uom }).from(schema.kitComponents)
    .innerJoin(schema.products, eq(schema.products.id, schema.kitComponents.componentProductId))
    .where(eq(schema.kitComponents.kitProductId, kit.id)).all().map((r) => ({ ...r.k, sku: r.sku, uom: r.uom }));
  if (bom.length === 0) throw validationError("This kit has no components; add them on the product first", { kitProductId: ["The kit has no components"] });
  validateSources(tx, input, bom);
  return { kit, bom };
}

function validateSources(tx: Tx, input: WorkOrderInput, bom: Validated["bom"]): void {
  const errors: Record<string, string[]> = {};
  bom.forEach((b, index) => {
    const at = input.components.findIndex((c) => c.componentProductId === b.componentProductId);
    const src = at >= 0 ? input.components[at] : undefined;
    // Field paths follow the request's component order (the wizard maps them back to cards).
    const path = `components.${at >= 0 ? at : index}.locationId`;
    if (input.type === "Work Order without Picking" && !src?.locationId) {
      errors[path] = [`Choose a source location for ${b.sku}`];
      return;
    }
    if (src?.locationId) {
      const loc = tx.select().from(schema.locations).where(eq(schema.locations.id, src.locationId)).get();
      if (!loc || loc.warehouseId !== input.warehouseId) errors[path] = [`The source location of ${b.sku} is in another warehouse`];
    }
  });
  if (Object.keys(errors).length > 0) throw validationError(Object.values(errors)[0]?.[0] ?? "Choose component sources", errors);
}

function assertUniqueCode(tx: Tx, code: string, exceptId?: string): void {
  const hit = tx.select({ id: wo.id }).from(wo).where(eq(wo.code, code)).get();
  if (hit && hit.id !== exceptId) throw new AppError("DUPLICATE", `Work order code ${code} already exists`, { fieldErrors: { code: [`${code} is already used`] } });
}

function writeComponents(tx: Tx, ctx: DomainCtx, record: WorkOrderRecord, input: WorkOrderInput, bom: Validated["bom"], previous: readonly (typeof schema.workOrderComponents.$inferSelect)[]): void {
  for (const b of bom) {
    const src = input.components.find((c) => c.componentProductId === b.componentProductId);
    const values = {
      componentQty: b.quantity, totalQty: b.quantity * input.requestedQty, packType: b.packType || b.uom,
      locationId: src?.locationId ?? null, lpId: src?.lpId ?? null, lotNumber: src?.lotNumber ?? null, expiryDate: src?.expiryDate ?? null, productionDate: src?.productionDate ?? null,
    };
    const prev = previous.find((p) => p.componentProductId === b.componentProductId);
    if (!prev) {
      tx.insert(schema.workOrderComponents).values({ workOrderId: record.id, componentProductId: b.componentProductId, ...values }).run();
      continue;
    }
    tx.update(schema.workOrderComponents).set(values).where(eq(schema.workOrderComponents.id, prev.id)).run();
    const locCode = (id: string | null) => (id ? tx.select({ code: schema.locations.code }).from(schema.locations).where(eq(schema.locations.id, id)).get()?.code ?? id : null);
    for (const [field, from, to] of [
      ["totalQty", prev.totalQty, values.totalQty], ["locationId", locCode(prev.locationId), locCode(values.locationId)],
      ["lotNumber", prev.lotNumber, values.lotNumber], ["expiryDate", prev.expiryDate, values.expiryDate],
    ] as const) {
      changeLog.recordLine(tx, ctx, { entityType: WO_ENTITY, entityId: record.id, entityCode: record.code, lineEntityType: "work_order_component", lineEntityId: prev.id, lineLabel: b.sku, field, from, to });
    }
  }
  const keep = new Set(bom.map((b) => b.componentProductId));
  const stale = previous.filter((p) => !keep.has(p.componentProductId)).map((p) => p.id);
  if (stale.length) tx.delete(schema.workOrderComponents).where(inArray(schema.workOrderComponents.id, stale)).run();
}

function baseValues(input: WorkOrderInput) {
  return {
    warehouseId: input.warehouseId, clientId: input.clientId, type: input.type, buildFor: input.buildFor,
    shipmentOrderId: input.buildFor === "SO" ? input.shipmentOrderId : null, kitProductId: input.kitProductId, requestedQty: input.requestedQty,
    extraNote: input.extraNote, kittingInstructions: input.kittingInstructions, plannedStartAt: input.plannedStartAt, plannedFinishAt: input.plannedFinishAt,
    actualStartAt: input.actualStartAt, actualFinishAt: input.actualFinishAt, customFields: input.customFields,
  };
}

/** The default kitting area of a warehouse (first Kitting area location). */
export function defaultKittingLocation(tx: Tx, warehouseId: string): string | null {
  return tx.select({ id: schema.locations.id }).from(schema.locations)
    .where(and(eq(schema.locations.warehouseId, warehouseId), eq(schema.locations.areaType, "Kitting"), eq(schema.locations.isActive, true)))
    .orderBy(asc(schema.locations.code)).get()?.id ?? null;
}

export function createWorkOrder(tx: Tx, ctx: DomainCtx & { scope: Scope }, input: WorkOrderInput): WorkOrderRecord {
  const { bom } = validateInput(tx, ctx.scope, input);
  const code = input.code.trim();
  assertUniqueCode(tx, code);
  if (code === sequences.peek(tx, "workOrder")) sequences.next(tx, "workOrder");
  const record = tx.insert(wo).values({
    code, ...baseValues(input), outputLocationId: defaultKittingLocation(tx, input.warehouseId), createdBy: ctx.userId, updatedBy: ctx.userId,
  }).returning().get();
  writeComponents(tx, ctx, record, input, bom, []);
  changeLog.recordCreate(tx, ctx, { entityType: WO_ENTITY, entityId: record.id, entityCode: record.code });
  return record;
}

const LOCKED_AFTER_OPEN = ["warehouseId", "clientId", "kitProductId", "requestedQty", "type"] as const;

export function updateWorkOrder(tx: Tx, ctx: DomainCtx & { scope: Scope }, idOrCode: string, version: number, input: WorkOrderInput): WorkOrderRecord {
  const before = loadWorkOrder(tx, ctx.scope, idOrCode);
  assertVersion(before.version, version);
  if (before.status === "Completed" || before.status === "Cancelled") throw new AppError("INVALID_STATE", `${before.status} work orders can't be edited.`);
  if (before.status !== "Open") {
    const changed = LOCKED_AFTER_OPEN.filter((f) => before[f] !== input[f]);
    if (changed.length) throw new AppError("INVALID_STATE", "Warehouse, client, type, kit and quantity can only change while the work order is Open.", { fieldErrors: Object.fromEntries(changed.map((f) => [f, ["Locked after picking started"]])) });
  }
  const { bom } = validateInput(tx, ctx.scope, input);
  const code = input.code.trim();
  assertUniqueCode(tx, code, before.id);
  const previous = tx.select().from(schema.workOrderComponents).where(eq(schema.workOrderComponents.workOrderId, before.id)).all();
  const after = tx.update(wo).set({ code, ...baseValues(input), updatedBy: ctx.userId, version: sql`${wo.version} + 1` }).where(eq(wo.id, before.id)).returning().get();
  writeComponents(tx, ctx, after, input, bom, previous);
  changeLog.recordUpdate(tx, ctx, { entityType: WO_ENTITY, entityId: after.id, entityCode: after.code, before: snapshot(tx, before), after: snapshot(tx, after) });
  return after;
}

export function deleteWorkOrder(tx: Tx, ctx: DomainCtx & { scope: Scope }, idOrCode: string): WorkOrderRecord {
  const record = loadWorkOrder(tx, ctx.scope, idOrCode);
  if (record.status !== "Open") throw new AppError("INVALID_STATE", `Only Open work orders can be deleted; ${record.code} is ${record.status}.`);
  const holds = tx.select({ n: count() }).from(schema.inventoryAllocations)
    .where(and(eq(schema.inventoryAllocations.workOrderId, record.id), inArray(schema.inventoryAllocations.status, ["Allocated", "Picked"]))).get()?.n ?? 0;
  if (Number(holds) > 0) throw new AppError("INVALID_STATE", `${record.code} still holds component allocations; cancel picking first.`);
  tx.delete(schema.workOrderComponents).where(eq(schema.workOrderComponents.workOrderId, record.id)).run();
  tx.delete(schema.entityTags).where(and(eq(schema.entityTags.entityType, WO_ENTITY), eq(schema.entityTags.entityId, record.id))).run();
  tx.delete(wo).where(eq(wo.id, record.id)).run();
  changeLog.recordDelete(tx, ctx, { entityType: WO_ENTITY, entityId: record.id, entityCode: record.code });
  return record;
}

/** Stamps processed qty / dates / output attributes and bumps the version. */
export function patchWorkOrder(tx: Tx, ctx: DomainCtx, record: WorkOrderRecord, patch: Partial<typeof schema.workOrders.$inferInsert>): WorkOrderRecord {
  const after = tx.update(wo).set({ ...patch, updatedBy: ctx.userId, version: sql`${wo.version} + 1` }).where(eq(wo.id, record.id)).returning().get();
  const fields = Object.keys(patch) as (keyof WorkOrderRecord)[];
  const pick = (r: WorkOrderRecord) => Object.fromEntries(fields.map((f) => [f, f === "jobId" ? (r.jobId ? tx.select({ code: schema.jobs.code }).from(schema.jobs).where(eq(schema.jobs.id, r.jobId)).get()?.code ?? r.jobId : null) : r[f]]));
  changeLog.recordUpdate(tx, ctx, { entityType: WO_ENTITY, entityId: record.id, entityCode: record.code, before: pick(record), after: pick(after) });
  return after;
}

/** Status pill counts for the current view (the status filter itself is ignored). */
export function workOrderStatusCounts(db: AppDb, scope: Scope, query: GridQuery): Readonly<Record<string, number>> {
  const { where } = compileWorkOrderQuery({ ...query, filters: query.filters.filter((f) => f.field !== "status"), sort: [] });
  const rows = db.select({ status: wo.status, n: count() }).from(wo).where(and(scopedWhere(wo, scope), where)).groupBy(wo.status).all();
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}
