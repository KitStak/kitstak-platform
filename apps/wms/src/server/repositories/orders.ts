/**
 * Shipment Orders read side (BUILD_PLAN M01): grid list for the Backlog and Shipped &
 * Canceled views, and the order detail used by `/orders/[id]`. Every read is scoped.
 */
import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { desc } from '@/server/db/order';
import type { AppDb } from '@/server/api/db';
import type { AuthContext } from '@/server/auth/context';
import { scopedWhere, type Scope } from '@/server/auth/scope';
import { schema } from '@/server/db';
import { stateMachines } from '@/server/domain';
import { codeNameLabel } from '@/lib/utils';
import type { SoStatus } from '@/lib/enums';
import {
  BACKLOG_VIEW_STATUSES,
  ORDER_COLUMNS,
  SHIPPED_VIEW_STATUSES,
  type OrderView,
} from '@/lib/grid-defs/orders/shipment-orders';
import { compileOrderGrid, ORDER_SQL, q } from './orders-grid';
import type { GridQuery } from '@/server/query/grid-query';

const so = schema.shipmentOrders;

/** Backlog statuses (compat export: dashboard + clients repositories read it). */
export const BACKLOG_STATUSES: readonly SoStatus[] = BACKLOG_VIEW_STATUSES;

/* =================================================================== list */

export interface OrderTagChip {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

/** One grid row: every column value plus the facts bulk actions need for eligibility. */
export interface OrderGridRow {
  readonly id: string;
  readonly version: number;
  readonly code: string;
  readonly status: SoStatus;
  readonly clientId: string;
  readonly warehouseId: string;
  readonly jobId: string | null;
  readonly retailerId: string | null;
  readonly channel: string;
  readonly isMerged: boolean;
  readonly hasLabel: boolean;
  /** An active return label exists (shipped tab: void / reprint return label). */
  readonly hasReturnLabel?: boolean;
  readonly hasActiveTask: boolean;
  readonly hasSerials: boolean;
  readonly allocatedQuantity: number;
  readonly tags: readonly OrderTagChip[];
  readonly [column: string]: unknown;
}

/** Legacy alias (jobs shortage report reads totalQuantity / salesPrice). */
export type OrderListRow = OrderGridRow & { readonly totalQuantity: number; readonly salesPrice: number };

const BOOLEAN_COLUMNS = new Set(ORDER_COLUMNS.filter((c) => c.kind === 'boolean').map((c) => c.id));

const EXTRA_SQL: Readonly<Record<string, SQL>> = {
  id: sql`${q.id}`,
  version: sql`${q.version}`,
  clientId: sql`${q.clientId}`,
  warehouseId: sql`${q.warehouseId}`,
  jobId: sql`${q.jobId}`,
  retailerId: sql`${q.retailerId}`,
  channel: sql`${q.channel}`,
  isMerged: ORDER_SQL.isMerged as SQL,
  hasLabel: ORDER_SQL.hasLabel as SQL,
  hasReturnLabel: sql`EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = ${q.id} AND s.label_status = 'Active' AND s.label_type = 'Return Label')`,
  hasActiveTask: sql`EXISTS (SELECT 1 FROM tasks t WHERE t.order_id = ${q.id} AND t.status IN ('Pending','Started') AND t.task_type IN ('Picking','Packing','Sorting'))`,
  hasSerials: sql`EXISTS (SELECT 1 FROM serial_numbers sn JOIN order_lines ol ON ol.id = sn.order_line_id WHERE ol.order_id = ${q.id})`,
  allocatedQuantity: sql`(SELECT COALESCE(SUM(l.allocated_quantity), 0) FROM order_lines l WHERE l.order_id = ${q.id})`,
  tagsJson: sql`(SELECT COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color))::text, '[]') FROM entity_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entity_type = 'shipment_order' AND et.entity_id = ${q.id})`,
  workflowBlocked: sql`${q.workflowBlocked}`,
  trackingNumbersJson: sql`${q.trackingNumbers}`,
};

const BOOLEAN_EXTRAS = new Set(['isMerged', 'hasLabel', 'hasReturnLabel', 'hasActiveTask', 'hasSerials']);

function selection(): Record<string, SQL> {
  const fields: Record<string, SQL> = { ...EXTRA_SQL };
  for (const c of ORDER_COLUMNS) {
    const expr = ORDER_SQL[c.id];
    if (expr) fields[c.id] = expr;
  }
  return fields;
}

function parseTags(raw: unknown): readonly OrderTagChip[] {
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? (parsed as OrderTagChip[]).filter((t) => t && typeof t.id === 'string')
      : [];
  } catch {
    return [];
  }
}

