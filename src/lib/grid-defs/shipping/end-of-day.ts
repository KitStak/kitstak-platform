/**
 * End Of The Day grid (`/shipments/end-of-day`, gridKey `end-of-day`): one row per carrier
 * account, ship date and warehouse. Rows are stored manifests plus "pending" manifests derived
 * live from labels not yet attached to one.
 */
import { EOD_STATUSES } from "@/lib/enums";
import { optionsOf, type ShippingField } from "./common";

export const EOD_GRID_KEY = "end-of-day";

export const EOD_FIELDS: readonly ShippingField[] = [
  { field: "carrierCode", label: "Carrier", type: "text", facet: "carriers" },
  { field: "carrierPrefix", label: "Carrier prefix", type: "text", facet: "carrierAccounts" },
  { field: "warehouseCode", label: "Warehouse", type: "text", facet: "warehouses" },
  { field: "shipDate", label: "Ship date", type: "date" },
  { field: "closeDate", label: "Close date", type: "date" },
  { field: "isPrinted", label: "Printed?", type: "boolean" },
  { field: "totalPackages", label: "Total package", type: "number" },
  { field: "status", label: "Status", type: "enum", options: optionsOf(EOD_STATUSES) },
];

export const EOD_SORT_FIELDS = ["carrierPrefix", "carrierCode", "warehouseCode", "shipDate", "closeDate", "isPrinted", "totalPackages", "voidedPackages", "status"] as const;
export const EOD_SEARCH_FIELDS = ["carrierPrefix", "carrierCode", "warehouseCode"] as const;

/** Pending (not yet stored) manifest ids: `pending~<warehouseId>~<connectionId>~<YYYY-MM-DD>`. */
export const PENDING_EOD_PREFIX = "pending~";

export function pendingEodId(warehouseId: string, connectionId: string, shipDate: string): string {
  return `${PENDING_EOD_PREFIX}${warehouseId}~${connectionId}~${shipDate}`;
}

export function parsePendingEodId(id: string): { warehouseId: string; connectionId: string; shipDate: string } | null {
  if (!id.startsWith(PENDING_EOD_PREFIX)) return null;
  const [warehouseId, connectionId, shipDate] = id.slice(PENDING_EOD_PREFIX.length).split("~");
  if (!warehouseId || !connectionId || !shipDate || !/^\d{4}-\d{2}-\d{2}$/.test(shipDate)) return null;
  return { warehouseId, connectionId, shipDate };
}

export interface EodGuardRow {
  readonly status: string;
  readonly totalPackages: number;
  readonly isPrinted: boolean;
}

/** Why "Print End of the Day Report" is blocked for the selection, or null. */
export function closeBlockReason(rows: readonly EodGuardRow[]): string | null {
  if (rows.some((r) => r.status === "Closed")) return "Only Open manifests can be closed — use Reprint for closed ones";
  if (rows.some((r) => r.totalPackages === 0)) return "A manifest with no active packages can't be closed";
  return null;
}

/** Why "Reprint" is blocked for the selection, or null. */
export function reprintBlockReason(rows: readonly EodGuardRow[]): string | null {
  if (rows.some((r) => r.status !== "Closed")) return "Only closed manifests have a report to reprint";
  return null;
}
