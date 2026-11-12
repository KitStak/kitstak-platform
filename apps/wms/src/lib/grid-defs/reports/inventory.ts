/**
 * Inventory-group report grids (spec 07): Serial Number Report (3 tabs), Dynamic
 * Replenishment, Inventory Snapshot.
 */
import { INVENTORY_STATUSES, PO_TYPES, RECEIVING_TYPES, SERIAL_STATUSES } from '@/lib/enums';
import { CLIENT_FIELD, WAREHOUSE_FIELD, bool, col, date, enumOf, num, text, type ReportDef } from './types';

const SERIAL_PERMISSION = 'reports.serial_number_tracking_report.view';
const SERIAL_HELPER =
  "The Serial Number Report helps you monitor both primary and secondary serial numbers' statuses in the system.";

export const SERIAL_TRACKING_DEF: ReportDef = {
  gridKey: 'report-serial-numbers',
  title: 'Serial Number Report',
  path: '/api/reports/serial-numbers',
  permission: SERIAL_PERMISSION,
  helper: SERIAL_HELPER,
  fields: [
    CLIENT_FIELD,
    date('entryAt', 'Entry Date Time'),
    text('primarySerial', 'Primary Serial Number'),
    text('sku', 'SKU'),
    text('secondarySerial', 'Secondary Serial Number'),
    enumOf('status', 'Serial Status', SERIAL_STATUSES),
    text('location', 'Location'),
    WAREHOUSE_FIELD,
  ],
  columns: [
    col('warehouse', 'Warehouse', { width: 190 }),
    col('client', 'Client', { width: 210 }),
    col('sku', 'SKU', { width: 170, hrefKey: 'productHref' }),
    col('productName', 'Product Name', { width: 260 }),
    col('primarySerial', 'Primary Serial Number', { width: 190, kind: 'mono', alwaysVisible: true }),
    col('secondarySerial', 'Secondary Serial Number', { width: 190, kind: 'mono' }),
    col('location', 'Current Location', {
      width: 140,
      hrefKey: 'locationHref',
      tip: 'Where the serial sits now (empty once shipped).',
    }),
    col('lastReference', 'Last Reference', {
      width: 140,
      hrefKey: 'referenceHref',
      tip: 'Receipt or shipment order that last moved this serial.',
    }),
    col('entryAt', 'Entry Date Time', { kind: 'datetime', width: 172 }),
    col('status', 'Serial Status', { kind: 'pill', width: 170 }),
  ],
  search: ['primarySerial', 'secondarySerial'],
  searchPlaceholder: 'Search by primary serial number',
  defaultSort: ['-entryAt'],
  rowKey: 'rowId',
};

