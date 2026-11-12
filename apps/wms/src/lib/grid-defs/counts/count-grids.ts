/**
 * Count grids (M07): Count Plan, Location Details and SKU Details field lists. PURE TS,
 * shared by the client filter builder and the `/api/counts*` grid-grammar path, so both
 * agree on every `f.<field>` / `sort=<field>` key.
 */
import { COUNT_LINE_STATUSES, COUNT_OPERATION_TYPES, COUNT_PLAN_STATUSES, COUNT_TYPES } from '@/lib/enums';

export const COUNT_PLANS_GRID_KEY = 'count-plans';
export const COUNT_LOCATIONS_GRID_KEY = 'count-locations';
export const COUNT_SKUS_GRID_KEY = 'count-skus';

export type CountGridFieldType = 'enum' | 'text' | 'number' | 'date' | 'boolean';

export interface CountGridField {
  readonly field: string;
  readonly label: string;
  readonly type: CountGridFieldType;
  /** Static enum choices; `warehouseId` choices come from the viewer's scope at runtime. */
  readonly options?: readonly string[];
  readonly decimals?: number;
}

/** Count Plan filters (Logiwa: Count Plan Code, Operation Type, Status, Type, Warehouse + KitStaks extras). */
export const COUNT_PLAN_FIELDS: readonly CountGridField[] = [
  { field: 'code', label: 'Count Plan Code', type: 'text' },
  {
    field: 'operationType',
    label: 'Count Plan Operation Type',
    type: 'enum',
    options: COUNT_OPERATION_TYPES,
  },
  { field: 'status', label: 'Count Plan Status', type: 'enum', options: COUNT_PLAN_STATUSES },
  { field: 'countType', label: 'Count Plan Type', type: 'enum', options: COUNT_TYPES },
  { field: 'warehouseId', label: 'Warehouse', type: 'enum' },
  { field: 'lockLocations', label: 'Lock Locations', type: 'boolean' },
  { field: 'isAi', label: 'AI Plan', type: 'boolean' },
  { field: 'createdByName', label: 'Created By', type: 'text' },
  { field: 'jobCodes', label: 'Job Code', type: 'text' },
  { field: 'scheduledAt', label: 'Scheduled Count Date', type: 'date' },
  { field: 'createdAt', label: 'Created Time', type: 'date' },
  { field: 'inventoryUpdatedAt', label: 'Inventory Updated Date Time', type: 'date' },
];

export const COUNT_PLAN_SORT_FIELDS = [
  'code',
  'warehouseCode',
  'jobCodes',
  'startedAt',
  'completedAt',
  'skuCount',
  'countedSkuCount',
  'locationCount',
  'countedLocationCount',
  'createdAt',
  'status',
  'countType',
  'isAi',
  'operationType',
  'createdByName',
  'scheduledAt',
  'inventoryUpdatedAt',
  'inventoryUpdatedByName',
] as const;

export const COUNT_PLAN_SEARCH_FIELDS = ['code'] as const;

/** Location / SKU Details filters (Logiwa §7–§8). */
const LINE_COMMON: readonly CountGridField[] = [
  { field: 'planCode', label: 'Count Plan Code', type: 'text' },
  { field: 'countUserName', label: 'Count User', type: 'text' },
  { field: 'difference', label: 'Difference', type: 'number', decimals: 2 },
  { field: 'isRecountLine', label: 'Recount Line', type: 'boolean' },
  { field: 'status', label: 'Status', type: 'enum', options: COUNT_LINE_STATUSES },
  { field: 'warehouseId', label: 'Warehouse', type: 'enum' },
  { field: 'operationType', label: 'Count Operation Type', type: 'enum', options: COUNT_OPERATION_TYPES },
  { field: 'jobCode', label: 'Job Code', type: 'text' },
  { field: 'completedAt', label: 'Count Completed Time', type: 'date' },
];

