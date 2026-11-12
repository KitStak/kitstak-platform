/**
 * Pure rules of the RF (handheld) receive-by-scan screen, `/receiving/rf`. Kept apart from the
 * component so they are unit tested: which PO line a scan hits, what still blocks Confirm, and
 * the receive body that is posted to `/api/purchase-orders/[id]/receive`.
 */

export interface RfLine {
  readonly id: string;
  readonly sku: string;
  readonly barcode: string;
  readonly orderedQuantity: number;
  readonly receivedQuantity: number;
  readonly uomQuantity: number;
  readonly tracking: {
    readonly lot: boolean;
    readonly expiry: boolean;
    readonly production: boolean;
    readonly serial: boolean;
  };
}

export const openQty = (l: Pick<RfLine, 'orderedQuantity' | 'receivedQuantity'>): number =>
  Math.max(0, l.orderedQuantity - l.receivedQuantity);

const norm = (s: string): string => s.trim().toLowerCase();

/**
 * The PO line a scanned barcode or SKU belongs to. Exact barcode first, then exact SKU
 * (case-insensitive). When a SKU sits on several lines, the first line with an open balance wins.
 */
export function matchLine<T extends RfLine>(lines: readonly T[], scan: string): T | null {
  const s = norm(scan);
  if (!s) return null;
  const hits = lines.filter((l) => norm(l.barcode) === s);
  const bySku = hits.length > 0 ? hits : lines.filter((l) => norm(l.sku) === s);
  if (bySku.length === 0) return null;
  return bySku.find((l) => openQty(l) > 0) ?? bySku[0] ?? null;
}

export interface RfDraft {
  readonly quantity: number;
  readonly locationId: string | null;
  readonly lpMode: 'none' | 'existing' | 'new';
  readonly lpId: string | null;
  readonly lpTypeId: string | null;
  readonly lotNumber: string;
  readonly expiryDate: string;
  readonly productionDate: string;
  readonly serials: readonly string[];
  readonly allowOverReceipt: boolean;
}

export const EMPTY_DRAFT: RfDraft = {
  quantity: 1,
  locationId: null,
  lpMode: 'none',
  lpId: null,
  lpTypeId: null,
  lotNumber: '',
  expiryDate: '',
  productionDate: '',
  serials: [],
  allowOverReceipt: false,
};

/** First reason Confirm is blocked (null: ready). Mirrors the receive drawer's gate. */
export function rfReceiveIssue(line: RfLine, d: RfDraft): string | null {
  if (!Number.isInteger(d.quantity) || d.quantity < 1) return 'Enter a quantity of at least 1.';
  if (line.tracking.lot && !d.lotNumber.trim())
    return `${line.sku} is lot tracked: scan or enter the lot/batch number.`;
  if (line.tracking.expiry && !d.expiryDate) return `${line.sku} is expiry tracked: enter the expiry date.`;
  if (line.tracking.production && !d.productionDate) return `${line.sku} tracks production date: enter it.`;
  if (line.tracking.serial) {
    const need = d.quantity * Math.max(1, line.uomQuantity);
    if (d.serials.length !== need)
      return `Scan ${need} serial number${need === 1 ? '' : 's'} (${d.serials.length} scanned).`;
  }
  if (!d.locationId) return 'Scan the receiving location.';
  if (d.lpMode === 'existing' && !d.lpId) return 'Scan the LP, or switch to No LP.';
  if (d.lpMode === 'new' && !d.lpTypeId) return 'Choose the LP type for the new LP.';
  if (d.quantity > openQty(line) && !d.allowOverReceipt)
    return `Only ${openQty(line).toLocaleString()} open: confirm the over-receipt.`;
  return null;
}

/** Adds a scanned serial; returns the reason it was refused, or the new list. */
export function addSerial(
  serials: readonly string[],
  scan: string,
): { readonly serials: readonly string[]; readonly error: string | null } {
  const s = scan.trim();
  if (!s) return { serials, error: null };
  if (serials.some((x) => norm(x) === norm(s))) return { serials, error: `${s} is already scanned.` };
  return { serials: [...serials, s], error: null };
}

/** `POST /api/purchase-orders/[id]/receive` body for one scanned line. */
export function rfReceiveBody(
  line: RfLine,
  d: RfDraft,
  opts: { readonly version: number; readonly fromSuggestion: boolean; readonly suggestQty: number | null },
) {
  return {
    version: opts.version,
    allowOverReceipt: d.allowOverReceipt,
    allowExpired: false,
    lines: [
      {
        lineId: line.id,
        quantity: d.quantity,
        locationId: d.locationId ?? '',
        lpMode: d.lpMode,
        lpId: d.lpMode === 'existing' ? d.lpId : null,
        lpTypeId: d.lpMode === 'new' ? d.lpTypeId : null,
        lotNumber: d.lotNumber.trim() || null,
        expiryDate: d.expiryDate || null,
        productionDate: d.productionDate || null,
        damageReason: null,
        serials: [...d.serials],
        note: 'RF receiving',
        fromSuggestion: opts.fromSuggestion,
        suggestBasis: opts.fromSuggestion && opts.suggestQty ? { qty: opts.suggestQty } : null,
      },
    ],
  };
}