export const SERIAL_SHIPMENTS_DEF: ReportDef = {
  gridKey: 'report-serial-shipments',
  title: 'Serial Number Shipment History',
  path: '/api/reports/serial-numbers/shipment-history',
  permission: SERIAL_PERMISSION,
  helper: SERIAL_HELPER,
  fields: [
    text('carrier', 'Carrier'),
    CLIENT_FIELD,
    date('expiryDate', 'Expiry Date', { dateOnly: true }),
    text('lpNumber', 'LP Number'),
    text('lotNumber', 'Lot Batch Number'),
    text('parentLp', 'Parent LP Number'),
    text('primarySerial', 'Primary Serial Number'),
    text('sku', 'SKU'),
    text('secondarySerial', 'Secondary Serial Number'),
    date('shippedAt', 'Shipment Date'),
    text('orderCode', 'Shipment Order Code'),
    text('storeOrderNumber', 'Store Order Number'),
    text('trackingNumber', 'Tracking Number'),
    WAREHOUSE_FIELD,
  ],
  columns: [
    col('sku', 'SKU', { width: 160, hrefKey: 'productHref' }),
    col('productName', 'Product Name', { width: 260 }),
    col('primarySerial', 'Primary Serial Number', { width: 190, kind: 'mono', alwaysVisible: true }),
    col('secondarySerial', 'Secondary Serial Number', { width: 190, kind: 'mono' }),
    col('orderCode', 'Shipment Order Code', { width: 160, hrefKey: 'orderHref', kind: 'strong' }),
    col('storeOrderNumber', 'Store Order Number', { width: 160 }),
    col('lotNumber', 'Lot Batch Number', { width: 140 }),
    col('expiryDate', 'Expiry Date', { kind: 'date', width: 120 }),
    col('packType', 'Pack Type', { width: 100 }),
    col('barcode', 'Barcode', { width: 130, kind: 'mono' }),
    col('shippedAt', 'Shipment Date Time', { kind: 'datetime', width: 172 }),
    col('orderType', 'Shipment Order Type', { width: 160 }),
    col('note', 'Note', { width: 180 }),
    col('warehouse', 'Warehouse', { width: 180 }),
    col('client', 'Client', { width: 210 }),
    col('location', 'Location', { width: 120 }),
    col('lpNumber', 'LP Number', { width: 120 }),
    col('parentLp', 'Parent LP', { width: 120 }),
    col('carrier', 'Carrier', { width: 120 }),
    col('trackingNumber', 'Tracking Number', { width: 190, kind: 'mono' }),
  ],
  search: ['primarySerial', 'secondarySerial'],
  searchPlaceholder: 'Search by primary serial number',
  defaultSort: ['-shippedAt'],
  rowKey: 'rowId',
};

export const SERIAL_RECEIPTS_DEF: ReportDef = {
  gridKey: 'report-serial-receipts',
  title: 'Serial Number Receiving History',
  path: '/api/reports/serial-numbers/receiving-history',
  permission: SERIAL_PERMISSION,
  helper: SERIAL_HELPER,
  fields: [
    CLIENT_FIELD,
    text('damageReason', 'Damage Reason'),
    date('expiryDate', 'Expiry Date', { dateOnly: true }),
    text('lpNumber', 'LP Number'),
    text('location', 'Location'),
    text('lotNumber', 'Lot Batch Number'),
    text('poCode', 'PO Number'),
    text('packType', 'Pack Type'),
    text('parentLp', 'Parent LP Number'),
    text('primarySerial', 'Primary Serial Number'),
    enumOf('poType', 'Purchase Order Type', PO_TYPES, { allowEmpty: true }),
    date('receivedAt', 'Receipt Date'),
    text('receiptId', 'Receipt ID'),
    text('receivedBy', 'Received By'),
    enumOf('receivingType', 'Receiving Type', RECEIVING_TYPES),
    text('sku', 'SKU'),
    text('secondarySerial', 'Secondary Serial Number'),
    text('vendor', 'Vendor Display Name'),
    WAREHOUSE_FIELD,
  ],
  columns: [
    col('receiptId', 'Receipt ID', { width: 130, kind: 'mono' }),
    col('sku', 'SKU', { width: 160, hrefKey: 'productHref' }),
    col('productName', 'Product Name', { width: 260 }),
    col('barcode', 'Barcode', { width: 130, kind: 'mono' }),
    col('poCode', 'Purchase Order Code', { width: 160, hrefKey: 'poHref', kind: 'strong' }),
    col('primarySerial', 'Primary Serial Number', { width: 190, kind: 'mono', alwaysVisible: true }),
    col('secondarySerial', 'Secondary Serial Number', { width: 190, kind: 'mono' }),
    col('lotNumber', 'Lot Batch Number', { width: 140 }),
    col('expiryDate', 'Expiry Date', { kind: 'date', width: 120 }),
    col('packType', 'Pack Type', { width: 100 }),
    col('receivingType', 'Receiving Type', { width: 140 }),
    col('receivedAt', 'Receiving Date', { kind: 'datetime', width: 172 }),
    col('poType', 'Purchase Order Type', { width: 170 }),
    col('note', 'Note', { width: 180 }),
    col('warehouse', 'Warehouse', { width: 180 }),
    col('client', 'Client', { width: 210 }),
    col('location', 'Location', { width: 120 }),
    col('lpNumber', 'LP Number', { width: 120 }),
    col('parentLp', 'Parent LP', { width: 120 }),
    col('damageReason', 'Damage Reason Name', { width: 160 }),
    col('receivedBy', 'Receiving User', { width: 160, kind: 'user' }),
    col('vendor', 'Vendor', { width: 170 }),
  ],
  search: ['primarySerial', 'secondarySerial'],
  searchPlaceholder: 'Search by primary serial number',
  defaultSort: ['-receivedAt'],
  rowKey: 'rowId',
};

