/**
 * `createOrder`: validation -> code generation -> address verification -> workflow run -> change log.
 * `updateOrder`: optimistic concurrency + field locks by status (lines are read-only once
 * the order is allocated / picking starts).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '@/server/db/schema';
import { verifyAddress } from '../address-verification';
import { recordCreate, recordLine, recordLineCreate, recordUpdate } from '../change-log';
import { DomainError } from '../errors';
import type { OrderLineRow, OrderRow } from '../facts';
import { AppError } from '@/server/api/errors';
import { next, peek } from '../sequences';
import { checkScope, type DomainCtx, type Tx } from '../types';
import { runWorkflows } from '../workflows';
import {
  ADDRESS_FIELDS,
  createOrderSchema,
  updateOrderSchema,
  type CreateOrderInput,
  type OrderLineInput,
  type UpdateOrderInput,
} from './schemas';

type ProductRow = typeof schema.products.$inferSelect;

export async function loadOrderRow(tx: Tx, ctx: DomainCtx, id: string): Promise<OrderRow> {
  const order = (
    await tx.select().from(schema.shipmentOrders).where(eq(schema.shipmentOrders.id, id)).limit(1)
  )[0];
  if (!order || order.deletedAt) throw new DomainError('NOT_FOUND', 'Shipment order not found');
  checkScope(ctx, order, 'Shipment order');
  return order;
}

async function loadProducts(
  tx: Tx,
  clientId: string,
  lines: readonly { productId: string }[],
): Promise<Map<string, ProductRow>> {
  const ids = [...new Set(lines.map((l) => l.productId))];
  const rows = await tx.select().from(schema.products).where(inArray(schema.products.id, ids));
  const map = new Map(rows.map((p) => [p.id, p]));
  for (const id of ids) {
    const p = map.get(id);
    if (!p) throw new DomainError('VALIDATION', 'A line references a product that does not exist.');
    if (p.clientId !== clientId)
      throw new DomainError('VALIDATION', `Product ${p.sku} belongs to another client.`);
    if (p.status !== 'Active') throw new DomainError('VALIDATION', `Product ${p.sku} is inactive.`);
  }
  return map;
}

function lineValues(
  orderId: string,
  line: OrderLineInput,
  product: ProductRow,
  ctx: DomainCtx,
): typeof schema.orderLines.$inferInsert {
  return {
    orderId,
    productId: product.id,
    quantity: line.quantity,
    unitPrice: line.unitPrice ?? product.price,
    packType: line.packType ?? product.uom,
    lotNumber: line.lotNumber ?? null,
    expiryDate: line.expiryDate ?? null,
    productionDate: line.productionDate ?? null,
    damageReason: line.damageReason ?? null,
    pinnedLocationId: line.pinnedLocationId ?? null,
    pinnedLpId: line.pinnedLpId ?? null,
    lineNote1: line.lineNote1 ?? null,
    lineNote2: line.lineNote2 ?? null,
    lineNote3: line.lineNote3 ?? null,
    createdBy: ctx.userId,
    updatedBy: ctx.userId,
  };
}

function totals(
  lines: readonly OrderLineInput[],
  products: ReadonlyMap<string, ProductRow>,
): { totalQuantity: number; totalWeightOz: number; salesPrice: number } {
  let totalQuantity = 0;
  let totalWeightOz = 0;
  let salesPrice = 0;
  for (const l of lines) {
    const p = products.get(l.productId);
    totalQuantity += l.quantity;
    totalWeightOz += (p?.weightOz ?? 0) * l.quantity;
    salesPrice += (l.unitPrice ?? p?.price ?? 0) * l.quantity;
  }
  return {
    totalQuantity,
    totalWeightOz: Math.round(totalWeightOz * 100) / 100,
    salesPrice: Math.round(salesPrice * 100) / 100,
  };
}

function addressCheck(
  a: {
    shipAddress: string;
    shipAddress2?: string | null;
    shipCity: string;
    shipState?: string | null;
    shipZip: string;
    shipCountry: string;
  },
  skip: boolean,
) {
  if (skip) return null;
  return verifyAddress({
    line1: a.shipAddress,
    line2: a.shipAddress2,
    city: a.shipCity,
    state: a.shipState,
    postalCode: a.shipZip,
    country: a.shipCountry,
  });
}

export async function orderCodeTaken(tx: Tx, code: string): Promise<boolean> {
  return Boolean(
    (
      await tx
        .select({ id: schema.shipmentOrders.id })
        .from(schema.shipmentOrders)
        .where(sql`upper(${schema.shipmentOrders.code}) = ${code.trim().toUpperCase()}`)
        .limit(1)
    )[0],
  );
}

/** Consumes sequence values until one is not used by an existing order (hand-typed codes can collide). */
export async function nextFreeOrderCode(tx: Tx): Promise<string> {
  for (let i = 0; i < 10_000; i += 1) {
    const code = await next(tx, 'so');
    if (!(await orderCodeTaken(tx, code))) return code;
  }
  throw new DomainError('CONFLICT', 'Could not find a free shipment order code');
}

