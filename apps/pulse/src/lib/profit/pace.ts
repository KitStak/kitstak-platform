/**
 * Pace and productivity (docs/pulse/SPEC.md 4.12). Pace is units per person per hour. Setup
 * hours, unconfirmed warehouse rows and imported Projects time still cost money, but they stay
 * out of pace, so pace is never infinite or crushed. Pure functions.
 */
import { type Cents, type Decimal, ZERO, divRound, hoursToScaled, perUnitCents, quantityToScaled, scaledToNumber, toScaled } from '../money';
import type { IsoDate, PlanTotals } from './types';

/** A production row, with what pace needs. */
export interface PaceRow {
  readonly workDate: IsoDate;
  readonly unitsGood: Decimal;
  readonly hours: Decimal;
  readonly setupHours?: Decimal | null;
  /** False for warehouse rows that still need crew hours. Default true. */
  readonly hoursConfirmed?: boolean;
  /** Rows imported from Projects (`projects`) never count in pace. */
  readonly source?: string | null;
  /** Labor cost of the row, for the cost rate of the last evidence days. */
  readonly laborCostCents?: Cents | null;
}

/** One job day, rolled up for pace. */
export interface PaceDay {
  readonly workDate: IsoDate;
  readonly unitsGood: number;
  /** Hours minus setup hours, on confirmed rows that are not from Projects. */
  readonly paceHours: number;
  /** All labor hours of the day. */
  readonly hours: number;
  readonly laborCostCents: Cents;
  /** Pace hours above zero and no row with units and unconfirmed hours. */
  readonly counted: boolean;
  /** A counted day with units above zero. */
  readonly evidence: boolean;
  /** The day has units on a row whose hours are not confirmed. */
  readonly missingHours: boolean;
}

/** Rolls production rows of one job up into days, oldest first. */
export function paceDays(rows: readonly PaceRow[]): PaceDay[] {
  const byDate = new Map<string, { units: bigint; pace: bigint; hours: bigint; labor: Cents; missing: boolean }>();
  for (const row of rows) {
    const day = byDate.get(row.workDate) ?? { units: ZERO, pace: ZERO, hours: ZERO, labor: ZERO, missing: false };
    const units = quantityToScaled(row.unitsGood);
    const hours = hoursToScaled(row.hours);
    const confirmed = row.hoursConfirmed !== false;
    day.units += units;
    day.hours += hours;
    day.labor += row.laborCostCents ?? ZERO;
    if (confirmed && row.source !== 'projects') {
      const paceHours = hours - hoursToScaled(row.setupHours ?? 0);
      if (paceHours > ZERO) day.pace += paceHours;
    }
    if (!confirmed && units > ZERO) day.missing = true;
    byDate.set(row.workDate, day);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([workDate, day]) => {
      const counted = day.pace > ZERO && !day.missing;
      return {
        workDate,
        unitsGood: scaledToNumber(day.units, 3),
        paceHours: scaledToNumber(day.pace, 2),
        hours: scaledToNumber(day.hours, 2),
        laborCostCents: day.labor,
        counted,
        evidence: counted && day.units > ZERO,
        missingHours: day.missing,
      };
    });
}

/** Totals of a set of pace days. */
export interface PaceWindow {
  /** Number of days in the window. */
  readonly days: number;
  readonly unitsGood: number;
  readonly paceHours: number;
  /** All labor hours of those days. */
  readonly hours: number;
  readonly laborCostCents: Cents;
  /** Units per person per hour to 3 places, or `null` with no pace hours. */
  readonly uph: number | null;
}

function windowOf(days: readonly PaceDay[]): PaceWindow {
  let units = ZERO;
  let pace = ZERO;
  let hours = ZERO;
  let labor = ZERO;
  for (const day of days) {
    units += toScaled(day.unitsGood, 3);
    pace += toScaled(day.paceHours, 2);
    hours += toScaled(day.hours, 2);
    labor += day.laborCostCents;
  }
  return {
    days: days.length,
    unitsGood: scaledToNumber(units, 3),
    paceHours: scaledToNumber(pace, 2),
    hours: scaledToNumber(hours, 2),
    laborCostCents: labor,
    uph: pace > ZERO ? scaledToNumber(divRound(units * BigInt(100), pace), 3) : null,
  };
}

/** Pace over every counted day of the rows: units on counted days over pace hours on counted days. */
export function paceOverall(days: readonly PaceDay[]): PaceWindow {
  return windowOf(days.filter((day) => day.counted));
}

/** The last `count` evidence days (default 5), the window the projection and the pace rules read. */
export function lastEvidenceWindow(days: readonly PaceDay[], count = 5): PaceWindow {
  const evidence = days.filter((day) => day.evidence);
  return windowOf(evidence.slice(Math.max(0, evidence.length - count)));
}

/** How many evidence days a job has. */
export function evidenceDayCount(days: readonly PaceDay[]): number {
  return days.filter((day) => day.evidence).length;
}

/** How many days have units and no confirmed hours (rule D1). */
export function daysMissingHours(days: readonly PaceDay[]): number {
  return days.filter((day) => day.missingHours).length;
}

/** Units per person per hour to 3 places: units over pace hours. `null` when hours are 0 or less. */
export function unitsPerHour(unitsGood: Decimal, paceHours: Decimal): number | null {
  const hours = hoursToScaled(paceHours);
  if (hours <= ZERO) return null;
  return scaledToNumber(divRound(quantityToScaled(unitsGood) * BigInt(100), hours), 3);
}