export const TO_REPLENISH_TIP =
  'Max Replenishment Level + Open Order Quantity − Target Location Available Qty − Open Replenish Task Qty (never below 0).';

export const REPLENISHMENT_DEF: ReportDef = {
  gridKey: 'report-replenishment',
  title: 'Dynamic Replenishment Report',
  path: '/api/reports/replenishment',
  permission: 'reports.dynamic_replenishment_report.view',
  helper:
    'Shows how much stock each SKU needs moved from reserve storage into its picking locations to cover open orders and reach its max replenishment level.',
  fields: [
    CLIENT_FIELD,
    num('openOrderQty', 'Open Order Quantity'),
    text('sku', 'SKU'),
    bool('isActive', 'Show Only Active Products'),
    num('toReplenishQty', 'To Replenishment Quantity'),
    WAREHOUSE_FIELD,
  ],
  columns: [
    col('warehouse', 'Warehouse', { width: 190 }),
    col('client', 'Client', { width: 210 }),
    col('sku', 'SKU', { width: 170, hrefKey: 'productHref', alwaysVisible: true }),
    col('productName', 'Product Name', { width: 260 }),
    col('minLevel', 'Min Replenishment Level', { kind: 'number', width: 180 }),
    col('maxLevel', 'Max Replenishment Level', { kind: 'number', width: 180 }),
    col('sourceTotalQty', 'Source Location Total Quantity', {
      kind: 'number',
      width: 210,
      tip: 'On-hand units in reserve (non-pick) locations.',
    }),
    col('sourceFreeQty', 'Source Location Free Quantity', {
      kind: 'number',
      width: 210,
      tip: 'Reserve units that are neither allocated nor damaged — what a replenishment can move.',
    }),
    col('targetAvailableQty', 'Target Location Available Qty', {
      kind: 'number',
      width: 210,
      tip: 'Unallocated, undamaged units already in picking locations.',
    }),
    col('openOrderQty', 'Open Order Quantity', {
      kind: 'number',
      width: 160,
      tip: 'Units still to ship on open shipment orders.',
    }),
    col('openReplenishTaskQty', 'Open Replenish Task Qty', {
      kind: 'number',
      width: 180,
      tip: 'Planned quantity of pending or started replenishment tasks.',
    }),
    col('toReplenishQty', 'To Replenish Quantity', {
      kind: 'strong',
      width: 170,
      tip: TO_REPLENISH_TIP,
      exportType: 'integer',
    }),
  ],
  search: ['sku'],
  searchPlaceholder: 'Search by SKU',
  defaultSort: ['-toReplenishQty', 'sku'],
  rowKey: 'rowId',
};

/**
 * Rebuilding missed nightly snapshots from the ledger writes billing-relevant history, so it
 * needs warehouse edit rights on top of the report permission (M13 round 6).
 */
export const SNAPSHOT_BACKFILL_PERMISSION = 'settings.warehouse.edit';

