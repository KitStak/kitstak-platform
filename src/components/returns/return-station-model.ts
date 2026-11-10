/**
 * Return Station capture model (PURE, unit tested). Items being received, scan
 * application (increment the matching line, block over-receiving), validation and the
 * `/api/returns/receive` and `/api/returns/manual` item payloads.
 */
import type { RETURN_DISPOSITIONS } from "@/lib/enums";

export type ReturnDisposition = (typeof RETURN_DISPOSITIONS)[number];

export interface CaptureItem {
  readonly key: string;
  readonly returnOrderLineId: string | null;
  readonly productId: string;
  readonly sku: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly scanCodes: readonly string[];
  /** Units still expected on the RMA line (null for manual returns: no cap). */
  readonly remaining: number | null;
  readonly quantity: number;
  readonly disposition: ReturnDisposition;
  readonly damageReasonId: string | null;
  readonly actualReturnReasonId: string | null;
  readonly note: string;
}

export type ItemErrors = Readonly<Record<string, { readonly quantity?: string; readonly damageReasonId?: string }>>;

export interface RmaLineInput {
  readonly id: string;
  readonly productId: string;
  readonly sku: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly requestedQty: number;
  readonly returnedQty: number;
  readonly customerReturnReasonId?: string | null;
}

/** Capture rows for the open lines of an RMA (quantity starts at 0 until scanned). */
export function itemsFromRma(lines: readonly RmaLineInput[]): CaptureItem[] {
  return lines.filter((l) => l.requestedQty - l.returnedQty > 0).map((l) => ({
    key: l.id, returnOrderLineId: l.id, productId: l.productId, sku: l.sku, name: l.name, imageUrl: l.imageUrl,
    scanCodes: [l.sku.toLowerCase()], remaining: l.requestedQty - l.returnedQty, quantity: 0, disposition: "Restock",
    damageReasonId: null, actualReturnReasonId: null, note: "",
  }));
}

export type ScanOutcome =
  | { readonly ok: true; readonly items: CaptureItem[]; readonly key: string; readonly sku: string }
  | { readonly ok: false; readonly error: string };

/** Applies a product scan to RMA rows: +1 on the first matching row with room left. */
export function applyScan(items: readonly CaptureItem[], code: string): ScanOutcome {
  const lc = code.trim().toLowerCase();
  if (!lc) return { ok: false, error: "Scan or enter a product barcode" };
  const matches = items.filter((i) => i.scanCodes.includes(lc) || i.sku.toLowerCase() === lc);
  if (matches.length === 0) return { ok: false, error: `${code} is not on this return.` };
  const target = matches.find((i) => i.remaining === null || i.quantity < i.remaining);
  if (!target) return { ok: false, error: `${matches[0]?.sku ?? code}: all expected units are already scanned.` };
  return { ok: true, key: target.key, sku: target.sku, items: items.map((i) => (i.key === target.key ? { ...i, quantity: i.quantity + 1 } : i)) };
}

/** Adds a scanned product to a manual return (merges into an existing Restock row of the same product). */
export function addManualProduct(items: readonly CaptureItem[], p: { readonly id: string; readonly sku: string; readonly name: string; readonly imageUrl: string | null }, code: string): { items: CaptureItem[]; key: string } {
  const existing = items.find((i) => i.productId === p.id);
  if (existing) return { key: existing.key, items: items.map((i) => (i.key === existing.key ? { ...i, quantity: i.quantity + 1 } : i)) };
  const key = `m-${p.id}`;
  return {
    key,
    items: [...items, {
      key, returnOrderLineId: null, productId: p.id, sku: p.sku, name: p.name, imageUrl: p.imageUrl,
      scanCodes: [...new Set([p.sku.toLowerCase(), code.trim().toLowerCase()])], remaining: null, quantity: 1,
      disposition: "Restock", damageReasonId: null, actualReturnReasonId: null, note: "",
    }],
  };
}

export function updateItem(items: readonly CaptureItem[], key: string, patch: Partial<CaptureItem>): CaptureItem[] {
  return items.map((i) => (i.key === key ? { ...i, ...patch } : i));
}

export function validateItems(items: readonly CaptureItem[]): { readonly errors: ItemErrors; readonly message: string | null } {
  const errors: Record<string, { quantity?: string; damageReasonId?: string }> = {};
  for (const i of items) {
    if (i.quantity < 0 || !Number.isInteger(i.quantity)) errors[i.key] = { quantity: "Enter a whole number" };
    else if (i.remaining !== null && i.quantity > i.remaining) errors[i.key] = { quantity: `Max ${i.remaining} left to receive` };
    if (i.quantity > 0 && i.disposition === "Damaged" && !i.damageReasonId) errors[i.key] = { ...errors[i.key], damageReasonId: "Choose a damage reason" };
  }
  const receiving = items.filter((i) => i.quantity > 0);
  const message = receiving.length === 0 ? "Scan at least one item" : Object.keys(errors).length ? "Fix the highlighted items" : null;
  return { errors, message };
}

export interface ReceiveItemPayload {
  readonly returnOrderLineId?: string | null;
  readonly productId: string;
  readonly quantity: number;
  readonly disposition: ReturnDisposition;
  readonly damageReasonId: string | null;
  readonly actualReturnReasonId: string | null;
  readonly note: string | null;
}

export function itemsPayload(items: readonly CaptureItem[], withLine: boolean): ReceiveItemPayload[] {
  return items.filter((i) => i.quantity > 0).map((i) => ({
    ...(withLine ? { returnOrderLineId: i.returnOrderLineId } : {}),
    productId: i.productId, quantity: i.quantity, disposition: i.disposition,
    damageReasonId: i.disposition === "Damaged" ? i.damageReasonId : null, actualReturnReasonId: i.actualReturnReasonId, note: i.note.trim() || null,
  }));
}

export function totals(items: readonly CaptureItem[]): { readonly scanned: number; readonly expected: number | null } {
  const scanned = items.reduce((s, i) => s + i.quantity, 0);
  const expected = items.every((i) => i.remaining !== null) ? items.reduce((s, i) => s + (i.remaining ?? 0), 0) : null;
  return { scanned, expected };
}

/** Where a disposition puts the stock (shown under the disposition picker). */
export function dispositionHint(d: ReturnDisposition, targetCode: string | null, stationCode: string | null): string {
  switch (d) {
    case "Restock": return `Received as sellable stock into ${targetCode ?? stationCode ?? "the target"}.`;
    case "Damaged": return `Received as damaged stock into ${targetCode ?? stationCode ?? "the target"} (not allocatable).`;
    case "Quarantine": return `Held at the station ${stationCode ?? ""} for inspection.`.replace("  ", " ");
    case "Dispose": return "Received, then written off with an inventory adjustment.";
  }
}
