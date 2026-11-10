/**
 * Shipment Plan grids: plans (`shipment-plans`), plan orders (`shipment-plan-orders`) and
 * plan LPs (`shipment-plan-lps`), plus the pure plan rules shared by the drawer and the API.
 */
import { SHIPMENT_PLAN_STATUSES, SO_STATUSES } from "@/lib/enums";
import { optionsOf, type ShippingField } from "./common";

export const SHIPMENT_PLANS_GRID_KEY = "shipment-plans";
export const SHIPMENT_PLAN_ORDERS_GRID_KEY = "shipment-plan-orders";
export const SHIPMENT_PLAN_LPS_GRID_KEY = "shipment-plan-lps";

/** Orders that can be added to a plan (not yet shipped, cancelled or on hold). */
export const PLAN_ELIGIBLE_ORDER_STATUSES = [
  "Open", "Ready to Pick", "Picking Started", "Ready to Pack", "Packing Started", "Ready to Sort", "Sorting Started",
  "Ready to Load", "Loading Started", "Ready to Ship",
] as const;

/** Plan statuses that still own their orders (an order can sit in only one active plan). */
export const ACTIVE_PLAN_STATUSES = ["Open", "In Progress", "Loading Started", "Loading Completed"] as const;

/** Statuses a plan may be created in. */
export const PLAN_CREATE_STATUSES = ["Open"] as const;

/** Order statuses counted as "loaded" for the plan's loading progress. */
export const LOADED_ORDER_STATUSES = ["Ready to Ship", "Shipped", "Partially Shipped", "Delivered"] as const;

export const SHIPMENT_PLAN_FIELDS: readonly ShippingField[] = [
  { field: "code", label: "Code", type: "text" },
  { field: "status", label: "Plan status", type: "enum", options: optionsOf(SHIPMENT_PLAN_STATUSES) },
  { field: "warehouseCode", label: "Warehouse", type: "text", facet: "warehouses" },
  { field: "clientName", label: "Client", type: "text", facet: "clients" },
  { field: "carrierName", label: "Carrier", type: "text", facet: "carrierAccounts" },
  { field: "truckPlateNumber", label: "Truck plate number", type: "text" },
  { field: "loadingGate", label: "Loading gate", type: "text" },
  { field: "customerName", label: "Customer", type: "text" },
  { field: "retailerName", label: "Retailer", type: "text" },
  { field: "orderCount", label: "Orders", type: "number" },
  { field: "createdAt", label: "Created date", type: "date" },
  { field: "plannedShipmentAt", label: "Planned shipment date", type: "date" },
  { field: "actualShipmentAt", label: "Actual shipment date", type: "date" },
  { field: "truckDepartedAt", label: "Truck departed date", type: "date" },
];

export const SHIPMENT_PLAN_SORT_FIELDS = [
  "code", "status", "warehouseCode", "clientName", "customerName", "customerAddress", "createdAt", "plannedShipmentAt",
  "actualShipmentAt", "carrierName", "truckPlateNumber", "loadingGate", "retailerName", "loadingStartedAt",
  "loadingCompletedAt", "truckDepartedAt", "orderCount", "loadedPercent", "expectedTotalWeight",
] as const;
export const SHIPMENT_PLAN_SEARCH_FIELDS = ["code", "truckPlateNumber"] as const;

export const PLAN_ORDER_FIELDS: readonly ShippingField[] = [
  { field: "planCode", label: "Shipment plan", type: "text" },
  { field: "orderCode", label: "Order code", type: "text" },
  { field: "orderStatus", label: "Order status", type: "enum", options: optionsOf(SO_STATUSES) },
  { field: "planStatus", label: "Status", type: "enum", options: optionsOf(SHIPMENT_PLAN_STATUSES) },
  { field: "carrierName", label: "Carrier", type: "text", facet: "carrierAccounts" },
  { field: "clientName", label: "Client", type: "text", facet: "clients" },
  { field: "loadingGate", label: "Loading gate", type: "text" },
  { field: "plannedShipmentAt", label: "Planned shipment date", type: "date" },
  { field: "shippingService", label: "Shipping service", type: "text", facet: "services" },
  { field: "truckDepartedAt", label: "Truck departed date", type: "date" },
  { field: "truckPlateNumber", label: "Truck plate number", type: "text" },
  { field: "warehouseCode", label: "Warehouse", type: "text", facet: "warehouses" },
];

