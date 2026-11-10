/**
 * Rule-builder catalogs for algorithms and workflows (spec 06 §3–§5). PURE: imported by the
 * condition/action/order-by modals and by the server validators.
 *
 * Every field key is a fact produced by the foundation fact builders (`orderFacts`,
 * `bucketFacts`, putaway `ruleFacts`), so a saved condition always evaluates.
 */
import type { RuleComparator } from "@/lib/enums";
import { ABC_CODES, ADDRESS_TYPES, AREA_TYPES, LOCATION_TYPES, ORDER_CHANNELS, PRIORITIES } from "@/lib/enums";

export type RuleValueKind = "text" | "number" | "date" | "boolean" | "enum" | "lookup" | "client" | "warehouse";

export interface RuleFieldDef {
  readonly key: string;
  readonly label: string;
  readonly kind: RuleValueKind;
  /** Static options for `enum`. */
  readonly options?: readonly string[];
  /** Data Setup type for `lookup` (values are lookup ids). */
  readonly lookup?: string;
  readonly group?: string;
}

const f = (key: string, label: string, kind: RuleValueKind, extra: Partial<RuleFieldDef> = {}): RuleFieldDef => ({ key, label, kind, ...extra });

/* ---------------- comparators ---------------- */

export const COMPARATOR_LABELS: Readonly<Record<RuleComparator, string>> = {
  equals: "equals", notEquals: "does not equal", contains: "contains", notContains: "excludes", startsWith: "starts with", endsWith: "ends with",
  in: "in", notIn: "not in", gt: "is greater than", gte: "is at least", lt: "is less than", lte: "is at most", between: "is between",
  isEmpty: "is empty", isNotEmpty: "is not empty",
};

const DATE_LABELS: Partial<Record<RuleComparator, string>> = { gt: "is after", lt: "is before", between: "is between", isEmpty: "is empty", isNotEmpty: "is not empty" };

export function comparatorsFor(kind: RuleValueKind): readonly RuleComparator[] {
  switch (kind) {
    case "enum": case "lookup": case "client": case "warehouse": return ["in", "notIn"];
    case "number": return ["gt", "lt", "between", "equals"];
    case "text": return ["equals", "contains", "startsWith", "endsWith", "notContains", "isEmpty", "isNotEmpty"];
    case "date": return ["gt", "lt", "between", "isEmpty", "isNotEmpty"];
    case "boolean": return ["equals"];
  }
}

export function comparatorLabel(kind: RuleValueKind, comparator: RuleComparator): string {
  return (kind === "date" ? DATE_LABELS[comparator] : undefined) ?? COMPARATOR_LABELS[comparator];
}

/** Comparators that take no value. */
export const VALUELESS: ReadonlySet<RuleComparator> = new Set(["isEmpty", "isNotEmpty"]);

/* ---------------- putaway conditions (spec 06 §3 "Add Condition") ---------------- */

