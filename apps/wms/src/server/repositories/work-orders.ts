/**
 * Work order repository (M08): grid list, detail, create, update and delete. Status
 * changes go through `stateMachines.workOrder`, codes through `sequences`, and every
 * write records field-level change log rows with human-readable values.
 */
import { and, count, eq, inArray, ne, sql } from 'drizzle-orm';
import { asc, desc } from '@/server/db/order';
import type { AppDb } from '@/server/api/db';
import { AppError, notFoundError, validationError } from '@/server/api/errors';
import { assertInScope, hasClient, hasWarehouse, scopedWhere, type Scope } from '@/server/auth/scope';
import * as schema from '@/server/db/schema';
import { changeLog, sequences } from '@/server/domain';
import { countLockFor } from '@/server/domain/ledger/count-locks';
import type { DomainCtx, Tx } from '@/server/domain/types';
import type { GridQuery } from '@/server/query/grid-query';
import { buildableKits, shortageRecoverable } from '@/lib/grid-defs/work-orders/wo-coverage';
import { formatInZone } from '@/lib/grid-defs/work-orders/wo-time';
import { woTxnView } from '@/lib/grid-defs/work-orders/wo-transactions';
import { ageInDays, type WorkOrderInput } from '@/lib/grid-defs/work-orders/work-order-model';
import { assertVersion } from './platform-common';
import { componentAvailability } from './work-orders-availability';
import { compileWorkOrderQuery } from './work-orders-grid';
import { forEachSeq, mapSeq } from '@/server/db/sql';

const wo = schema.workOrders;
export type WorkOrderRecord = typeof schema.workOrders.$inferSelect;
export const WO_ENTITY = 'work_order';

export interface TagChipRow {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

export interface WorkOrderRow {
  readonly id: string;
  readonly code: string;
  readonly version: number;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  /** IANA zone of the warehouse; every M08 timestamp is shown in it, with a zone suffix. */
  readonly warehouseTimeZone: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly status: WorkOrderRecord['status'];
  readonly age: number;
  readonly operationType: string;
  readonly type: WorkOrderRecord['type'];
  readonly buildFor: WorkOrderRecord['buildFor'];
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
  /** With picking: non-cancelled Picking tasks, and how many are completed (Create Kit gate). */
  readonly pickTaskCount: number;
  readonly pickDoneCount: number;
  /** Shortage only: kits usable stock (plus what the WO holds) can build now; null otherwise. */
  readonly buildableQty: number | null;
  /** Shortage only: usable stock now covers every remaining kit (list flag "Stock now available"). */
  readonly stockNowAvailable: boolean;
}

async function tagsFor(db: AppDb, ids: readonly string[]): Promise<Map<string, TagChipRow[]>> {
  const out = new Map<string, TagChipRow[]>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      entityId: schema.entityTags.entityId,
      id: schema.tags.id,
      name: schema.tags.name,
      color: schema.tags.color,
    })
    .from(schema.entityTags)
    .innerJoin(schema.tags, eq(schema.tags.id, schema.entityTags.tagId))
    .where(and(eq(schema.entityTags.entityType, WO_ENTITY), inArray(schema.entityTags.entityId, [...ids])))
    .orderBy(asc(schema.tags.name));
  for (const r of rows)
    out.set(r.entityId, [...(out.get(r.entityId) ?? []), { id: r.id, name: r.name, color: r.color }]);
  return out;
}