export const COUNT_LOCATION_FIELDS: readonly CountGridField[] = [
  ...LINE_COMMON,
  { field: 'locationCode', label: 'Location Code', type: 'text' },
  { field: 'recounted', label: 'Recounted Location', type: 'boolean' },
  { field: 'countType', label: 'Count Plan Type', type: 'enum', options: COUNT_TYPES },
];

export const COUNT_SKU_FIELDS: readonly CountGridField[] = [
  ...LINE_COMMON,
  { field: 'sku', label: 'Sku', type: 'text' },
  { field: 'locationCode', label: 'Location Code', type: 'text' },
  { field: 'recounted', label: 'Recounted SKU', type: 'boolean' },
];

export const COUNT_LINE_SORT_FIELDS = [
  'locationCode',
  'warehouseCode',
  'jobCode',
  'planCode',
  'operationType',
  'createdByName',
  'startedAt',
  'completedAt',
  'status',
  'skuCount',
  'approvedStockQty',
  'initialStockQty',
  'approvedCountQty',
  'countedQty',
  'isRecountLine',
  'recounted',
  'difference',
  'countUserName',
  'inventoryUpdatedAt',
  'inventoryUpdatedByName',
  'sku',
] as const;

export const COUNT_LOCATION_SEARCH_FIELDS = ['locationCode', 'planCode'] as const;
export const COUNT_SKU_SEARCH_FIELDS = ['sku', 'planCode'] as const;

/** Add Location modal filters (subset of Logiwa's list that KitStaks stores). */
export const COUNT_LOCATION_PICKER_FIELDS: readonly CountGridField[] = [
  { field: 'code', label: 'Code', type: 'text' },
  { field: 'abcCode', label: 'ABC Code', type: 'enum', options: ['A', 'B', 'C', 'None'] },
  { field: 'aisle', label: 'Aisle', type: 'text' },
  {
    field: 'areaType',
    label: 'Area Type',
    type: 'enum',
    options: ['Storage', 'Picking', 'Packing', 'Receiving', 'Shipment', 'Returns', 'Damaged', 'Staging'],
  },
  { field: 'column', label: 'Column', type: 'number' },
  { field: 'displayMember', label: 'Display Member', type: 'text' },
  { field: 'hasInventory', label: 'Has Inventory', type: 'boolean' },
  { field: 'height', label: 'Height', type: 'number', decimals: 2 },
  { field: 'level', label: 'Level', type: 'text' },
  { field: 'barcode', label: 'Location Barcode', type: 'text' },
  { field: 'locationGroup', label: 'Location Group', type: 'text' },
  { field: 'locationType', label: 'Location Type', type: 'text' },
  { field: 'zone', label: 'Location Zone', type: 'text' },
  { field: 'isLocked', label: 'Locked Location', type: 'boolean' },
  { field: 'walkingPathPriority', label: 'Path Priority', type: 'number' },
  { field: 'position', label: 'Position', type: 'text' },
  { field: 'preventAllocation', label: 'Prevent Allocation', type: 'boolean' },
  { field: 'rack', label: 'Rack', type: 'text' },
  { field: 'replenishmentType', label: 'Replenishment Type', type: 'enum', options: ['Source', 'Target'] },
  { field: 'volume', label: 'Volume', type: 'number', decimals: 2 },
  { field: 'width', label: 'Width', type: 'number', decimals: 2 },
  { field: 'length', label: 'Length', type: 'number', decimals: 2 },
  { field: 'capacityType', label: 'Capacity Type', type: 'text' },
  { field: 'maxCapacityQty', label: 'Max Capacity Qty', type: 'number' },
  { field: 'maxSkuQty', label: 'Max SKU Qty', type: 'number' },
  { field: 'mezzanine', label: 'Mezzanine', type: 'text' },
  { field: 'colorCode', label: 'Color Code', type: 'text' },
  { field: 'clientName', label: 'Client (dedicated)', type: 'text' },
  { field: 'singleClient', label: 'Single Client', type: 'boolean' },
  { field: 'onlyOneSku', label: 'Only One SKU', type: 'boolean' },
  { field: 'onlyOneLot', label: 'Only One Lot', type: 'boolean' },
  { field: 'onlyOneLp', label: 'Only One LP', type: 'boolean' },
  { field: 'onlyDamaged', label: 'Only Damaged', type: 'boolean' },
  { field: 'preventInventorySync', label: 'Prevent Inventory Sync', type: 'boolean' },
  { field: 'onHand', label: 'On Hand', type: 'number' },
  { field: 'skuCount', label: 'Number of SKU', type: 'number' },
  { field: 'customFields', label: 'Custom Fields (any value)', type: 'text' },
  { field: 'stockClientName', label: 'Client (has stock)', type: 'text' },
  { field: 'lastCountedAt', label: 'Last Counted Date', type: 'date' },
  { field: 'inOpenCount', label: 'In Another Open Count', type: 'boolean' },
];

