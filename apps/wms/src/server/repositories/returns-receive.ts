/**
 * Return Station commands (M04 §3–5): RMA lookup by RMA / order / tracking number,
 * product resolution by scan, receiving with dispositions (Restock / Damaged /
 * Quarantine / Dispose) through `ledger.recordReceipt` (type Return → ledger Return
 * Receiving), Manual RMA creation, status roll-up, client notifications and KPIs.
 */
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { trackingTokenSql } from './returns-grid';
import { z } from 'zod';
import { RETURN_DISPOSITIONS } from '@/lib/enums';
import type { AppDb } from '@/server/api/db';
import type { Scope } from '@/server/auth/scope';
import { assertInScope, hasClient, hasWarehouse } from '@/server/auth/scope';
import * as schema from '@/server/db/schema';
import { changeLog, ledger, notify, sequences, stateMachines } from '@/server/domain';
import { validationError } from '@/server/api/errors';
import { DomainError } from '@/server/domain/errors';
import type { DomainCtx } from '@/server/domain/types';
import { idSchema } from './platform-common';
import { loadReturn } from './returns';
import {
  checkReturnLine,
  RETURN_RULE_DEFS,
  type ReturnRuleKey,
  type ShippedLine,
} from '@/lib/grid-defs/admin/return-rules';
import { getReturnRules } from './company-return-rules';
import { moveBackBlockReason } from './packing-hospitals';
import { locationLock } from './packing-locks';
import { dateOnly, shippedAttributes } from './returns-shipped';
import { dbAll, dbGet, forEachSeq, mapSeq } from '@/server/db/sql';

export interface RuleItem {
  readonly productId: string;
  readonly quantity: number;
  readonly lotNumber?: string | null;
  readonly expiryDate?: string | null;
  readonly productionDate?: string | null;
  readonly packType?: string | null;
  readonly serials?: readonly string[];
}

const RULE_FIELD: Partial<Record<ReturnRuleKey, string>> = {
  preventExceedingShippedQty: 'quantity',
  lotNumberMatch: 'lotNumber',
  expiryDateMatch: 'expiryDate',
  productionDateMatch: 'productionDate',
  serialNumberMatch: 'serials',
  packTypeMatch: 'packType',
};
const ruleLabel = (key: ReturnRuleKey) => RETURN_RULE_DEFS.find((d) => d.key === key)?.label ?? key;

/**
 * Return Process parameters (Data Setup › Return Process) at the station. Each item is checked
 * against what actually shipped on the order (ledger), all eight switches:
 *  - SKU shipped, quantity (incl. earlier returns), receiving warehouse;
 *  - lot / expiry / production date: required for a tracked SKU when its match rule is on and the
 *    order shipped that attribute, and must be one that shipped;
 *  - serials: every scanned serial must have shipped on the order;
 *  - pack type: the pack type received must be one that shipped.
 * Returns per-item field errors keyed `items.<i>.<field>` (empty = accepted).
 */
export async function returnRuleErrors(
  tx: AppDb,
  order: { readonly id: string; readonly warehouseId: string } | null | undefined,
  receivingWarehouseId: string,
  items: readonly RuleItem[],
  opts: { readonly packTypeOf?: (index: number) => string | null | Promise<string | null> } = {},
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (!order) return out;
  const rules = await getReturnRules(tx);
  const lines = await tx.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, order.id));
  const attrs = await shippedAttributes(tx, order.id);
  const productIds = [...new Set(items.map((i) => i.productId))];
  const tracking = new Map(
    productIds.length
      ? (
          await tx
            .select({
              id: schema.products.id,
              sku: schema.products.sku,
              trackLot: schema.products.trackLot,
              trackExpiry: schema.products.trackExpiry,
              trackProductionDate: schema.products.trackProductionDate,
              trackSerial: schema.products.trackSerial,
            })
            .from(schema.products)
            .where(inArray(schema.products.id, productIds))
        ).map((p) => [p.id, p])
      : [],
  );
  const shipped: ShippedLine[] = [];
  for (const l of lines) {
    const a = attrs.get(l.productId);
    shipped.push({
      productId: l.productId,
      qty: l.shippedQuantity || l.quantity,
      lot: a ? null : l.lotNumber,
      expiryDate: a ? null : dateOnly(l.expiryDate),
      packTypeId: a?.packTypes.length ? null : l.packType,
    });
  }
  // Zero-quantity rows carry each shipped attribute value, so the pure check can match any of them.
  for (const [productId, a] of attrs) {
    const n = Math.max(a.lots.length, a.expiryDates.length, a.productionDates.length, a.packTypes.length, 1);
    for (let k = 0; k < n; k += 1)
      shipped.push({
        productId,
        qty: 0,
        lot: a.lots[k] ?? null,
        expiryDate: a.expiryDates[k] ?? null,
        productionDate: a.productionDates[k] ?? null,
        packTypeId: a.packTypes[k] ?? null,
        serials: k === 0 ? a.serials : [],
      });
  }
  const returned = new Map(
    (
      await dbAll<{ productId: string; n: number }>(
        tx,
        sql`SELECT rol.product_id AS "productId", coalesce(sum(rol.returned_qty), 0)::int AS n FROM return_order_lines rol
    JOIN return_orders ro ON ro.id = rol.return_order_id WHERE ro.shipment_order_id = ${order.id} AND ro.status <> 'Cancelled' GROUP BY rol.product_id`,
      )
    ).map((r) => [r.productId, r.n]),
  );
  const running = new Map<string, number>();
  const push = (key: string, msg: string) => {
    (out[key] ??= []).push(msg);
  };
  for (const [i, item] of items.entries()) {
    const forSku = shipped.filter((s) => s.productId === item.productId);
    const p = tracking.get(item.productId);
    const already = (returned.get(item.productId) ?? 0) + (running.get(item.productId) ?? 0);
    running.set(item.productId, (running.get(item.productId) ?? 0) + item.quantity);
    const packType = item.packType ?? (await opts.packTypeOf?.(i)) ?? null;
    // Required attributes: a tracked SKU whose match rule is on must say which lot / date came back.
    if (forSku.length > 0) {
      const need = (
        rule: ReturnRuleKey,
        tracked: boolean | undefined,
        value: string | null | undefined,
        has: boolean,
        field: string,
        label: string,
      ) => {
        if (rules[rule] && tracked && has && !(value ?? '').trim())
          push(
            `items.${i}.${field}`,
            `Enter the ${label} of ${p?.sku ?? 'this SKU'} (Return Process: ${ruleLabel(rule)})`,
          );
      };
      need(
        'lotNumberMatch',
        p?.trackLot,
        item.lotNumber,
        forSku.some((s) => s.lot),
        'lotNumber',
        'lot number',
      );
      need(
        'expiryDateMatch',
        p?.trackExpiry,
        item.expiryDate,
        forSku.some((s) => s.expiryDate),
        'expiryDate',
        'expiry date',
      );
      need(
        'productionDateMatch',
        p?.trackProductionDate,
        item.productionDate,
        forSku.some((s) => s.productionDate),
        'productionDate',
        'production date',
      );
    }
    const v = checkReturnLine(
      rules,
      shipped,
      {
        productId: item.productId,
        qty: item.quantity,
        alreadyReturned: already,
        lot: p?.trackLot || forSku.some((s) => s.lot) ? item.lotNumber?.trim() || null : null,
        expiryDate: p?.trackExpiry || forSku.some((s) => s.expiryDate) ? dateOnly(item.expiryDate) : null,
        productionDate:
          p?.trackProductionDate || forSku.some((s) => s.productionDate)
            ? dateOnly(item.productionDate)
            : null,
        packTypeId: forSku.some((s) => s.packTypeId) ? packType : null,
        serials: item.serials?.filter((x) => x.trim()),
      },
      { warehouseMismatch: order.warehouseId !== receivingWarehouseId },
    );
    for (const x of v)
      push(
        `items.${i}.${RULE_FIELD[x.rule] ?? 'productId'}`,
        `${x.message} (Return Process: ${ruleLabel(x.rule)})`,
      );
  }
  return out;
}