async function hydrate(
  db: AppDb,
  records: readonly WorkOrderRecord[],
  now = new Date(),
): Promise<WorkOrderRow[]> {
  if (records.length === 0) return [];
  const whIds = [...new Set(records.map((r) => r.warehouseId))];
  const clIds = [...new Set(records.map((r) => r.clientId))];
  const kitIds = [...new Set(records.map((r) => r.kitProductId))];
  const jobIds = records.flatMap((r) => (r.jobId ? [r.jobId] : []));
  const soIds = records.flatMap((r) => (r.shipmentOrderId ? [r.shipmentOrderId] : []));
  const whRows = await db
    .select({ id: schema.warehouses.id, code: schema.warehouses.code, tz: schema.warehouses.timezone })
    .from(schema.warehouses)
    .where(inArray(schema.warehouses.id, whIds));
  const whs = new Map(whRows.map((w) => [w.id, w.code]));
  const zones = new Map(whRows.map((w) => [w.id, w.tz ?? 'America/Chicago']));
  const cls = new Map(
    (
      await db
        .select({ id: schema.clients.id, name: schema.clients.name })
        .from(schema.clients)
        .where(inArray(schema.clients.id, clIds))
    ).map((c) => [c.id, c.name]),
  );
  const kits = new Map(
    (
      await db
        .select({ id: schema.products.id, sku: schema.products.sku, name: schema.products.name })
        .from(schema.products)
        .where(inArray(schema.products.id, kitIds))
    ).map((p) => [p.id, p]),
  );
  const jobs = new Map(
    jobIds.length
      ? (
          await db
            .select({ id: schema.jobs.id, code: schema.jobs.code })
            .from(schema.jobs)
            .where(inArray(schema.jobs.id, jobIds))
        ).map((j) => [j.id, j.code])
      : [],
  );
  const sos = new Map(
    soIds.length
      ? (
          await db
            .select({ id: schema.shipmentOrders.id, code: schema.shipmentOrders.code })
            .from(schema.shipmentOrders)
            .where(inArray(schema.shipmentOrders.id, soIds))
        ).map((s) => [s.id, s.code])
      : [],
  );
  const tags = await tagsFor(
    db,
    records.map((r) => r.id),
  );
  const pickIds = records.filter((r) => r.type === 'Work Order with Picking').map((r) => r.id);
  const picks = new Map(
    pickIds.length
      ? (
          await db
            .select({
              id: schema.tasks.workOrderId,
              total: count(),
              done: sql<number>`SUM(CASE WHEN ${schema.tasks.status} = 'Completed' THEN 1 ELSE 0 END)`,
            })
            .from(schema.tasks)
            .where(
              and(
                inArray(schema.tasks.workOrderId, pickIds),
                eq(schema.tasks.taskType, 'Picking'),
                ne(schema.tasks.status, 'Cancelled'),
              ),
            )
            .groupBy(schema.tasks.workOrderId)
        ).map((p) => [p.id ?? '', { total: Number(p.total), done: Number(p.done ?? 0) }])
      : [],
  );
  // Shortage rows: lock-aware buildable kits (same reading as the detail page), so the list can
  // flag "Stock now available, retry allocation" without opening each work order.
  const buildable = new Map(
    await mapSeq(
      records.filter((r) => r.status === 'Shortage'),
      async (r) => [r.id, buildableKits(await listComponents(db, r), r.type === 'Work Order with Picking')],
    ),
  );
  return records.map((r) => {
    const t = tags.get(r.id) ?? [];
    const buildableQty = buildable.get(r.id) ?? null;
    return {
      id: r.id,
      code: r.code,
      version: r.version,
      warehouseId: r.warehouseId,
      warehouseCode: whs.get(r.warehouseId) ?? '',
      warehouseTimeZone: zones.get(r.warehouseId) ?? 'America/Chicago',
      clientId: r.clientId,
      clientName: cls.get(r.clientId) ?? '',
      status: r.status,
      age: ageInDays(r.createdAt, now),
      operationType: r.operationType,
      type: r.type,
      buildFor: r.buildFor,
      shipmentOrderId: r.shipmentOrderId,
      shipmentOrderCode: r.shipmentOrderId ? (sos.get(r.shipmentOrderId) ?? null) : null,
      tags: t,
      tagNames: t.map((x) => x.name).join(', '),
      jobId: r.jobId,
      jobCode: r.jobId ? (jobs.get(r.jobId) ?? null) : null,
      kitProductId: r.kitProductId,
      kitSku: kits.get(r.kitProductId)?.sku ?? '',
      kitName: kits.get(r.kitProductId)?.name ?? '',
      requestedQty: r.requestedQty,
      processedQty: r.processedQty,
      extraNote: r.extraNote,
      kittingInstructions: r.kittingInstructions,
      createdAt: r.createdAt,
      createdBy: r.createdBy,
      updatedAt: r.updatedAt,
      plannedStartAt: r.plannedStartAt,
      plannedFinishAt: r.plannedFinishAt,
      actualStartAt: r.actualStartAt,
      actualFinishAt: r.actualFinishAt,
      cancelledAt: r.cancelledAt,
      outputLocationId: r.outputLocationId,
      outputLot: r.outputLot,
      outputExpiry: r.outputExpiry,
      customFields: r.customFields ?? {},
      pickTaskCount: picks.get(r.id)?.total ?? 0,
      pickDoneCount: picks.get(r.id)?.done ?? 0,
      buildableQty,
      stockNowAvailable: shortageRecoverable({
        status: r.status,
        buildableQty,
        remainingQty: r.requestedQty - r.processedQty,
      }),
    };
  });
}

export interface Paged<T> {
  readonly rows: readonly T[];
  readonly total: number;
}

/** Grid list in the viewer's (context-narrowed) scope. */
export async function listWorkOrders(
  db: AppDb,
  scope: Scope,
  query: GridQuery,
): Promise<Paged<WorkOrderRow>> {
  const { where, orderBy } = compileWorkOrderQuery(query);
  const scoped = scopedWhere(wo, scope);
  const cond = and(scoped, where);
  const total = (await db.select({ n: count() }).from(wo).where(cond).limit(1))[0]?.n ?? 0;
  const records = await db
    .select()
    .from(wo)
    .where(cond)
    .orderBy(...orderBy)
    .limit(query.pageSize)
    .offset((Math.max(1, query.page) - 1) * query.pageSize);
  return { rows: await hydrate(db, records), total: Number(total) };
}

/** Loads a work order by id or code; cross-scope → 404. */
export async function loadWorkOrder(db: AppDb, scope: Scope, idOrCode: string): Promise<WorkOrderRecord> {
  const record = (
    await db
      .select()
      .from(wo)
      .where(sql`${wo.id} = ${idOrCode} OR ${wo.code} = ${idOrCode}`)
      .limit(1)
  )[0];
  if (!record) throw notFoundError('Work order');
  assertInScope(scope, record, 'Work order');
  return record;
}

export async function getWorkOrderRow(db: AppDb, scope: Scope, idOrCode: string): Promise<WorkOrderRow> {
  const [row] = await hydrate(db, [await loadWorkOrder(db, scope, idOrCode)]);
  if (!row) throw notFoundError('Work order');
  return row;
}

export async function getWorkOrderRows(
  db: AppDb,
  scope: Scope,
  ids: readonly string[],
): Promise<WorkOrderRow[]> {
  if (ids.length === 0) return [];
  const records = await db
    .select()
    .from(wo)
    .where(and(inArray(wo.id, [...ids]), scopedWhere(wo, scope)));
  return await hydrate(db, records);
}

export async function nextWorkOrderCode(db: AppDb): Promise<string> {
  return await sequences.peek(db, 'workOrder');
}

/* ------------------------------------------------------------- detail */

export interface ComponentRow {
  readonly id: string;
  readonly componentProductId: string;
  readonly sku: string;
  readonly name: string;
  /** Product barcode/UPC (labels print it; SKU only when none). */
  readonly barcode: string | null;
  readonly packType: string;
  readonly componentQty: number;
  readonly totalQty: number;
  readonly allocatedQty: number;
  readonly pickedQty: number;
  readonly consumedQty: number;
  /** Live usable free stock (lock-aware, same rule as FEFO allocation) in the work order's warehouse. */
  readonly freeQty: number;
  /** Free stock sitting in count-locked locations (not usable until the count ends). */
  readonly lockedQty: number;
  /** Count plans locking that stock. */
  readonly lockedBy: readonly string[];
  /** Stock this work order can draw on: the chosen source's free qty (0 when count-locked), else `freeQty`. */
  readonly availableQty: number;
  /** Free stock at the chosen source bucket (location + LP + lot); null when no source is chosen (FEFO). */
  readonly sourceFreeQty: number | null;
  /** With picking: units picked to the kitting area for this work order and not consumed yet. */
  readonly inKittingAreaQty: number;
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
  /** Count plan code that locks the chosen source location (stock can't move out until the count is done). */
  readonly sourceLockedBy: string | null;
}

