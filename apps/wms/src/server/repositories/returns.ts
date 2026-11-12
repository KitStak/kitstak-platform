/**
 * Return orders (RMA) — M04 owns `return_orders` / `return_order_lines` (Part C1).
 * Detail, shippable lines for Create RMA, create, status transitions (state machine +
 * guards), return labels (shipping ops) and change_log on every write.
 */
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { asc } from '@/server/db/order';
import { z } from 'zod';
import { RETURN_SOURCES, RETURN_STATUSES, type ReturnStatus } from '@/lib/enums';
import type { AppDb } from '@/server/api/db';
import type { AuthContext } from '@/server/auth/context';
import type { Scope } from '@/server/auth/scope';
import { assertInScope } from '@/server/auth/scope';
import * as schema from '@/server/db/schema';
import { changeLog, runBulk, sequences, shipping, stateMachines } from '@/server/domain';
import { validationError } from '@/server/api/errors';
import { DomainError } from '@/server/domain/errors';
import type { BulkResult, DomainCtx } from '@/server/domain/types';
import { assertVersion, bulkIdsSchema, idSchema } from './platform-common';
import { shippedAttributes, type ShippedAttributes } from './returns-shipped';
import { dbAll, dbGet, dbRun, mapSeq, withWriteTx } from '@/server/db/sql';

export const RETURN_PERMISSIONS = {
  view: 'inventory.return_orders.view',
  changeStatus: 'inventory.return_orders.change_status',
  tag: 'inventory.return_orders.tag',
  createRma: 'fulfillment.shipment_orders.create_rma',
  returnLabel: 'fulfillment.shipment_orders.create_return_label',
  station: 'inventory.return_station.view',
  /** Receiving at the Return Station posts inventory: dedicated key (viewers lack it). REQ-1. */
  receive: 'inventory.return_station.receive_return',
} as const;

/** Domain ctx carrying the caller's full scope (cross-scope -> 404). */
export type ScopedCtx = DomainCtx & { readonly scope: Scope };
export function scopedCtx(
  actor: { readonly userId: string | null; readonly source: string },
  auth: AuthContext,
): ScopedCtx {
  return { userId: actor.userId, source: actor.source, scope: auth.scope };
}

export const RETURNABLE_ORDER_STATUSES = ['Shipped', 'Partially Shipped', 'Delivered'] as const;

type ReturnRow = typeof schema.returnOrders.$inferSelect;
type LineRow = typeof schema.returnOrderLines.$inferSelect;

/* ------------------------------------------------------------------ guards */

export interface TransitionOption {
  readonly status: ReturnStatus;
  readonly ok: boolean;
  readonly reason: string | null;
}

/**
 * Legal next statuses for an RMA. Beyond the machine: Completed needs at least one unit
 * received; Cancelled is only possible while nothing has been received.
 */
export function transitionOptions(status: ReturnStatus, receivedQty: number): readonly TransitionOption[] {
  return RETURN_STATUSES.filter((s) => s !== status).map((to) => {
    const check = stateMachines.returnOrder.canTransition(status, to);
    if (!check.ok) {
      const terminal = status === 'Completed' || status === 'Cancelled';
      return {
        status: to,
        ok: false,
        reason: terminal ? `${status} returns can't be changed.` : check.reason,
      };
    }
    if (to === 'Completed' && receivedQty === 0)
      return {
        status: to,
        ok: false,
        reason: 'Receive at least one unit at the Return Station before completing.',
      };
    if (to === 'Cancelled' && receivedQty > 0)
      return { status: to, ok: false, reason: 'Units were already received. Complete the return instead.' };
    if (to === 'Started' && receivedQty === 0 && status === 'Pending')
      return { status: to, ok: true, reason: null };
    return { status: to, ok: true, reason: null };
  });
}

async function receivedTotal(db: AppDb, returnOrderId: string): Promise<number> {
  return (
    (
      await dbGet<{ n: number }>(
        db,
        sql`SELECT COALESCE(SUM(returned_qty), 0) AS n FROM return_order_lines WHERE return_order_id = ${returnOrderId}`,
      )
    )?.n ?? 0
  );
}

export async function loadReturn(db: AppDb, scope: Scope, id: string): Promise<ReturnRow> {
  const ro = (await db.select().from(schema.returnOrders).where(eq(schema.returnOrders.id, id)).limit(1))[0];
  assertInScope(scope, ro, 'Return order');
  return ro as ReturnRow;
}

/* ------------------------------------------------------------------ detail */

export interface ReturnDetail {
  readonly id: string;
  readonly rmaCode: string;
  readonly status: ReturnStatus;
  readonly source: string;
  readonly version: number;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly warehouseName: string;
  readonly returnAddress: string | null;
  readonly clientId: string;
  readonly clientName: string;
  readonly customerName: string | null;
  readonly fromCountry: string | null;
  readonly note: string | null;
  readonly createdAt: string;
  readonly createdByName: string;
  readonly createdByEmail: string | null;
  readonly updatedAt: string;
  readonly expectedReturnDate: string | null;
  readonly actualReturnDate: string | null;
  readonly carrierCode: string | null;
  readonly carrierServiceName: string | null;
  readonly trackingNumber: string | null;
  /** `trackingNumber` split into its numbers (several can be recorded without a label). */
  readonly trackingNumbers: readonly string[];
  /** Return shipping cost: the bought label's cost, else the manually recorded cost on the order's Return section. */
  readonly returnShippingCost: number | null;
  readonly returnAddressId: string | null;
  readonly order: {
    readonly id: string;
    readonly code: string;
    readonly storeOrderNumber: string | null;
    readonly channel: string;
    readonly status: string;
    readonly orderDate: string;
    readonly shippedAt: string | null;
    readonly deliveredAt: string | null;
    readonly shipTo: string;
  } | null;
  readonly label: {
    readonly shipmentId: string;
    readonly trackingNumber: string;
    readonly labelFileId: string | null;
    readonly labelStatus: string;
    readonly serviceName: string | null;
    readonly carrierCode: string | null;
    readonly shippingCost: number;
    readonly createdAt: string;
  } | null;
  readonly lines: readonly {
    readonly id: string;
    readonly productId: string;
    readonly sku: string;
    readonly name: string;
    readonly imageUrl: string | null;
    readonly packType: string;
    readonly requestedQty: number;
    readonly returnedQty: number;
    readonly lineStatus: string;
    readonly disposition: string | null;
    readonly customerReturnReason: string | null;
    readonly actualReturnReason: string | null;
    readonly shippedQty: number | null;
    /** Tracking flags of the SKU: the station asks for lot / dates / serials when set. */
    readonly trackLot: boolean;
    readonly trackExpiry: boolean;
    readonly trackProductionDate: boolean;
    readonly trackSerial: boolean;
    /** What actually shipped for this SKU on the order (ledger), offered as capture choices. */
    readonly shipped: ShippedAttributes | null;
  }[];
  /** Units requested but not received; > 0 on a Completed RMA means it was short closed (reopenable). */
  readonly shortQty: number;
  readonly receipts: readonly {
    readonly id: string;
    readonly receiptNo: number;
    readonly sku: string;
    readonly quantity: number;
    readonly locationCode: string;
    readonly lpNumber: string | null;
    readonly damageReason: string | null;
    readonly actualReturnReason: string | null;
    readonly note: string | null;
    readonly receivedBy: string;
    readonly receivedAt: string;
    readonly cancelledAt: string | null;
  }[];
  readonly receivedQty: number;
  readonly requestedQty: number;
  readonly transitions: readonly TransitionOption[];
  readonly tagIds: readonly string[];
}

