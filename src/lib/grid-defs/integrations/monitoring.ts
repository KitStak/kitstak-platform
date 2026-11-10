/** Channel Monitoring grids (M12, spec 06 §12–§16b). PURE. */
import { CHANNEL_MISSING_ORDER_STATUSES } from "@/lib/enums";
import { INTEGRATION_ERROR_CODES, integrationError, type IntegrationErrorInfo } from "@/lib/integration-errors";
import { brandText, type IntegrationField } from "./common";
import { niceTicks } from "./time";

/**
 * Error codes as M12 stores and serves them: the shared catalog still spells the brand
 * "KitStaks" (REQ-AI-R8-3), so M12 writes, filters and returns the "KitStak" spelling and maps
 * back only to look the code up in the catalog.
 */
export const BRANDED_ERROR_CODES: readonly string[] = INTEGRATION_ERROR_CODES.map((c) => brandText(c));

/** Catalog guidance for a stored code (either spelling), with every text field branded. */
export function catalogError(code: string | null | undefined): IntegrationErrorInfo {
  const info = integrationError(code ? code.replace(/\bKitStak\b/g, "KitStaks") : code);
  return { ...info, code: brandText(info.code), title: brandText(info.title), explanation: brandText(info.explanation), recommendedAction: brandText(info.recommendedAction) };
}

export const HEALTH_GRID_KEY = "monitoring-health";
export const MISSING_GRID_KEY = "integration-monitoring";
export const RECENT_ERRORS_GRID_KEY = "monitoring-recent-errors";
export const BLOCKED_GRID_KEY = "monitoring-workflow-blocked";
export const LISTING_EXCEPTIONS_GRID_KEY = "monitoring-listing-exceptions";

/** A setup is "low performing" below this 24h success rate. */
export const LOW_PERFORMING_PCT = 80;

export const HEALTH_FIELDS: readonly IntegrationField[] = [
  { field: "provider", label: "Channel", type: "enum" },
  { field: "clientId", label: "Client", type: "enum" },
  { field: "downloadStatus", label: "Download order status", type: "enum", options: ["Active", "Paused", "Passive"] },
  { field: "successRate", label: "Success rate", type: "number" },
  { field: "orders24h", label: "Num. of orders", type: "number" },
];
export const HEALTH_SORT_FIELDS = ["provider", "storeName", "clientName", "downloadStatus", "successRate", "orders24h", "lines24h", "lastSuccessAt"] as const;

export const MISSING_FIELDS: readonly IntegrationField[] = [
  { field: "provider", label: "Channel", type: "enum" },
  { field: "connectionId", label: "Channel setup name", type: "enum" },
  { field: "clientId", label: "Client", type: "enum" },
  { field: "lastUpdated", label: "Created date", type: "date" },
  { field: "lastErrorCode", label: "Last error code", type: "enum", options: BRANDED_ERROR_CODES },
  { field: "orderCode", label: "Order code", type: "text" },
  { field: "orderDate", label: "Order date", type: "date" },
  { field: "channelOrderNumber", label: "Store order number", type: "text" },
  { field: "status", label: "Status", type: "enum", options: CHANNEL_MISSING_ORDER_STATUSES },
];
export const MISSING_SORT_FIELDS = ["orderCode", "channelOrderNumber", "storeName", "provider", "clientName", "orderDate", "lastUpdated", "lastErrorCode", "status"] as const;

export const RECENT_ERROR_FIELDS: readonly IntegrationField[] = [
  { field: "provider", label: "Channel", type: "enum" },
  { field: "connectionId", label: "Channel setup name", type: "enum" },
  { field: "clientId", label: "Client", type: "enum" },
  { field: "errorReason", label: "Error reason", type: "enum", options: BRANDED_ERROR_CODES },
];
export const RECENT_ERROR_SORT_FIELDS = ["errorReason", "storeName", "provider", "clientName", "occurrences", "affectedOrders", "lastOccurrence"] as const;

export const BLOCKED_FIELDS: readonly IntegrationField[] = [
  { field: "actionName", label: "Action name", type: "enum", options: ["Block Order", "Partially Block Order"] },
  { field: "blockType", label: "Block type", type: "enum", options: ["Fully", "Partially"] },
  { field: "provider", label: "Channel", type: "enum" },
  { field: "clientId", label: "Client", type: "enum" },
  { field: "orderDate", label: "Order date", type: "date" },
  { field: "orderCode", label: "SO code", type: "text" },
  { field: "storeName", label: "Store name", type: "text" },
  { field: "warehouseId", label: "Warehouse", type: "enum" },
  { field: "workflowName", label: "Workflow name", type: "text" },
];
export const BLOCKED_SORT_FIELDS = ["orderCode", "blockType", "storeName", "provider", "clientName", "orderDate", "workflowName", "actionName", "warehouseCode"] as const;