export async function listComponents(db: AppDb, record: WorkOrderRecord): Promise<ComponentRow[]> {
  const c = schema.workOrderComponents;
  const rows = await db
    .select({ c, p: schema.products, loc: schema.locations.code, lp: schema.licensePlates.number })
    .from(c)
    .innerJoin(schema.products, eq(schema.products.id, c.componentProductId))
    .leftJoin(schema.locations, eq(schema.locations.id, c.locationId))
    .leftJoin(schema.licensePlates, eq(schema.licensePlates.id, c.lpId))
    .where(eq(c.workOrderId, record.id))
    .orderBy(asc(schema.products.sku));
  const i = schema.inventory;
  const avail = await componentAvailability(db as unknown as Tx, {
    warehouseId: record.warehouseId,
    clientId: record.clientId,
    productIds: rows.map((r) => r.c.componentProductId),
  });
  const a = schema.inventoryAllocations;
  const picked = new Map(
    (
      await db
        .select({ id: a.workOrderComponentId, qty: sql<number>`COALESCE(SUM(${a.qty}), 0)` })
        .from(a)
        .where(and(eq(a.workOrderId, record.id), eq(a.status, 'Picked')))
        .groupBy(a.workOrderComponentId)
    ).map((r) => [r.id ?? '', Number(r.qty)]),
  );
  return await mapSeq(rows, async ({ c: row, p, loc, lp }) => {
    const remaining = Math.max(0, row.totalQty - row.consumedQty - row.allocatedQty);
    const av = avail.get(row.componentProductId);
    const freeQty = av?.usableQty ?? 0;
    let sourceFreeQty: number | null = null;
    if (row.locationId) {
      const conds = [
        eq(i.warehouseId, record.warehouseId),
        eq(i.clientId, record.clientId),
        eq(i.productId, row.componentProductId),
        eq(i.locationId, row.locationId),
        eq(i.status, 'Stock'),
        sql`${i.damageReason} IS NULL`,
      ];
      if (row.lpId) conds.push(eq(i.lpId, row.lpId));
      if (row.lotNumber) conds.push(eq(i.lotNumber, row.lotNumber));
      const got = (
        await db
          .select({ free: sql<number>`COALESCE(SUM(${i.onHand} - ${i.allocated}), 0)` })
          .from(i)
          .where(and(...conds))
          .limit(1)
      )[0];
      sourceFreeQty = Math.max(0, Number(got?.free ?? 0));
    }
    const sourceLockedBy = row.locationId ? await countLockFor(db, row.locationId) : null;
    // What this work order can actually draw on: its chosen source (0 while a count locks it), else FEFO's usable stock.
    const availableQty = row.locationId ? (sourceLockedBy ? 0 : (sourceFreeQty ?? 0)) : freeQty;
    return {
      availableQty,
      sourceLockedBy,
      id: row.id,
      componentProductId: row.componentProductId,
      sku: p.sku,
      name: p.name,
      barcode: p.barcode ?? null,
      packType: row.packType,
      componentQty: row.componentQty,
      totalQty: row.totalQty,
      allocatedQty: row.allocatedQty,
      pickedQty: Math.max(row.pickedQty, picked.get(row.id) ?? 0),
      consumedQty: row.consumedQty,
      freeQty,
      lockedQty: av?.lockedQty ?? 0,
      lockedBy: av?.lockedBy ?? [],
      sourceFreeQty,
      inKittingAreaQty: picked.get(row.id) ?? 0,
      shortQty: Math.max(0, remaining - availableQty),
      locationId: row.locationId,
      locationCode: loc ?? null,
      lpId: row.lpId,
      lpNumber: lp ?? null,
      lotNumber: row.lotNumber,
      expiryDate: row.expiryDate,
      productionDate: row.productionDate,
      trackLot: p.trackLot,
      trackExpiry: p.trackExpiry,
      trackProductionDate: p.trackProductionDate,
    };
  });
}

export interface WorkOrderDetail {
  readonly workOrder: WorkOrderRow;
  readonly kit: {
    readonly id: string;
    readonly sku: string;
    readonly name: string;
    readonly barcode: string | null;
    readonly packType: string;
    readonly kitType: string | null;
    readonly trackLot: boolean;
    readonly trackExpiry: boolean;
    readonly trackProductionDate: boolean;
  };
  readonly outputLocationCode: string | null;
  readonly warehouseTimeZone: string;
  readonly components: readonly ComponentRow[];
  readonly job: {
    readonly id: string;
    readonly code: string;
    readonly status: string;
    readonly jobType: string;
    readonly taskCount: number;
    readonly completedTaskCount: number;
    readonly assigneeName: string | null;
  } | null;
  readonly tasks: readonly {
    readonly id: string;
    readonly taskNo: number;
    readonly taskType: string;
    readonly status: string;
    readonly sku: string | null;
    readonly plannedQty: number;
    readonly actualQty: number;
    readonly sourceLocationCode: string | null;
    readonly targetLocationCode: string | null;
  }[];
  readonly receipts: readonly {
    readonly id: string;
    readonly masterId: number;
    readonly type: string;
    readonly sku: string;
    readonly quantity: number;
    readonly locationCode: string;
    readonly lotNumber: string | null;
    readonly receivedAt: string;
    readonly receivedBy: string;
    readonly cancelledAt: string | null;
  }[];
  readonly transactions: readonly {
    readonly id: string;
    readonly seq: number;
    readonly type: string;
    readonly ledgerType: string;
    readonly direction: 'in' | 'out' | 'move';
    readonly sku: string;
    readonly qty: number;
    readonly fromLocationCode: string | null;
    readonly toLocationCode: string | null;
    readonly createdAt: string;
    readonly source: string;
  }[];
  readonly timeline: readonly {
    readonly id: string;
    readonly type: string;
    readonly message: string;
    readonly source: string;
    readonly at: string;
  }[];
  readonly exceptions: readonly {
    readonly id: string;
    readonly sku: string | null;
    readonly explanation: string;
    readonly inventoryQty: number | null;
    readonly requiredQty: number | null;
    readonly runAt: string;
    readonly runBy: string;
  }[];
  /** Component lots/dates consumed at kitting (largest first): Disassemble prefills them for traceability. */
  readonly consumedAttributes: readonly {
    readonly productId: string;
    readonly lotNumber: string | null;
    readonly expiryDate: string | null;
    readonly productionDate: string | null;
    readonly qty: number;
  }[];
}