type Ctx = DomainCtx & { readonly scope: Scope };

const RECEIVABLE = ['Pending', 'In Transit', 'Started'] as const;

/* ---------------------------------------------------------------- lookup */

export interface RmaCandidate {
  readonly id: string;
  readonly rmaCode: string;
  readonly status: string;
  readonly orderCode: string | null;
  readonly customerName: string | null;
  readonly trackingNumber: string | null;
  readonly clientName: string;
  readonly requestedQty: number;
  readonly returnedQty: number;
  readonly receivable: boolean;
  readonly reason: string | null;
}

/** Finds RMAs by RMA code, shipment order code / store order #, or (return) tracking number. */
export async function lookupRmas(
  db: AppDb,
  scope: Scope,
  warehouseId: string,
  code: string,
): Promise<RmaCandidate[]> {
  const c = code.trim();
  if (!c) throw new DomainError('VALIDATION', 'Scan or enter an RMA, order code or tracking number');
  if (!hasWarehouse(scope, warehouseId)) throw new DomainError('NOT_FOUND', 'Warehouse not found');
  const lc = c.toLowerCase();
  // Index-friendly first (rma_code, orders.code / store_order_number, shipments.tracking_number);
  // the case-insensitive scan below runs only when nothing matched exactly.
  const v = sql.join(
    [...new Set([c, c.toUpperCase(), lc])].map((x) => sql`${x}`),
    sql`, `,
  );
  const fastIds = (
    await dbAll<{ id: string }>(
      db,
      sql`SELECT id FROM return_orders WHERE rma_code IN (${v})
    UNION SELECT id FROM return_orders WHERE tracking_number IN (${v})
    UNION SELECT ro.id FROM return_orders ro WHERE ro.shipment_order_id IN (
      SELECT id FROM shipment_orders WHERE code IN (${v}) UNION SELECT id FROM shipment_orders WHERE store_order_number IN (${v})
      UNION SELECT order_id FROM shipments WHERE tracking_number IN (${v}) AND order_id IS NOT NULL)`,
    )
  ).map((r) => r.id);
  const match =
    fastIds.length > 0
      ? sql`ro.id IN (${sql.join(
          fastIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql`(lower(ro.rma_code) = ${lc} OR lower(so.code) = ${lc} OR lower(so.store_order_number) = ${lc} OR lower(ro.tracking_number) = ${lc} OR ${trackingTokenSql([lc])} OR lower(so.tracking_number) = ${lc})`;
  const rows = await dbAll<{
    id: string;
    rmaCode: string;
    status: string;
    orderCode: string | null;
    customerName: string | null;
    trackingNumber: string | null;
    clientId: string;
    clientName: string;
    warehouseId: string;
    requestedQty: number;
    returnedQty: number;
  }>(
    db,
    sql`
    SELECT ro.id, ro.rma_code AS "rmaCode", ro.status, so.code AS "orderCode", COALESCE(ro.customer_name, so.customer_name) AS "customerName",
      ro.tracking_number AS "trackingNumber", ro.client_id AS "clientId", c.name AS "clientName", ro.warehouse_id AS "warehouseId",
      (SELECT COALESCE(SUM(requested_qty),0) FROM return_order_lines WHERE return_order_id = ro.id) AS "requestedQty",
      (SELECT COALESCE(SUM(returned_qty),0) FROM return_order_lines WHERE return_order_id = ro.id) AS "returnedQty"
    FROM return_orders ro JOIN clients c ON c.id = ro.client_id LEFT JOIN shipment_orders so ON so.id = ro.shipment_order_id
    WHERE ro.warehouse_id = ${warehouseId} AND ${match}
    ORDER BY ro.created_at DESC LIMIT 50`,
  );
  return rows
    .filter((r) => hasClient(scope, r.clientId))
    .map((r) => {
      const receivable = (RECEIVABLE as readonly string[]).includes(r.status);
      return {
        id: r.id,
        rmaCode: r.rmaCode,
        status: r.status,
        orderCode: r.orderCode,
        customerName: r.customerName,
        trackingNumber: r.trackingNumber,
        clientName: r.clientName,
        requestedQty: r.requestedQty,
        returnedQty: r.returnedQty,
        receivable,
        reason: receivable ? null : `RMA ${r.rmaCode} is ${r.status.toLowerCase()} and can't be received.`,
      };
    });
}

/** Outstanding RMAs of a warehouse for the Return Station ("Expected returns"): open, oldest expected first. */
export interface OpenRmaRow {
  readonly id: string;
  readonly rmaCode: string;
  readonly status: string;
  readonly orderCode: string | null;
  readonly customerName: string | null;
  readonly clientName: string;
  readonly expectedReturnDate: string | null;
  readonly requestedQty: number;
  readonly returnedQty: number;
}

