/**
 * Data Setup (M14): the 18 lookup tables (Logiwa routes and labels), their scope (global,
 * warehouse or client), type-specific fields stored in `lookup_values.meta`, grid fields and
 * the drawer schema; plus Auto Code Generation preferences. PURE.
 */
import { z } from "zod";
import type { LookupType } from "@/lib/enums";
import { idField, optionalText, requiredText, versionField, type AdminField } from "./common";

export type LookupScope = "global" | "warehouse" | "client";

export interface LookupDef {
  readonly type: LookupType;
  readonly slug: string;
  /** Singular noun for buttons ("VAS Type" -> "Create New VAS Type"). */
  readonly noun: string;
  readonly title: string;
  readonly description: string;
  readonly scope: LookupScope;
  /** Warehouse / client is required (Location Zone needs a warehouse). */
  readonly scopeRequired?: boolean;
  readonly hasCode?: boolean;
}

export const LOOKUP_DEFS: readonly LookupDef[] = [
  { type: "po_type", slug: "purchase-order-type", noun: "Purchase Order Type", title: "Purchase Order Type", description: "Types offered on purchase orders and used by screen configuration conditions.", scope: "global" },
  { type: "so_type", slug: "shipment-order-type", noun: "Shipment Order Type", title: "Shipment Order Type", description: "Order types for shipment orders, used by job type and workflow conditions.", scope: "global" },
  { type: "order_merge_rule", slug: "order-merge-rule", noun: "Order Merge Rule", title: "Order Merge Rule", description: "Which open orders are merged into one shipment before picking, per warehouse.", scope: "warehouse", scopeRequired: true },
  { type: "work_order_type", slug: "work-order-type", noun: "Work Order Type", title: "Work Order Type", description: "Types of kitting and assembly work orders.", scope: "global" },
  { type: "damage_reason", slug: "damaged-reasons", noun: "Damage Reason", title: "Damage Reasons", description: "Reasons offered when stock is marked damaged during picking, counting or receiving.", scope: "global" },
  { type: "pack_type", slug: "pack-types", noun: "Pack Type", title: "Pack Type", description: "Units of measure for product pack types (Each, Case, Pallet…).", scope: "global" },
  { type: "product_type", slug: "product-types", noun: "Product Type", title: "Product Type", description: "Product types, optionally limited to one client.", scope: "client" },
  { type: "product_group", slug: "product-groups", noun: "Product Group", title: "Product Group", description: "Product groups used for picking, billing and count conditions.", scope: "client" },
  { type: "location_group", slug: "location-group", noun: "Location Group", title: "Location Group", description: "Groups of locations within a warehouse.", scope: "warehouse", scopeRequired: true },
  { type: "location_zone", slug: "location-zone", noun: "Location Zone", title: "Location Zone", description: "Zones within a warehouse, used by picking and put-away.", scope: "warehouse", scopeRequired: true, hasCode: true },
  { type: "vas_type", slug: "vas-type", noun: "VAS Type", title: "VAS Type", description: "Value-added services billed to clients.", scope: "client" },
  { type: "mobile_cart_type", slug: "mobile-cart-type", noun: "Mobile Cart Type", title: "Mobile Cart Type", description: "Cart layouts (levels × columns, cart and cell dimensions) for pick-and-sort carts.", scope: "warehouse" },
  { type: "packing_warning_type", slug: "packing-warning-type", noun: "Packing Warning Type", title: "Packing Warning Type", description: "Warnings shown to packers for an order (fragile, gift, inspect…).", scope: "global" },
  { type: "custom_carrier", slug: "custom-carrier", noun: "Custom Carrier", title: "Custom Carrier", description: "Carriers without an integration (local courier, customer pickup).", scope: "global", hasCode: true },
  { type: "return_process", slug: "return-process", noun: "Return Process", title: "Return Process", description: "What happens to returned items (restock, quarantine, dispose…).", scope: "global" },
  { type: "adjustment_reason", slug: "inventory-adjustment-reason", noun: "Inventory Adjustment Reason", title: "Inventory Adjustment Reason", description: "Reasons required when inventory is adjusted by hand.", scope: "global" },
  { type: "so_cancel_reason", slug: "shipment-order-cancel-reason", noun: "Shipment Order Cancel Reason", title: "Shipment Order Cancel Reason", description: "Reasons offered in the Cancel Order modal.", scope: "global" },
  { type: "return_reason", slug: "return-reason", noun: "Return Reason", title: "Return Reason", description: "Customer and actual reasons recorded on return orders.", scope: "global" },
];

