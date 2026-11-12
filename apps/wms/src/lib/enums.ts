/**
 * Shared domain enums. Pure data, safe to import from client and server code.
 *
 * Every `text(..., { enum })` column in `src/server/db/schema/**` takes its
 * value list from here so the DB layer, zod validators, grids and status pills
 * share a single source of truth. Lists only ever widen (BUILD_PLAN F1: schema
 * changes are additive).
 */

/* ---------------------------------------------------------------- outbound */
export const SO_STATUSES = [
  'Open',
  'Ready to Pick',
  'Picking Started',
  'Ready to Pack',
  'Packing Started',
  'Ready to Sort',
  'Sorting Started',
  'Ready to Load',
  'Loading Started',
  'Ready to Ship',
  'Shipped',
  'Partially Shipped',
  'Delivered',
  'Cancelled',
  'Shortage',
  'On Hold',
] as const;
export const PRIORITIES = ['None', 'Low', 'Medium', 'High', 'Urgent'] as const;
export const SHORT_STATUSES = ['None', 'Open', 'Resolved'] as const;
export const ADDRESS_TYPES = ['Residential', 'Commercial', 'Military'] as const;
export const TAX_TYPES = ['OTHER', 'VAT', 'TIN', 'IOSS', 'CNPJ/CPF', 'EORI', 'GST'] as const;
export const BILLING_PARTY_TYPES = ['Sender', 'Recipient', 'Third Party', 'Collect', 'Prepaid'] as const;
export const EXPORT_REASONS = [
  'Sale',
  'Gift',
  'Personal Effects',
  'Documents',
  'Sample',
  'Return',
  'Repair',
  'InterCompany',
  'Other',
] as const;
/** Legacy `shipment_orders.order_type` (kept; the lookup `order_type_id` is authoritative). */
export const ORDER_TYPES = ['D2C', 'B2B'] as const;
export const ORDER_CHANNELS = [
  'Shopify',
  'Amazon',
  'TikTok Shop',
  'Walmart',
  'Wholesale',
  'Manual',
  'ShipStation',
  'eBay',
  'Etsy',
  'WooCommerce',
  'BigCommerce',
] as const;
export const ADDRESS_VERIFICATION_STATUSES = [
  'Unverified',
  'Verified',
  'Partially Verified',
  'Failed',
  'Skipped',
] as const;
export const WORKFLOW_BLOCK_STATES = ['None', 'Fully', 'Partially'] as const;
export const SHORTAGE_REASONS = [
  'Insufficient Inventory',
  'No Eligible Stock Found',
  'Reserved For Replenishment',
] as const;

/* --------------------------------------------------------------- inventory */
export const INVENTORY_STATUSES = ['Stock', 'Allocated', 'Picked', 'Sorted', 'Packed', 'Loaded'] as const;
export const TXN_TYPES = [
  'Allocation',
  'Allocation Cancel',
  'Attributes Change',
  'Cancel Receiving',
  'Count',
  'Disassemble Kit',
  'Inventory Adjustment',
  'Inventory Movement',
  'Kitting',
  'Loading',
  'Packing',
  'Picking',
  'Receiving',
  'Replenishment',
  'Return Receiving',
  'Shipment',
  'Sorting',
  'Unloading',
] as const;
export const ALLOCATION_STATUSES = [
  'Allocated',
  'Picked',
  'Sorted',
  'Packed',
  'Loaded',
  'Shipped',
  'Cancelled',
] as const;
export const SERIAL_STATUSES = [
  'Received',
  'Picked',
  'Shipped',
  'Receipt Cancelled',
  'Shipment Order Cancelled',
  'Updated',
] as const;

/* ----------------------------------------------------------------- inbound */
export const RECEIVING_TYPES = [
  'Add Inventory',
  'DisassembleKit',
  'Kitting',
  'Product Receive',
  'Purchase Order',
  'Return',
] as const;
export const PO_STATUSES = ['Pending', 'Started', 'Receiving', 'Completed', 'Cancelled'] as const;
export const PO_TYPES = [
  'Purchase Order',
  'Purchase Order- Non Crossdock',
  'Transfer Order',
  'Return Order',
  'Open Order',
] as const;