export async function getWorkOrderDetail(
  db: AppDb,
  scope: Scope,
  idOrCode: string,
): Promise<WorkOrderDetail> {
  const record = await loadWorkOrder(db, scope, idOrCode);
  const [row] = await hydrate(db, [record]);
  const kit = (
    await db.select().from(schema.products).where(eq(schema.products.id, record.kitProductId)).limit(1)
  )[0];
  if (!row || !kit) throw notFoundError('Work order');
  const loc = async (id: string | null) =>
    id
      ? ((
          await db
            .select({ code: schema.locations.code })
            .from(schema.locations)
            .where(eq(schema.locations.id, id))
            .limit(1)
        )[0]?.code ?? null)
      : null;
  const job = record.jobId
    ? (
        await db
          .select({ j: schema.jobs, name: schema.users.name })
          .from(schema.jobs)
          .leftJoin(schema.users, eq(schema.users.id, schema.jobs.assignedToUserId))
          .where(eq(schema.jobs.id, record.jobId))
          .limit(1)
      )[0]
    : undefined;
  const t = schema.tasks;
  const src = sql<string | null>`(SELECT l.code FROM locations l WHERE l.id = ${t.sourceLocationId})`;
  const tgt = sql<string | null>`(SELECT l.code FROM locations l WHERE l.id = ${t.targetLocationId})`;
  const tasks = (
    await db
      .select({ t, sku: schema.products.sku, src, tgt })
      .from(t)
      .leftJoin(schema.products, eq(schema.products.id, t.productId))
      .where(eq(t.workOrderId, record.id))
      .orderBy(sql`COALESCE(${t.sequence}, 1e9)`, asc(t.taskNo))
  ).map((r) => ({
    id: r.t.id,
    taskNo: r.t.taskNo,
    taskType: r.t.taskType,
    status: r.t.status,
    sku: r.sku ?? null,
    plannedQty: r.t.plannedQty,
    actualQty: r.t.actualQty,
    sourceLocationCode: r.src,
    targetLocationCode: r.tgt,
  }));
  const rc = schema.receipts;
  const receipts = (
    await db
      .select({ r: rc, sku: schema.products.sku, loc: schema.locations.code })
      .from(rc)
      .innerJoin(schema.products, eq(schema.products.id, rc.productId))
      .innerJoin(schema.locations, eq(schema.locations.id, rc.locationId))
      .where(eq(rc.workOrderId, record.id))
      .orderBy(desc(rc.receivedAt))
  ).map(({ r, sku, loc: code }) => ({
    id: r.id,
    masterId: r.masterId,
    type: r.type,
    sku,
    quantity: r.quantity,
    locationCode: code,
    lotNumber: r.lotNumber,
    receivedAt: r.receivedAt,
    receivedBy: r.receivedBy,
    cancelledAt: r.cancelledAt,
  }));
  const it = schema.inventoryTransactions;
  // Picking moves carry job/task refs, not work_order_id: include rows of this WO's tasks.
  const txCols = await db
    .select()
    .from(it)
    .where(
      sql`${it.workOrderId} = ${record.id} OR ${it.taskId} IN (SELECT id FROM tasks WHERE work_order_id = ${record.id})`,
    )
    .orderBy(desc(it.seq))
    .limit(200);
  const receiptIds = [...new Set(txCols.flatMap((x) => (x.receiptId ? [x.receiptId] : [])))];
  const receiptType = new Map(
    receiptIds.length
      ? (await db.select({ id: rc.id, type: rc.type }).from(rc).where(inArray(rc.id, receiptIds))).map(
          (r) => [r.id, r.type] as const,
        )
      : [],
  );
  const locCodes = new Map(
    (
      await db
        .select({ id: schema.locations.id, code: schema.locations.code })
        .from(schema.locations)
        .where(eq(schema.locations.warehouseId, record.warehouseId))
    ).map((l) => [l.id, l.code]),
  );
  const skuOf = new Map<string, string>();
  const skus = async (ids: readonly string[]) => {
    const missing = ids.filter((id) => !skuOf.has(id));
    if (missing.length)
      for (const p of await db
        .select({ id: schema.products.id, sku: schema.products.sku })
        .from(schema.products)
        .where(inArray(schema.products.id, missing)))
        skuOf.set(p.id, p.sku);
  };
  await skus([...new Set(txCols.map((x) => x.productId))]);
  const transactions = txCols.map((x) => {
    const v = woTxnView(
      {
        type: x.type,
        qty: x.uomQty,
        productId: x.productId,
        fromLocationId: x.fromLocationId,
        toLocationId: x.toLocationId,
        receiptType: x.receiptId ? (receiptType.get(x.receiptId) ?? null) : null,
      },
      record.kitProductId,
    );
    return {
      id: x.id,
      seq: x.seq,
      type: v.label,
      ledgerType: x.type,
      direction: v.direction,
      sku: skuOf.get(x.productId) ?? '',
      qty: v.qty,
      fromLocationCode: x.fromLocationId ? (locCodes.get(x.fromLocationId) ?? null) : null,
      toLocationCode: x.toLocationId ? (locCodes.get(x.toLocationId) ?? null) : null,
      createdAt: x.at,
      source: x.source,
    };
  });
  const cl = schema.changeLog;
  const timeline = (
    await db
      .select()
      .from(cl)
      .where(
        sql`(${cl.entityType} = ${WO_ENTITY} AND ${cl.entityId} = ${record.id}) OR (${cl.parentEntityType} = ${WO_ENTITY} AND ${cl.parentEntityId} = ${record.id})`,
      )
      .orderBy(desc(cl.at))
      .limit(100)
  ).map((c) => ({ id: c.id, type: c.type, message: c.message, source: c.source, at: c.at }));
  const consumedAttributes = (
    await db
      .select({
        productId: it.productId,
        lotNumber: it.fromLot,
        expiryDate: it.fromExpiry,
        productionDate: it.fromProductionDate,
        qty: sql<number>`SUM(ABS(${it.uomQty}))`,
      })
      .from(it)
      .where(
        and(
          eq(it.workOrderId, record.id),
          eq(it.type, 'Kitting'),
          sql`${it.productId} <> ${record.kitProductId}`,
          sql`${it.fromLocationId} IS NOT NULL`,
        ),
      )
      .groupBy(it.productId, it.fromLot, it.fromExpiry, it.fromProductionDate)
      .orderBy(desc(sql`SUM(ABS(${it.uomQty}))`))
  ).map((r) => ({
    productId: r.productId,
    lotNumber: r.lotNumber,
    expiryDate: r.expiryDate,
    productionDate: r.productionDate,
    qty: Number(r.qty),
  }));
  const ae = schema.allocationExceptions;
  const exc = await db.select().from(ae).where(eq(ae.orderId, record.id)).orderBy(desc(ae.runAt)).limit(50);
  await skus(exc.flatMap((e) => (e.shortageProductId ? [e.shortageProductId] : [])));
  const exceptions = exc.map((e) => ({
    id: e.id,
    sku: e.shortageProductId ? (skuOf.get(e.shortageProductId) ?? null) : null,
    explanation: e.explanation,
    inventoryQty: e.inventoryUomQty,
    requiredQty: e.orderLineQty,
    runAt: e.runAt,
    runBy: e.runBy,
  }));
  return {
    workOrder: row,
    kit: {
      id: kit.id,
      sku: kit.sku,
      name: kit.name,
      barcode: kit.barcode ?? null,
      packType: kit.uom,
      kitType: kit.kitType,
      trackLot: kit.trackLot,
      trackExpiry: kit.trackExpiry,
      trackProductionDate: kit.trackProductionDate,
    },
    outputLocationCode: await loc(record.outputLocationId),
    warehouseTimeZone: await warehouseZone(db as unknown as Tx, record.warehouseId),
    components: await listComponents(db, record),
    job: job
      ? {
          id: job.j.id,
          code: job.j.code,
          status: job.j.status,
          jobType: job.j.jobType,
          taskCount: job.j.taskCount,
          completedTaskCount: job.j.completedTaskCount,
          assigneeName: job.name ?? null,
        }
      : null,
    tasks,
    receipts,
    transactions,
    timeline,
    exceptions,
    consumedAttributes,
  };
}

