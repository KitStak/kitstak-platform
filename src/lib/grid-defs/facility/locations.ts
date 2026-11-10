/**
 * Locations grid + forms (M10). PURE: shared by the client grid/wizard and the server
 * compiler/validators. Field keys are the `f.<field>` / `sort=<field>` names.
 */
import { z } from "zod";
import { ABC_CODES, AREA_TYPES, CAPACITY_TYPES, DIMENSION_UNITS, LOCATION_TYPES, VOLUME_UNITS } from "@/lib/enums";
import { nonNegative, nonNegativeInt, optionalId, optionalText, requiredId, requiredText, versionField, type FacilityField } from "./common";

export const LOCATIONS_GRID_KEY = "locations";
export const REPLENISHMENT_TYPES = ["Source", "Target"] as const;
export const INVENTORY_STATUSES_DERIVED = ["Available", "Occupied"] as const;

export const LOCATION_FIELDS: readonly FacilityField[] = [
  { field: "code", label: "Location code", type: "text" },
  { field: "displayMember", label: "Display member", type: "text" },
  { field: "barcode", label: "Location barcode", type: "text" },
  { field: "warehouseId", label: "Warehouse", type: "enum" },
  { field: "locationGroupId", label: "Location group", type: "enum" },
  { field: "locationZoneId", label: "Location zone", type: "enum" },
  { field: "locationType", label: "Location type", type: "enum", options: LOCATION_TYPES },
  { field: "replenishmentType", label: "Replenishment type", type: "enum", options: REPLENISHMENT_TYPES },
  { field: "areaType", label: "Area type", type: "enum", options: AREA_TYPES },
  { field: "assignedMobileCart", label: "Assigned mobile cart", type: "text" },
  { field: "walkingPathPriority", label: "Walking path priority", type: "number" },
  { field: "level", label: "Level", type: "text" },
  { field: "mezzanine", label: "Mezzanine", type: "text" },
  { field: "aisle", label: "Aisle", type: "text" },
  { field: "rack", label: "Rack", type: "text" },
  { field: "position", label: "Position", type: "text" },
  { field: "column", label: "Column", type: "number" },
  { field: "height", label: "Height", type: "number", decimals: 2 },
  { field: "volume", label: "Volume", type: "number", decimals: 5 },
  { field: "abcCode", label: "ABC code", type: "enum", options: ABC_CODES },
  { field: "isLocked", label: "Locked", type: "boolean" },
  { field: "inventoryStatus", label: "Inventory status", type: "enum", options: INVENTORY_STATUSES_DERIVED },
  { field: "hasInventory", label: "Has inventory", type: "boolean" },
  { field: "preventAllocation", label: "Prevent allocation", type: "boolean" },
  { field: "dedicatedClientId", label: "Client", type: "enum" },
  { field: "createdAt", label: "Created date", type: "date" },
];

export const LOCATION_SORT_FIELDS = [
  "code", "displayMember", "barcode", "warehouseCode", "locationGroup", "locationZone", "locationType", "replenishmentType",
  "areaType", "assignedMobileCart", "walkingPathPriority", "level", "mezzanine", "aisle", "rack", "position", "column",
  "height", "volume", "abcCode", "isLocked", "inventoryStatus", "preventAllocation", "dedicatedClient", "storedUnits", "createdAt",
] as const;

/**
 * Optional whole number: blank stays null (never a fake 0). Until REQ-2 makes the integer
 * columns nullable, the repository stores null as 0 and reads 0 back as "not set", so a
 * 0 walking path / column / level is treated as blank everywhere.
 */
export const optionalInt = (label: string, max: number) => nonNegativeInt(label, max).nullable().optional().transform((v) => v ?? null);

/** Reads a stored integer / level text where 0 or "" means "not set". */
export function unsetAsNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

export const LOCATION_SEARCH_FIELDS = ["code", "barcode"] as const;

