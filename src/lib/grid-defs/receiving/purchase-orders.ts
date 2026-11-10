/**
 * Purchase Orders grid (M05) — pure TS shared by the filter builder, the
 * `/api/purchase-orders` grid-grammar path and the export provider.
 *
 * Keys are the `f.<field>` / `sort=<field>` names. Enum options that depend on the
 * caller (clients, warehouses, tags) are filled in by the page at runtime.
 */
import { PO_STATUSES, PO_TYPES } from "@/lib/enums";

export const PURCHASE_ORDERS_GRID_KEY = "purchase-orders";

export type ReceivingFieldType = "enum" | "text" | "number" | "date" | "boolean";

export interface ReceivingGridField {
  readonly field: string;
  readonly label: string;
  readonly type: ReceivingFieldType;
  readonly options?: readonly string[];
  readonly allowEmpty?: boolean;
  readonly decimals?: number;
  readonly group?: string;
  /** Options come from the caller's scope / reference data (ids as values). */
  readonly dynamicOptions?: "clients" | "warehouses" | "tags" | "customFieldOptions";
}

/** Statuses offered by the filter (Logiwa parity: Cancelled, Completed, Pending, Started). */
export const PO_FILTER_STATUSES = ["Pending", "Started", "Completed", "Cancelled"] as const;

/** The visible PO status: the ledger's transient "Receiving" reads as Started. */
export function displayPoStatus(status: string): string {
  return status === "Receiving" ? "Started" : status;
}

export const CUSTOM_FIELD_GRID_FIELDS: readonly ReceivingGridField[] = [
  { field: "cf_textBox1", label: "Custom field text box 1", type: "text", group: "Custom fields" },
  { field: "cf_textBox2", label: "Custom field text box 2", type: "text", group: "Custom fields" },
  { field: "cf_textBox3", label: "Custom field text box 3", type: "text", group: "Custom fields" },
  { field: "cf_dropDown1", label: "Custom field drop down 1", type: "enum", allowEmpty: true, group: "Custom fields", dynamicOptions: "customFieldOptions" },
  { field: "cf_dropDown2", label: "Custom field drop down 2", type: "enum", allowEmpty: true, group: "Custom fields", dynamicOptions: "customFieldOptions" },
  { field: "cf_date1", label: "Custom field date 1", type: "date", group: "Custom fields" },
  { field: "cf_date2", label: "Custom field date 2", type: "date", group: "Custom fields" },
  { field: "cf_date3", label: "Custom field date 3", type: "date", group: "Custom fields" },
  { field: "cf_toggle1", label: "Custom field toggle 1", type: "boolean", group: "Custom fields" },
  { field: "cf_toggle2", label: "Custom field toggle 2", type: "boolean", group: "Custom fields" },
];

/** The 19 Logiwa filter rows (the four custom-field rows expand to their 10 slots). */
export const PO_GRID_FIELDS: readonly ReceivingGridField[] = [
  { field: "actualArrivalDate", label: "Actual arrival date", type: "date" },
  { field: "receivedAt", label: "Actual receiving date", type: "date" },
  { field: "clientId", label: "Client", type: "enum", dynamicOptions: "clients" },
  { field: "code", label: "Code", type: "text" },
  { field: "createdAt", label: "Create date", type: "date" },
  ...CUSTOM_FIELD_GRID_FIELDS,
  { field: "plannedArrivalDate", label: "Planned arrival date", type: "date" },
  { field: "plannedReceivingDate", label: "Planned receiving date", type: "date" },
  { field: "poDate", label: "PO date", type: "date" },
  { field: "purchasePrice", label: "Price", type: "number", decimals: 2 },
  { field: "poType", label: "Purchase order type", type: "enum", options: PO_TYPES },
  { field: "referenceNumber", label: "Reference number", type: "text" },
  { field: "status", label: "Status", type: "enum", options: PO_FILTER_STATUSES },
  { field: "tag", label: "Tag", type: "enum", allowEmpty: true, dynamicOptions: "tags" },
  { field: "vendorName", label: "Vendor display name", type: "text" },
  { field: "warehouseId", label: "Warehouse", type: "enum", dynamicOptions: "warehouses" },
];

export const PO_SORT_FIELDS = [
  "code", "vendorName", "referenceNumber", "purchasePrice", "totalQuantity", "status", "poType", "tags", "poDate", "clientName",
  "warehouseName", "createdAt", "plannedReceivingDate", "receivedAt", "plannedArrivalDate", "actualArrivalDate",
] as const;

/** Quick search (Equal / Starts With): "Search by code" plus reference number. */
export const PO_SEARCH_FIELDS = ["code", "referenceNumber"] as const;

/** Statuses that still accept receipts / cancellation (status machine mirrors this). */
export const OPEN_PO_STATUSES: readonly string[] = ["Pending", "Started", "Receiving"];
export const PO_STATUS_VALUES: readonly string[] = PO_STATUSES;
