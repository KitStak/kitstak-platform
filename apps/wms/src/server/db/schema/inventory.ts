/** Inventory ledger: buckets, transactions, allocations, snapshots, missing log. */
import { index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { ALLOCATION_STATUSES, INVENTORY_STATUSES, TXN_TYPES } from '../../../lib/enums';
import { bool, nowIso, pk, stamps } from '../columns';
import { products } from './catalog';
import { licensePlates, locations } from './facility';
import { clients, warehouses } from './org';

/** Prefix of the placeholder `bucket_key` given to rows inserted outside the ledger (legacy seed). */
export const LEGACY_BUCKET_KEY_PREFIX = 'legacy:';

/**
 * One row == one bucket: (warehouse, product, location, lp, lot, expiry,
 * production date, damage reason, pack type, status).
 *
 * `bucketKey` is set by `ledger.*` (sha1 of the tuple). Rows written outside the
 * ledger get a unique `legacy:<uuid>` placeholder. `clientId` is nullable only
 * so the pre-F2 seed (which predates the column) still inserts; the ledger
 * always sets it and `db:verify` should assert it is present.
 */
export const inventory = pgTable(
  'inventory',
  {
    id: pk(),
    warehouseId: text('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    locationId: text('location_id')
      .notNull()
      .references(() => locations.id),
    lotNumber: text('lot_number'),
    onHand: integer('on_hand').notNull(),
    allocated: integer('allocated').notNull().default(0),
    damaged: integer('damaged').notNull().default(0),
    receivedAt: text('received_at').notNull(),
    bucketKey: text('bucket_key')
      .notNull()
      .$defaultFn(() => `${LEGACY_BUCKET_KEY_PREFIX}${crypto.randomUUID()}`),
    clientId: text('client_id').references(() => clients.id),
    lpId: text('lp_id').references(() => licensePlates.id),
    status: text('status', { enum: INVENTORY_STATUSES }).notNull().default('Stock'),
    packType: text('pack_type').notNull().default('Each'),
    expiryDate: text('expiry_date'),
    productionDate: text('production_date'),
    damageReason: text('damage_reason'), // non-null => qty counted in `damaged`
    poNumber: text('po_number'),
    mobileCartId: text('mobile_cart_id'),
    updatedAt: text('updated_at').notNull().$defaultFn(nowIso).$onUpdateFn(nowIso),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    index('inventory_product_idx').on(t.productId),
    index('inventory_location_idx').on(t.locationId),
    uniqueIndex('inventory_bucket_idx').on(t.bucketKey),
    index('inventory_wh_client_product_idx').on(t.warehouseId, t.clientId, t.productId),
    index('inventory_status_idx').on(t.status),
    index('inventory_lp_idx').on(t.lpId),
  ],
);

export const inventoryTransactions = pgTable(
  'inventory_transactions',
  {
    id: pk(),
    seq: integer('seq').notNull(), // monotonic, stable ordering
    type: text('type', { enum: TXN_TYPES }).notNull(),
    warehouseId: text('warehouse_id').notNull(),
    clientId: text('client_id').notNull(),
    productId: text('product_id').notNull(),
    fromInventoryId: text('from_inventory_id'),
    toInventoryId: text('to_inventory_id'),
    fromLocationId: text('from_location_id'),
    toLocationId: text('to_location_id'),
    fromLpId: text('from_lp_id'),
    toLpId: text('to_lp_id'),
    fromParentLpId: text('from_parent_lp_id'),
    toParentLpId: text('to_parent_lp_id'),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    fromPackType: text('from_pack_type'),
    toPackType: text('to_pack_type'),
    fromLot: text('from_lot'),
    toLot: text('to_lot'),
    fromExpiry: text('from_expiry'),
    toExpiry: text('to_expiry'),
    fromProductionDate: text('from_production_date'),
    toProductionDate: text('to_production_date'),
    fromDamageReason: text('from_damage_reason'),
    toDamageReason: text('to_damage_reason'),
    uomQty: integer('uom_qty').notNull(), // signed for adjust/count deltas
    packQty: integer('pack_qty').notNull(),
    adjustmentReasonId: text('adjustment_reason_id'),
    orderId: text('order_id'),
    orderLineId: text('order_line_id'),
    purchaseOrderId: text('purchase_order_id'),
    receiptId: text('receipt_id'),
    workOrderId: text('work_order_id'),
    countPlanId: text('count_plan_id'),
    returnOrderId: text('return_order_id'),
    jobId: text('job_id'),
    taskId: text('task_id'),
    shipmentId: text('shipment_id'),
    algorithmName: text('algorithm_name'),
    algorithmRuleName: text('algorithm_rule_name'),
    note: text('note'),
    userId: text('user_id'),
    source: text('source').notNull(),
    at: text('at').notNull().$defaultFn(nowIso),
  },
  (t) => [
    index('itx_product_idx').on(t.productId, t.at),
    index('itx_type_idx').on(t.type, t.at),
    index('itx_order_idx').on(t.orderId),
    index('itx_wh_idx').on(t.warehouseId, t.at),
    uniqueIndex('itx_seq_idx').on(t.seq),
  ],
);

export const inventoryAllocations = pgTable(
  'inventory_allocations',
  {
    id: pk(),
    inventoryId: text('inventory_id')
      .notNull()
      .references(() => inventory.id),
    orderId: text('order_id'),
    orderLineId: text('order_line_id'),
    workOrderId: text('work_order_id'),
    workOrderComponentId: text('work_order_component_id'),
    jobId: text('job_id'),
    taskId: text('task_id'),
    qty: integer('qty').notNull(),
    status: text('status', { enum: ALLOCATION_STATUSES }).notNull().default('Allocated'),
    algorithmId: text('algorithm_id'),
    ruleName: text('rule_name'),
    waveId: text('wave_id'),
    ...stamps(),
  },
  (t) => [
    index('alloc_order_idx').on(t.orderId),
    index('alloc_inv_idx').on(t.inventoryId),
    index('alloc_job_idx').on(t.jobId),
  ],
);

export const inventorySnapshots = pgTable(
  'inventory_snapshots',
  {
    id: pk(),
    snapshotAt: text('snapshot_at').notNull(),
    warehouseId: text('warehouse_id').notNull(),
    clientId: text('client_id').notNull(),
    productId: text('product_id').notNull(),
    locationId: text('location_id').notNull(),
    lpId: text('lp_id'),
    parentLpId: text('parent_lp_id'),
    lotNumber: text('lot_number'),
    expiryDate: text('expiry_date'),
    productionDate: text('production_date'),
    damageReason: text('damage_reason'),
    status: text('status').notNull(),
    packType: text('pack_type').notNull(),
    uomQty: integer('uom_qty').notNull(),
    packQty: integer('pack_qty').notNull(),
  },
  (t) => [index('snap_at_idx').on(t.snapshotAt, t.warehouseId)],
);

export const missingLog = pgTable(
  'missing_log',
  {
    id: pk(),
    waveNo: text('wave_no'),
    jobId: text('job_id'),
    taskId: text('task_id'),
    orderId: text('order_id'),
    productId: text('product_id').notNull(),
    locationId: text('location_id').notNull(),
    lpId: text('lp_id'),
    packType: text('pack_type').notNull(),
    missingQty: integer('missing_qty').notNull(),
    inventoryQty: integer('inventory_qty').notNull(),
    isRetain: bool('is_retain').notNull().default(false),
    notes: text('notes'),
    warehouseId: text('warehouse_id').notNull(),
    clientId: text('client_id').notNull(),
    enteredBy: text('entered_by').notNull(),
    enteredAt: text('entered_at').notNull().$defaultFn(nowIso),
  },
  (t) => [index('missing_log_at_idx').on(t.warehouseId, t.enteredAt)],
);
