/**
 * "Latest work" on the job overview: one row per day. A day can have several lines (the crew and
 * the line lead, two shifts), and a reader thinks in days, so the lines are added together.
 * Units and hours use exact scaled integers, labor cost uses integer cents.
 */
import { HOURS_SCALE, QUANTITY_SCALE, fromScaled, hoursToScaled, quantityToScaled } from '@/lib/money';
import type { ProductionEntryDTO } from '@/lib/types';

export interface LatestWorkDay {
  /** The day itself, so it is unique within the list. */
  readonly id: string;
  readonly workDate: string;
  readonly unitsGood: string;
  readonly hours: string;
  readonly setupHours: string;
  /** False when any line that day still waits for hours. */
  readonly hoursConfirmed: boolean;
  /** Null when any line hides its cost from this reader. */
  readonly laborCostCents: number | null;
  /** How many lines were added together. */
  readonly lines: number;
}

type WorkLine = Pick<
  ProductionEntryDTO,
  'workDate' | 'unitsGood' | 'hours' | 'setupHours' | 'hoursConfirmed' | 'laborCostCents' | 'deletedAt'
>;

interface Running {
  units: bigint;
  hours: bigint;
  setup: bigint;
  confirmed: boolean;
  cost: bigint | null;
  lines: number;
}

const DEFAULT_DAYS = 7;

export function latestWorkByDay(rows: readonly WorkLine[], days = DEFAULT_DAYS): LatestWorkDay[] {
  const byDay = new Map<string, Running>();
  for (const row of rows) {
    if (row.deletedAt !== null) continue;
    const day = byDay.get(row.workDate) ?? { units: BigInt(0), hours: BigInt(0), setup: BigInt(0), confirmed: true, cost: BigInt(0), lines: 0 };
    byDay.set(row.workDate, {
      units: day.units + quantityToScaled(row.unitsGood),
      hours: day.hours + hoursToScaled(row.hours),
      setup: day.setup + hoursToScaled(row.setupHours),
      confirmed: day.confirmed && row.hoursConfirmed,
      cost: day.cost === null || row.laborCostCents === null ? null : day.cost + BigInt(row.laborCostCents),
      lines: day.lines + 1,
    });
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .slice(0, days)
    .map(([workDate, day]) => ({
      id: workDate,
      workDate,
      unitsGood: fromScaled(day.units, QUANTITY_SCALE),
      hours: fromScaled(day.hours, HOURS_SCALE),
      setupHours: fromScaled(day.setup, HOURS_SCALE),
      hoursConfirmed: day.confirmed,
      laborCostCents: day.cost === null ? null : Number(day.cost),
      lines: day.lines,
    }));
}