export async function openRmas(
  db: AppDb,
  scope: Scope,
  warehouseId: string,
  limit = 8,
): Promise<{ readonly rows: readonly OpenRmaRow[]; readonly total: number }> {
  if (!hasWarehouse(scope, warehouseId)) throw new DomainError('NOT_FOUND', 'Warehouse not found');
  const clients =
    scope.clientIds === 'all'
      ? sql`1 = 1`
      : scope.clientIds.length
        ? sql`ro.client_id IN (${sql.join(
            scope.clientIds.map((c) => sql`${c}`),
            sql`, `,
          )})`
        : sql`0 = 1`;
  const where = sql`ro.warehouse_id = ${warehouseId} AND ro.status IN ('Pending', 'In Transit', 'Started') AND ${clients}`;
  const total =
    (await dbGet<{ n: number }>(db, sql`SELECT COUNT(*) AS n FROM return_orders ro WHERE ${where}`))?.n ?? 0;
  const rows = await dbAll<OpenRmaRow>(
    db,
    sql`SELECT ro.id, ro.rma_code AS "rmaCode", ro.status, so.code AS "orderCode", COALESCE(ro.customer_name, so.customer_name) AS "customerName",
      c.name AS "clientName", ro.expected_return_date AS "expectedReturnDate",
      (SELECT COALESCE(SUM(requested_qty),0) FROM return_order_lines WHERE return_order_id = ro.id) AS "requestedQty",
      (SELECT COALESCE(SUM(returned_qty),0) FROM return_order_lines WHERE return_order_id = ro.id) AS "returnedQty"
    FROM return_orders ro JOIN clients c ON c.id = ro.client_id LEFT JOIN shipment_orders so ON so.id = ro.shipment_order_id
    WHERE ${where}
    ORDER BY CASE ro.status WHEN 'Started' THEN 0 WHEN 'In Transit' THEN 1 ELSE 2 END, ro.expected_return_date IS NULL, ro.expected_return_date, ro.created_at
    LIMIT ${Math.min(50, Math.max(1, limit))}`,
  );
  return { rows, total };
}

/** Warehouses in scope where the code matches an RMA (for "Switch to <warehouse>" at the station). */
export async function rmaWarehousesFor(
  db: AppDb,
  scope: Scope,
  code: string,
): Promise<
  { readonly warehouseId: string; readonly warehouseCode: string; readonly rmaCodes: readonly string[] }[]
> {
  const out: { warehouseId: string; warehouseCode: string; rmaCodes: string[] }[] = [];
  for (const wid of scope.warehouseIds) {
    const hits = await lookupRmas(db, scope, wid, code);
    if (hits.length === 0) continue;
    const wh = (
      await db
        .select({ code: schema.warehouses.code })
        .from(schema.warehouses)
        .where(eq(schema.warehouses.id, wid))
        .limit(1)
    )[0];
    out.push({ warehouseId: wid, warehouseCode: wh?.code ?? '', rmaCodes: hits.map((h) => h.rmaCode) });
  }
  return out;
}

export interface ResolvedProduct {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly uom: string;
  readonly clientId: string;
  readonly trackSerial: boolean;
  readonly trackLot: boolean;
  readonly trackExpiry: boolean;
  readonly trackProductionDate: boolean;
}

/** Exact SKU / barcode / pack-type barcode match within a client. */
export async function resolveProduct(
  db: AppDb,
  scope: Scope,
  clientId: string,
  code: string,
): Promise<ResolvedProduct | null> {
  if (!hasClient(scope, clientId)) throw new DomainError('NOT_FOUND', 'Client not found');
  const lc = code.trim().toLowerCase();
  if (!lc) return null;
  const p = schema.products;
  const viaBarcode = (
    await db
      .select({ id: schema.productBarcodes.productId })
      .from(schema.productBarcodes)
      .where(sql`lower(${schema.productBarcodes.barcode}) = ${lc}`)
  ).map((r) => r.id);
  const row = (
    await db
      .select()
      .from(p)
      .where(
        and(
          eq(p.clientId, clientId),
          or(
            sql`lower(${p.sku}) = ${lc}`,
            sql`lower(${p.barcode}) = ${lc}`,
            viaBarcode.length ? inArray(p.id, viaBarcode) : undefined,
          ),
        ),
      )
      .limit(1)
  )[0];
  if (!row) return null;
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    imageUrl: row.imageUrl,
    uom: row.uom,
    clientId: row.clientId,
    trackSerial: row.trackSerial,
    trackLot: row.trackLot,
    trackExpiry: row.trackExpiry,
    trackProductionDate: row.trackProductionDate,
  };
}

/* --------------------------------------------------------------- receive */

/** A required id with operator copy instead of zod's "Invalid input: expected string, received undefined". */
export function requiredId(message: string) {
  return z.string({ error: message }).trim().min(1, message).max(64, message);
}

const itemSchema = z.object({
  returnOrderLineId: idSchema.nullish(),
  productId: requiredId('Choose a product'),
  quantity: z
    .number({ error: 'Enter a quantity' })
    .int('Enter a whole number')
    .min(1, 'Quantity must be at least 1')
    .max(100000, 'Max 100,000 per line'),
  disposition: z.enum(RETURN_DISPOSITIONS, {
    error: 'Choose a disposition (Restock, Damaged, Quarantine or Dispose)',
  }),
  damageReasonId: idSchema.nullish(),
  actualReturnReasonId: idSchema.nullish(),
  lotNumber: z.string().trim().max(120).nullish(),
  expiryDate: z.string().trim().max(40).nullish(),
  productionDate: z.string().trim().max(40).nullish(),
  /** Pack type received; defaults to the RMA line's (Return Process › Pack type match). */
  packType: z.string().trim().max(60).nullish(),
  serials: z.array(z.string().trim().min(1).max(120)).max(1000).optional(),
  note: z.string().trim().max(500).nullish(),
});

const targetSchema = z.object({
  stationLocationId: requiredId('Choose a return station'),
  targetLocationId: idSchema.nullish(),
  targetLpId: idSchema.nullish(),
});

export const receiveRmaSchema = targetSchema.extend({
  returnOrderId: requiredId('Scan or choose an RMA'),
  items: z.array(itemSchema, { error: 'Scan at least one item' }).min(1, 'Scan at least one item'),
  complete: z.boolean().default(true),
  /**
   * Completing while units are still outstanding closes those lines as short. The station must
   * confirm it (`shortClose: true`, after its "N units not received will be closed as short"
   * dialog); otherwise the server refuses with SHORT_CLOSE_REQUIRED and the shortfall.
   */
  shortClose: z.boolean().default(false),
  shortCloseReason: z.string().trim().max(300).nullish(),
});

export const receiveManualSchema = targetSchema.extend({
  warehouseId: requiredId('Choose a receiving warehouse'),
  clientId: requiredId('Choose a client'),
  shipmentOrderId: idSchema.nullish(),
  customerName: z.string().trim().max(200).nullish(),
  note: z.string().trim().max(1000).nullish(),
  items: z
    .array(itemSchema.omit({ returnOrderLineId: true }), { error: 'Add at least one product' })
    .min(1, 'Add at least one product'),
});

export type ReceiveItem = z.output<typeof itemSchema>;

export interface ReceiveResult {
  readonly returnOrderId: string;
  readonly rmaCode: string;
  readonly status: string;
  readonly receivedQty: number;
  readonly receiptIds: readonly string[];
  readonly notified: number;
  /** Station tiles after this receive (same transaction), so the UI updates without waiting on a refetch. */
  readonly kpis: ReturnStationKpis;
}

interface Placement {
  readonly warehouseId: string;
  readonly stationLocationId: string;
  readonly targetLocationId: string;
  readonly targetLpId: string | null;
  /** Area of the location the restocked / damaged units land in (the LP's location for an LP target). */
  readonly targetAreaType: string | null;
  readonly targetCode: string;
}

