/**
 * 3PL Billing (M11): contract grid fields, contract + fee schemas and the exact
 * operation → Fee By → Charge By matrix from Logiwa (08 §Edit Billing Form). PURE.
 */
import { z } from "zod";
import { BILLING_CALCULATION_TYPES, BILLING_FREQUENCIES, BILLING_OPERATION_TYPES, RULE_COMPARATORS } from "@/lib/enums";
import { requiredId, requiredText, versionField, type OrgField } from "./common";

export const BILLING_GRID_KEY = "billing-contracts";

export type OperationType = (typeof BILLING_OPERATION_TYPES)[number];
export type CalculationType = (typeof BILLING_CALCULATION_TYPES)[number];
export type Frequency = (typeof BILLING_FREQUENCIES)[number];

export const OPERATION_META: Readonly<Record<OperationType, { readonly description: string }>> = {
  "Shipment": { description: "Shipped orders, labels, LPs and packages" },
  "Recurring": { description: "A flat charge once per billing period" },
  "VAS": { description: "Value-added services logged as VAS operations" },
  "Pick & Pack": { description: "Completed picking and packing tasks" },
  "Receiving": { description: "Received units, LPs, POs and lines" },
  "Storage": { description: "Inventory held, from daily snapshots" },
  "Return": { description: "Received returns (RMAs)" },
  "Work Order": { description: "Completed work orders and kits" },
};

export const FEE_BY: Readonly<Record<OperationType, readonly string[]>> = {
  "Shipment": ["Per SO", "Per Label", "Per LP", "Shipment Package", "Per Product"],
  "Recurring": ["Recurring"],
  "VAS": ["Operation"],
  "Pick & Pack": ["Per Picking", "Per Packing"],
  "Receiving": ["Per Product", "Per LP", "Per PO", "Per SKU", "Per Volume", "Per Receiving Line"],
  "Storage": ["Location", "LP", "Product", "Total Volume", "Parent LP"],
  "Return": ["Per RMA", "Per SO", "Per Product", "Per SKU"],
  "Work Order": ["Per WorkOrder", "Per Kit", "Per Component"],
};

const PRODUCT_QTY = ["Product (UOM Quantity)", "Product (Pack Quantity)"] as const;

/** Charge By per `${operation}|${feeBy}`. */
export const CHARGE_BY: Readonly<Record<string, readonly string[]>> = {
  "Shipment|Per SO": ["SO"],
  "Shipment|Per Label": ["Label"],
  "Shipment|Per LP": ["LP"],
  "Shipment|Shipment Package": ["Shipment Package"],
  "Shipment|Per Product": [...PRODUCT_QTY, "SKU"],
  "Recurring|Recurring": ["Recurring"],
  "VAS|Operation": ["Operation Value"],
  "Pick & Pack|Per Picking": [...PRODUCT_QTY, "SO", "SKU"],
  "Pick & Pack|Per Packing": [...PRODUCT_QTY, "SO", "SKU"],
  "Receiving|Per Product": [...PRODUCT_QTY],
  "Receiving|Per LP": ["LP"],
  "Receiving|Per PO": ["PO"],
  "Receiving|Per SKU": ["SKU"],
  "Receiving|Per Volume": ["Volume"],
  "Receiving|Per Receiving Line": ["Receiving Line"],
  "Storage|Location": ["Location"],
  "Storage|LP": ["LP"],
  "Storage|Product": ["Product (UOM Quantity)"],
  "Storage|Total Volume": ["Volume"],
  "Storage|Parent LP": ["Parent LP"],
  "Return|Per RMA": ["RMA"],
  "Return|Per SO": ["SO"],
  "Return|Per Product": ["Product (UOM Quantity)"],
  "Return|Per SKU": ["SKU"],
  "Work Order|Per WorkOrder": ["Work Order"],
  "Work Order|Per Kit": ["Kit (UOM Quantity)"],
  "Work Order|Per Component": ["Component (UOM Quantity)"],
};

/** Fee By options for an operation, narrowed by storage calculation type. */
export function feeByOptions(operation: OperationType | null | undefined, calc?: CalculationType | null): readonly string[] {
  if (!operation) return [];
  if (operation === "Storage" && calc === "Distinct Period Count") return ["Location", "LP", "Parent LP"];
  if (operation === "Storage" && calc === "Split Month Storage") return ["LP"];
  return FEE_BY[operation];
}