export const PLAN_ORDER_SORT_FIELDS = [
  "planCode", "orderCode", "orderStatus", "planStatus", "warehouseCode", "customerName", "customerAddress", "carrierName",
  "lpShippingOption", "clientName", "truckPlateNumber", "orderCarrier", "loadingGate", "plannedShipmentAt", "truckDepartedAt",
] as const;
export const PLAN_ORDER_SEARCH_FIELDS = ["planCode", "orderCode"] as const;

export const PLAN_LP_FIELDS: readonly ShippingField[] = [
  { field: "planCode", label: "Shipment plan", type: "text" },
  { field: "lpNumber", label: "LP number", type: "text" },
  { field: "carrierName", label: "Carrier", type: "text", facet: "carrierAccounts" },
  { field: "clientName", label: "Client", type: "text", facet: "clients" },
  { field: "loadingGate", label: "Loading gate", type: "text" },
  { field: "plannedShipmentAt", label: "Planned shipment date", type: "date" },
  { field: "shippingService", label: "Shipping service", type: "text", facet: "services" },
  { field: "truckDepartedAt", label: "Truck departed date", type: "date" },
  { field: "truckPlateNumber", label: "Truck plate number", type: "text" },
  { field: "volume", label: "Volume", type: "number", decimals: 2 },
  { field: "warehouseCode", label: "Warehouse", type: "text", facet: "warehouses" },
  { field: "weight", label: "Weight", type: "number", decimals: 2 },
];

export const PLAN_LP_SORT_FIELDS = [
  "planCode", "orderCode", "orderStatus", "lpNumber", "parentLpNumber", "planStatus", "warehouseCode", "customerName",
  "customerAddress", "carrierName", "shippingService", "clientName", "truckPlateNumber", "lpCarrier", "originalLpNumber",
  "loadingGate", "plannedShipmentAt", "truckDepartedAt", "weight", "volume",
] as const;
export const PLAN_LP_SEARCH_FIELDS = ["planCode", "lpNumber", "orderCode"] as const;

/** Why an order can't join a plan, or null. */
export function orderEligibilityReason(order: { readonly status: string; readonly warehouseId: string; readonly clientId: string }, plan: { readonly warehouseId: string; readonly clientId: string | null }): string | null {
  if (order.warehouseId !== plan.warehouseId) return "is in another warehouse";
  if (plan.clientId && order.clientId !== plan.clientId) return "belongs to another client";
  if (!(PLAN_ELIGIBLE_ORDER_STATUSES as readonly string[]).includes(order.status)) return `is ${order.status}`;
  return null;
}

export function planDeleteBlockReason(status: string): string | null {
  return status === "Open" ? null : "Only Open shipment plans can be deleted";
}

export type LifecycleTimeKey = "loadingStartedAt" | "loadingCompletedAt" | "truckDepartedAt" | "actualShipmentAt";
type LifecycleTimes = Readonly<Record<LifecycleTimeKey, string | null>>;

const STAGE_RANK: Readonly<Record<string, number>> = { Open: 0, "In Progress": 1, "Loading Started": 2, "Loading Completed": 3, Shipped: 4, Cancelled: -1 };

/**
 * Which lifecycle times a user may correct on the Edit drawer (Logiwa lets them be entered on the
 * General step). A time opens for correction once the plan reached its stage: Loading started at
 * Loading Started, Loading completed and Truck departed at Loading Completed. Actual shipment is
 * always set by Ship.
 */
export function editableLifecycleTimes(status: string): ReadonlySet<LifecycleTimeKey> {
  const rank = STAGE_RANK[status] ?? -1;
  const out = new Set<LifecycleTimeKey>();
  if (rank >= 2) out.add("loadingStartedAt");
  if (rank >= 3) { out.add("loadingCompletedAt"); out.add("truckDepartedAt"); }
  return out;
}

const TIME_LABEL: Readonly<Record<LifecycleTimeKey, string>> = {
  loadingStartedAt: "Loading started", loadingCompletedAt: "Loading completed", truckDepartedAt: "Truck departed", actualShipmentAt: "Actual shipment",
};

/**
 * Merges requested lifecycle-time corrections onto the stored ones. Times the status doesn't
 * allow keep their stored value; an allowed time can be changed but not cleared once stamped,
 * can't be in the future (5 min clock skew allowed) and must keep the stages in order.
 */
