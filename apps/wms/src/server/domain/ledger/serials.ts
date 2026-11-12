/** Serial numbers: register on receipt, pick, ship (BUILD_PLAN F5 ledger "Serials"). */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { InventoryStatus, TxnType } from '@/lib/enums';
import * as schema from '@/server/db/schema';
import { recordLine } from '../change-log';
import { DomainError } from '../errors';
import { checkScope, type DomainCtx, type Tx } from '../types';
import { mapSeq } from '@/server/db/sql';

export type SerialRow = typeof schema.serialNumbers.$inferSelect;
type SerialStatus = SerialRow['status'];

async function logSerial(
  tx: Tx,
  serialId: string,
  txnId: string,
  type: TxnType,
  status: SerialStatus,
): Promise<void> {
  await tx
    .insert(schema.serialTransactions)
    .values({ serialId, inventoryTransactionId: txnId, type, status });
}

export interface RegisterSerialsInput {
  readonly productId: string;
  readonly warehouseId: string;
  readonly clientId: string;
  readonly serials: readonly { readonly primary: string; readonly secondary?: string | null }[];
  readonly inventoryId: string;
  readonly receiptId?: string | null;
  readonly txnId: string;
  readonly type?: TxnType;
}

export async function registerSerials(
  tx: Tx,
  ctx: DomainCtx,
  input: RegisterSerialsInput,
): Promise<SerialRow[]> {
  const primaries = input.serials.map((s) => s.primary.trim());
  if (primaries.some((p) => p.length === 0))
    throw new DomainError('VALIDATION', "Serial numbers can't be empty");
  const dupInInput = primaries.find((p, i) => primaries.indexOf(p) !== i);
  if (dupInInput)
    throw new DomainError('DUPLICATE', `Serial number ${dupInInput} is entered more than once.`);
  if (primaries.length === 0) return [];
  const existing = await tx
    .select()
    .from(schema.serialNumbers)
    .where(
      and(
        eq(schema.serialNumbers.productId, input.productId),
        inArray(schema.serialNumbers.primarySerial, primaries),
      ),
    );
  const reusable = new Map(
    existing
      .filter((s) => s.status === 'Shipped' || s.status === 'Receipt Cancelled')
      .map((s) => [s.primarySerial, s]),
  );
  const live = existing.find((s) => !reusable.has(s.primarySerial));
  if (live) throw new DomainError('DUPLICATE', `Serial number ${live.primarySerial} is already in stock.`);
  return await mapSeq(input.serials, async (s) => {
    const primary = s.primary.trim();
    const values = {
      productId: input.productId,
      warehouseId: input.warehouseId,
      clientId: input.clientId,
      primarySerial: primary,
      secondarySerial: s.secondary ?? null,
      status: 'Received' as const,
      inventoryId: input.inventoryId,
      receiptId: input.receiptId ?? null,
      orderLineId: null,
      shipmentId: null,
      updatedBy: ctx.userId,
    };
    const prior = reusable.get(primary);
    const row = prior
      ? (
          await tx
            .update(schema.serialNumbers)
            .set(values)
            .where(eq(schema.serialNumbers.id, prior.id))
            .returning()
        )[0]
      : (
          await tx
            .insert(schema.serialNumbers)
            .values({ ...values, createdBy: ctx.userId })
            .returning()
        )[0];
    await logSerial(tx, row.id, input.txnId, input.type ?? 'Receiving', 'Received');
    return row;
  });
}

