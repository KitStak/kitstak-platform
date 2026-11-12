/**
 * Printout records for shipment orders (Bulk Print ▾, detail Printouts card). Builds
 * the per-template record shapes the foundation renderers validate (`server/print`),
 * and reports which orders are ineligible (Logiwa guard copy) instead of failing.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDb } from '@/server/api/db';
import type { Scope } from '@/server/auth/scope';
import { scopedWhere } from '@/server/auth/scope';
import { schema } from '@/server/db';
import { mapSeq } from '@/server/db/sql';

const so = schema.shipmentOrders;

export const ORDER_PRINT_TYPES = [
  'packing-slip',
  'picking-list',
  'consolidated-picking-list',
  'manifest-bol',
  'pick-short-label',
  'shipping-label',
] as const;
export type OrderPrintType = (typeof ORDER_PRINT_TYPES)[number];

export const printRecordsSchema = z.object({
  type: z.enum(ORDER_PRINT_TYPES),
  ids: z.array(z.string().min(1).max(64)).min(1).max(1000),
});

export const PICK_LIST_GUARD =
  'The picking list cannot be printed for the orders that have no active picking task.';
export const PICK_PACK_SHORT_GUARD =
  'Issue label cannot be printed for the selected order(s). To print an issue label, the order must have an active Pick or Pack Short issue and be in Open or Resolved status.';
export const REPRINT_GUARD = 'The selected orders have no label to reprint.';

export interface PrintRecordsResult {
  readonly typeKey: string;
  readonly records: readonly unknown[];
  readonly ineligible: readonly { readonly id: string; readonly code: string; readonly reason: string }[];
  /** Existing label files (shipping-label reprint opens these directly). */
  readonly fileIds?: readonly string[];
}

type OrderRow = typeof so.$inferSelect;

function shipTo(o: OrderRow) {
  return {
    name: o.customerName || [o.customerFirstName, o.customerLastName].filter(Boolean).join(' ') || 'Customer',
    company: o.companyName ?? undefined,
    address1: o.shipAddress,
    address2: o.shipAddress2 ?? undefined,
    city: o.shipCity,
    state: o.shipState || undefined,
    postalCode: o.shipZip || undefined,
    country: o.shipCountry || undefined,
    phone: o.customerPhone ?? undefined,
  };
}

async function warehouseFrom(db: AppDb, warehouseId: string) {
  const w = (
    await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, warehouseId)).limit(1)
  )[0];
  if (!w) return undefined;
  return {
    name: w.name,
    address1: w.addressLine,
    address2: w.addressLine2 ?? undefined,
    city: w.city,
    state: w.state,
    postalCode: w.postalCode ?? undefined,
    country: w.country,
    phone: w.contactPhone ?? undefined,
  };
}

async function linesOf(db: AppDb, orderId: string) {
  return await db
    .select({
      line: schema.orderLines,
      sku: schema.products.sku,
      name: schema.products.name,
      uom: schema.products.uom,
    })
    .from(schema.orderLines)
    .innerJoin(schema.products, eq(schema.products.id, schema.orderLines.productId))
    .where(eq(schema.orderLines.orderId, orderId));
}

/** Active pick tasks; with `reprint`, falls back to the completed tasks so a finished job's pick list can be reprinted. */
async function pickLines(
  db: AppDb,
  order: OrderRow,
  reprint = false,
): Promise<Awaited<ReturnType<typeof pickLinesFor>>> {
  const active = await pickLinesFor(db, order, ['Pending', 'Started']);
  return active.length > 0 || !reprint ? active : await pickLinesFor(db, order, ['Completed']);
}

async function pickLinesFor(db: AppDb, order: OrderRow, statuses: ('Pending' | 'Started' | 'Completed')[]) {
  const t = schema.tasks;
  return (
    await db
      .select({
        qty: t.plannedQty,
        lot: t.lotNumber,
        expiry: t.expiryDate,
        sku: schema.products.sku,
        name: schema.products.name,
        location: schema.locations.code,
        lp: schema.licensePlates.number,
      })
      .from(t)
      .innerJoin(schema.products, eq(schema.products.id, t.productId))
      .leftJoin(schema.locations, eq(schema.locations.id, t.sourceLocationId))
      .leftJoin(schema.licensePlates, eq(schema.licensePlates.id, t.sourceLpId))
      .where(and(eq(t.orderId, order.id), eq(t.taskType, 'Picking'), inArray(t.status, statuses)))
  )
    .filter((r) => r.qty > 0)
    .map((r) => ({
      locationCode: r.location ?? 'Unassigned',
      sku: r.sku,
      name: r.name,
      quantity: r.qty,
      lpNumber: r.lp ?? undefined,
      lotNumber: r.lot ?? undefined,
      expiryDate: r.expiry ?? undefined,
      orderCode: order.code,
    }));
}