/** Add Product modal filters. */
export const COUNT_PRODUCT_PICKER_FIELDS: readonly CountGridField[] = [
  { field: 'sku', label: 'Sku', type: 'text' },
  { field: 'barcode', label: 'Barcode', type: 'text' },
  { field: 'clientName', label: 'Client', type: 'text' },
  { field: 'createdAt', label: 'Created Date', type: 'date' },
  { field: 'fnsku', label: 'FNSKU', type: 'text' },
  { field: 'isFoldable', label: 'Foldable', type: 'boolean' },
  { field: 'isFragile', label: 'Fragile', type: 'boolean' },
  { field: 'isKit', label: 'Kit', type: 'boolean' },
  { field: 'name', label: 'Name', type: 'text' },
  { field: 'isOversized', label: 'Oversized', type: 'boolean' },
  { field: 'price', label: 'Price', type: 'number', decimals: 2 },
  { field: 'productGroup', label: 'Product Group', type: 'text' },
  { field: 'productType', label: 'Product Type', type: 'text' },
  { field: 'returnable', label: 'Returnable', type: 'boolean' },
  { field: 'shelfLifeDays', label: 'Shelf Life', type: 'number' },
  { field: 'isStackable', label: 'Stackable', type: 'boolean' },
  { field: 'status', label: 'Status', type: 'enum', options: ['Active', 'Inactive'] },
  { field: 'trackExpiry', label: 'Track Expiry Date', type: 'boolean' },
  { field: 'trackLot', label: 'Track Lot/Batch Number', type: 'boolean' },
  { field: 'trackProductionDate', label: 'Track Production Date', type: 'boolean' },
  { field: 'trackSerial', label: 'Track Serial Number', type: 'boolean' },
  { field: 'onHand', label: 'On Hand (this warehouse)', type: 'number' },
  { field: 'hasInventory', label: 'Has Inventory (this warehouse)', type: 'boolean' },
  { field: 'category', label: 'Category', type: 'text' },
  { field: 'isHazmat', label: 'Hazmat', type: 'boolean' },
  { field: 'trackSecondarySerial', label: 'Track Secondary Serial', type: 'boolean' },
  { field: 'customFields', label: 'Custom Fields (any value)', type: 'text' },
  { field: 'lastCountedAt', label: 'Last Counted Date', type: 'date' },
  { field: 'inOpenCount', label: 'In Another Open Count', type: 'boolean' },
];

/** Add License Plate modal filters (LP count type). */
export const COUNT_LP_PICKER_FIELDS: readonly CountGridField[] = [
  { field: 'number', label: 'LP Number', type: 'text' },
  { field: 'lpType', label: 'LP Type', type: 'text' },
  { field: 'locationCode', label: 'Location', type: 'text' },
  { field: 'clientName', label: 'Client', type: 'text' },
  { field: 'onHand', label: 'On Hand', type: 'number' },
  { field: 'skuCount', label: 'Num. of SKU', type: 'number' },
];

export const COUNT_PICKER_SORT_FIELDS = [
  'code',
  'zone',
  'aisle',
  'level',
  'walkingPathPriority',
  'sku',
  'name',
  'clientName',
  'onHand',
] as const;

export type CountType = (typeof COUNT_TYPES)[number];
export type CountOperationType = (typeof COUNT_OPERATION_TYPES)[number];