export const CODE_GENERATION_SLUG = "code-generation";

/**
 * Lookups managed inside another Data Setup page, so they get no nav entry of their own (one
 * place per data set). Their old URL redirects to the host page.
 */
export const EMBEDDED_LOOKUPS: Readonly<Record<string, string>> = { "return-reason": "return-process" };

export interface DataSetupNavDef {
  readonly slug: string;
  readonly title: string;
  /** Lookup type whose value count the nav shows (null = no count). */
  readonly countType: string | null;
}

/** Data Setup nav: Auto Code Generation, then every lookup that has its own page. */
export function dataSetupNavDefs(): readonly DataSetupNavDef[] {
  return [
    { slug: CODE_GENERATION_SLUG, title: "Auto Code Generation", countType: null },
    ...LOOKUP_DEFS.filter((d) => !EMBEDDED_LOOKUPS[d.slug]).map((d) => ({
      slug: d.slug, title: d.title,
      // Return Process shows its embedded Return reasons count.
      countType: d.type === "return_process" ? "return_reason" : d.type,
    })),
  ];
}

const BY_SLUG: ReadonlyMap<string, LookupDef> = new Map(LOOKUP_DEFS.map((d) => [d.slug, d]));
const BY_TYPE: ReadonlyMap<string, LookupDef> = new Map(LOOKUP_DEFS.map((d) => [d.type, d]));

export function lookupBySlug(slug: string): LookupDef | undefined {
  return BY_SLUG.get(slug);
}

export function lookupByType(type: string): LookupDef | undefined {
  return BY_TYPE.get(type);
}

/* ---------------- type-specific fields ---------------- */

export const VAS_CALCULATION_TYPES = ["Total Price", "Vas Quantity"] as const;
export const CART_OPERATIONS = ["Picking", "Sorting", "Pick and sort"] as const;
export const DIMENSION_UNITS = ["Inch", "Foot", "Centimeter", "Meter"] as const;
export const VOLUME_UNITS = ["Cubic Inch", "Cubic Foot", "Cubic Centimeter", "Cubic Meter", "Liter", "Gallon"] as const;

/**
 * Order merge conditions. Keys are `shipment_orders` properties (`client` → `clientId`), read
 * by the wave Order Merge run (`waves-run.runOrderMerge`). `recommended` ones are pre-checked on
 * a new rule (Logiwa's "Default Conditions").
 */
export const MERGE_CRITERIA = [
  { key: "client", label: "Client", recommended: true },
  { key: "customerName", label: "Customer name", recommended: true },
  { key: "channel", label: "Channel", recommended: true },
  { key: "shipAddress", label: "Shipping address", recommended: true },
  { key: "shipZip", label: "Zip code", recommended: false },
  { key: "storeOrderNumber", label: "Store order number", recommended: false },
  { key: "carrier", label: "Carrier", recommended: false },
  { key: "shippingService", label: "Shipping option", recommended: false },
  { key: "priority", label: "Order priority", recommended: false },
  { key: "expectedDeliveryDate", label: "Planned delivery date", recommended: false },
  { key: "expectedShipDate", label: "Expected shipment date", recommended: false },
  { key: "orderDate", label: "Order date", recommended: false },
  { key: "retailerId", label: "Retailer", recommended: false },
  { key: "orderTag", label: "Order tag", recommended: false },
] as const;
export type MergeCriterion = (typeof MERGE_CRITERIA)[number]["key"];
export const RECOMMENDED_MERGE_CRITERIA: readonly MergeCriterion[] = MERGE_CRITERIA.filter((c) => c.recommended).map((c) => c.key);

export const MERGE_INHERITANCE = [
  { value: "oldest", title: "Oldest original order", description: "The master order inherits its fields from the first order created." },
  { value: "newest", title: "Newest original order", description: "The master order inherits its fields from the most recently created order." },
  { value: "clean", title: "Clean state", description: "The master keeps the earliest order but starts without its notes, gift note, packing instructions, reference code and packing warning." },
] as const;
export type MergeInheritance = (typeof MERGE_INHERITANCE)[number]["value"];

