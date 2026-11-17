/**
 * The import pipeline for one CSV stream: read the file, map its headers, read every cell into a
 * typed value and run the row checks. Problems come back in plain words, for example
 * "Row 14, labor_hours: 9x is not a number." Pure TypeScript: the browser uses it to preview a
 * file and the server runs the same code on the raw rows before anything is saved.
 */
import type { StreamId } from '../streams';
import {
  type Coerced,
  type DateOrder,
  type DecimalMark,
  cleanCell,
  parseBoolean,
  parseChoice,
  parseCode,
  parseDate,
  parseEmail,
  parseHours,
  parseInteger,
  parseMoney,
  parseMonth,
  parseNumber,
  parsePercent,
  parsePrice,
  parseText,
  sniffDateOrder,
} from './coerce';
import { type HeaderMapping, type MapHeadersOptions, mapHeaders } from './headers';
import { type CsvProblem, type Delimiter, type ParseOptions, parseCsv } from './parse';
import { type ColumnDef, type LooseRecord, type PlanLayout, type RowIssue, type StreamRecord, anyStreamDef, planLayout, recordKey } from './streams';
import { type WriteOptions, toCsv } from './write';

export interface ReadOptions {
  /** How to read `3/4/2026`. Left out, the file is checked for a clear answer, and month first is the fallback. */
  readonly dateOrder?: DateOrder;
  /** Which character marks decimals. Default `auto`. */
  readonly decimal?: DecimalMark;
}

/** Reads one cleaned, non empty cell of a column into its typed value. */
export function readCell(column: ColumnDef, text: string, options: ReadOptions = {}): Coerced<string | number | bigint | boolean> {
  const decimal = options.decimal;
  switch (column.type) {
    case 'text':
      return parseText(text);
    case 'code':
      return parseCode(text);
    case 'email':
      return parseEmail(text);
    case 'date':
      return parseDate(text, { dateOrder: options.dateOrder });
    case 'month':
      return parseMonth(text);
    case 'money':
      return parseMoney(text, { allowNegative: column.allowNegative === true, decimal });
    case 'price':
      return parsePrice(text, { decimal });
    case 'quantity':
      return parseNumber(text, { scale: 3, decimal });
    case 'hours':
      return parseHours(text, { decimal });
    case 'headcount':
      return parseNumber(text, { scale: 2, below: '10000', decimal });
    case 'multiplier': {
      const read = parseNumber(text, { scale: 2, below: '10', decimal });
      if (read.ok && Number(read.value) < 1) return { ok: false, message: `${text} is too low. An overtime multiplier is 1 or more, like 1.5.` };
      return read;
    }
    case 'pace':
      return parseNumber(text, { scale: 3, positive: column.positive === true, decimal });
    case 'number':
      return parseNumber(text, { scale: 4, min: column.allowNegative ? null : '0', below: '1000000000000', decimal });
    case 'percent':
      return parsePercent(text, { maxBp: column.maxBp, decimal });
    case 'integer':
      return parseInteger(text, { max: 100000, decimal });
    case 'boolean':
      return parseBoolean(text);
    default:
      return parseChoice(text, column.values ?? [], column.valueAliases ?? {});
  }
}

/** "Row 14, labor_hours: 9x is not a number." or "Row 31: October is closed." */
export function formatIssue(rowNumber: number, issue: Pick<RowIssue, 'column' | 'message'>): string {
  return issue.column ? `Row ${rowNumber}, ${issue.column}: ${issue.message}` : `Row ${rowNumber}: ${issue.message}`;
}

export interface RowResult<R = LooseRecord> {
  /** Spreadsheet row number (the header row is row 1). */
  readonly rowNumber: number;
  /** True when the row has no errors. Warnings do not stop a row. */
  readonly ok: boolean;
  /** The typed record, or `null` when the row has an error. */
  readonly record: R | null;
  readonly issues: RowIssue[];
  /** The issues as full sentences that start with the row number. */
  readonly messages: string[];
  /** The raw cells of the row, in header order, for the error report. */
  readonly cells: readonly string[];
}

/**
 * Reads one row. `cells` holds the raw text by column key. `present` lists the columns the file
 * has. A blank cell becomes `null`; a blank cell in a needed column is an error.
 */
export function readStreamRow<S extends StreamId>(stream: S, cells: Readonly<Record<string, string | undefined>>, rowNumber: number, present: ReadonlySet<string>, options: ReadOptions = {}): RowResult<StreamRecord<S>> {
  const def = anyStreamDef(stream);
  const record: LooseRecord = {};
  const issues: RowIssue[] = [];
  for (const column of def.columns) {
    const field = recordKey(column.key);
    const text = present.has(column.key) ? cleanCell(cells[column.key]) : '';
    if (text === '') {
      record[field] = null;
      if (column.required) issues.push({ level: 'error', column: column.key, message: 'This column is needed and the cell is empty.' });
      continue;
    }
    const read = readCell(column, text, options);
    if (read.ok) record[field] = read.value;
    else {
      record[field] = null;
      issues.push({ level: 'error', column: column.key, message: read.message });
    }
  }
  const clean = !issues.some((issue) => issue.level === 'error');
  if (clean && def.check) issues.push(...def.check(record, present));
  const ok = !issues.some((issue) => issue.level === 'error');
  return {
    rowNumber,
    ok,
    record: ok ? (record as unknown as StreamRecord<S>) : null,
    issues,
    messages: issues.map((issue) => formatIssue(rowNumber, issue)),
    cells: [],
  };
}

