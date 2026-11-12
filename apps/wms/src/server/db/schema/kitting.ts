/** Kitting: work orders, work order components, kit inventory stats. */
import { index, integer, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { wmsSchema } from './_schema';
import { WORK_ORDER_STATUSES, WORK_ORDER_TYPES } from '../../../lib/enums';
import { customFields, pk, stamps } from '../columns';
import { products } from './catalog';
import { clients, warehouses } from './org';

export const workOrders = wmsSchema.table(
  'work_orders',
  {
    id: pk(),
    code: text('code').notNull(),
    warehouseId: text('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id),
    type: text('type', { enum: WORK_ORDER_TYPES }).notNull(),
    operationType: text('operation_type', { enum: ['Kitting'] })
      .notNull()
      .default('Kitting'),
    buildFor: text('build_for', { enum: ['Stock', 'SO'] })
      .notNull()
      .default('Stock'),
    shipmentOrderId: text('shipment_order_id'),
    kitProductId: text('kit_product_id')
      .notNull()
      .references(() => products.id),
    requestedQty: integer('requested_qty').notNull(),
    processedQty: integer('processed_qty').notNull().default(0),
    status: text('status', { enum: WORK_ORDER_STATUSES }).notNull().default('Open'),
    extraNote: text('extra_note'),
    kittingInstructions: text('kitting_instructions'),
    plannedStartAt: text('planned_start_at'),
    plannedFinishAt: text('planned_finish_at'),
    actualStartAt: text('actual_start_at'),
    actualFinishAt: text('actual_finish_at'),
    cancelledAt: text('cancelled_at'),
    jobId: text('job_id'),
    outputLocationId: text('output_location_id'),
    outputLot: text('output_lot'),
    outputExpiry: text('output_expiry'),
    ...customFields(),
    ...stamps(),
  },
  (t) => [
    uniqueIndex('work_order_code_idx').on(t.code),
    index('work_orders_status_idx').on(t.warehouseId, t.status),
  ],
);

export const workOrderComponents = wmsSchema.table(
  'work_order_components',
  {
    id: pk(),
    workOrderId: text('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    componentProductId: text('component_product_id').notNull(),
    componentQty: integer('component_qty').notNull(),
    totalQty: integer('total_qty').notNull(),
    packType: text('pack_type').notNull().default('Each'),
    locationId: text('location_id'),
    lpId: text('lp_id'),
    lotNumber: text('lot_number'),
    expiryDate: text('expiry_date'),
    productionDate: text('production_date'),
    allocatedQty: integer('allocated_qty').notNull().default(0),
    pickedQty: integer('picked_qty').notNull().default(0),
    consumedQty: integer('consumed_qty').notNull().default(0),
  },
  (t) => [index('wo_components_wo_idx').on(t.workOrderId)],
);

/** Recalculated by the scheduler. */
export const kitInventoryStats = wmsSchema.table(
  'kit_inventory_stats',
  {
    kitProductId: text('kit_product_id').notNull(),
    warehouseId: text('warehouse_id').notNull(),
    pendingOrderQty: integer('pending_order_qty').notNull(),
    netKittingCapacity: integer('net_kitting_capacity').notNull(),
    totalInventoryCapacity: integer('total_inventory_capacity').notNull(),
    currentInventoryQty: integer('current_inventory_qty').notNull(),
    requiredKittingQty: integer('required_kitting_qty').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.kitProductId, t.warehouseId] })],
);
