/**
 * Total Inventory grid (spec 04 §1): one row per SKU × warehouse, or one per SKU with
 * Warehouse = "All Warehouses" when no warehouse filter or header context is set.
 * 16 columns · 13 filters · read-only with export.
 */
import { KIT_TYPES } from "@/lib/enums";
import type { InventoryExportColumn, InventoryGridDef, InventoryGridField } from "./fields";

export const TOTAL_INVENTORY_GRID_KEY = "inventory-total";
export const ALL_WAREHOUSES_LABEL = "All Warehouses";

export const TOTAL_INVENTORY_FIELDS: readonly InventoryGridField[] = [
  { field: "undamagedAvailableQty", label: "Available Undamaged UOM Quantity", type: "number" },
  { field: "availableQty", label: "Available UOM Quantity", type: "number" },
  { field: "client", label: "Client", type: "enum", dynamicOptions: "client", filterAlias: "clientId" },
  { field: "damagedQty", label: "Damaged Quantity", type: "number" },
  { field: "kitType", label: "Kit Type", type: "enum", options: KIT_TYPES, allowEmpty: true },
  { field: "openSoQty", label: "Open SO Qty", type: "number" },
  { field: "productGroup", label: "Product Group", type: "text" },
  { field: "productName", label: "Product Name", type: "text" },
  { field: "productType", label: "Product Type", type: "text" },
  { field: "sku", label: "SKU", type: "text" },
  { field: "totalQty", label: "Total Quantity", type: "number" },
  { field: "undamagedQty", label: "Undamaged Quantity", type: "number" },
  { field: "warehouse", label: "Warehouse", type: "enum", dynamicOptions: "warehouse", filterAlias: "warehouseId" },
];

export const TOTAL_INVENTORY_DEF: InventoryGridDef = {
  gridKey: TOTAL_INVENTORY_GRID_KEY,
  fields: TOTAL_INVENTORY_FIELDS,
  sortable: [
    "warehouse", "client", "sku", "productName", "uomQty", "availableQty", "totalQty", "openSoQty", "undamagedQty",
    "undamagedAvailableQty", "productGroup", "damagedQty", "kitType", "productType",
  ],
  search: ["sku"],
  defaultSort: ["-totalQty", "sku"],
};

export const TOTAL_INVENTORY_EXPORT_COLUMNS: readonly InventoryExportColumn[] = [
  { key: "warehouse", label: "Warehouse" },
  { key: "client", label: "Client" },
  { key: "sku", label: "SKU" },
  { key: "productName", label: "Product Name" },
  { key: "uomPackType", label: "UOM Pack Type" },
  { key: "uomQty", label: "UOM Quantity", type: "integer" },
  { key: "availableQty", label: "Available UOM Qty", type: "integer" },
  { key: "totalQty", label: "Total Quantity", type: "integer" },
  { key: "openSoQty", label: "Open SO Qty", type: "integer" },
  { key: "undamagedQty", label: "Undamaged Quantity", type: "integer" },
  { key: "undamagedAvailableQty", label: "Undamaged Available UOM Qty", type: "integer" },
  { key: "kitType", label: "Kit Type" },
  { key: "productType", label: "Product Type" },
  { key: "productGroup", label: "Product Group" },
  { key: "damagedQty", label: "Damaged Qty", type: "integer" },
];

/** Header `?` tips, so the numbers explain themselves (Logiwa only tips two columns). */
export const TOTAL_INVENTORY_TIPS: Readonly<Record<string, string>> = {
  uomQty: "On-hand quantity in the product's primary (UOM) unit.",
  availableQty: "Total Quantity − Open SO Qty. Negative when open orders exceed stock.",
  totalQty: "Every on-hand unit in every status (Stock, Picked, Packed…), damaged included.",
  openSoQty: "Units still to ship on open shipment orders (ordered − cancelled − shipped).",
  undamagedQty: "Total Quantity − Damaged Qty.",
  undamagedAvailableQty: "Undamaged Quantity − Open SO Qty.",
  damagedQty: "Units carrying a damage reason.",
};
