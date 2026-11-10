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

/** Fee pricing modes (see priceQuantity). Declared first: feeSchema uses it at module load. */
export const PRICING_MODES = ["perUnit", "fromQuantity", "tierBase", "graduated"] as const;
export type PricingMode = (typeof PRICING_MODES)[number];

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
  "Shipment|Per Product": [...PRODUCT_QTY, "SKU", "Kit (UOM Quantity)", "Component (UOM Quantity)"],
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
  if (chargeBy === "Recurring") return "period";
  // Legacy values ("Per Order", "Per Unit", "Per Day") would otherwise read "2.85 USD per Per Order".
  const legacy = /^per\s+(.+)$/i.exec(chargeBy.trim());
  if (legacy) return legacy[1].toLowerCase();
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

export const CHARGE_IF_GROUPS = ["Location", "LP", "Product", "Shipment Order", "SO Detail", "Carrier", "Location Custom", "LP Type Custom", "Product Custom", "Shipment Plan Custom", "SO Custom"] as const;
export type ChargeIfGroup = (typeof CHARGE_IF_GROUPS)[number];

export interface ChargeIfField {
  readonly key: string;
  readonly label: string;
  readonly group: ChargeIfGroup;
  readonly type: "boolean" | "text" | "number";
}

const b = (group: ChargeIfGroup, key: string, label: string): ChargeIfField => ({ key, label, group, type: "boolean" });
const t = (group: ChargeIfGroup, key: string, label: string): ChargeIfField => ({ key, label, group, type: "text" });
const n = (group: ChargeIfGroup, key: string, label: string): ChargeIfField => ({ key, label, group, type: "number" });

/** Custom-field slots (enums.CUSTOM_FIELD_SLOTS) exposed per entity as `cf.<entity>.<slot>` facts. */
export const CUSTOM_SLOT_LABELS: readonly { readonly slot: string; readonly label: string; readonly type: ChargeIfField["type"] }[] = [
  { slot: "textBox1", label: "Text Box 1", type: "text" }, { slot: "textBox2", label: "Text Box 2", type: "text" }, { slot: "textBox3", label: "Text Box 3", type: "text" },
  { slot: "dropDown1", label: "Drop Down 1", type: "text" }, { slot: "dropDown2", label: "Drop Down 2", type: "text" },
  { slot: "date1", label: "Date 1", type: "text" }, { slot: "date2", label: "Date 2", type: "text" }, { slot: "date3", label: "Date 3", type: "text" },
  { slot: "toggle1", label: "Toggle 1", type: "boolean" }, { slot: "toggle2", label: "Toggle 2", type: "boolean" },
];
export const CUSTOM_ENTITIES: readonly { readonly entity: "location" | "lpType" | "product" | "shipmentPlan" | "so"; readonly prefix: string; readonly group: ChargeIfGroup }[] = [
  { entity: "location", prefix: "LOCATION", group: "Location Custom" }, { entity: "lpType", prefix: "LPTYPE", group: "LP Type Custom" },
  { entity: "product", prefix: "PRODUCT", group: "Product Custom" }, { entity: "shipmentPlan", prefix: "SHIPMENT PLAN", group: "Shipment Plan Custom" },
  { entity: "so", prefix: "SO", group: "SO Custom" },
];
const customChargeIf: ChargeIfField[] = CUSTOM_ENTITIES.flatMap((e) => CUSTOM_SLOT_LABELS.map((s) => ({ key: `cf.${e.entity}.${s.slot}`, label: `${e.prefix} - Custom ${s.label}`, group: e.group, type: s.type })));

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
  t("Carrier", "carrier", "Carrier"), n("Carrier", "carrierRate", "CARRIER - Rate"), n("Carrier", "labelCost", "Label Cost"),
  t("Carrier", "carrierBillingType", "Carrier Billing Type"), t("Carrier", "shipmentMethod", "Shipment Method"),
  t("Carrier", "shipmentPackageType", "Shipment Package Type"),
  n("Shipment Order", "nofLines", "Nof Lines"), t("Shipment Order", "shipmentOrderType", "Shipment Order Type"),
  t("Shipment Order", "soStore", "SO Store"), t("Shipment Order", "soChannel", "SO Channel"), t("Shipment Order", "orderTag", "Order Tag"),
  t("Shipment Order", "priority", "Priority"), n("Shipment Order", "discount", "Discount"), n("Shipment Order", "totalShippingCost", "Total Shipping Cost"),
  n("Shipment Order", "soTotalWeight", "Total Weight"), n("Shipment Order", "soTotalQuantity", "Total Quantity"),
  t("Shipment Order", "shipCountry", "Ship To Country"), t("Shipment Order", "shipState", "Ship To State"),
  b("Shipment Order", "isGift", "SO - Is Gift"), b("Shipment Order", "isPrime", "SO - Is Prime"),
  t("SO Detail", "lineNote1", "SO DETAIL - Line Note 1"), t("SO Detail", "lineNote2", "SO DETAIL - Line Note 2"), t("SO Detail", "lineNote3", "SO DETAIL - Line Note 3"),
  b("SO Detail", "isKitComponent", "SO DETAIL - Is Kit Component"),
  ...customChargeIf,
];

