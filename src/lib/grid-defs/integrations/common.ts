/**
 * Shared, PURE definitions for M12 (automation + integrations): the grid field shape used by the
 * client filter builder and the server grid compiler, zod fragments and copy helpers.
 * No React, DOM or server imports here.
 */
import { z } from "zod";

export type IntegrationFieldType = "enum" | "text" | "number" | "boolean" | "date";

/** One grid field: filterable via `f.<field>`. */
export interface IntegrationField {
  readonly field: string;
  readonly label: string;
  readonly type: IntegrationFieldType;
  /** Static enum options (dynamic ones, e.g. warehouses, are added by the page). */
  readonly options?: readonly string[];
  readonly decimals?: number;
}

/** "LabelGeneration" -> "Label Generation" (display only). */
export function splitCamel(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/* ---------------- zod fragments ---------------- */

export const requiredText = (label: string, max = 100) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max, `${label} can be at most ${max} characters`);

export const optionalText = (max = 250) =>
  z.string().trim().max(max, `Use at most ${max} characters`).optional().nullable().transform((v) => (v ? v : null));

export const requiredId = (label: string) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(64);

export const optionalId = () =>
  z.string().trim().max(64).optional().nullable().transform((v) => (v ? v : null));

/** Optimistic concurrency token on edits (BUILD_PLAN 0.2). */
export const versionField = z.number().int().min(1).optional();

export const bulkIds = z.object({
  ids: z.array(z.string().trim().min(1).max(64)).min(1, "Select at least one record").max(1000, "At most 1000 records at once"),
});

export const round2 = (value: number): number => Math.round(value * 100) / 100;

/** "1 rule" / "3 rules". */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : pluralForm}`;
}

/** Bulk toast copy: "3 of 4 presets deleted · 1 failed". */
export function bulkSummary(result: { readonly succeeded: readonly unknown[]; readonly failed: readonly unknown[] }, noun: string, verb: string): string {
  const ok = result.succeeded.length;
  const total = ok + result.failed.length;
  const head = result.failed.length === 0 ? `${plural(ok, noun)} ${verb}` : `${ok} of ${plural(total, noun)} ${verb}`;
  return result.failed.length > 0 ? `${head} · ${result.failed.length} failed` : head;
}

/** "Download Orders" -> "Download orders" (sentence case for UI copy). */
export function sentence(text: string): string {
  return text.length === 0 ? text : text[0] + text.slice(1).toLowerCase();
}

/** Masks a secret for display: "••••1234". Never pass the whole secret to the client. */
export function maskSecret(last4: string | null | undefined): string {
  return last4 ? `••••${last4}` : "Not set";
}
