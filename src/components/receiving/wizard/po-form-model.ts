/**
 * PO wizard form model: values, per-step schemas and the API payload mapping.
 * Pure (no React) so it is unit tested.
 */
import { z } from "zod";
import { PO_TYPES } from "@/lib/enums";
import { MAX_LINE_QTY, PO_CODE_MAX, PO_NOTE_MAX, PO_REFERENCE_MAX, purchasePriceOf } from "@/lib/grid-defs/receiving/po-schemas";
import type { PoDetail, Tracking } from "../receiving-shared";

export interface LineDraft {
  /** Persisted line id (edit) — absent for new lines. */
  readonly id?: string;
  /** Client key for React lists. */
  readonly key: string;
  readonly productId: string;
  readonly sku: string;
  readonly productName: string;
  readonly barcode: string;
  readonly imageUrl: string | null;
  readonly uom: string;
  readonly packTypes: readonly { readonly packType: string; readonly uomQty: number }[];
  readonly tracking: Tracking;
  readonly packType: string;
  readonly orderedQuantity: number;
  readonly unitCost: number;
  readonly receivedQuantity: number;
  readonly receivingLocationId: string | null;
  readonly receivingLocationCode: string | null;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly productionDate: string | null;
  readonly lpTypeId: string | null;
  readonly lpTypeCode: string | null;
  readonly lpNumber: string | null;
  readonly note: string | null;
}

export interface PoFormValues {
  warehouseId: string;
  clientId: string;
  clientLabel: string;
  code: string;
  /** Set by the inline uniqueness check; non-empty blocks step 1. */
  codeConflict: string;
  /** True while the uniqueness check is debouncing / in flight; blocks Next without showing an error. */
  codeChecking?: boolean;
  poType: string;
  poDate: string | null;
  plannedReceivingDate: string | null;
  receivedAt: string | null;
  plannedArrivalDate: string | null;
  actualArrivalDate: string | null;
  referenceNumber: string;
  note: string;
  lines: LineDraft[];
  vendorId: string;
  vendorLabel: string;
  customFields: Record<string, string | boolean | null>;
  /** True once the Confirm step has been shown (ring reaches 100% only there). */
  reviewed: boolean;
}

/** Next-button reason while the PO number uniqueness check is pending (`codeChecking`). */
export const CODE_CHECK_PENDING = "Checking that the PO number is unique…";

export const STEP_KEYS =["details", "products", "vendor", "other", "confirm"] as const;
export type StepKey = (typeof STEP_KEYS)[number];

export const detailsStepSchema = z
  .object({
    warehouseId: z.string().min(1, "Warehouse is required."),
    clientId: z.string().min(1, "Client is required."),
    code: z.string().trim().min(1, "PO number is required.").max(PO_CODE_MAX, `Use at most ${PO_CODE_MAX} characters`)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._\-/ ]*$/, "Use letters, numbers, spaces, dots, dashes or slashes"),
    codeConflict: z.string().optional(),
    poType: z.string().refine((v) => (PO_TYPES as readonly string[]).includes(v), "PO type is required."),
    poDate: z.string({ message: "PO date is required." }).min(1, "PO date is required."),
    referenceNumber: z.string().max(PO_REFERENCE_MAX, `Use at most ${PO_REFERENCE_MAX} characters`),
    note: z.string().max(PO_NOTE_MAX, `Use at most ${PO_NOTE_MAX} characters`),
  })
  .superRefine((v, ctx) => {
    if (v.codeConflict) ctx.addIssue({ code: "custom", path: ["code"], message: v.codeConflict });
  });

export const productsStepSchema = z.object({ lines: z.array(z.unknown()).min(1, "Add at least one product") });
export const vendorStepSchema = z.object({ vendorId: z.string().min(1, "Select a vendor") });
/**
 * Confirm counts toward the PO status ring only once it has been shown, so the ring runs
 * %0 → %25 → %50 → %75 → %100 by step (Logiwa parity) instead of starting at 25%.
 */
