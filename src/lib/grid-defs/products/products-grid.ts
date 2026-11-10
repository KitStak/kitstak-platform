/**
 * Products grid definition (spec 05 §1): filter fields, sort keys, quick-search targets
 * and export columns. PURE: the client builds the filter builder from it (adding live
 * options) and `/api/products` compiles the same keys to SQL.
 */
import { PRODUCT_CATEGORIES } from "@/lib/enums";

export const PRODUCTS_GRID_KEY = "products";

export type ProductFieldType = "enum" | "text" | "number" | "boolean" | "date";
/** Where an enum field's options come from (filled by the client from /api/products/options). */
export type ProductOptionSource = "clients" | "productTypes" | "productGroups" | "packTypes";

export interface ProductGridField {
  readonly field: string;
  readonly label: string;
  readonly type: ProductFieldType;
  readonly options?: readonly string[];
  readonly optionsFrom?: ProductOptionSource;
  readonly decimals?: number;
  readonly group?: string;
}

const CF = "Custom fields";

export const PRODUCT_GRID_FIELDS: readonly ProductGridField[] = [
  { field: "barcode", label: "Barcode", type: "text" },
  { field: "clientId", label: "Client", type: "enum", optionsFrom: "clients" },
  { field: "createdAt", label: "Created date", type: "date" },
  { field: "fnsku", label: "FNSKU", type: "text" },
  { field: "isFoldable", label: "Foldable", type: "boolean" },
  { field: "isFragile", label: "Fragile", type: "boolean" },
  { field: "isHazmat", label: "Hazardous", type: "boolean" },
  { field: "isDigital", label: "Digital product", type: "boolean" },
  { field: "isKit", label: "Kit", type: "boolean" },
  { field: "isLiquid", label: "Liquid", type: "boolean" },
  { field: "name", label: "Name", type: "text" },
  { field: "isOversized", label: "Oversized", type: "boolean" },
  { field: "packType", label: "Pack type", type: "enum", optionsFrom: "packTypes" },
  { field: "isPackagingMaterial", label: "Packaging material", type: "boolean" },
  { field: "purchasePrice", label: "Price", type: "number", decimals: 2 },
  { field: "productCategory", label: "Product category", type: "enum", options: PRODUCT_CATEGORIES },
  { field: "productGroup", label: "Product group", type: "enum", optionsFrom: "productGroups" },
  { field: "productType", label: "Product type", type: "enum", optionsFrom: "productTypes" },
  { field: "isReturnable", label: "Returnable", type: "boolean" },
  { field: "salesPrice", label: "Sales price", type: "number", decimals: 2 },
  { field: "shelfLifeDays", label: "Shelf life", type: "number" },
  { field: "sku", label: "SKU", type: "text" },
  { field: "isStackable", label: "Stackable", type: "boolean" },
  { field: "status", label: "Status", type: "enum", options: ["Active", "Inactive"] },
  { field: "trackExpiry", label: "Track expiry date", type: "boolean" },
  { field: "trackLot", label: "Track lot/batch number", type: "boolean" },
  { field: "trackProductionDate", label: "Track production date", type: "boolean" },
  { field: "trackSerial", label: "Track serial number", type: "boolean" },
  { field: "onHand", label: "On hand", type: "number" },
  { field: "cfDate1", label: "Custom field date 1", type: "date", group: CF },
  { field: "cfDate2", label: "Custom field date 2", type: "date", group: CF },
  { field: "cfDate3", label: "Custom field date 3", type: "date", group: CF },
  { field: "cfDropDown1", label: "Custom field drop down 1", type: "text", group: CF },
  { field: "cfDropDown2", label: "Custom field drop down 2", type: "text", group: CF },
  { field: "cfTextBox1", label: "Custom field text box 1", type: "text", group: CF },
  { field: "cfTextBox2", label: "Custom field text box 2", type: "text", group: CF },
  { field: "cfTextBox3", label: "Custom field text box 3", type: "text", group: CF },
  { field: "cfToggle1", label: "Custom field toggle 1", type: "boolean", group: CF },
  { field: "cfToggle2", label: "Custom field toggle 2", type: "boolean", group: CF },
];

/** Custom-field filter key → `custom_fields` JSON slot. */
export const CUSTOM_FIELD_FILTERS: Readonly<Record<string, string>> = {
  cfDate1: "date1", cfDate2: "date2", cfDate3: "date3", cfDropDown1: "dropDown1", cfDropDown2: "dropDown2",
  cfTextBox1: "textBox1", cfTextBox2: "textBox2", cfTextBox3: "textBox3", cfToggle1: "toggle1", cfToggle2: "toggle2",
};

export const PRODUCT_SORT_FIELDS = [
  "clientName", "sku", "barcode", "name", "status", "productCategory", "isFragile", "isOversized", "isDigital", "isHazmat",
  "isInsert", "isLiquid", "isNonReturnable", "isPackagingMaterial", "isPoster", "isFoldable", "isStackable", "salesPrice",
  "purchasePrice", "uom", "trackLot", "trackExpiry", "productType", "productGroup", "description", "taxRate", "fnsku",
  "createdAt", "trackProductionDate", "onHand", "available",
] as const;

/** Quick search (Equal / Starts With): SKU, name, any pack-type barcode. */
export const PRODUCT_SEARCH_FIELDS = ["sku", "name", "barcode"] as const;

export interface ProductExportColumn {
  readonly key: string;
  readonly label: string;
  readonly type?: "text" | "integer" | "number" | "money" | "date" | "datetime" | "boolean";
}

export const PRODUCT_EXPORT_COLUMNS: readonly ProductExportColumn[] = [
  { key: "clientName", label: "Client" },
  { key: "sku", label: "SKU" },
  { key: "barcode", label: "Barcode" },
  { key: "name", label: "Name" },
  { key: "productCategory", label: "Category" },
  { key: "status", label: "Status" },
  { key: "isFragile", label: "Fragile", type: "boolean" },
  { key: "isOversized", label: "Oversized", type: "boolean" },
  { key: "isDigital", label: "Digital product", type: "boolean" },
  { key: "isHazmat", label: "Hazardous", type: "boolean" },
  { key: "isInsert", label: "Insert", type: "boolean" },
  { key: "isLiquid", label: "Liquid", type: "boolean" },
  { key: "isNonReturnable", label: "Non-returnable", type: "boolean" },
  { key: "isPackagingMaterial", label: "Packaging material", type: "boolean" },
  { key: "isPoster", label: "Poster", type: "boolean" },
  { key: "isFoldable", label: "Foldable", type: "boolean" },
  { key: "isStackable", label: "Stackable", type: "boolean" },
  { key: "salesPrice", label: "Sales price", type: "money" },
  { key: "purchasePrice", label: "Purchase price", type: "money" },
  { key: "uom", label: "UOM pack type" },
  { key: "trackLot", label: "Lot/batch number tracking", type: "boolean" },
  { key: "trackExpiry", label: "Expiry date tracking", type: "boolean" },
  { key: "productType", label: "Product type" },
  { key: "productGroup", label: "Product group" },
  { key: "description", label: "Description" },
  { key: "taxRate", label: "Tax rate", type: "number" },
  { key: "fnsku", label: "FNSKU" },
  { key: "createdAt", label: "Created date", type: "datetime" },
  { key: "trackProductionDate", label: "Production date tracking", type: "boolean" },
  { key: "onHand", label: "On hand", type: "integer" },
  { key: "available", label: "Available", type: "integer" },
];