export const mergeCriteriaLabel = (keys: readonly string[]): string =>
  keys.map((k) => MERGE_CRITERIA.find((c) => c.key === k)?.label ?? k).join(" + ");

/** Shipment Order Type behaviours (Logiwa's 4 accordions, 17 toggles). Stored as `meta.flags`. */
export const SO_TYPE_FLAG_SECTIONS = [
  { title: "Order creation & allocation", flags: [
    { key: "allowMultiLocation", label: "Allow order in multiple locations or LPs", hint: "Allocate one line across several locations or license plates." },
    { key: "createBackOrder", label: "Create back order", hint: "Short lines move to a new back order instead of blocking the order." },
    { key: "allowPartialAllocation", label: "Allow partial allocation", hint: "Release the order to picking with what is available." },
    { key: "validateAllocationCancel", label: "Validate allocation cancellation", hint: "Ask for confirmation before allocations are released." },
    { key: "autoCodeOnImport", label: "Auto-generate order code on Excel import", hint: "Imported rows without a code get the next SO number." },
  ] },
  { title: "Picking", flags: [
    { key: "allowLpSwap", label: "Allow LP swap on picking", hint: "Pickers may pick from another LP with the same stock." },
    { key: "allowLotSwap", label: "Allow lot number swap on picking", hint: "" },
    { key: "allowExpirySwap", label: "Allow expiry date swap on picking", hint: "" },
    { key: "allowProductionDateSwap", label: "Allow production date swap on picking", hint: "" },
  ] },
  { title: "Packing", flags: [
    { key: "partialPacking", label: "Enable partial order packing", hint: "Close a package before every line is packed." },
    { key: "overrideSerialScan", label: "Override serial number scanning on packing", hint: "Packers don't have to scan serial numbers." },
    { key: "individualPackageProcessing", label: "Enable individual package processing", hint: "Each package is labelled and shipped on its own." },
    { key: "scanToCloseHigherPack", label: "Enable scan-to-close on higher pack types", hint: "Scanning a case closes it as one package." },
    { key: "autoPrintUcc", label: "Auto-print UCC labels", hint: "Print the GS1-128 carton label when a package closes." },
  ] },
  { title: "Shipping", flags: [
    { key: "allowShipWithoutLabel", label: "Allow shipment without label", hint: "Ship Order doesn't require a carrier label." },
    { key: "allowPartialShipment", label: "Allow partial shipment", hint: "Ship the packed packages and keep the rest open." },
    { key: "autoLoadingTask", label: "Auto-create loading task after unloading", hint: "" },
  ] },
] as const;
export type SoTypeFlag = (typeof SO_TYPE_FLAG_SECTIONS)[number]["flags"][number]["key"];
export const SO_TYPE_FLAGS: readonly SoTypeFlag[] = SO_TYPE_FLAG_SECTIONS.flatMap((s) => s.flags.map((f) => f.key));

/**
 * Behaviours a runtime consumer actually reads (allocation, picking, packing, shipping). Every
 * other switch renders read-only with a "Coming soon" badge, so an admin never flips a setting
 * that silently does nothing (REQ-R2-1). A consumer module adds its key here when it wires one.
 */
export const SO_TYPE_FLAGS_ENFORCED: ReadonlySet<SoTypeFlag> = new Set<SoTypeFlag>(["createBackOrder", "allowPartialAllocation", "allowShipWithoutLabel"]);
export const isSoTypeFlagEnforced = (key: string): boolean => SO_TYPE_FLAGS_ENFORCED.has(key as SoTypeFlag);

/** Merge conditions with no consumer yet (no column on the order): shown disabled, "Coming soon". */
export const isMergeCriterionComingSoon = (key: string): boolean => MERGE_CRITERIA.some((c) => c.key === key && "comingSoon" in c && c.comingSoon === true);

/**
 * Location Zone settings read by put-away (src/server/domain/putaway.ts): matched product groups
 * (Check Product Group / Location Zone Match), zone priority (the Zone Priority sort) and Max
 * locations per SKU (a location new to the SKU is refused once the zone holds it in that many).
 */
