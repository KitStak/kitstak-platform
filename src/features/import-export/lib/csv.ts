/**
 * RFC 4180 CSV / TSV parsing and serialization. Pure and client-safe (used by the paste
 * importer in the browser and by the upload parser on the server).
 *
 * - Delimiter auto-detection (comma, semicolon, tab, pipe) on the first lines.
 * - Quoted fields with embedded delimiters, quotes ("") and line breaks.
 * - CRLF / LF / CR line endings; a leading UTF-8 BOM is stripped.
 * - Hard limits on rows and columns so a hostile file cannot exhaust memory.
 */

export type Delimiter = ',' | ';' | '\t' | '|';

export interface CsvParseOptions {
  readonly delimiter?: Delimiter;
  /** Rows beyond this are not materialized; `truncated` is reported instead. */
  readonly maxRows?: number;
  readonly maxColumns?: number;
  /** Per-cell character cap (longer cells are cut). */
  readonly maxCellLength?: number;
}

export interface CsvParseResult {
  readonly rows: string[][];
  readonly delimiter: Delimiter;
  /** Total data rows seen (may exceed `rows.length` when truncated). */
  readonly totalRows: number;
  readonly truncated: boolean;
}

const CANDIDATES: readonly Delimiter[] = [',', ';', '\t', '|'];

/** Count delimiter occurrences outside quotes in a line. */
function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === delimiter) count += 1;
  }
  return count;
}

/** Pick the delimiter that splits the first lines most consistently. */
export function detectDelimiter(text: string): Delimiter {
  const lines = text
    .slice(0, 64 * 1024)
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim().length > 0)
    .slice(0, 20);
  if (lines.length === 0) return ',';
  let best: Delimiter = ',';
  let bestScore = -1;
  for (const delimiter of CANDIDATES) {
    const counts = lines.map((line) => countOutsideQuotes(line, delimiter));
    const first = counts[0] ?? 0;
    if (first === 0) continue;
    const consistent = counts.filter((count) => count === first).length / counts.length;
    const score = consistent * 10 + Math.min(first, 50) / 50;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseCsv(input: string, options: CsvParseOptions = {}): CsvParseResult {
  const text = stripBom(input);
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;
  const maxColumns = options.maxColumns ?? 500;
  const maxCell = options.maxCellLength ?? 50_000;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let fieldStarted = false;
  let totalRows = 0;

  const pushField = () => {
    if (row.length < maxColumns) row.push(field.length > maxCell ? field.slice(0, maxCell) : field);
    field = '';
    fieldStarted = false;
  };
  const pushRow = () => {
    pushField();
    const blank = row.every((cell) => cell.trim() === '');
    if (!blank) {
      totalRows += 1;
      if (rows.length < maxRows) rows.push(row);
    }
    row = [];
  };

  const length = text.length;
  for (let index = 0; index < length; index += 1) {
    const char = text[index] as string;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && !fieldStarted && field.trim() === '') {
      quoted = true;
      fieldStarted = true;
      field = '';
      continue;
    }
    if (char === delimiter) {
      pushField();
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      pushRow();
      continue;
    }
    field += char;
    if (char !== ' ') fieldStarted = true;
  }
  if (field.length > 0 || row.length > 0) pushRow();

  return { rows, delimiter, totalRows, truncated: totalRows > rows.length };
}

/** Characters that make spreadsheet apps evaluate a cell as a formula (CSV injection). */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/**
 * Plain phone numbers / numbers (digits, spaces, dots, dashes, parentheses, one leading sign)
 * can't call a function, so they are safe even when they start with + or -.
 */
const PLAIN_NUMBERISH = /^[+-]?[\d\s().-]*\d[\d\s().-]*$/;

/**
 * Neutralize values that a spreadsheet would evaluate as a formula (OWASP "CSV injection").
 * Phone numbers and plain numbers are left alone so they round-trip unchanged.
 */
export function neutralizeFormula(value: string): string {
  if (!FORMULA_TRIGGER.test(value)) return value;
  if (PLAIN_NUMBERISH.test(value)) return value;
  return `'${value}`;
}

/** Undo `neutralizeFormula` on import: a leading apostrophe before a formula trigger is dropped. */
export function stripFormulaGuard(value: string): string {
  return /^'[=+\-@]/.test(value) ? value.slice(1) : value;
}

function escapeField(value: string, delimiter: string): string {
  const safe = neutralizeFormula(value);
  if (safe.includes('"') || safe.includes(delimiter) || /[\r\n]/.test(safe) || /^\s|\s$/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export type CsvCell = string | number | boolean | null | undefined;

/** Serialize rows to CSV (CRLF line endings, per RFC 4180). */
export function toCsv(rows: readonly (readonly CsvCell[])[], delimiter: Delimiter = ','): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          if (cell === null || cell === undefined) return '';
          if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : '';
          if (typeof cell === 'boolean') return cell ? 'true' : 'false';
          return escapeField(cell, delimiter);
        })
        .join(delimiter),
    )
    .join('\r\n');
}

/** UTF-8 BOM so Excel opens exported CSV files with the right encoding. */
export const UTF8_BOM = '﻿';