const lookupName = async (db: AppDb, id: string | null): Promise<string | null> =>
  id
    ? ((
        await db
          .select({ name: schema.lookupValues.name })
          .from(schema.lookupValues)
          .where(eq(schema.lookupValues.id, id))
          .limit(1)
      )[0]?.name ?? null)
    : null;

export async function getReturnDetail(db: AppDb, scope: Scope, id: string): Promise<ReturnDetail> {
  const ro = await loadReturn(db, scope, id);
  const wh = (
    await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, ro.warehouseId)).limit(1)
  )[0];
  const client = (
    await db.select().from(schema.clients).where(eq(schema.clients.id, ro.clientId)).limit(1)
  )[0];
  const creator = ro.createdBy
    ? (
        await db
          .select({ name: schema.users.name, email: schema.users.email })
          .from(schema.users)
          .where(eq(schema.users.id, ro.createdBy))
          .limit(1)
      )[0]
    : undefined;
  const addr = ro.returnAddressId
    ? (
        await db.select().from(schema.addresses).where(eq(schema.addresses.id, ro.returnAddressId)).limit(1)
      )[0]
    : undefined;
  const returnAddress = addr
    ? [
        addr.companyName ?? addr.name,
        addr.line1,
        addr.city,
        [addr.state, addr.postalCode].filter(Boolean).join(' '),
      ]
        .filter(Boolean)
        .join(', ')
    : wh
      ? [wh.name, wh.addressLine, wh.city, [wh.state, wh.postalCode].filter(Boolean).join(' ')]
          .filter(Boolean)
          .join(', ')
      : null;
  const so = ro.shipmentOrderId
    ? (
        await db
          .select()
          .from(schema.shipmentOrders)
          .where(eq(schema.shipmentOrders.id, ro.shipmentOrderId))
          .limit(1)
      )[0]
    : undefined;
  const label = ro.returnLabelShipmentId
    ? (
        await db
          .select()
          .from(schema.shipments)
          .where(eq(schema.shipments.id, ro.returnLabelShipmentId))
          .limit(1)
      )[0]
    : undefined;
  const lines = await db
    .select({ l: schema.returnOrderLines, p: schema.products })
    .from(schema.returnOrderLines)
    .innerJoin(schema.products, eq(schema.products.id, schema.returnOrderLines.productId))
    .where(eq(schema.returnOrderLines.returnOrderId, ro.id))
    .orderBy(asc(schema.products.sku));
  const orderLineIds = lines.flatMap((r) => (r.l.orderLineId ? [r.l.orderLineId] : []));
  const shipped = new Map(
    orderLineIds.length
      ? (
          await db
            .select({ id: schema.orderLines.id, q: schema.orderLines.shippedQuantity })
            .from(schema.orderLines)
            .where(inArray(schema.orderLines.id, orderLineIds))
        ).map((r) => [r.id, r.q])
      : [],
  );
  const receipts = await db
    .select({
      r: schema.receipts,
      sku: schema.products.sku,
      loc: schema.locations.code,
      lp: schema.licensePlates.number,
    })
    .from(schema.receipts)
    .innerJoin(schema.products, eq(schema.products.id, schema.receipts.productId))
    .innerJoin(schema.locations, eq(schema.locations.id, schema.receipts.locationId))
    .leftJoin(schema.licensePlates, eq(schema.licensePlates.id, schema.receipts.lpId))
    .where(eq(schema.receipts.returnOrderId, ro.id))
    .orderBy(asc(schema.receipts.receivedAt));
  const tagIds = (
    await db
      .select({ id: schema.entityTags.tagId })
      .from(schema.entityTags)
      .where(and(eq(schema.entityTags.entityType, 'return_order'), eq(schema.entityTags.entityId, ro.id)))
  ).map((t) => t.id);
  const receivedQty = lines.reduce((s, r) => s + r.l.returnedQty, 0);
  const extras = await readRmaExtras(db, ro.id);
  const attrs = so ? await shippedAttributes(db, so.id) : new Map<string, ShippedAttributes>();
  return {
    id: ro.id,
    rmaCode: ro.rmaCode,
    status: ro.status,
    source: ro.source,
    version: ro.version,
    warehouseId: ro.warehouseId,
    warehouseCode: wh?.code ?? '',
    warehouseName: wh?.name ?? '',
    returnAddress,
    clientId: ro.clientId,
    clientName: client?.name ?? '',
    customerName: ro.customerName ?? so?.customerName ?? null,
    fromCountry: ro.fromCountry,
    note: ro.note,
    createdAt: ro.createdAt,
    createdByName: creator?.name ?? 'System',
    createdByEmail: creator?.email ?? null,
    updatedAt: ro.updatedAt,
    expectedReturnDate: ro.expectedReturnDate,
    actualReturnDate: ro.actualReturnDate,
    carrierCode: ro.carrierCode,
    carrierServiceName: ro.carrierServiceName,
    trackingNumber: ro.trackingNumber,
    trackingNumbers: extras.tracking ?? splitTracking(ro.trackingNumber),
    returnAddressId: ro.returnAddressId,
    returnShippingCost: label
      ? label.shippingCost
      : extras.hasCost
        ? extras.cost
        : (so?.returnShippingCost ?? null),
    order: so
      ? {
          id: so.id,
          code: so.code,
          storeOrderNumber: so.storeOrderNumber,
          channel: so.channel,
          status: so.status,
          orderDate: so.orderDate,
          shippedAt: so.shippedAt,
          deliveredAt: so.deliveredAt,
          shipTo: [so.shipAddress, so.shipCity, so.shipState, so.shipZip].filter(Boolean).join(', '),
        }
      : null,
    label: label
      ? {
          shipmentId: label.id,
          trackingNumber: label.trackingNumber,
          labelFileId: label.labelFileId,
          labelStatus: label.labelStatus,
          serviceName: label.serviceName,
          carrierCode: label.carrierCode,
          shippingCost: label.shippingCost,
          createdAt: label.labelCreatedAt ?? '',
        }
      : null,
    lines: await mapSeq(lines, async ({ l, p }) => ({
      id: l.id,
      productId: p.id,
      sku: p.sku,
      name: p.name,
      imageUrl: p.imageUrl,
      packType: l.packType,
      requestedQty: l.requestedQty,
      returnedQty: l.returnedQty,
      lineStatus: l.lineStatus,
      disposition: l.disposition,
      customerReturnReason: await lookupName(db, l.customerReturnReasonId),
      actualReturnReason: await lookupName(db, l.actualReturnReasonId),
      shippedQty: l.orderLineId ? (shipped.get(l.orderLineId) ?? null) : null,
      trackLot: p.trackLot,
      trackExpiry: p.trackExpiry,
      trackProductionDate: p.trackProductionDate,
      trackSerial: p.trackSerial,
      shipped: attrs.get(p.id) ?? null,
    })),
    shortQty: lines.reduce((s, r) => s + Math.max(0, r.l.requestedQty - r.l.returnedQty), 0),
    receipts: receipts.map(({ r, sku, loc, lp }) => ({
      id: r.id,
      receiptNo: r.masterId,
      sku,
      quantity: r.quantity,
      locationCode: loc,
      lpNumber: lp ?? null,
      damageReason: r.damageReason,
      actualReturnReason: r.actualReturnReason,
      note: r.note,
      receivedBy: r.receivedBy,
      receivedAt: r.receivedAt,
      cancelledAt: r.cancelledAt,
    })),
    receivedQty,
    requestedQty: lines.reduce((s, r) => s + r.l.requestedQty, 0),
    transitions: transitionOptions(ro.status, receivedQty),
    tagIds,
  };
}