export const PUTAWAY_CONDITION_FIELDS: readonly RuleFieldDef[] = [
  f("abcCode", "ABC Code", "enum", { options: ABC_CODES, group: "Source location" }),
  f("aisle", "Aisle", "text", { group: "Source location" }),
  f("areaType", "Area Type", "enum", { options: AREA_TYPES, group: "Source location" }),
  f("client", "Client", "client", { group: "Product" }),
  f("column", "Column", "text", { group: "Source location" }),
  f("damageReason", "Damage Reason", "text", { group: "Inventory" }),
  f("expiryDate", "Expiry Date", "date", { group: "Inventory" }),
  f("height", "Height", "number", { group: "Product" }),
  f("isReceivingProcess", "Is Receiving Process", "boolean", { group: "Process" }),
  f("length", "Length", "number", { group: "Product" }),
  f("level", "Level", "text", { group: "Source location" }),
  f("location", "Location", "text", { group: "Source location" }),
  f("locationGroup", "Location Group", "lookup", { lookup: "location_group", group: "Source location" }),
  f("locationType", "Location Type", "enum", { options: LOCATION_TYPES, group: "Source location" }),
  f("locationZone", "Location Zone", "lookup", { lookup: "location_zone", group: "Source location" }),
  f("lotBatchNumber", "Lot Batch Number", "text", { group: "Inventory" }),
  f("lpType", "LP Type", "text", { group: "License plate" }),
  f("productGroup", "Product Group", "lookup", { lookup: "product_group", group: "Product" }),
  f("productPackType", "Product Pack Type", "text", { group: "Product" }),
  f("productType", "Product Type", "lookup", { lookup: "product_type", group: "Product" }),
  f("productionDate", "Production Date", "date", { group: "Inventory" }),
  f("purchasePrice", "Purchase Price", "number", { group: "Product" }),
  f("receivingDate", "Receiving Date", "date", { group: "Inventory" }),
  f("replenishmentType", "Replenishment Type", "enum", { options: ["Source", "Target"], group: "Source location" }),
  f("sku", "SKU", "text", { group: "Product" }),
  f("transferQuantity", "Transfer Quantity", "number", { group: "Process" }),
  f("volume", "Volume", "number", { group: "Product" }),
  f("weight", "Weight", "number", { group: "Product" }),
  f("width", "Width", "number", { group: "Product" }),
];

/* ---------------- order conditions (allocation + workflows; spec 06 §4) ---------------- */

const cf = (slot: string, label: string, kind: RuleValueKind) => f(`customField.${slot}`, `SO Custom Field ${label}`, kind, { group: "Custom fields" });

export const ORDER_CONDITION_FIELDS: readonly RuleFieldDef[] = [
  f("client", "Client", "client", { group: "Order" }),
  f("warehouse", "Warehouse", "warehouse", { group: "Order" }),
  f("orderType", "Order Type", "text", { group: "Order" }),
  f("channel", "Channel", "enum", { options: ORDER_CHANNELS, group: "Order" }),
  f("store", "Store", "text", { group: "Order" }),
  f("priority", "Priority", "enum", { options: PRIORITIES, group: "Order" }),
  f("fraud", "Fraud", "boolean", { group: "Order" }),
  f("orderDate", "Shipment Order Date", "date", { group: "Dates" }),
  f("expectedShipmentDate", "Expected Shipment Date", "date", { group: "Dates" }),
  f("plannedShipmentDate", "Planned Shipment Date", "date", { group: "Dates" }),
  f("carrier", "Carrier", "text", { group: "Shipping" }),
  f("shipmentMethod", "Shipment Method", "text", { group: "Shipping" }),
  f("carrierRate", "Carrier Rate", "number", { group: "Shipping" }),
  f("shipAddress", "Address Line 1", "text", { group: "Ship to" }),
  f("shipAddress2", "Address Line 2", "text", { group: "Ship to" }),
  f("country", "Country", "text", { group: "Ship to" }),
  f("state", "State", "text", { group: "Ship to" }),
  f("city", "City", "text", { group: "Ship to" }),
  f("zip", "Zip Code", "text", { group: "Ship to" }),
  f("addressType", "Address Type", "enum", { options: ADDRESS_TYPES, group: "Ship to" }),
  f("customerName", "Customer Name", "text", { group: "Ship to" }),
  f("sku", "SKU", "text", { group: "Lines" }),
  f("productGroup", "Product Group", "lookup", { lookup: "product_group", group: "Lines" }),
  f("productType", "Product Type", "lookup", { lookup: "product_type", group: "Lines" }),
  f("productPackType", "Product Pack Type", "text", { group: "Lines" }),
  f("orderTag", "Order Tag", "text", { group: "Order" }),
  f("orderQuantity", "Order Quantity", "number", { group: "Lines" }),
  f("lineCount", "Number of Lines", "number", { group: "Lines" }),
  f("orderPrice", "Order Price", "number", { group: "Order" }),
  f("isBackOrder", "Is Back Order", "boolean", { group: "Order" }),
  f("isGift", "Is Gift", "boolean", { group: "Order" }),
  f("isOversized", "Is Oversized", "boolean", { group: "Lines" }),
  f("isPrime", "Is Prime", "boolean", { group: "Order" }),
  cf("textBox1", "TextBox 1", "text"), cf("textBox2", "TextBox 2", "text"), cf("textBox3", "TextBox 3", "text"),
  cf("dropDown1", "DropDown 1", "text"), cf("dropDown2", "DropDown 2", "text"),
  cf("date1", "DateTime 1", "date"), cf("date2", "DateTime 2", "date"),
  cf("toggle1", "Toggle 1", "boolean"), cf("toggle2", "Toggle 2", "boolean"),
];

