/**
 * Count arithmetic and status rules (M07). PURE: imported by the count task handler, the
 * counts repositories and the UI, so "% Difference" and the action guards read the same
 * everywhere.
 */
import type { CountLineStatus, CountPlanStatus } from "@/lib/enums";
import { statusLabel } from "@/lib/status-colors";

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

/**
 * Approved Stock / Approved Count Qty are only real once a line posts. A Recount Created line was
 * superseded by its recount and a Cancelled line was closed without posting, so their approved
 * values must not read as approved: the grids show "—" with this tag and reason instead.
 */
export function approvedQtySuperseded(lineStatus: string): { readonly tag: string; readonly reason: string } | null {
  if (lineStatus === "Recount Created") return { tag: "Superseded", reason: "Not posted: this count was superseded by its recount line. The recount line carries the approved quantities." };
  if (lineStatus === "Cancelled") return { tag: "Not posted", reason: "Not posted: this line was cancelled, so nothing was approved." };
  return null;
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
  // Only superseded lines left (e.g. a recount whose job was cancelled): nothing was posted, so the
  // plan closes as Cancelled rather than claiming an inventory update.
  return active.some((s) => s === "Inventory Updated") ? "Inventory Updated" : "Cancelled";
}

/* ----------------------------------------------------------- action guards */
/** Why a plan can't be cancelled, or null. */
export function planCancelReason(status: string): string | null {
  if (status === "Cancelled") return "This count plan is already cancelled";
  if (status === "Inventory Updated") return "Inventory has already been updated for this count";
  // Logiwa parity: any not-yet-updated plan can be cancelled. Counted results that were not posted
  // are discarded, so the confirm asks for a reason (COUNT_DISCARD_REASON_MESSAGE).
  return null;
}

/** Cancelling these statuses throws away a counted result that was never posted. */
export const cancelDiscardsCount = (status: string): boolean => status === "Count Completed";
export const COUNT_DISCARD_REASON_MESSAGE = "Counted results that were not posted will be discarded. Give a reason for the audit trail.";

/**
 * Count posting against allocated stock (critic r5 blocker). The ledger never takes a bucket below
 * its allocated qty, so a shortage first shorts unpicked allocations (`releasable`: shipment-order
 * allocations with no live pick task). What is still allocated after that (picked, in a job, work
 * orders) can't post: `unpostable` > 0 blocks the line, which is then closed without posting
 * (cancelled with a reason) instead of dead-ending the plan.
 */
export function allocationShortfall(input: { readonly allocated: number; readonly releasable: number; readonly target: number }): { readonly release: number; readonly unpostable: number } {
  const target = Math.max(0, input.target);
  if (target >= input.allocated) return { release: 0, unpostable: 0 };
  const short = input.allocated - target;
  const release = Math.min(short, Math.max(0, input.releasable));
  return { release, unpostable: short - release };
}

/** "1 unit" / "3 units" (plural-aware KPI and message copy). */
export const unitsLabel = (n: number, noun: readonly [string, string] = ["unit", "units"]): string => `${n.toLocaleString("en-US")} ${Math.abs(n) === 1 ? noun[0] : noun[1]}`;

/**
 * Create Job: a Pending plan, or an open plan whose count job was cancelled and left lines with no
 * live task ("orphaned" lines). Create Job then re-issues tasks for exactly those lines.
 */
export function planCreateJobReason(status: string, orphanedLines = 0): string | null {
  if (status === "Pending") return null;
  if (orphanedLines > 0 && (status === "Ready To Count" || status === "Count Started")) return null;
  return "Only pending count plans, or plans whose count job was cancelled, can get a job";
}

/** Callout copy for an open plan with lines that lost their task (job cancelled elsewhere). */
export function orphanedLinesMessage(orphanedLines: number): string | null {
  if (orphanedLines <= 0) return null;
  return `${orphanedLines === 1 ? "1 line has" : `${orphanedLines.toLocaleString()} lines have`} no count task: ${orphanedLines === 1 ? "its" : "their"} count job was cancelled. Create Job re-issues ${orphanedLines === 1 ? "it" : "them"} to counters, or cancel ${orphanedLines === 1 ? "the line" : "the lines"} to release ${orphanedLines === 1 ? "its location" : "their locations"}.`;
}