/** "More Details" export: one row per counted bucket (sent as the export's columns). */
export const COUNT_DETAIL_EXPORT_COLUMNS: readonly {
  key: string;
  label: string;
  type?: 'text' | 'integer' | 'datetime' | 'boolean';
}[] = [
  { key: 'planCode', label: 'Count Code' },
  { key: 'jobCode', label: 'Job Code' },
  { key: 'locationCode', label: 'Location' },
  { key: 'sku', label: 'SKU' },
  { key: 'productName', label: 'Product Name' },
  { key: 'lpNumber', label: 'LP' },
  { key: 'lotNumber', label: 'Lot/Batch Number' },
  { key: 'expiryDate', label: 'Expiry Date' },
  { key: 'packType', label: 'Pack Type' },
  { key: 'systemQty', label: 'System Qty', type: 'integer' },
  { key: 'countedQty', label: 'Counted Qty', type: 'integer' },
  { key: 'difference', label: 'Difference', type: 'integer' },
  { key: 'lineStatus', label: 'Line Status' },
  { key: 'isRecountLine', label: 'Recount Line', type: 'boolean' },
  { key: 'countedBy', label: 'Counted By' },
  { key: 'countedAt', label: 'Counted At', type: 'datetime' },
];

/** Permission keys (catalog: Inventory → Count Plans / Location Details / SKU Details; Mobile counts). */
export const COUNT_PERMISSIONS = {
  view: 'inventory.count_plans.view',
  create: 'inventory.count_plans.create',
  edit: 'inventory.count_plans.edit',
  delete: 'inventory.count_plans.delete',
  import: 'inventory.count_plans.import_file',
  cancel: 'inventory.count_plans.cancel',
  updateInv: 'inventory.count_plans.update_inv',
  createJob: 'inventory.count_plans.create_job',
  locView: 'inventory.count_location_details.view',
  locDelete: 'inventory.count_location_details.delete',
  locMore: 'inventory.count_location_details.more_details',
  locCancel: 'inventory.count_location_details.cancel',
  locRecount: 'inventory.count_location_details.create_recount',
  locUpdateInv: 'inventory.count_location_details.update_inv',
  skuView: 'inventory.count_sku_details.view',
  skuDelete: 'inventory.count_sku_details.delete',
  skuMore: 'inventory.count_sku_details.more_details',
  skuCancel: 'inventory.count_sku_details.cancel',
  skuRecount: 'inventory.count_sku_details.create_recount',
  skuUpdateInv: 'inventory.count_sku_details.update_inv',
  mobileCount: 'mobile.cycle_count.view',
  mobileCountUpdate: 'mobile.cycle_count.complete_count_and_update_inventory',
  mobileInstant: 'mobile.instant_count.create_new_instant_count',
  mobileInstantUpdate: 'mobile.instant_count.complete_count_and_update_inventory',
  /** Logiwa mobile Cycle Count: "Your jobs" (assigned to me) and "Job pool" (unassigned, Take job). */
  mobileYourJobs: 'mobile.cycle_count.view_your_jobs',
  mobileJobPool: 'mobile.cycle_count.view_job_pool',
} as const;

/**
 * Segregation of duties (four-eyes): a user may post a count variance they counted themselves only
 * when they also hold one of these supervisor permissions (Count Plans Delete: managers and admins by
 * default, never the default operator). Everyone else needs a second user to run Update Inv.
 */
export const COUNT_SELF_APPROVE_PERMISSIONS: readonly string[] = [COUNT_PERMISSIONS.delete];

/** Who may enter counts on the web Count Sheet. */
export const COUNT_EXECUTE_PERMISSIONS: readonly string[] = [
  COUNT_PERMISSIONS.edit,
  COUNT_PERMISSIONS.updateInv,
  COUNT_PERMISSIONS.mobileCount,
];
export const COUNT_ANY_VIEW: readonly string[] = [
  COUNT_PERMISSIONS.view,
  COUNT_PERMISSIONS.locView,
  COUNT_PERMISSIONS.skuView,
];
