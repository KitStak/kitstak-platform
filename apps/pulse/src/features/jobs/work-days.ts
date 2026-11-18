/**
 * The Work log shows one line per day. A day can hold several labor types (one entry each in the
 * database), so this rolls those entries up into one day, and turns the day form back into the
 * entries to save and the ones to remove.
 */
import {
  fromScaled,
  HEADCOUNT_SCALE,
  HOURS_SCALE,
  hoursToScaled,
  perHourCents,
  QUANTITY_SCALE,
  quantityToScaled,
  sumBy,
  toScaled,
  ZERO,
} from '@/lib/money';
import type { ProductionEntryDTO } from '@/lib/types';
import type { SaveProductionActionInput } from '@/server/actions/log';
import { rowPace } from './job-math';

export interface WorkDay {
  readonly workDate: string;
  readonly rows: readonly ProductionEntryDTO[];
  readonly unitsGood: string;
  readonly unitsScrap: string;
  readonly headcount: string | null;
  readonly hours: string;
  readonly setupHours: string;
  readonly overtimeHours: string;
  readonly hoursConfirmed: boolean;
  /** Labor cost of the day, or null when no entry has a cost (money hidden). */
  readonly laborCostCents: number | null;
  /** Blended cost of an hour: labor cost over labor hours. */
  readonly rateCents: number | null;
  readonly needsRate: boolean;
  readonly locked: boolean;
  readonly pace: number | null;
  readonly notes: readonly string[];
  readonly laborClassIds: readonly (string | null)[];
  readonly sources: readonly string[];
}

const sumScaled = (values: readonly string[], scale: number): string =>
  fromScaled(
    values.reduce((total, value) => total + toScaled(value, scale), ZERO),
    scale,
  );

function rollUp(workDate: string, rows: readonly ProductionEntryDTO[]): WorkDay {
  const hours = fromScaled(rows.reduce((total, row) => total + hoursToScaled(row.hours), ZERO), HOURS_SCALE);
  const setupHours = fromScaled(rows.reduce((total, row) => total + hoursToScaled(row.setupHours), ZERO), HOURS_SCALE);
  const people = rows.map((row) => row.headcount).filter((value): value is string => value !== null);
  const costs = rows.map((row) => row.laborCostCents).filter((value): value is number => value !== null);
  const laborCost = costs.length > 0 ? sumBy(costs, (value) => value) : null;
  const rate = laborCost !== null && Number(hours) > 0 ? perHourCents(laborCost, hours) : null;
  const hoursConfirmed = rows.every((row) => row.hoursConfirmed);
  const unitsGood = fromScaled(rows.reduce((total, row) => total + quantityToScaled(row.unitsGood), ZERO), QUANTITY_SCALE);
  return {
    workDate,
    rows,
    unitsGood,
    unitsScrap: sumScaled(rows.map((row) => row.unitsScrap), QUANTITY_SCALE),
    headcount: people.length > 0 ? sumScaled(people, HEADCOUNT_SCALE) : null,
    hours,
    setupHours,
    overtimeHours: sumScaled(rows.map((row) => row.overtimeHours), HOURS_SCALE),
    hoursConfirmed,
    laborCostCents: laborCost === null ? null : Number(laborCost),
    rateCents: rate === null ? null : Number(rate),
    needsRate: rows.some((row) => row.needsRate),
    locked: rows.some((row) => row.locked),
    pace: rowPace({ unitsGood, hours, setupHours, hoursConfirmed }),
    notes: rows.map((row) => row.note).filter((note): note is string => Boolean(note && note.trim())),
    laborClassIds: rows.map((row) => row.laborClassId),
    sources: [...new Set(rows.map((row) => row.source))],
  };
}

/** Groups entries by day, keeping the order the days first appear in (newest first from the API). */
export function groupWorkDays(rows: readonly ProductionEntryDTO[]): WorkDay[] {
  const byDate = new Map<string, ProductionEntryDTO[]>();
  for (const row of rows) {
    const list = byDate.get(row.workDate);
    if (list) list.push(row);
    else byDate.set(row.workDate, [row]);
  }
  return [...byDate.entries()].map(([workDate, list]) => rollUp(workDate, list));
}

/** One labor type line on the day form, already checked and turned into decimal strings. */
export interface LaborLineInput {
  readonly id: string | null;
  readonly version?: number;
  readonly laborClassId: string | null;
  readonly headcount: string | null;
  readonly hours: string;
  readonly setupHours: string;
  readonly overtimeHours: string;
}

export interface DayPlan {
  readonly entries: SaveProductionActionInput[];
  readonly removeIds: string[];
}

/**
 * Turns the day form into entries to save. The day's units and note sit on the first labor line
 * and the other lines carry hours only, so the day still adds up to the same units. Lines that
 * were on the day before and are gone now come back as ids to remove.
 */
export function planDaySave(input: {
  readonly jobId: string;
  readonly workDate: string;
  readonly unitsGood: string;
  readonly unitsScrap: string;
  readonly note: string | null;
  readonly lines: readonly LaborLineInput[];
  readonly existingIds: readonly string[];
}): DayPlan {
  const entries = input.lines.map((line, index) => ({
    id: line.id,
    jobId: input.jobId,
    workDate: input.workDate,
    laborClassId: line.laborClassId,
    unitsGood: index === 0 ? input.unitsGood : '0',
    unitsScrap: index === 0 ? input.unitsScrap : '0',
    headcount: line.headcount,
    hours: line.hours,
    setupHours: line.setupHours,
    overtimeHours: line.overtimeHours,
    hoursConfirmed: true,
    note: index === 0 ? input.note : null,
    ...(line.id && line.version !== undefined ? { version: line.version } : {}),
  }));
  const kept = new Set(input.lines.map((line) => line.id).filter(Boolean));
  return { entries, removeIds: input.existingIds.filter((id) => !kept.has(id)) };
}

/** The labor type picked on more than one line, if any. One day holds one entry per labor type. */
export function repeatedLaborClass(lines: readonly Pick<LaborLineInput, 'laborClassId'>[]): string | null {
  const seen = new Set<string>();
  for (const line of lines) {
    const key = line.laborClassId ?? '';
    if (seen.has(key)) return key;
    seen.add(key);
  }
  return null;
}