/* ---------------- allocation inventory conditions (spec 06 §4 "Then*") ---------------- */

export const INVENTORY_CONDITION_FIELDS: readonly RuleFieldDef[] = [
  f("locationGroup", "Location Group", "lookup", { lookup: "location_group", group: "Location" }),
  f("locationZone", "Location Zone", "lookup", { lookup: "location_zone", group: "Location" }),
  f("areaType", "Area Type", "enum", { options: AREA_TYPES, group: "Location" }),
  f("isPreventInventorySync", "Is Prevent Inventory Sync", "boolean", { group: "Location" }),
  f("isPreventAllocation", "Is Prevent Allocation", "boolean", { group: "Location" }),
  f("isAllowOnlyDamaged", "Is Allow Only Damaged", "boolean", { group: "Location" }),
  f("isPreventMultiClient", "Is Prevent Multi Client", "boolean", { group: "Location" }),
  f("assignedClient", "Assigned Client", "client", { group: "Location" }),
  f("abcCode", "ABC Code", "enum", { options: ABC_CODES, group: "Location" }),
  f("replenishmentType", "Replenishment Type", "enum", { options: ["Source", "Target"], group: "Location" }),
  f("locationType", "Location Type", "enum", { options: LOCATION_TYPES, group: "Location" }),
  f("level", "Level", "text", { group: "Location" }),
  f("column", "Column", "text", { group: "Location" }),
  f("aisle", "Aisle", "text", { group: "Location" }),
  f("location", "Location", "text", { group: "Location" }),
  f("walkingPathPriority", "Walking Path Priority", "number", { group: "Location" }),
  f("lpNumber", "LP Number", "text", { group: "Inventory" }),
  f("inventoryDamageReason", "Inventory Damage Reason", "text", { group: "Inventory" }),
  f("inventoryLotBatchNumber", "Inventory Lot Batch Number", "text", { group: "Inventory" }),
  f("inventoryExpiryDate", "Inventory Expiry Date", "date", { group: "Inventory" }),
  f("inventoryUomPackType", "Inventory UOM Pack Type", "text", { group: "Inventory" }),
  f("inventoryPackType", "Inventory Pack Type", "text", { group: "Inventory" }),
  f("inventoryProductionDate", "Inventory Production Date", "date", { group: "Inventory" }),
  f("inventoryReceivingDate", "Inventory Receiving Date", "date", { group: "Inventory" }),
  f("freeInventory", "Free Inventory", "number", { group: "Inventory" }),
];

/* ---------------- order by ---------------- */

export interface OrderByMethod {
  readonly key: string;
  readonly label: string;
}

export const PUTAWAY_ORDER_BY: readonly OrderByMethod[] = [
  { key: "aisle", label: "Aisle" }, { key: "allocatedQuantity", label: "Allocated Quantity" }, { key: "column", label: "Column" },
  { key: "level", label: "Level" }, { key: "locationEmptyVolume", label: "Location Empty Volume" }, { key: "lpCountInLocation", label: "LP Count in Location" },
  { key: "skuCountInLocation", label: "SKU Count in Location" }, { key: "totalInventoryQuantity", label: "Total Inventory Quantity" },
  { key: "walkingPathPriority", label: "Walking Path Priority" }, { key: "zonePriority", label: "Zone Priority" },
];