/* ----------------------------------------------------------- mutations */

async function display(
  tx: Tx,
  record: Pick<WorkOrderRecord, 'warehouseId' | 'clientId' | 'kitProductId' | 'shipmentOrderId'>,
): Promise<Record<string, string | null>> {
  const wh =
    (
      await tx
        .select({ code: schema.warehouses.code })
        .from(schema.warehouses)
        .where(eq(schema.warehouses.id, record.warehouseId))
        .limit(1)
    )[0]?.code ?? null;
  const cl =
    (
      await tx
        .select({ name: schema.clients.name })
        .from(schema.clients)
        .where(eq(schema.clients.id, record.clientId))
        .limit(1)
    )[0]?.name ?? null;
  const kit =
    (
      await tx
        .select({ sku: schema.products.sku })
        .from(schema.products)
        .where(eq(schema.products.id, record.kitProductId))
        .limit(1)
    )[0]?.sku ?? null;
  const so = record.shipmentOrderId
    ? ((
        await tx
          .select({ code: schema.shipmentOrders.code })
          .from(schema.shipmentOrders)
          .where(eq(schema.shipmentOrders.id, record.shipmentOrderId))
          .limit(1)
      )[0]?.code ?? null)
    : null;
  return { warehouseId: wh, clientId: cl, kitProductId: kit, shipmentOrderId: so };
}

/** Snapshot of the editable fields with ids replaced by codes/names (change log values). */
async function snapshot(tx: Tx, r: WorkOrderRecord): Promise<Record<string, unknown>> {
  return {
    code: r.code,
    type: r.type,
    buildFor: r.buildFor,
    requestedQty: r.requestedQty,
    extraNote: r.extraNote,
    kittingInstructions: r.kittingInstructions,
    plannedStartAt: r.plannedStartAt,
    plannedFinishAt: r.plannedFinishAt,
    actualStartAt: r.actualStartAt,
    actualFinishAt: r.actualFinishAt,
    customFields: r.customFields,
    ...(await display(tx, r)),
  };
}

interface Validated {
  readonly kit: typeof schema.products.$inferSelect;
  readonly bom: readonly (typeof schema.kitComponents.$inferSelect & {
    readonly sku: string;
    readonly uom: string;
  })[];
}

async function validateInput(
  tx: Tx,
  scope: Scope,
  input: WorkOrderInput,
  previous: readonly (typeof schema.workOrderComponents.$inferSelect)[] = [],
): Promise<Validated> {
  const fieldErrors: Record<string, string[]> = {};
  if (!hasWarehouse(scope, input.warehouseId)) fieldErrors.warehouseId = ['Warehouse not found'];
  if (!hasClient(scope, input.clientId)) fieldErrors.clientId = ['Client not found'];
  const kit = (
    await tx.select().from(schema.products).where(eq(schema.products.id, input.kitProductId)).limit(1)
  )[0];
  if (!kit || !kit.isKit) fieldErrors.kitProductId = ['Select a kit'];
  else if (kit.clientId !== input.clientId) fieldErrors.kitProductId = ['The kit belongs to another client'];
  else if (kit.kitType !== 'Kit to Stock')
    fieldErrors.kitProductId = ['Only kit-to-stock products can be built by a work order'];
  if (input.buildFor === 'SO' && input.shipmentOrderId) {
    const so = (
      await tx
        .select()
        .from(schema.shipmentOrders)
        .where(eq(schema.shipmentOrders.id, input.shipmentOrderId))
        .limit(1)
    )[0];
    if (!so || so.deletedAt || so.warehouseId !== input.warehouseId || so.clientId !== input.clientId)
      fieldErrors.shipmentOrderId = ['Select a shipment order of this warehouse and client'];
    else if (so.status === 'Shipped' || so.status === 'Cancelled' || so.status === 'Delivered')
      fieldErrors.shipmentOrderId = [`Order ${so.code} is ${so.status}`];
  }
  if (Object.keys(fieldErrors).length > 0 || !kit)
    throw validationError(Object.values(fieldErrors)[0]?.[0] ?? 'Check the highlighted fields', fieldErrors);
  const bom = (
    await tx
      .select({ k: schema.kitComponents, sku: schema.products.sku, uom: schema.products.uom })
      .from(schema.kitComponents)
      .innerJoin(schema.products, eq(schema.products.id, schema.kitComponents.componentProductId))
      .where(eq(schema.kitComponents.kitProductId, kit.id))
  ).map((r) => ({ ...r.k, sku: r.sku, uom: r.uom }));
  if (bom.length === 0)
    throw validationError('This kit has no components; add them on the product first', {
      kitProductId: ['The kit has no components'],
    });
  await validateSources(tx, input, bom, previous);
  return { kit, bom };
}

