/**
 * /dev/ui showcase grid contract, shared by the client grid and the server export
 * provider so both evaluate the same query over the same rows. PURE (no db imports).
 */
import type { FieldValue } from "@/lib/local-grid-query";

export interface DevOrderRow {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly clientName: string;
  readonly channel: string;
  readonly storeOrderNumber: string | null;
  readonly customerName: string;
  readonly shipState: string;
  readonly priority: string;
  readonly totalQuantity: number;
  readonly salesPrice: number;
  readonly orderDate: string;
  readonly trackingNumber: string | null;
}

/** One order line shown in the grid's expanded row. */
export interface DevOrderLine {
  readonly id: string;
  readonly sku: string;
  readonly description: string;
  readonly quantity: number;
  readonly allocatedQuantity: number;
  readonly pickedQuantity: number;
}

/** Lines keyed by order id. */
export type DevOrderLines = Readonly<Record<string, readonly DevOrderLine[]>>;

export const DEV_GRID_KEY = "dev-ui-orders";
export const DEV_GRID_ROW_LIMIT = 500;
export const DEV_SEARCH_FIELDS = ["code", "storeOrderNumber", "customerName", "trackingNumber"] as const;

function isRowKey(row: DevOrderRow, field: string): field is keyof DevOrderRow {
  return Object.prototype.hasOwnProperty.call(row, field);
}

/** Reads a grid-query field from a row (unknown fields read as undefined). */
export function devOrderField(row: DevOrderRow, field: string): FieldValue {
  return isRowKey(row, field) ? row[field] : undefined;
}
