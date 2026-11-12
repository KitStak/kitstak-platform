/** Terse builders for import template columns. PURE. */
import type { ImportColumn } from "../types";

type Extra = Partial<Omit<ImportColumn, "key" | "header" | "type" | "example">>;

export const text = (key: string, header: string, example: string, extra: Extra = {}): ImportColumn =>
  ({ key, header, type: "text", example, maxLength: 200, ...extra });

export const req = (key: string, header: string, example: string, extra: Extra = {}): ImportColumn =>
  text(key, header, example, { required: true, ...extra });

export const int = (key: string, header: string, example: string, extra: Extra = {}): ImportColumn =>
  ({ key, header, type: "integer", example, min: 0, ...extra });

export const num = (key: string, header: string, example: string, extra: Extra = {}): ImportColumn =>
  ({ key, header, type: "number", example, min: 0, ...extra });

export const bool = (key: string, header: string, example = "No", extra: Extra = {}): ImportColumn =>
  ({ key, header, type: "boolean", example, description: "Yes / No", ...extra });

export const date = (key: string, header: string, example: string, extra: Extra = {}): ImportColumn =>
  ({ key, header, type: "date", example, description: "YYYY-MM-DD", ...extra });

export const oneOf = (key: string, header: string, options: readonly string[], extra: Extra = {}): ImportColumn =>
  ({ key, header, type: "enum", options, example: options[0] ?? "", ...extra });

/** Ship-to / address block shared by orders and customers. */
export const addressColumns = (prefix: string, label: string): ImportColumn[] => [
  text(`${prefix}Name`, `${label} Name`, "Jane Doe"),
  text(`${prefix}Company`, `${label} Company`, "Acme Inc."),
  text(`${prefix}Address1`, `${label} Address 1`, "100 Main St"),
  text(`${prefix}Address2`, `${label} Address 2`, "Suite 4"),
  text(`${prefix}City`, `${label} City`, "Austin"),
  text(`${prefix}State`, `${label} State`, "TX"),
  text(`${prefix}PostalCode`, `${label} Postal Code`, "78701"),
  text(`${prefix}Country`, `${label} Country`, "US", { maxLength: 2, description: "ISO 3166-1 alpha-2" }),
  text(`${prefix}Phone`, `${label} Phone`, "512-555-0100"),
  text(`${prefix}Email`, `${label} Email`, "jane@example.com"),
];
