/**
 * Shipment Orders grid definitions (BUILD_PLAN M01). PURE TypeScript, shared by the
 * client (columns, filter builder, chips) and the server (`orders-grid.ts` maps every
 * key to SQL; `orders-export.ts` uses the export columns).
 *
 * Keys are the `f.<field>` / `sort=<field>` names of the grid grammar.
 */
import {
  ADDRESS_VERIFICATION_STATUSES,
  ORDER_CHANNELS,
  PRIORITIES,
  SHORT_STATUSES,
  SO_STATUSES,
  type SoStatus,
} from "@/lib/enums";

export const SHIPMENT_ORDERS_GRID_KEY = "orders-backlog";
export const SHIPPED_ORDERS_GRID_KEY = "orders-shipped";

export const ORDER_VIEWS = ["backlog", "shipped"] as const;
export type OrderView = (typeof ORDER_VIEWS)[number];

/** Statuses on the Shipped & Canceled tab. */
export const SHIPPED_VIEW_STATUSES: readonly SoStatus[] = ["Shipped", "Partially Shipped", "Delivered", "Cancelled"];
/** Fully closed statuses: only on Shipped & Canceled. */
export const CLOSED_ORDER_STATUSES: readonly SoStatus[] = ["Shipped", "Delivered", "Cancelled"];
/**
 * Backlog: every status that still has work left. Partially Shipped is on both tabs, as in
 * Logiwa: it has shipped packages (RMA / return info) and units still to ship.
 */
export const BACKLOG_VIEW_STATUSES: readonly SoStatus[] = SO_STATUSES.filter((s) => !CLOSED_ORDER_STATUSES.includes(s));
export const BACKLOG_STATUS_NOTE = "Shipped, Delivered and Cancelled orders are on the Shipped & Canceled tab.";

export const ORDER_CHANNEL_VALUES = ORDER_CHANNELS;

/* ------------------------------------------------------------------ fields */

export type OrderFieldType = "enum" | "text" | "number" | "date" | "boolean";

export interface OrderFieldOption {
  readonly value: string;
  readonly label: string;
}

/**
 * One filter field. `dynamic` enums get their options at runtime (clients, warehouses,
 * tags, lookups); everything else is static.
 */
export interface OrderFilterField {
  readonly field: string;
  readonly label: string;
  readonly type: OrderFieldType;
  readonly options?: readonly OrderFieldOption[];
  readonly dynamic?: "client" | "warehouse" | "tag" | "orderType" | "retailer" | "carrier";
  readonly decimals?: number;
  readonly allowEmpty?: boolean;
  readonly group?: string;
  readonly description?: string;
}


const ACRONYMS = new Set(["SKU", "BOL", "PRO", "PO", "UCC", "ID", "ATP", "D2C", "B2B", "(Region)"]);

/** "Actual Shipment Date" -> "Actual shipment date" (acronyms keep their case). */
export function sentenceCase(label: string): string {
  return label.split(" ").map((word, i) => (i === 0 || ACRONYMS.has(word) ? word : word.toLowerCase())).join(" ").replace("(region)", "(Region)");
}

const opts = (values: readonly string[]): readonly OrderFieldOption[] => values.map((value) => ({ value, label: value }));
const YES_NO_GROUP = "Flags";
const CUSTOM_GROUP = "Custom fields";