export function planUpdateInvReason(status: string, countedLines: number): string | null {
  if (status === "Inventory Updated") return "Inventory has already been updated for this count";
  if (status === "Cancelled") return "Cancelled count plans can't update inventory";
  // Update Inv. needs at least one Count Completed line. On an open plan it then posts the counted
  // lines and cancels the rest (Logiwa parity); the confirm lists what gets cancelled first.
  // A plan with nothing counted is closed with Cancel instead, so the two actions never overlap.
  if (countedLines === 0) {
    return status === "Count Completed" ? "No counted lines are waiting for an inventory update" : "Nothing is counted yet. Count at least one line first, or use Cancel to close the plan";
  }
  return null;
}

/** Update Inv. on a plan with nothing counted posts nothing and cancels every line (so the plan). */
export const planUpdateInvCancelsAll = (countedLines: number): boolean => countedLines === 0;

/** Jobs that Create Job makes from `units` batch units (distinct locations) at `batchSize` per job. */
export const jobsForUnits = (units: number, batchSize: number): number => (units <= 0 ? 0 : Math.ceil(units / Math.max(1, Math.floor(batchSize))));

export function planEditReason(status: string): string | null {
  return status === "Pending" ? null : "Only pending count plans can be edited";
}

/** Inventory Updated plans are locked for the audit trail: no edits at all, not even the name (cancelled plans can still be renamed). */
export function planLockedReason(status: string): string | null {
  return status === "Inventory Updated" ? "Locked: inventory was updated from this count, so the plan is read-only for the audit trail" : null;
}

/**
 * Logiwa keeps Edit Count open on Inventory Updated plans. KitStaks lets the description change
 * there (a non-quantity, change-logged field) but keeps the name: ledger postings and their notes
 * reference the plan code, so renaming would break the audit link.
 */
export function planNameLockedReason(status: string): string | null {
  return status === "Inventory Updated" ? "Locked: inventory was updated from this count and its ledger postings reference this name. You can still edit the description" : null;
}

export const planDeleteReason = (status: string): string | null =>
  status === "Pending" ? null : "Only pending count plans can be deleted; cancel it instead";

/** Open lines and counted (not yet posted) lines can be cancelled (Logiwa: lines that are not updated are cancelled). */
export function lineCancelReason(status: string): string | null {
  return isOpenLine(status) || cancelDiscardsCount(status) ? null : `${statusLabel(status)} lines can't be cancelled`;
}

export function lineUpdateInvReason(status: string): string | null {
  return status === "Count Completed" ? null : status === "Inventory Updated" ? "Inventory has already been updated" : "Only counted lines can update inventory";
}

/** Logiwa parity: recounts exist only for Cycle Count plans, and only for Count Completed lines. */
export const RECOUNT_RULE_HINT = "Recount jobs can only be created for Cycle Count plans and only for lines in Count Completed status.";

export function lineRecountReason(status: string, operationType?: string | null): string | null {
  if (operationType && operationType !== "Cycle Count") return "Recounts are only for Cycle Count plans. Quick (Instant Count) lines can't be recounted; run a new quick count instead";
  return status === "Count Completed" ? null : status === "Recount Created" ? "A recount already exists for this line" : "Only counted lines can be recounted";
}

export const lineDeleteReason = (status: string): string | null =>
  status === "Pending" ? null : "Only lines of a pending count plan can be deleted";

/** Four-eyes rule: why `userId` can't post this line's variance, or null. */
export function selfApprovalReason(line: { readonly countUserId?: string | null; readonly hasVariance: boolean }, userId: string | null, canSelfApprove: boolean): string | null {
  if (canSelfApprove || !line.hasVariance || !userId || line.countUserId !== userId) return null;
  return "You counted this line, so another user must approve its variance (four-eyes rule). Ask a supervisor to run Update Inv.";
}