/** The next free code without consuming it; burns sequence values that are already taken. */
export async function peekFreeOrderCode(tx: Tx): Promise<string> {
  for (let i = 0; i < 10_000; i += 1) {
    const code = await peek(tx, 'so');
    if (!(await orderCodeTaken(tx, code))) return code;
    await next(tx, 'so');
  }
  throw new DomainError('CONFLICT', 'Could not find a free shipment order code');
}

export interface CreateOrderOptions {
  readonly trigger?: 'Shipment Order Created' | 'Shipment Order Imported';
}

export async function createOrder(
  tx: Tx,
  ctx: DomainCtx,
  raw: CreateOrderInput,
  opts: CreateOrderOptions = {},
): Promise<OrderRow> {
  const input = createOrderSchema.parse(raw);
  checkScope(ctx, input, 'Warehouse');
  const wh = (
    await tx.select().from(schema.warehouses).where(eq(schema.warehouses.id, input.warehouseId)).limit(1)
  )[0];
  if (!wh || !wh.isActive) throw new DomainError('VALIDATION', 'Warehouse not found or inactive');
  const client = (
    await tx.select().from(schema.clients).where(eq(schema.clients.id, input.clientId)).limit(1)
  )[0];
  if (!client || client.status !== 'Active')
    throw new DomainError('VALIDATION', 'Client not found or inactive');
  const products = await loadProducts(tx, client.id, input.lines);
  // The wizard sends the peeked code back: treat it as "use the sequence" so the sequence advances.
  const fromSequence = !input.code || input.code.toUpperCase() === (await peek(tx, 'so')).toUpperCase();
  if (!fromSequence && (await orderCodeTaken(tx, input.code as string))) {
    throw new AppError('DUPLICATE', `Shipment order code ${input.code} already exists.`, {
      fieldErrors: { code: ['This order code is already taken'] },
    });
  }
  const code = fromSequence ? await nextFreeOrderCode(tx) : (input.code as string);
  const check = addressCheck(input, input.skipAddressVerification);
  const { lines, customFields, orderDate, ...header } = input;
  const order = (
    await tx
      .insert(schema.shipmentOrders)
      .values({
        ...header,
        code,
        status: 'Open',
        orderDate: orderDate ?? new Date().toISOString(),
        customFields: customFields ?? {},
        ...totals(lines, products),
        shipAddress: check?.normalized.line1 ?? input.shipAddress,
        shipAddress2: check ? null : (input.shipAddress2 ?? null),
        shipState: check?.normalized.state ?? input.shipState,
        shipCountry: check?.normalized.country ?? input.shipCountry,
        addressVerificationStatus: check?.status ?? 'Skipped',
        addressVerificationNotes: check ? [...check.notes] : null,
        addressType: input.addressType ?? (check?.isMilitary ? 'Military' : null),
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning()
  )[0];
  const inserted = await tx
    .insert(schema.orderLines)
    .values(lines.map((l) => lineValues(order.id, l, products.get(l.productId) as ProductRow, ctx)))
    .returning();
  await recordCreate(tx, ctx, { entityType: 'shipment_order', entityId: order.id, entityCode: order.code });
  // One entry per line (Logiwa: "<SKU> -> Shipment Order Line is created"), for UI, import and channel creates alike.
  for (const line of inserted) {
    await recordLineCreate(tx, ctx, {
      entityType: 'shipment_order',
      entityId: order.id,
      entityCode: order.code,
      lineEntityType: 'order_line',
      lineEntityId: line.id,
      lineLabel: products.get(line.productId)?.sku ?? 'Line',
    });
  }
  // Imported orders (channel download, Excel/CSV) run their own trigger first, then the
  // every-new-order "Shipment Order Created" workflows (M12 trigger semantics).
  if (opts.trigger === 'Shipment Order Imported')
    await runWorkflows(tx, ctx, 'Shipment Order Imported', { type: 'shipment_order', id: order.id });
  await runWorkflows(tx, ctx, 'Shipment Order Created', { type: 'shipment_order', id: order.id });
  return await loadOrderRow(tx, ctx, order.id);
}

const TERMINAL: readonly OrderRow['status'][] = ['Shipped', 'Partially Shipped', 'Delivered', 'Cancelled'];
const LINE_EDITABLE: readonly OrderRow['status'][] = ['Open', 'Shortage', 'On Hold'];
const NOTE_FIELDS = new Set([
  'note',
  'extraNote1',
  'extraNote2',
  'extraNote3',
  'extraNote4',
  'extraNote5',
  'customFields',
]);

async function replaceLines(
  tx: Tx,
  ctx: DomainCtx,
  order: OrderRow,
  lines: NonNullable<ReturnType<typeof updateOrderSchema.parse>['lines']>,
): Promise<ReturnType<typeof totals>> {
  const existing = await tx.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, order.id));
  if (existing.some((l) => l.allocatedQuantity > 0 || l.pickedQuantity > 0)) {
    throw new DomainError('INVALID_STATE', 'Deallocate the order before changing its lines.');
  }
  const products = await loadProducts(tx, order.clientId, [...lines, ...existing]);
  const keep = new Set(lines.flatMap((l) => (l.id ? [l.id] : [])));
  const byId = new Map(existing.map((l) => [l.id, l]));
  const sku = (productId: string) => products.get(productId)?.sku ?? productId;
  const log = async (line: OrderLineRow | { id: string; productId: string }, from: number, to: number) =>
    await recordLine(tx, ctx, {
      entityType: 'shipment_order',
      entityId: order.id,
      entityCode: order.code,
      lineEntityType: 'order_line',
      lineEntityId: line.id,
      lineLabel: sku(line.productId),
      field: 'quantity',
      from,
      to,
    });
  for (const old of existing.filter((l) => !keep.has(l.id))) {
    await tx.delete(schema.orderLineShortages).where(eq(schema.orderLineShortages.orderLineId, old.id));
    await tx.delete(schema.orderLines).where(eq(schema.orderLines.id, old.id));
    await log(old, old.quantity, 0);
  }
  for (const line of lines) {
    const product = products.get(line.productId) as ProductRow;
    const prior = line.id ? byId.get(line.id) : undefined;
    if (line.id && !prior) throw new DomainError('NOT_FOUND', 'Order line not found');
    if (prior) {
      await tx
        .update(schema.orderLines)
        .set({ ...lineValues(order.id, line, product, ctx), createdBy: prior.createdBy })
        .where(eq(schema.orderLines.id, prior.id));
      await log(prior, prior.quantity, line.quantity);
    } else {
      const row = (
        await tx
          .insert(schema.orderLines)
          .values(lineValues(order.id, line, product, ctx))
          .returning()
      )[0];
      await log(row, 0, line.quantity);
    }
  }
  return totals(lines, products);
}

