/**
 * Imports (docs/programs/SPEC.md 3.9): a pasted plan grid, a plan CSV and an output CSV, each
 * read against the program's variants. Pure: every line that cannot be read is reported with a
 * plain reason, nothing is guessed silently.
 */
import { isRealDate, weekday, weekdayName } from './calendar';
import { fromScaled, quantityToScaled } from './money';
import type { IsoDate } from './types';
import { type ExpectedCells, type SheetDelimiter, anyDelimiter, extraCellsMessage, filledWidth, plainNumber, readQtyCell, splitCells, textLines } from './variants';

export interface VariantMatch {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly sku: string | null;
}

export interface Unmatched {
  readonly line: number;
  readonly raw: string;
  readonly why: string;
}

function squash(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '');
}

/** The variant a token names: exact SKU, then key, then name (case and space insensitive). */
export function matchVariant(token: string, variants: readonly VariantMatch[]): VariantMatch | null {
  const want = squash(token);
  if (want === '') return null;
  return (
    variants.find((variant) => variant.sku !== null && squash(variant.sku) === want) ??
    variants.find((variant) => squash(variant.key) === want) ??
    variants.find((variant) => squash(variant.name) === want) ??
    null
  );
}

/** "No variant has the SKU GLOVE-XXL-RED." or "No variant is called Small Red." */
export function noVariantMessage(token: string): string {
  const text = token.trim();
  return /\s/.test(text) ? `No variant is called ${text}.` : `No variant has the SKU ${text}.`;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_WORDS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_WORD = /^(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(day|nesday|rsday|urday|sday)?\.?,?\s+/i;
const SLASH_DATE = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/;

/**
 * How a slash date such as `02/11/2026` is read: `month_first` (US, Feb 11) or `day_first`
 * (Nov 2). ISO dates (`2026-02-11`) and month words (`Feb 11`) are never in doubt.
 */
export type DateOrder = 'month_first' | 'day_first';

/** Something the reader decided for the whole file that people should check before saving. */
export interface ImportNote {
  /**
   * `dates_ambiguous`: slash dates could be read two ways and nothing in the file settled it;
   * they were read month first, and the review step should ask (pass `dateOrder` to read again).
   * `dates_mixed`: some slash dates only work month first and others only day first.
   * `header_guessed`: line 1 was not a header this knows, so it was read as one and the columns
   * were found from the data.
   */
  readonly code: 'dates_ambiguous' | 'dates_mixed' | 'header_guessed';
  readonly line: number | null;
  readonly text: string;
}

/** What every reader returns besides its rows. */
export interface ImportReport {
  readonly unmatched: readonly Unmatched[];
  readonly notes: readonly ImportNote[];
  /** The order slash dates were read in. */
  readonly dateOrder: DateOrder;
  /** True when slash dates could mean two days and the caller did not pass `dateOrder`: ask before saving. */
  readonly dateOrderNeeded: boolean;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function realOrNull(year: number, month: number, day: number): IsoDate | null {
  const iso = `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
  return isRealDate(iso) ? iso : null;
}

interface DateParts {
  readonly year: number | null;
  readonly month: number;
  readonly day: number;
}

function stripWeekday(cell: string): string {
  return cell.trim().replace(WEEKDAY_WORD, '').trim();
}

const WEEKDAY_NUMBERS: Readonly<Record<string, number>> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/** The weekday a cell names before its date (`Tue Nov 30` gives 2), or null when it names none. */
function typedWeekday(cell: string): number | null {
  const match = WEEKDAY_WORD.exec(cell.trim());
  if (!match) return null;
  return WEEKDAY_NUMBERS[(match[1] as string).slice(0, 3).toLowerCase()] ?? null;
}

const WEEKDAY_WORDS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The parts of a date cell, or null when it does not look like a date at all. */
function dateParts(cell: string, order: DateOrder = 'month_first'): DateParts | null {
  const text = stripWeekday(cell);
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match) return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  match = SLASH_DATE.exec(text);
  if (match) {
    const year = match[3] ? (match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])) : null;
    const a = Number(match[1]);
    const b = Number(match[2]);
    return order === 'day_first' ? { year, month: b, day: a } : { year, month: a, day: b };
  }
  match = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/i.exec(text);
  if (match) {
    const index = MONTHS.indexOf((match[1] as string).slice(0, 3).toLowerCase());
    if (index < 0) return null;
    return { year: match[3] ? Number(match[3]) : null, month: index + 1, day: Number(match[2]) };
  }
  return null;
}

/** True when a cell is a real date in either order, even one outside the planning days. */
function readsAsDate(cell: string, order: DateOrder = 'month_first'): boolean {
  const parts = dateParts(cell, order);
  if (!parts) return false;
  return realOrNull(parts.year ?? 2000, parts.month, parts.day) !== null;
}

function looksLikeAnyDate(cell: string): boolean {
  return readsAsDate(cell, 'month_first') || readsAsDate(cell, 'day_first');
}

/** A date cell read by its date alone (any weekday word is ignored). */
function resolveDate(cell: string, dates: readonly IsoDate[] | undefined, order: DateOrder): IsoDate | null {
  const parts = dateParts(cell, order);
  if (!parts) return null;
  if (parts.year !== null) {
    const iso = realOrNull(parts.year, parts.month, parts.day);
    if (!iso) return null;
    if (dates && !dates.includes(iso)) return null;
    return iso;
  }
  if (!dates) return null;
  const tail = `-${pad(parts.month)}-${pad(parts.day)}`;
  return dates.find((date) => date.endsWith(tail)) ?? null;
}

/**
 * Reads a date cell: `2026-11-30`, `11/30/2026`, `11/30/26`, `11/30`, `Nov 30`, `Mon Nov 30`,
 * `Nov 30 2026` or `November 30, 2026`. Slash dates are read in `order` (month first unless
 * told). A date without a year is found among `dates` by month and day; with no `dates` it cannot
 * be read. With `dates`, a date outside them is not read. A weekday word that does not match the
 * date (`Tue Nov 30` when Nov 30 is a Monday) is not read either, since it is not clear which day
 * was meant (`dateCellProblem` says why).
 */
export function parseDateCell(cell: string, dates?: readonly IsoDate[], order: DateOrder = 'month_first'): IsoDate | null {
  const iso = resolveDate(cell, dates, order);
  if (iso === null) return null;
  const typed = typedWeekday(cell);
  return typed === null || typed === weekday(iso) ? iso : null;
}

/**
 * Why a date cell cannot be used, as UI copy, or null when `parseDateCell` reads it:
 * "Nov 30 is a Monday, not a Tuesday.", "Dec 5 is outside the days you are planning.",
 * "Nov 30 has no year. Use dates like 2026-11-30." or "2026-02-30 is not a real date. Use dates
 * like 2026-11-30."
 */
export function dateCellProblem(cell: string, dates?: readonly IsoDate[], order: DateOrder = 'month_first'): string | null {
  if (parseDateCell(cell, dates, order) !== null) return null;
  const text = cell.trim();
  const typed = typedWeekday(text);
  if (typed !== null) {
    const parts = dateParts(text, order);
    const iso = resolveDate(text, dates, order) ?? (parts && parts.year !== null ? realOrNull(parts.year, parts.month, parts.day) : null);
    if (iso !== null && weekday(iso) !== typed) return `${stripWeekday(text)} is a ${weekdayName(iso)}, not a ${WEEKDAY_WORDS[typed]}.`;
  }
  if (readsAsDate(text, order)) {
    if (dates) return `${text} is outside the days you are planning.`;
    if ((dateParts(text, order) as DateParts).year === null) return `${text} has no year. Use dates like 2026-11-30.`;
  }
  return `${text} is not a real date. Use dates like 2026-11-30.`;
}

function dayWords(parts: DateParts): string {
  return `${MONTH_WORDS[parts.month - 1] ?? '?'} ${parts.day}${parts.year === null ? '' : `, ${parts.year}`}`;
}

/** How the slash dates of one file are read, and what to tell people about it. */
interface DateSettlement {
  readonly order: DateOrder;
  readonly needed: boolean;
  readonly notes: ImportNote[];
}

/**
 * Settles the order of the slash dates in one file. A date with a first number above 12
 * (`25/11/2026`) can only be day first and one with a second number above 12 (`11/25/2026`) only
 * month first, so one such date settles the file. Else, with planning `dates`, the order that
 * puts every date inside them wins. Else, when some date could mean two days (`02/11/2026`), it
 * is read month first and a note asks people to check. `given` always wins.
 */
function settleDateOrder(cells: readonly { readonly line: number; readonly text: string }[], dates: readonly IsoDate[] | undefined, given: DateOrder | undefined): DateSettlement {
  if (given) return { order: given, needed: false, notes: [] };
  const slash = cells
    .map((cell) => ({ line: cell.line, text: stripWeekday(cell.text), match: SLASH_DATE.exec(stripWeekday(cell.text)) }))
    .filter((cell): cell is { line: number; text: string; match: RegExpExecArray } => cell.match !== null)
    .map((cell) => ({ line: cell.line, text: cell.text, a: Number(cell.match[1]), b: Number(cell.match[2]) }));
  const dayFirstOnly = slash.find((cell) => cell.a > 12 && cell.b <= 12);
  const monthFirstOnly = slash.find((cell) => cell.b > 12 && cell.a <= 12);
  if (dayFirstOnly && monthFirstOnly) {
    return {
      order: 'month_first',
      needed: false,
      notes: [{ code: 'dates_mixed', line: dayFirstOnly.line, text: `Some dates put the month first (${monthFirstOnly.text}) and some put the day first (${dayFirstOnly.text}). They were read month first, so dates like ${dayFirstOnly.text} could not be read. Fix them in the file or use dates like 2026-11-30.` }],
    };
  }
  if (dayFirstOnly) return { order: 'day_first', needed: false, notes: [] };
  if (monthFirstOnly) return { order: 'month_first', needed: false, notes: [] };
  const ambiguous = slash.filter((cell) => cell.a !== cell.b && cell.a >= 1 && cell.b >= 1);
  if (ambiguous.length === 0) return { order: 'month_first', needed: false, notes: [] };
  if (dates) {
    const fits = (order: DateOrder): boolean => ambiguous.every((cell) => parseDateCell(cell.text, dates, order) !== null);
    const monthFirst = fits('month_first');
    const dayFirst = fits('day_first');
    if (monthFirst !== dayFirst) return { order: monthFirst ? 'month_first' : 'day_first', needed: false, notes: [] };
  }
  const sample = ambiguous[0] as (typeof ambiguous)[number];
  const asMonth = dateParts(sample.text, 'month_first') as DateParts;
  const asDay = dateParts(sample.text, 'day_first') as DateParts;
  return {
    order: 'month_first',
    needed: true,
    notes: [{ code: 'dates_ambiguous', line: sample.line, text: `Dates like ${sample.text} can mean ${dayWords(asMonth)} or ${dayWords(asDay)}. They were read month first (${dayWords(asMonth)}). Pick day first if that is wrong.` }],
  };
}

/** The most decimals a qty can have. */
export const MAX_QTY_DECIMALS = 3;

/**
 * The largest qty the database takes, scaled by 1000 (99,999,999.999): `pm.builds.planned_qty`
 * and `pm.build_output.qty` are CHECK `< 100000000`. Merged totals are held to it too.
 */
export const MAX_QTY_SCALED = BigInt('99999999999');

/**
 * A qty cell as a 3 decimal string, or a reason it cannot be used, in the same words as the
 * variant paste (`readQtyCell` and `qtyMessage` in variants). `where` names the cell for a grid
 * ("Nov 30"): "The qty 5. is not a number (Nov 30)." and "The qty is too large (Nov 30). Use up
 * to 99,999,999."
 */
function readQty(cell: string, what: 'qty' | 'scrap', where?: string): { qty: string } | { why: string } {
  const read = readQtyCell(cell, what, where);
  return 'why' in read ? read : { qty: fromScaled(quantityToScaled(read.plain), 3) };
}

interface Sheet {
  readonly delimiter: SheetDelimiter;
  readonly rows: readonly { readonly line: number; readonly raw: string; readonly cells: readonly string[] }[];
}

function readSheet(text: string): Sheet {
  const lines = textLines(text);
  const delimiter = anyDelimiter(lines);
  return { delimiter, rows: lines.map((row) => ({ ...row, cells: splitCells(row.raw, delimiter) })) };
}

const DATE_HEADERS = ['date', 'day', 'work date', 'build date', 'work day', 'when', 'made on', 'built on', 'plan date', 'planned date', 'build day'];
const VARIANT_HEADERS = ['sku', 'variant', 'kit', 'item', 'name', 'product', 'key', 'kit sku', 'variant sku', 'item code', 'code'];
const QTY_HEADERS = ['qty', 'quantity', 'built', 'good', 'units', 'count', 'planned', 'plan', 'made', 'good qty', 'built qty', 'planned qty', 'output'];
const SCRAP_HEADERS = ['scrap', 'scrap qty', 'bad', 'rejects', 'rejected', 'waste'];

interface Columns {
  date: number;
  variant: number;
  qty: number;
  scrap: number | null;
}

/** The columns a row names: each is the index or -1. */
function namedColumns(cells: readonly string[], withScrap: boolean): { date: number; variant: number; qty: number; scrap: number } {
  const find = (names: readonly string[]): number => cells.findIndex((cell) => names.includes(cell.trim().toLowerCase().replace(/\s+/g, ' ')));
  return { date: find(DATE_HEADERS), variant: find(VARIANT_HEADERS), qty: find(QTY_HEADERS), scrap: withScrap ? find(SCRAP_HEADERS) : -1 };
}

/** True when a first row reads as a header: no cell in it is a date, a number or a variant. */
function headerLike(cells: readonly string[], variants: readonly VariantMatch[]): boolean {
  const filled = cells.filter((cell) => cell.trim() !== '');
  if (filled.length === 0) return false;
  return filled.every((cell) => !looksLikeAnyDate(cell) && plainNumber(cell) === null && matchVariant(cell, variants) === null);
}

/**
 * Finds the date, variant, qty (and scrap) columns from the data rows: the column where most
 * cells are dates, then the one where most cells name a variant (else the one with most text),
 * then the first column where most cells are numbers, then the next number column for scrap.
 * Columns a header named win over guesses. Falls back to date, variant, qty, scrap by position.
 */
function guessColumns(body: readonly { readonly cells: readonly string[] }[], variants: readonly VariantMatch[], withScrap: boolean, named: { date: number; variant: number; qty: number; scrap: number }): Columns {
  const sample = body.slice(0, 50);
  const width = Math.max(0, ...sample.map((row) => row.cells.length));
  const count = (index: number, test: (cell: string) => boolean): number => sample.filter((row) => (row.cells[index] ?? '').trim() !== '' && test(row.cells[index] as string)).length;
  const indexes = Array.from({ length: width }, (_, index) => index);
  const taken = new Set<number>();
  const best = (score: (index: number) => number, fallback: number): number => {
    let pick = -1;
    let top = 0;
    for (const index of indexes) {
      if (taken.has(index)) continue;
      const value = score(index);
      if (value > top) {
        pick = index;
        top = value;
      }
    }
    return pick >= 0 ? pick : !taken.has(fallback) ? fallback : (indexes.find((index) => !taken.has(index)) ?? fallback);
  };
  const keep = (index: number): number => {
    taken.add(index);
    return index;
  };
  if (named.date >= 0) taken.add(named.date);
  if (named.variant >= 0) taken.add(named.variant);
  if (named.qty >= 0) taken.add(named.qty);
  if (named.scrap >= 0) taken.add(named.scrap);
  const date = named.date >= 0 ? named.date : keep(best((index) => count(index, looksLikeAnyDate), 0));
  const variant =
    named.variant >= 0
      ? named.variant
      : keep(best((index) => count(index, (cell) => matchVariant(cell, variants) !== null) * 1000 + count(index, (cell) => plainNumber(cell) === null && !looksLikeAnyDate(cell)), 1));
  const numberColumns = indexes.filter((index) => !taken.has(index) && count(index, (cell) => plainNumber(cell) !== null) > 0);
  const qty = named.qty >= 0 ? named.qty : keep(numberColumns[0] ?? best(() => 0, 2));
  let scrap: number | null = null;
  if (withScrap) {
    if (named.scrap >= 0) scrap = named.scrap;
    else {
      // Scrap is guessed only from a column filled on more than half the rows, so a few rows with
      // a stray cell (an unquoted 1,200) are never read as qty 1 and scrap 200: those rows have
      // more cells than the columns used and are listed in unmatched instead.
      const usable = (index: number): boolean => count(index, () => true) * 2 > sample.length;
      const next = indexes.find((index) => !taken.has(index) && index !== qty && usable(index) && count(index, (cell) => plainNumber(cell) !== null) > 0);
      scrap = next ?? (width > 3 && !taken.has(3) && usable(3) ? 3 : null);
    }
  }
  return { date, variant, qty, scrap };
}

interface LongRow {
  readonly line: number;
  readonly raw: string;
  readonly date: IsoDate;
  readonly variant: VariantMatch;
  readonly qty: string;
  readonly scrapQty: string;
}

const COLUMN_WORDS = ['date', 'SKU or variant', 'qty', 'scrap'] as const;

/**
 * Rows of date, variant, qty (and scrap), with or without a header row. A header this knows
 * places the columns in any order. A first row that is not a known header but has no date,
 * number or variant in it is read as a header, with the note "Line 1 was read as a header.", and
 * the columns are found from the data. Slash dates are read in one order for the whole file.
 */
function readLongRows(
  sheet: Sheet,
  variants: readonly VariantMatch[],
  options: { readonly withScrap: boolean; readonly dates?: readonly IsoDate[]; readonly dateOrder?: DateOrder },
): { rows: LongRow[]; unmatched: Unmatched[]; notes: ImportNote[]; dateOrder: DateOrder; dateOrderNeeded: boolean } {
  const rows: LongRow[] = [];
  const unmatched: Unmatched[] = [];
  const notes: ImportNote[] = [];
  const first = sheet.rows[0];
  const named = first ? namedColumns(first.cells, options.withScrap) : { date: -1, variant: -1, qty: -1, scrap: -1 };
  const knownHeader = named.date >= 0 && named.variant >= 0 && named.qty >= 0;
  const headerRow = first !== undefined && (knownHeader || headerLike(first.cells, variants));
  const body = headerRow ? sheet.rows.slice(1) : sheet.rows;
  const columns: Columns = knownHeader
    ? { date: named.date, variant: named.variant, qty: named.qty, scrap: named.scrap < 0 ? null : named.scrap }
    : guessColumns(body, variants, options.withScrap, headerRow ? named : { date: -1, variant: -1, qty: -1, scrap: -1 });
  if (headerRow && !knownHeader && first) {
    const order = [columns.date, columns.variant, columns.qty, ...(columns.scrap === null ? [] : [columns.scrap])];
    const placed = order.map((index, position) => `${COLUMN_WORDS[position]} in column ${index + 1}`);
    notes.push({ code: 'header_guessed', line: first.line, text: `Line 1 was read as a header. The columns were found from the data: ${placed.join(', ')}.` });
  }
  const settled = settleDateOrder(
    body.map((row) => ({ line: row.line, text: row.cells[columns.date] ?? '' })),
    options.dates,
    options.dateOrder,
  );
  notes.push(...settled.notes);
  // A row is held to the header's cells, or with no header to the columns read. A row with a
  // filled cell past them (most often a number like 1,200 typed without quotes) is left out with
  // the reason, never read in part: "1,200" read as 1 would under count by 1,200 times.
  const used = [{ index: columns.date, word: 'date' }, { index: columns.variant, word: 'SKU or variant' }, { index: columns.qty, word: 'qty' }, ...(columns.scrap === null ? [] : [{ index: columns.scrap, word: 'scrap' }])].sort((a, b) => a.index - b.index);
  const expected: ExpectedCells = headerRow && first ? { kind: 'header', cells: filledWidth(first.cells) } : { kind: 'columns', names: used.map((column) => column.word) };
  const limit = expected.kind === 'header' ? expected.cells : Math.max(...used.map((column) => column.index)) + 1;
  for (const row of body) {
    if (filledWidth(row.cells) > limit) {
      unmatched.push({ line: row.line, raw: row.raw, why: extraCellsMessage(row.cells, expected, sheet.delimiter) });
      continue;
    }
    const dateCell = row.cells[columns.date] ?? '';
    const variantCell = row.cells[columns.variant] ?? '';
    const qtyCell = row.cells[columns.qty] ?? '';
    const date = parseDateCell(dateCell, options.dates, settled.order);
    if (date === null) {
      const why = dateCell.trim() === '' ? 'This row has no date.' : (dateCellProblem(dateCell, options.dates, settled.order) as string);
      unmatched.push({ line: row.line, raw: row.raw, why });
      continue;
    }
    if (variantCell.trim() === '') {
      unmatched.push({ line: row.line, raw: row.raw, why: 'This row has no SKU or variant.' });
      continue;
    }
    const variant = matchVariant(variantCell, variants);
    if (!variant) {
      unmatched.push({ line: row.line, raw: row.raw, why: noVariantMessage(variantCell) });
      continue;
    }
    if (qtyCell.trim() === '') {
      unmatched.push({ line: row.line, raw: row.raw, why: 'This row has no qty.' });
      continue;
    }
    const qty = readQty(qtyCell, 'qty');
    if ('why' in qty) {
      unmatched.push({ line: row.line, raw: row.raw, why: qty.why });
      continue;
    }
    let scrapQty = '0.000';
    const scrapCell = columns.scrap === null ? '' : (row.cells[columns.scrap] ?? '');
    if (scrapCell.trim() !== '') {
      const scrap = readQty(scrapCell, 'scrap');
      if ('why' in scrap) {
        unmatched.push({ line: row.line, raw: row.raw, why: scrap.why });
        continue;
      }
      scrapQty = scrap.qty;
    }
    rows.push({ line: row.line, raw: row.raw, date, variant, qty: qty.qty, scrapQty });
  }
  return { rows, unmatched, notes, dateOrder: settled.order, dateOrderNeeded: settled.needed };
}

/**
 * A grid: a header row of dates and one row per variant with a qty under each date. Null when the
 * first row is not a header of dates. Once every filled cell after the first reads as a date (in
 * the planning days or not, with the right weekday or not), the sheet stays a grid: a column whose
 * date cannot be used is listed once on the header line and the other columns are still read.
 */
function readGrid(
  sheet: Sheet,
  variants: readonly VariantMatch[],
  dates: readonly IsoDate[] | undefined,
  dateOrder: DateOrder | undefined,
): { cells: { variantId: string; date: IsoDate; qty: string; line: number; raw: string }[]; unmatched: Unmatched[]; notes: ImportNote[]; dateOrder: DateOrder; dateOrderNeeded: boolean } | null {
  const header = sheet.rows[0];
  if (!header || header.cells.length < 2) return null;
  // A header of dates: every filled cell after the first is text (no plain numbers, which mark a
  // data row such as "GLOVE-S-BRN,2026-11-23,10"), and at least half of them read as dates.
  const tail = header.cells.slice(1).filter((cell) => cell.trim() !== '');
  if (tail.length === 0 || tail.some((cell) => plainNumber(cell) !== null)) return null;
  const dateCount = tail.filter((cell) => looksLikeAnyDate(cell)).length;
  if (dateCount * 2 < tail.length) return null;
  const allDates = dateCount === tail.length;
  const settled = settleDateOrder(
    header.cells.slice(1).map((text) => ({ line: header.line, text })),
    dates,
    dateOrder,
  );
  const headerDates = header.cells.map((cell, index) => (index === 0 ? null : parseDateCell(cell, dates, settled.order)));
  if (!allDates && !headerDates.some((date) => date !== null)) return null;
  const unmatched: Unmatched[] = [];
  header.cells.forEach((cell, index) => {
    if (index === 0 || headerDates[index] !== null || cell.trim() === '') return;
    unmatched.push({ line: header.line, raw: header.raw, why: dateCellProblem(cell, dates, settled.order) as string });
  });
  const cells: { variantId: string; date: IsoDate; qty: string; line: number; raw: string }[] = [];
  const headerCells = filledWidth(header.cells);
  for (const row of sheet.rows.slice(1)) {
    // A row with more cells than the header would put its qtys under the wrong dates, so it is left out.
    if (filledWidth(row.cells) > headerCells) {
      unmatched.push({ line: row.line, raw: row.raw, why: extraCellsMessage(row.cells, { kind: 'header', cells: headerCells }, sheet.delimiter) });
      continue;
    }
    const token = row.cells[0] ?? '';
    if (token.trim() === '') {
      unmatched.push({ line: row.line, raw: row.raw, why: 'This row has no SKU or variant.' });
      continue;
    }
    const variant = matchVariant(token, variants);
    if (!variant) {
      unmatched.push({ line: row.line, raw: row.raw, why: noVariantMessage(token) });
      continue;
    }
    for (let index = 1; index < row.cells.length; index += 1) {
      const date = headerDates[index];
      const value = (row.cells[index] ?? '').trim();
      if (!date || value === '') continue;
      const qty = readQty(value, 'qty', header.cells[index]);
      if ('why' in qty) {
        unmatched.push({ line: row.line, raw: row.raw, why: qty.why });
        continue;
      }
      if (quantityToScaled(qty.qty) === BigInt(0)) continue;
      cells.push({ variantId: variant.id, date, qty: qty.qty, line: row.line, raw: row.raw });
    }
  }
  return { cells, unmatched, notes: settled.notes, dateOrder: settled.order, dateOrderNeeded: settled.needed };
}

/** "line 3", "lines 3 and 4", "lines 2, 3 and 4"; past 5 lines, "lines 2, 3, 4, 5, 6 and 7 more". */
function lineList(lines: readonly number[]): string {
  if (lines.length === 1) return `line ${lines[0]}`;
  const shown = lines.length > 5 ? lines.slice(0, 5) : lines.slice(0, -1);
  const tail = lines.length > 5 ? `${lines.length - 5} more` : String(lines[lines.length - 1]);
  return `lines ${shown.join(', ')} and ${tail}`;
}

/** A day in UI words, the way the other import messages say it: "Mon, Nov 30". */
function shortDay(date: IsoDate): string {
  const [, month = '1', day = '1'] = date.split('-');
  return `${weekdayName(date).slice(0, 3)}, ${MONTH_WORDS[Number(month) - 1] ?? '?'} ${Number(day)}`;
}

/**
 * "Left out: Small Brown on Mon, Nov 2 adds up to 100,000,000 or more with line 3. Use up to
 * 99,999,999 for one day." Every line that fed the day gets it, each naming the other lines.
 */
function leftOutMessage(what: 'qty' | 'scrap', variantName: string, date: IsoDate, otherLines: readonly number[]): string {
  const subject = what === 'qty' ? `${variantName} on ${shortDay(date)}` : `the scrap for ${variantName} on ${shortDay(date)}`;
  const where = otherLines.length === 0 ? 'on this line' : `with ${lineList(otherLines)}`;
  return `Left out: ${subject} adds up to 100,000,000 or more ${where}. Use up to 99,999,999 for one day.`;
}

/** "Added to line 2, which also has Small Brown on Mon, Nov 30." */
function mergedMessage(firstLine: number, variantName: string, date: IsoDate): string {
  return `Added to line ${firstLine}, which also has ${variantName} on ${shortDay(date)}.`;
}

/** One read cell (a long row, or one qty under a date in a grid) to add up by variant and day. */
interface Feed {
  readonly key: string;
  readonly line: number;
  readonly raw: string;
  readonly variantId: string;
  readonly variantName: string;
  readonly date: IsoDate;
  readonly qty: bigint;
  readonly scrap: bigint;
}

interface Total {
  readonly variantId: string;
  readonly date: IsoDate;
  readonly qty: bigint;
  readonly scrap: bigint;
}

/**
 * Adds up feeds for the same variant and day, keeping first seen order. Each later feed is listed
 * in `merged` with the line it was added to, so the review step can say what was combined.
 *
 * A day whose qty or scrap adds up to 100,000,000 or more (the database CHECK) cannot be saved in
 * one row, so the whole day is left out, and every line that fed it, the first line, the ones
 * added to it and the ones after, goes to `unmatched` with the other lines named. So every line
 * read ends up in exactly one place: a row, `merged` or `unmatched`.
 */
function addUp(feeds: readonly Feed[]): { totals: Total[]; merged: Unmatched[]; unmatched: Unmatched[] } {
  const groups = new Map<string, Feed[]>();
  for (const feed of feeds) {
    const group = groups.get(feed.key);
    if (group) group.push(feed);
    else groups.set(feed.key, [feed]);
  }
  const totals: Total[] = [];
  const merged: Unmatched[] = [];
  const unmatched: Unmatched[] = [];
  for (const group of groups.values()) {
    const first = group[0] as Feed;
    const qty = group.reduce((sum, feed) => sum + feed.qty, BigInt(0));
    const scrap = group.reduce((sum, feed) => sum + feed.scrap, BigInt(0));
    const over = qty > MAX_QTY_SCALED ? 'qty' : scrap > MAX_QTY_SCALED ? 'scrap' : null;
    if (over) {
      const lines = [...new Set(group.map((feed) => feed.line))];
      const listed = new Set<number>();
      for (const feed of group) {
        // A grid line that feeds the same day twice (two columns read as one date) is listed once.
        if (listed.has(feed.line)) continue;
        listed.add(feed.line);
        unmatched.push({ line: feed.line, raw: feed.raw, why: leftOutMessage(over, feed.variantName, feed.date, lines.filter((line) => line !== feed.line)) });
      }
      continue;
    }
    totals.push({ variantId: first.variantId, date: first.date, qty, scrap });
    for (const feed of group.slice(1)) merged.push({ line: feed.line, raw: feed.raw, why: mergedMessage(first.line, feed.variantName, feed.date) });
  }
  return { totals, merged, unmatched };
}

/** Unmatched lines in line order (a stable sort keeps one line's reasons in the order found). */
function byLine(rows: readonly Unmatched[]): Unmatched[] {
  return [...rows].sort((a, b) => a.line - b.line);
}

/** Plan cells (from a grid or long rows) added up by variant and day. */
function combine(cells: readonly { variantId: string; date: IsoDate; qty: string; line: number; raw: string }[], variants: readonly VariantMatch[]): { cells: { variantId: string; date: IsoDate; qty: string }[]; unmatched: Unmatched[]; merged: Unmatched[] } {
  const nameOf = (variantId: string): string => variants.find((variant) => variant.id === variantId)?.name ?? variantId;
  const added = addUp(
    cells.map((cell) => ({ key: `${cell.variantId}|${cell.date}`, line: cell.line, raw: cell.raw, variantId: cell.variantId, variantName: nameOf(cell.variantId), date: cell.date, qty: quantityToScaled(cell.qty), scrap: BigInt(0) })),
  );
  return { cells: added.totals.map((total) => ({ variantId: total.variantId, date: total.date, qty: fromScaled(total.qty, 3) })), unmatched: added.unmatched, merged: added.merged };
}

/** UI copy for a plan line whose qty is 0. */
export const ZERO_PLAN_QTY = 'The qty is 0, so this line plans nothing.';

/** Long plan rows as cells to combine. A row with a qty of 0 plans nothing, so it is listed with that reason instead. */
function longCells(rows: readonly LongRow[]): { cells: { variantId: string; date: IsoDate; qty: string; line: number; raw: string }[]; zero: Unmatched[] } {
  const cells: { variantId: string; date: IsoDate; qty: string; line: number; raw: string }[] = [];
  const zero: Unmatched[] = [];
  for (const row of rows) {
    if (quantityToScaled(row.qty) > BigInt(0)) cells.push({ variantId: row.variant.id, date: row.date, qty: row.qty, line: row.line, raw: row.raw });
    else zero.push({ line: row.line, raw: row.raw, why: ZERO_PLAN_QTY });
  }
  return { cells, zero };
}

function report(source: { unmatched: Unmatched[]; notes: ImportNote[]; dateOrder: DateOrder; dateOrderNeeded: boolean }): ImportReport {
  return { unmatched: byLine(source.unmatched), notes: source.notes, dateOrder: source.dateOrder, dateOrderNeeded: source.dateOrderNeeded };
}

/**
 * A pasted plan for the planner: rows of SKU or variant with a column per date (a header row of
 * dates such as `2026-11-30`, `11/30`, `Nov 30` or `Mon Nov 30`, found among `dates`), or rows of
 * date, variant and qty. Cells for the same variant and day add up, and each later one is listed in
 * `merged` ("Added to line 2, which also has Small Brown on Mon, Nov 30."). Empty and 0 cells of
 * a grid are skipped (a grid is mostly blanks); a long row with a qty of 0 is listed in
 * `unmatched` with `ZERO_PLAN_QTY`. Pass `dateOrder` once people pick how slash dates read (see `ImportReport.dateOrderNeeded`).
 */
export function parsePlanPaste(input: { readonly text: string; readonly variants: readonly VariantMatch[]; readonly dates: readonly IsoDate[]; readonly dateOrder?: DateOrder }): { cells: readonly { variantId: string; date: IsoDate; qty: string }[]; merged: readonly Unmatched[] } & ImportReport {
  const sheet = readSheet(input.text);
  const grid = readGrid(sheet, input.variants, input.dates, input.dateOrder);
  if (grid) {
    const combined = combine(grid.cells, input.variants);
    return { cells: combined.cells, merged: combined.merged, ...report({ ...grid, unmatched: [...grid.unmatched, ...combined.unmatched] }) };
  }
  const long = readLongRows(sheet, input.variants, { withScrap: false, dates: input.dates, dateOrder: input.dateOrder });
  const read = longCells(long.rows);
  const combined = combine(read.cells, input.variants);
  return { cells: combined.cells, merged: combined.merged, ...report({ ...long, unmatched: [...long.unmatched, ...read.zero, ...combined.unmatched] }) };
}

/**
 * A plan CSV: rows of date, variant and qty (a header row is optional), or a grid with a header
 * row of full dates. Dates need a year. Rows for the same variant and day add up, and each later
 * one is listed in `merged` ("Added to line 2, which also has Small Brown on Mon, Nov 30.").
 */
export function parsePlanCsv(input: { readonly text: string; readonly variants: readonly VariantMatch[]; readonly dateOrder?: DateOrder }): { rows: readonly { buildDate: IsoDate; variantId: string; qty: string }[]; merged: readonly Unmatched[] } & ImportReport {
  const sheet = readSheet(input.text);
  const toRows = (cells: readonly { variantId: string; date: IsoDate; qty: string }[]): { buildDate: IsoDate; variantId: string; qty: string }[] => cells.map((cell) => ({ buildDate: cell.date, variantId: cell.variantId, qty: cell.qty }));
  const grid = readGrid(sheet, input.variants, undefined, input.dateOrder);
  if (grid) {
    const combined = combine(grid.cells, input.variants);
    return { rows: toRows(combined.cells), merged: combined.merged, ...report({ ...grid, unmatched: [...grid.unmatched, ...combined.unmatched] }) };
  }
  const long = readLongRows(sheet, input.variants, { withScrap: false, dateOrder: input.dateOrder });
  const read = longCells(long.rows);
  const combined = combine(read.cells, input.variants);
  return { rows: toRows(combined.cells), merged: combined.merged, ...report({ ...long, unmatched: [...long.unmatched, ...read.zero, ...combined.unmatched] }) };
}

/**
 * An output CSV: columns date, SKU or variant, qty and an optional scrap (a header row is
 * optional and may put the columns in any order; without a known header the columns are found
 * from the data). Each row is one day of one variant: lines for the same variant and day add up
 * (qty and scrap), the way the plan parsers add repeats, and each later line is listed in
 * `merged` ("Added to line 2, which also has Small Brown on Mon, Nov 2.") so the review step can
 * say what was combined. `notes` holds what people should check (a guessed header, slash dates
 * that could mean two days).
 */
export function parseOutputCsv(input: { readonly text: string; readonly variants: readonly VariantMatch[]; readonly dateOrder?: DateOrder }): {
  rows: readonly { workDate: IsoDate; variantId: string; qty: string; scrapQty: string }[];
  merged: readonly Unmatched[];
} & ImportReport {
  const long = readLongRows(readSheet(input.text), input.variants, { withScrap: true, dateOrder: input.dateOrder });
  const added = addUp(
    long.rows.map((row) => ({ key: `${row.variant.id}|${row.date}`, line: row.line, raw: row.raw, variantId: row.variant.id, variantName: row.variant.name, date: row.date, qty: quantityToScaled(row.qty), scrap: quantityToScaled(row.scrapQty) })),
  );
  const rows = added.totals.map((total) => ({ workDate: total.date, variantId: total.variantId, qty: fromScaled(total.qty, 3), scrapQty: fromScaled(total.scrap, 3) }));
  return { rows, merged: added.merged, ...report({ ...long, unmatched: [...long.unmatched, ...added.unmatched] }) };
}