/** The 67 Logiwa filter fields (references/logiwa-spec/01-orders.md §1). */
const RAW_FILTER_FIELDS: readonly OrderFilterField[] = [
  { field: "shippedAt", label: "Actual Shipment Date", type: "date", description: "Cancelled orders use their cancel date" },
  { field: "addressVerificationStatus", label: "Address Verification Status", type: "enum", options: opts(ADDRESS_VERIFICATION_STATUSES) },
  { field: "age", label: "Age", type: "number", description: "Days from the order date to shipment (or today while open)" },
  { field: "daysSinceShipped", label: "Days Since Shipped", type: "number", description: "Days since the order shipped or was cancelled" },
  { field: "bol", label: "BOL", type: "text" },
  { field: "cancelledAt", label: "Cancel Date", type: "date" },
  { field: "canceledByMerge", label: "Canceled By Merge", type: "boolean", group: YES_NO_GROUP },
  { field: "carrier", label: "Carrier", type: "enum", dynamic: "carrier", allowEmpty: true },
  { field: "carrierExpectedDeliveryDate", label: "Carrier Expected Delivery Date", type: "date" },
  { field: "carrierSetupName", label: "Carrier Setup Name", type: "text" },
  { field: "channel", label: "Channel", type: "enum", options: opts(ORDER_CHANNELS) },
  { field: "clientId", label: "Client", type: "enum", dynamic: "client" },
  { field: "code", label: "Code", type: "text" },
  { field: "shipCountry", label: "Country", type: "text" },
  { field: "createdAt", label: "Create Date", type: "date" },
  { field: "cfDate1", label: "Custom Field Date 1", type: "date", group: CUSTOM_GROUP },
  { field: "cfDate2", label: "Custom Field Date 2", type: "date", group: CUSTOM_GROUP },
  { field: "cfDate3", label: "Custom Field Date 3", type: "date", group: CUSTOM_GROUP },
  { field: "cfDropDown1", label: "Custom Field Drop Down 1", type: "text", group: CUSTOM_GROUP },
  { field: "cfDropDown2", label: "Custom Field Drop Down 2", type: "text", group: CUSTOM_GROUP },
  { field: "cfTextBox1", label: "Custom Field Text Box 1", type: "text", group: CUSTOM_GROUP },
  { field: "cfTextBox2", label: "Custom Field Text Box 2", type: "text", group: CUSTOM_GROUP },
  { field: "cfTextBox3", label: "Custom Field Text Box 3", type: "text", group: CUSTOM_GROUP },
  { field: "cfToggle1", label: "Custom Field Toggle 1", type: "boolean", group: CUSTOM_GROUP },
  { field: "cfToggle2", label: "Custom Field Toggle 2", type: "boolean", group: CUSTOM_GROUP },
  { field: "retailerCustomerAccount", label: "Customer Account Number", type: "text" },
  { field: "customerName", label: "Customer Name", type: "text" },
  { field: "dept", label: "Department", type: "text" },
  { field: "expectedShipDate", label: "Expected Shipment Date", type: "date" },
  { field: "hasAllocatedInventory", label: "Has Allocated Inventory", type: "boolean", group: YES_NO_GROUP },
  { field: "hasLabel", label: "Has Label", type: "boolean", group: YES_NO_GROUP },
  { field: "hasPickShortLabelPrinted", label: "Has Pick Short Label Printed", type: "boolean", group: YES_NO_GROUP },
  { field: "isAutoShip", label: "Is Auto Ship", type: "boolean", group: YES_NO_GROUP },
  { field: "isBackOrder", label: "Is Back Order", type: "boolean", group: YES_NO_GROUP },
  { field: "jobCode", label: "Job Code", type: "text" },
  { field: "kitSku", label: "Kit SKU", type: "text" },
  { field: "markFor", label: "Mark For", type: "text" },
  { field: "isMerged", label: "Merged Order", type: "boolean", group: YES_NO_GROUP },
  { field: "mergedOrderCode", label: "Merged Shipment Order Code", type: "text" },
  { field: "orderCodeGroupingRef", label: "Order Code Grouping Reference", type: "text" },
  { field: "orderDate", label: "Order Date", type: "date" },
  { field: "orderTypeName", label: "Order Type", type: "enum", dynamic: "orderType" },
  { field: "packShortStatus", label: "Pack Short Status", type: "enum", options: opts(SHORT_STATUSES) },
  { field: "isPartial", label: "Partial", type: "boolean", group: YES_NO_GROUP, description: "Partially shipped orders" },
  { field: "pickListPrinted", label: "Pick List Printed", type: "boolean", group: YES_NO_GROUP },
  { field: "pickShortStatus", label: "Pick Short Status", type: "enum", options: opts(SHORT_STATUSES) },
  { field: "retailerPo", label: "PO", type: "text" },
  { field: "priorityRank", label: "Priority", type: "number", description: "The order priority number (higher is picked first)" },
  { field: "priority", label: "Priority Level", type: "enum", options: opts(PRIORITIES), description: "0 None · 1 Low · 2 Medium · 3 High · 4+ Urgent" },
  { field: "pro", label: "PRO", type: "text" },
  { field: "processingAge", label: "Processing Age", type: "number", description: "Days since the order was created" },
  { field: "rate", label: "Rate", type: "number", decimals: 2 },
  { field: "requestedShippingOption", label: "Requested Shipping Option", type: "text" },
  { field: "retailerId", label: "Retailer", type: "enum", dynamic: "retailer", allowEmpty: true },
  { field: "salesPrice", label: "Sales Price", type: "number", decimals: 2 },
  { field: "shippingService", label: "Shipping Service", type: "text" },
  { field: "singleItemOrder", label: "Single Item Order", type: "boolean", group: YES_NO_GROUP },
  { field: "sku", label: "SKU", type: "text" },
  { field: "shipState", label: "State (Region)", type: "text" },
  { field: "status", label: "Status", type: "enum", options: opts(SO_STATUSES) },
  { field: "storeName", label: "Store", type: "text" },
  { field: "storeOrderNumber", label: "Store Order Number", type: "text" },
  { field: "tag", label: "Tag", type: "enum", dynamic: "tag" },
  { field: "totalQuantity", label: "Total Quantity", type: "number" },
  { field: "trackingNumber", label: "Tracking Number", type: "text" },
  { field: "isUccLabelGenerated", label: "UCC Label Generated", type: "boolean", group: YES_NO_GROUP },
  { field: "warehouseId", label: "Warehouse", type: "enum", dynamic: "warehouse" },
  { field: "isPrime", label: "Prime Order", type: "boolean", group: YES_NO_GROUP },
  { field: "isGift", label: "Gift Order", type: "boolean", group: YES_NO_GROUP },
];

