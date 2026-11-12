/** Shipment Packages grid + wizard schema (M10). PURE. */
import { z } from "zod";
import { CURRENCIES, DIMENSION_UNITS, PACKAGE_REDUCTION_RULES, VOLUME_UNITS, WEIGHT_UNITS } from "@/lib/enums";
import { maxVolumeIssue, nonNegative, optionalId, optionalText, requiredId, requiredPattern, versionField, type FacilityField } from "./common";

export const SHIPMENT_PACKAGES_GRID_KEY = "shipment-packages";
export const PACKAGE_CREATED_MESSAGE = "Shipment package created successfully";

export const SHIPMENT_PACKAGE_FIELDS: readonly FacilityField[] = [
  { field: "code", label: "Code", type: "text" },
  { field: "description", label: "Description", type: "text" },
  { field: "warehouseId", label: "Warehouse", type: "enum" },
  { field: "trackInventory", label: "Track inventory", type: "boolean" },
  { field: "reductionRule", label: "Inventory reduction location", type: "enum", options: PACKAGE_REDUCTION_RULES },
  { field: "length", label: "Length", type: "number", decimals: 2 },
  { field: "width", label: "Width", type: "number", decimals: 2 },
  { field: "height", label: "Height", type: "number", decimals: 2 },
  { field: "isActive", label: "Active", type: "boolean" },
  { field: "allClients", label: "All clients", type: "boolean" },
];

export const SHIPMENT_PACKAGE_SORT_FIELDS = ["code", "description", "warehouseCode", "trackInventory", "reductionRule", "length", "width", "height", "dimensionUnit", "emptyWeight", "maxWeight", "weightUnit", "maxVolume", "volumeUnit", "purchasePrice", "isActive", "createdAt"] as const;
export const SHIPMENT_PACKAGE_SEARCH_FIELDS = ["code", "description"] as const;

const access = z.object({ clientId: z.string().trim().min(1).max(64), hasAccess: z.boolean() });

const GENERAL_SHAPE = {
  warehouseId: requiredId("Warehouse"),
  code: requiredPattern("Code", 40, /^[A-Za-z0-9][A-Za-z0-9 ._x×-]*$/i, "Letters, numbers, space, dot, x or dash"),
  description: optionalText(250),
  weightUnit: z.enum(WEIGHT_UNITS),
  emptyWeight: nonNegative("Empty weight"),
  maxWeight: nonNegative("Max weight").nullable().optional().transform((v) => v ?? null),
  dimensionUnit: z.enum(DIMENSION_UNITS),
  length: z.number({ error: "Length is required" }).positive("Length must be above 0").max(10_000),
  width: z.number({ error: "Width is required" }).positive("Width must be above 0").max(10_000),
  height: z.number({ error: "Height is required" }).positive("Height must be above 0").max(10_000),
  volumeUnit: z.enum(VOLUME_UNITS),
  maxVolume: nonNegative("Max volume", 1_000_000_000).nullable().optional().transform((v) => v ?? null),
  currency: z.enum(CURRENCIES),
  purchasePrice: nonNegative("Purchase price", 100_000),
  isActive: z.boolean(),
};
const ACCESS_SHAPE = { allClients: z.boolean(), clientAccess: z.array(access).max(2000).default([]) };
/** Logiwa's "Inventory Tracking Method": create the packaging SKU from the package, or match an existing one. */
export const PACKAGE_TRACKING_METHODS = ["match", "auto"] as const;
export const PACKAGE_TRACKING_METHOD_LABELS: Readonly<Record<(typeof PACKAGE_TRACKING_METHODS)[number], string>> = { auto: "Auto-create new SKU", match: "Match with an existing SKU" };

const TRACKING_SHAPE = {
  trackInventory: z.boolean(),
  trackingMethod: z.enum(PACKAGE_TRACKING_METHODS).optional().transform((v) => v ?? "match"),
  inventoryClientId: optionalId(),
  inventoryProductId: optionalId(),
  reductionRule: z.enum(PACKAGE_REDUCTION_RULES).nullable().optional().transform((v) => v ?? null),
  reductionLocationId: optionalId(),
};