export const ZONE_PUTAWAY_SETTINGS_ENFORCED = true;
export const soTypeFlagLabel = (key: string): string =>
  SO_TYPE_FLAG_SECTIONS.flatMap((s) => [...s.flags]).find((f) => f.key === key)?.label ?? key;

export const PACKING_WARNING_TRIGGERS = [
  { value: "order_displayed", label: "Order is displayed on packing" },
  { value: "close_pack", label: "Close pack is triggered" },
  { value: "product_scanned", label: "Product is scanned" },
] as const;
export type PackingWarningTrigger = (typeof PACKING_WARNING_TRIGGERS)[number]["value"];
export const packingTriggerLabel = (v: unknown): string | null => PACKING_WARNING_TRIGGERS.find((t) => t.value === v)?.label ?? null;

const optNum = (max: number) => z.number().min(0, "Can't be negative").max(max).nullable().default(null);
const codeNamePair = z.object({ code: z.string().trim().min(1, "Code is required").max(40), name: z.string().trim().min(1, "Name is required").max(120) });
const shortList = z.array(z.string().trim().min(1).max(80)).max(50).default([]);
const isHttpUrl = (v: string) => /^https?:\/\/[^\s]+$/i.test(v);

/* ---------------- grid ---------------- */

export const lookupGridKey = (type: string): string => `lookup-${type.replace(/_/g, "-")}`;

export const LOOKUP_FIELDS: readonly AdminField[] = [
  { field: "name", label: "Name", type: "text" },
  { field: "status", label: "Status", type: "enum", options: ["Active", "Inactive"] },
  { field: "warehouseId", label: "Warehouse", type: "enum" },
  { field: "clientId", label: "Client", type: "enum" },
  { field: "usageCount", label: "Used by", type: "number" },
  { field: "createdAt", label: "Created date", type: "date" },
];

export const LOOKUP_SORT_FIELDS = ["name", "status", "sortOrder", "warehouseCode", "clientName", "usageCount", "createdAt", "updatedAt"] as const;
export const LOOKUP_SEARCH_FIELDS = ["name"] as const;

/* ---------------- drawer ---------------- */

/**
 * One flat schema for every lookup type. Type-specific fields all have defaults, so callers that
 * post the original shape (name / status / scope / sort order) keep validating.
 */
export const lookupFormSchema = z.object({
  name: requiredText("Name", 120),
  code: optionalText(60),
  description: z.string().trim().max(500, "At most 500 characters").default(""),
  isActive: z.boolean(),
  warehouseId: idField.nullable(),
  clientId: idField.nullable(),
  sortOrder: z.number({ error: "Enter a number" }).int("Whole number").min(0, "Can't be negative").max(100_000),
  // VAS type
  calculationType: z.enum(VAS_CALCULATION_TYPES).nullable(),
  // Mobile cart type
  levels: z.number().int("Whole number").min(1, "At least 1 level").max(20, "At most 20 levels").nullable(),
  columns: z.number().int("Whole number").min(1, "At least 1 column").max(30, "At most 30 columns").nullable(),
  operation: z.enum(CART_OPERATIONS).nullable(),
  allowMultipleJobs: z.boolean().default(false),
  dimensionUnit: z.enum(DIMENSION_UNITS).default("Inch"),
  volumeUnit: z.enum(VOLUME_UNITS).default("Cubic Inch"),
  cartHeight: optNum(10_000), cartLength: optNum(10_000), cartWidth: optNum(10_000),
  cellHeight: optNum(10_000), cellLength: optNum(10_000), cellWidth: optNum(10_000), cellVolume: optNum(1_000_000),
  // Order merge rule
  criteria: z.array(z.enum(MERGE_CRITERIA.map((c) => c.key) as [MergeCriterion, ...MergeCriterion[]])).max(MERGE_CRITERIA.length),
  inheritFrom: z.enum(MERGE_INHERITANCE.map((m) => m.value) as [MergeInheritance, ...MergeInheritance[]]).default("oldest"),
  // Damage reason
  countsAsDamaged: z.boolean(),
  // Shipment order type
  flags: z.array(z.enum(SO_TYPE_FLAGS as [SoTypeFlag, ...SoTypeFlag[]])).max(SO_TYPE_FLAGS.length).default([]),
  // Location zone
  priority: z.number().int("Whole number").min(0, "Can't be negative").max(9999).nullable().default(null),
  maxLocationsPerSku: z.number().int("Whole number").min(1, "At least 1").max(100_000).nullable().default(null),
  // Packing warning type
  warningText: z.string().trim().max(1000, "At most 1000 characters").default(""),
  showWhen: z.enum(PACKING_WARNING_TRIGGERS.map((t) => t.value) as [PackingWarningTrigger, ...PackingWarningTrigger[]]).nullable().default(null),
  skipConfirmation: z.boolean().default(false),
  mediaLinks: z.array(z.string().trim().max(500)).max(10).default([]),
  // Custom carrier
  logoUrl: z.string().trim().max(500).default(""),
  services: z.array(codeNamePair).max(100).default([]),
  packages: z.array(codeNamePair).max(100).default([]),
  confirmationTypes: shortList,
  insuranceTypes: shortList,
  billingTypes: shortList,
  // Return reason
  customerReason: z.boolean().default(true),
  actualReason: z.boolean().default(true),
  linkDamageReason: z.boolean().default(false),
  linkedDamageReasonId: idField.nullable().default(null),
  version: versionField,
});

