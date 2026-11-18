/**
 * Pure helpers for the Log work grids: turning what a person typed into the numbers the server
 * stores, reading a block pasted from a spreadsheet, and the live readout of a row. Pace and
 * money always come from `@/lib/profit` and `@/lib/money`; nothing here invents a formula.
 */
import { centsToNumber, toCents } from '@/lib/money';
import {
  crewHoursCheck,
  laborHoursFromCrew,
  productivityBp,
  profitSummary,
  unitsPerHour,
} from '@/lib/profit';
import type { LogGridRowDTO, ProductionEntryDTO } from '@/lib/types';

/** The cells a person can type in, in keyboard order. */
export const LINE_FIELDS = [
  'unitsGood',
  'unitsScrap',
  'unitsRework',
  'people',
  'hoursEach',
  'hours',
  'overtime',
  'note',
] as const;
export type LineField = (typeof LINE_FIELDS)[number];

export interface LineValues {
  unitsGood: string;
  unitsScrap: string;
  unitsRework: string;
  people: string;
  hoursEach: string;
  /** Labor hours: people times hours each, unless typed over. */
  hours: string;
  overtime: string;
  setup: string;
  note: string;
  laborClassId: string | null;
}

export const EMPTY_VALUES: LineValues = {
  unitsGood: '',
  unitsScrap: '',
  unitsRework: '',
  people: '',
  hoursEach: '',
  hours: '',
  overtime: '',
  setup: '',
  note: '',
  laborClassId: null,
};