type ComponentRecord = typeof schema.workOrderComponents.$inferSelect;

/**
 * Component sources: required without picking, in the work order's warehouse, and not in a
 * location an open count plan locks. The lock check runs for new or changed sources only, so an
 * unchanged source that a count locked later doesn't block editing notes (Create Kit still
 * refuses to post from it).
 */
async function validateSources(
  tx: Tx,
  input: WorkOrderInput,
  bom: Validated['bom'],
  previous: readonly ComponentRecord[] = [],
): Promise<void> {
  const errors: Record<string, string[]> = {};
  await forEachSeq(bom, async (b, index) => {
    const at = input.components.findIndex((c) => c.componentProductId === b.componentProductId);
    const src = at >= 0 ? input.components[at] : undefined;
    // Field paths follow the request's component order (the wizard maps them back to cards).
    const path = `components.${at >= 0 ? at : index}.locationId`;
    if (input.type === 'Work Order without Picking' && !src?.locationId) {
      errors[path] = [`Choose a source location for ${b.sku}`];
      return;
    }
    if (src?.locationId) {
      const loc = (
        await tx.select().from(schema.locations).where(eq(schema.locations.id, src.locationId)).limit(1)
      )[0];
      if (!loc || loc.warehouseId !== input.warehouseId) {
        errors[path] = [`The source location of ${b.sku} is in another warehouse`];
        return;
      }
      const prev = previous.find((p) => p.componentProductId === b.componentProductId);
      const changed = !prev || prev.locationId !== src.locationId;
      const plan = changed ? await countLockFor(tx, loc.id) : null;
      if (plan)
        errors[path] = [`${loc.code} is locked by count plan ${plan}; choose another source for ${b.sku}`];
    }
  });
  if (Object.keys(errors).length > 0)
    throw validationError(Object.values(errors)[0]?.[0] ?? 'Choose component sources', errors);
}

/** True when any component's source (location / LP / lot / dates) differs from the stored one. */
function sourcesChanged(input: WorkOrderInput, previous: readonly ComponentRecord[]): string[] {
  const out: string[] = [];
  input.components.forEach((c, index) => {
    const p = previous.find((x) => x.componentProductId === c.componentProductId);
    if (!p) return;
    const same =
      (p.locationId ?? null) === (c.locationId ?? null) &&
      (p.lpId ?? null) === (c.lpId ?? null) &&
      (p.lotNumber ?? null) === (c.lotNumber ?? null) &&
      (p.expiryDate ?? null) === (c.expiryDate ?? null) &&
      (p.productionDate ?? null) === (c.productionDate ?? null);
    if (!same) out.push(`components.${index}.locationId`);
  });
  return out;
}

/* ------------------------------------------------- change log formatting */

/** Human field labels for work order change log rows (Logiwa wording). */
export const WO_FIELD_LABELS: Readonly<Record<string, string>> = {
  code: 'Work order code',
  type: 'Work order type',
  buildFor: 'Build for',
  requestedQty: 'Kit quantity',
  processedQty: 'Processed quantity',
  extraNote: 'Extra note',
  kittingInstructions: 'Kitting instructions',
  plannedStartAt: 'Planned start date',
  plannedFinishAt: 'Planned finish date',
  actualStartAt: 'Actual start date',
  actualFinishAt: 'Actual finish date',
  cancelledAt: 'Cancelled date',
  status: 'Status',
  warehouseId: 'Warehouse',
  clientId: 'Client',
  kitProductId: 'Kit SKU',
  shipmentOrderId: 'Shipment order',
  jobId: 'Job',
  outputLocationId: 'Output location',
  outputLot: 'Output lot',
  outputExpiry: 'Output expiry date',
  customFields: 'Custom fields',
  disassembledQty: 'Disassembled quantity',
  totalQty: 'Total quantity',
  locationId: 'Source location',
  lotNumber: 'Lot number',
  expiryDate: 'Expiry date',
};

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** "11/9/2026 9:09 PM CST" in the warehouse's timezone; non-dates pass through. */
export function formatLogValue(value: unknown, timeZone: string): unknown {
  if (typeof value !== 'string' || !ISO_DATETIME.test(value)) return value;
  if (Number.isNaN(new Date(value).getTime())) return value;
  return formatInZone(value, timeZone);
}

async function warehouseZone(tx: Tx, warehouseId: string): Promise<string> {
  return (
    (
      await tx
        .select({ tz: schema.warehouses.timezone })
        .from(schema.warehouses)
        .where(eq(schema.warehouses.id, warehouseId))
        .limit(1)
    )[0]?.tz ?? 'America/Chicago'
  );
}

const ID_DISPLAY: Readonly<Partial<Record<string, (tx: Tx, id: string) => Promise<string | null>>>> = {
  outputLocationId: async (tx, id) =>
    (
      await tx
        .select({ v: schema.locations.code })
        .from(schema.locations)
        .where(eq(schema.locations.id, id))
        .limit(1)
    )[0]?.v ?? null,
};

/**
 * Field-level change log for a work order: one row per changed field, with human labels and
 * dates in the warehouse's timezone ("Actual start date is modified. 11/9/2026 9:09 PM CST").
 */
