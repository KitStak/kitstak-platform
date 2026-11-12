/**
 * Receiving History grid (M05): 34 columns, 25 filters (Logiwa parity). Pure TS.
 */
import { PO_TYPES, RECEIVING_TYPES } from '@/lib/enums';
import type { ReceivingGridField } from './purchase-orders';
import { receivingTypeLabel } from './receiving-types';

export const RECEIVING_HISTORY_GRID_KEY = 'receiving-history';

export const DAMAGE_REASONS = [
  'Bad Packaging',
  'Broken',
  'Damaged',
  'Extra',
  'Leaking',
  'Missing',
  'OnHold',
  'Quarantined',
] as const;

export const RECEIPT_GRID_FIELDS: readonly ReceivingGridField[] = [
  { field: 'clientId', label: 'Client', type: 'enum', dynamicOptions: 'clients' },
  { field: 'damageReason', label: 'Damage reason', type: 'enum', options: DAMAGE_REASONS, allowEmpty: true },
  { field: 'expiryDate', label: 'Expiry date', type: 'date' },
  { field: 'masterId', label: 'ID', type: 'text' },
  { field: 'skuDetailsUpdated', label: 'Is SKU details updated?', type: 'boolean' },
  { field: 'locationCode', label: 'Location', type: 'text' },
  { field: 'lotNumber', label: 'Lot batch number', type: 'text' },
  { field: 'lpNumber', label: 'LP number', type: 'text' },
  { field: 'lpType', label: 'LP type', type: 'text' },
  { field: 'packType', label: 'Pack type', type: 'text' },
  { field: 'parentLpNumber', label: 'Parent LP number', type: 'text' },
  { field: 'parentLpType', label: 'Parent LP type', type: 'text' },
  { field: 'poCode', label: 'PO number', type: 'text' },
  { field: 'productName', label: 'Product name', type: 'text' },
  { field: 'productionDate', label: 'Production date', type: 'date' },
  { field: 'poType', label: 'Purchase order type', type: 'enum', options: PO_TYPES },
  { field: 'quantity', label: 'Quantity', type: 'number' },
  { field: 'receivedAt', label: 'Receiving date', type: 'date' },
  {
    field: 'type',
    label: 'Receiving type',
    type: 'enum',
    options: RECEIVING_TYPES,
    optionLabel: receivingTypeLabel,
  },
  { field: 'rmaNumber', label: 'RMA number', type: 'text' },
  { field: 'shipmentOrderCode', label: 'Shipment order code', type: 'text' },
  { field: 'sku', label: 'SKU', type: 'text' },
  { field: 'storeOrderNumber', label: 'Store order number', type: 'text' },
  { field: 'warehouseId', label: 'Warehouse', type: 'enum', dynamicOptions: 'warehouses' },
  { field: 'workOrderCode', label: 'Work order code', type: 'text' },
];

export const RECEIPT_SORT_FIELDS = [
  'masterId',
  'poCode',
  'poType',
  'sku',
  'productName',
  'barcode',
  'lotNumber',
  'expiryDate',
  'quantity',
  'packType',
  'uomPackType',
  'uomQuantity',
  'receivedAt',
  'type',
  'skuDetailsUpdated',
  'note',
  'lineNote',
  'actualReturnReason',
  'customerReturnReason',
  'clientName',
  'warehouseName',
  'locationCode',
  'workOrderCode',
  'shipmentOrderCode',
  'rmaNumber',
  'lpNumber',
  'lpType',
  'parentLpNumber',
  'parentLpType',
  'damageReason',
  'receivedBy',
  'productionDate',
] as const;

/** "Search by PO number" (plus SKU / master id for convenience). */
export const RECEIPT_SEARCH_FIELDS = ['poCode', 'sku', 'masterId'] as const;