/** "1,250" or " 12.50 " to a plain number. Empty text is 0. Returns null for text that is not a number of 0 or more. */
export function parseTyped(text: string | null | undefined): number | null {
  const cleaned = (text ?? '').replace(/[,\s]/g, '');
  if (cleaned === '') return 0;
  if (!/^\d*\.?\d*$/.test(cleaned) || cleaned === '.') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** A stored decimal string as the shortest text a person would type: "12.00" is "12", "0.000" is "". */
export function tidy(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '';
  return String(Math.round(n * 1000) / 1000);
}

/** Hours each, worked back from labor hours and people (2 places). Empty when either is missing. */
export function hoursEachFrom(
  hours: string | number | null | undefined,
  people: string | number | null | undefined,
): string {
  const h = Number(hours ?? 0);
  const p = Number(people ?? 0);
  if (!(h > 0) || !(p > 0)) return '';
  return String(Math.round((h / p) * 100) / 100);
}

/** The values of a saved entry as typed text. */
export function valuesFromEntry(entry: ProductionEntryDTO): LineValues {
  return {
    unitsGood: tidy(entry.unitsGood),
    unitsScrap: tidy(entry.unitsScrap),
    unitsRework: tidy(entry.unitsRework),
    people: tidy(entry.headcount),
    hoursEach: hoursEachFrom(entry.hours, entry.headcount),
    hours: tidy(entry.hours),
    overtime: tidy(entry.overtimeHours),
    setup: tidy(entry.setupHours),
    note: entry.note ?? '',
    laborClassId: entry.laborClassId,
  };
}

/**
 * Applies one typed cell. Typing people or hours each fills labor hours (people times hours
 * each); typing labor hours keeps it and works hours each back out, so an uneven crew can be typed.
 */
export function applyField(values: LineValues, field: LineField | 'setup', text: string): LineValues {
  const next = { ...values, [field]: text };
  if (field === 'people' || field === 'hoursEach') {
    const people = parseTyped(next.people);
    const each = parseTyped(next.hoursEach);
    if (people !== null && each !== null && people > 0 && each > 0)
      next.hours = tidy(laborHoursFromCrew(people, each));
    else if ((people === 0 || each === 0) && field === 'hoursEach' && text.trim() === '')
      next.hours = values.hours;
  }
  if (field === 'hours') {
    const people = parseTyped(next.people);
    const hours = parseTyped(next.hours);
    if (people !== null && hours !== null && people > 0) next.hoursEach = hoursEachFrom(hours, people);
  }
  return next;
}

/** The first thing wrong with a line in plain words, or null when it can be saved. */
export function lineProblem(values: LineValues): string | null {
  const labels: Record<string, string> = {
    unitsGood: 'Units',
    unitsScrap: 'Scrap',
    unitsRework: 'Rework',
    people: 'People',
    hoursEach: 'Hours each',
    hours: 'Labor hours',
    overtime: 'Overtime',
    setup: 'Setup hours',
  };
  for (const [field, label] of Object.entries(labels)) {
    if (parseTyped(values[field as keyof LineValues] as string) === null)
      return `${label} must be a number of 0 or more.`;
  }
  // The same ceilings the server keeps, said in plain words before the row is sent.
  for (const field of ['unitsGood', 'unitsScrap', 'unitsRework'] as const) {
    if ((parseTyped(values[field]) ?? 0) >= 100_000_000)
      return `${labels[field]} is too big. Type a number under 100,000,000.`;
  }
  if ((parseTyped(values.people) ?? 0) >= 10_000) return 'People is too big. Type a number under 10,000.';
  const hours = parseTyped(values.hours) ?? 0;
  if (hours >= 100_000_000) return 'Labor hours is too big. Check people and hours each.';
  if ((parseTyped(values.overtime) ?? 0) > hours) return 'Overtime cannot be more than the labor hours.';
  if ((parseTyped(values.setup) ?? 0) > hours) return 'Setup hours cannot be more than the labor hours.';
  if ((parseTyped(values.hoursEach) ?? 0) > 24) return 'Hours each cannot be more than 24.';
  return null;
}

export const isBlank = (values: LineValues): boolean =>
  ['unitsGood', 'unitsScrap', 'unitsRework', 'people', 'hours', 'overtime', 'setup'].every(
    (field) => (parseTyped(values[field as keyof LineValues] as string) ?? 0) === 0,
  ) && values.note.trim() === '';

export const sameValues = (a: LineValues, b: LineValues): boolean =>
  a.laborClassId === b.laborClassId &&
  a.note.trim() === b.note.trim() &&
  (['unitsGood', 'unitsScrap', 'unitsRework', 'people', 'hours', 'overtime', 'setup'] as const).every(
    (field) => (parseTyped(a[field]) ?? -1) === (parseTyped(b[field]) ?? -1),
  );

const fixed = (text: string, places: number): string => (parseTyped(text) ?? 0).toFixed(places);

/** The body the server takes for one line. */
export function toPayload(values: LineValues): {
  unitsGood: string;
  unitsScrap: string;
  unitsRework: string;
  headcount: string | null;
  hours: string;
  overtimeHours: string;
  setupHours: string;
  note: string | null;
  laborClassId: string | null;
} {
  const people = parseTyped(values.people) ?? 0;
  return {
    unitsGood: fixed(values.unitsGood, 3),
    unitsScrap: fixed(values.unitsScrap, 3),
    unitsRework: fixed(values.unitsRework, 3),
    headcount: people > 0 ? people.toFixed(2) : null,
    hours: fixed(values.hours, 2),
    overtimeHours: fixed(values.overtime, 2),
    setupHours: fixed(values.setup, 2),
    note: values.note.trim() === '' ? null : values.note.trim(),
    laborClassId: values.laborClassId,
  };
}

/**
 * The "Is that right?" question of SPEC 4.4, or null. The rule fires when labor hours are far
 * from people times a full shift. A short run with an honest hours each (3 people for 2 hours) is
 * normal, so the question is only asked when the hours each that comes out is under 1 or over 16:
 * the mark of labor hours typed where hours each was meant, or the other way around.
 *
 * The words use the numbers that are in the row right now. Typing labor hours works hours each
 * back out, so the question names that hours each, never one the grid has already replaced.
 */
export function crewQuestion(values: LineValues, shiftHours: string): string | null {
  const hours = parseTyped(values.hours);
  const people = parseTyped(values.people);
  if (hours === null || people === null || hours === 0 || people === 0) return null;
  const each = hours / people;
  if (each >= 1 && each <= 16) return null;
  const check = crewHoursCheck({ hours, people, shiftHours });
  if (!check) return null;
  const count = (value: number, one: string, many: string): string => `${tidy(value) || '0'} ${value === 1 ? one : many}`;
  const eachText = hoursEachFrom(hours, people) || '0';
  return `${count(hours, 'labor hour', 'labor hours')} for ${count(people, 'person', 'people')} is ${eachText} ${eachText === '1' ? 'hour' : 'hours'} each. A full shift of ${count(check.shiftHours, 'hour', 'hours')} each would be ${count(check.expectedHours, 'labor hour', 'labor hours')}. Is that right?`;
}

/**
 * What to say on a job that has units and no labor hours: the field that is still empty, by name.
 * People typed and no hours each asks for the hours each, and the other way around.
 */
export function missingLaborWords(lines: readonly Pick<LineValues, 'people' | 'hoursEach'>[]): string {
  const has = (field: 'people' | 'hoursEach'): boolean => lines.some((line) => (parseTyped(line[field]) ?? 0) > 0);
  const people = has('people');
  const each = has('hoursEach');
  if (people && !each) return 'Add the hours each';
  if (each && !people) return 'Add people';
  return 'Add people and the hours each';
}

/* ---------------------------------------------------------------- paste */

/** A block copied from a spreadsheet: rows of cells. Handles tabs, Windows line ends and quoted cells. */
export function parsePasted(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const body = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === '\t') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.trim());
      out.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell.trim());
    out.push(row);
  }
  return out.filter((cells) => cells.some((value) => value !== ''));
}