export async function updateOrder(tx: Tx, ctx: DomainCtx, raw: UpdateOrderInput): Promise<OrderRow> {
  const input = updateOrderSchema.parse(raw);
  const order = await loadOrderRow(tx, ctx, input.id);
  if (order.version !== input.version)
    throw new DomainError('CONFLICT', 'This order changed since you opened it. Reload and try again.');
  const patch = Object.fromEntries(Object.entries(input.patch).filter(([, v]) => v !== undefined));
  if (
    TERMINAL.includes(order.status) &&
    (input.lines || Object.keys(patch).some((k) => !NOTE_FIELDS.has(k)))
  ) {
    throw new DomainError(
      'INVALID_STATE',
      `Only notes can be changed on an order in ${order.status} status.`,
    );
  }
  if (input.lines && !LINE_EDITABLE.includes(order.status)) {
    throw new DomainError('INVALID_STATE', `Lines can't be changed on an order in ${order.status} status.`);
  }
  const lineTotals = input.lines ? await replaceLines(tx, ctx, order, input.lines) : null;
  const merged = { ...order, ...patch };
  const addressChanged = ADDRESS_FIELDS.some((f) => f in patch && patch[f] !== order[f]);
  const check = addressChanged ? addressCheck(merged, merged.skipAddressVerification) : null;
  const after = (
    await tx
      .update(schema.shipmentOrders)
      .set({
        ...patch,
        ...(lineTotals ?? {}),
        ...(check
          ? {
              shipAddress: check.normalized.line1,
              shipAddress2: null,
              shipState: check.normalized.state ?? merged.shipState,
              shipCountry: check.normalized.country,
              addressVerificationStatus: check.status,
              addressVerificationNotes: [...check.notes],
            }
          : {}),
        updatedBy: ctx.userId,
        version: sql`${schema.shipmentOrders.version} + 1`,
      })
      .where(and(eq(schema.shipmentOrders.id, order.id), eq(schema.shipmentOrders.version, input.version)))
      .returning()
  )[0];
  if (!after) throw new DomainError('CONFLICT', 'This order changed since you opened it. Reload and try again.');
  await recordUpdate(tx, ctx, {
    entityType: 'shipment_order',
    entityId: order.id,
    entityCode: order.code,
    before: order,
    after,
  });
  await runWorkflows(tx, ctx, 'Shipment Order Updated', { type: 'shipment_order', id: order.id });
  return await loadOrderRow(tx, ctx, order.id);
}
