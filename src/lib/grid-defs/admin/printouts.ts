/**
 * Printouts & Labels (M14): categories, the per-type template list, the 5-step wizard schema
 * and the structured layout model the designer edits and the preview renderer honors. PURE.
 */
import { z } from "zod";
import { PRINT_MODES, PRINT_RECORDS_PER_PAGE, PRINTER_TYPES } from "@/lib/enums";
import { PRINT_TYPES, type PrintCategory, type PrintTypeDef } from "@/server/print/catalog";
import { idField, requiredText, versionField, type AdminField } from "./common";

export const PRINTOUTS_GRID_KEY = "printouts";

export const CATEGORY_LABELS: Readonly<Record<PrintCategory | "all", string>> = { all: "All", lists: "Lists", labels: "Labels", billings: "Billings", others: "Others" };
export const CATEGORY_SLUGS = ["all", "lists", "labels", "billings", "others"] as const;
export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

/** Correct counts (Logiwa shows 25/11 but lists 23/9 cards). */
export function categoryCounts(types: readonly PrintTypeDef[] = PRINT_TYPES): Record<CategorySlug, number> {
  return {
    all: types.length,
    lists: types.filter((t) => t.category === "lists").length,
    labels: types.filter((t) => t.category === "labels").length,
    billings: types.filter((t) => t.category === "billings").length,
    others: types.filter((t) => t.category === "others").length,
  };
}

/* ---------------- layout model ---------------- */

export const PAPER_SIZES = ["Letter", "A4", "4x6", "4x2"] as const;
export const FONTS = ["Helvetica", "Times", "Courier"] as const;
export const LOGO_POSITIONS = ["left", "center", "right", "hidden"] as const;

export type LayoutFamily = "document" | "label";

export interface SectionDef { readonly key: string; readonly label: string; readonly description: string }
export interface ColumnDef { readonly key: string; readonly label: string; readonly width: number; readonly align?: "left" | "right" }

export const DOCUMENT_SECTIONS: readonly SectionDef[] = [
  { key: "logo", label: "Logo", description: "Company logo from Company Settings" },
  { key: "header", label: "Title and summary", description: "Document title, record code and key dates" },
  { key: "barcode", label: "Barcode", description: "Code 128 barcode of the record code" },
  { key: "addresses", label: "Addresses", description: "Ship to and ship from" },
  { key: "lines", label: "Lines table", description: "One row per line with the columns below" },
  { key: "totals", label: "Totals", description: "Units and amount totals" },
  { key: "notes", label: "Notes", description: "Gift message and order notes" },
  { key: "footer", label: "Footer", description: "Footer text and page numbers" },
];

export const LABEL_SECTIONS: readonly SectionDef[] = [
  { key: "logo", label: "Logo", description: "Company logo" },
  { key: "title", label: "Title", description: "Label heading" },
  { key: "barcode", label: "Barcode", description: "Code 128 barcode" },
  { key: "code", label: "Code text", description: "Human-readable code under the barcode" },
  { key: "details", label: "Details", description: "Secondary lines (name, client, location)" },
  { key: "footer", label: "Footer", description: "Printed date" },
];

export const DOCUMENT_COLUMNS: readonly ColumnDef[] = [
  { key: "location", label: "Location", width: 0.14 },
  { key: "sku", label: "SKU", width: 0.18 },
  { key: "description", label: "Description", width: 0.32 },
  { key: "lot", label: "Lot", width: 0.1 },
  { key: "uom", label: "UOM", width: 0.08 },
  { key: "qty", label: "Qty", width: 0.08, align: "right" },
  { key: "price", label: "Price", width: 0.1, align: "right" },
  { key: "total", label: "Total", width: 0.1, align: "right" },
];

export const layoutSchema = z.object({
  family: z.enum(["document", "label"]),
  paper: z.enum(PAPER_SIZES),
  font: z.enum(FONTS),
  fontSize: z.number().int().min(7, "At least 7 pt").max(16, "At most 16 pt"),
  logoPosition: z.enum(LOGO_POSITIONS),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #1F2A44"),
  title: z.string().trim().max(60, "At most 60 characters"),
  footerText: z.string().trim().max(200, "At most 200 characters"),
  sections: z.array(z.object({ key: z.string().max(30), enabled: z.boolean() })).min(1).max(12),
  columns: z.array(z.object({ key: z.string().max(30), enabled: z.boolean() })).max(12),
});

export type PrintoutLayout = z.infer<typeof layoutSchema>;