export const isBlockPaste = (text: string): boolean => /[\t\n]/.test(text.replace(/[\r\n]+$/, ''));

/** Column order when the first pasted column holds job numbers. */
export const JOB_PASTE_FIELDS: readonly LineField[] = ['unitsGood', 'people', 'hoursEach', 'note'];

export interface PasteTarget {
  readonly key: string;
  readonly jobNumber: string;
}

export interface PasteResult {
  /** Line key to the cells to set. */
  readonly changes: ReadonlyMap<string, Partial<Record<LineField, string>>>;
  /** Pasted rows that did not fit (no such job, or past the last row). */
  readonly skipped: number;
  readonly byJob: boolean;
}

/**
 * Lays a pasted block over the grid. When every row starts with a job number that is on the grid,
 * rows go to their job (then units, people, hours each, note). Otherwise the block is laid down
 * from the cell that has focus, to the right and down, like a spreadsheet.
 */
export function planPaste(
  block: readonly (readonly string[])[],
  lines: readonly PasteTarget[],
  startKey: string,
  startField: LineField,
): PasteResult {
  const changes = new Map<string, Partial<Record<LineField, string>>>();
  let skipped = 0;
  const byNumber = new Map(lines.map((line) => [line.jobNumber.toLowerCase(), line.key]));
  const rowsWithJob = block.filter((cells) => byNumber.has((cells[0] ?? '').toLowerCase()));
  const byJob =
    block.length > 0 &&
    rowsWithJob.length >= Math.max(1, block.length - 1) &&
    block.some((cells) => cells.length > 1);
  if (byJob) {
    for (const cells of block) {
      const key = byNumber.get((cells[0] ?? '').toLowerCase());
      if (!key) {
        // A header row ("Job, Units, People") is not a miss.
        if (cells.slice(1).every((value) => parseTyped(value) === null || value === '')) continue;
        skipped += 1;
        continue;
      }
      const patch: Partial<Record<LineField, string>> = {};
      cells.slice(1, 1 + JOB_PASTE_FIELDS.length).forEach((value, index) => {
        if (value !== '') patch[JOB_PASTE_FIELDS[index]!] = value;
      });
      changes.set(key, { ...(changes.get(key) ?? {}), ...patch });
    }
    return { changes, skipped, byJob };
  }
  const startRow = lines.findIndex((line) => line.key === startKey);
  const startCol = LINE_FIELDS.indexOf(startField);
  if (startRow < 0 || startCol < 0) return { changes, skipped: block.length, byJob };
  block.forEach((cells, r) => {
    const line = lines[startRow + r];
    if (!line) {
      skipped += 1;
      return;
    }
    const patch: Partial<Record<LineField, string>> = {};
    cells.forEach((value, c) => {
      const field = LINE_FIELDS[startCol + c];
      if (field && value !== '') patch[field] = value;
    });
    changes.set(line.key, patch);
  });
  return { changes, skipped, byJob };
}

/* ---------------------------------------------------------------- readout */

export type PaceTone = 'good' | 'watch' | 'bad' | 'none';

export interface RowReadout {
  readonly units: number;
  readonly hours: number;
  readonly paceHours: number;
  readonly uph: number | null;
  readonly targetUph: number | null;
  readonly productivityBp: number | null;
  readonly tone: PaceTone;
  /** Units the usual crew makes in one shift at the target pace, when both are known. */
  readonly goalUnits: number | null;
}

export interface PaceThresholds {
  /** At or above this share of the target pace a row is a heads up, not a problem (basis points). */
  readonly watchBp: number;
  readonly riskBp: number;
}