export function mergeLifecycleTimes(status: string, stored: LifecycleTimes, requested: Partial<LifecycleTimes>, now: Date = new Date()):
  { readonly values: LifecycleTimes; readonly error: { readonly field: LifecycleTimeKey; readonly message: string } | null } {
  const editable = editableLifecycleTimes(status);
  const values: Record<LifecycleTimeKey, string | null> = { ...stored };
  for (const key of editable) {
    const next = requested[key];
    if (next === undefined || next === stored[key]) continue;
    if (!next) {
      if (stored[key]) return { values: stored, error: { field: key, message: `${TIME_LABEL[key]} was recorded by the lifecycle and can't be cleared` } };
      continue;
    }
    const t = new Date(next);
    if (Number.isNaN(t.getTime())) return { values: stored, error: { field: key, message: "Enter a valid date and time" } };
    if (t.getTime() > now.getTime() + 5 * 60_000) return { values: stored, error: { field: key, message: `${TIME_LABEL[key]} can't be in the future` } };
    values[key] = t.toISOString();
  }
  const order: readonly [LifecycleTimeKey, LifecycleTimeKey, string][] = [
    ["loadingStartedAt", "loadingCompletedAt", "Loading can't complete before it started"],
    ["loadingCompletedAt", "truckDepartedAt", "The truck can't depart before loading completed"],
  ];
  for (const [a, b, message] of order) {
    const from = values[a];
    const to = values[b];
    if (from && to && new Date(to) < new Date(from)) return { values: stored, error: { field: editable.has(b) && requested[b] !== undefined && requested[b] !== stored[b] ? b : a, message } };
  }
  return { values, error: null };
}

export function planEditBlockReason(status: string): string | null {
  return status === "Shipped" || status === "Cancelled" ? `${status} plans can't be edited` : null;
}

/**
 * Why Ship is unavailable. `unlabeledReady` counts Ready to Ship orders with no active shipping label
 * (every shipped order needs one: the label is the tracking record and the EOD manifest line).
 */
export function planShipBlockReason(status: string, orderCount: number, loadedCount?: number, shippedCount = 0, unlabeledReady = 0, unlabeledCodes?: string | null): string | null {
  if (status === "Shipped") return "This plan is already shipped";
  if (status === "Cancelled") return "Cancelled plans can't be shipped";
  if (orderCount === 0) return "Add at least one order before shipping";
  if (loadedCount !== undefined && loadedCount - shippedCount <= 0 && shippedCount < orderCount) {
    return "None of the plan's orders are Ready to Ship yet. Pick and pack them first";
  }
  if (loadedCount !== undefined && unlabeledReady > 0 && loadedCount - shippedCount - unlabeledReady <= 0) {
    return `${unlabeledLabel(unlabeledReady, unlabeledCodes)}. Create a shipping label first`;
  }
  return null;
}

