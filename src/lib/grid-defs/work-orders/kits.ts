/**
 * Kit Inventory and Kit Component Inventory Availability grid definitions (pure TS).
 * Both reports are evaluated over computed rows, so the server whitelists these fields.
 */
import { KIT_TYPES } from "@/lib/enums";
import type { WoGridField } from "./work-orders";

export const KIT_INVENTORY_GRID_KEY = "kit-inventory";
export const KIT_COMPONENTS_GRID_KEY = "kit-components";

/** Recalculation cadence of `kit_inventory_stats` (scheduler + Recalculate Now). */
export const KIT_RECALC_EVERY_MS = 15 * 60_000;

export interface KitInventoryRow {
  readonly id: string;
  readonly kitProductId: string;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly sku: string;
  readonly kitType: string | null;
  readonly barcode: string;
  readonly name: string;
  readonly packType: string;
  readonly productType: string | null;
  readonly productGroup: string | null;
  readonly pendingOrderQty: number;
  readonly netKittingCapacity: number;
  readonly totalInventoryCapacity: number;
  readonly currentInventoryQty: number;
  readonly requiredKittingQty: number;
  readonly componentCount: number;
  readonly updatedAt: string;
}

export interface KitComponentRow {
  readonly id: string;
  readonly componentProductId: string;
  readonly warehouseId: string;
  readonly warehouseCode: string;
  readonly clientName: string;
  readonly sku: string;
  readonly name: string;
  readonly productType: string | null;
  readonly productGroup: string | null;
  readonly includedKits: readonly string[];
  /** Comma list for filtering / export. */
  readonly includedKitsText: string;
  readonly totalOrderQty: number;
  readonly totalInventoryQty: number;
  readonly totalAvailableQty: number;
  readonly reorderQty: number;
}

export const KIT_INVENTORY_FIELDS: readonly WoGridField[] = [
  { field: "clientName", label: "Client", type: "enum" },
  { field: "currentInventoryQty", label: "Current Inventory Quantity", type: "number" },
  { field: "kitType", label: "Kit Type", type: "enum", options: KIT_TYPES },
  { field: "netKittingCapacity", label: "Net Kitting Capacity", type: "number" },
  { field: "pendingOrderQty", label: "Open Shipment Order Quantity", type: "number" },
  { field: "packType", label: "Pack Type", type: "text" },
  { field: "productGroup", label: "Product Group", type: "text" },
  { field: "name", label: "Product Name", type: "text" },
  { field: "productType", label: "Product Type", type: "text" },
  { field: "requiredKittingQty", label: "Required Kitting Quantity", type: "number" },
  { field: "sku", label: "SKU", type: "text" },
  { field: "totalInventoryCapacity", label: "Total Inventory Capacity", type: "number" },
  { field: "barcode", label: "UPC", type: "text" },
  { field: "warehouseCode", label: "Warehouse", type: "enum" },
];

export const KIT_INVENTORY_SORT_FIELDS = [
  "warehouseCode", "clientName", "sku", "kitType", "barcode", "name", "packType", "productType", "productGroup",
  "pendingOrderQty", "netKittingCapacity", "totalInventoryCapacity", "currentInventoryQty", "requiredKittingQty", "updatedAt",
] as const;

export const KIT_COMPONENT_FIELDS: readonly WoGridField[] = [
  { field: "clientName", label: "Client", type: "enum" },
  { field: "sku", label: "Component SKU", type: "text" },
  { field: "includedKitsText", label: "Included Kits", type: "text" },
  { field: "productGroup", label: "Product Group", type: "text" },
  { field: "name", label: "Product Name", type: "text" },
  { field: "productType", label: "Product Type", type: "text" },
  { field: "reorderQty", label: "Reorder Quantity", type: "number" },
  { field: "totalAvailableQty", label: "Total Available Inventory Quantity", type: "number" },
  { field: "totalInventoryQty", label: "Total Inventory Quantity", type: "number" },
  { field: "totalOrderQty", label: "Total Order Quantity", type: "number" },
  { field: "warehouseCode", label: "Warehouse", type: "enum" },
];

export const KIT_COMPONENT_SORT_FIELDS = [
  "warehouseCode", "clientName", "sku", "name", "productType", "productGroup", "includedKitsText",
  "totalOrderQty", "totalInventoryQty", "totalAvailableQty", "reorderQty",
] as const;

export const KIT_SEARCH_FIELDS = ["sku"] as const;

export const KIT_INVENTORY_EXPORT_COLUMNS: readonly { readonly key: string; readonly label: string; readonly type?: "integer" | "datetime" }[] = [
  { key: "warehouseCode", label: "Warehouse" }, { key: "clientName", label: "Client" }, { key: "sku", label: "SKU" },
  { key: "kitType", label: "Kit Type" }, { key: "barcode", label: "Barcode" }, { key: "name", label: "Product Name" },
  { key: "packType", label: "Pack Type Name" }, { key: "productType", label: "Product Type" }, { key: "productGroup", label: "Product Group" },
  { key: "pendingOrderQty", label: "Pending Order Quantity", type: "integer" }, { key: "netKittingCapacity", label: "Net Kitting Capacity", type: "integer" },
  { key: "totalInventoryCapacity", label: "Total Inventory Capacity", type: "integer" }, { key: "currentInventoryQty", label: "Current Inventory Quantity", type: "integer" },
  { key: "requiredKittingQty", label: "Required Kitting Quantity", type: "integer" }, { key: "updatedAt", label: "Last Updated", type: "datetime" },
];

export const KIT_COMPONENT_EXPORT_COLUMNS: readonly { readonly key: string; readonly label: string; readonly type?: "integer" }[] = [
  { key: "warehouseCode", label: "Warehouse" }, { key: "clientName", label: "Client" }, { key: "sku", label: "Component SKU" },
  { key: "name", label: "Component Product Name" }, { key: "productType", label: "Product Type" }, { key: "productGroup", label: "Product Group" },
  { key: "includedKitsText", label: "Included Kits" }, { key: "totalOrderQty", label: "Total Order Quantity", type: "integer" },
  { key: "totalInventoryQty", label: "Total Inventory Quantity", type: "integer" }, { key: "totalAvailableQty", label: "Total Available Inventory Quantity", type: "integer" },
  { key: "reorderQty", label: "Reorder Quantity", type: "integer" },
];
