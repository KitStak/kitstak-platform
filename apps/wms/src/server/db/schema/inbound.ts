/** Inbound: purchase orders, PO lines, receipts (Receiving History rows). */
import { index, integer, doublePrecision, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { wmsSchema } from './_schema';
import { PO_STATUSES, PO_TYPES, RECEIVING_TYPES } from '../../../lib/enums';
import { bool, customFields, nowIso, pk, stamps } from '../columns';
import { products } from './catalog';
import { clients, vendors, warehouses } from './org';

/** `receivedAt` == Actual Receiving Date; `vendorName` is kept as the display snapshot. */
export const purchaseOrders = wmsSchema.table(
  'purchase_orders',
  {
    id: pk(),
    code: text('code').notNull(),
    warehouseId: text('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    clientId: text('client_id')
      .notNull()
      .references(() => clients.id),
    vendorName: text('vendor_name').notNull(),
    referenceNumber: text('reference_number'),
    status: text('status', { enum: PO_STATUSES }).notNull(),
    poType: text('po_type', { enum: PO_TYPES }).notNull().default('Purchase Order'),
    totalQuantity: integer('total_quantity').notNull(),
    receivedQuantity: integer('received_quantity').notNull().default(0),
    purchasePrice: doublePrecision('purchase_price').notNull(),
    expectedDate: text('expected_date'),
    receivedAt: text('received_at'),
    vendorId: text('vendor_id').references(() => vendors.id),
    poDate: text('po_date'),
    plannedReceivingDate: text('planned_receiving_date'),
    plannedArrivalDate: text('planned_arrival_date'),
    actualArrivalDate: text('actual_arrival_date'),
    note: text('note'),
    completedAt: text('completed_at'),
    cancelledAt: text('cancelled_at'),
    ...customFields(),
    ...stamps(),
  },
  (t) => [
    uniqueIndex('po_code_idx').on(t.code),
    index('po_status_idx').on(t.status),
    index('po_client_idx').on(t.clientId),
    index('po_vendor_idx').on(t.vendorId),
  ],
);

export const purchaseOrderLines = wmsSchema.table(
  'purchase_order_lines',
  {
    id: pk(),
    purchaseOrderId: text('purchase_order_id')
      .notNull()
      .references(() => purchaseOrders.id),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    orderedQuantity: integer('ordered_quantity').notNull(),
    receivedQuantity: integer('received_quantity').notNull().default(0),
    unitCost: doublePrecision('unit_cost').notNull(),
    packType: text('pack_type').notNull().default('Each'),
    uomQuantity: integer('uom_quantity').notNull().default(1),
    receivingLocationId: text('receiving_location_id'),
    lotNumber: text('lot_number'),
    expiryDate: text('expiry_date'),
    productionDate: text('production_date'),
    lpTypeId: text('lp_type_id'),
    lpNumber: text('lp_number'),
    damagedQuantity: integer('damaged_quantity').notNull().default(0),
    note: text('note'),
    ...stamps(),
  },
  (t) => [index('po_lines_po_idx').on(t.purchaseOrderId)],
);

export const receipts = wmsSchema.table(
  'receipts',
  {
    id: pk(),
    masterId: integer('master_id').notNull(),
    type: text('type', { enum: RECEIVING_TYPES }).notNull(),
    warehouseId: text('warehouse_id').notNull(),
    clientId: text('client_id').notNull(),
    purchaseOrderId: text('purchase_order_id'),
    purchaseOrderLineId: text('purchase_order_line_id'),
    workOrderId: text('work_order_id'),
    shipmentOrderId: text('shipment_order_id'),
    returnOrderId: text('return_order_id'),
    returnOrderLineId: text('return_order_line_id'),
    productId: text('product_id').notNull(),
    packType: text('pack_type').notNull(),
    quantity: integer('quantity').notNull(),
    uomQuantity: integer('uom_quantity').notNull(),
    lotNumber: text('lot_number'),
    expiryDate: text('expiry_date'),
    productionDate: text('production_date'),
    locationId: text('location_id').notNull(),
    lpId: text('lp_id'),
    parentLpId: text('parent_lp_id'),
    damageReason: text('damage_reason'),
    damageImageFileId: text('damage_image_file_id'),
    customerReturnReason: text('customer_return_reason'),
    actualReturnReason: text('actual_return_reason'),
    skuDetailsUpdated: bool('sku_details_updated').notNull().default(false),
    note: text('note'),
    lineNote: text('line_note'),
    inventoryTransactionId: text('inventory_transaction_id'),
    receivedBy: text('received_by').notNull(),
    receivedAt: text('received_at').notNull().$defaultFn(nowIso),
    cancelledAt: text('cancelled_at'),
    cancelledBy: text('cancelled_by'),
  },
  (t) => [
    index('receipts_po_idx').on(t.purchaseOrderId),
    // PO list: correlated active-receipt count (inbound-receiving REQ-R2-17).
    index('receipts_po_active_idx').on(t.purchaseOrderId, t.cancelledAt),
    index('receipts_at_idx').on(t.receivedAt),
    uniqueIndex('receipts_master_idx').on(t.masterId),
    index('receipts_return_idx').on(t.returnOrderId),
  ],
);

/** Serial numbers pre-advised per PO line (Import Serial Numbers / Remove Serial Number). */
export const purchaseOrderSerials = wmsSchema.table(
  'purchase_order_serials',
  {
    id: pk(),
    purchaseOrderLineId: text('purchase_order_line_id')
      .notNull()
      .references(() => purchaseOrderLines.id),
    serial: text('serial').notNull(),
    createdAt: text('created_at').notNull().$defaultFn(nowIso),
    createdBy: text('created_by'),
  },
  (t) => [uniqueIndex('po_serials_line_serial_idx').on(t.purchaseOrderLineId, t.serial)],
);
