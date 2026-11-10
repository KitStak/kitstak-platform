/** Template columns for master-data imports (catalog, facility, organization, users). PURE. */
import type { ImportColumn } from "../types";
import { addressColumns, bool, int, num, oneOf, req, text } from "./helpers";

const ACTIVE = ["Active", "Inactive"] as const;
const ASSIGN = ["Assign", "Unassign"] as const;

export const PRODUCT_COLUMNS: readonly ImportColumn[] = [
  req("clientCode", "Client Code", "ACME"),
  req("sku", "SKU", "WIDGET-RED"),
  req("name", "Name", "Widget - Red"),
  req("barcode", "Barcode", "012345678905"),
  text("description", "Description", "Red widget, single unit", { maxLength: 1000 }),
  text("productGroup", "Product Group", "Widgets"),
  oneOf("productType", "Product Type", ["Simple", "Kit", "Bundle"]),
  text("uom", "UOM", "Each"),
  num("weight", "Weight (lb)", "0.5"),
  num("length", "Length (in)", "4"),
  num("width", "Width (in)", "3"),
  num("height", "Height (in)", "2"),
  num("unitPrice", "Unit Price", "19.99"),
  num("unitCost", "Unit Cost", "4.25"),
  bool("trackLot", "Track Lot"),
  bool("trackExpiry", "Track Expiry"),
  bool("trackSerial", "Track Serial"),
  oneOf("status", "Status", ACTIVE),
];

export const PRODUCT_UPDATE_COLUMNS: readonly ImportColumn[] = [
  req("clientCode", "Client Code", "ACME"),
  req("sku", "SKU", "WIDGET-RED"),
  ...PRODUCT_COLUMNS.slice(2).map((column) => ({ ...column, required: false })),
];

export const PACK_TYPE_COLUMNS: readonly ImportColumn[] = [
  req("clientCode", "Client Code", "ACME"),
  req("sku", "SKU", "WIDGET-RED"),
  req("packType", "Pack Type", "Case"),
  int("uomQty", "UOM Quantity", "12", { required: true, min: 1 }),
  text("barcode", "Barcode", "10012345678902"),
  num("weight", "Weight (lb)", "6"),
  num("length", "Length (in)", "12"),
  num("width", "Width (in)", "10"),
  num("height", "Height (in)", "8"),
];

export const REPLENISHMENT_LEVEL_COLUMNS: readonly ImportColumn[] = [
  req("warehouseCode", "Warehouse Code", "MLT1"),
  req("clientCode", "Client Code", "ACME"),
  req("sku", "SKU", "WIDGET-RED"),
  int("minQty", "Min Quantity", "10", { required: true }),
  int("maxQty", "Max Quantity", "50", { required: true }),
];

export const SKU_ALLOCATION_COLUMNS: readonly ImportColumn[] = [
  req("warehouseCode", "Warehouse Code", "MLT1"),
  req("clientCode", "Client Code", "ACME"),
  req("sku", "SKU", "WIDGET-RED"),
  req("channel", "Channel", "Shopify"),
  num("allocationPercent", "Allocation %", "50", { max: 100 }),
  int("allocationQty", "Allocation Quantity", ""),
];

export const KIT_COMPONENT_COLUMNS: readonly ImportColumn[] = [
  req("clientCode", "Client Code", "ACME"),
  req("kitSku", "Kit SKU", "GIFT-BOX-1"),
  req("componentSku", "Component SKU", "WIDGET-RED"),
  int("quantity", "Quantity", "2", { required: true, min: 1 }),
];

export const LISTING_COLUMNS: readonly ImportColumn[] = [
  req("channel", "Channel", "Shopify"),
  req("clientCode", "Client Code", "ACME"),
  req("channelSku", "Channel SKU", "SHOP-WIDGET-RED"),
  text("sku", "SKU", "WIDGET-RED", { description: "Links the listing to a KitStaks product" }),
  text("title", "Title", "Widget (Red)"),
  bool("neverSync", "Never Sync"),
];

export const LOCATION_COLUMNS: readonly ImportColumn[] = [
  req("warehouseCode", "Warehouse Code", "MLT1"),
  req("code", "Location Code", "A-01-01-01"),
  text("zone", "Zone", "A"),
  text("aisle", "Aisle", "01"),
  text("column", "Column", "01"),
  text("level", "Level", "01"),
  text("position", "Position", "01"),
  text("locationType", "Location Type", "Shelf"),
  text("areaType", "Area Type", "Pick"),
  text("locationGroup", "Location Group", "Fast movers"),
  int("walkingPathPriority", "Walking Path Priority", "100"),
  text("clientCode", "Client Code", "", { description: "Dedicate the location to one client" }),
  bool("isPickable", "Is Pickable", "Yes"),
  oneOf("status", "Status", ACTIVE),
];

