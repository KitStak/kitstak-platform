/** LP Types grid + wizard schema (M10). PURE. */
import { z } from "zod";
import { DIMENSION_UNITS, VOLUME_UNITS, WEIGHT_UNITS } from "@/lib/enums";
import { nonNegative, optionalText, requiredId, requiredText, versionField, type FacilityField } from "./common";

export const LP_TYPES_GRID_KEY = "lp-types";

export const LP_TYPE_PARAMETERS = [
  { key: "onlyOneExpiry", label: "Only 1 expiry date", column: "Is prevent multi expiry date" },
  { key: "onlyOneProductionDate", label: "Only 1 production date", column: "Is prevent multi production date" },
  { key: "onlyOneLot", label: "Only 1 lot batch number", column: "Is prevent multi lot batch number" },
  { key: "onlyOneSku", label: "Only 1 SKU", column: "Is prevent multi SKU" },
  { key: "onlyOneClient", label: "Only 1 client", column: "Is prevent multi client" },
  { key: "onlyOneOrder", label: "Only 1 order", column: "Is prevent multi order" },
  { key: "onlyOneJob", label: "Only 1 job", column: "Is prevent multi job" },
  { key: "suitableForParentLp", label: "Suitable for parent LP", column: "Suitable for parent LP" },
  { key: "useForAiJob", label: "Use for AI job", column: "Is use for AI job" },
] as const;

export type LpTypeParamKey = (typeof LP_TYPE_PARAMETERS)[number]["key"];

export const LP_TYPE_FIELDS: readonly FacilityField[] = [
  { field: "code", label: "Code", type: "text" },
  { field: "description", label: "Description", type: "text" },
  { field: "warehouseId", label: "Warehouse", type: "enum" },
  { field: "numberPrefix", label: "Number prefix", type: "text" },
  { field: "numberLength", label: "Number length", type: "number" },
  { field: "suitableForParentLp", label: "Usable as parent LP", type: "boolean" },
  { field: "useForAiJob", label: "Use for AI jobs", type: "boolean" },
  { field: "onlyOneSku", label: "Prevent multi SKU", type: "boolean" },
  { field: "onlyOneClient", label: "Prevent multi client", type: "boolean" },
  { field: "lpCount", label: "LP count", type: "number" },
];

export const LP_TYPE_SORT_FIELDS = ["code", "description", "warehouseCode", "numberPrefix", "numberLength", "length", "width", "height", "emptyWeight", "maxWeight", "lpCount", "createdAt"] as const;
export const LP_TYPE_SEARCH_FIELDS = ["code", "description"] as const;

const params = Object.fromEntries(LP_TYPE_PARAMETERS.map((p) => [p.key, z.boolean().default(false)])) as Record<LpTypeParamKey, z.ZodDefault<z.ZodBoolean>>;

const GENERAL_SHAPE = {
  warehouseId: requiredId("Warehouse"),
  code: requiredText("Code", 40).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Letters, numbers, dash or underscore"),
  numberPrefix: requiredText("Number prefix", 10).regex(/^[A-Za-z0-9-]+$/, "Letters, numbers or dash"),
  numberLength: z.number({ error: "Number length is required" }).int("Whole number").min(1, "At least 1 digit").max(12, "At most 12 digits"),
  length: nonNegative("Length"),
  width: nonNegative("Width"),
  height: nonNegative("Height"),
  dimensionUnit: z.enum(DIMENSION_UNITS),
  weightUnit: z.enum(WEIGHT_UNITS),
  emptyWeight: nonNegative("Empty weight"),
  maxWeight: nonNegative("Max weight"),
  volumeUnit: z.enum(VOLUME_UNITS),
  maxVolume: nonNegative("Max volume", 1_000_000_000),
};

const checkWeight = (v: { maxWeight: number; emptyWeight: number }, ctx: z.RefinementCtx) => {
  if (v.maxWeight > 0 && v.maxWeight < v.emptyWeight) ctx.addIssue({ code: "custom", path: ["maxWeight"], message: "Max weight must be at least the empty weight" });
};

/** Wizard step 1 (General, with units). */
export const lpTypeGeneralSchema = z.object(GENERAL_SHAPE).superRefine(checkWeight);
/** Wizard step 3 (Other info). */
export const lpTypeOtherSchema = z.object({ description: optionalText(250) });

export const lpTypeSchema = z.object({ ...GENERAL_SHAPE, description: optionalText(250), ...params, version: versionField }).superRefine(checkWeight);

export type LpTypeInput = z.input<typeof lpTypeSchema>;
export type LpTypeSave = z.output<typeof lpTypeSchema>;

export const LP_TYPE_DEFAULTS: LpTypeInput = {
  warehouseId: "", code: "", numberPrefix: "", numberLength: 5, description: "", length: 0, width: 0, height: 0,
  dimensionUnit: "Inch", weightUnit: "Ounce", emptyWeight: 0, maxWeight: 0, volumeUnit: "Cubic Inch", maxVolume: 0,
  onlyOneExpiry: false, onlyOneProductionDate: false, onlyOneLot: false, onlyOneSku: false, onlyOneClient: false,
  onlyOneOrder: false, onlyOneJob: false, suitableForParentLp: false, useForAiJob: false,
};

/** "KSE-" + 1 padded to 5 -> "KSE-00001" (matches sequences.formatCode). */
export function lpNumberPreview(prefix: string, length: number, next: number): string {
  return `${prefix}${String(next).padStart(Math.max(1, length), "0")}`;
}
