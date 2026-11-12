/** Shipping: carrier shipments (labels), shipment items, end-of-day manifests, shipment plans. */
import { index, integer, primaryKey, doublePrecision, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { wmsSchema } from './_schema';
import {
  EOD_STATUSES,
  LABEL_FORMATS,
  LABEL_STATUSES,
  LABEL_TYPES,
  SHIPMENT_PLAN_STATUSES,
} from '../../../lib/enums';
import { bool, customFields, nowIso, pk, stamps } from '../columns';
import { warehouses } from './org';
import { shipmentOrders } from './outbound';

/** One row per package/label (Carrier Shipment Details). */
export const shipments = wmsSchema.table(
  'shipments',
  {
    id: pk(),
    orderId: text('order_id')
      .notNull()
      .references(() => shipmentOrders.id),
    warehouseId: text('warehouse_id').notNull(),
    clientId: text('client_id').notNull(),
    carrierConnectionId: text('carrier_connection_id'),
    carrierCode: text('carrier_code').notNull(),
    carrierServiceId: text('carrier_service_id'),
    serviceName: text('service_name').notNull(),
    rateShoppingPresetId: text('rate_shopping_preset_id'),
    isRateShopped: bool('is_rate_shopped').notNull().default(false),
    labelType: text('label_type', { enum: LABEL_TYPES }).notNull().default('Shipping Label'),
    labelStatus: text('label_status', { enum: LABEL_STATUSES }).notNull().default('Active'),
    labelFormat: text('label_format', { enum: LABEL_FORMATS }).notNull().default('PDF'),
    labelFileId: text('label_file_id'),
    masterTrackingNumber: text('master_tracking_number'),
    trackingNumber: text('tracking_number').notNull(),
    shipmentPackageId: text('shipment_package_id'),
    packageSeq: integer('package_seq').notNull().default(1),
    weight: doublePrecision('weight').notNull(),
    weightUnit: text('weight_unit').notNull().default('Ounce'),
    length: doublePrecision('length').notNull(),
    width: doublePrecision('width').notNull(),
    height: doublePrecision('height').notNull(),
    dimensionUnit: text('dimension_unit').notNull().default('Inch'),
    rate: doublePrecision('rate').notNull().default(0),
    shippingCost: doublePrecision('shipping_cost').notNull().default(0),
    otherCost: doublePrecision('other_cost').notNull().default(0),
    currency: text('currency').notNull().default('USD'),
    zone: text('zone'),
    insuranceType: text('insurance_type'),
    insuranceValue: doublePrecision('insurance_value'),
    confirmationType: text('confirmation_type'),
    allowSaturdayDelivery: bool('allow_saturday_delivery').notNull().default(false),
    carrierExpectedDeliveryAt: text('carrier_expected_delivery_at'),
    labelCreatedAt: text('label_created_at').notNull().$defaultFn(nowIso),
    actualShipmentAt: text('actual_shipment_at'),
    /** Customer notification stamps, set by whatever sends the emails (shipping R6-2 / R8-1). */
    shipmentMailSentAt: text('shipment_mail_sent_at'),
    deliveryMailSentAt: text('delivery_mail_sent_at'),
    deliveredAt: text('delivered_at'),
    voidedAt: text('voided_at'),
    scheduledPickupAt: text('scheduled_pickup_at'),
    actualPickupAt: text('actual_pickup_at'),
    endOfDayManifestId: text('end_of_day_manifest_id'),
    packedFromLocationId: text('packed_from_location_id'),
    parentLpId: text('parent_lp_id'),
    externalReference: text('external_reference'),
    createdBy: text('created_by'),
  },
  (t) => [
    index('shipments_order_idx').on(t.orderId),
    index('shipments_label_at_idx').on(t.labelCreatedAt),
    index('shipments_tracking_idx').on(t.trackingNumber),
    index('shipments_eod_idx').on(t.endOfDayManifestId),
  ],
);

export const shipmentItems = wmsSchema.table(
  'shipment_items',
  {
    id: pk(),
    shipmentId: text('shipment_id')
      .notNull()
      .references(() => shipments.id, { onDelete: 'cascade' }),
    orderLineId: text('order_line_id').notNull(),
    productId: text('product_id').notNull(),
    packType: text('pack_type').notNull(),
    quantity: integer('quantity').notNull(),
    lotNumber: text('lot_number'),
    expiryDate: text('expiry_date'),
    serialNumberId: text('serial_number_id'),
  },
  (t) => [index('shipment_items_shipment_idx').on(t.shipmentId)],
);

export const endOfDayManifests = wmsSchema.table(
  'end_of_day_manifests',
  {
    id: pk(),
    warehouseId: text('warehouse_id').notNull(),
    carrierConnectionId: text('carrier_connection_id').notNull(),
    carrierPrefix: text('carrier_prefix').notNull(),
    carrierCode: text('carrier_code').notNull(),
    shipDate: text('ship_date').notNull(), // YYYY-MM-DD
    closeDate: text('close_date'),
    isPrinted: bool('is_printed').notNull().default(false),
    totalPackages: integer('total_packages').notNull().default(0),
    status: text('status', { enum: EOD_STATUSES }).notNull().default('Open'),
    reportFileId: text('report_file_id'),
    /** 1 for the first manifest of a carrier/day; a label after close opens sequence + 1. */
    sequence: integer('sequence').notNull().default(1),
    ...stamps(),
  },
  (t) => [uniqueIndex('eod_unique_idx').on(t.warehouseId, t.carrierConnectionId, t.shipDate, t.sequence)],
);

export const shipmentPlans = wmsSchema.table(
  'shipment_plans',
  {
    id: pk(),
    code: text('code').notNull(),
    warehouseId: text('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    clientId: text('client_id'),
    carrierConnectionId: text('carrier_connection_id'),
    truckPlateNumber: text('truck_plate_number'),
    loadingGateLocationId: text('loading_gate_location_id'),
    status: text('status', { enum: SHIPMENT_PLAN_STATUSES }).notNull().default('Open'),
    plannedShipmentAt: text('planned_shipment_at'),
    actualShipmentAt: text('actual_shipment_at'),
    loadingStartedAt: text('loading_started_at'),
    loadingCompletedAt: text('loading_completed_at'),
    truckDepartedAt: text('truck_departed_at'),
    expectedTotalVolume: doublePrecision('expected_total_volume').notNull().default(0),
    expectedTotalWeight: doublePrecision('expected_total_weight').notNull().default(0),
    preventLpnEditDuringLoading: bool('prevent_lpn_edit_during_loading').notNull().default(false),
    note: text('note'),
    customerId: text('customer_id'),
    customerAddressId: text('customer_address_id'),
    retailerId: text('retailer_id'),
    ...customFields(),
    ...stamps(),
  },
  (t) => [uniqueIndex('shipment_plan_code_idx').on(t.code)],
);

export const shipmentPlanOrders = wmsSchema.table(
  'shipment_plan_orders',
  {
    planId: text('plan_id')
      .notNull()
      .references(() => shipmentPlans.id, { onDelete: 'cascade' }),
    orderId: text('order_id')
      .notNull()
      .references(() => shipmentOrders.id),
    status: text('status', { enum: SHIPMENT_PLAN_STATUSES }).notNull().default('Open'),
    addedAt: text('added_at').notNull().$defaultFn(nowIso),
  },
  (t) => [primaryKey({ columns: [t.planId, t.orderId] }), index('spo_order_idx').on(t.orderId)],
);
