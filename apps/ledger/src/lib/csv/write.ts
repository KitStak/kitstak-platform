/**
 * CSV writer. Exports use CRLF line ends and a byte order mark so Excel opens them cleanly
 * (docs/ledger/SPEC.md section 7, copied from Pulse), quote any cell that needs it, and guard text cells against
 * spreadsheet formula injection.
 */
import type { Delimiter } from './parse';

const BOM = String.fromCharCode(0xfeff);
const TAB = String.fromCharCode(9);
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
/** A text cell that starts with one of these could run as a formula in a spreadsheet. */
const FORMULA_TRIGGERS: readonly string[] = ['=', '+', '-', '@', TAB, CR];

/** A cell that is already a number, money amount or date and must be written as it is. */
export interface RawCell {
  readonly raw: string;
}

/**
 * One cell to write. Strings are text and get the formula guard. Numbers, bigints and booleans
 * are written plainly. Wrap formatted numbers, money and dates in `rawCell` so `-45.00` stays a number.
 */
export type CsvCell = string | number | bigint | boolean | null | undefined | RawCell;

/** Marks a formatted number, money amount or date as not text, so the formula guard leaves it alone. */
export function rawCell(value: string): RawCell {
  return { raw: value };
}

/** True when a text would be read as a formula by a spreadsheet. */
export function isFormulaLike(text: string): boolean {
  return text.length > 0 && FORMULA_TRIGGERS.includes(text[0] as string);
}

/**
 * Formula guard for export: a text cell whose first character is `=`, `+`, `-`, `@`, tab or
 * carriage return gets one leading apostrophe. A text that already starts with an apostrophe and
 * then one of those gets one more, so `unguardFormula` always gives back the exact text.
 */
export function guardFormula(text: string): string {
  if (isFormulaLike(text)) return `'${text}`;
  if (text.startsWith("'") && isFormulaLike(text.replace(/^'+/, ''))) return `'${text}`;
  return text;
}

/**
 * Formula guard for import: removes exactly one leading apostrophe when what follows would
 * trigger the guard. A note like "- call client" or a phone "+1 555" survives the round trip.
 */
export function unguardFormula(text: string): string {
  if (!text.startsWith("'")) return text;
  const rest = text.slice(1);
  return isFormulaLike(rest.replace(/^'+/, '')) ? rest : text;
}

export interface WriteOptions {
  /** Default comma. */
  readonly delimiter?: Delimiter;
  /** Start the file with a byte order mark. Default true. */
  readonly bom?: boolean;
  /** Line end. Default CRLF. */
  readonly lineEnd?: 'crlf' | 'lf';
  /** Apply the formula guard to text cells. Default true. */
  readonly guard?: boolean;
}

function needsQuotes(value: string, delimiter: string): boolean {
  if (value === '') return false;
  return value.includes(delimiter) || value.includes('"') || value.includes(LF) || value.includes(CR) || value !== value.trim();
}

function cellText(cell: CsvCell, guard: boolean): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'string') return guard ? guardFormula(cell) : cell;
  if (typeof cell === 'boolean') return cell ? 'yes' : 'no';
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : '';
  if (typeof cell === 'bigint') return cell.toString();
  return cell.raw;
}

/** Writes one cell, quoted when it holds the separator, a quote, a line break or outer spaces. */
export function escapeCell(cell: CsvCell, options: WriteOptions = {}): string {
  const delimiter = options.delimiter ?? ',';
  const value = cellText(cell, options.guard ?? true);
  return needsQuotes(value, delimiter) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Writes a header row and data rows as CSV text. */
export function toCsv(headers: readonly string[], rows: Iterable<readonly CsvCell[]>, options: WriteOptions = {}): string {
  const delimiter = options.delimiter ?? ',';
  const eol = options.lineEnd === 'lf' ? LF : `${CR}${LF}`;
  const lines: string[] = [headers.map((header) => escapeCell(header, { ...options, guard: false })).join(delimiter)];
  for (const row of rows) lines.push(row.map((cell) => escapeCell(cell, options)).join(delimiter));
  return `${options.bom === false ? '' : BOM}${lines.join(eol)}${eol}`;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Export file name: `ledger-<stream>-<org>-<from>-to-<to>.csv`. The date part is left off when no range is given. */
export function exportFileName(stream: string, org: string, from?: string | null, to?: string | null): string {
  const parts = ['ledger', slug(stream), slug(org)].filter((part) => part !== '');
  const range = from && to ? `-${from}-to-${to}` : from ? `-from-${from}` : to ? `-to-${to}` : '';
  return `${parts.join('-')}${range}.csv`;
}