export const LOCATION_UPDATE_COLUMNS: readonly ImportColumn[] = [
  req("warehouseCode", "Warehouse Code", "MLT1"),
  req("code", "Location Code", "A-01-01-01"),
  ...LOCATION_COLUMNS.slice(2).map((column) => ({ ...column, required: false })),
];

export const PRODUCT_CAPACITY_COLUMNS: readonly ImportColumn[] = [
  req("warehouseCode", "Warehouse Code", "MLT1"),
  req("locationCode", "Location Code", "A-01-01-01"),
  req("clientCode", "Client Code", "ACME"),
  req("sku", "SKU", "WIDGET-RED"),
  int("maxQty", "Max Quantity", "48", { required: true, min: 1 }),
  int("minQty", "Min Quantity", "12"),
];

export const LP_CAPACITY_COLUMNS: readonly ImportColumn[] = [
  req("warehouseCode", "Warehouse Code", "MLT1"),
  req("locationCode", "Location Code", "B-01-01"),
  req("lpType", "LP Type", "Pallet"),
  int("maxLps", "Max LP Count", "2", { required: true, min: 1 }),
];

export const LP_NUMBER_COLUMNS: readonly ImportColumn[] = [
  req("warehouseCode", "Warehouse Code", "MLT1"),
  req("lpType", "LP Type", "Pallet"),
  req("number", "LP Number", "LP000101"),
  text("alternateBarcode", "Alternate Barcode", ""),
  text("locationCode", "Location Code", ""),
  bool("isSscc18", "Is SSCC-18"),
];

export const CLIENT_COLUMNS: readonly ImportColumn[] = [
  req("code", "Client Code", "ACME"),
  req("name", "Client Name", "Acme Corporation"),
  text("contactName", "Contact Name", "Jane Doe"),
  text("email", "Email", "ops@acme.example"),
  text("phone", "Phone", "512-555-0100"),
  ...addressColumns("billing", "Billing").filter((column) => !/Name$|Company$|Phone$|Email$/.test(column.key)),
  oneOf("status", "Status", ACTIVE),
];

export const VAS_OPERATION_COLUMNS: readonly ImportColumn[] = [
  req("warehouseCode", "Warehouse Code", "MLT1"),
  req("clientCode", "Client Code", "ACME"),
  req("vasType", "VAS Type", "Labeling"),
  req("referenceCode", "Order / PO Code", "SO000123"),
  num("quantity", "Quantity", "10", { required: true }),
  text("notes", "Notes", "", { maxLength: 1000 }),
];

export const USER_COLUMNS: readonly ImportColumn[] = [
  req("email", "Email", "operator@example.com", { maxLength: 254 }),
  req("name", "Full Name", "Sam Operator"),
  // KitStak user types; the handler also maps the legacy Logiwa values (Web, Mobile, Web & Mobile) to Operation.
  oneOf("userType", "User Type", ["Operation", "Client"], { required: true }),
  text("roleName", "Role", "Operator"),
  text("defaultWarehouseCode", "Default Warehouse Code", "MLT1"),
  bool("allClients", "All Clients", "Yes"),
  oneOf("status", "Status", ACTIVE),
];

export const USER_ROLE_COLUMNS: readonly ImportColumn[] = [
  req("email", "Email", "operator@example.com", { maxLength: 254 }),
  req("roleName", "Role", "Operator"),
  oneOf("action", "Action", ASSIGN, { required: true }),
];

export const USER_WAREHOUSE_COLUMNS: readonly ImportColumn[] = [
  req("email", "Email", "operator@example.com", { maxLength: 254 }),
  req("warehouseCode", "Warehouse Code", "MLT1"),
  oneOf("action", "Action", ASSIGN, { required: true }),
];

export const USER_CLIENT_COLUMNS: readonly ImportColumn[] = [
  req("email", "Email", "operator@example.com", { maxLength: 254 }),
  req("clientCode", "Client Code", "ACME"),
  oneOf("action", "Action", ASSIGN, { required: true }),
];