/** "SO010845 has no active shipping label" / "3 Ready to Ship orders have no active shipping label (SO1, SO2, …)". */
export function unlabeledLabel(count: number, codes?: string | null): string {
  const list = [...new Set((codes ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (count === 1 && list.length === 1) return `${list[0]} has no active shipping label`;
  const shown = list.slice(0, 3).join(", ");
  return `${count} Ready to Ship ${count === 1 ? "order has" : "orders have"} no active shipping label${shown ? ` (${shown}${list.length > 3 ? ", …" : ""})` : ""}`;
}

/** Per-order ship refusal for an order without an active label (voided labels named so the fix is obvious). */
export function noActiveLabelMessage(orderCode: string, voidedLabels: number): string {
  return voidedLabels > 0
    ? `${orderCode} has no active shipping label: ${voidedLabels === 1 ? "its label was" : `all ${voidedLabels} labels were`} voided. Create a new label first.`
    : `${orderCode} has no active shipping label. Create a label first.`;
}

/** Graded readiness of an order for loading (order picker READINESS column). */
export type OrderReadiness = { readonly label: string; readonly tone: "success" | "info" | "warning" | "neutral" };
export function orderReadiness(status: string): OrderReadiness {
  switch (status) {
    case "Ready to Ship": return { label: "Ready to ship", tone: "success" };
    case "Ready to Load": case "Loading Started": return { label: "Loading", tone: "info" };
    case "Packing Started": case "Ready to Sort": case "Sorting Started": return { label: "Packing", tone: "info" };
    case "Ready to Pack": return { label: "Picked", tone: "info" };
    case "Picking Started": return { label: "Picking", tone: "warning" };
    case "Shipped": case "Partially Shipped": case "Delivered": return { label: "Shipped", tone: "success" };
    default: return { label: "Not picked", tone: "warning" };
  }
}

export interface DerivedFromOrders {
  /** Plan value when set, otherwise the single value shared by its orders, otherwise a mixed marker. */
  readonly value: string | null;
  /** "from orders" / "mixed (n)" hint; null when the plan's own value is shown. */
  readonly hint: string | null;
}

/** Inherits a header field (carrier, consignee) from the plan's orders when the plan leaves it blank. Same rule on grid, detail and export. */
export function deriveFromOrders(planValue: string | null | undefined, orderValues: readonly (string | null | undefined)[]): DerivedFromOrders {
  if (planValue) return { value: planValue, hint: null };
  const distinct = [...new Set(orderValues.map((v) => (v ?? "").trim()).filter(Boolean))];
  if (distinct.length === 0) return { value: null, hint: null };
  const blanks = orderValues.filter((v) => !(v ?? "").trim()).length;
  if (distinct.length === 1 && blanks === 0) return { value: distinct[0], hint: "from orders" };
  if (distinct.length === 1) return { value: distinct[0], hint: `partial: ${orderValues.length - blanks} of ${orderValues.length} orders` };
  return { value: `Mixed (${distinct.length})`, hint: distinct.join(", ") };
}

/** Lifecycle stages a plan actually passed through, from its "Status is modified. A --> B" change-log rows. */
export function reachedPlanStages(status: string, messages: readonly string[]): ReadonlySet<string> {
  const reached = new Set<string>(["Open", status]);
  for (const m of messages) {
    const t = m.trim();
    // Legacy wire format ("Status is modified. A --> B") and the stored sentence ("Status changed from A to B").
    const hit = /^Status is modified\.\s*(.*?)\s*-->\s*(.*)$/.exec(t) ?? /^Status changed from (.*?) to (.*?)\.?$/.exec(t);
    if (hit) { if (hit[1] && hit[1] !== "—") reached.add(hit[1].trim()); if (hit[2] && hit[2] !== "—") reached.add(hit[2].trim()); }
  }
  return reached;
}

/* ------------------------------------------------------- change-log copy */

/** "11/10/2026 6:36 AM EST": a date-time in the warehouse's zone with its label (falls back to UTC). */
export function formatZoneDateTime(value: string | Date, timeZone: string | null | undefined): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const make = (tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" });
  let fmt: Intl.DateTimeFormat;
  try { fmt = make(timeZone || "UTC"); } catch { fmt = make("UTC"); }
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value])) as Record<string, string>;
  return `${p.month}/${p.day}/${p.year} ${p.hour}:${p.minute} ${p.dayPeriod ?? ""} ${p.timeZoneName ?? ""}`.replace(/\s+/g, " ").trim();
}

const ISO_VALUE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

/** A change-log value as people read it: ISO date-times in the warehouse zone, everything else as is. */
export function planChangeValue(value: string, timeZone: string | null | undefined): string {
  const v = value.trim();
  return ISO_VALUE.test(v) && !Number.isNaN(Date.parse(v)) ? formatZoneDateTime(v, timeZone) : v;
}

const PLAN_FIELD_NAMES: Readonly<Record<string, string>> = {
  loadingStartedAt: "Loading started", loadingCompletedAt: "Loading completed", truckDepartedAt: "Truck departed",
  actualShipmentAt: "Actual shipment", plannedShipmentAt: "Planned shipment", loadingGate: "Loading gate",
  truckPlateNumber: "Truck plate number", expectedTotalVolume: "Expected volume (ft³)", expectedTotalWeight: "Expected weight (lb)",
  preventLpnEditDuringLoading: "Prevent LP edits during loading", customerAddress: "Customer address", customFields: "Custom fields",
};

/** Sentence-case field name for a change-log sentence ("Truck Plate Number" → "Truck plate number"; acronyms kept). */
function sentenceName(field: string, label: string): string {
  const known = PLAN_FIELD_NAMES[field];
  if (known) return known;
  const words = label.trim().split(/\s+/);
  return words.map((w, i) => (i === 0 || /^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase())).join(" ");
}

const codeList = (s: string): string[] => s.split(",").map((x) => x.trim()).filter(Boolean);

/**
 * The stored change-log sentence for a shipment plan field change (every consumer, the global Change Log
 * report and exports included, reads it as is): "Added orders SO1, SO2", "Status changed from Open to
 * Shipped", "Loading started set to 11/10/2026 6:36 AM EST", "Note cleared (was Dock 4)".
 * `from` / `to` are display values (already zone-formatted).
 */
