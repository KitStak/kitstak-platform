/**
 * Data Setup (M14): the 18 lookup tables (Logiwa routes and labels), their scope (global,
 * warehouse or client), type-specific fields stored in `lookup_values.meta`, grid fields and
 * the drawer schema; plus Auto Code Generation preferences. PURE.
 */
import { z } from "zod";
import type { LookupType } from "@/lib/enums";
import { idField, optionalText, requiredText, versionField, type AdminField } from "./common";

export type LookupScope = "global" | "warehouse" | "client";

export interface LookupDef {
  readonly type: LookupType;
  readonly slug: string;
  /** Singular noun for buttons ("VAS Type" -> "Create New VAS Type"). */
  readonly noun: string;
  readonly title: string;
  readonly description: string;
  readonly scope: LookupScope;
  /** Warehouse / client is required (Location Zone needs a warehouse). */
  readonly scopeRequired?: boolean;
  readonly hasCode?: boolean;
}

export const LOOKUP_DEFS: readonly LookupDef[] = [
  { type: "po_type", slug: "purchase-order-type", noun: "Purchase Order Type", title: "Purchase Order Type", description: "Types offered on purchase orders and used by screen configuration conditions.", scope: "global" },
  { type: "so_type", slug: "shipment-order-type", noun: "Shipment Order Type", title: "Shipment Order Type", description: "Order types for shipment orders, used by job type and workflow conditions.", scope: "global" },
  { type: "order_merge_rule", slug: "order-merge-rule", noun: "Order Merge Rule", title: "Order Merge Rule", description: "Which open orders are merged into one shipment before picking.", scope: "global" },
  { type: "work_order_type", slug: "work-order-type", noun: "Work Order Type", title: "Work Order Type", description: "Types of kitting and assembly work orders.", scope: "global" },
  { type: "damage_reason", slug: "damaged-reasons", noun: "Damage Reason", title: "Damage Reasons", description: "Reasons offered when stock is marked damaged during picking, counting or receiving.", scope: "global" },
  { type: "pack_type", slug: "pack-types", noun: "Pack Type", title: "Pack Type", description: "Units of measure for product pack types (Each, Case, Pallet…).", scope: "global" },
  { type: "product_type", slug: "product-types", noun: "Product Type", title: "Product Type", description: "Product types, optionally limited to one client.", scope: "client" },
  { type: "product_group", slug: "product-groups", noun: "Product Group", title: "Product Group", description: "Product groups used for picking, billing and count conditions.", scope: "client" },
  { type: "location_group", slug: "location-group", noun: "Location Group", title: "Location Group", description: "Groups of locations within a warehouse.", scope: "warehouse", scopeRequired: true },
  { type: "location_zone", slug: "location-zone", noun: "Location Zone", title: "Location Zone", description: "Zones within a warehouse, used by picking and put-away.", scope: "warehouse", scopeRequired: true },
  { type: "vas_type", slug: "vas-type", noun: "VAS Type", title: "VAS Type", description: "Value-added services billed to clients.", scope: "client" },
  { type: "mobile_cart_type", slug: "mobile-cart-type", noun: "Mobile Cart Type", title: "Mobile Cart Type", description: "Cart layouts (levels × columns) for pick-and-sort carts.", scope: "global" },
  { type: "packing_warning_type", slug: "packing-warning-type", noun: "Packing Warning Type", title: "Packing Warning Type", description: "Warnings shown to packers for an order (fragile, gift, inspect…).", scope: "global" },
  { type: "custom_carrier", slug: "custom-carrier", noun: "Custom Carrier", title: "Custom Carrier", description: "Carriers without an integration (local courier, customer pickup).", scope: "global", hasCode: true },
  { type: "return_process", slug: "return-process", noun: "Return Process", title: "Return Process", description: "What happens to returned items (restock, quarantine, dispose…).", scope: "global" },
  { type: "adjustment_reason", slug: "inventory-adjustment-reason", noun: "Inventory Adjustment Reason", title: "Inventory Adjustment Reason", description: "Reasons required when inventory is adjusted by hand.", scope: "global" },
  { type: "so_cancel_reason", slug: "shipment-order-cancel-reason", noun: "Shipment Order Cancel Reason", title: "Shipment Order Cancel Reason", description: "Reasons offered in the Cancel Order modal.", scope: "global" },
  { type: "return_reason", slug: "return-reason", noun: "Return Reason", title: "Return Reason", description: "Customer and actual reasons recorded on return orders.", scope: "global" },
];

export const CODE_GENERATION_SLUG = "code-generation";

const BY_SLUG: ReadonlyMap<string, LookupDef> = new Map(LOOKUP_DEFS.map((d) => [d.slug, d]));
const BY_TYPE: ReadonlyMap<string, LookupDef> = new Map(LOOKUP_DEFS.map((d) => [d.type, d]));

export function lookupBySlug(slug: string): LookupDef | undefined {
  return BY_SLUG.get(slug);
}

export function lookupByType(type: string): LookupDef | undefined {
  return BY_TYPE.get(type);
}

/* ---------------- type-specific fields ---------------- */

export const VAS_CALCULATION_TYPES = ["Total Price", "Vas Quantity"] as const;
export const CART_OPERATIONS = ["Picking", "Sorting", "Pick and sort"] as const;
export const MERGE_CRITERIA = [
  { key: "client", label: "Same client" },
  { key: "customerName", label: "Same customer" },
  { key: "shipAddress", label: "Same address" },
  { key: "shipZip", label: "Same zip code" },
  { key: "carrier", label: "Same carrier" },
  { key: "storeOrderNumber", label: "Same store order number" },
] as const;
export type MergeCriterion = (typeof MERGE_CRITERIA)[number]["key"];