export type LookupFormValues = z.input<typeof lookupFormSchema>;
export type LookupSave = z.output<typeof lookupFormSchema>;

export const LOOKUP_FORM_DEFAULTS: LookupFormValues = {
  name: "", code: "", description: "", isActive: true, warehouseId: null, clientId: null, sortOrder: 0,
  calculationType: null, levels: null, columns: null, operation: null, allowMultipleJobs: false, dimensionUnit: "Inch", volumeUnit: "Cubic Inch",
  cartHeight: null, cartLength: null, cartWidth: null, cellHeight: null, cellLength: null, cellWidth: null, cellVolume: null,
  criteria: [], inheritFrom: "oldest", countsAsDamaged: true, flags: [], priority: null, maxLocationsPerSku: null,
  warningText: "", showWhen: null, skipConfirmation: false, mediaLinks: [],
  logoUrl: "", services: [], packages: [], confirmationTypes: [], insuranceTypes: [], billingTypes: [],
  customerReason: true, actualReason: true, linkDamageReason: false, linkedDamageReasonId: null,
};

/** Defaults for a brand-new value of a type (Logiwa pre-fills these). */
export function lookupCreateDefaults(def: LookupDef): LookupFormValues {
  switch (def.type) {
    case "mobile_cart_type": return { ...LOOKUP_FORM_DEFAULTS, levels: 4, columns: 6, operation: "Picking" };
    case "vas_type": return { ...LOOKUP_FORM_DEFAULTS, calculationType: "Total Price" };
    case "order_merge_rule": return { ...LOOKUP_FORM_DEFAULTS, criteria: [...RECOMMENDED_MERGE_CRITERIA] };
    case "packing_warning_type": return { ...LOOKUP_FORM_DEFAULTS, showWhen: "order_displayed" };
    default: return LOOKUP_FORM_DEFAULTS;
  }
}

const dupes = (values: readonly string[]): string | null => {
  const seen = new Set<string>();
  for (const v of values) { const k = v.trim().toLowerCase(); if (seen.has(k)) return v; seen.add(k); }
  return null;
};