export function planChangeMessage(field: string, label: string, from: string, to: string): string {
  if (field === "orders") {
    const b = new Set(codeList(from));
    const a = new Set(codeList(to));
    const added = [...a].filter((c) => !b.has(c));
    const removed = [...b].filter((c) => !a.has(c));
    const part = (verb: string, list: string[]) => `${verb} ${list.length === 1 ? "order" : "orders"} ${list.join(", ")}`;
    const parts = [added.length ? part("Added", added) : "", removed.length ? part(added.length ? "removed" : "Removed", removed) : ""].filter(Boolean);
    return parts.length ? `${parts.join("; ")}.` : "Orders unchanged.";
  }
  const name = sentenceName(field, label);
  if (field === "status") return `Status changed from ${from || "—"} to ${to || "—"}.`;
  if (!from && to) return `${name} set to ${to}.`;
  if (from && !to) return `${name} cleared (was ${from}).`;
  return `${name} changed from ${from} to ${to}.`;
}

/**
 * What a ship did to the plan's status, for the ship result window and the toast. A partial ship leaves the
 * plan status unchanged and says so; a full ship closes it as Shipped.
 */
export function planStatusNote(from: string, to: string, shipped: number, total: number): string | null {
  if (from === to) {
    // Partial ship: the plan keeps its status (no invented loading stage); say so explicitly.
    if (shipped > 0 && shipped < total && to !== "Shipped") {
      return `Plan status stays ${from}: ${shipped} of ${total} orders shipped. It becomes Shipped when the rest ship.`;
    }
    return null;
  }
  if (to === "Shipped") return `Plan moved from ${from} to Shipped: ${total === 1 ? "the order is" : `all ${total} orders are`} shipped.`;
  return `Plan moved from ${from} to ${to}.`;
}

/** True while a plan's expected load is automatic: never set (0/0) or still equal to its previous orders' totals. */
export function isAutoExpectedLoad(weight: number, volume: number, previous: { readonly weightLb: number; readonly volumeFt3: number }): boolean {
  const same = (a: number, b: number) => Math.abs(a - b) < 0.005;
  return (weight === 0 && volume === 0) || (same(weight, previous.weightLb) && same(volume, previous.volumeFt3));
}

/** Weight lb from oz; volume ft³ from in³ (both rounded to 2 dp). */
export const ozToLb = (oz: number): number => Math.round((oz / 16) * 100) / 100;
export const in3ToFt3 = (in3: number): number => Math.round((in3 / 1728) * 100) / 100;

/** Filter fields of the plan order picker (`/api/shipment-plans/eligible-orders`). */
export const PLAN_ELIGIBLE_ORDER_FIELDS: readonly ShippingField[] = [
  { field: "status", label: "Status", type: "enum", options: PLAN_ELIGIBLE_ORDER_STATUSES.map((s) => ({ value: s, label: s })) },
  { field: "orderType", label: "Order type", type: "text" },
  { field: "storeName", label: "Store", type: "text" },
  { field: "clientName", label: "Client", type: "text" },
  { field: "customerName", label: "Customer", type: "text" },
  { field: "sku", label: "SKU", type: "text" },
  { field: "createdAt", label: "Created date", type: "date" },
  { field: "ageDays", label: "Age (days)", type: "number" },
  { field: "tags", label: "Tags", type: "text" },
  { field: "totalQuantity", label: "Total quantity", type: "number" },
];

/** Loading stages need every order Ready to Ship (or already shipped); otherwise the popover shows why. */
export function planLoadingBlockReason(orderCount: number, loadedCount: number): string | null {
  if (orderCount === 0) return "Add orders to the plan before loading";
  const waiting = orderCount - loadedCount;
  return waiting > 0 ? `${waiting} of ${orderCount} orders aren't Ready to Ship yet` : null;
}

export function planStatusBlocks(orderCount: number, loadedCount: number): Partial<Record<"Loading Started" | "Loading Completed", string>> {
  const reason = planLoadingBlockReason(orderCount, loadedCount);
  return reason ? { "Loading Started": reason, "Loading Completed": reason } : {};
}

/** Carrier shown for a plan without its own carrier: the distinct carriers of its orders. */
export function planCarrierFromOrders(list: string | null): string | null {
  const names = [...new Set((list ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (names.length === 0) return null;
  return names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}