export const ORDER_FILTER_FIELDS: readonly OrderFilterField[] = RAW_FILTER_FIELDS.map((f) => ({ ...f, label: sentenceCase(f.label) }));

/** Status choices offered per view (the other view's statuses would always match nothing). */
export function filterFieldsForView(view: OrderView): readonly OrderFilterField[] {
  const statuses = view === "shipped" ? SHIPPED_VIEW_STATUSES : BACKLOG_VIEW_STATUSES;
  return ORDER_FILTER_FIELDS.map((f) => (f.field === "status"
    ? { ...f, options: opts(statuses), ...(view === "backlog" ? { description: BACKLOG_STATUS_NOTE } : {}) }
    : f));
}

/* ----------------------------------------------------------------- columns */

export type OrderColumnKind = "text" | "integer" | "number" | "money" | "date" | "datetime" | "boolean";

export interface OrderColumnDef {
  readonly id: string;
  readonly label: string;
  readonly kind: OrderColumnKind;
  readonly defaultVisible: boolean;
  /** False when the column cannot be server-sorted. */
  readonly sortable?: boolean;
  readonly view?: OrderView;
}

const col = (id: string, label: string, kind: OrderColumnKind, defaultVisible = false, extra: Partial<OrderColumnDef> = {}): OrderColumnDef =>
  ({ id, label, kind, defaultVisible, ...extra });

