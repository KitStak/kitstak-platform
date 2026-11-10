/**
 * Selection eligibility for the Shipment Orders bulk menus (PURE, unit-tested). Each
 * function returns a disabled reason (tooltip) or null when the action can run.
 */
export interface EligibilityRow {
  readonly id: string;
  readonly code: string;
  readonly status: string;
  readonly jobId: string | null;
  readonly retailerId: string | null;
  readonly isMerged: boolean;
  readonly hasLabel: boolean;
  readonly hasActiveTask: boolean;
  readonly hasSerials: boolean;
  readonly pickShortStatus?: unknown;
  readonly packShortStatus?: unknown;
  readonly allocatedQuantity?: number;
}

export const LOGIWA_GUARDS = {
  reprint: "The orders which you have selected has no label to reprint.",
  void: "You can't void the labels for orders without a tracking number.",
  cancelPicking: "The Cancel Picking operation is only available for the orders that have active picking/packing tasks.",
  pickList: "The picking list cannot be printed for the orders that have no active picking task.",
  issueLabel: "Issue label cannot be printed for the selected order(s). To print an issue label, the order must have an active Pick or Pack Short issue and be in Open or Resolved status.",
  removeSerials: "The selected orders have no serial numbers to remove.",
} as const;

const SHIPPED = new Set(["Shipped", "Partially Shipped", "Delivered"]);
const CANCELLABLE = new Set(["Open", "Shortage", "Ready to Pick", "On Hold"]);
const HOLDABLE = new Set(["Open", "Shortage", "Ready to Pick", "Ready to Sort", "Ready to Pack", "Ready to Load", "Ready to Ship"]);
const JOBABLE = new Set(["Open", "Shortage", "Ready to Pick"]);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const list = (rows: readonly EligibilityRow[]) => rows.slice(0, 3).map((r) => r.code).join(", ") + (rows.length > 3 ? "…" : "");

/** Reason when NO selected row passes `ok`; null when at least one does (the server reports the rest). */
function someOk(rows: readonly EligibilityRow[], ok: (r: EligibilityRow) => boolean, reason: string): string | null {
  if (rows.length === 0) return null;
  return rows.some(ok) ? null : reason;
}

/** Reason when ANY selected row fails `ok` (all-or-nothing actions). */
function allOk(rows: readonly EligibilityRow[], ok: (r: EligibilityRow) => boolean, reason: (bad: readonly EligibilityRow[]) => string): string | null {
  const bad = rows.filter((r) => !ok(r));
  return bad.length ? reason(bad) : null;
}

export const eligibility = {
  ship: (rows: readonly EligibilityRow[]) => someOk(rows, (r) => r.status === "Ready to Ship", "Only Ready to Ship orders can be shipped."),
  retailerLabel: (rows: readonly EligibilityRow[]) => allOk(rows, (r) => Boolean(r.retailerId), (bad) => `Retailer labels need a retailer on the order (${list(bad)}).`),
  createLabel: (rows: readonly EligibilityRow[]) =>
    someOk(rows, (r) => ["Packing Started", "Ready to Load", "Loading Started", "Ready to Ship", "Partially Shipped"].includes(r.status) && !r.hasLabel, "Labels can be created once an order is packed and has no active label."),
  returnLabel: (rows: readonly EligibilityRow[]) => someOk(rows, (r) => SHIPPED.has(r.status), "Return labels can only be created for shipped orders."),
  jobs: (rows: readonly EligibilityRow[]) => someOk(rows, (r) => JOBABLE.has(r.status) && !r.jobId, "Only Open, Shortage or Ready to Pick orders without a job can get a picking job."),
  backorder: (rows: readonly EligibilityRow[]) => someOk(rows, (r) => r.status === "Shortage", "Only Shortage orders can be back-ordered."),
  cancel: (rows: readonly EligibilityRow[]) =>
    someOk(rows, (r) => CANCELLABLE.has(r.status) && !r.jobId, "Only orders that have not started picking and have no job can be cancelled."),
  hold: (rows: readonly EligibilityRow[]) => someOk(rows, (r) => HOLDABLE.has(r.status), "None of the selected orders can be put on hold."),
  release: (rows: readonly EligibilityRow[]) => someOk(rows, (r) => r.status === "On Hold", "Only orders on hold can be released."),
  changeWarehouse: (rows: readonly EligibilityRow[]) =>
    // Orders with a picking job stay selectable: the modal and the server report them as skipped (Logiwa parity).
    someOk(rows, (r) => ["Open", "Shortage", "On Hold"].includes(r.status) || Boolean(r.jobId), "Only Open, Shortage or On Hold orders can change warehouse."),
  resolvePickShort: (rows: readonly EligibilityRow[]) => allOk(rows, (r) => r.pickShortStatus === "Open", () => "Enabled only when the pick short status is Open."),
  resolvePackShort: (rows: readonly EligibilityRow[]) => allOk(rows, (r) => r.packShortStatus === "Open", () => "Enabled only when the pack short status is Open."),
  unmerge: (rows: readonly EligibilityRow[]) => allOk(rows, (r) => r.isMerged, () => "Enabled only for merged orders."),
  delete: (rows: readonly EligibilityRow[]) =>
    allOk(rows, (r) => r.status === "Open" && !r.jobId, (bad) => `Only Open orders without a job can be deleted (${list(bad)}).`),
};

/** Splits the selection for a guarded action: the rows it applies to and the rest. */
export function partition(rows: readonly EligibilityRow[], ok: (r: EligibilityRow) => boolean): { readonly eligible: readonly EligibilityRow[]; readonly skipped: readonly EligibilityRow[] } {
  return { eligible: rows.filter(ok), skipped: rows.filter((r) => !ok(r)) };
}

export const guardChecks = {
  reprint: (r: EligibilityRow) => r.hasLabel,
  void: (r: EligibilityRow) => r.hasLabel,
  cancelPicking: (r: EligibilityRow) => r.hasActiveTask,
  pickList: (r: EligibilityRow) => r.hasActiveTask,
  issueLabel: (r: EligibilityRow) => ["Open", "Resolved"].includes(String(r.pickShortStatus)) || ["Open", "Resolved"].includes(String(r.packShortStatus)),
  removeSerials: (r: EligibilityRow) => r.hasSerials,
};

export function shipConfirmText(n: number): string {
  return `${plural(n, "order")} will be shipped. Orders will move to Shipped & Canceled Orders and their inventory leaves the warehouse.`;
}
