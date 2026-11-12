/** Wave Rules, Wave Log, Allocation Exceptions, Shortage Report and Job Types grids. */
import { OPERATION_TYPES, PRIORITIES, SO_STATUSES, WAVE_OP_TYPES, WAVE_STATUSES } from '@/lib/enums';
import { field, opts, type GridSpec } from './shared';

export const WAVE_RULES_GRID: GridSpec = {
  gridKey: 'wave-rules',
  searchPlaceholder: 'Search by name',
  searchFields: ['name'],
  sortKeys: [
    'name',
    'warehouse',
    'scheduled',
    'status',
    'priority',
    'assignee',
    'operationType',
    'lastRunBy',
    'lastRunAt',
    'lastWaveNo',
    'nextRunAt',
  ],
  fields: [
    field('name', 'Wave rule name', 'text'),
    field('warehouse', 'Warehouse', 'text'),
    field('scheduled', 'Scheduled', 'boolean'),
    field('priority', 'Priority', 'enum', { options: opts(PRIORITIES) }),
    field('operationType', 'Operation type', 'enum', { options: opts(WAVE_OP_TYPES) }),
    field('lastRunBy', 'Last executed by', 'text'),
    field('lastRunAt', 'Last run', 'date'),
    field('lastWaveNo', 'Last wave ID', 'text'),
  ],
};

export const WAVE_LOG_GRID: GridSpec = {
  gridKey: 'wave-log',
  searchPlaceholder: 'Search by wave no',
  searchFields: ['waveNo'],
  sortKeys: [
    'ruleName',
    'waveNo',
    'status',
    'ordersMet',
    'shortageOrders',
    'jobsCreated',
    'allocatedOrders',
    'eliminatedOrders',
    'mergedOrders',
    'runAt',
    'runBy',
  ],
  fields: [
    field('ruleName', 'Rule set', 'text'),
    field('runAt', 'Run date', 'date'),
    field('status', 'Status', 'enum', { options: opts(WAVE_STATUSES) }),
    field('warehouse', 'Warehouse', 'text'),
    field('waveNo', 'Wave no', 'text'),
    field('runBy', 'Run by', 'text'),
  ],
};

export const ALLOCATION_EXCEPTIONS_GRID: GridSpec = {
  gridKey: 'allocation-exceptions',
  searchPlaceholder: 'Search by wave no',
  searchFields: ['waveNo'],
  sortKeys: [
    'orderCode',
    'waveNo',
    'waveRuleName',
    'algorithmRuleName',
    'shortageSku',
    'inventoryUomQty',
    'orderLineQty',
    'algorithmName',
    'explanation',
    'isRolledBack',
    'runBy',
    'runAt',
    'client',
    'warehouse',
  ],
  fields: [
    field('client', 'Client', 'text'),
    field('explanation', 'Explanation', 'text'),
    field('orderCode', 'Order number', 'text'),
    field('runBy', 'Run by user', 'text'),
    field('runAt', 'Run date', 'date'),
    field('warehouse', 'Warehouse', 'text'),
    field('waveRuleName', 'Wave ruleset name', 'text'),
    field('waveNo', 'Wave no', 'text'),
  ],
};

export const SHORTAGE_REASON_TIPS: Readonly<Record<string, string>> = {
  'Insufficient Inventory':
    'There is not enough free inventory in the warehouse to allocate this order line.',
  'No Eligible Stock Found':
    'Stock exists, but none of it is eligible for allocation (damaged, locked or in locations that prevent allocation).',
};

export const SHORTAGES_GRID: GridSpec = {
  gridKey: 'shortages',
  searchPlaceholder: 'Search by order code',
  searchFields: ['orderCode'],
  sortKeys: [
    'orderCode',
    'storeOrderNumber',
    'sku',
    'productName',
    'orderDate',
    'orderType',
    'reason',
    'missingTriggered',
    'orderStatus',
    'linePackQty',
    'packType',
    'shortageQty',
    'freeQty',
    'damagedQty',
    'onHandQty',
    'lastTrialAt',
    'warehouse',
    'client',
    'orderAge',
    'expectedShipDate',
    'masterOrderCode',
  ],
  fields: [
    field('client', 'Client', 'text'),
    field('expectedShipDate', 'Expected shipment date', 'date'),
    field('missingTriggered', 'Missing triggered', 'boolean'),
    field('onHandQty', 'On hand pack quantity', 'number'),
    field('orderCode', 'Order code', 'text'),
    field('orderDate', 'Order date', 'date'),
    field('sku', 'Product SKU', 'text'),
    field('shortageQty', 'Shortage pack quantity', 'number'),
    field('reason', 'Shortage reason', 'enum', { options: opts(Object.keys(SHORTAGE_REASON_TIPS)) }),
    field('orderStatus', 'Status', 'enum', { options: opts(SO_STATUSES) }),
    field('storeOrderNumber', 'Store order number', 'text'),
    field('warehouse', 'Warehouse', 'text'),
  ],
};

export const JOB_TYPES_GRID: GridSpec = {
  gridKey: 'job-types',
  searchPlaceholder: 'Search by code',
  searchFields: ['code'],
  sortKeys: ['code', 'description', 'warehouse', 'algorithm', 'operationType'],
  fields: [
    field('code', 'Code', 'text'),
    field('description', 'Description', 'text'),
    field('warehouse', 'Warehouse', 'text'),
    field('algorithm', 'Allocation algorithm', 'text'),
    field('operationType', 'Operation type', 'enum', { options: opts(OPERATION_TYPES) }),
  ],
};