export function familyOf(typeKey: string): LayoutFamily {
  return PRINT_TYPES.find((t) => t.key === typeKey)?.category === "labels" ? "label" : "document";
}

/** Columns that make sense per type (pick lists show Location, packing shows Price…). */
export function columnsFor(typeKey: string): readonly ColumnDef[] {
  if (familyOf(typeKey) === "label") return [];
  if (typeKey.includes("picking") || typeKey === "resolution-job" || typeKey === "job-content") return DOCUMENT_COLUMNS.filter((c) => ["location", "sku", "description", "lot", "uom", "qty"].includes(c.key));
  if (typeKey.includes("billing") || typeKey === "contract") return DOCUMENT_COLUMNS.filter((c) => ["sku", "description", "qty", "price", "total"].includes(c.key));
  return DOCUMENT_COLUMNS.filter((c) => c.key !== "location");
}

export function sectionsFor(typeKey: string): readonly SectionDef[] {
  return familyOf(typeKey) === "label" ? LABEL_SECTIONS : DOCUMENT_SECTIONS;
}

/* ---------------- base templates (wizard step 2) ---------------- */

export interface BaseTemplate {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly layout: (typeKey: string) => PrintoutLayout;
}

const docLayout = (typeKey: string, title: string, over: Partial<PrintoutLayout> = {}, hiddenSections: readonly string[] = [], hiddenColumns: readonly string[] = []): PrintoutLayout => ({
  family: "document", paper: "Letter", font: "Helvetica", fontSize: 10, logoPosition: "left", accentColor: "#1F2A44", title, footerText: "Thank you for your order.",
  sections: DOCUMENT_SECTIONS.map((s) => ({ key: s.key, enabled: !hiddenSections.includes(s.key) })),
  columns: columnsFor(typeKey).map((c) => ({ key: c.key, enabled: !hiddenColumns.includes(c.key) })),
  ...over,
});

const labelLayout = (title: string, paper: "4x6" | "4x2"): PrintoutLayout => ({
  family: "label", paper, font: "Helvetica", fontSize: 10, logoPosition: "hidden", accentColor: "#111827", title, footerText: "",
  sections: LABEL_SECTIONS.map((s) => ({ key: s.key, enabled: s.key !== "logo" })), columns: [],
});

export const DOCUMENT_TEMPLATES: readonly BaseTemplate[] = [
  { key: "standard", name: "Standard", description: "Logo left, addresses, full lines table and totals.", layout: (t) => docLayout(t, typeTitle(t)) },
  { key: "compact", name: "Compact", description: "No logo or notes, smaller font, fits more lines per page.", layout: (t) => docLayout(t, typeTitle(t), { fontSize: 8, logoPosition: "hidden" }, ["logo", "notes"]) },
  { key: "retail", name: "Retail (no prices)", description: "Gift-friendly: prices and totals hidden, logo centered.", layout: (t) => docLayout(t, typeTitle(t), { logoPosition: "center" }, ["totals"], ["price", "total"]) },
  { key: "task", name: "Task based", description: "Barcode first and a location column, for pickers and packers.", layout: (t) => docLayout(t, typeTitle(t), { logoPosition: "hidden" }, ["logo", "totals"]) },
];

export const LABEL_TEMPLATES: readonly BaseTemplate[] = [
  { key: "label-4x6", name: "4 × 6 label", description: "Large barcode with details, thermal 4 × 6.", layout: (t) => labelLayout(typeTitle(t), "4x6") },
  { key: "label-4x2", name: "4 × 2 label", description: "Barcode and code only, thermal 4 × 2.", layout: (t) => ({ ...labelLayout(typeTitle(t), "4x2"), sections: LABEL_SECTIONS.map((s) => ({ key: s.key, enabled: ["barcode", "code"].includes(s.key) })) }) },
];

export function templatesFor(typeKey: string): readonly BaseTemplate[] {
  return familyOf(typeKey) === "label" ? LABEL_TEMPLATES : DOCUMENT_TEMPLATES;
}

export function typeTitle(typeKey: string): string {
  return PRINT_TYPES.find((t) => t.key === typeKey)?.name ?? "Printout";
}