/** Type rules on top of the shape (run on the server and in the drawer). */
export function lookupIssues(def: LookupDef, v: LookupSave): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (def.scopeRequired && def.scope === "warehouse" && !v.warehouseId) issues.push({ path: "warehouseId", message: "Warehouse is required" });
  if (def.type === "vas_type" && !v.calculationType) issues.push({ path: "calculationType", message: "Choose a VAS calculation type" });
  if (def.type === "mobile_cart_type") {
    if (!v.levels) issues.push({ path: "levels", message: "Levels are required" });
    if (!v.columns) issues.push({ path: "columns", message: "Columns are required" });
    if (!v.operation) issues.push({ path: "operation", message: "Choose an operation" });
    for (const d of ["Height", "Length", "Width"] as const) {
      const cart = v[`cart${d}`];
      const cell = v[`cell${d}`];
      if (cart != null && cell != null && cell > cart) issues.push({ path: `cell${d}`, message: `Cell ${d.toLowerCase()} can't exceed the cart ${d.toLowerCase()}` });
    }
  }
  if (def.type === "order_merge_rule" && v.criteria.length === 0) issues.push({ path: "criteria", message: "Pick at least one condition" });
  if (def.type === "location_zone" && !v.code?.trim()) issues.push({ path: "code", message: "Zone code is required" });
  if (def.type === "packing_warning_type") {
    if (!v.warningText.trim()) issues.push({ path: "warningText", message: "Packing warning text is required" });
    if (!v.showWhen) issues.push({ path: "showWhen", message: "Choose when the warning shows" });
    const bad = v.mediaLinks.find((u) => !isHttpUrl(u));
    if (bad) issues.push({ path: "mediaLinks", message: `"${bad}" isn't an http(s) link` });
  }
  if (def.type === "custom_carrier") {
    if (!v.code?.trim()) issues.push({ path: "code", message: "Carrier code is required" });
    if (v.logoUrl && !isHttpUrl(v.logoUrl)) issues.push({ path: "logoUrl", message: "Enter an http(s) link" });
    const s = dupes(v.services.map((x) => x.code));
    if (s) issues.push({ path: "services", message: `Service code ${s} is listed twice` });
    const p = dupes(v.packages.map((x) => x.code));
    if (p) issues.push({ path: "packages", message: `Package code ${p} is listed twice` });
  }
  if (def.type === "return_reason") {
    if (!v.customerReason && !v.actualReason) issues.push({ path: "customerReason", message: "Use it as a customer reason, an actual reason, or both" });
    if (v.linkDamageReason && !v.linkedDamageReasonId) issues.push({ path: "linkedDamageReasonId", message: "Choose the damage reason to link" });
  }
  return issues;
}

/** The `meta` JSON each type stores (keys read by other modules are kept stable). */
export function lookupMeta(def: LookupDef, v: LookupSave): Record<string, unknown> | null {
  const base = v.description.trim() ? { description: v.description.trim() } : {};
  switch (def.type) {
    case "vas_type": return { ...base, calculationType: v.calculationType };
    case "mobile_cart_type": return {
      ...base, levels: v.levels, columns: v.columns, operation: v.operation, allowMultipleJobs: v.allowMultipleJobs,
      dimensionUnit: v.dimensionUnit, volumeUnit: v.volumeUnit,
      cart: { height: v.cartHeight, length: v.cartLength, width: v.cartWidth },
      cell: { height: v.cellHeight, length: v.cellLength, width: v.cellWidth, volume: v.cellVolume },
    };
    case "order_merge_rule": return { ...base, criteria: v.criteria, inheritFrom: v.inheritFrom };
    case "damage_reason": return { ...base, countsAsDamaged: v.countsAsDamaged };
    case "so_type": return { ...base, flags: Object.fromEntries(SO_TYPE_FLAGS.map((k) => [k, v.flags.includes(k)])) };
    case "location_zone": return { ...base, priority: v.priority, maxLocationsPerSku: v.maxLocationsPerSku };
    case "packing_warning_type": return { ...base, warningText: v.warningText.trim(), showWhen: v.showWhen, skipConfirmation: v.skipConfirmation, mediaLinks: v.mediaLinks };
    case "custom_carrier": return {
      ...base, logoUrl: v.logoUrl || null, services: v.services, packages: v.packages,
      confirmationTypes: v.confirmationTypes, insuranceTypes: v.insuranceTypes, billingTypes: v.billingTypes,
    };
    case "return_reason": return { ...base, customerReason: v.customerReason, actualReason: v.actualReason, linkedDamageReasonId: v.linkDamageReason ? v.linkedDamageReasonId : null };
    default: return Object.keys(base).length ? base : null;
  }
}