/** The 58 Logiwa columns plus 4 Shipped & Canceled extras. Order = grid order. */
const RAW_COLUMNS: readonly OrderColumnDef[] = [
  col("code", "Order Code", "text", true),
  col("storeOrderNumber", "Store Order #", "text", true),
  col("companyName", "Company Name", "text"),
  col("channelPaymentStatus", "Channel Payment Status", "text"),
  col("storeName", "Store", "text", true),
  col("age", "Age", "integer", true),
  col("processingAge", "Order Processing Age", "integer"),
  col("totalWeightOz", "Total Weight", "number"),
  col("clientName", "Client", "text", true),
  col("warehouseCode", "Warehouse", "text", true),
  col("status", "Status", "text", true),
  col("pickShortStatus", "Pick Short", "text", true),
  col("packShortStatus", "Pack Short", "text", true),
  col("tags", "Tags", "text", true, { sortable: false }),
  col("totalQuantity", "Total Qty", "integer", true),
  col("skus", "SKU", "text", true),
  col("jobCode", "Job Code", "text", true),
  col("customerName", "Customer", "text", true),
  col("requestedShippingOption", "Requested Shipping Option", "text"),
  col("carrier", "Carrier", "text", true),
  col("shippingService", "Service", "text", true),
  col("isAutoShip", "Is Auto Ship", "boolean"),
  col("trackingNumber", "Tracking", "text", true),
  col("rate", "Rate", "money"),
  col("salesPrice", "Sales Price", "money", true),
  col("pickListPrinted", "Pick List Printed", "boolean"),
  col("orderDate", "Order Date", "datetime", true),
  col("expectedShipDate", "Expected Ship Date", "datetime", true),
  col("carrierExpectedDeliveryDate", "Carrier Expected Delivery", "datetime"),
  col("shipCountry", "Country", "text"),
  col("orderTypeName", "Order Type", "text", true),
  col("note", "Note", "text"),
  col("createdAt", "Created Date", "datetime"),
  col("deliveredAt", "Actual Delivery Date", "datetime"),
  col("actualPickupDate", "Actual Pickup Date", "datetime"),
  col("shippedAt", "Actual Shipment Date", "datetime"),
  col("shippingAccountNumber", "Charged Account Number", "text"),
  col("taxDutiesAccountNumber", "Tax & Duties Account Number", "text"),
  col("isPrime", "Prime Order", "boolean"),
  col("priority", "Priority", "integer", true),
  col("scheduledPickupDate", "Scheduled Pickup Date", "datetime"),
  col("expectedDeliveryDate", "Expected Delivery Date", "datetime"),
  col("extraNote1", "Extra Note 1", "text"),
  col("extraNote2", "Extra Note 2", "text"),
  col("fraud", "Fraud", "text"),
  col("orderCodeGroupingRef", "Order Code Grouping Reference", "text"),
  col("giftNote", "Gift Note", "text"),
  col("isBackOrder", "Back Order", "boolean"),
  col("scheduledShipmentDate", "Scheduled Shipment Date", "datetime"),
  col("shipState", "State (Region)", "text"),
  col("retailerName", "Retailer", "text"),
  col("bol", "BOL", "text"),
  col("pro", "PRO", "text"),
  col("retailerPo", "PO", "text"),
  col("dept", "Dept", "text"),
  col("markFor", "Mark For", "text"),
  col("retailerCustomerAccount", "Customer Account Number", "text"),
  col("isUccLabelGenerated", "Is UCC Label Generated", "boolean"),
  col("mergedOrderCode", "Merged SO Code", "text", true, { view: "shipped" }),
  col("mergedOrderStatus", "Merged Order Status", "text", false, { view: "shipped" }),
  col("cancelReason", "Cancel Reason", "text", true, { view: "shipped" }),
  col("cancelledAt", "Cancel Date", "datetime", true, { view: "shipped" }),
  col("daysSinceShipped", "Days Since Shipped", "integer", true, { view: "shipped" }),
];

export const ORDER_COLUMNS: readonly OrderColumnDef[] = RAW_COLUMNS.map((c) => ({ ...c, label: sentenceCase(c.label) }));

export function columnsForView(view: OrderView): readonly OrderColumnDef[] {
  return ORDER_COLUMNS.filter((c) => !c.view || c.view === view);
}

/**
 * Logiwa parity: every one of the 58 columns is visible by default on both tabs (the Shipped &
 * Canceled tab adds its 4 merge/cancel columns, Merged Order Status included). Users trim the set
 * with the column chooser; their choice is saved per grid. `defaultVisible` on the def marks the
 * compact "core" set (used by narrow layouts and exports that ask for it).
 */
/** Columns available in the chooser but hidden by default (mostly empty on D2C orders). */
export const DEFAULT_HIDDEN_COLUMNS: ReadonlySet<string> = new Set(["companyName"]);

