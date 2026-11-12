/**
 * Fact builders for rule evaluation (orders, inventory buckets) plus a generic
 * multi-key comparator for `OrderByClause[]` (nulls always sort last).
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { OrderByClause } from '@/lib/domain-types';
import { CUSTOM_FIELD_SLOTS } from '@/lib/enums';
import * as schema from '@/server/db/schema';
import type { FactValue, Facts } from './conditions';
import type { InventoryRow } from './ledger/bucket';
import type { LocationRow } from './ledger/rules';
import type { Tx } from './types';

export type OrderRow = typeof schema.shipmentOrders.$inferSelect;
export type OrderLineRow = typeof schema.orderLines.$inferSelect;

/** Facts for order conditions (allocation rules, workflows, job types, wave filters). */
export async function orderFacts(tx: Tx, order: OrderRow, lines?: readonly OrderLineRow[]): Promise<Facts> {
  const orderLines =
    lines ?? (await tx.select().from(schema.orderLines).where(eq(schema.orderLines.orderId, order.id)));
  const productIds = [...new Set(orderLines.map((l) => l.productId))];
  const products =
    productIds.length === 0
      ? []
      : await tx.select().from(schema.products).where(inArray(schema.products.id, productIds));
  const tagNames = (
    await tx
      .select({ name: schema.tags.name })
      .from(schema.entityTags)
      .innerJoin(schema.tags, eq(schema.tags.id, schema.entityTags.tagId))
      .where(
        and(eq(schema.entityTags.entityType, 'shipment_order'), eq(schema.entityTags.entityId, order.id)),
      )
  ).map((t) => t.name);
  const active = orderLines.filter((l) => l.quantity - l.cancelledQuantity > 0);
  const units = active.reduce((s, l) => s + l.quantity - l.cancelledQuantity, 0);
  const custom = Object.fromEntries(
    Object.entries(order.customFields ?? {}).map(([k, v]) => [`customField.${k}`, v ?? null]),
  );
  return {
    ...custom,
    client: order.clientId,
    clientId: order.clientId,
    warehouse: order.warehouseId,
    warehouseId: order.warehouseId,
    code: order.code,
    status: order.status,
    orderType: order.orderTypeId ?? order.orderType,
    channel: order.channel,
    priority: order.priority,
    fraud: order.fraud,
    store: order.storeName,
    storeName: order.storeName,
    carrier: order.carrier,
    shipmentMethod: order.shippingService,
    carrierServiceId: order.carrierServiceId,
    country: order.shipCountry,
    state: order.shipState,
    city: order.shipCity,
    zip: order.shipZip,
    sku: products.map((p) => p.sku),
    productGroup: products.map((p) => p.productGroupId),
    productType: products.map((p) => p.productTypeId),
    productPackType: active.map((l) => l.packType),
    orderTag: tagNames,
    orderQuantity: units,
    lineCount: active.length,
    orderPrice: order.salesPrice,
    carrierRate: order.rate,
    isBackOrder: order.isBackOrder,
    isGift: order.isGift,
    isOversized: products.some((p) => p.isOversized),
    isPrime: order.isPrime,
    retailer: order.retailerId,
    shipmentPackage: order.shipmentPackageId,
    orderDate: order.orderDate,
    shipmentOrderDate: order.orderDate,
    expectedShipmentDate: order.expectedShipDate,
    plannedShipmentDate: order.scheduledShipmentDate,
    customerName: order.customerName,
    addressType: order.addressType,
    shipAddress: order.shipAddress,
    shipAddress2: order.shipAddress2,
    addressLine1: order.shipAddress,
    addressLine2: order.shipAddress2,
    customerEmail: order.customerEmail,
    storeOrderNumber: order.storeOrderNumber,
    ...(await cartonFacts(tx, order, active, productIds)),
  };
}

/**
 * Logiwa "Is Partial", "Precartonization Type" and "Number of Boxes" (M12, additive):
 * - isPartial: some of the order is already allocated or shipped while the rest is still open.
 * - precartonizationType: a workflow/user pre-selected box (Shipment Package), every SKU ships in
 *   its own box (Own Box), only some do (Mixed), else None.
 * - numberOfBoxes: active shipping labels when the order has any; else the estimate
 *   own-box units + one shared box for the remaining units.
 */