async function resolvePlacement(
  tx: AppDb,
  warehouseId: string,
  input: z.output<typeof targetSchema>,
): Promise<Placement> {
  const station = (
    await tx.select().from(schema.locations).where(eq(schema.locations.id, input.stationLocationId)).limit(1)
  )[0];
  if (!station || station.warehouseId !== warehouseId)
    throw validationError('Choose a return station in the receiving warehouse', {
      stationLocationId: ['Station is in another warehouse'],
    });
  const base = { warehouseId, stationLocationId: station.id };
  if (input.targetLpId) {
    const lp = (
      await tx
        .select()
        .from(schema.licensePlates)
        .where(eq(schema.licensePlates.id, input.targetLpId))
        .limit(1)
    )[0];
    if (!lp || lp.warehouseId !== warehouseId)
      throw validationError('Target LP not found in this warehouse', { targetLpId: ['LP not found'] });
    const at = lp.locationId
      ? (
          await tx
            .select({ areaType: schema.locations.areaType })
            .from(schema.locations)
            .where(eq(schema.locations.id, lp.locationId))
            .limit(1)
        )[0]
      : undefined;
    return {
      ...base,
      targetLocationId: lp.locationId ?? station.id,
      targetLpId: lp.id,
      targetAreaType: lp.locationId ? (at?.areaType ?? null) : station.areaType,
      targetCode: lp.number,
    };
  }
  if (input.targetLocationId) {
    const loc = (
      await tx.select().from(schema.locations).where(eq(schema.locations.id, input.targetLocationId)).limit(1)
    )[0];
    if (!loc || loc.warehouseId !== warehouseId)
      throw validationError('Target location not found in this warehouse', {
        targetLocationId: ['Location not found'],
      });
    return {
      ...base,
      targetLocationId: loc.id,
      targetLpId: null,
      targetAreaType: loc.areaType,
      targetCode: loc.code,
    };
  }
  return {
    ...base,
    targetLocationId: station.id,
    targetLpId: null,
    targetAreaType: station.areaType,
    targetCode: station.code,
  };
}

/**
 * Count-plan locks on the station and the target (the LP's location for an LP target), as field errors,
 * so a receive is refused with the plan code before any ledger write (the ledger would refuse it anyway).
 */
export async function placementLockErrors(
  tx: AppDb,
  place: Placement,
  items: readonly { readonly disposition: string }[],
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  const needsTarget = items.some((i) => !atStation(i.disposition));
  const needsStation =
    items.some((i) => atStation(i.disposition)) ||
    (needsTarget && place.targetLocationId === place.stationLocationId);
  const station = needsStation ? await locationLock(tx, place.stationLocationId) : null;
  if (station)
    out.stationLocationId = [
      `Return station ${station.locationCode} is locked by count plan ${station.planCode}. Choose another station, or finish, update or cancel the count first.`,
    ];
  if (needsTarget && place.targetLocationId !== place.stationLocationId) {
    const target = await locationLock(tx, place.targetLocationId);
    if (target)
      out[place.targetLpId ? 'targetLpId' : 'targetLocationId'] = [
        `Return target ${place.targetLpId ? `${place.targetCode} (in ${target.locationCode})` : target.locationCode} is locked by count plan ${target.planCode}. Choose another target, or finish, update or cancel the count first.`,
      ];
  }
  return out;
}

/** Quarantine and Dispose are received at the station; Restock and Damaged land in the target. */
const atStation = (disposition: string): boolean => disposition === 'Quarantine' || disposition === 'Dispose';

/**
 * Damaged returns never land in a pick face (same rule as the hospital Move back): they go to the
 * station, a Returns / Storage location for review, or a damaged-only location. Pure.
 */
export function damagedTargetError(
  disposition: string,
  place: { readonly targetAreaType: string | null; readonly targetCode: string },
): string | null {
  if (disposition !== 'Damaged') return null;
  const reason = moveBackBlockReason({ damageReason: 'Damaged' }, { areaType: place.targetAreaType });
  return reason
    ? `Damaged units can't be received into Picking location ${place.targetCode}. Change the return target to a Returns or Storage location, or receive them as Quarantine.`
    : null;
}