/* ------------------------------------------------------- shippable lines */

export interface ShippableLine {
  readonly orderLineId: string;
  readonly productId: string;
  readonly sku: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly packType: string;
  readonly shippedQty: number;
  readonly alreadyReturned: number;
  readonly returnable: number;
  readonly isNonReturnable: boolean;
}

export interface ShippableOrder {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly warehouseId: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly customerName: string;
  readonly storeOrderNumber: string | null;
  readonly shippedAt: string | null;
  readonly deliveredAt: string | null;
  readonly shipTo: string;
  readonly shipCountry: string;
  readonly eligible: boolean;
  readonly reason: string | null;
  readonly lines: readonly ShippableLine[];
  /** Create RMA "Return address" choices: the warehouse's addresses, then the client's Return addresses. */
  readonly returnAddresses: readonly ReturnAddressOption[];
  readonly defaultReturnAddressId: string | null;
}

export interface ReturnAddressOption {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly owner: 'warehouse' | 'client';
}

/** Return address options for a warehouse + client (active only), warehouse first, default first. */
export async function returnAddressOptions(
  db: AppDb,
  warehouseId: string,
  clientId: string,
): Promise<{ options: ReturnAddressOption[]; defaultId: string | null }> {
  const ad = schema.addresses;
  const wh = (
    await db
      .select({ code: schema.warehouses.code })
      .from(schema.warehouses)
      .where(eq(schema.warehouses.id, warehouseId))
      .limit(1)
  )[0];
  const client = (
    await db
      .select({ name: schema.clients.name })
      .from(schema.clients)
      .where(eq(schema.clients.id, clientId))
      .limit(1)
  )[0];
  const rows = await db
    .select()
    .from(ad)
    .where(
      and(
        eq(ad.isActive, true),
        sql`((${ad.ownerType} = 'warehouse' AND ${ad.ownerId} = ${warehouseId}) OR (${ad.ownerType} = 'client' AND ${ad.ownerId} = ${clientId} AND ${ad.usageType} = 'Return'))`,
      ),
    );
  const rank = (a: (typeof rows)[number]) =>
    (a.ownerType === 'warehouse' ? 0 : 10) + (a.usageType === 'Return' ? 0 : 2) + (a.isDefault ? 0 : 1);
  const options = [...rows]
    .sort((a, b) => rank(a) - rank(b))
    .map((a): ReturnAddressOption => {
      const owner = a.ownerType === 'warehouse' ? 'warehouse' : 'client';
      const who =
        owner === 'warehouse'
          ? `${wh?.code ?? 'Warehouse'} warehouse`
          : `${client?.name ?? 'Client'} returns`;
      return {
        id: a.id,
        owner,
        label: a.name ?? a.companyName ?? who,
        description: [a.line1, a.city, [a.state, a.postalCode].filter(Boolean).join(' ')]
          .filter(Boolean)
          .join(', '),
      };
    });
  return { options, defaultId: options[0]?.id ?? null };
}

/** Quantity already committed to non-cancelled RMAs (Completed: returned; open: requested). */
export async function committedReturnQty(
  db: AppDb,
  orderLineId: string,
  excludeReturnId?: string,
): Promise<number> {
  return (
    (
      await dbGet<{ n: number }>(
        db,
        sql`SELECT COALESCE(SUM(CASE WHEN ro.status = 'Completed' THEN rl.returned_qty ELSE GREATEST(rl.requested_qty, rl.returned_qty) END), 0) AS n
    FROM return_order_lines rl JOIN return_orders ro ON ro.id = rl.return_order_id
    WHERE rl.order_line_id = ${orderLineId} AND ro.status <> 'Cancelled' ${excludeReturnId ? sql`AND ro.id <> ${excludeReturnId}` : sql``}`,
      )
    )?.n ?? 0
  );
}

