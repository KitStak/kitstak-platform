/**
 * Purchase order action gates (pure, no UI): which list / detail actions are enabled for the
 * selected orders and the reason shown when they are not. Shared by the PO list (bulk) and
 * the PO detail page (Other actions) so the detail chunk does not pull in the grid.
 */
import type { PoRow } from "./receiving-shared";

export const SERIAL_PREADVICE_REASON = "None of the selected purchase orders has pre-advised serial numbers. Import them with Import › Serial numbers.";

/** Remove Serial Number needs at least one selected PO with pre-advised serials. */
export function removeSerialsReason(rows: readonly Pick<PoRow, "preAdvisedSerials">[]): string | null {
  return rows.some((r) => (r.preAdvisedSerials ?? 0) > 0) ? null : SERIAL_PREADVICE_REASON;
}
const OPEN = new Set(["Pending", "Started"]);
export function cancelReason(rows: readonly PoRow[]): string | null {
  const bad = rows.find((r) => !OPEN.has(r.status));
  if (bad) return `Only Pending or Started orders can be cancelled (${bad.code} is ${bad.status}).`;
  // A Started PO with receipts is short-closed (open balance cancelled, received stock kept).
  return null;
}

/** Confirm copy for Cancel order: plain cancel, or short-close for POs that already received stock. */
export function cancelCopy(rows: readonly Pick<PoRow, "code" | "activeReceipts" | "totalQuantity" | "receivedQuantity">[]): { title: string; description: string } {
  const received = rows.filter((r) => r.activeReceipts > 0);
  const open = (r: (typeof rows)[number]) => Math.max(0, r.totalQuantity - r.receivedQuantity);
  if (received.length === 0) return { title: rows.length === 1 ? `Cancel ${rows[0]?.code ?? "this order"}?` : `Cancel ${rows.length} purchase orders?`, description: "Cancelled purchase orders can't be received or changed." };
  if (rows.length === 1) {
    const r = received[0] as (typeof rows)[number];
    return { title: `Cancel the open balance of ${r.code}?`, description: `${open(r).toLocaleString()} open unit${open(r) === 1 ? "" : "s"} will no longer be expected. Received lines and their stock are kept, and the order closes as Completed.` };
  }
  return { title: `Cancel ${rows.length} purchase orders?`, description: `Orders without receipts become Cancelled. ${received.length} order${received.length === 1 ? " has" : "s have"} received stock: ${received.length === 1 ? "its" : "their"} open balance is cancelled, received stock is kept, and ${received.length === 1 ? "it closes" : "they close"} as Completed.` };
}
/** Status gate shared by Receive items and Receive PO. */
export function receiveReason(rows: readonly PoRow[]): string | null {
  const bad = rows.find((r) => !OPEN.has(r.status));
  return bad ? `Only Pending or Started orders can be received (${bad.code} is ${bad.status}).` : null;
}
/** Receive PO (one-click full receive): also blocked when a line needs lot / expiry / serials. */
export function receiveAllReason(rows: readonly PoRow[]): string | null {
  const status = receiveReason(rows);
  if (status) return status;
  const open = rows.find((r) => r.totalQuantity > 0 && r.receivedQuantity >= r.totalQuantity);
  if (open) return `${open.code} is fully received.`;
  const tracked = rows.find((r) => r.receiveAllBlockedReason);
  if (!tracked?.receiveAllBlockedReason) return null;
  return rows.length === 1 ? tracked.receiveAllBlockedReason : `${tracked.code}: ${tracked.receiveAllBlockedReason}`;
}
export function deleteReason(rows: readonly PoRow[]): string | null {
  const bad = rows.find((r) => r.status !== "Pending" || r.activeReceipts > 0 || r.receivedQuantity > 0);
  return bad ? `Only Pending purchase orders without receipts can be deleted (${bad.code}).` : null;
}

/* ---------------- partial bulk actions (Logiwa acts on the eligible rows) ---------------- */

export interface SkippedPo {
  readonly id: string;
  readonly code: string;
  readonly reason: string;
}
export interface PoPartition {
  readonly eligible: readonly PoRow[];
  readonly skipped: readonly SkippedPo[];
}

/** Splits a selection into the rows an action can run on and the skipped ones, each with its own reason. */
export function partitionPos(rows: readonly PoRow[], reasonFor: (rows: readonly PoRow[]) => string | null): PoPartition {
  const eligible: PoRow[] = [];
  const skipped: SkippedPo[] = [];
  for (const r of rows) {
    const reason = reasonFor([r]);
    if (reason) skipped.push({ id: r.id, code: r.code, reason });
    else eligible.push(r);
  }
  return { eligible, skipped };
}

/** Disabled reason for a partial bulk action: only when no selected row is eligible. */
export function partialActionReason(rows: readonly PoRow[], reasonFor: (rows: readonly PoRow[]) => string | null): string | null {
  if (rows.length === 0) return null;
  const { eligible, skipped } = partitionPos(rows, reasonFor);
  if (eligible.length > 0) return null;
  return rows.length === 1 ? (skipped[0]?.reason ?? null) : `None of the selected purchase orders can be processed. ${skipped[0]?.code}: ${skipped[0]?.reason}`;
}

/** "2 of 5 selected orders are skipped: KS-1 (Completed), KS-2 (Cancelled)." */
export function skippedSummary(skipped: readonly SkippedPo[], total: number): string | null {
  if (skipped.length === 0) return null;
  const list = skipped.slice(0, 3).map((s) => (s.reason.includes(s.code) ? s.reason : `${s.code}: ${s.reason}`)).join(" · ");
  const more = skipped.length > 3 ? ` · +${skipped.length - 3} more` : "";
  return `${skipped.length} of ${total} selected order${total === 1 ? "" : "s"} ${skipped.length === 1 ? "is" : "are"} skipped. ${list}${more}`;
}