function placementErrors(
  place: Placement,
  items: readonly { readonly disposition: string }[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  items.forEach((item, i) => {
    const e = damagedTargetError(item.disposition, place);
    if (e) out[`items.${i}.disposition`] = [e];
  });
  return out;
}

const lookupName = async (tx: AppDb, id: string | null | undefined): Promise<string | null> =>
  id
    ? ((
        await tx
          .select({ name: schema.lookupValues.name })
          .from(schema.lookupValues)
          .where(eq(schema.lookupValues.id, id))
          .limit(1)
      )[0]?.name ?? null)
    : null;

/**
 * Posts one item: receipt (ledger Return Receiving) then the disposition move/removal.
 * Data model: a receipt row is one received LINE (product + qty + location), keyed by a unique
 * receipt number (`receipts.master_id`, ledger-owned), exactly like PO receiving. A receive
 * session that covers 2 RMA lines therefore writes 2 receipt rows; they share the RMA, the
 * session time and the user, and the RMA detail groups them under its Receipts card.
 */
async function postItem(
  tx: AppDb,
  ctx: Ctx,
  ro: typeof schema.returnOrders.$inferSelect,
  place: Placement,
  item: ReceiveItem,
  lineId: string,
): Promise<string> {
  const product = (
    await tx.select().from(schema.products).where(eq(schema.products.id, item.productId)).limit(1)
  )[0];
  if (!product) throw new DomainError('NOT_FOUND', 'Product not found');
  const line = (
    await tx.select().from(schema.returnOrderLines).where(eq(schema.returnOrderLines.id, lineId)).limit(1)
  )[0];
  const damageReason =
    item.disposition === 'Damaged'
      ? ((await lookupName(tx, item.damageReasonId)) ?? 'Customer Return - Damaged')
      : null;
  const actualReason = await lookupName(tx, item.actualReturnReasonId);
  const toStation = item.disposition === 'Quarantine' || item.disposition === 'Dispose';
  const { receipt, txn } = await ledger.recordReceipt(tx, ctx, {
    type: 'Return',
    warehouseId: place.warehouseId,
    clientId: ro.clientId,
    productId: product.id,
    packType: item.packType || line?.packType || product.uom,
    quantity: item.quantity,
    locationId: toStation ? place.stationLocationId : place.targetLocationId,
    lpId: toStation ? null : place.targetLpId,
    lotNumber: item.lotNumber || null,
    expiryDate: item.expiryDate || null,
    productionDate: item.productionDate || null,
    damageReason,
    returnOrderId: ro.id,
    returnOrderLineId: lineId,
    shipmentOrderId: ro.shipmentOrderId,
    customerReturnReason: await lookupName(tx, line?.customerReturnReasonId),
    actualReturnReason: actualReason,
    note: [`${item.disposition} · ${ro.rmaCode}`, item.note].filter(Boolean).join(' · '),
    serials: item.serials?.map((primary) => ({ primary })),
  });
  if (item.disposition === 'Dispose' && txn.toInventoryId) {
    await ledger.remove(tx, ctx, {
      inventoryId: txn.toInventoryId,
      qty: txn.uomQty,
      type: 'Inventory Adjustment',
      refs: { returnOrderId: ro.id, receiptId: receipt.id, note: `Disposed on return ${ro.rmaCode}` },
    });
  }
  const before = line
    ? { disposition: line.disposition, actualReturnReasonId: line.actualReturnReasonId }
    : {};
  await tx
    .update(schema.returnOrderLines)
    .set({
      disposition: item.disposition,
      actualReturnReasonId: item.actualReturnReasonId ?? line?.actualReturnReasonId ?? null,
      updatedBy: ctx.userId,
    })
    .where(eq(schema.returnOrderLines.id, lineId));
  await changeLog.recordLine(tx, ctx, {
    entityType: 'return_order',
    entityId: ro.id,
    entityCode: ro.rmaCode,
    lineEntityType: 'return_order_line',
    lineEntityId: lineId,
    lineLabel: product.sku,
    field: 'returnedQty',
    from: line?.returnedQty ?? 0,
    to: (line?.returnedQty ?? 0) + item.quantity,
  });
  // Line-level, named by SKU ("MLT-WIDGET -> Disposition is modified. --> Damaged"), like Logiwa.
  await changeLog.recordLine(tx, ctx, {
    entityType: 'return_order',
    entityId: ro.id,
    entityCode: ro.rmaCode,
    lineEntityType: 'return_order_line',
    lineEntityId: lineId,
    lineLabel: product.sku,
    field: 'disposition',
    from: before.disposition ?? null,
    to: item.disposition,
  });
  const newReason = item.actualReturnReasonId ?? line?.actualReturnReasonId ?? null;
  if (newReason !== (before.actualReturnReasonId ?? null)) {
    await changeLog.recordLine(tx, ctx, {
      entityType: 'return_order',
      entityId: ro.id,
      entityCode: ro.rmaCode,
      lineEntityType: 'return_order_line',
      lineEntityId: lineId,
      lineLabel: product.sku,
      field: 'actualReturnReason',
      from: await lookupName(tx, before.actualReturnReasonId ?? null),
      to: actualReason,
    });
  }
  return receipt.id;
}

/** Units still outstanding per line (requested − returned), for the short-close confirmation. PURE. */
export function shortfallOf(
  lines: readonly {
    readonly id: string;
    readonly requestedQty: number;
    readonly returnedQty: number;
    readonly sku?: string;
  }[],
  receiving: ReadonlyMap<string, number> = new Map(),
): {
  readonly total: number;
  readonly lines: readonly { readonly id: string; readonly sku?: string; readonly short: number }[];
} {
  const out = lines
    .map((l) => ({
      id: l.id,
      sku: l.sku,
      short: Math.max(0, l.requestedQty - l.returnedQty - (receiving.get(l.id) ?? 0)),
    }))
    .filter((l) => l.short > 0);
  return { total: out.reduce((s, l) => s + l.short, 0), lines: out };
}

export const SHORT_CLOSE_FIELD = 'shortClose';

/** Line and RMA status roll-up after receiving. A short close is recorded per line ("Short Closed Qty 0 --> 2"). */
/**
 * `priorStatus` is the RMA status before this receive: the ledger moves Pending/In Transit to Started on
 * the first receipt without a change-log row, so the audit trail logs the real transition from it.
 */
async function rollup(
  tx: AppDb,
  ctx: Ctx,
  returnOrderId: string,
  complete: boolean,
  shortCloseReason?: string | null,
  priorStatus?: string,
): Promise<typeof schema.returnOrders.$inferSelect> {
  const lines = (
    await tx
      .select({ l: schema.returnOrderLines, sku: schema.products.sku })
      .from(schema.returnOrderLines)
      .innerJoin(schema.products, eq(schema.products.id, schema.returnOrderLines.productId))
      .where(eq(schema.returnOrderLines.returnOrderId, returnOrderId))
  ).map((r) => ({ ...r.l, sku: r.sku }));
  for (const l of lines) {
    const status =
      l.returnedQty >= l.requestedQty ? 'Completed' : l.returnedQty > 0 ? 'Started' : l.lineStatus;
    if (status !== l.lineStatus)
      await tx
        .update(schema.returnOrderLines)
        .set({ lineStatus: status })
        .where(eq(schema.returnOrderLines.id, l.id));
  }
  const ro = (
    await tx.select().from(schema.returnOrders).where(eq(schema.returnOrders.id, returnOrderId)).limit(1)
  )[0] as typeof schema.returnOrders.$inferSelect;
  const allDone = lines.every((l) => l.returnedQty >= l.requestedQty);
  if ((allDone || complete) && ro.status !== 'Completed' && lines.some((l) => l.returnedQty > 0)) {
    const status = stateMachines.returnOrder.transition(ro.status, 'Completed');
    const short = shortfallOf(lines);
    const note =
      short.total > 0
        ? [
            ro.note,
            `Short closed ${new Date().toISOString().slice(0, 10)}: ${short.total} unit${short.total === 1 ? '' : 's'} not received${shortCloseReason ? ` (${shortCloseReason})` : ''}.`,
          ]
            .filter(Boolean)
            .join('\n')
            .slice(0, 1000)
        : ro.note;
    const after = (
      await tx
        .update(schema.returnOrders)
        .set({
          status,
          note,
          actualReturnDate: ro.actualReturnDate ?? new Date().toISOString(),
          updatedBy: ctx.userId,
          version: sql`${schema.returnOrders.version} + 1`,
        })
        .where(eq(schema.returnOrders.id, ro.id))
        .returning()
    )[0];
    if (complete)
      await tx
        .update(schema.returnOrderLines)
        .set({ lineStatus: 'Completed' })
        .where(eq(schema.returnOrderLines.returnOrderId, ro.id));
    for (const s of short.lines) {
      await changeLog.recordLine(tx, ctx, {
        entityType: 'return_order',
        entityId: ro.id,
        entityCode: ro.rmaCode,
        lineEntityType: 'return_order_line',
        lineEntityId: s.id,
        lineLabel: s.sku ?? 'Line',
        field: 'shortClosedQty',
        from: 0,
        to: s.short,
      });
    }
    await changeLog.recordUpdate(tx, ctx, {
      entityType: 'return_order',
      entityId: ro.id,
      entityCode: ro.rmaCode,
      before: { status: priorStatus ?? ro.status, note: ro.note },
      after: { status, note },
    });
    return after;
  }
  if (priorStatus && priorStatus !== ro.status) {
    await changeLog.recordUpdate(tx, ctx, {
      entityType: 'return_order',
      entityId: ro.id,
      entityCode: ro.rmaCode,
      before: { status: priorStatus },
      after: { status: ro.status },
    });
  }
  return ro;
}

/* ---------------------------------------------------------------- reopen */

export const reopenReturnSchema = z.object({
  version: z.number().int().min(1).optional(),
  reason: z.string().trim().min(1, 'Say why the return is reopened').max(300),
});

/**
 * Reopens a short-closed RMA (Completed with units still outstanding) so the rest can be received
 * at the Return Station. Lines with units left go back to Started (or Pending when nothing was
 * received on them); the RMA goes to Started. Logged on the RMA and each reopened line.
 * Completed → Started is outside the generic return state machine on purpose: only a short close
 * can be reopened, never a fully received return.
 */
export async function reopenReturn(
  tx: AppDb,
  ctx: Ctx,
  id: string,
  input: z.output<typeof reopenReturnSchema>,
): Promise<{ readonly id: string; readonly status: string; readonly reopenedUnits: number }> {
  const ro = await loadReturn(tx, ctx.scope, id);
  if (input.version !== undefined && input.version !== ro.version)
    throw new DomainError('CONFLICT', 'This return was changed by someone else. Reload it and try again.');
  if (ro.status !== 'Completed')
    throw new DomainError(
      'INVALID_STATE',
      `Only a completed return can be reopened; ${ro.rmaCode} is ${ro.status.toLowerCase()}.`,
    );
  const lines = (
    await tx
      .select({ l: schema.returnOrderLines, sku: schema.products.sku })
      .from(schema.returnOrderLines)
      .innerJoin(schema.products, eq(schema.products.id, schema.returnOrderLines.productId))
      .where(eq(schema.returnOrderLines.returnOrderId, ro.id))
  ).map((r) => ({ ...r.l, sku: r.sku }));
  const short = shortfallOf(lines);
  if (short.total === 0)
    throw new DomainError(
      'INVALID_STATE',
      `Every unit of ${ro.rmaCode} was received, so there is nothing to reopen.`,
    );
  for (const s of short.lines) {
    const l = lines.find((x) => x.id === s.id);
    if (!l) continue;
    const lineStatus = l.returnedQty > 0 ? 'Started' : 'Pending';
    await tx
      .update(schema.returnOrderLines)
      .set({ lineStatus, updatedBy: ctx.userId })
      .where(eq(schema.returnOrderLines.id, l.id));
    await changeLog.recordLine(tx, ctx, {
      entityType: 'return_order',
      entityId: ro.id,
      entityCode: ro.rmaCode,
      lineEntityType: 'return_order_line',
      lineEntityId: l.id,
      lineLabel: l.sku,
      field: 'shortClosedQty',
      from: s.short,
      to: 0,
    });
  }
  const note = [ro.note, `Reopened ${new Date().toISOString().slice(0, 10)}: ${input.reason}`]
    .filter(Boolean)
    .join('\n')
    .slice(0, 1000);
  await tx
    .update(schema.returnOrders)
    .set({ status: 'Started', note, updatedBy: ctx.userId, version: sql`${schema.returnOrders.version} + 1` })
    .where(eq(schema.returnOrders.id, ro.id));
  await changeLog.recordUpdate(tx, ctx, {
    entityType: 'return_order',
    entityId: ro.id,
    entityCode: ro.rmaCode,
    before: { status: ro.status, note: ro.note },
    after: { status: 'Started', note },
  });
  return { id: ro.id, status: 'Started', reopenedUnits: short.total };
}

async function notifyClient(
  tx: AppDb,
  ro: typeof schema.returnOrders.$inferSelect,
  qty: number,
): Promise<number> {
  const userIds = (
    await tx
      .select({ id: schema.userClients.userId })
      .from(schema.userClients)
      .where(eq(schema.userClients.clientId, ro.clientId))
  ).map((r) => r.id);
  return await notify(tx, userIds, {
    kind: 'return.received',
    title: `Return ${ro.rmaCode} received`,
    body: `${qty} ${qty === 1 ? 'unit was' : 'units were'} received. Status: ${ro.status}.`,
    href: `/orders/returns/${ro.id}`,
    severity: 'success',
  });
}

export async function receiveRma(
  tx: AppDb,
  ctx: Ctx,
  input: z.output<typeof receiveRmaSchema>,
): Promise<ReceiveResult> {
  const ro = await loadReturn(tx, ctx.scope, input.returnOrderId);
  if (!(RECEIVABLE as readonly string[]).includes(ro.status))
    throw new DomainError(
      'INVALID_STATE',
      `RMA ${ro.rmaCode} is ${ro.status.toLowerCase()} and can't be received.`,
    );
  const place = await resolvePlacement(tx, ro.warehouseId, input);
  const lines = await tx
    .select()
    .from(schema.returnOrderLines)
    .where(eq(schema.returnOrderLines.returnOrderId, ro.id));
  const pending = new Map(lines.map((l) => [l.id, l.requestedQty - l.returnedQty]));
  const fieldErrors: Record<string, string[]> = {};
  const lineOf: (string | null)[] = [];
  const receiving = new Map<string, number>();
  input.items.forEach((item, i) => {
    const line =
      lines.find((l) => l.id === item.returnOrderLineId) ??
      lines.find((l) => l.productId === item.productId && (pending.get(l.id) ?? 0) > 0);
    lineOf[i] = line?.packType ?? null;
    if (!line) {
      fieldErrors[`items.${i}.productId`] = ['This product is not on the RMA'];
      return;
    }
    const left = pending.get(line.id) ?? 0;
    if (item.quantity > left)
      fieldErrors[`items.${i}.quantity`] = [
        left === 0 ? 'Already fully received' : `Max ${left} left to receive`,
      ];
    pending.set(line.id, left - item.quantity);
    receiving.set(line.id, (receiving.get(line.id) ?? 0) + item.quantity);
    if (item.disposition === 'Damaged' && !item.damageReasonId)
      fieldErrors[`items.${i}.damageReasonId`] = ['Choose a damage reason'];
  });
  for (const [k, v] of Object.entries(placementErrors(place, input.items))) fieldErrors[k] ??= v;
  const lockErrors = await placementLockErrors(tx, place, input.items);
  if (Object.keys(lockErrors).length > 0)
    throw validationError(Object.values(lockErrors)[0]?.[0] ?? 'Location is count-locked', lockErrors);
  if (ro.shipmentOrderId) {
    const so = (
      await tx
        .select({ id: schema.shipmentOrders.id, warehouseId: schema.shipmentOrders.warehouseId })
        .from(schema.shipmentOrders)
        .where(eq(schema.shipmentOrders.id, ro.shipmentOrderId))
        .limit(1)
    )[0];
    for (const [k, v] of Object.entries(
      await returnRuleErrors(tx, so, ro.warehouseId, input.items, { packTypeOf: (i) => lineOf[i] ?? null }),
    ))
      fieldErrors[k] ??= v;
  }
  if (Object.keys(fieldErrors).length > 0)
    throw validationError(Object.values(fieldErrors)[0]?.[0] ?? 'Invalid items', fieldErrors);
  if (input.complete && !input.shortClose) {
    const short = shortfallOf(lines, receiving);
    if (short.total > 0) {
      throw validationError(
        `${short.total} unit${short.total === 1 ? '' : 's'} not received will be closed as short. Confirm the short close, or Save progress to receive the rest later.`,
        { [SHORT_CLOSE_FIELD]: [`${short.total} short`] },
      );
    }
  }
  const remaining = new Map(lines.map((l) => [l.id, l.requestedQty - l.returnedQty]));
  const receiptIds = await mapSeq(input.items, async (item) => {
    const line =
      lines.find((l) => l.id === item.returnOrderLineId) ??
      lines.find((l) => l.productId === item.productId && (remaining.get(l.id) ?? 0) > 0);
    if (!line) throw new DomainError('VALIDATION', 'This product is not on the RMA');
    remaining.set(line.id, (remaining.get(line.id) ?? 0) - item.quantity);
    return await postItem(
      tx,
      ctx,
      (await tx.select().from(schema.returnOrders).where(eq(schema.returnOrders.id, ro.id)).limit(1))[0] ??
        ro,
      place,
      item,
      line.id,
    );
  });
  const after = await rollup(tx, ctx, ro.id, input.complete, input.shortCloseReason, ro.status);
  const qty = input.items.reduce((s, i) => s + i.quantity, 0);
  const notified = await notifyClient(tx, after, qty);
  return {
    returnOrderId: ro.id,
    rmaCode: ro.rmaCode,
    status: after.status,
    receivedQty: qty,
    receiptIds,
    notified,
    kpis: await returnStationKpis(tx, ctx.scope, ro.warehouseId, ctx.source),
  };
}

/** Return Manually: creates a Manual RMA for the client (optional order) and receives it. */
export async function receiveManual(
  tx: AppDb,
  ctx: Ctx,
  input: z.output<typeof receiveManualSchema>,
): Promise<ReceiveResult> {
  if (!hasWarehouse(ctx.scope, input.warehouseId)) throw new DomainError('NOT_FOUND', 'Warehouse not found');
  if (!hasClient(ctx.scope, input.clientId)) throw new DomainError('NOT_FOUND', 'Client not found');
  let order: typeof schema.shipmentOrders.$inferSelect | undefined;
  if (input.shipmentOrderId) {
    order = (
      await tx
        .select()
        .from(schema.shipmentOrders)
        .where(eq(schema.shipmentOrders.id, input.shipmentOrderId))
        .limit(1)
    )[0];
    assertInScope(ctx.scope, order, 'Shipment order');
    if (order?.clientId !== input.clientId)
      throw validationError('The order belongs to another client', {
        shipmentOrderId: ['Order belongs to another client'],
      });
  }
  const fieldErrors: Record<string, string[]> = {};
  await forEachSeq(input.items, async (item, i) => {
    const p = (
      await tx
        .select({ clientId: schema.products.clientId })
        .from(schema.products)
        .where(eq(schema.products.id, item.productId))
        .limit(1)
    )[0];
    if (!p || p.clientId !== input.clientId)
      fieldErrors[`items.${i}.productId`] = ['Product belongs to another client'];
    if (item.disposition === 'Damaged' && !item.damageReasonId)
      fieldErrors[`items.${i}.damageReasonId`] = ['Choose a damage reason'];
  });
  const place = await resolvePlacement(tx, input.warehouseId, input);
  for (const [k, v] of Object.entries(placementErrors(place, input.items))) fieldErrors[k] ??= v;
  const lockErrors = await placementLockErrors(tx, place, input.items);
  if (Object.keys(lockErrors).length > 0)
    throw validationError(Object.values(lockErrors)[0]?.[0] ?? 'Location is count-locked', lockErrors);
  const packTypeOf = async (i: number): Promise<string | null> => {
    const item = input.items[i];
    return order && item
      ? ((
          await tx
            .select({ packType: schema.orderLines.packType })
            .from(schema.orderLines)
            .where(
              and(eq(schema.orderLines.orderId, order.id), eq(schema.orderLines.productId, item.productId)),
            )
            .limit(1)
        )[0]?.packType ?? null)
      : null;
  };
  for (const [k, v] of Object.entries(
    await returnRuleErrors(tx, order, input.warehouseId, input.items, { packTypeOf }),
  ))
    fieldErrors[k] ??= v;
  if (Object.keys(fieldErrors).length > 0)
    throw validationError(Object.values(fieldErrors)[0]?.[0] ?? 'Invalid items', fieldErrors);
  const rmaCode = await sequences.next(tx, 'rma');
  const ro = (
    await tx
      .insert(schema.returnOrders)
      .values({
        rmaCode,
        shipmentOrderId: order?.id ?? null,
        warehouseId: input.warehouseId,
        clientId: input.clientId,
        source: 'Manual',
        status: 'Pending',
        customerName: input.customerName ?? order?.customerName ?? null,
        fromCountry: order?.shipCountry ?? null,
        note: input.note ?? null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning()
  )[0];
  await changeLog.recordCreate(tx, ctx, { entityType: 'return_order', entityId: ro.id, entityCode: rmaCode });
  const receiptIds = await mapSeq(input.items, async (item) => {
    const product = (
      await tx.select().from(schema.products).where(eq(schema.products.id, item.productId)).limit(1)
    )[0];
    const orderLine = order
      ? (
          await tx
            .select()
            .from(schema.orderLines)
            .where(
              and(eq(schema.orderLines.orderId, order.id), eq(schema.orderLines.productId, item.productId)),
            )
            .limit(1)
        )[0]
      : undefined;
    const line = (
      await tx
        .insert(schema.returnOrderLines)
        .values({
          returnOrderId: ro.id,
          orderLineId: orderLine?.id ?? null,
          productId: item.productId,
          packType: orderLine?.packType ?? product?.uom ?? 'Unit',
          requestedQty: item.quantity,
          actualReturnReasonId: item.actualReturnReasonId ?? null,
          createdBy: ctx.userId,
        })
        .returning()
    )[0];
    await changeLog.recordLineCreate(tx, ctx, {
      entityType: 'return_order',
      entityId: ro.id,
      entityCode: rmaCode,
      lineEntityType: 'return_order_line',
      lineEntityId: line.id,
      lineLabel: product?.sku ?? item.productId,
    });
    return await postItem(
      tx,
      ctx,
      (await tx.select().from(schema.returnOrders).where(eq(schema.returnOrders.id, ro.id)).limit(1))[0] ??
        ro,
      place,
      { ...item, returnOrderLineId: line.id },
      line.id,
    );
  });
  const after = await rollup(tx, ctx, ro.id, true, null, 'Pending');
  const qty = input.items.reduce((s, i) => s + i.quantity, 0);
  const notified = await notifyClient(tx, after, qty);
  return {
    returnOrderId: ro.id,
    rmaCode,
    status: after.status,
    receivedQty: qty,
    receiptIds,
    notified,
    kpis: await returnStationKpis(tx, ctx.scope, input.warehouseId, ctx.source),
  };
}

/* ------------------------------------------------------------------ KPIs */

export interface ReturnStationKpis {
  readonly returnedOrdersToday: number;
  readonly returnedProductsToday: number;
  readonly openReturns: number;
}

export async function returnStationKpis(
  db: AppDb,
  scope: Scope,
  warehouseId: string,
  userSource: string,
  now = new Date(),
): Promise<ReturnStationKpis> {
  if (!hasWarehouse(scope, warehouseId)) throw new DomainError('NOT_FOUND', 'Warehouse not found');
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const since = start.toISOString();
  const today = await dbGet<{ orders: number; units: number }>(
    db,
    sql`SELECT COUNT(DISTINCT return_order_id) AS orders, COALESCE(SUM(quantity),0) AS units
    FROM receipts WHERE type = 'Return' AND warehouse_id = ${warehouseId} AND received_by = ${userSource} AND received_at >= ${since} AND cancelled_at IS NULL`,
  );
  const clients =
    scope.clientIds === 'all'
      ? sql`1 = 1`
      : scope.clientIds.length
        ? sql`client_id IN (${sql.join(
            scope.clientIds.map((c) => sql`${c}`),
            sql`, `,
          )})`
        : sql`0 = 1`;
  const open = await dbGet<{ n: number }>(
    db,
    sql`SELECT COUNT(*) AS n FROM return_orders WHERE warehouse_id = ${warehouseId} AND status IN ('Pending','In Transit','Started') AND ${clients}`,
  );
  return {
    returnedOrdersToday: today?.orders ?? 0,
    returnedProductsToday: today?.units ?? 0,
    openReturns: open?.n ?? 0,
  };
}

/* -------------------------------------------------------- station setup */

export interface StationOption {
  readonly id: string;
  readonly code: string;
  readonly kind: 'location' | 'lp';
  readonly detail: string | null;
  /** Open count plan that locks this location (the LP's location for an LP): receiving into it is refused. */
  readonly countLockPlan?: string | null;
  readonly lockReason?: string | null;
}

async function withLock(
  db: AppDb,
  o: StationOption,
  locationId: string | null,
  label: string,
): Promise<StationOption> {
  const lock = await locationLock(db, locationId);
  return lock
    ? {
        ...o,
        countLockPlan: lock.planCode,
        lockReason: `${label} ${lock.locationCode === o.code ? o.code : `${o.code} (in ${lock.locationCode})`} is locked by count plan ${lock.planCode}. Finish, update or cancel the count first.`,
      }
    : { ...o, countLockPlan: null, lockReason: null };
}

/**
 * Return Station locations: active Returns-area locations of the warehouse. Physical stations
 * first (a Virtual location is never the default for physical returns), then by code.
 */
export async function returnStations(db: AppDb, scope: Scope, warehouseId: string): Promise<StationOption[]> {
  if (!hasWarehouse(scope, warehouseId)) throw new DomainError('NOT_FOUND', 'Warehouse not found');
  return (
    (
      await mapSeq(
        await dbAll<{ id: string; code: string; detail: string | null }>(
          db,
          sql`SELECT id, code, CASE WHEN location_type = 'Virtual' THEN 'Virtual · not for physical returns' ELSE location_type END AS detail FROM locations
    WHERE warehouse_id = ${warehouseId} AND area_type = 'Returns' AND is_active = true
    ORDER BY CASE WHEN location_type = 'Virtual' THEN 1 ELSE 0 END, code`,
        ),
        async (r) => await withLock(db, { ...r, kind: 'location' as const }, r.id, 'Station'),
      )
    )
      // Unlocked stations first, so the remembered / default pick is never one that can't commit.
      .sort((a, b) => Number(Boolean(a.countLockPlan)) - Number(Boolean(b.countLockPlan)))
  );
}

/** Target areas in the order the picker shows them: where returned stock normally goes first. */
export const TARGET_AREA_ORDER = ['Returns', 'Storage', 'Picking', 'Receiving'] as const;

export const targetQuerySchema = z.object({
  warehouseId: idSchema,
  kind: z.enum(['location', 'lp']),
  q: z.string().trim().max(60).optional(),
});

/** Return target candidates: locations (Returns area first) or license plates, by code prefix. */
export async function returnTargets(
  db: AppDb,
  scope: Scope,
  input: z.output<typeof targetQuerySchema>,
): Promise<StationOption[]> {
  if (!hasWarehouse(scope, input.warehouseId)) throw new DomainError('NOT_FOUND', 'Warehouse not found');
  const like = `${(input.q ?? '').toLowerCase()}%`;
  if (input.kind === 'lp') {
    return await mapSeq(
      await dbAll<{ id: string; code: string; detail: string | null; locationId: string | null }>(
        db,
        sql`SELECT lp.id, lp.number AS code, l.code AS detail, lp.location_id AS "locationId" FROM license_plates lp
      LEFT JOIN locations l ON l.id = lp.location_id WHERE lp.warehouse_id = ${input.warehouseId} AND lower(lp.number) ILIKE ${like} ESCAPE ''
      ORDER BY lp.number LIMIT 50`,
      ),
      async ({ locationId, ...r }) =>
        await withLock(db, { ...r, kind: 'lp' as const }, locationId, 'Target LP'),
    );
  }
  // Grouped by area (Returns first, then quarantine / storage / picking …); Packing, Shipment, Loading, Kitting and
  // Virtual locations are never return targets.
  const areaRank = sql.raw(
    `CASE area_type ${TARGET_AREA_ORDER.map((a, i) => `WHEN '${a}' THEN ${i}`).join(' ')} ELSE ${TARGET_AREA_ORDER.length} END`,
  );
  return await mapSeq(
    await dbAll<{ id: string; code: string; detail: string | null }>(
      db,
      sql`SELECT id, code, COALESCE(area_type, 'No') || ' area' || COALESCE(' · ' || location_type, '') AS detail FROM locations
    WHERE warehouse_id = ${input.warehouseId} AND is_active = true AND lower(code) ILIKE ${like}
      AND COALESCE(location_type, '') <> 'Virtual' AND COALESCE(area_type, '') NOT IN ('Packing', 'Shipment', 'Loading', 'Kitting')
    ORDER BY ${areaRank}, code LIMIT 50`,
    ),
    async (r) => await withLock(db, { ...r, kind: 'location' as const }, r.id, 'Target'),
  );
}