/** Fills missing sections / columns (catalog grew) and drops unknown ones. */
export function normalizeLayout(typeKey: string, raw: unknown): PrintoutLayout {
  const base = templatesFor(typeKey)[0]!.layout(typeKey);
  const parsed = layoutSchema.safeParse(raw);
  if (!parsed.success) return base;
  const l = parsed.data;
  const known = sectionsFor(typeKey).map((s) => s.key);
  const sections = [...l.sections.filter((s) => known.includes(s.key)), ...known.filter((k) => !l.sections.some((s) => s.key === k)).map((key) => ({ key, enabled: false }))];
  const knownCols = columnsFor(typeKey).map((c) => c.key);
  const columns = [...l.columns.filter((c) => knownCols.includes(c.key)), ...knownCols.filter((k) => !l.columns.some((c) => c.key === k)).map((key) => ({ key, enabled: false }))];
  return { ...l, family: familyOf(typeKey), sections, columns };
}

/** Moves item `index` by `delta` (designer up / down buttons). */
export function moveItem<T>(list: readonly T[], index: number, delta: number): T[] {
  const next = [...list];
  const target = index + delta;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next;
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item as T);
  return next;
}

/* ---------------- wizard ---------------- */

export const PRINTOUT_STATUSES = ["Active", "Passive"] as const;

export const printoutInfoSchema = z.object({
  name: requiredText("Name", 80),
  description: requiredText("Description", 250),
  recordsPerPage: z.enum(PRINT_RECORDS_PER_PAGE, { error: "Choose records per page" }),
  printMode: z.enum(PRINT_MODES, { error: "Choose a print mode" }),
  printerType: z.enum(PRINTER_TYPES, { error: "Choose a printer type" }),
  isActive: z.boolean(),
});

export const printoutTemplateStepSchema = z.object({ baseTemplate: z.string().min(1, "Select a template") });
export const printoutDesignStepSchema = z.object({ layout: layoutSchema });

export const printoutOptionsSchema = z.object({
  useRetailerPackingList: z.boolean().default(false),
  groupBy: z.enum(["none", "location", "sku", "zone"]).default("none"),
  labelCopies: z.number().int().min(1).max(20).default(1),
});

export const printoutClientsStepSchema = z.object({ allClients: z.boolean(), clientIds: z.array(idField).max(5000) })
  .superRefine((v, ctx) => { if (!v.allClients && v.clientIds.length === 0) ctx.addIssue({ code: "custom", path: ["clientIds"], message: "Give at least one client access, or give access to all clients" }); });

export const printoutSchema = printoutInfoSchema.extend({
  typeKey: z.string().min(1).max(80).refine((k) => PRINT_TYPES.some((t) => t.key === k), "Unknown printout type"),
  baseTemplate: z.string().min(1, "Select a template").max(40),
  layout: layoutSchema,
  options: printoutOptionsSchema,
  allClients: z.boolean(),
  clientIds: z.array(idField).max(5000).default([]),
  version: versionField,
}).superRefine((v, ctx) => { if (!v.allClients && v.clientIds.length === 0) ctx.addIssue({ code: "custom", path: ["clientIds"], message: "Give at least one client access, or give access to all clients" }); });

export type PrintoutFormValues = z.input<typeof printoutSchema>;
export type PrintoutSave = z.output<typeof printoutSchema>;

export function printoutDefaults(typeKey: string): PrintoutFormValues {
  const type = PRINT_TYPES.find((t) => t.key === typeKey);
  const base = templatesFor(typeKey)[0]!;
  return {
    typeKey, name: "", description: "", recordsPerPage: familyOf(typeKey) === "label" ? "Single Record" : "Multiple Records", printMode: "PDF Preview",
    printerType: type?.printerType ?? "Laser Printer", isActive: true, baseTemplate: base.key, layout: base.layout(typeKey),
    options: { useRetailerPackingList: false, groupBy: "none", labelCopies: 1 }, allClients: true, clientIds: [],
  };
}

/* ---------------- grid ---------------- */

export const PRINTOUT_FIELDS: readonly AdminField[] = [
  { field: "name", label: "Report name", type: "text" },
  { field: "description", label: "Description", type: "text" },
  { field: "typeKey", label: "Report type", type: "enum", options: PRINT_TYPES.map((t) => t.key) },
  { field: "status", label: "Status", type: "enum", options: PRINTOUT_STATUSES },
  { field: "printMode", label: "Print mode", type: "enum", options: PRINT_MODES },
  { field: "printerType", label: "Printer type", type: "enum", options: PRINTER_TYPES },
  { field: "isDefault", label: "Default", type: "boolean" },
  { field: "createdAt", label: "Creation date", type: "date" },
];

export const PRINTOUT_SORT_FIELDS = ["name", "description", "createdAt", "createdByName", "status", "typeKey", "printMode", "isDefault", "updatedAt"] as const;
export const PRINTOUT_SEARCH_FIELDS = ["name", "description"] as const;