export async function recordWorkOrderChanges(
  tx: Tx,
  ctx: DomainCtx,
  record: Pick<WorkOrderRecord, 'id' | 'code' | 'warehouseId'>,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Promise<number> {
  const zone = await warehouseZone(tx, record.warehouseId);
  const prep = async (snap: Record<string, unknown>) =>
    Object.fromEntries(
      await mapSeq(Object.entries(snap), async ([k, v]) => {
        const resolver = ID_DISPLAY[k];
        const shown = resolver && typeof v === 'string' && v ? ((await resolver(tx, v)) ?? v) : v;
        return [k, formatLogValue(shown, zone)];
      }),
    );
  const changes = changeLog.diffRows(WO_ENTITY, await prep(before), await prep(after));
  if (changes.length === 0) return 0;
  await tx.insert(schema.changeLog).values(
    changes.map((c) => {
      const label = WO_FIELD_LABELS[c.field] ?? c.label;
      return {
        entityType: WO_ENTITY,
        entityId: record.id,
        entityCode: record.code,
        type: 'Update' as const,
        field: c.field,
        fieldLabel: label,
        fromValue: c.from,
        toValue: c.to,
        message: `${label} is modified. ${c.from || '—'} --> ${c.to || '—'}`,
        userId: ctx.userId,
        source: ctx.source,
      };
    }),
  );
  return changes.length;
}

/** True when no other work order uses `code` (wizard on-blur check; Save still enforces it). */
export async function isWorkOrderCodeAvailable(db: AppDb, code: string, exceptId?: string): Promise<boolean> {
  const hit = (await db.select({ id: wo.id }).from(wo).where(eq(wo.code, code.trim())).limit(1))[0];
  return !hit || hit.id === exceptId;
}

async function assertUniqueCode(tx: Tx, code: string, exceptId?: string): Promise<void> {
  const hit = (await tx.select({ id: wo.id }).from(wo).where(eq(wo.code, code)).limit(1))[0];
  if (hit && hit.id !== exceptId)
    throw new AppError('DUPLICATE', `Work order code ${code} already exists`, {
      fieldErrors: { code: [`${code} is already used`] },
    });
}

async function writeComponents(
  tx: Tx,
  ctx: DomainCtx,
  record: WorkOrderRecord,
  input: WorkOrderInput,
  bom: Validated['bom'],
  previous: readonly (typeof schema.workOrderComponents.$inferSelect)[],
): Promise<void> {
  for (const b of bom) {
    const src = input.components.find((c) => c.componentProductId === b.componentProductId);
    const values = {
      componentQty: b.quantity,
      totalQty: b.quantity * input.requestedQty,
      packType: b.packType || b.uom,
      locationId: src?.locationId ?? null,
      lpId: src?.lpId ?? null,
      lotNumber: src?.lotNumber ?? null,
      expiryDate: src?.expiryDate ?? null,
      productionDate: src?.productionDate ?? null,
    };
    const prev = previous.find((p) => p.componentProductId === b.componentProductId);
    if (!prev) {
      await tx
        .insert(schema.workOrderComponents)
        .values({ workOrderId: record.id, componentProductId: b.componentProductId, ...values });
      continue;
    }
    await tx.update(schema.workOrderComponents).set(values).where(eq(schema.workOrderComponents.id, prev.id));
    const locCode = async (id: string | null) =>
      id
        ? ((
            await tx
              .select({ code: schema.locations.code })
              .from(schema.locations)
              .where(eq(schema.locations.id, id))
              .limit(1)
          )[0]?.code ?? id)
        : null;
    for (const [field, from, to] of [
      ['totalQty', prev.totalQty, values.totalQty],
      ['locationId', await locCode(prev.locationId), await locCode(values.locationId)],
      ['lotNumber', prev.lotNumber, values.lotNumber],
      ['expiryDate', prev.expiryDate, values.expiryDate],
    ] as const) {
      await changeLog.recordLine(tx, ctx, {
        entityType: WO_ENTITY,
        entityId: record.id,
        entityCode: record.code,
        lineEntityType: 'work_order_component',
        lineEntityId: prev.id,
        lineLabel: b.sku,
        field,
        from,
        to,
      });
    }
  }
  const keep = new Set(bom.map((b) => b.componentProductId));
  const stale = previous.filter((p) => !keep.has(p.componentProductId)).map((p) => p.id);
  if (stale.length)
    await tx.delete(schema.workOrderComponents).where(inArray(schema.workOrderComponents.id, stale));
}

function baseValues(input: WorkOrderInput) {
  return {
    warehouseId: input.warehouseId,
    clientId: input.clientId,
    type: input.type,
    buildFor: input.buildFor,
    shipmentOrderId: input.buildFor === 'SO' ? input.shipmentOrderId : null,
    kitProductId: input.kitProductId,
    requestedQty: input.requestedQty,
    extraNote: input.extraNote,
    kittingInstructions: input.kittingInstructions,
    plannedStartAt: input.plannedStartAt,
    plannedFinishAt: input.plannedFinishAt,
    actualStartAt: input.actualStartAt,
    actualFinishAt: input.actualFinishAt,
    customFields: input.customFields,
  };
}

/** The default kitting area of a warehouse (first Kitting area location). */
export async function defaultKittingLocation(tx: Tx, warehouseId: string): Promise<string | null> {
  return (
    (
      await tx
        .select({ id: schema.locations.id })
        .from(schema.locations)
        .where(
          and(
            eq(schema.locations.warehouseId, warehouseId),
            eq(schema.locations.areaType, 'Kitting'),
            eq(schema.locations.isActive, true),
          ),
        )
        .orderBy(asc(schema.locations.code))
        .limit(1)
    )[0]?.id ?? null
  );
}

export async function createWorkOrder(
  tx: Tx,
  ctx: DomainCtx & { scope: Scope },
  input: WorkOrderInput,
): Promise<WorkOrderRecord> {
  const { bom } = await validateInput(tx, ctx.scope, input);
  const code = input.code.trim();
  await assertUniqueCode(tx, code);
  if (code === (await sequences.peek(tx, 'workOrder'))) await sequences.next(tx, 'workOrder');
  const record = (
    await tx
      .insert(wo)
      .values({
        code,
        ...baseValues(input),
        outputLocationId: await defaultKittingLocation(tx, input.warehouseId),
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning()
  )[0];
  await writeComponents(tx, ctx, record, input, bom, []);
  await changeLog.recordCreate(tx, ctx, {
    entityType: WO_ENTITY,
    entityId: record.id,
    entityCode: record.code,
  });
  return record;
}

const LOCKED_AFTER_OPEN = ['warehouseId', 'clientId', 'kitProductId', 'requestedQty', 'type'] as const;

export async function updateWorkOrder(
  tx: Tx,
  ctx: DomainCtx & { scope: Scope },
  idOrCode: string,
  version: number,
  input: WorkOrderInput,
): Promise<WorkOrderRecord> {
  const before = await loadWorkOrder(tx, ctx.scope, idOrCode);
  assertVersion(before.version, version);
  if (before.status === 'Cancelled')
    throw new AppError('INVALID_STATE', "Cancelled work orders can't be edited.");
  const previous = await tx
    .select()
    .from(schema.workOrderComponents)
    .where(eq(schema.workOrderComponents.workOrderId, before.id));
  if (before.status !== 'Open' || before.processedQty > 0) {
    const changed = LOCKED_AFTER_OPEN.filter((f) => before[f] !== input[f]);
    const why =
      before.status === 'Completed'
        ? 'Locked on a completed work order'
        : before.processedQty > 0
          ? 'Locked after kits were built'
          : 'Locked after picking started';
    if (changed.length)
      throw new AppError(
        'INVALID_STATE',
        'Warehouse, client, type, kit and quantity can only change while the work order is Open and no kits are built.',
        { fieldErrors: Object.fromEntries(changed.map((f) => [f, [why]])) },
      );
  }
  if (before.status !== 'Open') {
    const moved = sourcesChanged(input, previous);
    if (moved.length)
      throw new AppError(
        'INVALID_STATE',
        `Component sources can't change once the work order is ${before.status}.`,
        {
          fieldErrors: Object.fromEntries(
            moved.map((p) => [p, [`Locked: the work order is ${before.status}`]]),
          ),
        },
      );
  }
  const { bom } = await validateInput(tx, ctx.scope, input, previous);
  const code = input.code.trim();
  await assertUniqueCode(tx, code, before.id);
  const after = (
    await tx
      .update(wo)
      .set({ code, ...baseValues(input), updatedBy: ctx.userId, version: sql`${wo.version} + 1` })
      .where(eq(wo.id, before.id))
      .returning()
  )[0];
  await writeComponents(tx, ctx, after, input, bom, previous);
  await recordWorkOrderChanges(tx, ctx, after, await snapshot(tx, before), await snapshot(tx, after));
  return after;
}

export async function deleteWorkOrder(
  tx: Tx,
  ctx: DomainCtx & { scope: Scope },
  idOrCode: string,
): Promise<WorkOrderRecord> {
  const record = await loadWorkOrder(tx, ctx.scope, idOrCode);
  if (record.status !== 'Open')
    throw new AppError(
      'INVALID_STATE',
      `Only Open work orders can be deleted; ${record.code} is ${record.status}.`,
    );
  if (record.processedQty > 0)
    throw new AppError('INVALID_STATE', `Kits were already built from ${record.code}; it can't be deleted.`);
  const holds =
    (
      await tx
        .select({ n: count() })
        .from(schema.inventoryAllocations)
        .where(
          and(
            eq(schema.inventoryAllocations.workOrderId, record.id),
            inArray(schema.inventoryAllocations.status, ['Allocated', 'Picked']),
          ),
        )
        .limit(1)
    )[0]?.n ?? 0;
  if (Number(holds) > 0)
    throw new AppError(
      'INVALID_STATE',
      `${record.code} still holds component allocations; cancel picking first.`,
    );
  await tx.delete(schema.workOrderComponents).where(eq(schema.workOrderComponents.workOrderId, record.id));
  await tx
    .delete(schema.entityTags)
    .where(and(eq(schema.entityTags.entityType, WO_ENTITY), eq(schema.entityTags.entityId, record.id)));
  await tx.delete(wo).where(eq(wo.id, record.id));
  await changeLog.recordDelete(tx, ctx, {
    entityType: WO_ENTITY,
    entityId: record.id,
    entityCode: record.code,
  });
  return record;
}

/** Stamps processed qty / dates / output attributes and bumps the version. */
export async function patchWorkOrder(
  tx: Tx,
  ctx: DomainCtx,
  record: WorkOrderRecord,
  patch: Partial<typeof schema.workOrders.$inferInsert>,
): Promise<WorkOrderRecord> {
  const after = (
    await tx
      .update(wo)
      .set({ ...patch, updatedBy: ctx.userId, version: sql`${wo.version} + 1` })
      .where(eq(wo.id, record.id))
      .returning()
  )[0];
  const fields = Object.keys(patch) as (keyof WorkOrderRecord)[];
  const pick = async (r: WorkOrderRecord) =>
    Object.fromEntries(
      await mapSeq(fields, async (f) => [
        f,
        f === 'jobId'
          ? r.jobId
            ? ((
                await tx
                  .select({ code: schema.jobs.code })
                  .from(schema.jobs)
                  .where(eq(schema.jobs.id, r.jobId))
                  .limit(1)
              )[0]?.code ?? r.jobId)
            : null
          : r[f],
      ]),
    );
  await recordWorkOrderChanges(tx, ctx, record, await pick(record), await pick(after));
  return after;
}

/** Status pill counts for the current view (the status filter itself is ignored). */
export async function workOrderStatusCounts(
  db: AppDb,
  scope: Scope,
  query: GridQuery,
): Promise<Readonly<Record<string, number>>> {
  const { where } = compileWorkOrderQuery({
    ...query,
    filters: query.filters.filter((f) => f.field !== 'status'),
    sort: [],
  });
  const rows = await db
    .select({ status: wo.status, n: count() })
    .from(wo)
    .where(and(scopedWhere(wo, scope), where))
    .groupBy(wo.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}