export const SNAPSHOT_DEF: ReportDef = {
  gridKey: 'report-inventory-snapshot',
  title: 'Inventory Snapshot Report',
  path: '/api/reports/inventory-snapshot',
  permission: 'reports.inventory_snapshot_report.view',
  helper:
    'A copy of every non-empty inventory bucket, taken every night at 00:02 warehouse time (a night the server missed is rebuilt from the inventory ledger as of 00:02). Each warehouse counts once per business day, so a point-in-time check or billing reconciliation never double counts. Opens on the latest snapshot; filter on Snapshot Day for history.',
  fields: [
    CLIENT_FIELD,
    text('damageReason', 'Damage Reason'),
    date('expiryDate', 'Expiry Date', { dateOnly: true }),
    text('lpNumber', 'LP Number'),
    text('location', 'Location'),
    text('lotNumber', 'Lot Batch Number'),
    text('packType', 'Pack Type'),
    text('parentLp', 'Parent LP Number'),
    text('sku', 'Product SKU'),
    date('productionDate', 'Production Date', { dateOnly: true }),
    bool('latest', 'Latest Snapshot?', {
      description:
        "Yes = only each warehouse's most recent nightly snapshot (one per warehouse). Remove it and filter on Snapshot Day for history.",
    }),
    date('businessDate', 'Snapshot Day', {
      dateOnly: true,
      description:
        'The warehouse-local business day the snapshot belongs to. Exactly one snapshot per warehouse and day.',
    }),
    date('snapshotAt', 'Snapshot Date'),
    enumOf('status', 'Status', INVENTORY_STATUSES),
    text('uomPackType', 'UOM Pack Type'),
    WAREHOUSE_FIELD,
  ],
  columns: [
    col('warehouse', 'Warehouse', { width: 190 }),
    col('client', 'Client', { width: 210 }),
    col('businessDate', 'Snapshot Day', {
      kind: 'date',
      width: 156,
      tip: 'Warehouse-local business day. One snapshot per warehouse and day: when a night ran twice (catch-up), only the later run counts.',
    }),
    col('snapshotAt', 'Snapshot Date', {
      kind: 'datetime',
      width: 164,
      tip: 'When the snapshot was actually taken.',
    }),
    col('sku', 'SKU', { width: 170, hrefKey: 'productHref', alwaysVisible: true }),
    col('location', 'Location', { width: 130, hrefKey: 'locationHref' }),
    col('lpNumber', 'LP Number', { width: 120 }),
    col('uomQty', 'UOM Qty', { kind: 'number', width: 100 }),
    col('packQty', 'Pack Qty', {
      kind: 'number',
      width: 110,
      tip: "Whole packs of the bucket's pack type. Equals UOM Qty for Each buckets.",
    }),
    col('lotNumber', 'Lot Batch Number', { width: 140 }),
    col('expiryDate', 'Expiry Date', { kind: 'date', width: 120 }),
    col('damageReason', 'Damage Reason', { width: 140 }),
    col('parentLp', 'Parent LP Number', { width: 140 }),
    col('uomPackType', 'UOM Pack Type', { width: 120 }),
    col('packType', 'Pack Type', { width: 100 }),
    col('status', 'Inventory Status', { kind: 'pill', width: 130 }),
    col('productHeight', 'Product Height', { kind: 'decimal', width: 120 }),
    col('productLength', 'Product Length', { kind: 'decimal', width: 120 }),
    col('productWeight', 'Product Weight', { kind: 'decimal', width: 120 }),
    col('productWidth', 'Product Width', { kind: 'decimal', width: 120 }),
    col('latest', 'Latest Snapshot?', { kind: 'yesNo', width: 120, defaultHidden: true }),
  ],
  search: ['sku'],
  searchPlaceholder: 'Search by SKU',
  defaultSort: ['-businessDate', 'warehouse', 'sku'],
  rowKey: 'rowId',
};

/**
 * Default chip "Latest Snapshot? — Yes": exactly one nightly snapshot per warehouse (Logiwa's
 * "Within 1 Day Past" also returns one run). A date window can straddle two nightly runs, so it
 * is no longer the default; Snapshot Day still takes the "Within N Day(s) Past" preset.
 */
export const SNAPSHOT_DEFAULT_FILTER = 'f.latest=bool:true';
