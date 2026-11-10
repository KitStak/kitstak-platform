/** Client-side row and API types for Inventory by Location. */
export interface BucketRow {
  readonly id: string;
  readonly version: number;
  readonly imageUrl: string | null;
  readonly productId: string;
  readonly clientId: string;
  readonly client: string;
  readonly sku: string;
  readonly barcode: string;
  readonly productName: string;
  readonly unitsPerPack: number;
  readonly totalPackQty: number;
  readonly allocatedPackQty: number;
  readonly allocatedQty: number;
  readonly freePackQty: number;
  readonly freeQty: number;
  readonly packType: string;
  readonly uomPackType: string;
  readonly totalQty: number;
  readonly damagedQty: number;
  readonly lotNumber: string | null;
  readonly expiryDate: string | null;
  readonly productType: string | null;
  readonly productGroup: string | null;
  readonly warehouseId: string;
  readonly warehouse: string;
  readonly warehouseCode: string;
  readonly locationId: string;
  readonly location: string;
  readonly locationGroup: string | null;
  readonly locationZone: string | null;
  readonly locationType: string | null;
  readonly areaType: string | null;
  readonly replenishmentType: string | null;
  readonly walkingPathPriority: number;
  readonly poNumber: string | null;
  readonly lpId: string | null;
  readonly lpNumber: string | null;
  readonly parentLpNumber: string | null;
  readonly originalLpNumber: string | null;
  readonly lpType: string | null;
  readonly parentLpType: string | null;
  readonly originalParentLpNumber: string | null;
  readonly mobileCart: string | null;
  readonly status: string;
  readonly damageReason: string | null;
  readonly receivedAt: string;
  readonly productionDate: string | null;
  readonly trackLot: number;
  readonly trackExpiry: number;
  readonly trackProductionDate: number;
  readonly countLockPlan: string | null;
}

export interface BucketAllocation {
  readonly id: string;
  readonly qty: number;
  readonly status: string;
  readonly orderId: string | null;
  readonly orderCode: string | null;
  readonly jobId: string | null;
  readonly jobCode: string | null;
  readonly workOrderId: string | null;
  readonly workOrderCode: string | null;
  readonly createdAt: string;
}

export interface BucketTransaction {
  readonly id: string;
  readonly seq: number;
  readonly type: string;
  readonly qty: number;
  readonly direction: "in" | "out" | "adjust" | "neutral";
  readonly fromLocation: string | null;
  readonly toLocation: string | null;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
  readonly reason: string | null;
  readonly note: string | null;
  readonly orderCode: string | null;
  readonly jobCode: string | null;
  readonly user: string | null;
  readonly source: string;
  readonly at: string;
}

export interface BucketDetail {
  readonly bucket: BucketRow;
  readonly allocations: readonly BucketAllocation[];
  readonly transactions: readonly BucketTransaction[];
}

export interface MovedLine {
  readonly sku: string;
  readonly qty: number;
  readonly from: string;
  readonly to: string;
}

export interface TransferResult {
  readonly moved: readonly MovedLine[];
  readonly totalQty: number;
}

export interface BulkResult {
  readonly succeeded: readonly string[];
  readonly failed: readonly { readonly id: string; readonly code: string; readonly message: string }[];
}

export type QuantityMode = "add" | "adjust" | "remove";
export type AttributeKey = "lotNumber" | "expiryDate" | "productionDate" | "damageReason";

export const ATTRIBUTE_COPY: Readonly<Record<AttributeKey, { title: string; label: string; attention: string; placeholder: string }>> = {
  lotNumber: { title: "Change Lot/Batch Number", label: "Lot/Batch Number", placeholder: "Enter lot/batch number", attention: "All inventory lot/batch numbers that you have selected will be updated with the new one." },
  expiryDate: { title: "Change Expiry Date", label: "Expiry Date", placeholder: "Enter date", attention: "All inventory expiry dates that you have selected will be updated with the new one." },
  productionDate: { title: "Change Production Date", label: "Production Date", placeholder: "Enter date", attention: "All inventory production dates that you have selected will be updated with the new one." },
  damageReason: { title: "Change Damage Reason", label: "Damage Reason", placeholder: "No damage reason", attention: "All inventory damage reasons which you have selected will be updated with the new one." },
};

/** Why a row has no ⋯ menu (Allocated / Picked / Packed … rows). */
/** Disabled reason for quantity / attribute / transfer actions while a count plan locks the location. */
export function countLockReason(row: Pick<BucketRow, "countLockPlan" | "location">): string | null {
  return row.countLockPlan ? `Location ${row.location} is locked by count plan ${row.countLockPlan}. Finish, update or cancel the count first.` : null;
}

export function lockedReason(row: Pick<BucketRow, "status">): string | null {
  if (row.status === "Stock") return null;
  return `${row.status} stock belongs to an order in progress. Add, Adjust and Remove are only available on Stock rows.`;
}

/**
 * Short inline tag that tells split rows of the same SKU @ location apart (lot, LP, a non-default
 * status, PO). Falls back to the receiving date, which is what splits otherwise-identical rows.
 */