/* -------------------------------------------------------------------- work */
export const OPERATION_TYPES = ['Picking', 'Count', 'Replenishment', 'Work Order'] as const;
/** "In Progress" is the legacy alias of "Started". */
export const JOB_STATUSES = ['Pending', 'Started', 'In Progress', 'Completed', 'Cancelled'] as const;
export const JOB_LABEL_STATUSES = ['No Label', 'Partially Labeled', 'Labeled'] as const;
export const PICK_LIST_STATUSES = ['Not Printed', 'Printed'] as const;
export const TASK_TYPES = [
  'Picking',
  'Packing',
  'Sorting',
  'Loading',
  'Count',
  'Replenishment',
  'Kitting',
] as const;
export const TASK_STATUSES = ['Pending', 'Started', 'Completed', 'Cancelled'] as const;
export const REPLENISHMENT_PHASES = [
  'Replenishment Pick Phase',
  'Replenishment Put Phase',
  'Direct Put',
] as const;
export const WAVE_OP_TYPES = ['Picking', 'AI Job', 'Cycle Count', 'Replenishment', 'Order Merge'] as const;
export const WAVE_STATUSES = [
  'Pending',
  'Preparing For Optimization',
  'Optimizing',
  'Optimization Completed',
  'Started',
  'In Progress',
  'Completed',
  'Failed',
] as const;
export const WAVE_DELETE_METHODS = ['None', 'At Specific Time', 'After Hours'] as const;
export const WAVE_ASSIGN_MODES = ['Pool', 'Roles', 'Users'] as const;
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const SORT_DIRECTIONS = ['asc', 'desc'] as const;

/* ------------------------------------------------------------------ counts */
export const COUNT_PLAN_STATUSES = [
  'Pending',
  'Ready To Count',
  'Count Started',
  'Count Completed',
  'Inventory Updated',
  'Cancelled',
] as const;
export const COUNT_LINE_STATUSES = [...COUNT_PLAN_STATUSES, 'Recount Created'] as const;
export const COUNT_TYPES = ['Location', 'LP', 'SKU'] as const;
export const COUNT_OPERATION_TYPES = ['Cycle Count', 'Instant Count'] as const;

/* ------------------------------------------------- kitting, returns, plans */
export const WORK_ORDER_STATUSES = ['Open', 'In Process', 'Completed', 'Shortage', 'Cancelled'] as const;
export const WORK_ORDER_TYPES = ['Work Order with Picking', 'Work Order without Picking'] as const;
export const RETURN_STATUSES = ['Pending', 'Started', 'In Transit', 'Completed', 'Cancelled'] as const;
export const RETURN_SOURCES = ['RMA', 'Manual', 'Loop Returns'] as const;
export const RETURN_DISPOSITIONS = ['Restock', 'Damaged', 'Quarantine', 'Dispose'] as const;
export const SHIPMENT_PLAN_STATUSES = [
  'Open',
  'In Progress',
  'Loading Started',
  'Loading Completed',
  'Shipped',
  'Cancelled',
] as const;

/* ---------------------------------------------------------------- facility */
export const LOCATION_TYPES = ['Racks', 'Shelves', 'Bins', 'Virtual', 'BusinessStation', 'Ramps'] as const;
/** Legacy `locations.type` role (kept; `location_type` + `area_type` are authoritative). */
export const LEGACY_LOCATION_ROLES = [
  'Picking',
  'Reserve',
  'Receiving',
  'Shipping',
  'Returns',
  'Damaged',
] as const;
export const AREA_TYPES = [
  'Picking',
  'Storage',
  'Receiving',
  'Returns',
  'Packing',
  'Shipment',
  'Kitting',
  'Loading',
] as const;
export const CAPACITY_TYPES = ['None', 'Maximum Unit Quantity', 'Maximum Pack Quantity'] as const;
export const ABC_CODES = ['None', 'A', 'B', 'C'] as const;
export const LP_STATUSES = ['Empty', 'Occupied', 'Shipped', 'Removed'] as const;
export const MOBILE_CART_STATUSES = ['Available', 'Occupied'] as const;
export const PACKAGE_REDUCTION_RULES = ['Packing Station', 'Specific Location', 'Any Location'] as const;