type Ctx = z.RefinementCtx;
const checkGeneral = (v: { maxWeight: number | null; emptyWeight: number; length: number; width: number; height: number; dimensionUnit: string; volumeUnit: string; maxVolume: number | null }, ctx: Ctx) => {
  if (v.maxWeight !== null && v.maxWeight > 0 && v.maxWeight < v.emptyWeight) ctx.addIssue({ code: "custom", path: ["maxWeight"], message: "Max weight must be at least the empty weight" });
  const vol = maxVolumeIssue(v);
  if (vol) ctx.addIssue({ code: "custom", path: ["maxVolume"], message: vol });
};
const checkAccess = (v: { allClients: boolean; clientAccess: readonly { hasAccess: boolean }[] }, ctx: Ctx) => {
  if (!v.allClients && !v.clientAccess.some((a) => a.hasAccess)) ctx.addIssue({ code: "custom", path: ["clientAccess"], message: "Enable at least one client, or choose All clients" });
};
const checkTracking = (v: { trackInventory: boolean; trackingMethod: "match" | "auto"; inventoryClientId: string | null; inventoryProductId: string | null; reductionRule: string | null; reductionLocationId: string | null }, ctx: Ctx) => {
  if (!v.trackInventory) return;
  if (!v.inventoryClientId) ctx.addIssue({ code: "custom", path: ["inventoryClientId"], message: "Inventory owner is required" });
  if (v.trackingMethod === "match" && !v.inventoryProductId) ctx.addIssue({ code: "custom", path: ["inventoryProductId"], message: "Packaging SKU is required" });
  if (!v.reductionRule) ctx.addIssue({ code: "custom", path: ["reductionRule"], message: "Choose where inventory is reduced" });
  if (v.reductionRule === "Specific Location" && !v.reductionLocationId) ctx.addIssue({ code: "custom", path: ["reductionLocationId"], message: "Location is required" });
};

/** Wizard step schemas: 1 General · 2 Client access · 3 Inventory tracking. */
export const packageGeneralSchema = z.object(GENERAL_SHAPE).superRefine(checkGeneral);
export const packageAccessSchema = z.object(ACCESS_SHAPE).superRefine(checkAccess);
export const packageTrackingSchema = z.object(TRACKING_SHAPE).superRefine(checkTracking);

/** Step 4 (Other info): custom field slot -> value. */
export const packageCustomFieldsSchema = z.record(z.string().max(30), z.union([z.string().max(500), z.boolean(), z.null()])).default({});

export const shipmentPackageSchema = z.object({ ...GENERAL_SHAPE, ...ACCESS_SHAPE, ...TRACKING_SHAPE, customFields: packageCustomFieldsSchema, version: versionField }).superRefine((v, ctx) => {
  checkGeneral(v, ctx);
  checkAccess(v, ctx);
  checkTracking(v, ctx);
});

export type ShipmentPackageInput = z.input<typeof shipmentPackageSchema>;
export type ShipmentPackageSave = z.output<typeof shipmentPackageSchema>;

export const SHIPMENT_PACKAGE_DEFAULTS: ShipmentPackageInput = {
  warehouseId: "", code: "", description: "", weightUnit: "Pound", emptyWeight: 0, maxWeight: null, dimensionUnit: "Inch",
  length: 0, width: 0, height: 0, volumeUnit: "Cubic Inch", maxVolume: null, currency: "USD", purchasePrice: 0, isActive: true,
  allClients: true, clientAccess: [], trackInventory: false, trackingMethod: "match", inventoryClientId: null, inventoryProductId: null, reductionRule: null, reductionLocationId: null, customFields: {},
};

/** Cubic volume in the dimension unit (L × W × H), used as the default Max volume hint. */
export function boxVolume(l: number, w: number, h: number): number {
  return Math.round(l * w * h * 100) / 100;
}

/**
 * Delete-confirm description. The "used" warning appears only when at least one selected
 * package is actually blocked (critic R2: an unused, just-created package was told it had been used).
 */
export function packageDeleteCopy(rows: readonly { readonly shipmentCount: number; readonly orderCount: number; readonly productCount: number }[]): string {
  const blocked = rows.filter((r) => packageDeleteReason(r) !== null).length;
  const n = rows.length;
  const base = n === 1 ? "The package is removed permanently. This can't be undone." : `The ${n} packages are removed permanently. This can't be undone.`;
  if (blocked === 0) return base;
  if (n === 1) return `${packageDeleteReason(rows[0]!)}.`;
  return `${base} ${blocked} of them ${blocked === 1 ? "has" : "have"} been used by shipments, orders or products and will be skipped; set ${blocked === 1 ? "it" : "them"} inactive instead.`;
}

/** Mirrors the server's `packageDeleteBlocker`, so the menu explains before the request fails. */
export function packageDeleteReason(row: { readonly shipmentCount: number; readonly orderCount: number; readonly productCount: number }): string | null {
  if (row.shipmentCount > 0) return `Used by ${row.shipmentCount.toLocaleString("en-US")} ${row.shipmentCount === 1 ? "shipment" : "shipments"}; set it inactive instead`;
  if (row.orderCount > 0) return `Set on ${row.orderCount.toLocaleString("en-US")} shipment ${row.orderCount === 1 ? "order" : "orders"}; set it inactive instead`;
  if (row.productCount > 0) return `Required box of ${row.productCount.toLocaleString("en-US")} ${row.productCount === 1 ? "product" : "products"}`;
  return null;
}
