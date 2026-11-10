/** LP Numbers grid + drawer schemas, GS1 SSCC-18 helpers (M10). PURE. */
import { z } from "zod";
import { LP_STATUSES } from "@/lib/enums";
import { nonNegative, optionalId, optionalText, requiredId, requiredText, versionField, type FacilityField } from "./common";

export const LP_NUMBERS_GRID_KEY = "lp-numbers";
export const MAX_LP_BATCH = 500;

export const LP_NUMBER_FIELDS: readonly FacilityField[] = [
  { field: "number", label: "Number", type: "text" },
  { field: "warehouseId", label: "Warehouse", type: "enum" },
  { field: "lpTypeId", label: "License plate type", type: "enum" },
  { field: "locationCode", label: "Location", type: "text" },
  { field: "status", label: "Status", type: "enum", options: LP_STATUSES },
  { field: "parentLpNumber", label: "Parent LP number", type: "text" },
  { field: "originalNumber", label: "Original LP number", type: "text" },
  { field: "alternateBarcode", label: "Alternate barcode", type: "text" },
  { field: "isSscc18", label: "SSCC18", type: "boolean" },
  { field: "labelPrinted", label: "Label printed", type: "boolean" },
  { field: "createdAt", label: "Created date", type: "date" },
];

export const LP_NUMBER_SORT_FIELDS = ["number", "warehouseCode", "lpTypeCode", "locationCode", "status", "length", "width", "height", "weight", "actualVolume", "parentLpNumber", "originalNumber", "alternateBarcode", "isSscc18", "createdAt"] as const;
export const LP_NUMBER_SEARCH_FIELDS = ["number", "alternateBarcode"] as const;

/** GS1 mod-10 check digit for a digit string (weights 3,1 from the right). */
export function gs1CheckDigit(digits: string): number {
  if (!/^\d+$/.test(digits)) throw new Error("GS1 data must be digits");
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    const d = Number(digits[digits.length - 1 - i]);
    sum += d * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidSscc18(value: string): boolean {
  return /^\d{18}$/.test(value) && gs1CheckDigit(value.slice(0, 17)) === Number(value[17]);
}

/** Deterministic 7-digit GS1 company prefix for a client (stable per client). */
export function companyPrefixFor(clientKey: string): string {
  let h = 0;
  for (const ch of clientKey) h = (h * 31 + ch.charCodeAt(0)) % 9_000_000;
  return String(1_000_000 + h).slice(0, 7);
}

/** SSCC-18: extension digit + company prefix (7) + serial reference (9) + check digit. */
export function buildSscc18(extension: number, companyPrefix: string, serial: number): string {
  const body = `${extension % 10}${companyPrefix.padStart(7, "0").slice(-7)}${String(serial % 1_000_000_000).padStart(9, "0")}`;
  return `${body}${gs1CheckDigit(body)}`;
}

export const LP_CREATE_METHODS = ["sequence", "custom"] as const;

export const lpCreateSchema = z.object({
  warehouseId: requiredId("Warehouse"),
  lpTypeId: requiredId("LP type"),
  locationId: optionalId(),
  method: z.enum(LP_CREATE_METHODS),
  count: z.number({ error: "Enter a count of at least 1" }).int("Enter a whole number").min(1, "Enter a count of at least 1").max(MAX_LP_BATCH, `At most ${MAX_LP_BATCH} at a time`).nullable().optional(),
  isSscc18: z.boolean().default(false),
  clientId: optionalId(),
  number: z.string().trim().max(40, "Use at most 40 characters").optional().nullable(),
  alternateBarcode: optionalText(60),
}).superRefine((v, ctx) => {
  if (v.method === "sequence") {
    // Only the missing case here: 0 / negatives already failed `.min(1)` above (one message per field).
    if (v.count === null || v.count === undefined) ctx.addIssue({ code: "custom", path: ["count"], message: "Enter a count of at least 1" });
    if (v.isSscc18 && !v.clientId) ctx.addIssue({ code: "custom", path: ["clientId"], message: "Client is required for SSCC18 numbers" });
  } else {
    if (!v.number || !v.number.trim()) ctx.addIssue({ code: "custom", path: ["number"], message: "LP number is required" });
    else if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(v.number.trim())) ctx.addIssue({ code: "custom", path: ["number"], message: "Letters, numbers, dash or underscore" });
  }
});

export type LpCreateInput = z.input<typeof lpCreateSchema>;
export type LpCreate = z.output<typeof lpCreateSchema>;

export const LP_CREATE_DEFAULTS: LpCreateInput = {
  warehouseId: "", lpTypeId: "", locationId: null, method: "sequence", count: 1, isSscc18: false, clientId: null, number: "", alternateBarcode: "",
};

/** Edit drawer: only number, alternate barcode, dimensions/weight/volume and the SSCC18 flag (Logiwa locks). */
export const lpUpdateSchema = z.object({
  number: requiredText("LP number", 40).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Letters, numbers, dash or underscore"),
  alternateBarcode: optionalText(60),
  length: nonNegative("Length"),
  width: nonNegative("Width"),
  height: nonNegative("Height"),
  weight: nonNegative("Weight"),
  actualVolume: nonNegative("Actual volume", 1_000_000_000),
  isSscc18: z.boolean(),
  version: versionField,
});

export type LpUpdateInput = z.input<typeof lpUpdateSchema>;
