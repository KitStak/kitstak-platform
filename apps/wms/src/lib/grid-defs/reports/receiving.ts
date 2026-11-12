/** Receiving + Warehouse Efficiency report grids: PO Receiving (spec 03/07), User Performance (spec 07). */
import { CLIENT_FIELD, WAREHOUSE_FIELD, bool, col, date, enumOf, num, text, type ReportDef } from './types';

export const PO_RECEIVING_DEF: ReportDef = {
  gridKey: 'report-po-receiving',
  title: 'PO Receiving Report',
  path: '/api/reports/po-receiving',
  permission: 'reports.po_receiving_report.view',
  helper:
    'The PO Receiving Report shows the history of your received purchase orders based on the quantity you have received.',
  fields: [
    CLIENT_FIELD,
    num('damagedQty', 'Damaged Quantity'),
    bool('hasDifference', 'Has Difference?'),
    num('poQty', 'PO Quantity'),
    num('poUomQty', 'PO UOM Quantity'),
    text('poCode', 'PO Code'),
    text('packType', 'Pack Type'),
    text('productName', 'Product Name'),
    text('sku', 'Product SKU'),
    num('difference', 'Receiving Difference'),
    num('receivedUomQty', 'Received UOM Quantity'),
    enumOf('poStatus', 'PO Status', ['Pending', 'Started', 'Receiving', 'Completed', 'Cancelled']),
    WAREHOUSE_FIELD,
  ],
  columns: [
    // The quantities the report exists for come first so they are visible at 1440 px;
    // descriptive columns follow.
    col('poCode', 'PO Code', { width: 130, hrefKey: 'poHref', alwaysVisible: true, kind: 'strong' }),
    col('sku', 'SKU', { width: 160, hrefKey: 'productHref' }),
    col('packType', 'Pack Type', { width: 100 }),
    col('poQty', 'PO Quantity', {
      kind: 'number',
      width: 150,
      tip: "Ordered quantity in the line's pack type.",
    }),
    col('unitsPerPack', 'Units per Pack', {
      kind: 'number',
      width: 130,
      defaultHidden: true,
      tip: "Units per pack from the product's pack-type hierarchy (Each = 1).",
    }),
    col('poUomQty', 'PO UOM Quantity', {
      kind: 'number',
      width: 150,
      tip: "PO Quantity × units per pack of the line's pack type, from the product's pack-type hierarchy.",
    }),
    col('receivedUomQty', 'Received UOM Quantity', {
      kind: 'number',
      width: 180,
      tip: 'UOM-equivalent of everything received on the line (cancelled receipts excluded), compared against the PO UOM Quantity.',
    }),
    col('difference', 'Receiving Difference', {
      kind: 'diff',
      width: 170,
      tip: 'Received UOM Quantity − PO UOM Quantity. Red = short, green = over. Blank when they match.',
    }),
    col('poStatus', 'PO Status', { width: 120, kind: 'pill', pill: 'purchaseOrder' }),
    col('damagedQty', 'Damaged Quantity', { kind: 'number', width: 150 }),
    col('productName', 'Product Name', { width: 260 }),
    col('warehouse', 'Warehouse', { width: 190 }),
    col('client', 'Client', { width: 210 }),
    col('barcode', 'Barcode', { width: 130, kind: 'mono' }),
  ],
  search: ['poCode'],
  searchPlaceholder: 'Search by PO number',
  defaultSort: ['-poCode', 'sku'],
  rowKey: 'rowId',
};

export const USER_PERFORMANCE_PERIODS = ['Last 7 days', 'Last 30 days', 'Last 90 days'] as const;

const metric = (id: string, label: string, tip: string) =>
  col(id, label, { kind: 'number', width: Math.max(130, label.length * 8 + 40), tip });

export const USER_PERFORMANCE_DEF: ReportDef = {
  gridKey: 'report-user-performance',
  title: 'User Performance Report',
  path: '/api/reports/user-performance',
  permission: 'reports.user_performance_report.view',
  helper:
    'The User Performance Report summarizes user performance according to assigned tasks, so you can monitor your team in a selected period.',
  fields: [
    date('activityDate', 'Activity Date', { dateOnly: true }),
    enumOf('period', 'Period', USER_PERFORMANCE_PERIODS),
    text('user', 'User'),
    WAREHOUSE_FIELD,
  ],
  columns: [
    col('warehouse', 'Warehouse', { width: 190 }),
    col('user', 'User', { width: 180, kind: 'user', alwaysVisible: true }),
    col('activityDate', 'Activity Date', { kind: 'date', width: 130 }),
    metric(
      'pickedOrderQty',
      'Picked Order Qty',
      'Distinct orders with a picking task completed by the user that day.',
    ),
    metric('pickedLineQty', 'Picked Order Line Qty', 'Distinct order lines picked by the user that day.'),
    metric('pickedItemQty', 'Picked Item Qty', 'Units picked (actual quantity of completed picking tasks).'),
    metric(
      'packedOrderQty',
      'Packed Order Qty',
      'Distinct orders with a packing task completed by the user.',
    ),
    metric('packedLineQty', 'Packed Order Line Qty', 'Distinct order lines packed by the user.'),
    metric('packedItemQty', 'Packed Item Qty', 'Units packed (actual quantity of completed packing tasks).'),
    metric(
      'replenishedItemQty',
      'Replenished Item Quantity',
      'Units moved by completed replenishment tasks.',
    ),
    metric(
      'replenishedLpQty',
      'Replenished LP Quantity',
      'Distinct LPs moved by completed replenishment tasks.',
    ),
    metric(
      'receivedItemQty',
      'Received Item Quantity',
      'UOM units received (non-cancelled receipts) by the user.',
    ),
    metric('sortedOrderQty', 'Sorted Order Qty', 'Distinct orders sorted by the user.'),
    metric('sortedLineQty', 'Sorted Order Line Qty', 'Distinct order lines sorted by the user.'),
    metric('sortedItemQty', 'Sorted Item Qty', 'Units sorted (completed sorting tasks).'),
    metric('receivedLpQty', 'Received LP Quantity', 'Distinct LPs received into by the user.'),
    metric('countedItemQty', 'Counted Item Quantity', 'Units counted on count entries the user submitted.'),
    metric('countedLocationQty', 'Counted Location', 'Distinct locations the user counted.'),
    metric('returnedItemQty', 'Returned Item Quantity', 'Units received back on return orders by the user.'),
    metric('returnedOrderQty', 'Returned Order Quantity', 'Distinct return orders the user received.'),
    metric('taskQty', 'Tasks', 'Completed pick, pack, sort and replenishment tasks that day.'),
    col('timedTaskPct', 'Timed Tasks %', {
      kind: 'decimal',
      width: 140,
      tip: "Share of the day's tasks with a recorded start and finish scan. The rest have only a finish time, so their duration is inferred from the gap since the previous task.",
    }),
    col('timedMinutes', 'Timed Minutes', {
      kind: 'decimal',
      width: 140,
      tip: 'Minutes between start and finish scans on timed tasks (each task capped at 30 min).',
    }),
  ],
  search: ['user'],
  searchPlaceholder: 'Search by executed name',
  defaultSort: ['-activityDate', 'user'],
  rowKey: 'rowId',
};

/** Default chip "Period: Last 7 days". */
export const USER_PERFORMANCE_DEFAULT_FILTER = 'f.period=in:Last%207%20days';

/** Period label → days back. */
export const PERIOD_DAYS: Readonly<Record<string, number>> = {
  'Last 7 days': 7,
  'Last 30 days': 30,
  'Last 90 days': 90,
};
