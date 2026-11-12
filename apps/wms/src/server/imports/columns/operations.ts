/** Template columns for operational imports (orders, POs, inventory, counts, work orders). PURE. */
import type { ImportColumn } from '../types';
import { addressColumns, bool, date, int, num, oneOf, req, text } from './helpers';

const PRIORITY = ['Low', 'Medium', 'High'] as const;

export const SHIPMENT_ORDER_COLUMNS: readonly ImportColumn[] = [
  req('orderCode', 'Order Code', 'SO-IMPORT-1001', { description: 'Rows with the same code form one order' }),
  req('clientCode', 'Client Code', 'ACME'),
  req('warehouseCode', 'Warehouse Code', 'MLT1'),
  text('storeOrderNumber', 'Store Order Number', '1001'),
  text('channel', 'Channel', 'Manual'),
  date('orderDate', 'Order Date', '2026-11-05'),
  date('expectedShipDate', 'Expected Shipment Date', '2026-11-07'),
  oneOf('priority', 'Priority', PRIORITY),
  text('carrier', 'Carrier', 'UPS'),
  text('shippingService', 'Shipping Service', 'Ground'),
  ...addressColumns('shipTo', 'Ship To'),
  req('sku', 'SKU', 'WIDGET-RED'),
  int('quantity', 'Quantity', '2', { required: true, min: 1 }),
  num('unitPrice', 'Unit Price', '19.99'),
  text('packType', 'Pack Type', 'Each'),
  bool('isGift', 'Is Gift'),
  text('notes', 'Notes', 'Leave at front desk', { maxLength: 1000 }),
];

export const SHIPMENT_ORDER_UPDATE_COLUMNS: readonly ImportColumn[] = [
  req('orderCode', 'Order Code', 'SO000123'),
  oneOf('priority', 'Priority', PRIORITY),
  date('expectedShipDate', 'Expected Shipment Date', '2026-11-07'),
  text('carrier', 'Carrier', 'UPS'),
  text('shippingService', 'Shipping Service', 'Ground'),
  ...addressColumns('shipTo', 'Ship To'),
  text('notes', 'Notes', 'Updated by import', { maxLength: 1000 }),
];

export const SO_SERIAL_COLUMNS: readonly ImportColumn[] = [
  req('orderCode', 'Order Code', 'SO000123'),
  req('sku', 'SKU', 'PHONE-128'),
  req('serialNumber', 'Serial Number', 'SN-0001-ABC'),
];

export const PURCHASE_ORDER_COLUMNS: readonly ImportColumn[] = [
  req('poCode', 'PO Code', 'PO-IMPORT-2001', { description: 'Rows with the same code form one PO' }),
  req('clientCode', 'Client Code', 'ACME'),
  req('warehouseCode', 'Warehouse Code', 'MLT1'),
  req('vendorName', 'Vendor Name', 'Global Supply Co.'),
  text('vendorCode', 'Vendor Code', 'GSC'),
  text('poType', 'PO Type', 'Standard'),
  date('expectedDate', 'Expected Receiving Date', '2026-11-12'),
  text('referenceNumber', 'Reference Number', 'REF-77'),
  req('sku', 'SKU', 'WIDGET-RED'),
  int('quantity', 'Quantity', '100', { required: true, min: 1 }),
  num('unitCost', 'Unit Cost', '4.25'),
  text('packType', 'Pack Type', 'Each'),
  text('lotNumber', 'Lot Number', 'LOT-2026-11'),
  date('expiryDate', 'Expiry Date', '2027-11-01'),
  text('notes', 'Notes', '', { maxLength: 1000 }),
];

export const PO_SERIAL_COLUMNS: readonly ImportColumn[] = [
  req('poCode', 'PO Code', 'PO000045'),
  req('sku', 'SKU', 'PHONE-128'),
  req('serialNumber', 'Serial Number', 'SN-0001-ABC'),
];

export const INVENTORY_COLUMNS: readonly ImportColumn[] = [
  req('warehouseCode', 'Warehouse Code', 'MLT1'),
  req('clientCode', 'Client Code', 'ACME'),
  req('sku', 'SKU', 'WIDGET-RED'),
  req('locationCode', 'Location Code', 'A-01-01-01'),
  int('quantity', 'Quantity', '25', { required: true, min: 1 }),
  text('packType', 'Pack Type', 'Each'),
  text('lpNumber', 'LP Number', 'LP000101'),
  text('lotNumber', 'Lot Number', 'LOT-2026-11'),
  date('expiryDate', 'Expiry Date', '2027-11-01'),
  date('productionDate', 'Production Date', '2026-10-01'),
  oneOf('status', 'Status', ['Stock', 'Damaged', 'Quarantine']),
  text('damageReason', 'Damage Reason', ''),
];

export const COUNT_LOCATION_COLUMNS: readonly ImportColumn[] = [
  req('planName', 'Count Plan Name', 'Aisle A cycle count'),
  req('warehouseCode', 'Warehouse Code', 'MLT1'),
  text('jobType', 'Job Type', 'Cycle Count'),
  date('plannedDate', 'Planned Date', '2026-11-10'),
  req('locationCode', 'Location Code', 'A-01-01-01'),
  bool('blindCount', 'Blind Count', 'Yes'),
];

export const COUNT_SKU_COLUMNS: readonly ImportColumn[] = [
  req('planName', 'Count Plan Name', 'Top sellers count'),
  req('warehouseCode', 'Warehouse Code', 'MLT1'),
  req('clientCode', 'Client Code', 'ACME'),
  text('jobType', 'Job Type', 'Cycle Count'),
  date('plannedDate', 'Planned Date', '2026-11-10'),
  req('sku', 'SKU', 'WIDGET-RED'),
  bool('blindCount', 'Blind Count', 'Yes'),
];

export const WORK_ORDER_COLUMNS: readonly ImportColumn[] = [
  req('workOrderCode', 'Work Order Code', 'WO-IMPORT-1'),
  req('warehouseCode', 'Warehouse Code', 'MLT1'),
  req('clientCode', 'Client Code', 'ACME'),
  oneOf('type', 'Type', ['Kit', 'Disassemble'], { required: true }),
  req('kitSku', 'Kit SKU', 'GIFT-BOX-1'),
  int('quantity', 'Quantity', '10', { required: true, min: 1 }),
  date('dueDate', 'Due Date', '2026-11-15'),
  oneOf('priority', 'Priority', PRIORITY),
  text('notes', 'Notes', '', { maxLength: 1000 }),
];
