/**
 * Available To Promise grid (spec 04 §3 / 07 §ATP): one row per SKU × warehouse.
 * Formulas live in `src/server/domain/atp.ts`; the header tips below describe them.
 */
import { KIT_TYPES } from "@/lib/enums";
import type { InventoryExportColumn, InventoryGridDef, InventoryGridField } from "./fields";

export const ATP_GRID_KEY = "inventory-atp";

export const ATP_FIELDS: readonly InventoryGridField[] = [
  { field: "client", label: "Client", type: "enum", dynamicOptions: "client", filterAlias: "clientId" },
  { field: "currentAtp", label: "Current ATP", type: "number" },
  { field: "damagedQty", label: "Damaged Quantity", type: "number" },
  { field: "kitType", label: "Kit Type", type: "enum", options: KIT_TYPES, allowEmpty: true },
  { field: "openPoQty", label: "Open PO Qty", type: "number" },
  { field: "openSoQty", label: "Open SO Qty", type: "number" },
  { field: "plannedAtp", label: "Planned ATP", type: "number" },
  { field: "productName", label: "Product Name", type: "text" },
  { field: "sku", label: "SKU", type: "text" },
  { field: "totalQty", label: "Total Quantity", type: "number" },
  { field: "undamagedQty", label: "Undamaged Quantity", type: "number" },
  { field: "warehouse", label: "Warehouse", type: "enum", dynamicOptions: "warehouse", filterAlias: "warehouseId" },
  { field: "pickableQty", label: "Pickable Qty", type: "number" },
  { field: "sellableQty", label: "Sellable Qty", type: "number" },
];

export const ATP_DEF: InventoryGridDef = {
  gridKey: ATP_GRID_KEY,
  fields: ATP_FIELDS,
  sortable: [
    "warehouse", "client", "sku", "productName", "totalQty", "damagedQty", "undamagedQty", "allocatedSoQty",
    "openSoQty", "openPoQty", "currentAtp", "plannedAtp", "onHandQty", "sellableQty", "pickableQty", "unallocatedSoQty",
  ],
  search: ["sku", "barcode"],
  defaultSort: ["currentAtp", "sku"],
};

export const ATP_TIPS: Readonly<Record<string, string>> = {
  totalQty: "Every on-hand unit in the warehouse, damaged included.",
  damagedQty: "Units carrying a damage reason.",
  undamagedQty: "Total Quantity − Damaged Qty.",
  allocatedSoQty: "Units allocated to open shipment orders (allocated through loaded).",
  openSoQty: "Units still to ship on open shipment orders.",
  openPoQty: "Units still to receive on open purchase orders.",
  currentAtp: "Undamaged Quantity − Open SO Qty. What you can promise from stock today.",
  plannedAtp: "Current ATP + Open PO Qty. What you can promise once open POs arrive.",
  onHandQty: "Every unit physically on hand in the warehouse (= Total Quantity, damaged included; Logiwa parity). Damaged is shown separately.",
  sellableQty: "Undamaged units in locations that sync inventory to channels, minus Open SO Qty. The quantity published to sales channels.",
  pickableQty: "Unallocated, undamaged Stock in active, unlocked locations that allow allocation.",
  unallocatedSoQty: "Open SO Qty − Allocated SO Item Qty. Demand still waiting for stock.",
};

export const ATP_EXPORT_COLUMNS: readonly InventoryExportColumn[] = [
  { key: "warehouse", label: "Warehouse" },
  { key: "client", label: "Client" },
  { key: "sku", label: "SKU" },
  { key: "productName", label: "Product Name" },
  { key: "barcode", label: "Barcode" },
  { key: "kitType", label: "Kit Type" },
  { key: "totalQty", label: "Total Quantity", type: "integer" },
  { key: "damagedQty", label: "Damaged Qty", type: "integer" },
  { key: "undamagedQty", label: "Undamaged Quantity", type: "integer" },
  { key: "allocatedSoQty", label: "Allocated SO Item Qty", type: "integer" },
  { key: "openSoQty", label: "Open SO Qty", type: "integer" },
  { key: "openPoQty", label: "Open PO Qty", type: "integer" },
  { key: "currentAtp", label: "Current ATP", type: "integer" },
  { key: "plannedAtp", label: "Planned ATP Qty", type: "integer" },
  { key: "onHandQty", label: "On Hand Qty", type: "integer" },
  { key: "sellableQty", label: "Sellable Qty", type: "integer" },
  { key: "pickableQty", label: "Pickable Qty", type: "integer" },
  { key: "unallocatedSoQty", label: "Unallocated SO Item Qty", type: "integer" },
];