function toRow(raw: Record<string, unknown>): OrderGridRow {
  const out: Record<string, unknown> = { ...raw };
  for (const key of [...BOOLEAN_COLUMNS, ...BOOLEAN_EXTRAS]) if (key in out) out[key] = Boolean(out[key]);
  out.tags = parseTags(raw.tagsJson);
  delete out.tagsJson;
  return out as OrderGridRow;
}

export function viewCondition(view: OrderView): SQL {
  const statuses = view === 'shipped' ? SHIPPED_VIEW_STATUSES : BACKLOG_VIEW_STATUSES;
  return and(isNull(so.deletedAt), inArray(so.status, [...statuses])) as SQL;
}

export interface ListOrdersInput {
  readonly view: OrderView;
  readonly query: GridQuery;
  /** Legacy `?status=` param (jobs shortage report). */
  readonly status?: SoStatus;
}

export interface ListOrdersResult {
  readonly rows: readonly OrderGridRow[];
  readonly total: number;
}

export async function listOrders(db: AppDb, scope: Scope, input: ListOrdersInput): Promise<ListOrdersResult> {
  const grid = compileOrderGrid(input.query);
  const where = and(
    input.status ? and(isNull(so.deletedAt), eq(so.status, input.status)) : viewCondition(input.view),
    scopedWhere(so, scope),
    grid.where,
  );
  const page = Math.max(1, input.query.page);
  const pageSize = input.query.pageSize;
  const rows = (await db
    .select(selection())
    .from(so)
    .where(where)
    .orderBy(...grid.orderBy, desc(so.orderDate), desc(so.code))
    .limit(pageSize)
    .offset((page - 1) * pageSize)) as Record<string, unknown>[];
  const total =
    (
      await db
        .select({ n: sql<number>`count(*)` })
        .from(so)
        .where(where)
        .limit(1)
    )[0]?.n ?? 0;
  return { rows: rows.map(toRow), total: Number(total) };
}

/** Rows for a set of ids (bulk-action confirm tables), scoped. */
export async function ordersByIds(
  db: AppDb,
  scope: Scope,
  ids: readonly string[],
): Promise<readonly OrderGridRow[]> {
  if (ids.length === 0) return [];
  const rows = (await db
    .select(selection())
    .from(so)
    .where(and(inArray(so.id, [...ids]), isNull(so.deletedAt), scopedWhere(so, scope)))) as Record<
    string,
    unknown
  >[];
  return rows.map(toRow);
}

/* ================================================================= detail */

export interface OrderDetailLine {
  readonly id: string;
  readonly productId: string;
  readonly sku: string;
  readonly productName: string;
  readonly imageUrl: string | null;
  readonly isKit: boolean;
  readonly uom: string;
  readonly packType: string;
  readonly uomRatio: number;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly weightOz: number;
  readonly allocatedQuantity: number;
  readonly cancelledQuantity: number;
  readonly sortedQuantity: number;
  readonly pickedQuantity: number;
  readonly packedQuantity: number;
  readonly shippedQuantity: number;
  readonly loadedQuantity: number;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly productionDate: string | null;
  readonly damageReason: string | null;
  readonly pinnedLocationId: string | null;
  readonly pinnedLocationCode: string | null;
  readonly pinnedLpId: string | null;
  readonly pinnedLpCode: string | null;
  readonly lineNote1: string | null;
  readonly lineNote2: string | null;
  readonly lineNote3: string | null;
  readonly kitSku: string | null;
  readonly originalOrderCode: string | null;
  readonly storeUpdateNotes: string | null;
  readonly isStoreUpdated: boolean;
  readonly atp: number;
}

export interface OrderJobRef {
  readonly id: string;
  readonly code: string;
  readonly jobType: string;
  readonly status: string;
}

export interface OrderShipmentRef {
  readonly id: string;
  readonly trackingNumber: string;
  readonly carrierCode: string;
  readonly serviceName: string;
  readonly labelType: string;
  readonly labelStatus: string;
  readonly labelFileId: string | null;
  readonly weight: number;
  readonly packageSeq: number;
  readonly shippingCost: number;
  readonly labelCreatedAt: string;
  readonly actualShipmentAt: string | null;
}