/* ------------------------------------------------------------------- units */
export const DIMENSION_UNITS = ['Inch', 'Foot', 'Centimeter', 'Meter'] as const;
export const WEIGHT_UNITS = ['Pound', 'Ounce', 'Kilogram', 'Gram'] as const;
export const VOLUME_UNITS = [
  'Cubic Inch',
  'Cubic Meter',
  'Cubic Foot',
  'Liter',
  'Gallon',
  'Cubic Centimeter',
] as const;
export const CURRENCIES = [
  'AUD',
  'CAD',
  'EUR',
  'INR',
  'IDR',
  'MYR',
  'MXN',
  'MAD',
  'NZD',
  'NGN',
  'PKR',
  'PHP',
  'GBP',
  'SGD',
  'THB',
  'TRY',
  'USD',
  'XOF',
] as const;
export const SCAN_METHODS = ['During Picking', 'During Packing'] as const;
export const DATE_FORMATS = [
  'yyyyMMdd',
  'ddMMyyyy',
  'MMddyyyy',
  'yyyy-MM-dd',
  'yyyy-dd-MM',
  'yyyy/MM/dd',
  'yyyy/dd/MM',
  'yyyy.MM.dd',
  'yyyy.dd.MM',
] as const;

/* ----------------------------------------------------------------- catalog */
export const PRODUCT_CATEGORIES = ['Product', 'Kit', 'Packaging Material'] as const;
export const KIT_TYPES = ['Kit to Order', 'Kit to Stock'] as const;
export const PACK_TYPE_KINDS = ['Primary', 'Hierarchical', 'Irregular'] as const;
export const REPLENISHMENT_STRATEGIES = ['Global', 'Per Warehouse'] as const;
export const SERIAL_METHODS = ['Both Receiving and Packing', 'Only Packing'] as const;
export const HAZMAT_TYPES = ['FR', 'EQ', 'LR', 'LQ', 'BATTERY', 'ORMD'] as const;

/* --------------------------------------------------------- identity / org */
export const LEGACY_USER_ROLES = ['admin', 'manager', 'operator', 'viewer'] as const;
export const USER_TYPES = ['Operation', 'Client', 'Owner'] as const;
export const ROLE_CATEGORIES = ['Operation', 'Client'] as const;
export const ROLE_RESTRICTIONS = ['carrier_cost', 'carrier_account_data', 'rate_shopping_data'] as const;
export const ACTIVE_STATUSES = ['Active', 'Inactive'] as const;
export const CLIENT_BILLING_PLANS = ['per-order', 'per-unit', 'monthly'] as const;
export const WAREHOUSE_TYPES = ['Internal', 'External'] as const;
export const ADDRESS_OWNER_TYPES = ['client', 'customer', 'vendor', 'retailer', 'warehouse'] as const;
export const ADDRESS_USAGE_TYPES = ['Shipping', 'Billing', 'Return'] as const;
export const NOTIFICATION_SEVERITIES = ['info', 'success', 'warning', 'error'] as const;
export const AUDIT_OUTCOMES = ['success', 'failure'] as const;
export const DENSITIES = ['Large', 'Small'] as const;
export const GRID_PAGE_SIZES = [100, 300, 500, 700, 1000] as const;