export const ALLOCATION_ORDER_BY: readonly OrderByMethod[] = [
  { key: "aisle", label: "Aisle" }, { key: "level", label: "Level" }, { key: "column", label: "Column" },
  { key: "walkingPathPriority", label: "Walking Path Priority" }, { key: "abcCode", label: "ABC Code" }, { key: "areaType", label: "Area Type" },
  { key: "freeInventory", label: "Free Inventory" }, { key: "inventoryLotBatchNumber", label: "Lot Batch Number" },
  { key: "inventoryExpiryDate", label: "Expiry Date" }, { key: "inventoryProductionDate", label: "Production Date" },
  { key: "inventoryReceivingDate", label: "Receiving Date" },
];

/* ---------------- putaway actions (38; keys match domain/putaway-actions.ts) ---------------- */

export type ActionParamKind = "none" | "number" | "text" | "enum" | "lookup" | "location";

export interface PutawayActionDef {
  readonly key: string;
  readonly label: string;
  readonly param: ActionParamKind;
  readonly paramLabel?: string;
  readonly options?: readonly string[];
  readonly lookup?: string;
  readonly kind: "check" | "suggest";
}

const a = (key: string, label: string, param: ActionParamKind = "none", extra: Partial<PutawayActionDef> = {}): PutawayActionDef =>
  ({ key, label, param, kind: key.startsWith("suggest") ? "suggest" : "check", ...extra });

export const PUTAWAY_ACTION_DEFS: readonly PutawayActionDef[] = [
  a("checkAssignedSkus", "Check Assigned SKUs"),
  a("checkDamagedLocations", "Check Damaged Locations"),
  a("checkLocationCapacity", "Check Location Capacity"),
  a("checkLocationCapacityType", "Check Location Capacity Type"),
  a("checkMaxLocationsPerSku", "Check Max Locations per SKU", "number", { paramLabel: "Max locations per SKU" }),
  a("checkMaxSkuCount", "Check Max Sku Count"),
  a("checkProductGroupLocationZoneMatch", "Check Product Group & Location Zone Match"),
  a("checkSameClient", "Check Same Client"),
  a("checkSameDamagedReason", "Check Same Damaged Reason"),
  a("checkSameExpiryDate", "Check Same Expiry Date"),
  a("checkSameLotBatchNumber", "Check Same Lot Batch Number"),
  a("checkSameProductGroup", "Check Same Product Group"),
  a("checkSameProductType", "Check Same Product Type"),
  a("checkSameProductionDate", "Check the Same Production Date"),
  a("checkSameReceivingDate", "Check the Same Receiving Date"),
  a("configureVolumetricPutaway", "Configure Volumetric Putaway"),
  a("suggestSameSkuSamePackType", "Suggest a location that has inventory of the same SKU & same pack type"),
  a("suggestSelectedProductGroup", "Suggest a location that has inventory of the selected product group", "lookup", { lookup: "product_group", paramLabel: "Product group" }),
  a("suggestSelectedProductType", "Suggest a location that has inventory of the selected product type", "lookup", { lookup: "product_type", paramLabel: "Product type" }),
  a("suggestSelectedPackType", "Suggest a location that has inventory of this selected pack type", "text", { paramLabel: "Pack type" }),
  a("suggestSameSku", "Suggest a location that has the same SKU"),
  a("suggestAllocationPrevented", "Suggest a location where the allocation is prevented"),
  a("suggestInventorySyncPrevented", "Suggest a location where the inventory sync to stores is prevented"),
  a("suggestAisle", "Suggest a location with the entered aisle", "text", { paramLabel: "Aisle" }),
  a("suggestColumn", "Suggest a location with the entered column", "text", { paramLabel: "Column" }),
  a("suggestHeight", "Suggest a location with the entered height", "number", { paramLabel: "Height" }),
  a("suggestLength", "Suggest a location with the entered length", "number", { paramLabel: "Length" }),
  a("suggestLevel", "Suggest a location with the entered level", "text", { paramLabel: "Level" }),
  a("suggestVolume", "Suggest a location with the entered volume", "number", { paramLabel: "Volume" }),
  a("suggestWidth", "Suggest a location with the entered width", "number", { paramLabel: "Width" }),
  a("suggestAbcCode", "Suggest a location with the selected ABC Code", "enum", { options: ABC_CODES, paramLabel: "ABC code" }),
  a("suggestAreaType", "Suggest a location with the selected area type", "enum", { options: AREA_TYPES, paramLabel: "Area type" }),
  a("suggestLocationGroup", "Suggest a location with the selected location group", "lookup", { lookup: "location_group", paramLabel: "Location group" }),
  a("suggestLocationType", "Suggest a location with the selected location type", "enum", { options: LOCATION_TYPES, paramLabel: "Location type" }),
  a("suggestLocationZone", "Suggest a location with the selected location zone", "lookup", { lookup: "location_zone", paramLabel: "Location zone" }),
  a("suggestReplenishmentType", "Suggest a location with the selected replenishment type", "enum", { options: ["Source", "Target"], paramLabel: "Replenishment type" }),
  a("suggestEmptyLocation", "Suggest an empty location"),
  a("suggestExactLocation", "Suggest exactly the selected location", "location", { paramLabel: "Location" }),
];