export interface OrderActionState {
  readonly key: string;
  readonly disabledReason: string | null;
}

export type OrderRecord = typeof so.$inferSelect;

export interface OrderDetail {
  readonly order: OrderRecord;
  readonly clientName: string;
  readonly clientCode: string;
  readonly warehouseLabel: string;
  readonly warehouseCode: string;
  readonly orderTypeName: string;
  /** The order-type lookup id; legacy rows with only "D2C"/"B2B" resolve to the matching lookup by name. */
  readonly orderTypeLookupId: string | null;
  readonly cancelReasonName: string | null;
  readonly retailerName: string | null;
  readonly packingWarningName: string | null;
  readonly carrierServiceName: string | null;
  readonly carrierSetupName: string | null;
  readonly shipmentPackageName: string | null;
  readonly returnCarrierServiceName: string | null;
  readonly masterOrderCode: string | null;
  readonly mergedIntoOrderCode: string | null;
  readonly backOrders: readonly { readonly id: string; readonly code: string; readonly status: string }[];
  readonly lines: readonly OrderDetailLine[];
  readonly jobs: readonly OrderJobRef[];
  readonly shipments: readonly OrderShipmentRef[];
  readonly tags: readonly OrderTagChip[];
  readonly hasActiveTask: boolean;
  readonly hasPickTask: boolean;
  readonly lastUpdatedBy: string | null;
  readonly actions: Readonly<Record<string, string | null>>;
  /** Latest blocking workflow run while the order is workflow-blocked. */
  readonly workflowBlock: {
    readonly workflowName: string;
    readonly blockType: string;
    readonly at: string;
    readonly actions: readonly string[];
  } | null;
  /** While On Hold: when, by whom and the optional reason (latest "Hold Reason" entry since the hold). */
  readonly hold: {
    readonly at: string | null;
    readonly by: string | null;
    readonly reason: string | null;
  } | null;
}

async function holdOf(db: AppDb, order: OrderRecord): Promise<OrderDetail['hold']> {
  if (order.status !== 'On Hold') return null;
  const cl = schema.changeLog;
  const mine = and(eq(cl.entityType, 'shipment_order'), eq(cl.entityId, order.id));
  const since = (
    await db
      .select({ at: cl.at, source: cl.source })
      .from(cl)
      .where(and(mine, eq(cl.field, 'status'), eq(cl.toValue, 'On Hold')))
      .orderBy(sql`${cl.at} DESC`)
      .limit(1)
  )[0];
  const reason = (
    await db
      .select({ value: cl.toValue })
      .from(cl)
      .where(and(mine, eq(cl.field, 'holdReason'), since ? sql`${cl.at} >= ${since.at}` : undefined))
      .orderBy(sql`${cl.at} DESC`)
      .limit(1)
  )[0];
  return { at: since?.at ?? null, by: since?.source ?? null, reason: reason?.value ?? null };
}