/** Pace as a share of the target pace, in basis points: 10000 is right on target. `null` with no target or no pace. */
export function productivityBp(uph: Decimal | null | undefined, targetPace: Decimal | null | undefined): number | null {
  if (uph === null || uph === undefined || uph === '' || targetPace === null || targetPace === undefined || targetPace === '') return null;
  const target = toScaled(targetPace, 3);
  if (target <= ZERO) return null;
  return Number(divRound(toScaled(uph, 3) * BigInt(10000), target));
}

/** Hours the units should have taken at the target pace, to 2 places. `null` with no target. */
export function earnedHours(unitsGood: Decimal, targetPace: Decimal | null | undefined): number | null {
  if (targetPace === null || targetPace === undefined || targetPace === '') return null;
  const target = toScaled(targetPace, 3);
  if (target <= ZERO) return null;
  return scaledToNumber(divRound(quantityToScaled(unitsGood) * BigInt(100), target), 2);
}

/** Labor cost for each good unit, in whole cents. `null` with no units. */
export function laborCostPerUnit(laborCents: Cents, unitsGood: Decimal): Cents | null {
  return perUnitCents(laborCents, unitsGood);
}

/** A target pace row (`pulse.standards`). */
export interface StandardRow {
  readonly id: string;
  readonly jobTypeId?: string | null;
  readonly vasServiceId?: string | null;
  readonly clientId?: string | null;
  readonly laborClassId?: string | null;
  readonly unitsPerLaborHour: Decimal;
  readonly effectiveFrom: IsoDate;
  readonly createdAt?: string | null;
}

export interface StandardQuery {
  /** Match rows of this job type. Set this or `vasServiceId`. */
  readonly jobTypeId?: string | null;
  /** Match rows of this service. */
  readonly vasServiceId?: string | null;
  readonly clientId?: string | null;
  readonly laborClassId?: string | null;
  readonly date: IsoDate;
}

/**
 * The best target pace row for a job or a service on a date. Candidates match the job type (or
 * the service), are dated on or before the date, and have the same client or no client and the
 * same labor class or no class. Order: client match first, then labor class match, then the
 * latest `effectiveFrom`, then the latest `createdAt`, then the smaller id.
 */
export function pickStandard<T extends StandardRow>(rows: readonly T[], query: StandardQuery): T | null {
  const byService = query.vasServiceId !== null && query.vasServiceId !== undefined;
  const candidates = rows.filter((row) => {
    if (row.effectiveFrom > query.date) return false;
    if (byService) {
      if (row.vasServiceId !== query.vasServiceId) return false;
    } else if (!query.jobTypeId || row.jobTypeId !== query.jobTypeId) return false;
    if (row.clientId !== null && row.clientId !== undefined && row.clientId !== query.clientId) return false;
    if (row.laborClassId !== null && row.laborClassId !== undefined && row.laborClassId !== query.laborClassId) return false;
    return true;
  });
  const has = (value: string | null | undefined): number => (value !== null && value !== undefined ? 1 : 0);
  candidates.sort(
    (a, b) =>
      has(b.clientId) - has(a.clientId) ||
      has(b.laborClassId) - has(a.laborClassId) ||
      (a.effectiveFrom === b.effectiveFrom ? 0 : a.effectiveFrom > b.effectiveFrom ? -1 : 1) ||
      ((a.createdAt ?? '') === (b.createdAt ?? '') ? 0 : (a.createdAt ?? '') > (b.createdAt ?? '') ? -1 : 1) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return candidates[0] ?? null;
}

export interface TargetPaceChoice {
  /** Units per person per hour to 3 places, or `null` when there is no target. */
  readonly uph: number | null;
  readonly source: 'job' | 'standard' | 'plan' | 'none';
  readonly standardId: string | null;
}

/**
 * Target pace for a job on a date: the job's own standard, else the best target pace row, else
 * plan units over plan labor hours less setup hours, else none.
 */
export function targetPace(input: { jobStandardUph?: Decimal | null; standards?: readonly StandardRow[]; query?: StandardQuery; plan?: PlanTotals | null }): TargetPaceChoice {
  if (input.jobStandardUph !== null && input.jobStandardUph !== undefined && input.jobStandardUph !== '' && toScaled(input.jobStandardUph, 3) > ZERO) {
    return { uph: scaledToNumber(toScaled(input.jobStandardUph, 3), 3), source: 'job', standardId: null };
  }
  if (input.standards && input.query) {
    const row = pickStandard(input.standards, input.query);
    if (row) return { uph: scaledToNumber(toScaled(row.unitsPerLaborHour, 3), 3), source: 'standard', standardId: row.id };
  }
  if (input.plan && input.plan.units !== null && input.plan.units !== '' && input.plan.laborHours !== null && input.plan.laborHours !== '') {
    const units = quantityToScaled(input.plan.units);
    const paceHours = hoursToScaled(input.plan.laborHours) - hoursToScaled(input.plan.setupHours ?? 0);
    if (units > ZERO && paceHours > ZERO) return { uph: scaledToNumber(divRound(units * BigInt(100), paceHours), 3), source: 'plan', standardId: null };
  }
  return { uph: null, source: 'none', standardId: null };
}

/** Target margin for a job: the job's, else the job type's, else the client's, else the org default (30%). */
export function targetMarginBp(chain: { job?: number | null; jobType?: number | null; client?: number | null; orgDefault?: number | null }): number {
  return chain.job ?? chain.jobType ?? chain.client ?? chain.orgDefault ?? 3000;
}
