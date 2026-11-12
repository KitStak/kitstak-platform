/**
 * Shared, PURE definitions for the facility-config module (M10): field-def shape used by
 * both the client filter builder and the server grid compiler, plus zod fragments.
 * No React, DOM or server imports here.
 */
import { z } from "zod";

export type FacilityFieldType = "enum" | "text" | "number" | "boolean" | "date";

/** One grid field: filterable via `f.<field>`, optionally sortable / searchable. */
export interface FacilityField {
  readonly field: string;
  readonly label: string;
  readonly type: FacilityFieldType;
  /** Static enum options (dynamic ones, e.g. warehouses, are added by the page). */
  readonly options?: readonly string[];
  readonly decimals?: number;
  readonly group?: string;
}

export const enumOptions = (values: readonly string[]): readonly { value: string; label: string }[] =>
  values.map((value) => ({ value, label: splitCamel(value) }));

/** "BusinessStation" -> "Business Station" (display only; values stay canonical). */
export function splitCamel(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/**
 * Warehouse picker options for a create/edit form: inactive warehouses are left out, but the
 * value the record already holds is kept so an edit never shows a blank, unlabeled select.
 */
export function selectableWarehouseOptions<O extends { readonly value: string }>(
  all: readonly O[], inactiveIds: ReadonlySet<string>, current?: string | null,
): readonly O[] {
  return all.filter((o) => !inactiveIds.has(o.value) || o.value === current);
}

/* ---------------- zod fragments ---------------- */

export const MAX_CODE = 60;

export const requiredText = (label: string, max = 100) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max, `${label} can be at most ${max} characters`);

/**
 * Required text with a format rule. The format message is only raised for a non-empty
 * value, so a blank field reports exactly one error ("<label> is required").
 */
export const requiredPattern = (label: string, max: number, pattern: RegExp, message: string) =>
  requiredText(label, max).refine((v) => v === "" || pattern.test(v), { message });

export const optionalText = (max = 250) =>
  z.string().trim().max(max, `Use at most ${max} characters`).optional().nullable().transform((v) => (v ? v : null));

export const requiredId = (label: string) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(64);

export const optionalId = () =>
  z.string().trim().max(64).optional().nullable().transform((v) => (v ? v : null));

export const nonNegative = (label: string, max = 1_000_000) =>
  z.number({ error: `${label} must be a number` }).min(0, `${label} can't be negative`).max(max, `${label} is too large`);

export const nonNegativeInt = (label: string, max = 1_000_000) =>
  z.number({ error: `${label} must be a number` }).int(`${label} must be a whole number`).min(0, `${label} can't be negative`).max(max, `${label} is too large`);

/** Custom field values (slot → value), the shape `CustomFieldsSection` edits. Unknown slots are rejected. */
export const CUSTOM_FIELD_SLOT_RE = /^(textBox[1-3]|dropDown[1-2]|date[1-3]|toggle[1-2])$/;
export const customFieldValuesSchema = z
  .record(z.string().regex(CUSTOM_FIELD_SLOT_RE, "Unknown custom field"), z.union([z.string().max(500, "At most 500 characters"), z.boolean(), z.null()]))
  .default({})
  .transform((v) => Object.fromEntries(Object.entries(v).filter(([, val]) => val !== null && val !== "")) as Record<string, string | boolean>);

/** Grid filter fields for the 10 custom field slots (Logiwa: Custom Field Text Box 1-3, Drop Down 1-2, Date 1-3, Toggle 1-2). */
export const CUSTOM_FIELD_FILTER_FIELDS: readonly FacilityField[] = [
  ...[1, 2, 3].map((n) => ({ field: `customField.textBox${n}`, label: `Custom field text box ${n}`, type: "text" as const, group: "Custom fields" })),
  ...[1, 2].map((n) => ({ field: `customField.dropDown${n}`, label: `Custom field drop down ${n}`, type: "text" as const, group: "Custom fields" })),
  ...[1, 2, 3].map((n) => ({ field: `customField.date${n}`, label: `Custom field date ${n}`, type: "date" as const, group: "Custom fields" })),
  ...[1, 2].map((n) => ({ field: `customField.toggle${n}`, label: `Custom field toggle ${n}`, type: "boolean" as const, group: "Custom fields" })),
];