export function chargeByOptions(operation: OperationType | null | undefined, feeBy: string | null | undefined): readonly string[] {
  if (!operation || !feeBy) return [];
  return CHARGE_BY[`${operation}|${feeBy}`] ?? [];
}

/** Unit word for the price strip: "3.00 per SO". */
export function chargeUnit(chargeBy: string): string {
  return chargeBy.replace(/\s*\((UOM|Pack) Quantity\)/, "").replace("Operation Value", "unit");
}

export const CALC_TYPE_TIPS: Readonly<Record<CalculationType, string>> = {
  "Daily Accumulation": "Charges every day's on-hand count: the sum of each daily snapshot in the period.",
  "At Peak Inventory": "Charges the highest single-day count in the period.",
  "At Period End": "Charges the count on the last snapshot of the period.",
  "Distinct Period Count": "Charges each distinct location, LP or parent LP used at any time in the period once.",
  "Average Calculation": "Charges the average daily count across the period's snapshots.",
  "Split Month Storage": "Standard rate through the split day, alternate rate for first receipts after it.",
};

export const SPLIT_TIPS = {
  splitDay: "The last calendar day of the month that uses the Standard Storage Rate.",
  standardRate: "Applies to initial receipts through the Split Day and to recurring monthly storage charges.",
  alternateRate: "Applies only to initial receipts after the Split Day through the end of the calendar month.",
} as const;

/* ---------------- Charge If (conditions) ---------------- */

export interface ChargeIfField {
  readonly key: string;
  readonly label: string;
  readonly group: "Location" | "LP" | "Product";
  readonly type: "boolean" | "text" | "number";
}

const b = (group: ChargeIfField["group"], key: string, label: string): ChargeIfField => ({ key, label, group, type: "boolean" });
const t = (group: ChargeIfField["group"], key: string, label: string): ChargeIfField => ({ key, label, group, type: "text" });
const n = (group: ChargeIfField["group"], key: string, label: string): ChargeIfField => ({ key, label, group, type: "number" });

export const CHARGE_IF_FIELDS: readonly ChargeIfField[] = [
  t("Location", "locationAreaType", "Location - Area Type"), t("Location", "locationColorCode", "Location - Color Code"),
  b("Location", "onlyDamaged", "Location - Only Damaged Items"), b("Location", "onlySingleClient", "Location - Only Single Client"),
  b("Location", "onlySingleLp", "Location - Only Single License Plate"), b("Location", "onlySingleLot", "Location - Only Single Lot Number"),
  b("Location", "onlySingleSku", "Location - Only Single SKU"), t("Location", "locationGroup", "Location Group"),
  t("Location", "locationType", "Location Type"), n("Location", "locationVolume", "Location Volume"), t("Location", "locationZone", "Location Zone"),
  t("LP", "lpType", "LP Type"), n("LP", "lpVolume", "LP Volume"), n("LP", "lpWeight", "LP Weight"),
  b("Product", "expiryTracking", "Product - Expiration Date Tracking"), b("Product", "isDigital", "Product - Is Digital Product"),
  b("Product", "isFoldable", "Product - Is Foldable"), b("Product", "isFragile", "Product - Is Fragile"),
  b("Product", "isHazmat", "Product - Is Hazardous"), b("Product", "isInsert", "Product - Is Insert"),
  b("Product", "isKit", "Product - Is Kit Item"), b("Product", "isLiquid", "Product - Is Liquid"),
  b("Product", "isOversized", "Product - Is Oversized"), b("Product", "isPackingMaterial", "Product - Is Packing Material"),
  b("Product", "isPoster", "Product - Is Poster"), b("Product", "isStackable", "Product - Is Stackable"),
  b("Product", "lotTracking", "Product - Lot/Batch Tracking"), b("Product", "serialTracking", "Product - Serial Number Tracking"),
  t("Product", "sku", "Product - Sku"), t("Product", "productGroup", "Product Group"), t("Product", "productType", "Product Type"),
  n("Product", "productVolume", "Product Volume"), n("Product", "productWeight", "Product Weight"), n("Product", "totalVolume", "Total Volume"),
];