export const DEFAULT_PACE_THRESHOLDS: PaceThresholds = { watchBp: 9000, riskBp: 7500 };

export function paceTone(bp: number | null, thresholds: PaceThresholds = DEFAULT_PACE_THRESHOLDS): PaceTone {
  if (bp === null) return 'none';
  if (bp >= thresholds.watchBp) return 'good';
  return bp >= thresholds.riskBp ? 'watch' : 'bad';
}

/** Units the usual crew should finish in one shift at the target pace. */
export function dailyGoal(
  row: Pick<LogGridRowDTO, 'usualCrew' | 'targetUph'>,
  shiftHours: string,
): number | null {
  const people = row.usualCrew.reduce((total, line) => total + Number(line.headcount ?? 0), 0);
  const target = Number(row.targetUph ?? 0);
  const shift = Number(shiftHours);
  if (!(people > 0) || !(target > 0) || !(shift > 0)) return null;
  return Math.round(people * shift * target);
}

/** The live pace readout of one job for the day, from what is typed in its lines right now. */
export function rowReadout(
  row: Pick<LogGridRowDTO, 'usualCrew' | 'targetUph'>,
  lines: readonly LineValues[],
  shiftHours: string,
  thresholds?: PaceThresholds,
): RowReadout {
  let units = 0;
  let hours = 0;
  let setup = 0;
  for (const line of lines) {
    units += parseTyped(line.unitsGood) ?? 0;
    hours += parseTyped(line.hours) ?? 0;
    setup += Math.min(parseTyped(line.setup) ?? 0, parseTyped(line.hours) ?? 0);
  }
  const paceHours = Math.max(hours - setup, 0);
  const uph = units > 0 ? unitsPerHour(units.toFixed(3), paceHours.toFixed(2)) : null;
  const target = row.targetUph ? Number(row.targetUph) : null;
  const bp = uph === null ? null : productivityBp(uph, row.targetUph);
  return {
    units,
    hours,
    paceHours,
    uph,
    targetUph: target,
    productivityBp: bp,
    tone: paceTone(bp, thresholds),
    goalUnits: dailyGoal(row, shiftHours),
  };
}

export interface MoneyReadout {
  readonly revenueCents: number;
  readonly laborCents: number;
  readonly materialCents: number;
  readonly sharedCents: number;
  readonly costCents: number;
  readonly profitCents: number;
  readonly marginBp: number | null;
  readonly laborPerUnitCents: number | null;
  readonly rateCents: number | null;
}

/** Today's money for a set of saved entries, or null when money is hidden from this reader. */
export function moneyReadout(entries: readonly ProductionEntryDTO[]): MoneyReadout | null {
  if (entries.length === 0)
    return {
      revenueCents: 0,
      laborCents: 0,
      materialCents: 0,
      sharedCents: 0,
      costCents: 0,
      profitCents: 0,
      marginBp: null,
      laborPerUnitCents: null,
      rateCents: null,
    };
  if (
    entries.some(
      (entry) => entry.moneyHidden || entry.laborCostCents === null || entry.baseRevenueCents === null,
    )
  )
    return null;
  const sum = (pick: (entry: ProductionEntryDTO) => number | null): bigint =>
    entries.reduce((total, entry) => total + toCents(pick(entry) ?? 0), BigInt(0));
  const units = entries.reduce((total, entry) => total + Number(entry.unitsGood), 0);
  const summary = profitSummary(
    {
      revenueCents: sum((e) => e.baseRevenueCents),
      laborCents: sum((e) => e.laborCostCents),
      materialCents: sum((e) => e.stdMaterialCents),
      otherCents: BigInt(0),
      sharedCents: sum((e) => e.sharedCents),
    },
    units.toFixed(3),
  );
  return {
    revenueCents: centsToNumber(summary.revenueCents),
    laborCents: centsToNumber(summary.laborCents),
    materialCents: centsToNumber(summary.materialCents),
    sharedCents: centsToNumber(summary.sharedCents),
    costCents: centsToNumber(summary.costCents),
    profitCents: centsToNumber(summary.profitCents),
    marginBp: summary.marginBp,
    laborPerUnitCents:
      summary.laborCostPerUnitCents === null ? null : centsToNumber(summary.laborCostPerUnitCents),
    rateCents: entries.find((entry) => entry.rateCents !== null)?.rateCents ?? null,
  };
}