/** Error toasts stay up long enough to read (critic R1: they vanished in ~1.5 s). */
export const ERROR_TOAST_MS = 10_000;

/* ---------------- units ---------------- */

const CM_PER: Readonly<Record<string, number>> = { Inch: 2.54, Foot: 30.48, Centimeter: 1, Meter: 100 };
const CM3_PER: Readonly<Record<string, number>> = { "Cubic Inch": 16.387064, "Cubic Foot": 28_316.846592, "Cubic Centimeter": 1, "Cubic Meter": 1_000_000, Liter: 1000, Gallon: 3785.411784 };

/** L × W × H in `dimensionUnit`, expressed in `volumeUnit` (null when a unit is unknown or a side is 0). */
export function boxVolume(l: number, w: number, h: number, dimensionUnit: string, volumeUnit: string): number | null {
  const lin = CM_PER[dimensionUnit];
  const vol = CM3_PER[volumeUnit];
  if (!lin || !vol || !(l > 0 && w > 0 && h > 0)) return null;
  return (l * lin * (w * lin) * (h * lin)) / vol;
}

/** Issue text when a max volume exceeds the box's own L × W × H (1% tolerance for rounding), else null. */
export function maxVolumeIssue(v: { length: number; width: number; height: number; dimensionUnit: string; volumeUnit: string; maxVolume: number | null | undefined }): string | null {
  if (!v.maxVolume) return null;
  const box = boxVolume(v.length, v.width, v.height, v.dimensionUnit, v.volumeUnit);
  if (box === null || v.maxVolume <= box * 1.01) return null;
  const shown = box >= 100 ? Math.round(box).toLocaleString("en-US") : box.toFixed(2);
  return `Max volume can't exceed the box volume (${shown} ${v.volumeUnit})`;
}

/** Optimistic concurrency token on edits (BUILD_PLAN 0.2). */
export const versionField = z.number().int().min(1).optional();

export const bulkIds = z.object({
  ids: z.array(z.string().trim().min(1).max(64)).min(1, "Select at least one record").max(1000, "At most 1000 records at once"),
});

/** Rounds money/dimension values at the service boundary. */
export const round = (value: number, decimals = 2): number => {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
};

