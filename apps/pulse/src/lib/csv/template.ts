/**
 * Templates and exports, built from the stream definitions. A template is the header row and two
 * example rows. The "how to fill this in" file lists each column, whether it is needed, and the
 * allowed values. An export writes the same headers, so a file you export and import again
 * changes nothing (the round trip rule in docs/pulse/SPEC.md section 7).
 */
import { centsToDecimal, fromScaled, toScaled } from '../money';
import type { StreamId } from '../streams';
import { type ColumnDef, type ColumnFilter, type LooseRecord, type StreamRecord, recordKey, streamColumns } from './streams';
import { type CsvCell, type WriteOptions, rawCell, toCsv } from './write';

function trimDecimal(fixed: string): string {
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}

/** The words for each kind of column in the "how to fill this in" file. */
export const COLUMN_TYPE_HINTS: Readonly<Record<ColumnDef['type'], string>> = {
  text: 'Text',
  code: 'A code or name',
  email: 'An email address',
  date: 'A date, like 2026-11-03',
  month: 'A month, like 2026-11',
  money: 'Money, like 1234.50',
  price: 'A price with up to 4 decimal places, like 0.035',
  quantity: 'A number',
  hours: 'Hours, like 7.5 or 7:30',
  headcount: 'A number of people',
  multiplier: 'A number, like 1.5',
  pace: 'A number above zero',
  number: 'A number',
  percent: 'A percent, like 28 or 28%',
  integer: 'A whole number',
  boolean: 'yes or no',
  choice: 'One value from the list',
};

/**
 * Writes one typed value as a CSV cell. Text is plain text (the writer guards it against formula
 * injection). Numbers, money and dates are raw cells, so `-45.00` stays a number.
 */
export function formatCell(column: ColumnDef, value: unknown): CsvCell {
  if (value === null || value === undefined || value === '') return '';
  switch (column.type) {
    case 'money':
      return rawCell(centsToDecimal(value as bigint));
    case 'percent':
      return rawCell(trimDecimal(fromScaled(BigInt(value as number), 2)));
    case 'price':
      return rawCell(trimDecimal(fromScaled(toScaled(value as string, 4), 4)));
    case 'quantity':
    case 'pace':
      return rawCell(trimDecimal(fromScaled(toScaled(value as string, 3), 3)));
    case 'hours':
    case 'headcount':
    case 'multiplier':
      return rawCell(trimDecimal(fromScaled(toScaled(value as string, 2), 2)));
    case 'number':
      return rawCell(trimDecimal(fromScaled(toScaled(value as string, 4), 4)));
    case 'integer':
      return rawCell(String(value));
    case 'boolean':
      return rawCell(value ? 'yes' : 'no');
    case 'date':
    case 'month':
      return rawCell(String(value));
    default:
      return String(value);
  }
}

/** The header row of a stream template or export. */
export function templateHeaders(stream: StreamId, filter: ColumnFilter = {}): string[] {
  return streamColumns(stream, filter).map((column) => column.key);
}

/** The two example rows of a stream template, in header order. */
export function templateExampleRows(stream: StreamId, filter: ColumnFilter = {}): [string[], string[]] {
  const columns = streamColumns(stream, filter);
  return [columns.map((column) => column.examples[0]), columns.map((column) => column.examples[1])];
}

/** The template file of a stream: the header row and two example rows. */
export function templateCsv(stream: StreamId, filter: ColumnFilter & WriteOptions = {}): string {
  return toCsv(templateHeaders(stream, filter), templateExampleRows(stream, filter), { ...filter, guard: false });
}

export interface HowToFillRow {
  readonly column: string;
  readonly needed: 'yes' | 'no';
  readonly whatToPut: string;
  readonly kind: string;
  readonly allowedValues: string;
  readonly example: string;
}

/** One row per column for the "how to fill this in" file. */
export function howToFillRows(stream: StreamId, filter: ColumnFilter = {}): HowToFillRow[] {
  return streamColumns(stream, filter).map((column) => ({
    column: column.key,
    needed: column.required ? 'yes' : 'no',
    whatToPut: column.help,
    kind: COLUMN_TYPE_HINTS[column.type],
    allowedValues: column.values ? column.values.join(', ') : '',
    example: column.examples[0] !== '' ? column.examples[0] : column.examples[1],
  }));
}

/** The "how to fill this in" file of a stream. */
export function howToFillCsv(stream: StreamId, filter: ColumnFilter & WriteOptions = {}): string {
  return toCsv(
    ['column', 'needed', 'what_to_put', 'kind_of_value', 'allowed_values', 'example'],
    howToFillRows(stream, filter).map((row) => [row.column, row.needed, row.whatToPut, row.kind, row.allowedValues, row.example]),
    { ...filter, guard: false },
  );
}

/** One record as CSV cells, in the order of `columns`. */
export function recordToCells(columns: readonly ColumnDef[], record: Readonly<Record<string, unknown>>): CsvCell[] {
  return columns.map((column) => formatCell(column, record[recordKey(column.key)]));
}

/**
 * Exports typed records as a CSV file with the template headers. Money columns are left out when
 * `canSeeMoney` is false, and wage columns when `canSeeWages` is false. Importing the file back
 * gives the same records.
 */
export function streamToCsv<S extends StreamId>(stream: S, records: Iterable<StreamRecord<S> | LooseRecord>, options: ColumnFilter & WriteOptions = {}): string {
  const columns = streamColumns(stream, options);
  const rows: CsvCell[][] = [];
  for (const record of records) rows.push(recordToCells(columns, record as Readonly<Record<string, unknown>>));
  return toCsv(
    columns.map((column) => column.key),
    rows,
    options,
  );
}