/** Builds renderer records for `type` over the selected orders. */
export async function buildPrintRecords(
  db: AppDb,
  scope: Scope,
  input: z.output<typeof printRecordsSchema>,
): Promise<PrintRecordsResult> {
  const rows = await db
    .select()
    .from(so)
    .where(and(inArray(so.id, input.ids), isNull(so.deletedAt), scopedWhere(so, scope)));
  const ineligible: { id: string; code: string; reason: string }[] = [];
  const clientName = async (id: string) =>
    (
      await db
        .select({ n: schema.clients.name })
        .from(schema.clients)
        .where(eq(schema.clients.id, id))
        .limit(1)
    )[0]?.n;

  switch (input.type) {
    case 'packing-slip': {
      const records = await mapSeq(rows, async (o) => ({
        orderCode: o.code,
        storeOrderNumber: o.storeOrderNumber ?? undefined,
        orderDate: o.orderDate,
        clientName: await clientName(o.clientId),
        shipFrom: await warehouseFrom(db, o.warehouseId),
        shipTo: shipTo(o),
        carrier: o.carrier ?? undefined,
        shippingService: o.shippingService ?? undefined,
        trackingNumber: o.trackingNumber ?? undefined,
        giftMessage: o.isGift ? (o.giftNote ?? undefined) : undefined,
        notes: o.packingInstructions ?? undefined,
        lines: (await linesOf(db, o.id)).map((l) => ({
          sku: l.sku,
          name: l.name,
          quantity: l.line.quantity,
          uom: l.line.packType || l.uom,
          lotNumber: l.line.lotNumber ?? undefined,
        })),
      }));
      return { typeKey: 'packing-slip', records, ineligible };
    }
    case 'picking-list':
    case 'consolidated-picking-list': {
      const records: unknown[] = [];
      const consolidated: Awaited<ReturnType<typeof pickLines>> = [];
      for (const o of rows) {
        const lines = await pickLines(db, o, input.type === 'picking-list');
        if (lines.length === 0) {
          ineligible.push({ id: o.id, code: o.code, reason: PICK_LIST_GUARD });
          continue;
        }
        if (input.type === 'picking-list') {
          const wh = (
            await db
              .select({ name: schema.warehouses.name })
              .from(schema.warehouses)
              .where(eq(schema.warehouses.id, o.warehouseId))
              .limit(1)
          )[0];
          records.push({
            code: o.code,
            warehouseName: wh?.name,
            createdAt: o.createdAt,
            orderCount: 1,
            lines,
          });
        } else consolidated.push(...lines);
      }
      if (input.type === 'consolidated-picking-list' && consolidated.length > 0) {
        records.push({
          code: `BATCH-${rows.length}`,
          orderCount: rows.length - ineligible.length,
          createdAt: new Date().toISOString(),
          lines: consolidated,
        });
      }
      return { typeKey: input.type, records, ineligible };
    }
    case 'manifest-bol': {
      const byWarehouse = new Map<string, OrderRow[]>();
      for (const o of rows) byWarehouse.set(o.warehouseId, [...(byWarehouse.get(o.warehouseId) ?? []), o]);
      const records = await mapSeq([...byWarehouse.entries()], async ([warehouseId, orders]) => ({
        bolNumber:
          orders.length === 1 ? orders[0]?.bol || orders[0]?.code : `BOL-${orders[0]?.code}-${orders.length}`,
        shipDate: new Date().toISOString(),
        carrier: orders.find((o) => o.carrier)?.carrier ?? 'Customer pickup',
        proNumber: orders.find((o) => o.pro)?.pro ?? undefined,
        shipFrom: (await warehouseFrom(db, warehouseId)) ?? { name: 'Warehouse', address1: '', city: '' },
        shipTo: orders.length === 1 && orders[0] ? shipTo(orders[0]) : undefined,
        shipments: orders.map((o) => ({
          orderCode: o.code,
          customerName: o.customerName,
          trackingNumber: o.trackingNumber ?? undefined,
          packages: 1,
          weightLb: Math.round((o.totalWeightOz / 16) * 100) / 100,
        })),
      }));
      return { typeKey: 'manifest-bol', records, ineligible };
    }
    case 'pick-short-label': {
      for (const o of rows) {
        const hasIssue = o.pickShortStatus !== 'None' || o.packShortStatus !== 'None';
        const statusOk =
          ['Open', 'Resolved'].includes(o.pickShortStatus) ||
          ['Open', 'Resolved'].includes(o.packShortStatus);
        if (!hasIssue || !statusOk)
          ineligible.push({ id: o.id, code: o.code, reason: PICK_PACK_SHORT_GUARD });
      }
      // The issue-label printout is not configured yet (foundation catalog renderer = null).
      return { typeKey: 'pick-short-label', records: [], ineligible };
    }
    case 'shipping-label': {
      const fileIds: string[] = [];
      for (const o of rows) {
        const labels = (
          await db
            .select({ fileId: schema.shipments.labelFileId })
            .from(schema.shipments)
            .where(
              and(
                eq(schema.shipments.orderId, o.id),
                eq(schema.shipments.labelStatus, 'Active'),
                eq(schema.shipments.labelType, 'Shipping Label'),
              ),
            )
        ).flatMap((l) => (l.fileId ? [l.fileId] : []));
        if (labels.length === 0) ineligible.push({ id: o.id, code: o.code, reason: REPRINT_GUARD });
        fileIds.push(...labels);
      }
      return { typeKey: 'shipping-label', records: [], ineligible, fileIds };
    }
  }
}