async function cartonFacts(
  tx: Tx,
  order: OrderRow,
  active: readonly OrderLineRow[],
  productIds: readonly string[],
): Promise<Facts> {
  const open = (l: OrderLineRow) => l.quantity - l.cancelledQuantity;
  const progressed = active.reduce((s, l) => s + Math.max(l.allocatedQuantity, l.shippedQuantity), 0);
  const units = active.reduce((s, l) => s + open(l), 0);
  const isPartial = order.status === 'Partially Shipped' || (progressed > 0 && progressed < units);
  const ppt = schema.productPackTypes;
  const ownBox = new Set(
    productIds.length === 0
      ? []
      : (
          await tx
            .select({ productId: ppt.productId, packType: ppt.packType })
            .from(ppt)
            .where(and(inArray(ppt.productId, [...productIds]), eq(ppt.useOwnBox, true)))
        ).map((r) => `${r.productId}|${r.packType}`),
  );
  const ownUnits = active
    .filter((l) => ownBox.has(`${l.productId}|${l.packType}`))
    .reduce((s, l) => s + open(l), 0);
  const precartonizationType = order.shipmentPackageId
    ? 'Shipment Package'
    : ownUnits === 0
      ? 'None'
      : ownUnits === units
        ? 'Own Box'
        : 'Mixed';
  const labels = (
    await tx
      .select({ id: schema.shipments.id })
      .from(schema.shipments)
      .where(
        and(
          eq(schema.shipments.orderId, order.id),
          eq(schema.shipments.labelType, 'Shipping Label'),
          eq(schema.shipments.labelStatus, 'Active'),
        ),
      )
  ).length;
  const numberOfBoxes = labels > 0 ? labels : units === 0 ? 0 : ownUnits + (units - ownUnits > 0 ? 1 : 0);
  return { isPartial, precartonizationType, numberOfBoxes };
}

/** Facts for allocation inventory conditions / putaway location filters. */
export function bucketFacts(bucket: InventoryRow, location: LocationRow, lpNumber: string | null): Facts {
  return {
    locationGroup: location.locationGroupId,
    locationZone: location.locationZoneId,
    zone: location.zone,
    areaType: location.areaType,
    isPreventInventorySync: location.preventInventorySync,
    isPreventAllocation: location.preventAllocation,
    isAllowOnlyDamaged: location.onlyDamaged,
    isPreventMultiClient: location.singleClient,
    assignedClient: location.dedicatedClientId,
    abcCode: location.abcCode,
    replenishmentType: location.replenishmentType,
    locationType: location.locationType,
    level: location.level,
    column: location.column,
    aisle: location.aisle,
    location: location.code,
    walkingPathPriority: location.walkingPathPriority,
    lpNumber,
    inventoryDamageReason: bucket.damageReason,
    inventoryLotBatchNumber: bucket.lotNumber,
    inventoryExpiryDate: bucket.expiryDate,
    inventoryPackType: bucket.packType,
    inventoryUomPackType: bucket.packType,
    inventoryProductionDate: bucket.productionDate,
    inventoryReceivingDate: bucket.receivedAt,
    lotBatchNumber: bucket.lotNumber,
    expiryDate: bucket.expiryDate,
    productionDate: bucket.productionDate,
    receivingDate: bucket.receivedAt,
    freeInventory: bucket.onHand - bucket.allocated,
    client: bucket.clientId,
    // Location custom-field slots (allocation inventory conditions, Logiwa "Location Custom Field …").
    ...Object.fromEntries(
      CUSTOM_FIELD_SLOTS.map((slot) => [
        `locationCustomField.${slot}`,
        location.customFields?.[slot] ?? null,
      ]),
    ),
  };
}

function cmp(a: FactValue, b: FactValue): number {
  const an = a === null || a === undefined || a === '';
  const bn = b === null || b === undefined || b === '';
  if (an || bn) return an === bn ? 0 : an ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/** Sorts items by `orderBy` facts; stable, nulls last regardless of direction. */
export function sortByClauses<T>(
  items: readonly T[],
  clauses: readonly OrderByClause[],
  factsOf: (item: T) => Facts,
): T[] {
  const withFacts = items.map((item, index) => ({ item, index, facts: factsOf(item) }));
  withFacts.sort((x, y) => {
    for (const c of clauses) {
      const a = x.facts[c.field];
      const b = y.facts[c.field];
      const aNull = a === null || a === undefined || a === '';
      const bNull = b === null || b === undefined || b === '';
      if (aNull !== bNull) return aNull ? 1 : -1;
      const r = cmp(a, b);
      if (r !== 0) return c.dir === 'desc' ? -r : r;
    }
    return x.index - y.index;
  });
  return withFacts.map((w) => w.item);
}