/** Inverse of `lookupMeta`: a stored row back to drawer values. */
export function lookupFormValues(r: { name: string; code: string | null; isActive: boolean; warehouseId: string | null; clientId: string | null; sortOrder: number; meta: Record<string, unknown> | null }): LookupFormValues {
  const m = r.meta ?? {};
  const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const str = (x: unknown): string => (typeof x === "string" ? x : "");
  const arr = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
  const cart = (m.cart ?? {}) as Record<string, unknown>;
  const cell = (m.cell ?? {}) as Record<string, unknown>;
  const flags = (m.flags ?? {}) as Record<string, unknown>;
  return {
    ...LOOKUP_FORM_DEFAULTS,
    name: r.name, code: r.code ?? "", description: str(m.description), isActive: r.isActive, warehouseId: r.warehouseId, clientId: r.clientId, sortOrder: r.sortOrder,
    calculationType: (m.calculationType as LookupFormValues["calculationType"]) ?? null,
    levels: num(m.levels), columns: num(m.columns), operation: (m.operation as LookupFormValues["operation"]) ?? null,
    allowMultipleJobs: m.allowMultipleJobs === true,
    dimensionUnit: (DIMENSION_UNITS as readonly string[]).includes(str(m.dimensionUnit)) ? (m.dimensionUnit as LookupFormValues["dimensionUnit"]) : "Inch",
    volumeUnit: (VOLUME_UNITS as readonly string[]).includes(str(m.volumeUnit)) ? (m.volumeUnit as LookupFormValues["volumeUnit"]) : "Cubic Inch",
    cartHeight: num(cart.height), cartLength: num(cart.length), cartWidth: num(cart.width),
    cellHeight: num(cell.height), cellLength: num(cell.length), cellWidth: num(cell.width), cellVolume: num(cell.volume),
    criteria: arr<MergeCriterion>(m.criteria).filter((k) => MERGE_CRITERIA.some((c) => c.key === k)),
    inheritFrom: MERGE_INHERITANCE.some((x) => x.value === m.inheritFrom) ? (m.inheritFrom as MergeInheritance) : "oldest",
    countsAsDamaged: m.countsAsDamaged !== false,
    flags: SO_TYPE_FLAGS.filter((k) => flags[k] === true),
    priority: num(m.priority), maxLocationsPerSku: num(m.maxLocationsPerSku),
    warningText: str(m.warningText), showWhen: (m.showWhen as LookupFormValues["showWhen"]) ?? null, skipConfirmation: m.skipConfirmation === true,
    mediaLinks: arr<string>(m.mediaLinks),
    logoUrl: str(m.logoUrl), services: arr(m.services), packages: arr(m.packages),
    confirmationTypes: arr(m.confirmationTypes), insuranceTypes: arr(m.insuranceTypes), billingTypes: arr(m.billingTypes),
    customerReason: m.customerReason !== false, actualReason: m.actualReason !== false,
    linkDamageReason: typeof m.linkedDamageReasonId === "string", linkedDamageReasonId: typeof m.linkedDamageReasonId === "string" ? m.linkedDamageReasonId : null,
  };
}