export function defaultVisibleFor(view: OrderView, c: OrderColumnDef): boolean {
  if (DEFAULT_HIDDEN_COLUMNS.has(c.id)) return false;
  return !c.view || c.view === view;
}

/** Sortable columns (grid column id = sort field). */
export const ORDER_SORT_FIELDS: readonly string[] = ORDER_COLUMNS.filter((c) => c.sortable !== false).map((c) => c.id);

/** Quick search (Equal / Starts With) targets. */
export const ORDER_SEARCH_FIELDS = ["code", "storeOrderNumber", "customerName", "trackingNumber"] as const;

/** Default filter on the Shipped & Canceled tab: Actual Shipment Date, last 7 days. */
export const SHIPPED_DEFAULT_FILTER_PARAM = "f.shippedAt=date:last7d";

/* --------------------------------------------------------------- bulk keys */

export const ORDER_BULK_ACTIONS = [
  "cancel", "hold", "release", "change-warehouse", "delete", "backorder", "resolve-pick-short", "resolve-pack-short",
  "unmerge", "cancel-picking", "update-return-info", "remove-serials",
] as const;
export type OrderBulkAction = (typeof ORDER_BULK_ACTIONS)[number];

/** Permission key per bulk endpoint ("Shipment Orders" permission group). */
export const ORDER_BULK_PERMISSIONS: Readonly<Record<OrderBulkAction, string>> = {
  cancel: "fulfillment.shipment_orders.cancel",
  hold: "fulfillment.shipment_orders.change_status",
  release: "fulfillment.shipment_orders.change_status",
  "change-warehouse": "fulfillment.shipment_orders.change_warehouse",
  delete: "fulfillment.shipment_orders.delete",
  backorder: "fulfillment.shipment_orders.create_back_order",
  "resolve-pick-short": "fulfillment.shipment_orders.pick_short",
  "resolve-pack-short": "fulfillment.shipment_orders.pack_short",
  unmerge: "fulfillment.shipment_orders.unmerge_order",
  "cancel-picking": "fulfillment.shipment_orders.cancel_picking",
  "update-return-info": "fulfillment.shipment_orders.edit",
  "remove-serials": "fulfillment.shipment_orders.remove_serial_number",
};

export const ORDER_PERMISSIONS = {
  view: "fulfillment.shipment_orders.view",
  create: "fulfillment.shipment_orders.create",
  edit: "fulfillment.shipment_orders.edit",
  delete: "fulfillment.shipment_orders.delete",
  changeLog: "fulfillment.shipment_orders.change_log",
  ship: "fulfillment.shipment_orders.ship_order",
  createLabel: "fulfillment.shipment_orders.create_label",
  voidLabel: "fulfillment.shipment_orders.void_label",
  reprintLabel: "fulfillment.shipment_orders.reprint_label",
  createReturnLabel: "fulfillment.shipment_orders.create_return_label",
  createRetailerLabel: "fulfillment.shipment_orders.create_retailer_label",
  reprintRetailerLabel: "fulfillment.shipment_orders.reprint_retailer_label",
  jobs: "fulfillment.shipment_orders.picking_job_operations",
  tag: "fulfillment.shipment_orders.tag",
  printPickList: "fulfillment.shipment_orders.print_picking_list",
  batchPickList: "fulfillment.shipment_orders.batch_picking_list",
  printPackingSlip: "fulfillment.shipment_orders.print_packing_slip",
  printManifest: "fulfillment.shipment_orders.print_manifest_bol",
  pickPackShortLabel: "fulfillment.shipment_orders.pick_pack_short_label",
  createRma: "fulfillment.shipment_orders.create_rma",
  billing: "fulfillment.shipment_orders.download_billing_charges",
  documentsUpload: "fulfillment.shipment_orders.other_documents_upload",
  createProduct: "fulfillment.shipment_orders.create_new_product",
  customFields: "fulfillment.shipment_orders.custom_field_management",
  import: "fulfillment.shipment_orders.import_file",
  importSerials: "fulfillment.shipment_orders.import_serial_numbers",
} as const;
