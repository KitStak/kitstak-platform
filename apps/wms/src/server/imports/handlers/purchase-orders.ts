/**
 * Import handler "purchase-orders" (owner M05). Rows with the same PO Code form one PO:
 * the first row creates it (Pending), later rows append lines while it is still Pending.
 * Vendors are matched by display name within the client and created when missing.
 */
import { and, eq, sql } from 'drizzle-orm';
import { PO_TYPES } from '@/lib/enums';
import { AppError } from '@/server/api/errors';
import * as schema from '@/server/db/schema';
import { changeLog } from '@/server/domain';
import { domainCtx } from '@/server/repositories/platform-common';
import { createPurchaseOrder } from '@/server/repositories/purchase-orders-commands';
import { ensureVendor } from '@/server/repositories/vendors';
import type { ImportHandler, ImportRowValues } from '../types';

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const dateIso = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new AppError('VALIDATION', `"${s}" is not a valid date`);
  return new Date(t).toISOString();
};

/** Calendar-date cell (expiry): stored as YYYY-MM-DD, never an instant (no timezone drift). Excel serials and "5/28/2027" are read as that local day. */
export const dayOf = (v: unknown): string | null => {
  if (v instanceof Date && !Number.isNaN(v.getTime()))
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  const s = str(v);
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new AppError('VALIDATION', `"${s}" is not a valid date`);
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const PO_TYPE_ALIASES: Readonly<Record<string, (typeof PO_TYPES)[number]>> = {
  standard: 'Purchase Order',
  po: 'Purchase Order',
  transfer: 'Transfer Order',
  return: 'Return Order',
  open: 'Open Order',
};

export function resolvePoType(raw: string): (typeof PO_TYPES)[number] {
  if (!raw) return 'Purchase Order';
  const exact = PO_TYPES.find((t) => t.toLowerCase() === raw.toLowerCase());
  const alias = PO_TYPE_ALIASES[raw.toLowerCase()];
  if (exact) return exact;
  if (alias) return alias;
  throw new AppError('VALIDATION', `Unknown PO type "${raw}". Use one of: ${PO_TYPES.join(', ')}`);
}

export const handler: ImportHandler = {
  configured: true,
  owner: 'M05',
  async apply(ctx, row: ImportRowValues) {
    const db = ctx.db;
    const dctx = domainCtx(ctx.actor, ctx.auth);
    const code = str(row.poCode);
    const client = (
      await db
        .select()
        .from(schema.clients)
        .where(sql`lower(${schema.clients.code}) = lower(${str(row.clientCode)})`)
        .limit(1)
    )[0];
    if (!client) throw new AppError('VALIDATION', `Client "${str(row.clientCode)}" not found`);
    const warehouse = (
      await db
        .select()
        .from(schema.warehouses)
        .where(sql`lower(${schema.warehouses.code}) = lower(${str(row.warehouseCode)})`)
        .limit(1)
    )[0];
    if (!warehouse) throw new AppError('VALIDATION', `Warehouse "${str(row.warehouseCode)}" not found`);
    const product = (
      await db
        .select()
        .from(schema.products)
        .where(
          and(
            eq(schema.products.clientId, client.id),
            sql`lower(${schema.products.sku}) = lower(${str(row.sku)})`,
          ),
        )
        .limit(1)
    )[0];
    if (!product)
      throw new AppError('VALIDATION', `SKU "${str(row.sku)}" not found for client ${client.code}`);
    const quantity = Number(row.quantity);
    const unitCost =
      row.unitCost === null || row.unitCost === undefined || str(row.unitCost) === ''
        ? product.purchasePrice
        : Number(row.unitCost);
    const packType = str(row.packType) || product.uom;
    const line = {
      productId: product.id,
      packType,
      orderedQuantity: quantity,
      unitCost,
      receivingLocationId: null,
      lotNumber: str(row.lotNumber) || null,
      expiryDate: dayOf(row.expiryDate),
      productionDate: null,
      lpTypeId: null,
      lpNumber: null,
      note: str(row.notes) || null,
    };
    const existing = (
      await db
        .select()
        .from(schema.purchaseOrders)
        .where(sql`lower(${schema.purchaseOrders.code}) = lower(${code})`)
        .limit(1)
    )[0];
    if (!existing) {
      const vendor = await ensureVendor(
        db,
        dctx,
        ctx.auth.scope,
        client.id,
        str(row.vendorName),
        str(row.vendorCode) || null,
      );
      const created = await createPurchaseOrder(db, dctx, ctx.auth.scope, {
        warehouseId: warehouse.id,
        clientId: client.id,
        code,
        poType: resolvePoType(str(row.poType)),
        poDate: new Date().toISOString(),
        plannedReceivingDate: dateIso(row.expectedDate),
        receivedAt: null,
        plannedArrivalDate: null,
        actualArrivalDate: null,
        referenceNumber: str(row.referenceNumber) || null,
        note: null,
        vendorId: vendor.id,
        lines: [line],
        customFields: {},
      });
      return {
        entityId: created.id,
        message: `Created ${code}${vendor.created ? ` and vendor ${str(row.vendorName)}` : ''}`,
      };
    }
    if (existing.clientId !== client.id || existing.warehouseId !== warehouse.id)
      throw new AppError('VALIDATION', `${code} belongs to another client or warehouse`);
    if (existing.status !== 'Pending')
      throw new AppError(
        'INVALID_STATE',
        `${code} is ${existing.status}; lines can only be added to Pending orders`,
      );
    const ratio =
      packType === product.uom
        ? 1
        : (
            await db
              .select({ q: schema.productPackTypes.uomQty })
              .from(schema.productPackTypes)
              .where(
                and(
                  eq(schema.productPackTypes.productId, product.id),
                  eq(schema.productPackTypes.packType, packType),
                ),
              )
              .limit(1)
          )[0]?.q;
    if (!ratio) throw new AppError('VALIDATION', `${product.sku} has no "${packType}" pack type`);
    const inserted = (
      await db
        .insert(schema.purchaseOrderLines)
        .values({
          ...line,
          uomQuantity: ratio,
          purchaseOrderId: existing.id,
          createdBy: ctx.actor.userId,
          updatedBy: ctx.actor.userId,
        })
        .returning()
    )[0];
    const lines = await db
      .select({ q: schema.purchaseOrderLines.orderedQuantity, c: schema.purchaseOrderLines.unitCost })
      .from(schema.purchaseOrderLines)
      .where(eq(schema.purchaseOrderLines.purchaseOrderId, existing.id));
    await db
      .update(schema.purchaseOrders)
      .set({
        totalQuantity: lines.reduce((s, l) => s + l.q, 0),
        purchasePrice: Math.round(lines.reduce((s, l) => s + l.q * l.c, 0) * 100) / 100,
        version: existing.version + 1,
        updatedBy: ctx.actor.userId,
      })
      .where(eq(schema.purchaseOrders.id, existing.id));
    await changeLog.recordLineCreate(db, dctx, {
      entityType: 'purchase_order',
      entityId: existing.id,
      entityCode: existing.code,
      lineEntityType: 'purchase_order_line',
      lineEntityId: inserted.id,
      lineLabel: product.sku,
    });
    return { entityId: existing.id, message: `Added ${product.sku} to ${code}` };
  },
};
