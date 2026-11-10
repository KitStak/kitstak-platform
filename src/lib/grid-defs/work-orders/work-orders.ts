/**
 * Work Orders grid definition (pure TS, shared by the client filter builder, the
 * `/api/work-orders` grid-grammar path and the export provider). Keys are the
 * `f.<field>` / `sort=<field>` names.
 *
 * 22 filters (Logiwa parity): Client, Code, Created Date, Custom Field Date 1-3, Custom Field
 * Drop Down 1-2, Custom Field Text Box 1-3, Custom Field Toggle 1-2, Job Code, Processed SKU,
 * Requested Quantity, SKU, Tag, Warehouse, the five work order dates, Status and Type.
 */
import { CUSTOM_FIELD_SLOTS, WORK_ORDER_STATUSES, WORK_ORDER_TYPES, type CustomFieldSlot } from "@/lib/enums";

export const WORK_ORDERS_GRID_KEY = "work-orders";

export type WoGridFieldType = "enum" | "text" | "number" | "date" | "boolean";

export interface WoGridField {
  readonly field: string;
  readonly label: string;
  readonly type: WoGridFieldType;
  /** Static enum choices; warehouse/client choices are filled from the viewer's scope. */
  readonly options?: readonly string[];
  readonly allowEmpty?: boolean;
  readonly group?: string;
  readonly description?: string;
  /** Custom-field slot backing this filter. */
  readonly slot?: CustomFieldSlot;
}

const CF_TYPE_LABEL: Readonly<Record<string, string>> = { textBox: "Text Box", dropDown: "Drop Down", date: "Date", toggle: "Toggle" };
const CF_FIELD_TYPE: Readonly<Record<string, WoGridFieldType>> = { textBox: "text", dropDown: "enum", date: "date", toggle: "boolean" };

/** "textBox2" -> "Custom Field Text Box 2" (used until the slot has a configured name). */
export function defaultCustomFieldLabel(slot: CustomFieldSlot): string {
  const match = /^(textBox|dropDown|date|toggle)(\d)$/.exec(slot);
  return match ? `Custom Field ${CF_TYPE_LABEL[match[1] ?? ""] ?? ""} ${match[2]}` : slot;
}

export const customFieldKey = (slot: CustomFieldSlot): string => `cf_${slot}`;

export const CUSTOM_FIELD_GRID_FIELDS: readonly WoGridField[] = CUSTOM_FIELD_SLOTS.map((slot) => {
  const kind = /^(textBox|dropDown|date|toggle)/.exec(slot)?.[1] ?? "textBox";
  return { field: customFieldKey(slot), label: defaultCustomFieldLabel(slot), type: CF_FIELD_TYPE[kind] ?? "text", group: "Custom fields", slot };
});

export const WORK_ORDER_GRID_FIELDS: readonly WoGridField[] = [
  { field: "clientName", label: "Client", type: "enum" },
  { field: "code", label: "Code", type: "text" },
  { field: "createdAt", label: "Created Date", type: "date" },
  ...CUSTOM_FIELD_GRID_FIELDS,
  { field: "jobCode", label: "Job Code", type: "text" },
  { field: "processedSku", label: "Processed SKU", type: "text", description: "Kit or component SKU used by the work order" },
  { field: "requestedQty", label: "Requested Quantity", type: "number" },
  { field: "kitSku", label: "SKU", type: "text" },
  { field: "tags", label: "Tag", type: "text" },
  { field: "warehouseCode", label: "Warehouse", type: "enum" },
  { field: "actualFinishAt", label: "Work Order Actual Finish Date", type: "date" },
  { field: "actualStartAt", label: "Work Order Actual Start Date", type: "date" },
  { field: "cancelledAt", label: "Work Order Cancellation Date", type: "date" },
  { field: "plannedFinishAt", label: "Work Order Planned Finish Date", type: "date" },
  { field: "plannedStartAt", label: "Work Order Planned Start Date", type: "date" },
  { field: "status", label: "Work Order Status", type: "enum", options: WORK_ORDER_STATUSES },
  { field: "type", label: "Work Order Type", type: "enum", options: WORK_ORDER_TYPES, allowEmpty: true },
];

/** Sortable fields (grid column id = sort field). */
export const WORK_ORDER_SORT_FIELDS = [
  "code", "warehouseCode", "clientName", "status", "age", "operationType", "type", "jobCode", "kitSku",
  "requestedQty", "processedQty", "extraNote", "kittingInstructions", "createdAt", "plannedStartAt",
  "plannedFinishAt", "actualStartAt", "actualFinishAt", "cancelledAt",
] as const;

/** Quick search (Equal / Starts With) targets: "Search by code". */
export const WORK_ORDER_SEARCH_FIELDS = ["code"] as const;

/** Export / column order (20 Logiwa columns, kebab excluded). */
export const WORK_ORDER_COLUMNS: readonly { readonly key: string; readonly label: string; readonly type?: "text" | "integer" | "datetime" }[] = [
  { key: "code", label: "Work Order Code" },
  { key: "warehouseCode", label: "Warehouse" },
  { key: "clientName", label: "Client" },
  { key: "status", label: "Work Order Status" },
  { key: "age", label: "Age", type: "integer" },
  { key: "operationType", label: "Work Order Operation Type" },
  { key: "type", label: "Work Order Type" },
  { key: "tagNames", label: "Tags" },
  { key: "jobCode", label: "Job Code" },
  { key: "kitSku", label: "Kit SKU" },
  { key: "requestedQty", label: "Requested Kit Quantity", type: "integer" },
  { key: "processedQty", label: "Processed Quantity", type: "integer" },
  { key: "extraNote", label: "Extra Notes" },
  { key: "kittingInstructions", label: "Kitting Instructions" },
  { key: "createdAt", label: "Created Date", type: "datetime" },
  { key: "plannedStartAt", label: "Planned Start Date", type: "datetime" },
  { key: "plannedFinishAt", label: "Planned Finish Date", type: "datetime" },
  { key: "actualStartAt", label: "Actual Start Date", type: "datetime" },
  { key: "actualFinishAt", label: "Actual Finish Date", type: "datetime" },
  { key: "cancelledAt", label: "Cancellation Date", type: "datetime" },
];