export async function pickSerial(
  tx: Tx,
  ctx: DomainCtx,
  input: {
    productId: string;
    serial: string;
    orderLineId: string;
    fromInventoryId: string;
    toInventoryId: string;
    txnId: string;
  },
): Promise<SerialRow> {
  const row = (
    await tx
      .select()
      .from(schema.serialNumbers)
      .where(
        and(
          eq(schema.serialNumbers.productId, input.productId),
          eq(schema.serialNumbers.primarySerial, input.serial),
        ),
      )
      .limit(1)
  )[0];
  if (!row) throw new DomainError('NOT_FOUND', `Serial number ${input.serial} not found`);
  if (row.status !== 'Received' && row.status !== 'Updated')
    throw new DomainError('INVALID_STATE', `Serial number ${input.serial} is ${row.status.toLowerCase()}.`);
  if (row.inventoryId !== input.fromInventoryId)
    throw new DomainError('RULE_VIOLATION', `Serial number ${input.serial} is not in the picked location.`);
  const updated = (
    await tx
      .update(schema.serialNumbers)
      .set({
        status: 'Picked',
        orderLineId: input.orderLineId,
        inventoryId: input.toInventoryId,
        updatedBy: ctx.userId,
      })
      .where(eq(schema.serialNumbers.id, row.id))
      .returning()
  )[0];
  await logSerial(tx, row.id, input.txnId, 'Picking', 'Picked');
  return updated;
}

/** Marks every picked serial of an order line shipped. Returns the count. */
export async function shipSerials(
  tx: Tx,
  ctx: DomainCtx,
  input: { orderLineId: string; shipmentId: string | null; txnId: string },
): Promise<number> {
  const rows = await tx
    .select()
    .from(schema.serialNumbers)
    .where(
      and(eq(schema.serialNumbers.orderLineId, input.orderLineId), eq(schema.serialNumbers.status, 'Picked')),
    );
  for (const row of rows) {
    await tx
      .update(schema.serialNumbers)
      .set({ status: 'Shipped', shipmentId: input.shipmentId, inventoryId: null, updatedBy: ctx.userId })
      .where(eq(schema.serialNumbers.id, row.id));
    await logSerial(tx, row.id, input.txnId, 'Shipment', 'Shipped');
  }
  return rows.length;
}

export async function cancelReceiptSerials(
  tx: Tx,
  ctx: DomainCtx,
  receiptId: string,
  txnId: string,
): Promise<number> {
  const rows = await tx
    .select()
    .from(schema.serialNumbers)
    .where(eq(schema.serialNumbers.receiptId, receiptId));
  const inStock = rows.filter((r) => r.status === 'Received' || r.status === 'Updated');
  if (inStock.length !== rows.length)
    throw new DomainError(
      'INVALID_STATE',
      'Some serial numbers of this receipt were already picked or shipped.',
    );
  for (const row of inStock) {
    await tx
      .update(schema.serialNumbers)
      .set({ status: 'Receipt Cancelled', inventoryId: null, updatedBy: ctx.userId })
      .where(eq(schema.serialNumbers.id, row.id));
    await logSerial(tx, row.id, txnId, 'Cancel Receiving', 'Receipt Cancelled');
  }
  return inStock.length;
}

/* ------------------------------------------------- serials follow the ledger */
const ON_HAND_SERIAL: readonly SerialStatus[] = ['Received', 'Updated', 'Picked'];

async function isSerialTracked(tx: Tx, productId: string): Promise<boolean> {
  return (
    (
      await tx
        .select({ trackSerial: schema.products.trackSerial })
        .from(schema.products)
        .where(eq(schema.products.id, productId))
        .limit(1)
    )[0]?.trackSerial === true
  );
}

export interface CarrySerialsInput {
  readonly productId: string;
  readonly fromInventoryId: string;
  readonly toInventoryId: string;
  /** Units moved by the ledger. */
  readonly qty: number;
  /** Source bucket on-hand after the move. */
  readonly sourceOnHand: number;
  readonly toStatus: InventoryStatus;
  readonly orderLineId?: string | null;
  readonly txnId: string;
  readonly type: TxnType;
}

/**
 * Keeps serial rows with their units when the ledger moves stock without scanned serials
 * (web picks, transfers, putaway, status changes). Only the serials the source can no longer
 * hold move, so it is a no-op when the caller already moved scanned serials with `pickSerial`.
 * Serials pre-assigned to the order line move first, then oldest first. Returns the count moved.
 */