/* ---------------------------------------------------------------- platform */
export const LOOKUP_TYPES = [
  'po_type',
  'so_type',
  'order_merge_rule',
  'work_order_type',
  'damage_reason',
  'pack_type',
  'product_type',
  'product_group',
  'location_group',
  'location_zone',
  'vas_type',
  'mobile_cart_type',
  'packing_warning_type',
  'custom_carrier',
  'return_process',
  'adjustment_reason',
  'so_cancel_reason',
  'return_reason',
] as const;
export const CUSTOM_FIELD_SLOTS = [
  'textBox1',
  'textBox2',
  'textBox3',
  'dropDown1',
  'dropDown2',
  'date1',
  'date2',
  'date3',
  'toggle1',
  'toggle2',
] as const;
export type CustomFieldSlot = (typeof CUSTOM_FIELD_SLOTS)[number];
export type CustomFieldValues = Partial<Record<CustomFieldSlot, string | boolean | null>>;
export const CUSTOM_FIELD_ENTITIES = [
  'shipment_order',
  'purchase_order',
  'product',
  'location',
  'work_order',
  'lp_type',
  'shipment_package',
  'retailer',
  'shipment_plan',
  'client',
] as const;
export const CHANGE_TYPES = ['Create', 'Update', 'Delete'] as const;
export const TAG_SCOPES = [
  'shipment_order',
  'purchase_order',
  'return_order',
  'work_order',
  'listing',
  'any',
] as const;
export const ATTACHMENT_DOCUMENT_TYPES = [
  'GiftNote',
  'PackingInstruction',
  'PackingDocument',
  'Bill of Lading',
  'External',
  'Invoice',
  'Shipment Label',
  'Kitting Document',
  'Other',
] as const;
export const BG_TASK_KINDS = ['export', 'import', 'bulk', 'wave', 'report', 'print'] as const;
export const BG_TASK_STATUSES = ['queued', 'started', 'completed', 'error'] as const;
export const IMPORT_STATUSES = ['Processing', 'Successful', 'Partially Successful', 'Failed'] as const;
export const PRINT_RECORDS_PER_PAGE = ['Single Record', 'Multiple Records'] as const;
export const PRINT_MODES = ['Direct Print', 'PDF Preview', 'Report Preview'] as const;
export const PRINTER_TYPES = ['Label Printer', 'Laser Printer'] as const;
/** Grid query grammar filter ops (BUILD_PLAN 0.2), shared by saved filters and rule conditions. */
export const GRID_FILTER_OPS = [
  'in',
  'nin',
  'eq',
  'ct',
  'sw',
  'ew',
  'ex',
  'empty',
  'rng',
  'bool',
  'date',
] as const;
export const RULE_COMPARATORS = [
  'equals',
  'notEquals',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
  'in',
  'notIn',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'isEmpty',
  'isNotEmpty',
  // Relative date (value = date-spec grammar of server/query/date-presets: "today", "last7d", "withinNext30d", "mon", …).
  'dateIs',
] as const;

/* -------------------------------------------------------------- automation */
export const ALGORITHM_KINDS = ['Putaway', 'Allocation'] as const;
export const ACTIVE_PASSIVE = ['Active', 'Passive'] as const;
export const WORKFLOW_TRIGGERS = [
  'Shipment Order Created',
  'Shipment Order Imported',
  'Shipment Order Updated',
  'Purchase Order Created',
  'Order Shipped',
] as const;
export const WORKFLOW_ACTIONS = [
  'Block Order',
  'Partially Block Order',
  'Set Carrier Service',
  'Set Rate Shopping Preset',
  'Set Priority',
  'Add Tag',
  'Set Warehouse',
  'Set Shipment Package',
  'Set Order Type',
  'Add Note',
  'Notify Users',
] as const;
export const MATCH_MODES = ['All', 'Any'] as const;
export const RATE_SHOPPING_METHODS = ['Cheapest', 'Fastest', 'Cheapest In Time'] as const;

/* ------------------------------------------------------------ integrations */
export const CHANNEL_PROVIDERS = [
  'shopify',
  'shipstation',
  'amazon',
  'woocommerce',
  'tiktok',
  'magento',
  'walmart',
  'loop',
  'quickbooks',
  'cartrover',
  'squarespace',
  'amazonfba',
  'ebay',
  'bigcommerce',
  'etsy',
  'kitstaks-sandbox',
] as const;
export const CHANNEL_DISTRIBUTIONS = ['Public App', 'Custom App', 'API'] as const;
export const CHANNEL_AUTH_METHODS = ['Access Token', 'Client ID & Secret', 'OAuth'] as const;
export const CHANNEL_API_VERSIONS = ['Rest API', 'GraphQL'] as const;
export const CHANNEL_CONNECTION_STATUSES = ['Pending', 'Completed', 'Error'] as const;
export const CHANNEL_METHODS = [
  'Download Orders',
  'Download Products',
  'Sync Inventory',
  'Send Shipment Info',
] as const;
export const CHANNEL_JOB_STATUSES = ['Paused', 'Processing', 'Started', 'Waiting For Next'] as const;
export const CHANNEL_RUN_STATUSES = [
  'Processing',
  'Successful',
  'Partially Successful',
  'No Data',
  'Failed',
  'Unauthorized',
  'Already Processing',
] as const;
export const CHANNEL_MISSING_ORDER_STATUSES = ['Error', 'Retrying', 'Resolved'] as const;
export const CARRIER_PROVIDERS = [
  'ups',
  'fedex',
  'usps-stamps',
  'dhl',
  'easypost',
  'shippo',
  'shipstation',
  'custom',
  'kitstaks-sandbox',
] as const;
export const CARRIER_ENVIRONMENTS = ['Test', 'Production'] as const;
export const MARKUP_TYPES = ['Percentage', 'Fixed Price'] as const;
export const CARRIER_CALL_STEPS = ['LabelGeneration', 'RateCall', 'VoidLabel', 'Tracking', 'Pickup'] as const;
export const DESTINATION_TYPES = ['Domestic', 'International'] as const;
export const CALL_STATUSES = ['Success', 'Error'] as const;
export const LABEL_TYPES = ['Shipping Label', 'Return Label'] as const;
export const LABEL_STATUSES = ['Active', 'Voided'] as const;
export const LABEL_FORMATS = ['PDF', 'ZPL', 'EPL'] as const;
export const EOD_STATUSES = ['Open', 'Closed'] as const;

