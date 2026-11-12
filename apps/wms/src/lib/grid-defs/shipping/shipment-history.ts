/**
 * Shipment History grid (`/shipments/history`, gridKey `shipment-history`): one row per
 * ledger Shipment / remove-inventory transaction (SKU × lot × LPN). 32 Logiwa columns,
 * 19 filters.
 */
import { optionsOf, type ShippingField } from './common';

export const SHIPMENT_HISTORY_GRID_KEY = 'shipment-history';

export const SHIPMENT_TYPES = ['Shipment Order', 'Remove Inventory'] as const;

export const SHIPMENT_HISTORY_FIELDS: readonly ShippingField[] = [
  { field: 'shipmentDate', label: 'Shipment date', type: 'date' },
  { field: 'shipmentType', label: 'Shipment type', type: 'enum', options: optionsOf(SHIPMENT_TYPES) },
  { field: 'orderCode', label: 'Order code', type: 'text' },
  { field: 'reference', label: 'Reference (order or adjustment code)', type: 'text' },
  { field: 'adjustmentReason', label: 'Adjustment reason', type: 'text' },
  { field: 'originalOrderCode', label: 'Original shipment order code', type: 'text' },
  { field: 'storeOrderNumber', label: 'Store order number', type: 'text' },
  { field: 'sku', label: 'Product SKU', type: 'text' },
  { field: 'productName', label: 'Product name', type: 'text' },
  { field: 'lotNumber', label: 'Lot batch number', type: 'text' },
  { field: 'expiryDate', label: 'Expiry date', type: 'date' },
  { field: 'trackingNumber', label: 'Tracking number', type: 'text' },
  { field: 'quantity', label: 'Quantity', type: 'number' },
  { field: 'packType', label: 'Pack type', type: 'text' },
  { field: 'poNumber', label: 'Purchase order number', type: 'text' },
  { field: 'clientName', label: 'Client', type: 'text', facet: 'clients' },
  { field: 'warehouseCode', label: 'Warehouse', type: 'text', facet: 'warehouses' },
  { field: 'locationCode', label: 'Location', type: 'text' },
  { field: 'lpNumber', label: 'LP number', type: 'text' },
  { field: 'parentLpNumber', label: 'Parent LP number', type: 'text' },
  { field: 'parentLpType', label: 'Parent LP type', type: 'text' },
];

export const SHIPMENT_HISTORY_SORT_FIELDS = [
  'orderCode',
  'originalOrderCode',
  'storeOrderNumber',
  'sku',
  'productName',
  'barcode',
  'poNumber',
  'lotNumber',
  'trackingNumber',
  'expiryDate',
  'quantity',
  'packType',
  'uomPackType',
  'shipmentPackage',
  'kitSku',
  'retailerName',
  'packageWeight',
  'masterOrderCode',
  'isBackOrder',
  'shipmentDate',
  'shipmentType',
  'note',
  'clientName',
  'warehouseCode',
  'locationCode',
  'lpNumber',
  'originalLpNumber',
  'originalParentLp',
  'parentLpNumber',
  'parentLpType',
  'receivingDate',
  'productionDate',
  'reference',
  'adjustmentReason',
] as const;

export const SHIPMENT_HISTORY_SEARCH_FIELDS = [
  'orderCode',
  'reference',
  'sku',
  'trackingNumber',
  'storeOrderNumber',
] as const;