/** The 10 location-rule checkboxes (Logiwa "Location Rules"). */
export const LOCATION_RULES = [
  { key: "preventAllocation", label: "Prevent allocation", hint: "Stock here is never allocated to orders" },
  { key: "preventInventorySync", label: "Prevent inventory sync to stores", hint: "Excluded from channel inventory feeds" },
  { key: "onlyOneLot", label: "Only 1 lot number", hint: "Blocks mixing lots in this location" },
  { key: "onlyDamaged", label: "Only damaged items", hint: "Only damaged stock may be put here" },
  { key: "onlyOneExpiry", label: "Only 1 expiration date", hint: "Blocks mixing expiry dates" },
  { key: "onlyOneSku", label: "Only 1 SKU", hint: "A second SKU is rejected on putaway and transfer" },
  { key: "onlyOneLp", label: "Only 1 LP", hint: "One license plate at a time" },
  { key: "onlyOneProductionDate", label: "Only 1 production date", hint: "Blocks mixing production dates" },
  { key: "autoRemoveLpAfterReplenishment", label: "Auto remove LP after replenishment", hint: "LP is released when replenishment lands" },
  { key: "autoRemoveLpAfterTransfer", label: "Auto remove LP after transfer", hint: "LP is released when stock is transferred in" },
] as const;

export type LocationRuleKey = (typeof LOCATION_RULES)[number]["key"];

const rules = Object.fromEntries(LOCATION_RULES.map((r) => [r.key, z.boolean().default(false)])) as Record<LocationRuleKey, z.ZodDefault<z.ZodBoolean>>;

export const locationInfoSchema = z.object({
  code: requiredText("Location code", 60).regex(/^[A-Za-z0-9][A-Za-z0-9._\-/ ]*$/, "Use letters, numbers, dot, dash, slash or underscore"),
  warehouseId: requiredId("Warehouse"),
  locationGroupId: optionalId(),
  locationZoneId: optionalId(),
  locationType: z.enum(LOCATION_TYPES, { error: "Location type is required" }),
  areaType: z.enum(AREA_TYPES, { error: "Area type is required" }),
  replenishmentType: z.enum(REPLENISHMENT_TYPES).nullable().optional().transform((v) => v ?? null),
  walkingPathPriority: optionalInt("Walking path priority", 999_999),
  capacityType: z.enum(CAPACITY_TYPES),
  maxCapacityQty: nonNegativeInt("Maximum capacity quantity"),
  maxSkuQty: nonNegativeInt("Maximum SKU quantity", 10_000).nullable().optional().transform((v) => v ?? null),
  mezzanine: optionalText(100),
  aisle: optionalText(40),
  rack: optionalText(40),
  column: optionalInt("Column", 9999),
  level: optionalInt("Level", 999),
  position: optionalText(40),
  dimensionUnit: z.enum(DIMENSION_UNITS),
  height: nonNegative("Height"),
  width: nonNegative("Width"),
  length: nonNegative("Length"),
  volumeUnit: z.enum(VOLUME_UNITS),
  volume: nonNegative("Volume", 1_000_000_000),
  displayMember: optionalText(100),
  barcode: optionalText(120),
  abcCode: z.enum(ABC_CODES),
  singleClient: z.boolean(),
  isLocked: z.boolean(),
  dedicatedClientId: optionalId(),
  printApplyOnPacking: z.boolean(),
  colorCode: optionalText(20),
  ...rules,
}).superRefine((v, ctx) => {
  if (v.capacityType !== "None" && v.maxCapacityQty <= 0) {
    ctx.addIssue({ code: "custom", path: ["maxCapacityQty"], message: "Set a maximum capacity above 0 for this capacity type" });
  }
  if (v.singleClient && !v.dedicatedClientId) {
    ctx.addIssue({ code: "custom", path: ["dedicatedClientId"], message: "Pick the client this location is dedicated to" });
  }
});