const ACTION_BY_KEY = new Map(PUTAWAY_ACTION_DEFS.map((d) => [d.key, d]));
export const putawayActionDef = (key: string): PutawayActionDef | undefined => ACTION_BY_KEY.get(key);

const byKey = (list: readonly RuleFieldDef[]) => new Map(list.map((d) => [d.key, d]));
const MAPS = {
  putaway: byKey(PUTAWAY_CONDITION_FIELDS),
  order: byKey(ORDER_CONDITION_FIELDS),
  inventory: byKey(INVENTORY_CONDITION_FIELDS),
} as const;
export type ConditionCatalog = keyof typeof MAPS;

export const CONDITION_CATALOGS: Readonly<Record<ConditionCatalog, readonly RuleFieldDef[]>> = {
  putaway: PUTAWAY_CONDITION_FIELDS, order: ORDER_CONDITION_FIELDS, inventory: INVENTORY_CONDITION_FIELDS,
};

export function fieldDef(catalog: ConditionCatalog, key: string): RuleFieldDef | undefined {
  return MAPS[catalog].get(key);
}

const ORDER_BY_LABEL = new Map([...PUTAWAY_ORDER_BY, ...ALLOCATION_ORDER_BY].map((m) => [m.key, m.label]));
export const orderByLabel = (key: string): string => ORDER_BY_LABEL.get(key) ?? key;

/** Plain-text fallback summary ("If Area Type in Picking, Storage"); the UI swaps ids for names. */
export function describeCondition(catalog: ConditionCatalog, c: { field: string; comparator: RuleComparator; value: unknown }, names: (id: string) => string = (v) => v): string {
  const def = fieldDef(catalog, c.field);
  const kind = def?.kind ?? "text";
  const label = def?.label ?? c.field;
  const verb = comparatorLabel(kind, c.comparator);
  if (VALUELESS.has(c.comparator)) return `${label} ${verb}`;
  const list = Array.isArray(c.value) ? c.value : [c.value];
  const shown = list.map((v) => (v === null || v === "" ? "Empty" : typeof v === "boolean" ? (v ? "true" : "false") : names(String(v))));
  return `${label} ${verb} ${c.comparator === "between" ? shown.join(" and ") : shown.join(", ")}`;
}