export const CHARGE_IF_BY_KEY: ReadonlyMap<string, ChargeIfField> = new Map(CHARGE_IF_FIELDS.map((f) => [f.key, f]));

export const COMPARATOR_LABELS: Readonly<Record<(typeof RULE_COMPARATORS)[number], string>> = {
  equals: "Equals", notEquals: "Does not equal", contains: "Contains", notContains: "Does not contain", startsWith: "Starts with",
  endsWith: "Ends with", in: "Is any of", notIn: "Is none of", gt: "Greater than", gte: "Greater than or equal", lt: "Less than",
  lte: "Less than or equal", between: "Between", isEmpty: "Is empty", isNotEmpty: "Is not empty",
};

export function comparatorsFor(type: ChargeIfField["type"]): readonly (typeof RULE_COMPARATORS)[number][] {
  if (type === "boolean") return ["equals"];
  if (type === "number") return ["equals", "gt", "gte", "lt", "lte", "between"];
  return ["equals", "notEquals", "contains", "startsWith", "in", "notIn", "isEmpty", "isNotEmpty"];
}

export function conditionText(c: { readonly field: string; readonly comparator: string; readonly value: unknown }): string {
  const field = CHARGE_IF_BY_KEY.get(c.field)?.label ?? c.field;
  const cmp = COMPARATOR_LABELS[c.comparator as keyof typeof COMPARATOR_LABELS] ?? c.comparator;
  if (c.comparator === "isEmpty" || c.comparator === "isNotEmpty") return `${field} ${cmp.toLowerCase()}`;
  const value = Array.isArray(c.value) ? c.value.join(c.comparator === "between" ? " and " : ", ") : typeof c.value === "boolean" ? (c.value ? "Yes" : "No") : String(c.value ?? "");
  return `${field} ${cmp.toLowerCase()} ${value}`;
}

/* ---------------- grid ---------------- */

export const BILLING_FIELDS: readonly OrgField[] = [
  { field: "name", label: "Billing name", type: "text" },
  { field: "clientId", label: "Client", type: "enum" },
  { field: "warehouseId", label: "Warehouse", type: "enum" },
  { field: "approvalStatus", label: "Approval status", type: "enum", options: ["Draft", "Approved"] },
  { field: "frequency", label: "Period", type: "enum", options: BILLING_FREQUENCIES },
  { field: "calcStartDate", label: "Start date", type: "date" },
  { field: "lastCalculatedAt", label: "Last calculation date", type: "date" },
  { field: "createdAt", label: "Create date", type: "date" },
  { field: "feeCount", label: "Fees", type: "number" },
];
export const BILLING_SORT_FIELDS = ["name", "clientName", "approvalStatus", "warehouseCode", "calcStartDate", "lastCalculatedAt", "frequency", "createdByName", "createdAt", "nextPeriodStart", "feeCount"] as const;
export const BILLING_SEARCH_FIELDS = ["name", "clientName"] as const;

/* ---------------- schemas ---------------- */

export const contractSchema = z.object({
  name: requiredText("Billing form name", 120),
  clientId: requiredId("Client"),
  warehouseId: requiredId("Warehouse"),
  calcStartDate: z.string({ error: "Calc. start date is required" }).regex(/^\d{4}-\d{2}-\d{2}$/, "Calc. start date is required"),
  frequency: z.enum(BILLING_FREQUENCIES, { error: "Billing frequency is required" }),
  version: versionField,
});
export type ContractInput = z.input<typeof contractSchema>;
export type ContractSave = z.output<typeof contractSchema>;

export const CONTRACT_DEFAULTS: ContractInput = { name: "", clientId: "", warehouseId: "", calcStartDate: "", frequency: "Monthly" };

const money = (label: string) => z.number({ error: `${label} must be a number` }).min(0, `${label} can't be negative`).max(1_000_000, `${label} is too large`);

export const tierSchema = z.object({
  fromQty: z.number({ error: "From quantity is required" }).min(0, "Can't be negative"),
  toQty: z.number().min(0, "Can't be negative").nullable(),
  rate: money("Rate"),
});
export type TierInput = z.input<typeof tierSchema>;

const conditionValue = z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number()]))]);
export const feeConditionSchema = z.object({ field: z.string().min(1, "Choose a Charge If field"), comparator: z.enum(RULE_COMPARATORS), value: conditionValue });