export const productCapacitySchema = z.object({
  clientId: requiredId("Client"),
  productId: requiredId("Product"),
  packType: requiredText("Pack type", 60),
  minQty: nonNegativeInt("Min qty"),
  maxQty: nonNegativeInt("Max qty"),
}).refine((v) => v.maxQty >= v.minQty, { path: ["maxQty"], message: "Max qty must be at least the min qty" })
  .refine((v) => v.maxQty > 0, { path: ["maxQty"], message: "Max qty must be above 0" });

export const lpCapacitySchema = z.object({
  lpTypeId: requiredId("LP type"),
  minQty: nonNegativeInt("Min qty"),
  maxQty: nonNegativeInt("Max qty"),
  assignProduct: z.boolean().default(false),
  clientId: optionalId(),
  productId: optionalId(),
}).superRefine((v, ctx) => {
  if (v.maxQty < v.minQty) ctx.addIssue({ code: "custom", path: ["maxQty"], message: "Max qty must be at least the min qty" });
  if (v.maxQty <= 0) ctx.addIssue({ code: "custom", path: ["maxQty"], message: "Max qty must be above 0" });
  if (v.assignProduct && !v.clientId) ctx.addIssue({ code: "custom", path: ["clientId"], message: "Client is required" });
  if (v.assignProduct && !v.productId) ctx.addIssue({ code: "custom", path: ["productId"], message: "Product is required" });
});

export const locationSaveSchema = z.object({
  info: locationInfoSchema,
  productCapacities: z.array(productCapacitySchema).max(200).default([]),
  lpCapacities: z.array(lpCapacitySchema).max(200).default([]),
  version: versionField,
}).superRefine((v, ctx) => {
  const seen = new Set<string>();
  v.productCapacities.forEach((c, i) => {
    const key = `${c.productId}|${c.packType}`;
    if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["productCapacities", i, "productId"], message: "This product and pack type already has a capacity" });
    seen.add(key);
  });
});

export type LocationInfoInput = z.input<typeof locationInfoSchema>;
export type LocationSaveInput = z.input<typeof locationSaveSchema>;
export type LocationSave = z.output<typeof locationSaveSchema>;

export const LOCATION_INFO_DEFAULTS: LocationInfoInput = {
  code: "", warehouseId: "", locationGroupId: null, locationZoneId: null,
  locationType: "Shelves", areaType: "Picking", replenishmentType: null, walkingPathPriority: null,
  capacityType: "None", maxCapacityQty: 0, maxSkuQty: null,
  mezzanine: "", aisle: "", rack: "", column: null, level: null, position: "",
  dimensionUnit: "Inch", height: 0, width: 0, length: 0, volumeUnit: "Cubic Inch", volume: 0,
  displayMember: "", barcode: "", abcCode: "None", singleClient: false, isLocked: false, dedicatedClientId: null,
  printApplyOnPacking: false, colorCode: "",
  preventAllocation: false, preventInventorySync: false, onlyOneLot: false, onlyDamaged: false, onlyOneExpiry: false,
  onlyOneSku: false, onlyOneLp: false, onlyOneProductionDate: false, autoRemoveLpAfterReplenishment: false, autoRemoveLpAfterTransfer: false,
};

/** Legacy role column, derived from the authoritative area type. */
export function legacyRoleFor(areaType: (typeof AREA_TYPES)[number]): "Picking" | "Reserve" | "Receiving" | "Shipping" | "Returns" | "Damaged" {
  switch (areaType) {
    case "Picking": return "Picking";
    case "Receiving": return "Receiving";
    case "Returns": return "Returns";
    case "Shipment":
    case "Loading": return "Shipping";
    default: return "Reserve";
  }
}

export const lockBodySchema = z.object({
  ids: z.array(z.string().trim().min(1).max(64)).min(1, "Select at least one location").max(1000),
  locked: z.boolean(),
});
