/**
 * Putaway worklist grid (M05): received stock still in a receiving location. Pure TS shared
 * by the filter builder, `GET /api/putaway` (grid grammar) and the export provider.
 */
import type { ReceivingGridField } from "./purchase-orders";

export const PUTAWAY_GRID_KEY = "putaway-worklist";

export const PUTAWAY_GRID_FIELDS: readonly ReceivingGridField[] = [
  { field: "warehouseId", label: "Warehouse", type: "enum", dynamicOptions: "warehouses" },
  { field: "clientId", label: "Client", type: "enum", dynamicOptions: "clients" },
  { field: "sku", label: "SKU", type: "text" },
  { field: "productName", label: "Product name", type: "text" },
  { field: "barcode", label: "Barcode", type: "text" },
  { field: "fromLocationCode", label: "Location", type: "text" },
  { field: "qty", label: "Quantity", type: "number" },
  { field: "packType", label: "Pack type", type: "text" },
  { field: "lotNumber", label: "Lot batch number", type: "text" },
  { field: "expiryDate", label: "Expiry date", type: "date" },
  { field: "lpNumber", label: "LP number", type: "text" },
  { field: "poNumber", label: "PO number", type: "text" },
  { field: "receivedAt", label: "Receiving date", type: "date" },
  { field: "dwellHours", label: "Waiting (hours)", type: "number" },
  { field: "locked", label: "Is location locked?", type: "boolean" },
];

export const PUTAWAY_SORT_FIELDS = [
  "warehouseName", "clientName", "sku", "productName", "barcode", "fromLocationCode", "qty", "packType", "lotNumber", "expiryDate",
  "lpNumber", "poNumber", "receivedAt", "dwellHours",
] as const;

/** Quick search: SKU, barcode, location or PO (Starts With / Equal). */
export const PUTAWAY_SEARCH_FIELDS = ["sku", "barcode", "fromLocationCode", "poNumber", "productName"] as const;

export interface PutawayTaskRow {
  readonly id: string;
  readonly version: number;
  readonly warehouseId: string;
  readonly warehouseName: string;
  /** The warehouse's IANA time zone: Received renders in it, labelled (module date-time rule). */
  readonly warehouseTimeZone: string;
  readonly productId: string;
  readonly sku: string;
  readonly productName: string;
  readonly barcode: string;
  readonly clientId: string | null;
  readonly clientName: string;
  readonly fromLocationId: string;
  readonly fromLocationCode: string;
  readonly qty: number;
  readonly available: number;
  readonly packType: string;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly lpId: string | null;
  readonly lpNumber: string | null;
  readonly poNumber: string | null;
  /** The PO the stock was received on (same warehouse), so the PO cell opens its detail. */
  readonly purchaseOrderId: string | null;
  readonly receivedAt: string;
  /** Hours since the bucket was received (dwell in the receiving area). */
  readonly dwellHours: number;
  /** Why the stock can't be moved right now (location locked / count-locked), or null. */
  readonly blockedReason: string | null;
}

/** "3 h", "2 d", "< 1 h". */
export function formatDwell(hours: number): string {
  if (hours < 1) return "< 1 h";
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

/**
 * Quantity field of the Put away dialog: keeps an empty field empty (never coerces it to 0)
 * and says why Confirm is unavailable.
 */
export function putawayQtyIssue(raw: string, max: number, packType: string): string | null {
  const text = raw.trim();
  if (text === "") return "Enter a quantity";
  const n = Number(text);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return "Use a whole number";
  if (n < 1) return "Enter a quantity of at least 1";
  if (n > max) return `At most ${max.toLocaleString("en-US")} ${packType} can be moved`;
  return null;
}