export async function shippableOrder(db: AppDb, scope: Scope, orderId: string): Promise<ShippableOrder> {
  const so = (
    await db.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, orderId)).limit(1)
  )[0];
  if (!so || so.deletedAt) throw new DomainError('NOT_FOUND', 'Shipment order not found');
  assertInScope(scope, so, 'Shipment order');
  const client = (
    await db
      .select({ name: schema.clients.name })
      .from(schema.clients)
      .where(eq(schema.clients.id, so.clientId))
      .limit(1)
  )[0];
  // One grouped query over this order's RMAs (indexed by shipment_order_id) instead of one scan per line.
  const committed = new Map(
    (
      await dbAll<{ id: string; n: number }>(
        db,
        sql`SELECT rl.order_line_id AS id,
      SUM(CASE WHEN ro.status = 'Completed' THEN rl.returned_qty ELSE GREATEST(rl.requested_qty, rl.returned_qty) END) AS n
    FROM return_orders ro JOIN return_order_lines rl ON rl.return_order_id = ro.id
    WHERE ro.shipment_order_id = ${so.id} AND ro.status <> 'Cancelled' AND rl.order_line_id IS NOT NULL
    GROUP BY rl.order_line_id`,
      )
    ).map((r) => [r.id, r.n]),
  );
  const lines = (
    await db
      .select({ l: schema.orderLines, p: schema.products })
      .from(schema.orderLines)
      .innerJoin(schema.products, eq(schema.products.id, schema.orderLines.productId))
      .where(eq(schema.orderLines.orderId, so.id))
      .orderBy(asc(schema.products.sku))
  ).map(({ l, p }): ShippableLine => {
    const already = committed.get(l.id) ?? 0;
    return {
      orderLineId: l.id,
      productId: p.id,
      sku: p.sku,
      name: p.name,
      imageUrl: p.imageUrl,
      packType: l.packType,
      shippedQty: l.shippedQuantity,
      alreadyReturned: already,
      returnable: Math.max(0, l.shippedQuantity - already),
      isNonReturnable: p.isNonReturnable,
    };
  });
  const shippedStatus = (RETURNABLE_ORDER_STATUSES as readonly string[]).includes(so.status);
  const addresses = await returnAddressOptions(db, so.warehouseId, so.clientId);
  const anyReturnable = lines.some((l) => l.returnable > 0 && !l.isNonReturnable);
  const reason = !shippedStatus
    ? `Order ${so.code} is ${so.status}. Only shipped orders can be returned.`
    : !anyReturnable
      ? `Every shipped unit of ${so.code} is already on a return.`
      : null;
  return {
    id: so.id,
    code: so.code,
    status: so.status,
    warehouseId: so.warehouseId,
    clientId: so.clientId,
    clientName: client?.name ?? '',
    customerName: so.customerName,
    storeOrderNumber: so.storeOrderNumber,
    shippedAt: so.shippedAt,
    deliveredAt: so.deliveredAt,
    shipTo: [so.shipAddress, so.shipCity, so.shipState, so.shipZip].filter(Boolean).join(', '),
    shipCountry: so.shipCountry,
    eligible: reason === null,
    reason,
    lines,
    returnAddresses: addresses.options,
    defaultReturnAddressId: addresses.defaultId,
  };
}

/* ---------------------------------------------------------------- create */

export const packageSchema = z.object({
  weightOz: z.number().positive('Weight must be greater than 0').max(2400, 'Max 150 lb'),
  length: z.number().positive('Length is required'),
  width: z.number().positive('Width is required'),
  height: z.number().positive('Height is required'),
});

export const returnLabelSchema = z.object({
  carrierConnectionId: idSchema,
  carrierServiceId: idSchema,
  package: packageSchema,
});