/** Readable, flat change-log snapshot of the type-specific fields. */
export function lookupMetaDisplay(def: LookupDef, meta: Record<string, unknown> | null, names: { damageReason?: string | null } = {}): Record<string, unknown> {
  const v = lookupFormValues({ name: "", code: null, isActive: true, warehouseId: null, clientId: null, sortOrder: 0, meta });
  const yn = (b: boolean | undefined) => (b ? "Yes" : "No");
  const out: Record<string, unknown> = { description: v.description };
  switch (def.type) {
    case "vas_type": return { ...out, calculationType: v.calculationType };
    case "mobile_cart_type": return {
      ...out, levels: v.levels, columns: v.columns, operation: v.operation, allowMultipleJobs: yn(v.allowMultipleJobs), dimensionUnit: v.dimensionUnit, volumeUnit: v.volumeUnit,
      cartDimensions: [v.cartHeight, v.cartLength, v.cartWidth].every((x) => x == null) ? "" : `${v.cartHeight ?? 0}x${v.cartLength ?? 0}x${v.cartWidth ?? 0}`,
      cellDimensions: [v.cellHeight, v.cellLength, v.cellWidth].every((x) => x == null) ? "" : `${v.cellHeight ?? 0}x${v.cellLength ?? 0}x${v.cellWidth ?? 0}`,
      cellVolume: v.cellVolume,
    };
    case "order_merge_rule": return { ...out, criteria: mergeCriteriaLabel(v.criteria ?? []), inheritFrom: MERGE_INHERITANCE.find((x) => x.value === v.inheritFrom)?.title };
    case "damage_reason": return { ...out, countsAsDamaged: yn(v.countsAsDamaged) };
    case "so_type": return { ...out, ...Object.fromEntries(SO_TYPE_FLAGS.map((k) => [soTypeFlagLabel(k), yn((v.flags ?? []).includes(k))])) };
    case "location_zone": return { ...out, priority: v.priority, maxLocationsPerSku: v.maxLocationsPerSku };
    case "packing_warning_type": return { ...out, warningText: v.warningText, showWhen: packingTriggerLabel(v.showWhen), skipConfirmation: yn(v.skipConfirmation), mediaLinks: (v.mediaLinks ?? []).join(", ") };
    case "custom_carrier": return {
      ...out, logoUrl: v.logoUrl, services: (v.services ?? []).map((x) => x.code).join(", "), packages: (v.packages ?? []).map((x) => x.code).join(", "),
      confirmationTypes: (v.confirmationTypes ?? []).join(", "), insuranceTypes: (v.insuranceTypes ?? []).join(", "), billingTypes: (v.billingTypes ?? []).join(", "),
    };
    case "return_reason": return { ...out, customerReason: yn(v.customerReason), actualReason: yn(v.actualReason), linkedDamageReason: names.damageReason ?? "" };
    default: return out;
  }
}

/* ---------------- auto code generation ---------------- */

export const SEQUENCE_DEFS = [
  { key: "so", label: "Shipment orders", example: "SO", entity: "shipment order" },
  { key: "po", label: "Purchase orders", example: "PO", entity: "purchase order" },
  { key: "workOrder", label: "Work orders", example: "WO", entity: "work order" },
  { key: "rma", label: "Return orders (RMA)", example: "RMA", entity: "return order" },
  { key: "shipmentPlan", label: "Shipment plans", example: "SP", entity: "shipment plan" },
  { key: "count", label: "Count plans", example: "CNT", entity: "count plan" },
] as const;
export type SequenceKey = (typeof SEQUENCE_DEFS)[number]["key"];

export const sequenceSchema = z.object({
  key: z.enum(SEQUENCE_DEFS.map((s) => s.key) as [SequenceKey, ...SequenceKey[]]),
  autoGenerate: z.boolean(),
  prefix: z.string().trim().max(12, "At most 12 characters").regex(/^[A-Za-z0-9-]*$/, "Letters, numbers or dash"),
  nextValue: z.number({ error: "Enter a start number" }).int("Whole number").min(1, "At least 1").max(999_999_999),
  padding: z.number({ error: "Enter a length" }).int("Whole number").min(0, "Can't be negative").max(12, "At most 12 digits"),
}).superRefine((v, ctx) => {
  if (v.autoGenerate && v.prefix.length === 0) ctx.addIssue({ code: "custom", path: ["prefix"], message: "Prefix is required to generate codes" });
});

export type SequenceValues = z.input<typeof sequenceSchema>;

/** `SO` + 10856 padded to 6 -> `SO010856` (matches `sequences.formatCode`). */
export function sequencePreview(prefix: string, next: number, padding: number): string {
  return `${prefix}${String(next).padStart(Math.max(0, padding), "0")}`;
}

/* ---------------- Location Zone › Match With Product Groups ---------------- */

/** `PUT` body: product groups per zone (replaces each listed zone's set). */
export const zoneGroupsSchema = z.object({
  assignments: z.array(z.object({ zoneId: idField, productGroupIds: z.array(idField).max(500) })).min(1).max(500),
});
export type ZoneGroupsSave = z.output<typeof zoneGroupsSchema>;

/** Product group ids stored on a zone's meta (deduplicated, strings only). PURE. */
export function zoneGroupIds(meta: Record<string, unknown> | null | undefined): string[] {
  const raw = meta?.productGroupIds;
  return Array.isArray(raw) ? [...new Set(raw.filter((x): x is string => typeof x === "string" && x.length > 0))] : [];
}

/** Whether two id sets differ (order-insensitive). PURE. */
export function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((id) => y.has(id));
}
