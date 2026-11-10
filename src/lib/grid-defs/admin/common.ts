/**
 * Shared, PURE definitions for the admin-settings module (M14): the grid field shape used by
 * the client filter builder and the server grid compiler, zod fragments and copy helpers.
 * No React, DOM or server imports here.
 */
import { z } from "zod";

export type AdminFieldType = "enum" | "text" | "number" | "boolean" | "date";

/** One grid field: filterable via `f.<field>`, optionally sortable / searchable. */
export interface AdminField {
  readonly field: string;
  readonly label: string;
  readonly type: AdminFieldType;
  /** Static enum options (dynamic ones, e.g. roles or warehouses, are added by the page). */
  readonly options?: readonly string[];
  readonly group?: string;
}

/* ---------------- zod fragments ---------------- */

export const requiredText = (label: string, max = 100) =>
  z.string({ error: `${label} is required` }).trim().min(1, `${label} is required`).max(max, `${label} can be at most ${max} characters`);

export const optionalText = (max = 250) =>
  z.string().trim().max(max, `Use at most ${max} characters`).optional().nullable().transform((v) => (v ? v : null));

export const idField = z.string().trim().min(1).max(64);

/** Optimistic concurrency token on edits (BUILD_PLAN 0.2). */
export const versionField = z.number().int().min(1).optional();

export const bulkIdsSchema = z.object({
  ids: z.array(idField).min(1, "Select at least one record").max(1000, "At most 1000 records at once"),
});

export const emailField = z
  .string({ error: "Email is required" })
  .trim()
  .min(1, "Email is required")
  .max(254, "Email can be at most 254 characters")
  .email("Enter a valid email address")
  .transform((v) => v.toLowerCase());

/* ---------------- copy helpers ---------------- */

/** "1 user" / "3 users". */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : pluralForm}`;
}

/** Bulk toast copy: "3 of 4 users activated · 1 failed". */
export function bulkSummary(result: { readonly succeeded: readonly unknown[]; readonly failed: readonly unknown[] }, noun: string, verb: string): string {
  const ok = result.succeeded.length;
  const total = ok + result.failed.length;
  const head = result.failed.length === 0 ? `${plural(ok, noun)} ${verb}` : `${ok} of ${plural(total, noun)} ${verb}`;
  return result.failed.length > 0 ? `${head} · ${result.failed.length} failed` : head;
}

/** "carrier_cost" -> "Carrier cost". */
export function sentenceCase(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Initials for avatars: "Renata Alvarez" -> "RA". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase() || "?";
}

/** Change-log wire format ("Roles is modified. a --> b", Logiwa parity) as UI copy: "Roles changed: a → b". */
export function prettyLogMessage(message: string): string {
  return message
    .replace(/^(.*?) is modified\. ([\s\S]*?) --> ([\s\S]*)$/, "$1 changed: $2 → $3")
    .replace(/ --> /g, " → ")
    .replace(/ -> /g, " › ");
}
