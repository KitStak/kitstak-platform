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

/* ---------------- zod fragments ---------------- */

export const MAX_CODE = 60;

export const requiredText = (label: string, max = 100) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max, `${label} can be at most ${max} characters`);

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