export const LISTING_EXCEPTION_FIELDS: readonly IntegrationField[] = [
  { field: "provider", label: "Channel", type: "enum" },
  { field: "clientId", label: "Client", type: "enum" },
  { field: "listingDate", label: "Created date", type: "date" },
  { field: "issueType", label: "Exception issue type", type: "enum", options: ["Multi Listing", "SKU Difference"] },
  { field: "sellerSkus", label: "Seller SKU", type: "text" },
  { field: "sku", label: "SKU", type: "text" },
  { field: "storeName", label: "Store name", type: "text" },
];
export const LISTING_EXCEPTION_SORT_FIELDS = ["sku", "sellerSkus", "storeName", "provider", "clientName", "issueType", "listingDate"] as const;

/** Success rate in whole percent, or null when there were no calls (a "no data" state, never "failing"). */
export function successRateOf(ok: number, bad: number): number | null {
  return ok + bad === 0 ? null : Math.round((ok / (ok + bad)) * 100);
}

export interface HealthSummary { readonly setups: number; readonly avgSuccess: number | null; readonly lowPerforming: number; readonly noData: number }

/** Card roll-up: setups without calls are counted as noData and excluded from the average and low-performing count. */
export function summarizeHealth(rates: readonly (number | null)[]): HealthSummary {
  const measured = rates.filter((r): r is number => r !== null);
  return {
    setups: rates.length,
    avgSuccess: measured.length === 0 ? null : Math.round(measured.reduce((a, b) => a + b, 0) / measured.length),
    lowPerforming: measured.filter((r) => r < LOW_PERFORMING_PCT).length,
    noData: rates.length - measured.length,
  };
}

export interface VolumeShape {
  readonly channelTotal: number;
  readonly kitstaksTotal: number;
  /** Days with any channel or KitStak orders. */
  readonly activeDays: number;
  /** ≤3 active days — an area chart would read as a flat line, so render bars. */
  readonly sparse: boolean;
  /** Y-axis ceiling: the next nice tick above the peak, never below 4 so a 1-order day is not a full-height spike. */
  readonly yMax: number;
  /** Evenly spaced nice ticks from 0 to yMax (0, 10, 20, 30, 40). */
  readonly yTicks: readonly number[];
}

/** Summarises a 14-day volume series for the Setup Details chart. PURE. */
export function volumeShape(volume: readonly { readonly channel: number; readonly kitstaks: number }[]): VolumeShape {
  let channelTotal = 0, kitstaksTotal = 0, activeDays = 0, peak = 0;
  for (const v of volume) {
    channelTotal += v.channel; kitstaksTotal += v.kitstaks;
    if (v.channel + v.kitstaks > 0) activeDays += 1;
    peak = Math.max(peak, v.channel, v.kitstaks);
  }
  const axis = niceTicks(peak);
  return { channelTotal, kitstaksTotal, activeDays, sparse: activeDays > 0 && activeDays <= 3, yMax: axis.max, yTicks: axis.ticks };
}

/**
 * Download status shown on Health Overview and the connection list: an "Active" method the scheduler
 * cannot run (no credentials, no live adapter, inactive store) reads as amber "Paused" with the reason.
 */
export function healthStatus(methodStatus: "Active" | "Passive", reason: string | null): { downloadStatus: "Active" | "Passive" | "Paused"; pauseReason: string | null } {
  if (methodStatus === "Active" && reason) return { downloadStatus: "Paused", pauseReason: reason };
  return { downloadStatus: methodStatus, pauseReason: null };
}

/* ---------------- paused-method labels ---------------- */

export interface PauseLabel {
  readonly label: string;
  readonly tone: "neutral" | "warning";
}

/**
 * Short pill for a method that is switched on but cannot run. A seeded demo store without
 * credentials reads "Demo store" (neutral), not a warning, so an out-of-the-box workspace does not
 * look broken; real problems (expired credentials elsewhere, missing adapter) stay amber.
 */
export function pauseLabel(reason: string | null | undefined): PauseLabel | null {
  if (!reason) return null;
  if (/demo store/i.test(reason)) return { label: "Demo store", tone: "neutral" };
  if (/inactive/i.test(reason)) return { label: "Inactive", tone: "neutral" };
  if (/credential/i.test(reason)) return { label: "Needs reconnect", tone: "warning" };
  if (/adapter/i.test(reason)) return { label: "No live API", tone: "neutral" };
  return { label: "Paused", tone: "warning" };
}