export interface StreamRead<S extends StreamId = StreamId> {
  readonly stream: S;
  readonly delimiter: Delimiter;
  readonly headers: string[];
  readonly mapping: HeaderMapping;
  /** For quotes and budgets: which of the two layouts the file uses. `null` for other streams. */
  readonly layout: PlanLayout | null;
  /** The date order used to read dates like `3/4/2026`, and where it came from. */
  readonly dateOrder: DateOrder;
  readonly dateOrderSource: 'option' | 'detected' | 'default';
  /** False when a needed column is missing or the file could not be read. No rows are read then. */
  readonly ready: boolean;
  /** Problems with the file as a whole. */
  readonly problems: CsvProblem[];
  readonly rows: RowResult<StreamRecord<S>>[];
  readonly counts: { readonly rows: number; readonly ok: number; readonly withErrors: number; readonly withWarnings: number };
}

export interface ReadRowsInput {
  readonly headers: readonly string[];
  /** Raw rows in header order. */
  readonly rows: readonly (readonly string[])[];
  /** Spreadsheet row numbers. Left out, rows are numbered from 2. */
  readonly rowNumbers?: readonly number[];
  /** For each header: the column it feeds, or `null`. Usually `mapping.columns`. */
  readonly columns: readonly (string | null)[];
}

/**
 * Reads raw rows with a mapping that is already chosen. The server uses this on the rows it
 * stored, so nothing the browser parsed is trusted.
 */
export function readStreamRows<S extends StreamId>(stream: S, input: ReadRowsInput, options: ReadOptions = {}): { rows: RowResult<StreamRecord<S>>[]; dateOrder: DateOrder; dateOrderSource: StreamRead['dateOrderSource'] } {
  const def = anyStreamDef(stream);
  const indexOf = new Map<string, number>();
  input.columns.forEach((column, index) => {
    if (column !== null && !indexOf.has(column)) indexOf.set(column, index);
  });
  const present = new Set(indexOf.keys());

  let dateOrder: DateOrder = options.dateOrder ?? 'MDY';
  let dateOrderSource: StreamRead['dateOrderSource'] = options.dateOrder ? 'option' : 'default';
  if (!options.dateOrder) {
    const dateIndexes = def.columns.filter((column) => column.type === 'date' && indexOf.has(column.key)).map((column) => indexOf.get(column.key) as number);
    const values: string[] = [];
    for (const row of input.rows) for (const index of dateIndexes) values.push(cleanCell(row[index]));
    const sniffed = sniffDateOrder(values);
    if (sniffed) {
      dateOrder = sniffed;
      dateOrderSource = 'detected';
    }
  }

  const rows = input.rows.map((row, position) => {
    const cells: Record<string, string> = {};
    for (const [column, index] of indexOf) cells[column] = row[index] ?? '';
    const result = readStreamRow(stream, cells, input.rowNumbers?.[position] ?? position + 2, present, { ...options, dateOrder });
    return { ...result, cells: row };
  });
  return { rows, dateOrder, dateOrderSource };
}

/**
 * Reads a whole CSV file for a stream: separator, headers, mapping, cells and row checks.
 * It never throws on a bad file. When a needed column is missing, `ready` is false and
 * `problems` says which one, so the person can map it by hand and try again.
 */
export function readStreamCsv<S extends StreamId>(stream: S, text: string, options: ReadOptions & ParseOptions & MapHeadersOptions = {}): StreamRead<S> {
  const def = anyStreamDef(stream);
  const parsed = parseCsv(text, options);
  const mapping = mapHeaders(parsed.headers, def.columns, options);
  const problems = [...parsed.problems];
  const layout = stream === 'job_plans' ? planLayout(mapping.columns.filter((column): column is string => column !== null)) : null;
  for (const column of mapping.missingRequired) {
    problems.push({ level: 'error', code: 'missing_column', row: null, message: `This file has no ${column} column, and it is needed. Add the column, or match one of your columns to it.` });
  }
  const blocked = problems.some((problem) => problem.level === 'error' && problem.code !== 'too_many_rows');
  const ready = !blocked && parsed.headers.length > 0;
  const read = ready ? readStreamRows(stream, { headers: parsed.headers, rows: parsed.rows, rowNumbers: parsed.rowNumbers, columns: mapping.columns }, options) : null;
  const rows = read ? read.rows : [];
  return {
    stream,
    delimiter: parsed.delimiter,
    headers: parsed.headers,
    mapping,
    layout,
    dateOrder: read ? read.dateOrder : (options.dateOrder ?? 'MDY'),
    dateOrderSource: read ? read.dateOrderSource : options.dateOrder ? 'option' : 'default',
    ready,
    problems,
    rows,
    counts: {
      rows: rows.length,
      ok: rows.filter((row) => row.ok).length,
      withErrors: rows.filter((row) => !row.ok).length,
      withWarnings: rows.filter((row) => row.issues.some((issue) => issue.level === 'warning')).length,
    },
  };
}

/**
 * The error report: the rows that did not pass, with the file's own headers and one added
 * `problem` column, ready to fix and upload again.
 */
export function errorReportCsv(read: Pick<StreamRead, 'headers' | 'rows'>, options: WriteOptions = {}): string {
  const bad = read.rows.filter((row) => !row.ok);
  return toCsv(
    [...read.headers, 'problem'],
    bad.map((row) => [...read.headers.map((_, index) => cleanCell(row.cells[index])), row.issues.filter((issue) => issue.level === 'error').map((issue) => (issue.column ? `${issue.column}: ${issue.message}` : issue.message)).join(' ')]),
    options,
  );
}