export const CHARGE_IF_BY_KEY: ReadonlyMap<string, ChargeIfField> = new Map(CHARGE_IF_FIELDS.map((f) => [f.key, f]));

/** Which attribute groups have facts for each operation type (what the billing engine actually loads). */
export const CHARGE_IF_GROUPS_BY_OP: Readonly<Record<OperationType, readonly ChargeIfGroup[]>> = {
  "Shipment": ["Shipment Order", "Carrier", "SO Detail", "Product", "SO Custom", "Shipment Plan Custom", "Product Custom"],
  "Pick & Pack": ["Shipment Order", "Carrier", "SO Detail", "Product", "Location", "SO Custom", "Product Custom", "Location Custom"],
  "Receiving": ["Product", "Location", "LP", "Product Custom", "Location Custom", "LP Type Custom"],
  "Return": ["Product", "Location", "LP", "Product Custom", "Location Custom", "LP Type Custom"],
  "Storage": ["Location", "LP", "Product", "Location Custom", "LP Type Custom", "Product Custom"],
  "Work Order": ["Product", "Product Custom"],
  "VAS": [],
  "Recurring": [],
};

/** The Charge If attributes that apply to an operation, grouped in display order. */
export function chargeIfFieldsFor(operation: OperationType | null | undefined): readonly ChargeIfField[] {
  if (!operation) return [];
  return CHARGE_IF_GROUPS_BY_OP[operation].flatMap((g) => CHARGE_IF_FIELDS.filter((f) => f.group === g));
}

export const COMPARATOR_LABELS: Readonly<Record<(typeof RULE_COMPARATORS)[number], string>> = {
  equals: "Equals", notEquals: "Does not equal", contains: "Contains", notContains: "Does not contain", startsWith: "Starts with",
  endsWith: "Ends with", in: "Is any of", notIn: "Is none of", gt: "Greater than", gte: "Greater than or equal", lt: "Less than",
  lte: "Less than or equal", between: "Between", isEmpty: "Is empty", isNotEmpty: "Is not empty", dateIs: "Is",
};