export const confirmStepSchema = z.object({ reviewed: z.literal(true, { message: "Review the order on the Confirm step." }) });

/**
 * Next Step gate (Logiwa parity: Next is disabled until the step is valid; errors show on blur).
 * Returns true, or the first issue as the disabled-reason tooltip.
 */
export function firstIssue(schema: z.ZodType, values: unknown): true | string {
  const r = schema.safeParse(values);
  return r.success ? true : (r.error.issues[0]?.message ?? "Complete this step to continue");
}

/** Status-change modal: why a status pill is disabled, or null when it can be chosen. */
export function statusOptionReason(current: string, target: string, allowed: readonly string[]): string | null {
  if (target === current || (current === "Receiving" && target === "Started")) return "This is the current status.";
  if (allowed.includes(target)) return null;
  if (current === "Completed" || current === "Cancelled") return `A ${current.toLowerCase()} purchase order can't move to ${target}.`;
  return `A ${current.toLowerCase()} purchase order can't go back to ${target}.`;
}

export function nowRounded(now: Date = new Date()): string {
  const d = new Date(now);
  d.setSeconds(0, 0);
  return d.toISOString();
}

export function emptyValues(defaults: { warehouseId?: string | null; clientId?: string | null } = {}): PoFormValues {
  return {
    warehouseId: defaults.warehouseId ?? "", clientId: defaults.clientId ?? "", clientLabel: "", code: "", codeConflict: "", poType: "Purchase Order",
    poDate: nowRounded(), plannedReceivingDate: null, receivedAt: null, plannedArrivalDate: null, actualArrivalDate: null,
    referenceNumber: "", note: "", lines: [], vendorId: "", vendorLabel: "", customFields: {}, reviewed: false,
  };
}

export function valuesFromDetail(po: PoDetail): PoFormValues {
  return {
    warehouseId: po.warehouseId, clientId: po.clientId, clientLabel: po.clientName, code: po.code, codeConflict: "", poType: po.poType,
    poDate: po.poDate, plannedReceivingDate: po.plannedReceivingDate, receivedAt: po.receivedAt, plannedArrivalDate: po.plannedArrivalDate,
    actualArrivalDate: po.actualArrivalDate, referenceNumber: po.referenceNumber ?? "", note: po.note ?? "", vendorId: po.vendorId ?? "",
    vendorLabel: po.vendorName, customFields: { ...po.customFields }, reviewed: true,
    lines: po.lines.map((l) => ({
      id: l.id, key: l.id, productId: l.productId, sku: l.sku, productName: l.productName, barcode: l.barcode, imageUrl: l.imageUrl, uom: l.uom,
      packTypes: [{ packType: l.packType, uomQty: l.uomQuantity }], tracking: l.tracking, packType: l.packType, orderedQuantity: l.orderedQuantity,
      unitCost: l.unitCost, receivedQuantity: l.receivedQuantity, receivingLocationId: l.receivingLocationId, receivingLocationCode: l.receivingLocationCode,
      lotNumber: l.lotNumber, expiryDate: l.expiryDate, productionDate: l.productionDate, lpTypeId: l.lpTypeId, lpTypeCode: l.lpTypeCode, lpNumber: l.lpNumber, note: l.note,
    })),
  };
}

export const linesTotal = (lines: readonly Pick<LineDraft, "orderedQuantity" | "unitCost">[]): number => purchasePriceOf(lines);
export const linesQty = (lines: readonly Pick<LineDraft, "orderedQuantity">[]): number => lines.reduce((s, l) => s + l.orderedQuantity, 0);
export const skuCount = (lines: readonly Pick<LineDraft, "productId">[]): number => new Set(lines.map((l) => l.productId)).size;

/** Rail ring: %0 → %25 → %50 → %75 → %100 by step (Logiwa parity). */
export function stepPercent(stepIndex: number, total: number = STEP_KEYS.length): number {
  if (total <= 1) return 100;
  return Math.round((Math.max(0, Math.min(stepIndex, total - 1)) / (total - 1)) * 100);
}

