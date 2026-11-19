/**
 * The Work log shows one line per day. A day can hold several labor types (one entry each in the
 * database), so this rolls those entries up into one day, and turns the day form back into the
 * lines of one whole day save.
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

/** A row with nothing on it: no units, no hours, no people, no note. Clearing a row used to leave one behind. */
export function isEmptyEntry(row: ProductionEntryDTO): boolean {
  return (
    Number(row.unitsGood) === 0 &&
    Number(row.unitsScrap) === 0 &&
    Number(row.unitsRework) === 0 &&
    Number(row.hours) === 0 &&
    Number(row.headcount ?? 0) === 0 &&
    !(row.note ?? '').trim()
  );
}

/** One labor class line on the day form, already checked and turned into decimal strings. */
export interface LaborLineInput {
  readonly id: string | null;
  readonly laborClassId: string | null;
  readonly headcount: string | null;
  readonly hours: string;
  readonly setupHours: string;
  readonly overtimeHours: string;
}

/** One line of the body of `PUT /api/v1/log/days`. */
export interface DayLinePayload {
  readonly id?: string | null;
  readonly laborClassId: string | null;
  readonly shift?: string | null;
  readonly unitsGood: string;
  readonly unitsScrap: string;
  readonly unitsRework?: string;
  readonly headcount: string | null;
  readonly hours: string;
  readonly setupHours: string;
  readonly overtimeHours: string;
  readonly hoursConfirmed?: boolean;
  readonly note: string | null;
}

/**
 * Turns the day form into the lines to save. The day's units and note sit on the first labor line
 * and the other lines carry hours only, so the day still adds up to the same units. Lines that
 * were on the day before and are not sent are taken off by the server in the same save.
 */
export function planDayLines(input: {
  readonly unitsGood: string;
  readonly unitsScrap: string;
  /** Rework is not on the form. What the day held stays on the first line. */
  readonly unitsRework?: string;
  readonly note: string | null;
  readonly lines: readonly LaborLineInput[];
}): DayLinePayload[] {
  return input.lines.map((line, index) => ({
    id: line.id,
    laborClassId: line.laborClassId,
    unitsGood: index === 0 ? input.unitsGood : '0',
    unitsScrap: index === 0 ? input.unitsScrap : '0',
    unitsRework: index === 0 ? (input.unitsRework ?? '0') : '0',
    headcount: line.headcount,
    hours: line.hours,
    setupHours: line.setupHours,
    overtimeHours: line.overtimeHours,
    hoursConfirmed: true,
    note: index === 0 ? input.note : null,
  }));
}

/** The lines that put a day back exactly as it was read (Undo of an edit). Rows that are gone come back as new lines. */
export function restoreDayLines(before: readonly ProductionEntryDTO[], liveIds: ReadonlySet<string>): DayLinePayload[] {
  return before.map((row) => ({
    id: liveIds.has(row.id) ? row.id : null,
    laborClassId: row.laborClassId,
    shift: row.shift,
    unitsGood: row.unitsGood,
    unitsScrap: row.unitsScrap,
    unitsRework: row.unitsRework,
    headcount: row.headcount,
    hours: row.hours,
    setupHours: row.setupHours,
    overtimeHours: row.overtimeHours,
    hoursConfirmed: row.hoursConfirmed,
    note: row.note,
  }));
}

/** The index of every line whose labor class is on more than one line. One day holds one entry per labor class. */
export function repeatedLaborLines(lines: readonly Pick<LaborLineInput, 'laborClassId'>[]): number[] {
  const count = new Map<string, number>();
  for (const line of lines) count.set(line.laborClassId ?? '', (count.get(line.laborClassId ?? '') ?? 0) + 1);
  return lines.flatMap((line, index) => ((count.get(line.laborClassId ?? '') ?? 0) > 1 ? [index] : []));
}

export interface DaySaveBody {
  readonly jobId: string;
  readonly workDate: string;
  readonly mode: 'create' | 'edit';
  readonly fromDate?: string | null;
  readonly read?: readonly { id: string; version: number }[];
  readonly lines: readonly DayLinePayload[];
}

export type DaySaveResult =
  | { readonly ok: true; readonly entries: ProductionEntryDTO[]; readonly created: number; readonly updated: number; readonly removed: ProductionEntryDTO[] }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      readonly fields: Readonly<Record<string, string>>;
      /** Set on a 409: the day already has work ("day_exists") or someone changed it ("stale"). */
      readonly reason: 'day_exists' | 'stale' | null;
      readonly workDate: string | null;
      /** The day as it is now. */
      readonly fresh: ProductionEntryDTO[];
    };

interface DaySaveWire {
  data?: { entries: ProductionEntryDTO[]; created: number; updated: number; removed: ProductionEntryDTO[] };
  error?: { code: string; message: string; fields?: Record<string, string>; reason?: 'day_exists' | 'stale'; workDate?: string; fresh?: ProductionEntryDTO[] };
}

/** Saves a whole day through `PUT /api/v1/log/days`. A 409 comes back with the day as it is now. */
export async function saveDay(body: DaySaveBody): Promise<DaySaveResult> {
  const failed = (code: string, message: string): DaySaveResult => ({ ok: false, code, message, fields: {}, reason: null, workDate: null, fresh: [] });
  let response: Response;
  try {
    response = await fetch('/api/v1/log/days', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    return failed('NETWORK_ERROR', 'Check your connection and try again.');
  }
  let payload: DaySaveWire | null = null;
  try {
    payload = (await response.json()) as DaySaveWire;
  } catch {
    payload = null;
  }
  if (response.ok && payload?.data) return { ok: true, ...payload.data };
  const error = payload?.error;
  if (!error) return failed('INTERNAL', 'Something went wrong on our side. Please try again.');
  return { ok: false, code: error.code, message: error.message, fields: error.fields ?? {}, reason: error.reason ?? null, workDate: error.workDate ?? null, fresh: error.fresh ?? [] };
}