/** "1 location" / "3 locations". */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : pluralForm}`;
}

/** Bulk toast copy: "3 of 4 locations deleted · 1 failed". */
export function bulkSummary(result: { readonly succeeded: readonly unknown[]; readonly failed: readonly unknown[] }, noun: string, verb: string): string {
  const ok = result.succeeded.length;
  const total = ok + result.failed.length;
  const head = result.failed.length === 0 ? `${plural(ok, noun)} ${verb}` : `${ok} of ${plural(total, noun)} ${verb}`;
  return result.failed.length > 0 ? `${head} · ${result.failed.length} failed` : head;
}

/**
 * User-facing copy for an API error. Validation errors show the single field message, or
 * "Fix the highlighted fields" for several — never the raw field key the server prefixes
 * ("Invalid request: clientId — …"). Local adapter until REQ-1 (`fromZodError`) lands.
 */
export function friendlyErrorMessage(error: { readonly code?: string; readonly message: string; readonly fieldErrors?: Readonly<Record<string, readonly string[]>> }, fallback = "Something went wrong. Try again."): string {
  if (error.code === "CONFLICT") return "This record changed since you opened it — Reload";
  if (error.code === "VALIDATION") {
    const fields = Object.values(error.fieldErrors ?? {}).filter((m) => m.length > 0);
    if (fields.length === 1) return fields[0]?.[0] ?? fallback;
    if (fields.length > 1) return "Fix the highlighted fields";
  }
  return stripFieldPrefix(error.message) || fallback;
}

/** "Invalid request: clientId — Client is required" → "Client is required". */
export function stripFieldPrefix(message: string): string {
  return message.replace(/^Invalid request: (?:[\w.[\]]+ — )?/, "").trim();
}

/** "MLT1 · Main Fulfillment"; a name that already starts with the code ("MLT1 - Main…") is not prefixed again. */
export function warehouseLabel(code: string | null | undefined, name: string): string {
  if (!code) return name;
  return name.trim().toUpperCase().startsWith(code.trim().toUpperCase()) ? name : `${code} · ${name}`;
}

/** Keeps a saved select value visible while its lookup list is still loading (or after the value was deactivated). */
export function withSavedOption(
  options: readonly { readonly value: string; readonly label: string }[],
  saved: { readonly id: string | null; readonly name: string | null } | undefined,
  current: string | null | undefined,
): readonly { readonly value: string; readonly label: string }[] {
  if (!saved?.id || !saved.name || current !== saved.id || options.some((o) => o.value === saved.id)) return options;
  return [{ value: saved.id, label: saved.name }, ...options];
}

/** Longest prefix shared by every code ("KSCRIT-A-01", "KSCRIT-A-02" → "KSCRIT-A-0"); "" when none. */
export function commonCodePrefix(codes: readonly string[]): string {
  if (codes.length === 0) return "";
  let prefix = codes[0] ?? "";
  for (const code of codes) {
    let i = 0;
    while (i < prefix.length && i < code.length && prefix[i] === code[i]) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) return "";
  }
  return prefix;
}

/** Change-log value for display: empty / null reads "(blank)" (Logiwa shows an empty side explicitly). */
export function changeLogValue(value: string | null | undefined): string {
  return value === null || value === undefined || value.trim() === "" ? "(blank)" : value;
}

/**
 * Tidies a stored change-log sentence: "Aisle is modified.  --> Z" → "Aisle is modified. (blank) → Z",
 * "Max Sku Qty is modified. 7 →" → "Max Sku Qty is modified. 7 → (blank)".
 */
export function cleanChangeMessage(message: string): string {
  return tidyLegacyNames(message)
    .replace(/\s*-->\s*/g, " → ")
    .replace(/\.\s*→/g, ". (blank) →")
    .replace(/→\s*$/g, "→ (blank)")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** "— / A / 01": every slot shown, blanks as an em dash, so it is never ambiguous which part is empty; null when all are blank. */
export function positionTriple(...parts: readonly (string | null | undefined)[]): string | null {
  const shown = parts.map((p) => (p === null || p === undefined || String(p).trim() === "" ? "—" : String(p).trim()));
  return shown.every((p) => p === "—") ? null : shown.join(" / ");
}

/** "0 products · 1 LP" (critic R4: "0 product · 0 LP"). */
export function capacityRulesSummary(products: number, lps: number): string {
  return `${products.toLocaleString("en-US")} ${products === 1 ? "product" : "products"} · ${lps.toLocaleString("en-US")} ${lps === 1 ? "LP" : "LPs"}`;
}

/**
 * Rows written before round 5 used generic casing ("Lp type X is created.", "Is Locked", "Max Sku Qty").
 * Display them with the same names new rows store. Pure.
 */
export function tidyLegacyNames(text: string): string {
  return text
    .replace(/^Lp type\b/, "LP Type")
    .replace(/^License Plate\b/, "LP Number")
    .replace(/^Mobile cart\b/, "Mobile Cart")
    .replace(/^Shipment package\b/, "Shipment Package")
    .replace(/^Is (?=[A-Z])/, "")
    .replace(/\bSku\b/g, "SKU")
    .replace(/\bLp\b/g, "LP");
}