/* ----------------------------------------------------------------- billing */
export const BILLING_FREQUENCIES = [
  'Monthly',
  'Weekly',
  'Daily',
  'BiMonthly',
  'SemiMonthly',
  'BiWeekly',
] as const;
export const BILLING_APPROVAL_STATUSES = ['Draft', 'Approved'] as const;
export const BILLING_OPERATION_TYPES = [
  'Shipment',
  'Recurring',
  'VAS',
  'Pick & Pack',
  'Receiving',
  'Storage',
  'Return',
  'Work Order',
] as const;
export const BILLING_CALCULATION_TYPES = [
  'Daily Accumulation',
  'At Peak Inventory',
  'At Period End',
  'Distinct Period Count',
  'Average Calculation',
  'Split Month Storage',
] as const;
export const BILLING_CALC_STATUSES = ['Successful', 'Failed'] as const;
export const BILL_STATUSES = ['Draft', 'Approved', 'Canceled'] as const;
export const BILLING_INTEGRATION_STATUSES = ['Not Sent', 'Sent', 'Failed'] as const;
export const VAS_CALCULATION_TYPES = ['Total Price', 'Vas Quantity'] as const;
export const VAS_REFERENCE_ORDER_TYPES = ['Shipment Order', 'Purchase Order', 'Work Order'] as const;

/* ------------------------------------------------------------ type helpers */
type ValueOf<T extends readonly unknown[]> = T[number];
export type SoStatus = ValueOf<typeof SO_STATUSES>;
export type Priority = ValueOf<typeof PRIORITIES>;
export type InventoryStatus = ValueOf<typeof INVENTORY_STATUSES>;
export type TxnType = ValueOf<typeof TXN_TYPES>;
export type PoStatus = ValueOf<typeof PO_STATUSES>;
export type PoType = ValueOf<typeof PO_TYPES>;
export type OperationType = ValueOf<typeof OPERATION_TYPES>;
export type JobStatus = ValueOf<typeof JOB_STATUSES>;
export type TaskType = ValueOf<typeof TASK_TYPES>;
export type TaskStatus = ValueOf<typeof TASK_STATUSES>;
export type WaveStatus = ValueOf<typeof WAVE_STATUSES>;
export type CountPlanStatus = ValueOf<typeof COUNT_PLAN_STATUSES>;
export type CountLineStatus = ValueOf<typeof COUNT_LINE_STATUSES>;
export type WorkOrderStatus = ValueOf<typeof WORK_ORDER_STATUSES>;
export type ReturnStatus = ValueOf<typeof RETURN_STATUSES>;
export type ShipmentPlanStatus = ValueOf<typeof SHIPMENT_PLAN_STATUSES>;
export type LookupType = ValueOf<typeof LOOKUP_TYPES>;
export type CustomFieldEntity = ValueOf<typeof CUSTOM_FIELD_ENTITIES>;
export type GridFilterOp = ValueOf<typeof GRID_FILTER_OPS>;
export type RuleComparator = ValueOf<typeof RULE_COMPARATORS>;
export type Currency = ValueOf<typeof CURRENCIES>;
export type ChannelProvider = ValueOf<typeof CHANNEL_PROVIDERS>;
export type CarrierProvider = ValueOf<typeof CARRIER_PROVIDERS>;
export type BgTaskStatus = ValueOf<typeof BG_TASK_STATUSES>;
export type ImportStatus = ValueOf<typeof IMPORT_STATUSES>;

/** Type guard: narrows an arbitrary string to a member of an enum tuple. */
export function isOneOf<const T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}
