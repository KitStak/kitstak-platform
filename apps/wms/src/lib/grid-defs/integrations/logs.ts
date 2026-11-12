/** Channel Logs grids (M12, spec 06 §8–§11): Methods, History, Orders & Shipments, Products & Inventory. PURE. */
import { CHANNEL_JOB_STATUSES, CHANNEL_METHODS, CHANNEL_RUN_STATUSES } from '@/lib/enums';
import type { IntegrationField } from './common';

export const METHODS_GRID_KEY = 'channel-methods';
export const HISTORY_GRID_KEY = 'integration-logs';
export const ORDER_ITEMS_GRID_KEY = 'integration-orders';
export const PRODUCT_ITEMS_GRID_KEY = 'integration-products';

export const METHOD_FIELDS: readonly IntegrationField[] = [
  { field: 'provider', label: 'Channel', type: 'enum' },
  { field: 'method', label: 'Channel method', type: 'enum', options: CHANNEL_METHODS },
  { field: 'jobStatus', label: 'Job status', type: 'enum', options: CHANNEL_JOB_STATUSES },
  { field: 'status', label: 'Status', type: 'enum', options: ['Active', 'Passive'] },
  { field: 'storeName', label: 'Store name', type: 'text' },
];
export const METHOD_SORT_FIELDS = [
  'method',
  'storeName',
  'provider',
  'status',
  'nextRunAt',
  'lastRunAt',
  'intervalMinutes',
] as const;

export const HISTORY_FIELDS: readonly IntegrationField[] = [
  { field: 'provider', label: 'Channel', type: 'enum' },
  { field: 'method', label: 'Channel method', type: 'enum', options: CHANNEL_METHODS },
  { field: 'startedAt', label: 'Created date', type: 'date' },
  { field: 'storeName', label: 'Store name', type: 'text' },
  { field: 'status', label: 'Summary status', type: 'enum', options: CHANNEL_RUN_STATUSES },
];
export const HISTORY_SORT_FIELDS = [
  'storeName',
  'provider',
  'method',
  'startedAt',
  'status',
  'successCount',
  'errorCount',
  'totalCount',
] as const;

const ITEM_BASE: readonly IntegrationField[] = [
  { field: 'at', label: 'Call date', type: 'date' },
  { field: 'provider', label: 'Channel', type: 'enum' },
  { field: 'storeName', label: 'Store name', type: 'text' },
  { field: 'success', label: 'Successful', type: 'boolean' },
];
export const ORDER_ITEM_FIELDS: readonly IntegrationField[] = [
  ...ITEM_BASE,
  { field: 'method', label: 'Call method', type: 'enum', options: ['Download Orders', 'Send Shipment Info'] },
  { field: 'storeOrderNumber', label: 'Order number', type: 'text' },
];
export const PRODUCT_ITEM_FIELDS: readonly IntegrationField[] = [
  ...ITEM_BASE,
  { field: 'method', label: 'Call method', type: 'enum', options: ['Download Products', 'Sync Inventory'] },
  { field: 'sellerSku', label: 'Seller SKU', type: 'text' },
];
export const ITEM_SORT_FIELDS = [
  'at',
  'provider',
  'storeName',
  'method',
  'storeOrderNumber',
  'sellerSku',
  'qty',
  'success',
] as const;

/** Modal title per method (fixes Logiwa's "Downloaded Product Details" on every run). */
export const RUN_DETAIL_TITLE: Readonly<Record<(typeof CHANNEL_METHODS)[number], string>> = {
  'Download Orders': 'Downloaded Order Details',
  'Download Products': 'Downloaded Product Details',
  'Sync Inventory': 'Inventory Sync Details',
  'Send Shipment Info': 'Shipment Update Details',
};

/** "Simulate error" (one unknown-SKU order on demand) exists only for Download Orders on a simulated store (KitStak Sandbox or a demo feed). */
export const canSimulateError = (simulated: boolean, method: string): boolean =>
  simulated && method === 'Download Orders';

/** Shown wherever a store runs on the demo feed (live channel, no credentials saved yet). */
export const DEMO_FEED_NOTE =
  'Demo feed: no store credentials are saved yet, so this store runs on KitStak’s built-in demo feed (simulated orders for the client’s real SKUs). Add the store’s access token to switch to live syncing.';