export function bucketSubLabel(
  row: Pick<BucketRow, "lotNumber" | "lpNumber" | "status" | "poNumber" | "receivedAt"> &
    Partial<Pick<BucketRow, "expiryDate" | "productionDate" | "trackExpiry" | "trackProductionDate">>,
  /** Formats the receiving instant as a local calendar day (same day as the Receiving Date column). */
  instantDate: (iso: string) => string,
  /** Formats a calendar date (expiry / production, "YYYY-MM-DD") without a timezone shift. */
  calendarDate: (ymd: string) => string = (v) => v,
): string {
  const parts: string[] = [];
  if (row.lotNumber) parts.push(`Lot ${row.lotNumber}`);
  // Expiry / production split rows of the same SKU @ location (FEFO), so they come before LP / PO.
  if (row.expiryDate && row.trackExpiry !== 0) parts.push(`Exp ${calendarDate(row.expiryDate)}`);
  if (row.productionDate && row.trackProductionDate !== 0) parts.push(`Prod ${calendarDate(row.productionDate)}`);
  if (row.lpNumber) parts.push(`LP ${row.lpNumber}`);
  if (row.status && row.status !== "Available" && row.status !== "Stock") parts.push(row.status);
  if (row.poNumber) parts.push(`PO ${row.poNumber}`);
  if (parts.length === 0 && row.receivedAt) parts.push(`Rcvd ${instantDate(row.receivedAt)}`);
  return parts.join(" · ");
}

/** How the bucket drawer shows one ledger row's quantity. */
export interface TxnQtyDisplay {
  /** Signed effect on this row's on-hand (0 for reservations and same-bucket changes). */
  readonly signed: number;
  readonly tone: "in" | "out" | "neutral";
  /** Always shows the real quantity: "+3", "−2", "3 reserved", "3 released", "3 changed". */
  readonly label: string;
  readonly kind: "in" | "out" | "reserve" | "release" | "change";
}

const MINUS = "−";

/**
 * Quantity text for a bucket transaction. Same-bucket rows (Allocation, Allocation Cancel, status
 * or attribute changes) do not change on-hand, but the drawer still names how many units they
 * touched: an audit view never shows 0 for a 3-unit allocation.
 */
export function txnQtyDisplay(t: Pick<BucketTransaction, "type" | "qty" | "direction">, fmtQty: (n: number) => string = String): TxnQtyDisplay {
  const q = Math.abs(t.qty);
  if (t.direction === "neutral") {
    const type = t.type.toLowerCase();
    if (/alloc/.test(type) && /cancel|release|de-?alloc|unalloc/.test(type)) return { signed: 0, tone: "neutral", label: `${fmtQty(q)} released`, kind: "release" };
    if (/alloc|reserv/.test(type)) return { signed: 0, tone: "neutral", label: `${fmtQty(q)} reserved`, kind: "reserve" };
    return { signed: 0, tone: "neutral", label: `${fmtQty(q)} changed`, kind: "change" };
  }
  const signed = t.direction === "out" ? -q : t.direction === "adjust" ? t.qty : q;
  if (signed < 0) return { signed, tone: "out", label: `${MINUS}${fmtQty(-signed)}`, kind: "out" };
  return { signed, tone: signed > 0 ? "in" : "neutral", label: signed > 0 ? `+${fmtQty(signed)}` : fmtQty(0), kind: "in" };
}

/**
 * Where a ledger row happened: "MLT1-A-01 → MLT1-B-01" for a move, "at MLT1-B-01" for a
 * single-sided row (Count, Adjustment, Attributes Change, Receive, Ship), never a dangling
 * "— → MLT1-B-01". Returns null when the row carries no location.
 */
export function txnLocationText(from: string | null | undefined, to: string | null | undefined): string | null {
  const a = from?.trim() || null;
  const b = to?.trim() || null;
  if (a && b) return a === b ? `at ${a}` : `${a} → ${b}`;
  const only = a ?? b;
  return only ? `at ${only}` : null;
}

/** A selected row that a bulk action leaves alone, with the reason shown in the drawer. */
export interface SkippedRow {
  readonly row: BucketRow;
  readonly reason: "status" | "count" | "allocated";
  readonly message: string;
}

export interface SelectionPartition {
  readonly eligible: readonly BucketRow[];
  readonly skipped: readonly SkippedRow[];
}

/**
 * Splits a bulk selection into the rows Change Attributes / Transfer Product can act on and the
 * rows they skip (non-Stock, count-locked, fully allocated). One ineligible row no longer blocks
 * the action for the whole page: the drawer opens on the eligible rows and lists what it skips.
 */
export function partitionSelection(rows: readonly BucketRow[]): SelectionPartition {
  const eligible: BucketRow[] = [];
  const skipped: SkippedRow[] = [];
  for (const row of rows) {
    if (lockedReason(row)) skipped.push({ row, reason: "status", message: `${row.status} (order in progress)` });
    else if (countLockReason(row)) skipped.push({ row, reason: "count", message: `Count-locked by ${row.countLockPlan}` });
    else if (row.freeQty <= 0) skipped.push({ row, reason: "allocated", message: "Every unit is allocated" });
    else eligible.push(row);
  }
  return { eligible, skipped };
}

const SKIP_NOUN: Record<SkippedRow["reason"], string> = { status: "not Stock", count: "count-locked", allocated: "fully allocated" };

/** "3 of 100 selected rows will be skipped (2 not Stock, 1 count-locked)." Null when nothing is skipped. */
export function skippedSummary(p: SelectionPartition): string | null {
  if (p.skipped.length === 0) return null;
  const total = p.eligible.length + p.skipped.length;
  const counts = new Map<SkippedRow["reason"], number>();
  for (const s of p.skipped) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  const parts = [...counts.entries()].map(([k, n]) => `${n} ${SKIP_NOUN[k]}`);
  return `${p.skipped.length} of ${total} selected row${total === 1 ? "" : "s"} will be skipped (${parts.join(", ")}).`;
}