export async function carrySerials(tx: Tx, ctx: DomainCtx, input: CarrySerialsInput): Promise<number> {
  if (!(await isSerialTracked(tx, input.productId))) return 0;
  const inSource = await tx
    .select()
    .from(schema.serialNumbers)
    .where(
      and(
        eq(schema.serialNumbers.inventoryId, input.fromInventoryId),
        inArray(schema.serialNumbers.status, [...ON_HAND_SERIAL]),
      ),
    );
  const count = Math.min(input.qty, Math.max(0, inSource.length - input.sourceOnHand));
  if (count === 0) return 0;
  const line = input.orderLineId ?? null;
  const ordered = [...inSource].sort((a, b) => {
    const aLine = line !== null && a.orderLineId === line ? 0 : 1;
    const bLine = line !== null && b.orderLineId === line ? 0 : 1;
    return (
      aLine - bLine || a.entryAt.localeCompare(b.entryAt) || a.primarySerial.localeCompare(b.primarySerial)
    );
  });
  const toStock = input.toStatus === 'Stock';
  for (const row of ordered.slice(0, count)) {
    const status: SerialStatus = toStock
      ? row.status === 'Picked'
        ? 'Received'
        : row.status
      : line
        ? 'Picked'
        : row.status;
    await tx
      .update(schema.serialNumbers)
      .set({
        inventoryId: input.toInventoryId,
        status,
        orderLineId: !toStock && line ? line : row.orderLineId,
        updatedBy: ctx.userId,
      })
      .where(eq(schema.serialNumbers.id, row.id));
    await logSerial(tx, row.id, input.txnId, input.type, status);
  }
  return count;
}

export interface RestockReturnedSerialsInput {
  readonly orderLineId: string;
  readonly productId: string;
  readonly inventoryId: string;
  readonly qty: number;
  readonly txnId: string;
}

/**
 * A return restocked without scanned serials puts back serials that shipped on the original
 * order line (oldest first), so the restocked bucket keeps one serial per unit. Returns the count.
 */
export async function restockReturnedSerials(
  tx: Tx,
  ctx: DomainCtx,
  input: RestockReturnedSerialsInput,
): Promise<number> {
  if (!(await isSerialTracked(tx, input.productId))) return 0;
  const shipped = (
    await tx
      .select()
      .from(schema.serialNumbers)
      .where(
        and(
          eq(schema.serialNumbers.orderLineId, input.orderLineId),
          eq(schema.serialNumbers.productId, input.productId),
          eq(schema.serialNumbers.status, 'Shipped'),
        ),
      )
  )
    .sort((a, b) => a.entryAt.localeCompare(b.entryAt) || a.primarySerial.localeCompare(b.primarySerial))
    .slice(0, input.qty);
  for (const row of shipped) {
    await tx
      .update(schema.serialNumbers)
      .set({ status: 'Received', inventoryId: input.inventoryId, orderLineId: null, updatedBy: ctx.userId })
      .where(eq(schema.serialNumbers.id, row.id));
    await logSerial(tx, row.id, input.txnId, 'Return Receiving', 'Received');
  }
  return shipped.length;
}

/* ---------------------------------------------- order-line serial assignment */
const ASSIGNABLE: ReadonlySet<SerialRow['status']> = new Set(['Received', 'Updated']);

/**
 * Pre-assigns a registered serial to a shipment-order line (SO serials import;
 * docs/requests/orders-outbound.md REQ-3). No stock moves, so no serial transaction is written;
 * the link is logged on the order. Idempotent for the same line.
 */