export function comparatorsFor(type: ChargeIfField["type"], key?: string): readonly (typeof RULE_COMPARATORS)[number][] {
  if (key && LOOKUP_CHARGE_IF.has(key)) return LOOKUP_COMPARATORS;
  if (type === "boolean") return ["equals"];
  if (type === "number") return ["equals", "notEquals", "gt", "gte", "lt", "lte", "between", "isEmpty", "isNotEmpty"];
  return ["equals", "notEquals", "contains", "notContains", "startsWith", "endsWith", "in", "notIn", "isEmpty", "isNotEmpty"];
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
/** Logiwa 3PL Billing filters: Billing Name, Client, Create Date, Period, Warehouse. */
export const BILLING_FILTER_PRESET = ["name", "clientId", "createdAt", "frequency", "warehouseId"] as const;
export const BILLING_SORT_FIELDS = ["name", "clientName", "approvalStatus", "warehouseCode", "calcStartDate", "lastCalculatedAt", "frequency", "createdByName", "createdAt", "nextPeriodStart", "feeCount"] as const;
export const BILLING_SEARCH_FIELDS = ["name", "clientName"] as const;

/* ---------------- schemas ---------------- */

export const contractSchema = z.object({
  name: requiredText("Billing form name", 100),
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
    name: requiredText("Fee name", 100),
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
    chargeOneTime: z.boolean().default(false),
    pricingMode: z.enum(PRICING_MODES).default("graduated"),
    conditions: z.array(feeConditionSchema).max(20).default([]),
    tiers: z.array(tierSchema).max(20).default([]),
  })
  .superRefine((f, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (f.operationType === "Storage" && !f.calculationType) issue("calculationType", "Choose a fee calculation type");
    if (!feeByOptions(f.operationType, f.calculationType ?? null).includes(f.feeBy)) issue("feeBy", "Choose a Fee By for this operation");
    if (!chargeByOptions(f.operationType, f.feeBy).includes(f.chargeBy)) issue("chargeBy", "Choose a Charge By for this Fee By");
    if (f.chargeOneTime && f.operationType !== "Recurring") issue("chargeOneTime", "Charge one time applies only to Recurring fees");
    const allowed = new Set(chargeIfFieldsFor(f.operationType).map((x) => x.key));
    f.conditions.forEach((c, i) => {
      if (!allowed.has(c.field)) ctx.addIssue({ code: "custom", path: ["conditions", i, "field"], message: `${CHARGE_IF_BY_KEY.get(c.field)?.label ?? c.field} doesn't apply to ${f.operationType} fees` });
      else if ((c.comparator === "in" || c.comparator === "notIn") && (!Array.isArray(c.value) || c.value.length === 0)) ctx.addIssue({ code: "custom", path: ["conditions", i, "value"], message: `Pick at least one ${CHARGE_IF_BY_KEY.get(c.field)?.label ?? "value"}` });
    });
    if (f.operationType === "VAS" && !f.vasTypeId) issue("vasTypeId", "Choose the VAS type this fee charges");
    if (f.useMinPrice && (f.minPrice === null || f.minPrice === undefined)) issue("minPrice", "Enter the minimum price");
    if (f.useMaxPrice && (f.maxPrice === null || f.maxPrice === undefined)) issue("maxPrice", "Enter the maximum price");
    if (f.useMinPrice && f.useMaxPrice && (f.minPrice ?? 0) > (f.maxPrice ?? 0)) issue("maxPrice", "Maximum price must be at least the minimum");
    const split = f.operationType === "Storage" && f.calculationType === "Split Month Storage";
    if (split) {
      if (!f.splitDay) issue("splitDay", "Split day of month is required");
      if (f.standardRate === null || f.standardRate === undefined) issue("standardRate", "Standard rate is required");
      if (f.alternateRate === null || f.alternateRate === undefined) issue("alternateRate", "Alternate rate is required");
      if ((f.standardRate ?? 0) <= 0 && (f.alternateRate ?? 0) <= 0) issue("standardRate", "Enter a rate greater than 0");
      return;
    }
    const tierError = validatePricing(f.pricingMode, f.tiers);
    if (tierError) issue("tiers", tierError);
    else if (f.tiers.length > 0 && f.tiers.every((t) => t.rate <= 0)) issue("tiers", "Enter a rate greater than 0");
  });

export type FeeInput = z.input<typeof feeSchema>;
export type FeeSave = z.output<typeof feeSchema>;

/**
 * Tiers are contiguous and only the last may be open-ended. Boundaries use the "up to / above"
 * form (Logiwa "1st to 100th / above 100"): a charge starts where the previous one ends
 * (0–100, 100–500 = units above 100 up to 500), which works for whole and fractional units
 * (volume, weight). The legacy whole-unit form (1–100, 101–500) is still accepted.
 */
export function validateTiers(tiers: readonly { readonly fromQty: number; readonly toQty: number | null; readonly rate: number }[]): string | null {
  if (tiers.length === 0) return "Add at least one charge";
  for (let i = 0; i < tiers.length; i += 1) {
    const tier = tiers[i];
    if (!tier) continue;
    const prev = tiers[i - 1];
    const continuous = Boolean(prev && prev.toQty !== null && tier.fromQty === prev.toQty);
    if (tier.toQty !== null && (continuous ? tier.toQty <= tier.fromQty : tier.toQty < tier.fromQty)) return `Charge ${i + 1}: Up to must be greater than From`;
    if (tier.toQty === null && i < tiers.length - 1) return `Charge ${i + 1}: only the last charge can be open-ended`;
    if (prev && prev.toQty !== null && tier.fromQty !== prev.toQty && tier.fromQty !== prev.toQty + 1) return `Charge ${i + 1}: should start at ${prev.toQty} (where charge ${i} ends)`;
  }
  return null;
}

/** Exclusive lower bound of tier `i`: the previous tier's Up to (both forms), or from − 1 for the first tier. */
function tierFloor(sorted: readonly { readonly fromQty: number | null; readonly toQty: number | null }[], i: number): number {
  const prev = sorted[i - 1];
  if (prev && prev.toQty !== null) return prev.toQty;
  return Math.max(1, sorted[i]!.fromQty ?? 1) - 1;
}

export const FEE_DEFAULTS: FeeInput = {
  // No operation is preselected: the user must choose one explicitly (critic R4).
  name: "", operationType: undefined as unknown as FeeInput["operationType"], calculationType: null, feeBy: "", chargeBy: "", vasTypeId: null,
  useMinPrice: false, minPrice: null, useMaxPrice: false, maxPrice: null, chargeOneTime: false, pricingMode: "perUnit", splitDay: 15, standardRate: null, alternateRate: null,
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
  for (let i = 0; i < sorted.length; i += 1) {
    const tier = sorted[i]!;
    // Each tier covers (floor, Up to]; legacy whole-unit tiers (1–100, 101–500) get floor 100, so a
    // fractional 100.5 bills 0.5 in the second tier instead of falling in a gap.
    const floor = tierFloor(sorted, i);
    const from = Math.max(1, tier.fromQty ?? 1);
    const to = tier.toQty ?? Number.POSITIVE_INFINITY;
    const qty = Math.max(0, Math.round((Math.min(quantity, to) - floor) * 10_000) / 10_000);
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

/* ---------------- Pricing modes (Logiwa "Charge": For Each Unit / From Quantity / Tier Base) ---------------- */

export const PRICING_MODE_META: Readonly<Record<PricingMode, { readonly title: string; readonly description: string }>> = {
  perUnit: { title: "For each unit", description: "One rate for every unit in the period." },
  fromQuantity: { title: "From quantity", description: "Charge only the units above a threshold." },
  tierBase: { title: "Tier base", description: "All units are priced at the rate of the tier the total lands in." },
  graduated: { title: "Graduated", description: "Each unit is priced at the rate of the range it falls in." },
};

type PriceTier = { readonly fromQty: number | null; readonly toQty: number | null; readonly rate: number };
export interface PricePart { readonly fromQty: number; readonly toQty: number | null; readonly quantity: number; readonly rate: number; readonly amount: number }

const cents = (n: number): number => Math.round(n * 100) / 100;

/**
 * Prices a period quantity under a pricing mode:
 * - perUnit: quantity × the first rate.
 * - fromQuantity: only units from `fromQty` on are charged (qty − (from − 1)) × rate.
 * - tierBase: the tier containing the whole quantity sets one rate for every unit.
 * - graduated: tieredAmount (each unit at its own range's rate).
 */
export function priceQuantity(quantity: number, tiers: readonly PriceTier[], mode: PricingMode = "graduated"): { total: number; parts: PricePart[] } {
  if (tiers.length === 0 || quantity <= 0) return { total: 0, parts: [] };
  const sorted = [...tiers].sort((a, c) => (a.fromQty ?? 0) - (c.fromQty ?? 0));
  const first = sorted[0]!;
  if (mode === "perUnit") {
    const amount = cents(quantity * first.rate);
    return { total: amount, parts: [{ fromQty: 1, toQty: null, quantity, rate: first.rate, amount }] };
  }
  if (mode === "fromQuantity") {
    const from = Math.max(1, first.fromQty ?? 1);
    const billable = Math.max(0, Math.round((quantity - (from - 1)) * 10_000) / 10_000);
    if (billable <= 0) return { total: 0, parts: [] };
    const amount = cents(billable * first.rate);
    return { total: amount, parts: [{ fromQty: from, toQty: null, quantity: billable, rate: first.rate, amount }] };
  }
  if (mode === "tierBase") {
    // The first tier whose Up to holds the total (tiers are contiguous, so a 100.5 between legacy 100 / 101 lands in the next one).
    const hit = sorted.find((t) => t.toQty === null || quantity <= t.toQty) ?? sorted[sorted.length - 1]!;
    const amount = cents(quantity * hit.rate);
    return { total: amount, parts: [{ fromQty: Math.max(1, hit.fromQty ?? 1), toQty: hit.toQty, quantity, rate: hit.rate, amount }] };
  }
  return tieredAmount(quantity, sorted);
}

/** Human formula for the live preview: "150 × 0.25 = 37.50". */
export function priceFormula(quantity: number, tiers: readonly PriceTier[], mode: PricingMode): string {
  const { total, parts } = priceQuantity(quantity, tiers, mode);
  if (parts.length === 0) return mode === "fromQuantity" ? `Below the threshold: nothing charged` : "Nothing charged";
  const rate = (r: number) => r.toFixed(r * 100 % 1 ? 4 : 2);
  if (mode === "fromQuantity") return `${quantity} − ${parts[0]!.fromQty - 1} free = ${parts[0]!.quantity} × ${rate(parts[0]!.rate)} = ${total.toFixed(2)}`;
  if (mode === "tierBase") return `${quantity} lands in ${parts[0]!.fromQty}–${parts[0]!.toQty ?? "∞"}: ${quantity} × ${rate(parts[0]!.rate)} = ${total.toFixed(2)}`;
  return `${parts.map((p) => `${p.quantity} × ${rate(p.rate)}`).join(" + ")} = ${total.toFixed(2)}`;
}

/** Mode-specific tier rules (on top of validateTiers for the ranged modes). */
export function validatePricing(mode: PricingMode, tiers: readonly { readonly fromQty: number; readonly toQty: number | null; readonly rate: number }[]): string | null {
  if (tiers.length === 0) return "Add a rate";
  if (mode === "perUnit") return tiers.length === 1 ? null : "For each unit uses a single rate";
  if (mode === "fromQuantity") {
    if (tiers.length !== 1) return "From quantity uses a single threshold and rate";
    return (tiers[0]?.fromQty ?? 0) >= 1 ? null : "Charge from quantity must be 1 or more";
  }
  return validateTiers(tiers);
}

/* ---------------- Reserved fee flags (Charge One Time, pricing mode) ---------------- */

/** Stored as reserved conditions on the fee row until billing_fees gets its own columns (REQ R2-1, R2-8). */
export const ONE_TIME_FIELD = "__chargeOneTime";
export const PRICING_FIELD = "__pricingMode";
const isReserved = (field: string): boolean => field.startsWith("__");

export function withOneTime<C extends { readonly field: string }>(conditions: readonly C[], oneTime: boolean, pricingMode?: PricingMode): (C | { field: string; comparator: "equals"; value: true | string })[] {
  const rest: (C | { field: string; comparator: "equals"; value: true | string })[] = conditions.filter((c) => !isReserved(c.field));
  if (oneTime) rest.push({ field: ONE_TIME_FIELD, comparator: "equals", value: true });
  if (pricingMode && pricingMode !== "graduated") rest.push({ field: PRICING_FIELD, comparator: "equals", value: pricingMode });
  return rest;
}

export function splitOneTime<C extends { readonly field: string }>(conditions: readonly C[] | null | undefined): { chargeOneTime: boolean; pricingMode: PricingMode; conditions: C[] } {
  const list = conditions ?? [];
  const mode = (list.find((c) => c.field === PRICING_FIELD) as { value?: unknown } | undefined)?.value;
  return {
    chargeOneTime: list.some((c) => c.field === ONE_TIME_FIELD),
    pricingMode: (PRICING_MODES as readonly unknown[]).includes(mode) ? (mode as PricingMode) : "graduated",
    conditions: list.filter((c) => !isReserved(c.field)),
  };
}

/* ---------------- Charge If value pickers ---------------- */

/** Attributes whose values come from master data / activity: a multi-select with Is any of / Is none of / empty. */
export const LOOKUP_CHARGE_IF = new Set([
  "carrier", "carrierBillingType", "shipmentMethod", "shipmentPackageType", "shipmentOrderType", "soStore", "soChannel", "orderTag", "priority",
  "shipCountry", "shipState", "locationAreaType", "locationType", "locationZone", "locationGroup", "lpType", "productType", "productGroup",
]);
export const isLookupChargeIf = (key: string): boolean => LOOKUP_CHARGE_IF.has(key);
export const LOOKUP_COMPARATORS = ["in", "notIn", "isEmpty", "isNotEmpty"] as const;

/* ---------------- periods ---------------- */

/** Inclusive last calendar day of a [start, end) period. */
export const lastDayOf = (endExclusive: string): string => new Date(Date.parse(`${endExclusive}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** Today's calendar date (YYYY-MM-DD) in an IANA time zone; falls back to UTC on a bad zone. */
export function todayIn(timeZone: string | null | undefined, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** True when [aStart, aEnd] and [bStart, bEnd] (inclusive YYYY-MM-DD) share a day. */
export const periodsOverlap = (aStart: string, aEnd: string, bStart: string, bEnd: string): boolean => aStart <= bEnd && bStart <= aEnd;

/** Calendar-day strings (YYYY-MM-DD) read at local noon, so a user's date pattern never shifts them a day in negative-offset time zones. */
export const dayValue = (ymd: string | null | undefined): Date | null => (ymd ? new Date(`${ymd.slice(0, 10)}T12:00:00`) : null);