export const feeSchema = z
  .object({
    name: requiredText("Fee name", 120),
    operationType: z.enum(BILLING_OPERATION_TYPES, { error: "Select an operation type" }),
    calculationType: z.enum(BILLING_CALCULATION_TYPES).nullable().optional(),
    feeBy: z.string({ error: "Fee by is required" }).min(1, "Fee by is required"),
    chargeBy: z.string({ error: "Charge by is required" }).min(1, "Charge by is required"),
    vasTypeId: z.string().max(64).nullable().optional(),
    useMinPrice: z.boolean().default(false),
    minPrice: money("Minimum price").nullable().optional(),
    useMaxPrice: z.boolean().default(false),
    maxPrice: money("Maximum price").nullable().optional(),
    splitDay: z.number().int().min(1).max(28).nullable().optional(),
    standardRate: money("Standard rate").nullable().optional(),
    alternateRate: money("Alternate rate").nullable().optional(),
    conditions: z.array(feeConditionSchema).max(20).default([]),
    tiers: z.array(tierSchema).max(20).default([]),
  })
  .superRefine((f, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (f.operationType === "Storage" && !f.calculationType) issue("calculationType", "Choose a fee calculation type");
    if (!feeByOptions(f.operationType, f.calculationType ?? null).includes(f.feeBy)) issue("feeBy", "Choose a Fee By for this operation");
    if (!chargeByOptions(f.operationType, f.feeBy).includes(f.chargeBy)) issue("chargeBy", "Choose a Charge By for this Fee By");
    if (f.operationType === "VAS" && !f.vasTypeId) issue("vasTypeId", "Choose the VAS type this fee charges");
    if (f.useMinPrice && (f.minPrice === null || f.minPrice === undefined)) issue("minPrice", "Enter the minimum price");
    if (f.useMaxPrice && (f.maxPrice === null || f.maxPrice === undefined)) issue("maxPrice", "Enter the maximum price");
    if (f.useMinPrice && f.useMaxPrice && (f.minPrice ?? 0) > (f.maxPrice ?? 0)) issue("maxPrice", "Maximum price must be at least the minimum");
    const split = f.operationType === "Storage" && f.calculationType === "Split Month Storage";
    if (split) {
      if (!f.splitDay) issue("splitDay", "Split day of month is required");
      if (f.standardRate === null || f.standardRate === undefined) issue("standardRate", "Standard rate is required");
      if (f.alternateRate === null || f.alternateRate === undefined) issue("alternateRate", "Alternate rate is required");
      return;
    }
    const tierError = validateTiers(f.tiers);
    if (tierError) issue("tiers", tierError);
  });

export type FeeInput = z.input<typeof feeSchema>;
export type FeeSave = z.output<typeof feeSchema>;

/** Tiers must start at 0 or 1, be contiguous and only the last may be open-ended. */
export function validateTiers(tiers: readonly { readonly fromQty: number; readonly toQty: number | null; readonly rate: number }[]): string | null {
  if (tiers.length === 0) return "Add at least one charge";
  for (let i = 0; i < tiers.length; i += 1) {
    const tier = tiers[i];
    if (!tier) continue;
    if (tier.toQty !== null && tier.toQty < tier.fromQty) return `Charge ${i + 1}: To quantity must be at least From quantity`;
    if (tier.toQty === null && i < tiers.length - 1) return `Charge ${i + 1}: only the last charge can be open-ended`;
    const prev = tiers[i - 1];
    if (prev && prev.toQty !== null && tier.fromQty !== prev.toQty + 1) return `Charge ${i + 1}: From quantity should be ${prev.toQty + 1}`;
  }
  return null;
}

export const FEE_DEFAULTS: FeeInput = {
  name: "", operationType: "Receiving", calculationType: null, feeBy: "", chargeBy: "", vasTypeId: null,
  useMinPrice: false, minPrice: null, useMaxPrice: false, maxPrice: null, splitDay: 15, standardRate: null, alternateRate: null,
  conditions: [], tiers: [{ fromQty: 1, toQty: null, rate: 0 }],
};