/** "YYYY-MM-DD" calendar date (no time, no timezone). */
export const dateOnlySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date')
  .refine((v) => {
    const [y, m, d] = v.split('-').map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, 'Enter a valid date');

/** Max tracking numbers on one return (Logiwa "Return Tracking Number(s)" with Add). */
export const MAX_RETURN_TRACKING_NUMBERS = 10;

export const returnInfoSchema = z.object({
  carrierCode: z.string().trim().max(40).nullish(),
  carrierServiceName: z.string().trim().max(120).nullish(),
  shippingCost: z.number().min(0, "Cost can't be negative").max(100_000, 'Check the cost').nullish(),
  trackingNumbers: z
    .array(z.string().trim().min(1).max(60, 'Max 60 characters'))
    .max(MAX_RETURN_TRACKING_NUMBERS, `Up to ${MAX_RETURN_TRACKING_NUMBERS} tracking numbers`)
    .default([])
    .refine(
      (list) => new Set(list.map((t) => t.toUpperCase())).size === list.length,
      'Each tracking number once',
    ),
});

/** Tracking numbers are stored on the RMA as one comma-separated value (column `tracking_number`). */
export function joinTracking(list: readonly string[] | null | undefined): string | null {
  const clean = [...new Set((list ?? []).map((t) => t.trim()).filter(Boolean))];
  return clean.length ? clean.join(', ') : null;
}
export function splitTracking(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

export const createRmaSchema = z.object({
  shipmentOrderId: idSchema,
  lines: z
    .array(
      z.object({
        orderLineId: idSchema,
        quantity: z.number().int().min(1, 'Quantity must be at least 1'),
        customerReturnReasonId: idSchema.nullish(),
      }),
    )
    .min(1, 'Select at least one line to return'),
  expectedReturnDate: dateOnlySchema.nullish(),
  note: z.string().trim().max(1000).nullish(),
  label: returnLabelSchema.nullish(),
  returnAddressId: idSchema.nullish(),
  /** Return info recorded without buying a label (customer-supplied or marketplace label). Ignored when `label` is set. */
  returnInfo: returnInfoSchema.nullish(),
});
export type CreateRmaInput = z.output<typeof createRmaSchema>;

export interface CreateRmaResult {
  readonly id: string;
  readonly rmaCode: string;
  readonly status: ReturnStatus;
  readonly trackingNumber: string | null;
  readonly labelFileId: string | null;
  readonly labelError: string | null;
}

/* ------------------------------------------- per-RMA cost / tracking columns */

/**
 * Per-RMA return shipping cost and tracking-number list (REQ R3-1). The columns
 * `return_orders.return_shipping_cost real` and `return_orders.return_tracking_numbers text` (JSON
 * array) are added by foundation's schema; until a database has them, cost falls back to the
 * shipment order's Return section and tracking to the comma-joined `tracking_number`. Detected per
 * connection (PRAGMA, re-checked every minute) so a migration takes effect without a code change.
 */
const COLUMN_CHECK_MS = 60_000;
const columnCache = new WeakMap<
  object,
  { readonly at: number; readonly cost: boolean; readonly tracking: boolean }
>();
export async function rmaExtraColumns(
  db: AppDb,
): Promise<{ readonly cost: boolean; readonly tracking: boolean }> {
  const hit = columnCache.get(db as object);
  if (hit && Date.now() - hit.at < COLUMN_CHECK_MS) return hit;
  const names = new Set(
    (
      await dbAll<{ name: string }>(
        db,
        sql`SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'return_orders'`,
      )
    ).map((r) => r.name),
  );
  const next = {
    at: Date.now(),
    cost: names.has('return_shipping_cost'),
    tracking: names.has('return_tracking_numbers'),
  };
  columnCache.set(db as object, next);
  return next;
}

/** Per-RMA extras (null when the column is absent or empty). */
export async function readRmaExtras(
  db: AppDb,
  id: string,
): Promise<{ readonly cost: number | null; readonly tracking: string[] | null; readonly hasCost: boolean }> {
  const cols = await rmaExtraColumns(db);
  if (!cols.cost && !cols.tracking) return { cost: null, tracking: null, hasCost: false };
  const row = await dbGet<{ cost?: number | null; tracking?: string | null }>(
    db,
    sql`SELECT ${sql.raw(cols.cost ? 'return_shipping_cost' : 'NULL')} AS cost, ${sql.raw(cols.tracking ? 'return_tracking_numbers' : 'NULL')} AS tracking FROM return_orders WHERE id = ${id}`,
  );
  let tracking: string[] | null = null;
  if (row?.tracking) {
    try {
      const v: unknown = JSON.parse(row.tracking);
      if (Array.isArray(v)) tracking = v.filter((t): t is string => typeof t === 'string' && t.trim() !== '');
    } catch {
      tracking = null;
    }
  }
  return { cost: row?.cost ?? null, tracking, hasCost: cols.cost };
}

/** Writes the tracking list per RMA (JSON) when the column exists; `tracking_number` keeps the joined value either way. */
export async function writeRmaTracking(tx: AppDb, id: string, list: readonly string[]): Promise<void> {
  if (!(await rmaExtraColumns(tx)).tracking) return;
  const clean = [...new Set(list.map((t) => t.trim()).filter(Boolean))];
  await dbRun(
    tx,
    sql`UPDATE return_orders SET return_tracking_numbers = ${clean.length ? JSON.stringify(clean) : null} WHERE id = ${id}`,
  );
}

/**
 * Records the return shipping cost on the RMA itself when `return_orders.return_shipping_cost`
 * exists (change log on the return order). Otherwise it is kept where Logiwa keeps it: the shipment
 * order's Return section (`shipment_orders.return_shipping_cost`), with a change-log row on the order.
 */
export async function recordReturnShippingCost(
  tx: AppDb,
  ctx: ScopedCtx,
  rma: { readonly id: string; readonly rmaCode: string; readonly shipmentOrderId: string | null },
  cost: number,
): Promise<void> {
  if ((await rmaExtraColumns(tx)).cost) {
    const before = (await readRmaExtras(tx, rma.id)).cost;
    if (before === cost) return;
    await dbRun(tx, sql`UPDATE return_orders SET return_shipping_cost = ${cost} WHERE id = ${rma.id}`);
    await changeLog.recordUpdate(tx, ctx, {
      entityType: 'return_order',
      entityId: rma.id,
      entityCode: rma.rmaCode,
      before: { returnShippingCost: before },
      after: { returnShippingCost: cost },
    });
    return;
  }
  if (!rma.shipmentOrderId) return;
  const so = (
    await tx
      .select({
        id: schema.shipmentOrders.id,
        code: schema.shipmentOrders.code,
        cost: schema.shipmentOrders.returnShippingCost,
      })
      .from(schema.shipmentOrders)
      .where(eq(schema.shipmentOrders.id, rma.shipmentOrderId))
      .limit(1)
  )[0];
  if (!so || so.cost === cost) return;
  await tx
    .update(schema.shipmentOrders)
    .set({ returnShippingCost: cost, updatedBy: ctx.userId })
    .where(eq(schema.shipmentOrders.id, so.id));
  await changeLog.recordUpdate(tx, ctx, {
    entityType: 'shipment_order',
    entityId: so.id,
    entityCode: so.code,
    before: { returnShippingCost: so.cost },
    after: { returnShippingCost: cost },
  });
  // The RMA's own History shows the change too ("Return Shipping Cost is modified. — --> 0.00").
  await changeLog.recordUpdate(tx, ctx, {
    entityType: 'return_order',
    entityId: rma.id,
    entityCode: rma.rmaCode,
    before: { returnShippingCost: so.cost },
    after: { returnShippingCost: cost },
  });
}

/** Synchronous part (inside a transaction): validates quantities and inserts the RMA as Pending. */
export async function insertRma(
  tx: AppDb,
  ctx: ScopedCtx,
  input: CreateRmaInput,
  opts: { readonly source?: (typeof RETURN_SOURCES)[number] } = {},
): Promise<{ id: string; rmaCode: string; orderId: string }> {
  const order = await shippableOrder(tx, ctx.scope, input.shipmentOrderId);
  if (!(RETURNABLE_ORDER_STATUSES as readonly string[]).includes(order.status)) {
    throw new DomainError(
      'INVALID_STATE',
      `Order ${order.code} is ${order.status}. Only shipped orders can be returned.`,
    );
  }
  const seen = new Set<string>();
  const fieldErrors: Record<string, string[]> = {};
  input.lines.forEach((l, i) => {
    const line = order.lines.find((x) => x.orderLineId === l.orderLineId);
    if (!line) {
      fieldErrors[`lines.${i}.orderLineId`] = ['This line is not on the order'];
      return;
    }
    if (seen.has(l.orderLineId)) fieldErrors[`lines.${i}.orderLineId`] = ['Line selected twice'];
    seen.add(l.orderLineId);
    if (line.isNonReturnable) fieldErrors[`lines.${i}.quantity`] = [`${line.sku} is marked non-returnable`];
    else if (l.quantity > line.returnable)
      fieldErrors[`lines.${i}.quantity`] = [
        `Max ${line.returnable} (shipped ${line.shippedQty}, already on returns ${line.alreadyReturned})`,
      ];
  });
  if (Object.keys(fieldErrors).length > 0) {
    const first = Object.values(fieldErrors)[0]?.[0] ?? 'Invalid lines';
    throw validationError(first, fieldErrors);
  }
  if (input.returnAddressId && !order.returnAddresses.some((a) => a.id === input.returnAddressId)) {
    throw validationError('Choose a return address of this warehouse or client', {
      returnAddressId: ['Not an address of this warehouse or client'],
    });
  }
  const manual = input.label ? null : (input.returnInfo ?? null);
  const rmaCode = await sequences.next(tx, 'rma');
  const ro = (
    await tx
      .insert(schema.returnOrders)
      .values({
        rmaCode,
        shipmentOrderId: order.id,
        warehouseId: order.warehouseId,
        clientId: order.clientId,
        source: opts.source ?? 'RMA',
        status: 'Pending',
        customerName: order.customerName,
        fromCountry: order.shipCountry,
        expectedReturnDate: input.expectedReturnDate ?? null,
        returnAddressId: input.returnAddressId ?? order.defaultReturnAddressId ?? null,
        carrierCode: manual?.carrierCode || null,
        carrierServiceName: manual?.carrierServiceName || null,
        trackingNumber: joinTracking(manual?.trackingNumbers),
        note: input.note ?? null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning()
  )[0];
  await changeLog.recordCreate(tx, ctx, { entityType: 'return_order', entityId: ro.id, entityCode: rmaCode });
  for (const l of input.lines) {
    const line = order.lines.find((x) => x.orderLineId === l.orderLineId) as ShippableLine;
    const created = (
      await tx
        .insert(schema.returnOrderLines)
        .values({
          returnOrderId: ro.id,
          orderLineId: line.orderLineId,
          productId: line.productId,
          packType: line.packType,
          requestedQty: l.quantity,
          customerReturnReasonId: l.customerReturnReasonId ?? null,
          createdBy: ctx.userId,
        })
        .returning({ id: schema.returnOrderLines.id })
    )[0];
    // Logiwa writes "<SKU> -> Return Order Line is created." per line.
    await changeLog.recordLineCreate(tx, ctx, {
      entityType: 'return_order',
      entityId: ro.id,
      entityCode: rmaCode,
      lineEntityType: 'return_order_line',
      lineEntityId: created.id,
      lineLabel: line.sku,
    });
  }
  if (manual?.trackingNumbers?.length) await writeRmaTracking(tx, ro.id, manual.trackingNumbers);
  if (manual?.shippingCost !== null && manual?.shippingCost !== undefined)
    await recordReturnShippingCost(
      tx,
      ctx,
      { id: ro.id, rmaCode, shipmentOrderId: order.id },
      manual.shippingCost,
    );
  return { id: ro.id, rmaCode, orderId: order.id };
}

/**
 * Buys a return label for an RMA (shipping ops `return-label`) and stamps carrier,
 * service and tracking on the RMA. The RMA keeps its status (Pending until the carrier
 * scans it), so the label is bought without `returnOrderId` and linked here.
 */
export async function attachReturnLabel(
  db: AppDb,
  ctx: ScopedCtx,
  returnOrderId: string,
  label: z.output<typeof returnLabelSchema>,
): Promise<{ trackingNumber: string; labelFileId: string | null }> {
  const ro = await loadReturn(db, ctx.scope, returnOrderId);
  if (!ro.shipmentOrderId)
    throw new DomainError('INVALID_STATE', 'Return labels need a shipment order. Manual returns have none.');
  if (ro.status === 'Completed' || ro.status === 'Cancelled')
    throw new DomainError('INVALID_STATE', `A ${ro.status.toLowerCase()} return can't get a new label.`);
  const res = await shipping.createReturnLabel(db, ctx, {
    orderId: ro.shipmentOrderId,
    carrierConnectionId: label.carrierConnectionId,
    carrierServiceId: label.carrierServiceId,
    package: label.package,
  });
  await withWriteTx(db, async (tx) => {
    const after = (
      await tx
        .update(schema.returnOrders)
        .set({
          trackingNumber: res.trackingNumber,
          returnLabelShipmentId: res.shipment.id,
          carrierCode: res.shipment.carrierCode,
          carrierServiceName: res.shipment.serviceName,
          updatedBy: ctx.userId,
          version: sql`${schema.returnOrders.version} + 1`,
        })
        .where(eq(schema.returnOrders.id, ro.id))
        .returning()
    )[0];
    await writeRmaTracking(tx, ro.id, [res.trackingNumber]);
    await changeLog.recordUpdate(tx, ctx, {
      entityType: 'return_order',
      entityId: ro.id,
      entityCode: ro.rmaCode,
      before: {
        trackingNumber: ro.trackingNumber,
        carrierCode: ro.carrierCode,
        carrierServiceName: ro.carrierServiceName,
      },
      after: {
        trackingNumber: after.trackingNumber,
        carrierCode: after.carrierCode,
        carrierServiceName: after.carrierServiceName,
      },
    });
  });
  return { trackingNumber: res.trackingNumber, labelFileId: res.shipment.labelFileId };
}

export async function createRma(db: AppDb, ctx: ScopedCtx, input: CreateRmaInput): Promise<CreateRmaResult> {
  const created = await withWriteTx(db, async (tx) => await insertRma(tx, ctx, input));
  if (!input.label)
    return {
      id: created.id,
      rmaCode: created.rmaCode,
      status: 'Pending',
      trackingNumber: null,
      labelFileId: null,
      labelError: null,
    };
  try {
    const label = await attachReturnLabel(db, ctx, created.id, input.label);
    return {
      id: created.id,
      rmaCode: created.rmaCode,
      status: 'Pending',
      trackingNumber: label.trackingNumber,
      labelFileId: label.labelFileId,
      labelError: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Return label could not be created';
    return {
      id: created.id,
      rmaCode: created.rmaCode,
      status: 'Pending',
      trackingNumber: null,
      labelFileId: null,
      labelError: message,
    };
  }
}

/* ------------------------------------------------------------ status */

export const changeStatusSchema = z.object({
  ids: bulkIdsSchema,
  status: z.enum(RETURN_STATUSES),
  note: z.string().trim().max(500).nullish(),
  version: z.number().int().min(1).optional(),
});

async function applyStatus(
  tx: AppDb,
  ctx: ScopedCtx,
  ro: ReturnRow,
  to: ReturnStatus,
  note?: string | null,
): Promise<ReturnRow> {
  const received = await receivedTotal(tx, ro.id);
  const option = transitionOptions(ro.status, received).find((o) => o.status === to);
  if (!option || !option.ok)
    throw new DomainError('INVALID_STATE', option?.reason ?? `The return is already ${to}.`);
  const status = stateMachines.returnOrder.transition(ro.status, to);
  const now = new Date().toISOString();
  const after = (
    await tx
      .update(schema.returnOrders)
      .set({
        status,
        updatedBy: ctx.userId,
        version: sql`${schema.returnOrders.version} + 1`,
        ...(status === 'Completed' && !ro.actualReturnDate ? { actualReturnDate: now } : {}),
        ...(note ? { note: ro.note ? `${ro.note}\n${note}` : note } : {}),
      })
      .where(eq(schema.returnOrders.id, ro.id))
      .returning()
  )[0];
  if (status === 'Completed' || status === 'Cancelled') {
    await tx
      .update(schema.returnOrderLines)
      .set({ lineStatus: status, updatedBy: ctx.userId })
      .where(
        and(
          eq(schema.returnOrderLines.returnOrderId, ro.id),
          ne(schema.returnOrderLines.lineStatus, 'Completed'),
        ),
      );
  } else if (status === 'In Transit') {
    await tx
      .update(schema.returnOrderLines)
      .set({ lineStatus: 'In Transit', updatedBy: ctx.userId })
      .where(
        and(
          eq(schema.returnOrderLines.returnOrderId, ro.id),
          eq(schema.returnOrderLines.lineStatus, 'Pending'),
        ),
      );
  }
  await changeLog.recordUpdate(tx, ctx, {
    entityType: 'return_order',
    entityId: ro.id,
    entityCode: ro.rmaCode,
    before: { status: ro.status, actualReturnDate: ro.actualReturnDate },
    after: { status: after.status, actualReturnDate: after.actualReturnDate },
  });
  return after;
}

export async function changeReturnStatus(
  tx: AppDb,
  ctx: ScopedCtx,
  input: z.output<typeof changeStatusSchema>,
): Promise<BulkResult> {
  return await runBulk(tx, input.ids, async (inner, id) => {
    const ro = await loadReturn(inner, ctx.scope, id);
    if (input.ids.length === 1) assertVersion(ro.version, input.version);
    await applyStatus(inner, ctx, ro, input.status, input.note);
  });
}

/** Per-status eligibility for a selection (the Change Status modal only offers legal moves). */
export async function selectionTransitions(
  db: AppDb,
  scope: Scope,
  ids: readonly string[],
  selectedLineIds: readonly string[] = [],
): Promise<{
  readonly returns: readonly {
    id: string;
    rmaCode: string;
    status: ReturnStatus;
    lineCount: number;
    selectedLines: number | null;
  }[];
  readonly options: readonly (TransitionOption & { readonly eligible: number })[];
}> {
  const rows = await mapSeq([...new Set(ids)], async (id) => await loadReturn(db, scope, id));
  const per = await mapSeq(rows, async (ro) => transitionOptions(ro.status, await receivedTotal(db, ro.id)));
  const options = RETURN_STATUSES.map((status) => {
    const results = per.map(
      (opts) => opts.find((o) => o.status === status) ?? { status, ok: false, reason: `Already ${status}.` },
    );
    const eligible = results.filter((r) => r.ok).length;
    const firstReason = results.find((r) => !r.ok)?.reason ?? null;
    return {
      status,
      ok: eligible > 0,
      eligible,
      reason:
        eligible === rows.length
          ? null
          : eligible === 0
            ? firstReason
            : `${rows.length - eligible} of ${rows.length} can't move: ${firstReason ?? ''}`,
    };
  });
  // Line counts let the modal say "applies to RMA X (2 lines)" when only some of its lines were selected.
  const lineRows = rows.length
    ? await db
        .select({ id: schema.returnOrderLines.id, ro: schema.returnOrderLines.returnOrderId })
        .from(schema.returnOrderLines)
        .where(
          inArray(
            schema.returnOrderLines.returnOrderId,
            rows.map((r) => r.id),
          ),
        )
    : [];
  const picked = new Set(selectedLineIds);
  return {
    returns: rows.map((r) => {
      const mine = lineRows.filter((l) => l.ro === r.id);
      return {
        id: r.id,
        rmaCode: r.rmaCode,
        status: r.status,
        lineCount: mine.length,
        selectedLines: selectedLineIds.length ? mine.filter((l) => picked.has(l.id)).length : null,
      };
    }),
    options,
  };
}

/** Line ids → their return order ids (grid rows are RMA lines; bulk actions act on RMAs). */
export async function returnIdsForLines(
  db: AppDb,
  scope: Scope,
  lineIds: readonly string[],
): Promise<string[]> {
  if (lineIds.length === 0) return [];
  const rows = await db
    .select({
      id: schema.returnOrders.id,
      warehouseId: schema.returnOrders.warehouseId,
      clientId: schema.returnOrders.clientId,
    })
    .from(schema.returnOrderLines)
    .innerJoin(schema.returnOrders, eq(schema.returnOrders.id, schema.returnOrderLines.returnOrderId))
    .where(inArray(schema.returnOrderLines.id, [...lineIds]));
  return [
    ...new Set(
      rows
        .filter((r) => {
          try {
            assertInScope(scope, r, 'Return order');
            return true;
          } catch {
            return false;
          }
        })
        .map((r) => r.id),
    ),
  ];
}

export type { LineRow as ReturnLineRow, ReturnRow };

/* ------------------------------------------------- bulk update return info */

/** Logiwa "Bulk Update Return Info": fields set on every selected open RMA (omitted = unchanged, null = clear). */
export const bulkReturnInfoSchema = z
  .object({
    ids: bulkIdsSchema,
    expectedReturnDate: z.string().trim().max(40).nullish(),
    carrierCode: z.string().trim().max(60).nullish(),
    carrierServiceName: z.string().trim().max(120).nullish(),
    trackingNumber: z.string().trim().max(80).nullish(),
    fromCountry: z.string().trim().max(80).nullish(),
    note: z.string().trim().max(1000).nullish(),
  })
  .refine(
    (v) =>
      [
        'expectedReturnDate',
        'carrierCode',
        'carrierServiceName',
        'trackingNumber',
        'fromCountry',
        'note',
      ].some((k) => (v as Record<string, unknown>)[k] !== undefined),
    {
      message: 'Choose at least one field to update',
      path: ['expectedReturnDate'],
    },
  );

export const RETURN_INFO_FIELDS = [
  'expectedReturnDate',
  'carrierCode',
  'carrierServiceName',
  'trackingNumber',
  'fromCountry',
  'note',
] as const;

/** Builds the update patch from the request (empty strings clear the field). Pure; unit tested. */
export function returnInfoPatch(
  input: Partial<Record<(typeof RETURN_INFO_FIELDS)[number], string | null | undefined>>,
): Partial<Record<(typeof RETURN_INFO_FIELDS)[number], string | null>> {
  const patch: Partial<Record<(typeof RETURN_INFO_FIELDS)[number], string | null>> = {};
  for (const k of RETURN_INFO_FIELDS) {
    const v = input[k];
    if (v === undefined) continue;
    patch[k] = v === null || v === '' ? null : v;
  }
  return patch;
}

export async function bulkUpdateReturnInfo(
  tx: AppDb,
  ctx: ScopedCtx,
  input: z.output<typeof bulkReturnInfoSchema>,
): Promise<BulkResult> {
  const patch = returnInfoPatch(input);
  return await runBulk(tx, input.ids, async (inner, id) => {
    const ro = await loadReturn(inner, ctx.scope, id);
    if (ro.status === 'Completed' || ro.status === 'Cancelled')
      throw new DomainError(
        'INVALID_STATE',
        `${ro.rmaCode} is ${ro.status.toLowerCase()} and can't be edited.`,
      );
    const before = Object.fromEntries(
      Object.keys(patch).map((k) => [k, (ro as Record<string, unknown>)[k] ?? null]),
    );
    await inner
      .update(schema.returnOrders)
      .set({ ...patch, updatedBy: ctx.userId, version: sql`${schema.returnOrders.version} + 1` })
      .where(eq(schema.returnOrders.id, ro.id));
    if (patch.trackingNumber !== undefined)
      await writeRmaTracking(inner, ro.id, splitTracking(patch.trackingNumber));
    await changeLog.recordUpdate(inner, ctx, {
      entityType: 'return_order',
      entityId: ro.id,
      entityCode: ro.rmaCode,
      before,
      after: patch,
    });
  });
}

/* ------------------------------------------------------- void return label */

export async function voidReturnLabel(
  db: AppDb,
  ctx: ScopedCtx,
  returnOrderId: string,
): Promise<{ voided: number }> {
  const ro = await loadReturn(db, ctx.scope, returnOrderId);
  if (!ro.returnLabelShipmentId)
    throw new DomainError('INVALID_STATE', `${ro.rmaCode} has no return label to void.`);
  if (ro.status === 'Completed')
    throw new DomainError('INVALID_STATE', "The label of a completed return can't be voided.");
  const res = await shipping.voidLabel(db, ctx, { shipmentId: ro.returnLabelShipmentId });
  await withWriteTx(db, async (tx) => {
    await tx
      .update(schema.returnOrders)
      .set({
        trackingNumber: null,
        returnLabelShipmentId: null,
        updatedBy: ctx.userId,
        version: sql`${schema.returnOrders.version} + 1`,
      })
      .where(eq(schema.returnOrders.id, ro.id));
    await writeRmaTracking(tx, ro.id, []);
    await changeLog.recordUpdate(tx, ctx, {
      entityType: 'return_order',
      entityId: ro.id,
      entityCode: ro.rmaCode,
      before: { trackingNumber: ro.trackingNumber, returnLabel: 'Active' },
      after: { trackingNumber: null, returnLabel: 'Voided' },
    });
  });
  return res;
}

/* ------------------------------------------------- per-RMA return info edit */

/** Logiwa order › Return section, per RMA: carrier, option, cost and several tracking numbers (Add row). */
export const editReturnInfoSchema = z.object({
  carrierCode: z.string().trim().max(40).nullable(),
  carrierServiceName: z.string().trim().max(120).nullable(),
  shippingCost: z.number().min(0, "Cost can't be negative").max(100_000, 'Check the cost').nullable(),
  trackingNumbers: returnInfoSchema.shape.trackingNumbers,
  expectedReturnDate: dateOnlySchema.nullish(),
  fromCountry: z.string().trim().max(80).nullish(),
  version: z.number().int().optional(),
});

export async function editReturnInfo(
  db: AppDb,
  ctx: ScopedCtx,
  id: string,
  input: z.output<typeof editReturnInfoSchema>,
): Promise<{ readonly id: string; readonly trackingNumbers: readonly string[] }> {
  return await withWriteTx(db, async (tx) => {
    const ro = await loadReturn(tx, ctx.scope, id);
    if (ro.status === 'Completed' || ro.status === 'Cancelled')
      throw new DomainError(
        'INVALID_STATE',
        `${ro.rmaCode} is ${ro.status.toLowerCase()} and its return info can't be edited.`,
      );
    if (input.version !== undefined && input.version !== ro.version)
      throw new DomainError('CONFLICT', `${ro.rmaCode} was changed by someone else. Reload and try again.`);
    if (ro.returnLabelShipmentId && (input.carrierCode ?? null) !== (ro.carrierCode ?? null))
      throw new DomainError(
        'INVALID_STATE',
        `${ro.rmaCode} has a purchased return label. Void it before changing the carrier.`,
      );
    const after: Record<string, string | null> = {
      carrierCode: input.carrierCode || null,
      carrierServiceName: input.carrierServiceName || null,
      trackingNumber: joinTracking(input.trackingNumbers),
      ...(input.expectedReturnDate !== undefined
        ? { expectedReturnDate: input.expectedReturnDate || null }
        : {}),
      ...(input.fromCountry !== undefined ? { fromCountry: input.fromCountry || null } : {}),
    };
    const before = Object.fromEntries(
      Object.keys(after).map((k) => [k, (ro as Record<string, unknown>)[k] ?? null]),
    );
    await tx
      .update(schema.returnOrders)
      .set({ ...after, updatedBy: ctx.userId, version: sql`${schema.returnOrders.version} + 1` })
      .where(eq(schema.returnOrders.id, ro.id));
    await changeLog.recordUpdate(tx, ctx, {
      entityType: 'return_order',
      entityId: ro.id,
      entityCode: ro.rmaCode,
      before,
      after,
    });
    await writeRmaTracking(tx, ro.id, input.trackingNumbers);
    if (input.shippingCost !== null) await recordReturnShippingCost(tx, ctx, ro, input.shippingCost);
    return { id: ro.id, trackingNumbers: input.trackingNumbers };
  });
}