export const mergeCriteriaLabel = (keys: readonly string[]): string =>
  keys.map((k) => MERGE_CRITERIA.find((c) => c.key === k)?.label ?? k).join(" + ");

/* ---------------- grid ---------------- */

export const lookupGridKey = (type: string): string => `lookup-${type.replace(/_/g, "-")}`;

export const LOOKUP_FIELDS: readonly AdminField[] = [
  { field: "name", label: "Name", type: "text" },
  { field: "status", label: "Status", type: "enum", options: ["Active", "Inactive"] },
  { field: "warehouseId", label: "Warehouse", type: "enum" },
  { field: "clientId", label: "Client", type: "enum" },
  { field: "usageCount", label: "Used by", type: "number" },
  { field: "createdAt", label: "Created date", type: "date" },
];

export const LOOKUP_SORT_FIELDS = ["name", "status", "sortOrder", "warehouseCode", "clientName", "usageCount", "createdAt", "updatedAt"] as const;
export const LOOKUP_SEARCH_FIELDS = ["name"] as const;

/* ---------------- drawer ---------------- */

export const lookupFormSchema = z.object({
  name: requiredText("Name", 120),
  code: optionalText(60),
  isActive: z.boolean(),
  warehouseId: idField.nullable(),
  clientId: idField.nullable(),
  sortOrder: z.number({ error: "Enter a number" }).int("Whole number").min(0, "Can't be negative").max(100_000),
  calculationType: z.enum(VAS_CALCULATION_TYPES).nullable(),
  levels: z.number().int("Whole number").min(1, "At least 1 level").max(20, "At most 20 levels").nullable(),
  columns: z.number().int("Whole number").min(1, "At least 1 column").max(30, "At most 30 columns").nullable(),
  operation: z.enum(CART_OPERATIONS).nullable(),
  criteria: z.array(z.enum(MERGE_CRITERIA.map((c) => c.key) as [MergeCriterion, ...MergeCriterion[]])).max(MERGE_CRITERIA.length),
  countsAsDamaged: z.boolean(),
  version: versionField,
});

export type LookupFormValues = z.input<typeof lookupFormSchema>;
export type LookupSave = z.output<typeof lookupFormSchema>;

export const LOOKUP_FORM_DEFAULTS: LookupFormValues = {
  name: "", code: "", isActive: true, warehouseId: null, clientId: null, sortOrder: 0,
  calculationType: null, levels: null, columns: null, operation: null, criteria: [], countsAsDamaged: true,
};

/** Type rules on top of the shape (run on the server and in the drawer). */
export function lookupIssues(def: LookupDef, v: LookupSave): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (def.scopeRequired && def.scope === "warehouse" && !v.warehouseId) issues.push({ path: "warehouseId", message: "Warehouse is required" });
  if (def.type === "vas_type" && !v.calculationType) issues.push({ path: "calculationType", message: "Choose a VAS calculation type" });
  if (def.type === "mobile_cart_type") {
    if (!v.levels) issues.push({ path: "levels", message: "Levels are required" });
    if (!v.columns) issues.push({ path: "columns", message: "Columns are required" });
    if (!v.operation) issues.push({ path: "operation", message: "Choose an operation" });
  }
  if (def.type === "order_merge_rule" && v.criteria.length === 0) issues.push({ path: "criteria", message: "Pick at least one criterion" });
  return issues;
}

/** The `meta` JSON each type stores. */
export function lookupMeta(def: LookupDef, v: LookupSave): Record<string, unknown> | null {
  switch (def.type) {
    case "vas_type": return { calculationType: v.calculationType };
    case "mobile_cart_type": return { levels: v.levels, columns: v.columns, operation: v.operation };
    case "order_merge_rule": return { criteria: v.criteria };
    case "damage_reason": return { countsAsDamaged: v.countsAsDamaged };
    default: return null;
  }
}

/* ---------------- auto code generation ---------------- */

export const SEQUENCE_DEFS = [
  { key: "so", label: "Shipment orders", example: "SO", entity: "shipment order" },
  { key: "po", label: "Purchase orders", example: "PO", entity: "purchase order" },
  { key: "workOrder", label: "Work orders", example: "WO", entity: "work order" },
  { key: "rma", label: "Return orders (RMA)", example: "RMA", entity: "return order" },
  { key: "shipmentPlan", label: "Shipment plans", example: "SP", entity: "shipment plan" },
  { key: "count", label: "Count plans", example: "CNT", entity: "count plan" },
] as const;
export type SequenceKey = (typeof SEQUENCE_DEFS)[number]["key"];

export const sequenceSchema = z.object({
  key: z.enum(SEQUENCE_DEFS.map((s) => s.key) as [SequenceKey, ...SequenceKey[]]),
  autoGenerate: z.boolean(),
  prefix: z.string().trim().max(12, "At most 12 characters").regex(/^[A-Za-z0-9-]*$/, "Letters, numbers or dash"),
  nextValue: z.number({ error: "Enter a start number" }).int("Whole number").min(1, "At least 1").max(999_999_999),
  padding: z.number({ error: "Enter a length" }).int("Whole number").min(0, "Can't be negative").max(12, "At most 12 digits"),
}).superRefine((v, ctx) => {
  if (v.autoGenerate && v.prefix.length === 0) ctx.addIssue({ code: "custom", path: ["prefix"], message: "Prefix is required to generate codes" });
});

export type SequenceValues = z.input<typeof sequenceSchema>;

/** `SO` + 10856 padded to 6 -> `SO010856` (matches `sequences.formatCode`). */
export function sequencePreview(prefix: string, next: number, padding: number): string {
  return `${prefix}${String(next).padStart(Math.max(0, padding), "0")}`;
}