async function workflowBlockOf(db: AppDb, order: OrderRecord): Promise<OrderDetail['workflowBlock']> {
  if (order.workflowBlocked === 'None') return null;
  const r = schema.workflowRuns;
  const run = (
    await db
      .select({ name: schema.workflows.name, blockType: r.blockType, at: r.at, actions: r.actionsApplied })
      .from(r)
      .innerJoin(schema.workflows, eq(schema.workflows.id, r.workflowId))
      .where(
        and(eq(r.entityType, 'shipment_order'), eq(r.entityId, order.id), sql`${r.blockType} IS NOT NULL`),
      )
      .orderBy(desc(r.at))
      .limit(1)
  )[0];
  return {
    workflowName: run?.name ?? 'A workflow',
    blockType: run?.blockType ?? order.workflowBlocked,
    at: run?.at ?? order.updatedAt,
    actions: run?.actions ?? [],
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function lookupName(db: AppDb, id: string | null): Promise<string | null> {
  if (!id) return null;
  return (
    (
      await db
        .select({ name: schema.lookupValues.name })
        .from(schema.lookupValues)
        .where(eq(schema.lookupValues.id, id))
        .limit(1)
    )[0]?.name ?? null
  );
}

async function orderTypeIdByName(db: AppDb, name: string): Promise<string | null> {
  const l = schema.lookupValues;
  return (
    (
      await db
        .select({ id: l.id })
        .from(l)
        .where(and(eq(l.type, 'so_type'), eq(l.name, name), isNull(l.clientId)))
        .limit(1)
    )[0]?.id ?? null
  );
}

export async function orderTypeLabel(
  db: AppDb,
  order: Pick<OrderRecord, 'orderTypeId' | 'orderType'>,
): Promise<string> {
  return (await lookupName(db, order.orderTypeId)) ?? (order.orderType === 'B2B' ? 'B2B Order' : 'D2C Order');
}

/** Resolves an order by id or human code inside the scope. */
export async function findOrderRow(db: AppDb, scope: Scope, key: string): Promise<OrderRecord | null> {
  const match = UUID_RE.test(key)
    ? eq(so.id, key.toLowerCase())
    : eq(sql`upper(${so.code})`, key.toUpperCase());
  const row = (
    await db
      .select()
      .from(so)
      .where(and(match, isNull(so.deletedAt), scopedWhere(so, scope)))
      .limit(1)
  )[0];
  return row ?? null;
}

async function detailLines(db: AppDb, order: OrderRecord): Promise<OrderDetailLine[]> {
  const l = schema.orderLines;
  const p = schema.products;
  const rows = await db
    .select({
      line: l,
      sku: p.sku,
      productName: p.name,
      imageUrl: p.imageUrl,
      isKit: p.isKit,
      uom: p.uom,
      weightOz: p.weightOz,
      pinnedLocationCode: sql<
        string | null
      >`(SELECT loc.code FROM locations loc WHERE loc.id = ${l.pinnedLocationId})`,
      pinnedLpCode: sql<
        string | null
      >`(SELECT lp.number FROM license_plates lp WHERE lp.id = ${l.pinnedLpId})`,
      kitSku: sql<string | null>`(SELECT k.sku FROM products k WHERE k.id = ${l.kitProductId})`,
      atp: sql<number>`(SELECT COALESCE(SUM(i.on_hand - i.allocated - i.damaged), 0) FROM inventory i WHERE i.product_id = ${l.productId} AND i.warehouse_id = ${order.warehouseId} AND i.status = 'Stock')`,
    })
    .from(l)
    .innerJoin(p, eq(p.id, l.productId))
    .where(eq(l.orderId, order.id))
    .orderBy(l.createdAt);
  return rows.map((r) => ({
    id: r.line.id,
    productId: r.line.productId,
    sku: r.sku,
    productName: r.productName,
    imageUrl: r.imageUrl ?? null,
    isKit: Boolean(r.isKit),
    uom: r.uom,
    packType: r.line.packType,
    uomRatio: r.line.uomRatio,
    quantity: r.line.quantity,
    unitPrice: r.line.unitPrice,
    weightOz: r.weightOz,
    allocatedQuantity: r.line.allocatedQuantity,
    cancelledQuantity: r.line.cancelledQuantity,
    sortedQuantity: r.line.sortedQuantity,
    pickedQuantity: r.line.pickedQuantity,
    packedQuantity: r.line.packedQuantity,
    shippedQuantity: r.line.shippedQuantity,
    loadedQuantity: r.line.loadedQuantity,
    lotNumber: r.line.lotNumber,
    expiryDate: r.line.expiryDate,
    productionDate: r.line.productionDate,
    damageReason: r.line.damageReason,
    pinnedLocationId: r.line.pinnedLocationId,
    pinnedLocationCode: r.pinnedLocationCode,
    pinnedLpId: r.line.pinnedLpId,
    pinnedLpCode: r.pinnedLpCode,
    lineNote1: r.line.lineNote1,
    lineNote2: r.line.lineNote2,
    lineNote3: r.line.lineNote3,
    kitSku: r.kitSku,
    originalOrderCode: r.line.originalOrderCode,
    storeUpdateNotes: r.line.storeUpdateNotes,
    isStoreUpdated: Boolean(r.line.isStoreUpdated),
    atp: Math.max(0, Number(r.atp ?? 0)),
  }));
}

async function orderJobs(db: AppDb, orderId: string, jobId: string | null): Promise<OrderJobRef[]> {
  const j = schema.jobs;
  const rows = await db
    .select({ id: j.id, code: j.code, jobType: j.jobType, status: j.status })
    .from(j)
    .where(
      or(
        inArray(
          j.id,
          db
            .select({ id: schema.jobOrders.jobId })
            .from(schema.jobOrders)
            .where(eq(schema.jobOrders.orderId, orderId)),
        ),
        jobId ? eq(j.id, jobId) : sql`false`,
      ),
    )
    .orderBy(desc(j.createdAt));
  return rows.filter((r) => r.status !== 'Cancelled' || r.id === jobId);
}

async function orderShipments(db: AppDb, orderId: string): Promise<OrderShipmentRef[]> {
  const s = schema.shipments;
  return await db
    .select({
      id: s.id,
      trackingNumber: s.trackingNumber,
      carrierCode: s.carrierCode,
      serviceName: s.serviceName,
      labelType: s.labelType,
      labelStatus: s.labelStatus,
      labelFileId: s.labelFileId,
      weight: s.weight,
      packageSeq: s.packageSeq,
      shippingCost: s.shippingCost,
      labelCreatedAt: s.labelCreatedAt,
      actualShipmentAt: s.actualShipmentAt,
    })
    .from(s)
    .where(eq(s.orderId, orderId))
    .orderBy(desc(s.labelCreatedAt));
}

async function tagsFor(db: AppDb, orderId: string): Promise<OrderTagChip[]> {
  return await db
    .select({ id: schema.tags.id, name: schema.tags.name, color: schema.tags.color })
    .from(schema.entityTags)
    .innerJoin(schema.tags, eq(schema.tags.id, schema.entityTags.tagId))
    .where(and(eq(schema.entityTags.entityType, 'shipment_order'), eq(schema.entityTags.entityId, orderId)));
}

const reasonOf = (check: { ok: true } | { ok: false; reason: string }): string | null =>
  check.ok ? null : check.reason;

/** Other Actions gating (reason text = tooltip) — mirrors the domain guards. */
export function orderActionReasons(
  order: OrderRecord,
  facts: { readonly hasActiveTask: boolean; readonly hasLabel: boolean },
): Record<string, string | null> {
  const sm = stateMachines.shipmentOrder;
  const jobReason = order.jobId ? 'This order is in a job. Remove it from the job first.' : null;
  const ship = ['Shipped', 'Delivered', 'Cancelled'].includes(order.status)
    ? `Order is already ${order.status}.`
    : order.status === 'On Hold'
      ? 'Release the hold before you ship this order.'
      : null;
  return {
    ship,
    delete:
      order.status !== 'Open' ? `Only Open orders can be deleted; this order is ${order.status}.` : jobReason,
    cancel:
      order.status === 'On Hold' || sm.canTransition(order.status, 'Cancelled', { reason: 'x' }).ok
        ? jobReason
        : reasonOf(sm.canTransition(order.status, 'Cancelled', { reason: 'x' })),
    hold:
      order.status === 'On Hold'
        ? 'This order is already on hold.'
        : reasonOf(sm.canTransition(order.status, 'On Hold')),
    release: order.status === 'On Hold' ? null : 'Only orders on hold can be released.',
    duplicate: null,
    jobs: ['Open', 'Shortage', 'Ready to Pick'].includes(order.status)
      ? null
      : `Only Open, Shortage or Ready to Pick orders can get a picking job; this order is ${order.status}.`,
    cancelPicking: facts.hasActiveTask
      ? null
      : 'Cancel Picking is only available for orders that have active picking/packing tasks.',
    backorder: order.status === 'Shortage' ? null : 'Only Shortage orders can be back-ordered.',
    editLines: ['Open', 'Shortage', 'On Hold'].includes(order.status)
      ? null
      : 'Lines are locked once picking has started.',
  };
}

/** Loads the full order detail by id or code (null = not found or out of scope). */
export async function getOrderDetail(
  db: AppDb,
  auth: Pick<AuthContext, 'scope'>,
  key: string,
): Promise<OrderDetail | null> {
  const order = await findOrderRow(db, auth.scope, key);
  if (!order) return null;
  const client = (
    await db.select().from(schema.clients).where(eq(schema.clients.id, order.clientId)).limit(1)
  )[0];
  const wh = (
    await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, order.warehouseId)).limit(1)
  )[0];
  const service = order.carrierServiceId
    ? (
        await db
          .select({ name: schema.carrierServices.name })
          .from(schema.carrierServices)
          .where(eq(schema.carrierServices.id, order.carrierServiceId))
          .limit(1)
      )[0]
    : undefined;
  const returnService = order.returnCarrierServiceId
    ? (
        await db
          .select({ name: schema.carrierServices.name })
          .from(schema.carrierServices)
          .where(eq(schema.carrierServices.id, order.returnCarrierServiceId))
          .limit(1)
      )[0]
    : undefined;
  const conn = order.carrierConnectionId
    ? (
        await db
          .select({ name: schema.carrierConnections.setupName })
          .from(schema.carrierConnections)
          .where(eq(schema.carrierConnections.id, order.carrierConnectionId))
          .limit(1)
      )[0]
    : undefined;
  const pkg = order.shipmentPackageId
    ? (
        await db
          .select({ name: schema.shipmentPackages.code })
          .from(schema.shipmentPackages)
          .where(eq(schema.shipmentPackages.id, order.shipmentPackageId))
          .limit(1)
      )[0]
    : undefined;
  const retailer = order.retailerId
    ? (
        await db
          .select({ name: schema.retailers.name })
          .from(schema.retailers)
          .where(eq(schema.retailers.id, order.retailerId))
          .limit(1)
      )[0]
    : undefined;
  const codeOf = async (id: string | null) =>
    id
      ? ((await db.select({ code: so.code }).from(so).where(eq(so.id, id)).limit(1))[0]?.code ?? null)
      : null;
  const backOrders = await db
    .select({ id: so.id, code: so.code, status: so.status })
    .from(so)
    .where(and(eq(so.masterOrderId, order.id), isNull(so.deletedAt)));
  const shipments = await orderShipments(db, order.id);
  const taskFacts = (
    await db
      .select({
        active: sql<number>`SUM(CASE WHEN ${schema.tasks.status} IN ('Pending','Started') AND ${schema.tasks.taskType} IN ('Picking','Packing','Sorting') THEN 1 ELSE 0 END)`,
        pick: sql<number>`SUM(CASE WHEN ${schema.tasks.status} IN ('Pending','Started') AND ${schema.tasks.taskType} = 'Picking' THEN 1 ELSE 0 END)`,
      })
      .from(schema.tasks)
      .where(eq(schema.tasks.orderId, order.id))
      .limit(1)
  )[0];
  const hasActiveTask = Number(taskFacts?.active ?? 0) > 0;
  const hasLabel = shipments.some((s) => s.labelStatus === 'Active' && s.labelType === 'Shipping Label');
  const updater = order.updatedBy
    ? (
        await db
          .select({ email: schema.users.email })
          .from(schema.users)
          .where(eq(schema.users.id, order.updatedBy))
          .limit(1)
      )[0]
    : undefined;
  return {
    order,
    clientName: client?.name ?? '',
    clientCode: client?.code ?? '',
    warehouseLabel: wh ? codeNameLabel(wh.code, wh.name) : '',
    warehouseCode: wh?.code ?? '',
    orderTypeName: await orderTypeLabel(db, order),
    orderTypeLookupId: order.orderTypeId ?? (await orderTypeIdByName(db, await orderTypeLabel(db, order))),
    cancelReasonName: await lookupName(db, order.cancelReasonId),
    retailerName: retailer?.name ?? null,
    packingWarningName: await lookupName(db, order.packingWarningTypeId),
    carrierServiceName: service?.name ?? order.shippingService ?? null,
    carrierSetupName: conn?.name ?? null,
    shipmentPackageName: pkg?.name ?? null,
    returnCarrierServiceName: returnService?.name ?? null,
    masterOrderCode: await codeOf(order.masterOrderId),
    mergedIntoOrderCode: await codeOf(order.mergedIntoOrderId),
    backOrders,
    lines: await detailLines(db, order),
    jobs: await orderJobs(db, order.id, order.jobId),
    shipments,
    tags: await tagsFor(db, order.id),
    hasActiveTask,
    hasPickTask: Number(taskFacts?.pick ?? 0) > 0,
    lastUpdatedBy: updater?.email ?? null,
    actions: orderActionReasons(order, { hasActiveTask, hasLabel }),
    workflowBlock: await workflowBlockOf(db, order),
    hold: await holdOf(db, order),
  };
}

/** Tab counts for the Shipment Orders route tabs (scoped, view filters only). */
export async function orderViewCounts(db: AppDb, scope: Scope): Promise<Record<OrderView, number>> {
  const count = async (view: OrderView) =>
    Number(
      (
        await db
          .select({ n: sql<number>`count(*)` })
          .from(so)
          .where(and(viewCondition(view), scopedWhere(so, scope)))
          .limit(1)
      )[0]?.n ?? 0,
    );
  return { backlog: await count('backlog'), shipped: await count('shipped') };
}
