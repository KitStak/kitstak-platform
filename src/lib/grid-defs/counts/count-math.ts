/**
 * Count arithmetic and status rules (M07). PURE: imported by the count task handler, the
 * counts repositories and the UI, so "% Difference" and the action guards read the same
 * everywhere.
 */
import type { CountLineStatus, CountPlanStatus } from "@/lib/enums";

/** % Difference of counted vs system stock, 2 dp. 0 → n counts as +100%. */
export function percentDifference(systemQty: number | null | undefined, countedQty: number | null | undefined): number | null {
  if (countedQty === null || countedQty === undefined) return null;
  const system = systemQty ?? 0;
  if (system === 0) return countedQty === 0 ? 0 : 100;
  return Math.round(((countedQty - system) / system) * 10_000) / 100;
}

/** "−10.00", "+2.50", "0.00". Uses a real minus sign. */
export function formatDifference(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value === 0) return "0.00";
  const abs = Math.abs(value).toFixed(2);
  return value > 0 ? `+${abs}` : `−${abs}`;
}

export const OPEN_LINE_STATUSES: readonly CountLineStatus[] = ["Pending", "Ready To Count", "Count Started"];
export const DONE_LINE_STATUSES: readonly CountLineStatus[] = ["Inventory Updated", "Recount Created", "Cancelled"];
/** Plan statuses during which a Lock Locations plan holds its locations. */
export const LOCKING_PLAN_STATUSES: readonly CountPlanStatus[] = ["Pending", "Ready To Count", "Count Started", "Count Completed"];

/** Line statuses that release a Lock Locations hold (mirrors server counts-lock RELEASED_LINE_STATUSES). */
export const RELEASED_LINE_STATUSES: readonly CountLineStatus[] = ["Cancelled", "Inventory Updated", "Recount Created"];

/** True while this line keeps its location locked. */
export function lineHoldsLock(lockLocations: boolean, planStatus: string, lineStatus: string): boolean {
  return lockLocations && (LOCKING_PLAN_STATUSES as readonly string[]).includes(planStatus) && !(RELEASED_LINE_STATUSES as readonly string[]).includes(lineStatus);
}

export const isOpenLine = (s: string): boolean => (OPEN_LINE_STATUSES as readonly string[]).includes(s);

/** Plan status implied by its lines (null = keep the current status). */
export function impliedPlanStatus(current: CountPlanStatus, lineStatuses: readonly CountLineStatus[]): CountPlanStatus | null {
  if (current === "Pending" || current === "Cancelled" || current === "Inventory Updated") {
    return current === "Pending" && lineStatuses.length > 0 && lineStatuses.every((s) => s === "Cancelled") ? "Cancelled" : null;
  }
  const active = lineStatuses.filter((s) => s !== "Cancelled");
  if (active.length === 0) return "Cancelled";
  const open = active.filter((s) => isOpenLine(s));
  const anyCounted = active.some((s) => s !== "Ready To Count" && s !== "Pending");
  if (open.length > 0) return anyCounted ? "Count Started" : "Ready To Count";
  if (active.some((s) => s === "Count Completed")) return "Count Completed";
  return "Inventory Updated";
}

/* ----------------------------------------------------------- action guards */
/** Why a plan can't be cancelled, or null. */
export function planCancelReason(status: string): string | null {
  if (status === "Cancelled") return "This count plan is already cancelled";
  if (status === "Inventory Updated") return "Inventory has already been updated for this count";
  if (status === "Count Completed") return "Counted plans can't be cancelled; update inventory or create a recount";
  return null;
}

export function planCreateJobReason(status: string): string | null {
  return status === "Pending" ? null : "Only pending count plans can get a job";
}

export function planUpdateInvReason(status: string, countedLines: number): string | null {
  if (status === "Inventory Updated") return "Inventory has already been updated for this count";
  if (status === "Cancelled") return "Cancelled count plans can't update inventory";
  if (status === "Pending" || status === "Ready To Count") return "Nothing has been counted yet";
  if (countedLines === 0) return "No counted lines are waiting for an inventory update";
  return null;
}

export function planEditReason(status: string): string | null {
  return status === "Pending" ? null : "Only pending count plans can be edited";
}

export const planDeleteReason = (status: string): string | null =>
  status === "Pending" ? null : "Only pending count plans can be deleted; cancel it instead";

export function lineCancelReason(status: string): string | null {
  return isOpenLine(status) ? null : `${status} lines can't be cancelled`;
}

export function lineUpdateInvReason(status: string): string | null {
  return status === "Count Completed" ? null : status === "Inventory Updated" ? "Inventory has already been updated" : "Only counted lines can update inventory";
}

export function lineRecountReason(status: string): string | null {
  return status === "Count Completed" ? null : status === "Recount Created" ? "A recount already exists for this line" : "Only counted lines can be recounted";
}

export const lineDeleteReason = (status: string): string | null =>
  status === "Pending" ? null : "Only lines of a pending count plan can be deleted";

/** First non-null reason across the selection (bulk action eligibility). */
export function firstReason<T>(rows: readonly T[], reason: (row: T) => string | null): string | null {
  for (const row of rows) {
    const r = reason(row);
    if (r) return r;
  }
  return null;
}