const blankToNull = (v: string): string | null => (v.trim() ? v.trim() : null);

/** Wizard values → `POST /api/purchase-orders` / `PATCH /api/purchase-orders/[id]` body. */
export function toPayload(v: PoFormValues, version?: number): Record<string, unknown> {
  return {
    warehouseId: v.warehouseId, clientId: v.clientId, code: v.code.trim(), poType: v.poType, poDate: v.poDate,
    plannedReceivingDate: v.plannedReceivingDate, receivedAt: v.receivedAt, plannedArrivalDate: v.plannedArrivalDate, actualArrivalDate: v.actualArrivalDate,
    referenceNumber: blankToNull(v.referenceNumber), note: blankToNull(v.note), vendorId: v.vendorId, customFields: v.customFields,
    lines: v.lines.map((l) => ({
      ...(l.id ? { id: l.id } : {}), productId: l.productId, packType: l.packType, orderedQuantity: l.orderedQuantity, unitCost: l.unitCost,
      receivingLocationId: l.receivingLocationId, lotNumber: l.lotNumber, expiryDate: l.expiryDate, productionDate: l.productionDate,
      lpTypeId: l.lpTypeId, lpNumber: l.lpNumber, note: l.note,
    })),
    ...(version !== undefined ? { version } : {}),
  };
}

