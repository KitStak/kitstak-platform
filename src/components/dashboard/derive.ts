import type { DashboardData } from "@/server/repositories/dashboard";
import type { DonutRow, ProgressMetric } from "@/components/dashboard/widgets";

/* ---------- Shift window (Day Shift 08:00–17:00, demo clock 12:45) ---------- */

export const SHIFT_START_LABEL = "08:00";
export const SHIFT_END_LABEL = "17:00";
export const NOW_LABEL = "12:45";

const SHIFT_START_MINUTES = 8 * 60;
const SHIFT_END_MINUTES = 17 * 60;
const NOW_MINUTES = 12 * 60 + 45;

export function computeShiftPercent(): number {
  const elapsed = NOW_MINUTES - SHIFT_START_MINUTES;
  const span = SHIFT_END_MINUTES - SHIFT_START_MINUTES;
  const pct = (elapsed / span) * 100;
  return Math.round(Math.min(100, Math.max(0, pct)));
}

/** "2026-11-05" → "Thu, Nov 5" without UTC-midnight timezone drift. */
export function formatShiftDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function pctOf(current: number, target: number): number {
  if (target <= 0) return 0;
  return Math.round(Math.min(100, (current / target) * 100));
}

/* ---------- Progress for Today metrics ---------- */

export function buildProgressMetrics(data: DashboardData): ProgressMetric[] {
  const { jobsSummary, unfulfilled, progressToday } = data;
  const shipTarget = progressToday.ordersShipped + progressToday.openOrders;
  return [
    {
      label: "Tasks",
      sub: "Completed",
      percent: pctOf(jobsSummary.completedToday, jobsSummary.total),
      current: jobsSummary.completedToday,
      target: jobsSummary.total,
    },
    {
      label: "Order Lines",
      sub: "Packed",
      percent: pctOf(unfulfilled.packedUnits, unfulfilled.units),
      current: unfulfilled.packedUnits,
      target: unfulfilled.units,
    },
    {
      label: "Orders to be Shipped Today",
      sub: "Shipped",
      percent: pctOf(progressToday.ordersShipped, shipTarget),
      current: progressToday.ordersShipped,
      target: shipTarget,
    },
  ];
}

/* ---------- Unfulfilled Orders donut ---------- */

export interface UnfulfilledView {
  total: number;
  open: number;
  inProgress: number;
  rows: DonutRow[];
}

/**
 * Statuses that count as "In Progress" in the Unfulfilled Orders donut.
 * Exception states (Shortage, On Hold) are deliberately excluded so the card
 * reconciles with the Order Breakdown card: In Progress = the sum of exactly
 * these counts (e.g. 7 + 4 + 6 + 7 + 3 = 27), and Total = Open + In Progress.
 * Enterprise users add these up — an On Hold order is paused, not progressing.
 */
const IN_PROGRESS_STATUSES: readonly string[] = [
  "Ready to Pick",
  "Picking Started",
  "Ready to Pack",
  "Packing Started",
  "Ready to Ship",
];

export function buildUnfulfilled(data: DashboardData): UnfulfilledView {
  const statusMap = new Map(data.statusBreakdown.map((s) => [s.status, s.count]));
  const open = statusMap.get("Open") ?? 0;
  const inProgress = IN_PROGRESS_STATUSES.reduce(
    (sum, status) => sum + (statusMap.get(status) ?? 0),
    0
  );
  const total = open + inProgress;
  // Pack-quantity split: units already picked are "in progress"; the rest are open.
  const inProgressPack = Math.min(data.unfulfilled.pickedUnits, data.unfulfilled.units);
  const openPack = Math.max(0, data.unfulfilled.units - inProgressPack);
  return {
    total,
    open,
    inProgress,
    rows: [
      { label: "Total", tone: "foreground", orders: total, packQty: data.unfulfilled.units },
      { label: "Open", tone: "warning", orders: open, packQty: openPack },
      { label: "In Progress", tone: "primary", orders: inProgress, packQty: inProgressPack },
    ],
  };
}

/* ---------- Order Breakdown by Status ---------- */

export interface StatusEntry {
  label: string;
  count: number;
  emphasis?: boolean;
}

/**
 * Row-major order for a 4-column grid so each visual column groups logically,
 * mirroring Logiwa: backlog | packing | problems | shipped.
 */
export function buildStatusEntries(data: DashboardData): StatusEntry[] {
  const map = new Map(data.statusBreakdown.map((s) => [s.status, s.count]));
  const get = (status: string): number => map.get(status) ?? 0;
  return [
    { label: "Open", count: get("Open") },
    { label: "Ready to Pack", count: get("Ready to Pack") },
    { label: "Cancelled", count: get("Cancelled"), emphasis: true },
    { label: "Shipped", count: get("Shipped") },
    { label: "Ready to Pick", count: get("Ready to Pick") },
    { label: "Packing Started", count: get("Packing Started") },
    { label: "Shortage", count: get("Shortage"), emphasis: true },
    { label: "Delivered", count: get("Delivered") },
    { label: "Picking Started", count: get("Picking Started") },
    { label: "Ready to Ship", count: get("Ready to Ship") },
    { label: "On Hold", count: get("On Hold") },
    { label: "Already Shipped Today", count: data.progressToday.ordersShipped },
  ];
}

/* ---------- Jobs table rows ---------- */

export interface JobsTableRow {
  id: string;
  code: string;
  jobType: string;
  assigneeName: string | null;
  productQty: number;
  /** Null for count/replenishment jobs that are not order-driven. */
  orderQty: number | null;
  pctComplete: number;
  jobQty: number;
}

/** Seeded average line depth used to derive order counts for multi-item picks. */
const MULTI_ITEM_UNITS_PER_ORDER = 2.5;

function deriveOrderQty(jobType: string, unitCount: number): number | null {
  if (jobType === "Single Unit Orders") return unitCount;
  if (jobType === "Multi Item Orders") {
    return Math.max(1, Math.ceil(unitCount / MULTI_ITEM_UNITS_PER_ORDER));
  }
  return null;
}

export function buildJobRows(data: DashboardData): JobsTableRow[] {
  return data.jobsSummary.active.map((job) => ({
    id: job.id,
    code: job.code,
    jobType: job.jobType,
    assigneeName: job.assigneeName,
    productQty: job.unitCount,
    orderQty: deriveOrderQty(job.jobType, job.unitCount),
    pctComplete: job.pctComplete,
    jobQty: job.completedUnits,
  }));
}