/** Parses the plan grid's "id|code;id|code" job references. */
export function parseJobRefs(refs: string | null | undefined): { id: string; code: string }[] {
  if (!refs) return [];
  return refs.split(";").flatMap((pair) => {
    const at = pair.indexOf("|");
    if (at <= 0 || at === pair.length - 1) return [];
    return [{ id: pair.slice(0, at), code: pair.slice(at + 1) }];
  });
}

/** First non-null reason across the selection (bulk action eligibility). */
export function firstReason<T>(rows: readonly T[], reason: (row: T) => string | null): string | null {
  for (const row of rows) {
    const r = reason(row);
    if (r) return r;
  }
  return null;
}

/** Counted-qty text → number ("1,250" → 1250), null when blank, NaN when not a number. Negatives and fractions pass through so validation can name them. */
export function parseCountedText(text: string): number | null {
  const t = text.trim().replace(/[\s,]/g, "");
  if (!t) return null;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN;
}

/** Problem with one counted value on the sheet: whole number, 0 or more (null = not entered yet). */
export function countedValueError(v: number | null): string | null {
  if (v === null) return null;
  if (!Number.isFinite(v)) return "Enter a whole number";
  if (v < 0) return "Counted qty can't be negative";
  if (!Number.isInteger(v)) return "Enter a whole number";
  return null;
}

/**
 * Detail-page Update Inv.: Logiwa posts only lines that finished counting, so the plan-level
 * action stays disabled while any line is still open. Completed lines can be posted one by
 * one from the Lines tab meanwhile.
 */
export function planOpenLinesReason(openLines: number, activeLines: number): string | null {
  if (openLines <= 0) return null;
  const done = Math.max(0, activeLines - openLines);
  return `${openLines} of ${activeLines} ${activeLines === 1 ? "line is" : "lines are"} still being counted. Finish counting first, or select the ${done === 1 ? "completed line" : "completed lines"} on the Lines tab and update ${done === 1 ? "it" : "them"} there.`;
}

/* ------------------------------------------------- AI count plan (suggest) */
export interface CountRiskSignals {
  /** Days since the last count of this location / SKU (null = never counted). */
  readonly daysSinceCount: number | null;
  /** Physical movements (picks, moves, receipts, replenishments, adjustments) in the window. */
  readonly moves: number;
  /** Past count entries that differed from the system quantity. */
  readonly pastVariances: number;
  readonly abcCode: string | null;
}

export interface CountRiskScore { readonly score: number; readonly reasons: readonly string[] }

/** Days after which a location / SKU counts as fully "due" for a cycle count. */
export const COUNT_DUE_DAYS = 90;

/**
 * Risk score 0–100 for the AI Count Plan suggestion: staleness (40), movement velocity relative to
 * the busiest candidate (30), count accuracy history (20) and ABC class (10). Reasons explain the
 * score in plain words, strongest first.
 */
export function scoreCountRisk(s: CountRiskSignals, maxMoves: number): CountRiskScore {
  const stale = s.daysSinceCount === null ? 1 : Math.min(1, s.daysSinceCount / COUNT_DUE_DAYS);
  const velocity = maxMoves > 0 ? Math.min(1, s.moves / maxMoves) : 0;
  const variance = Math.min(1, s.pastVariances / 3);
  const abc = s.abcCode === "A" ? 1 : s.abcCode === "B" ? 0.5 : 0;
  const parts: { w: number; reason: string | null }[] = [
    { w: stale * 40, reason: s.daysSinceCount === null ? "Never counted" : s.daysSinceCount >= 14 ? `Last counted ${s.daysSinceCount} days ago` : null },
    { w: velocity * 30, reason: s.moves > 0 ? `${s.moves} ${s.moves === 1 ? "movement" : "movements"} in 30 days` : null },
    { w: variance * 20, reason: s.pastVariances > 0 ? `${s.pastVariances} past count ${s.pastVariances === 1 ? "variance" : "variances"}` : null },
    { w: abc * 10, reason: s.abcCode === "A" || s.abcCode === "B" ? `ABC class ${s.abcCode}` : null },
  ];
  const score = Math.round(parts.reduce((t, p) => t + p.w, 0));
  const reasons = parts.filter((p) => p.reason && p.w > 0).sort((a, b) => b.w - a.w).map((p) => p.reason as string);
  return { score, reasons };
}