const csvCell = (value: unknown): string => {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export const LINE_CSV_HEADERS = ["SKU", "Product Description", "Barcode", "Pack Type", "Quantity", "Price Per Item", "Total Price", "Received Qty", "Open Qty", "Receiving Location", "Lot Batch Number", "Expiry Date", "Production Date", "LP Type", "LP Number", "Note"] as const;

/** PO lines → CSV (Step 2 Export on edit, Logiwa parity). Dates are kept as YYYY-MM-DD. */
export function linesCsv(lines: readonly LineDraft[]): string {
  const day = (v: string | null) => (v ? v.slice(0, 10) : "");
  const rows = lines.map((l) => [
    l.sku, l.productName, l.barcode, l.packType, l.orderedQuantity, l.unitCost.toFixed(2), (Math.round(l.orderedQuantity * l.unitCost * 100) / 100).toFixed(2),
    l.receivedQuantity, Math.max(0, l.orderedQuantity - l.receivedQuantity), l.receivingLocationCode ?? "", l.lotNumber ?? "", day(l.expiryDate), day(l.productionDate),
    l.lpTypeCode ?? "", l.lpNumber ?? "", l.note ?? "",
  ].map(csvCell).join(","));
  return [LINE_CSV_HEADERS.join(","), ...rows].join("\r\n");
}

let counter = 0;
export const newLineKey = (): string => `new-${Date.now().toString(36)}-${(counter++).toString(36)}`;

const ACRONYMS = new Set(["SKU", "LP", "LPN", "FIFO", "FEFO", "LIFO", "UOM", "ABC", "PO"]);

/**
 * Human label for a putaway algorithm name. System names are constants
 * (`SAME_SKU_EMPTY_LOCATION_ALGORITHM` → "Same SKU, empty location"); custom names pass through.
 */
export function putawayAlgorithmLabel(name: string | null | undefined): string {
  const raw = (name ?? "").trim();
  if (!raw) return "Putaway rule";
  if (!/^[A-Z0-9_]+$/.test(raw)) return raw;
  const words = raw.replace(/_ALGORITHM$/, "").split("_").filter(Boolean);
  if (words.length === 0) return "Putaway rule";
  const label = words.map((w, i) => (ACRONYMS.has(w) ? w : i === 0 ? w[0] + w.slice(1).toLowerCase() : w.toLowerCase())).join(" ");
  // "Same SKU empty location" reads as two criteria: split after the leading SKU match.
  return label.replace(/^Same SKU (?=\S)/, "Same SKU, ");
}

const REASON_TEXT: Readonly<Record<string, string>> = {
  "Check Assigned SKUs": "Not assigned to other SKUs",
  "Check Location Capacity": "Has room for this quantity",
  "Check Location Capacity Type": "Has a capacity type",
  "Check Max Locations per SKU": "Within the SKU's location limit",
  "Check Max Sku Count": "Within the location's SKU limit",
  "Check Product Group&Location Zone Match": "Zone matches the product group",
  "Check Same Client": "Holds only this client's stock",
  "Check Same Damaged Reason": "Same damage reason",
  "Check Same Expiry Date": "Same expiry date",
  "Check Same Lot Batch Number": "Same lot",
  "Check Same Product Group": "Same product group",
  "Check Same Product Type": "Same product type",
  "Check the same Production Date": "Same production date",
  "Check the same Receiving Date": "Same receiving date",
  "Configure Volumetric Putaway": "Fits by volume",
  "Suggest a location that has inventory of the same SKU & same pack type": "Already holds this SKU in this pack type",
  "Suggest a location that has inventory of the selected product group": "Holds the rule's product group",
  "Suggest a location that has inventory of the selected product type": "Holds the rule's product type",
  "Suggest a location that has inventory of this selected pack type": "Holds the rule's pack type",
  "Suggest a location that has the same SKU": "Already holds this SKU",
  "Suggest a location where the allocation is prevented": "Allocation is prevented here",
  "Suggest a location where the inventory sync to stores is prevented": "Store inventory sync is prevented here",
  "Suggest an empty location": "Empty location",
  "Suggest exactly the selected location": "The rule's chosen location",
  "Applied to all": "Matches the putaway rule",
};

/**
 * Putaway reasons for people: rule action labels ("Check Damaged Locations") become what
 * they mean for this location. Positive matches ("Already holds this SKU") come before
 * constraints ("Has room for this quantity"); duplicates are dropped.
 */
export function humanReasons(labels: readonly string[], opts: { readonly damaged?: boolean } = {}): string[] {
  const text = (label: string): string => {
    if (label === "Check Damaged Locations") return opts.damaged ? "Damaged-stock location" : "Not a damaged-stock location";
    const known = REASON_TEXT[label];
    if (known) return known;
    const m = /^Suggest a location with the selected (.+)$/.exec(label);
    if (m) return `Matches the rule's ${m[1]!.toLowerCase()}`;
    const t = /^Suggest a location with the (.+)$/.exec(label);
    return t ? `Matches the rule's ${t[1]!.toLowerCase()}` : label;
  };
  const positive = labels.filter((l) => l.startsWith("Suggest") || l === "Applied to all");
  const rest = labels.filter((l) => !positive.includes(l));
  return [...new Set([...positive, ...rest].map(text))];
}

/** Short putaway reason: the first reason inline, the rest summarised as "+N more". */
export function shortReason(reasons: readonly string[]): string {
  if (reasons.length === 0) return "";
  return reasons.length === 1 ? reasons[0]! : `${reasons[0]} +${reasons.length - 1} more`;
}

/** Receive drawer: why Receive is blocked by an included line's quantity, or null. */
export function receiveQtyIssue(lines: readonly { readonly include?: boolean; readonly quantity?: number | null }[]): string | null {
  const included = lines.filter((l) => l.include);
  if (included.length === 0) return "Select at least one line to receive.";
  const bad = included.some((l) => l.quantity === null || l.quantity === undefined || !Number.isInteger(l.quantity) || l.quantity < 1);
  return bad ? "Every selected line needs a whole quantity of at least 1." : null;
}

/** Line editor total, or null when quantity / price is missing or invalid (never a stale value). */
export function lineTotalOrNull(qty: unknown, price: unknown): number | null {
  if (typeof qty !== "number" || typeof price !== "number" || !Number.isFinite(qty) || !Number.isFinite(price)) return null;
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_LINE_QTY || price < 0) return null;
  return Math.round(qty * price * 100) / 100;
}

/** Step 1 gate: blocked while the PO number check is pending, then by the first schema issue. */
export function detailsCanProceed(values: PoFormValues): true | string {
  if (values.codeChecking) return CODE_CHECK_PENDING;
  return firstIssue(detailsStepSchema, values);
}
