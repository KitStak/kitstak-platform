/**
 * Inventory by Location grid (spec 04 §2): one row per ledger bucket
 * (SKU × location × LP × lot × expiry × production date × damage × pack type × status).
 * 39 columns (incl. select + actions) · 25 filters.
 */
import { AREA_TYPES, INVENTORY_STATUSES, LOCATION_TYPES } from "@/lib/enums";
import type { InventoryExportColumn, InventoryGridDef, InventoryGridField } from "./fields";

export const BY_LOCATION_GRID_KEY = "inventory-by-location";

export const BY_LOCATION_FIELDS: readonly InventoryGridField[] = [
  { field: "allocatedQty", label: "Allocated Quantity", type: "number" },
  { field: "client", label: "Client", type: "enum", dynamicOptions: "client", filterAlias: "clientId" },
  { field: "damageReason", label: "Damage Reason", type: "enum", dynamicOptions: "damageReason", allowEmpty: true },
  { field: "expiryDate", label: "Expiry Date", type: "date", dateOnly: true },
  { field: "location", label: "Location", type: "text" },
  { field: "locationGroup", label: "Location Group", type: "text" },
  { field: "locationZone", label: "Location Zone", type: "text" },
  { field: "lotNumber", label: "Lot Batch Number", type: "text" },
  { field: "lpNumber", label: "LP Number", type: "text" },
  { field: "lpType", label: "LP Type", type: "text" },
  { field: "mobileCart", label: "Mobile Cart", type: "text" },
  { field: "packType", label: "Pack Type", type: "text" },
  { field: "parentLpNumber", label: "Parent LP Number", type: "text" },
  { field: "parentLpType", label: "Parent LP Type", type: "text" },
  { field: "productGroup", label: "Product Group", type: "text" },
  { field: "productName", label: "Product Name", type: "text" },
  { field: "sku", label: "Product SKU", type: "text" },
  { field: "productType", label: "Product Type", type: "text" },
  { field: "barcode", label: "Product UPC", type: "text" },
  { field: "productionDate", label: "Production Date", type: "date", dateOnly: true },
  { field: "poNumber", label: "Purchase Order Number", type: "text" },
  { field: "receivedAt", label: "Receiving Date", type: "date" },
  { field: "status", label: "Status", type: "enum", options: INVENTORY_STATUSES },
  { field: "totalQty", label: "Total Quantity", type: "number" },
  { field: "warehouse", label: "Warehouse", type: "enum", dynamicOptions: "warehouse", filterAlias: "warehouseId" },
  // Column-only filters (not in Logiwa's list; useful and cheap): location & area type.
  { field: "locationType", label: "Location Type", type: "enum", options: LOCATION_TYPES, allowEmpty: true },
  { field: "areaType", label: "Area Type", type: "enum", options: AREA_TYPES, allowEmpty: true },
];

export const BY_LOCATION_DEF: InventoryGridDef = {
  gridKey: BY_LOCATION_GRID_KEY,
  fields: BY_LOCATION_FIELDS,
  sortable: [
    "client", "sku", "productName", "totalPackQty", "allocatedPackQty", "allocatedQty", "freePackQty", "freeQty",
    "lotNumber", "expiryDate", "productGroup", "warehouse", "location", "locationGroup", "locationZone",
    "locationType", "areaType", "replenishmentType", "walkingPathPriority", "lpNumber", "lpType", "status",
    "totalQty", "receivedAt", "productionDate", "damageReason", "packType",
  ],
  search: ["sku", "location", "lpNumber", "barcode"],
  defaultSort: ["sku", "location"],
};

export const BY_LOCATION_EXPORT_COLUMNS: readonly InventoryExportColumn[] = [
  { key: "client", label: "Client" },
  { key: "sku", label: "SKU" },
  { key: "barcode", label: "Barcode" },
  { key: "productName", label: "Product Name" },
  { key: "totalPackQty", label: "Total Pack Qty", type: "integer" },
  { key: "allocatedPackQty", label: "Allocated Pack Qty", type: "integer" },
  { key: "allocatedQty", label: "Allocated UOM Qty", type: "integer" },
  { key: "freePackQty", label: "Free Quantity", type: "integer" },
  { key: "freeQty", label: "Free UOM Qty", type: "integer" },
  { key: "packType", label: "Pack Type" },
  { key: "uomPackType", label: "UOM Pack Type" },
  { key: "totalQty", label: "UOM Quantity", type: "integer" },
  { key: "lotNumber", label: "Lot/Batch Number" },
  { key: "expiryDate", label: "Expiry Date", type: "date" },
  { key: "productType", label: "Product Type" },
  { key: "productGroup", label: "Product Group" },
  { key: "warehouse", label: "Warehouse" },
  { key: "location", label: "Location" },
  { key: "locationGroup", label: "Location Group" },
  { key: "locationZone", label: "Location Zone" },
  { key: "locationType", label: "Location Type" },
  { key: "areaType", label: "Area Type" },
  { key: "replenishmentType", label: "Replenishment Location Type" },
  { key: "walkingPathPriority", label: "Walking Path Priority", type: "integer" },
  { key: "poNumber", label: "PO Number" },
  { key: "lpNumber", label: "LPN" },
  { key: "parentLpNumber", label: "Parent LP" },
  { key: "originalLpNumber", label: "Original LP Number" },
  { key: "lpType", label: "LP Type" },
  { key: "parentLpType", label: "Parent LP Type" },
  { key: "originalParentLpNumber", label: "Original Parent LP" },
  { key: "mobileCart", label: "Mobile Cart" },
  { key: "status", label: "Inventory Status" },
  { key: "damageReason", label: "Damage Reason" },
  { key: "receivedAt", label: "Receiving Date", type: "datetime" },
  { key: "productionDate", label: "Production Date", type: "date" },
];

export const BY_LOCATION_TIPS: Readonly<Record<string, string>> = {
  totalPackQty: "On-hand quantity expressed in this row's pack type (UOM quantity ÷ units per pack, rounded down).",
  allocatedPackQty: "Allocated quantity expressed in this row's pack type.",
  allocatedQty: "Units reserved for shipment orders, work orders or jobs. They can't be removed or moved.",
  freePackQty: "Unallocated quantity in this row's pack type.",
  freeQty: "UOM Quantity − Allocated UOM Qty. This is what Remove, Transfer and Change Attributes act on.",
  walkingPathPriority: "Pick-path order of the location; lower is visited first.",
};