/** Days in the period [start, end) for a frequency, start-aligned. Pure date math on YYYY-MM-DD. */
export function periodEnd(start: string, frequency: Frequency): string {
  const [y, m, d] = start.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  const addDays = (n: number) => new Date(date.getTime() + n * 86_400_000);
  const addMonths = (n: number) => new Date(Date.UTC(y, m - 1 + n, d));
  let end: Date;
  switch (frequency) {
    case "Daily": end = addDays(1); break;
    case "Weekly": end = addDays(7); break;
    case "BiWeekly": end = addDays(14); break;
    case "SemiMonthly": end = d < 16 ? new Date(Date.UTC(y, m - 1, 16)) : new Date(Date.UTC(y, m, 1)); break;
    case "BiMonthly": end = addMonths(2); break;
    default: end = addMonths(1);
  }
  return end.toISOString().slice(0, 10);
}

/** The period [start, end) that contains `day` (YYYY-MM-DD), stepping from the contract start. */
export function periodContaining(calcStartDate: string, frequency: Frequency, day: string): { start: string; end: string } {
  let start = calcStartDate;
  if (frequency === "Monthly" || frequency === "BiMonthly") {
    const [sy, sm, sd] = calcStartDate.split("-").map(Number) as [number, number, number];
    const [dy, dm, dd] = day.split("-").map(Number) as [number, number, number];
    const step = frequency === "Monthly" ? 1 : 2;
    let months = (dy - sy) * 12 + (dm - sm);
    if (dd < sd) months -= 1;
    months = Math.max(0, Math.floor(months / step) * step);
    start = new Date(Date.UTC(sy, sm - 1 + months, sd)).toISOString().slice(0, 10);
    return { start, end: periodEnd(start, frequency) };
  }
  for (let i = 0; i < 2000; i += 1) {
    const end = periodEnd(start, frequency);
    if (day < end || day < start) return { start, end };
    start = end;
  }
  return { start, end: periodEnd(start, frequency) };
}

/** The most recently closed period before `today` (what the scheduler and Calculate bill). */
export function lastClosedPeriod(calcStartDate: string, frequency: Frequency, today: string): { start: string; end: string } | null {
  const current = periodContaining(calcStartDate, frequency, today);
  if (current.start <= calcStartDate) return today >= current.end ? current : null;
  const prevDay = new Date(Date.parse(`${current.start}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return periodContaining(calcStartDate, frequency, prevDay);
}

/** Graduated tier pricing: each unit is charged at the rate of the tier it falls in. */
export function tieredAmount(quantity: number, tiers: readonly { readonly fromQty: number | null; readonly toQty: number | null; readonly rate: number }[]): { total: number; parts: { fromQty: number; toQty: number | null; quantity: number; rate: number; amount: number }[] } {
  const parts: { fromQty: number; toQty: number | null; quantity: number; rate: number; amount: number }[] = [];
  if (tiers.length === 0 || quantity <= 0) return { total: 0, parts };
  const sorted = [...tiers].sort((a, c) => (a.fromQty ?? 0) - (c.fromQty ?? 0));
  if (sorted.length === 1) {
    const only = sorted[0]!;
    const amount = Math.round(quantity * only.rate * 100) / 100;
    return { total: amount, parts: [{ fromQty: only.fromQty ?? 0, toQty: only.toQty, quantity, rate: only.rate, amount }] };
  }
  let total = 0;
  for (const tier of sorted) {
    const from = Math.max(1, tier.fromQty ?? 1);
    const to = tier.toQty ?? Number.POSITIVE_INFINITY;
    const qty = Math.max(0, Math.min(quantity, to) - from + 1);
    if (qty <= 0) continue;
    const amount = Math.round(qty * tier.rate * 100) / 100;
    total += amount;
    parts.push({ fromQty: from, toQty: tier.toQty, quantity: qty, rate: tier.rate, amount });
  }
  return { total: Math.round(total * 100) / 100, parts };
}

/** Min/max price adjustment applied to a fee's period total. */
export function minMaxAdjust(total: number, fee: { readonly useMinPrice: boolean; readonly minPrice: number | null; readonly useMaxPrice: boolean; readonly maxPrice: number | null }): number {
  let adjusted = total;
  if (fee.useMinPrice && fee.minPrice !== null && adjusted < fee.minPrice) adjusted = fee.minPrice;
  if (fee.useMaxPrice && fee.maxPrice !== null && adjusted > fee.maxPrice) adjusted = fee.maxPrice;
  return Math.round((adjusted - total) * 100) / 100;
}