export async function assignOrderSerial(
  tx: Tx,
  ctx: DomainCtx,
  input: { orderLineId: string; serial: string },
): Promise<SerialRow> {
  const serial = input.serial.trim();
  if (!serial) throw new DomainError('VALIDATION', 'Serial number is required');
  const line = (
    await tx.select().from(schema.orderLines).where(eq(schema.orderLines.id, input.orderLineId)).limit(1)
  )[0];
  if (!line) throw new DomainError('NOT_FOUND', 'Order line not found');
  const order = (
    await tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, line.orderId)).limit(1)
  )[0];
  if (!order) throw new DomainError('NOT_FOUND', 'Shipment order not found');
  if (ctx.scope) checkScope(ctx, order, 'Shipment order');
  const sn = (
    await tx
      .select()
      .from(schema.serialNumbers)
      .where(
        and(
          eq(schema.serialNumbers.productId, line.productId),
          eq(schema.serialNumbers.primarySerial, serial),
        ),
      )
      .limit(1)
  )[0];
  if (!sn) throw new DomainError('NOT_FOUND', `Serial ${serial} is not registered for this product`);
  if (sn.orderLineId === line.id) return sn;
  if (sn.orderLineId)
    throw new DomainError('DUPLICATE', `Serial ${serial} is already assigned to another order`);
  if (sn.shipmentId || !ASSIGNABLE.has(sn.status))
    throw new DomainError(
      'INVALID_STATE',
      `Serial ${serial} is ${sn.status.toLowerCase()} and can't be assigned`,
    );
  if (sn.warehouseId !== order.warehouseId)
    throw new DomainError('VALIDATION', `Serial ${serial} is in another warehouse`);
  const assigned = (
    await tx
      .select({ id: schema.serialNumbers.id })
      .from(schema.serialNumbers)
      .where(eq(schema.serialNumbers.orderLineId, line.id))
  ).length;
  if (assigned >= line.quantity - line.cancelledQuantity)
    throw new DomainError('RULE_VIOLATION', 'This line already has a serial number for every unit');
  const row = (
    await tx
      .update(schema.serialNumbers)
      .set({ orderLineId: line.id, updatedBy: ctx.userId })
      .where(eq(schema.serialNumbers.id, sn.id))
      .returning()
  )[0];
  const product = (
    await tx
      .select({ sku: schema.products.sku })
      .from(schema.products)
      .where(eq(schema.products.id, line.productId))
      .limit(1)
  )[0];
  await recordLine(tx, ctx, {
    entityType: 'shipment_order',
    entityId: order.id,
    entityCode: order.code,
    lineEntityType: 'order_line',
    lineEntityId: line.id,
    lineLabel: product?.sku ?? 'Line',
    field: 'serialNumbers',
    from: '',
    to: serial,
  });
  return row;
}

/** Detaches every not-yet-picked serial from an order line (Delete ▾ Remove Serial Number). Returns the count. */
export async function unassignOrderSerials(
  tx: Tx,
  ctx: DomainCtx,
  input: { orderLineId: string },
): Promise<number> {
  const line = (
    await tx.select().from(schema.orderLines).where(eq(schema.orderLines.id, input.orderLineId)).limit(1)
  )[0];
  if (!line) throw new DomainError('NOT_FOUND', 'Order line not found');
  const order = (
    await tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, line.orderId)).limit(1)
  )[0];
  if (!order) throw new DomainError('NOT_FOUND', 'Shipment order not found');
  if (ctx.scope) checkScope(ctx, order, 'Shipment order');
  const rows = await tx
    .select()
    .from(schema.serialNumbers)
    .where(
      and(
        eq(schema.serialNumbers.orderLineId, line.id),
        isNull(schema.serialNumbers.shipmentId),
        inArray(schema.serialNumbers.status, [...ASSIGNABLE]),
      ),
    );
  if (rows.length === 0) return 0;
  await tx
    .update(schema.serialNumbers)
    .set({ orderLineId: null, updatedBy: ctx.userId })
    .where(
      inArray(
        schema.serialNumbers.id,
        rows.map((r) => r.id),
      ),
    );
  const product = (
    await tx
      .select({ sku: schema.products.sku })
      .from(schema.products)
      .where(eq(schema.products.id, line.productId))
      .limit(1)
  )[0];
  await recordLine(tx, ctx, {
    entityType: 'shipment_order',
    entityId: order.id,
    entityCode: order.code,
    lineEntityType: 'order_line',
    lineEntityId: line.id,
    lineLabel: product?.sku ?? 'Line',
    field: 'serialNumbers',
    from: rows.map((r) => r.primarySerial).join(', '),
    to: '',
  });
  return rows.length;
}
