/** Catalog: products, pack types (UOM model), barcodes, kits, listings, serials. */
import { index, integer, primaryKey, doublePrecision, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import {
  ACTIVE_STATUSES,
  HAZMAT_TYPES,
  KIT_TYPES,
  PACK_TYPE_KINDS,
  PRODUCT_CATEGORIES,
  REPLENISHMENT_STRATEGIES,
  SERIAL_METHODS,
  SERIAL_STATUSES,
  TXN_TYPES,
} from "../../../lib/enums";
import { bool, customFields, json, nowIso, pk, stamps } from "../columns";
import { channelConnections } from "./integrations";
import { clients, warehouses } from "./org";

export interface ProductCustoms {
  declaredValue?: number;
  hsCode?: string;
  originCountry?: string;
  notDeclared?: boolean;
  manufacturer?: string;
  manufacturerProductId?: string;
  description?: string;
}

export interface ProductHazmat {
  hazmatId?: string;
  type?: (typeof HAZMAT_TYPES)[number];
  attribute?: string;
  quantity?: number;
  quantityType?: "Gross" | "Net";
  quantityUnit?: string;
  containerType?: string;
  properShippingName?: string;
  classDivision?: string;
}

/** Existing `price` == Sales Price, `uom` == primary pack type, `isHazmat` == hazmat switch. */
export const products = pgTable("products", {
  id: pk(),
  clientId: text("client_id").notNull().references(() => clients.id),
  sku: text("sku").notNull(),
  barcode: text("barcode").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  uom: text("uom").notNull().default("Each"),
  weightOz: doublePrecision("weight_oz").notNull(),
  lengthIn: doublePrecision("length_in").notNull(),
  widthIn: doublePrecision("width_in").notNull(),
  heightIn: doublePrecision("height_in").notNull(),
  price: doublePrecision("price").notNull(),
  isKit: bool("is_kit").notNull().default(false),
  isFragile: bool("is_fragile").notNull().default(false),
  isHazmat: bool("is_hazmat").notNull().default(false),
  status: text("status", { enum: ACTIVE_STATUSES }).notNull(),
  reorderPoint: integer("reorder_point").notNull().default(0),
  productCategory: text("product_category", { enum: PRODUCT_CATEGORIES }).notNull().default("Product"),
  kitType: text("kit_type", { enum: KIT_TYPES }),
  description: text("description"),
  imageUrl: text("image_url"),
  productTypeId: text("product_type_id"), // lookup_values (client-scoped)
  productGroupId: text("product_group_id"),
  currency: text("currency").notNull().default("USD"),
  purchasePrice: doublePrecision("purchase_price").notNull().default(0),
  taxRate: doublePrecision("tax_rate").notNull().default(0),
  minSafetyStock: integer("min_safety_stock").notNull().default(0),
  fnsku: text("fnsku"),
  isDigital: bool("is_digital").notNull().default(false),
  isFoldable: bool("is_foldable").notNull().default(false),
  isOversized: bool("is_oversized").notNull().default(false),
  isInsert: bool("is_insert").notNull().default(false),
  isStackable: bool("is_stackable").notNull().default(false),
  isPoster: bool("is_poster").notNull().default(false),
  isLiquid: bool("is_liquid").notNull().default(false),
  isNonReturnable: bool("is_non_returnable").notNull().default(false),
  packingInstructions: text("packing_instructions"),
  returnInstructions: text("return_instructions"),
  useShipPackageId: text("use_ship_package_id"),
  customs: json<ProductCustoms>("customs"),
  hazmat: json<ProductHazmat>("hazmat"),
  trackExpiry: bool("track_expiry").notNull().default(false),
  expiryReceivingOnly: bool("expiry_receiving_only").notNull().default(false),
  expiryFormat: text("expiry_format"),
  expiryScanMethod: text("expiry_scan_method"),
  shelfLifeDays: integer("shelf_life_days"),
  trackLot: bool("track_lot").notNull().default(false),
  lotReceivingOnly: bool("lot_receiving_only").notNull().default(false),
  autoCreateLot: bool("auto_create_lot").notNull().default(false),
  lotRegex: text("lot_regex"),
  lotScanMethod: text("lot_scan_method"),
  trackProductionDate: bool("track_production_date").notNull().default(false),
  productionReceivingOnly: bool("production_receiving_only").notNull().default(false),
  productionFormat: text("production_format"),
  productionScanMethod: text("production_scan_method"),
  replenishmentStrategy: text("replenishment_strategy", { enum: REPLENISHMENT_STRATEGIES }).notNull().default("Global"),
  replenishmentMin: integer("replenishment_min").notNull().default(0),
  replenishmentMax: integer("replenishment_max").notNull().default(0),
  trackSerial: bool("track_serial").notNull().default(false),
  trackSecondarySerial: bool("track_secondary_serial").notNull().default(false),
  serialMethod: text("serial_method", { enum: SERIAL_METHODS }),
  skipSerialScan: bool("skip_serial_scan").notNull().default(false),
  serialRegex: text("serial_regex"),
  ...customFields(),
  ...stamps(),
}, (t) => [
  uniqueIndex("products_sku_idx").on(t.clientId, t.sku),
  index("products_barcode_idx").on(t.barcode),
]);

export const productPackTypes = pgTable("product_pack_types", {
  id: pk(),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  packType: text("pack_type").notNull(), // lookup pack_type name
  kind: text("kind", { enum: PACK_TYPE_KINDS }).notNull(),
  parentPackTypeId: text("parent_pack_type_id"),
  childQty: integer("child_qty"),
  uomQty: integer("uom_qty").notNull().default(1),
  dimensionUnit: text("dimension_unit").notNull().default("Inch"),
  length: doublePrecision("length").notNull().default(0),
  width: doublePrecision("width").notNull().default(0),
  height: doublePrecision("height").notNull().default(0),
  volumeUnit: text("volume_unit").notNull().default("Cubic Inch"),
  volume: doublePrecision("volume").notNull().default(0),
  weightUnit: text("weight_unit").notNull().default("Pound"),
  weight: doublePrecision("weight").notNull().default(0),
  useShipPackageId: text("use_ship_package_id"),
  useOwnBox: bool("use_own_box").notNull().default(false),
  usePrimaryBarcodes: bool("use_primary_barcodes").notNull().default(false),
  ...stamps(),
}, (t) => [uniqueIndex("ppt_product_pack_idx").on(t.productId, t.packType)]);

export const productBarcodes = pgTable("product_barcodes", {
  id: pk(),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  packTypeId: text("pack_type_id").notNull().references(() => productPackTypes.id, { onDelete: "cascade" }),
  barcode: text("barcode").notNull(),
}, (t) => [index("product_barcodes_code_idx").on(t.barcode)]);

export const kitComponents = pgTable("kit_components", {
  id: pk(),
  kitProductId: text("kit_product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  componentProductId: text("component_product_id").notNull().references(() => products.id),
  quantity: integer("quantity").notNull(),
  packType: text("pack_type").notNull().default("Each"),
}, (t) => [uniqueIndex("kit_component_idx").on(t.kitProductId, t.componentProductId)]);

export const productReplenishmentLevels = pgTable("product_replenishment_levels", {
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  minLevel: integer("min_level").notNull(),
  maxLevel: integer("max_level").notNull(),
}, (t) => [primaryKey({ columns: [t.productId, t.warehouseId] })]);

export const productChannelAllocations = pgTable("product_channel_allocations", {
  id: pk(),
  productId: text("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  channelConnectionId: text("channel_connection_id").notNull().references(() => channelConnections.id),
  warehouseId: text("warehouse_id").references(() => warehouses.id),
  staticQty: integer("static_qty"),
  reserveQty: integer("reserve_qty"),
  allocationPct: doublePrecision("allocation_pct"),
  syncedQty: integer("synced_qty").notNull().default(0),
}, (t) => [index("pca_product_idx").on(t.productId)]);

export const productListings = pgTable("product_listings", {
  id: pk(),
  channelConnectionId: text("channel_connection_id").notNull().references(() => channelConnections.id),
  clientId: text("client_id").notNull().references(() => clients.id),
  productId: text("product_id").references(() => products.id),
  sellerSku: text("seller_sku").notNull(),
  channelProductId: text("channel_product_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  storePrice: doublePrecision("store_price"),
  imageUrl: text("image_url"),
  neverSync: bool("never_sync").notNull().default(false),
  linkedAt: text("linked_at"),
  lastSyncedQty: integer("last_synced_qty"),
  /** SKU of a suggestion the user dismissed ("Don't match these products"), catalog REQ-2. */
  dismissedSuggestionSku: text("dismissed_suggestion_sku"),
  ...stamps(),
}, (t) => [
  uniqueIndex("listing_unique_idx").on(t.channelConnectionId, t.channelProductId),
  index("listing_product_idx").on(t.productId),
]);

export const serialNumbers = pgTable("serial_numbers", {
  id: pk(),
  productId: text("product_id").notNull().references(() => products.id),
  warehouseId: text("warehouse_id").notNull(),
  clientId: text("client_id").notNull(),
  primarySerial: text("primary_serial").notNull(),
  secondarySerial: text("secondary_serial"),
  status: text("status", { enum: SERIAL_STATUSES }).notNull(),
  inventoryId: text("inventory_id"),
  receiptId: text("receipt_id"),
  orderLineId: text("order_line_id"),
  shipmentId: text("shipment_id"),
  entryAt: text("entry_at").notNull().$defaultFn(nowIso),
  ...stamps(),
}, (t) => [uniqueIndex("serial_unique_idx").on(t.productId, t.primarySerial)]);

export const serialTransactions = pgTable("serial_transactions", {
  id: pk(),
  serialId: text("serial_id").notNull().references(() => serialNumbers.id),
  inventoryTransactionId: text("inventory_transaction_id").notNull(),
  type: text("type", { enum: TXN_TYPES }).notNull(),
  status: text("status").notNull(),
  at: text("at").notNull().$defaultFn(nowIso),
}, (t) => [index("serial_txn_serial_idx").on(t.serialId)]);
