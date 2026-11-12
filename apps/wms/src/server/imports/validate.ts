/**
 * Row validation for imports: maps headers to template columns, coerces every cell to its
 * column type and runs the handler's optional cross-field schema. PURE (no database), so
 * the same code drives the validation preview and the real run.
 */
import type { ParsedImportFile } from './parser';
import type { ImportColumn, ImportDefinition, ImportRowValues, ImportValue } from './types';

const TRUE_VALUES = new Set(['yes', 'y', 'true', '1']);
const FALSE_VALUES = new Set(['no', 'n', 'false', '0']);
const ISO_DATE = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/;
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const PREVIEW_ROW_LIMIT = 500;

export function normalizeHeader(header: string): string {
  return header.replace(/\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export interface HeaderMapping {
  /** column key -> header text found in the file */
  readonly mapping: ReadonlyMap<string, string>;
  readonly missingRequired: readonly string[];
  readonly unknown: readonly string[];
}

export function mapHeaders(columns: readonly ImportColumn[], headers: readonly string[]): HeaderMapping {
  const mapping = new Map<string, string>();
  const used = new Set<string>();
  for (const column of columns) {
    const wanted = new Set([normalizeHeader(column.header), column.key.toLowerCase()]);
    const found = headers.find((h) => !used.has(h) && wanted.has(normalizeHeader(h)));
    if (found !== undefined) {
      mapping.set(column.key, found);
      used.add(found);
    }
  }
  return {
    mapping,
    missingRequired: columns.filter((c) => c.required && !mapping.has(c.key)).map((c) => c.header),
    unknown: headers.filter((h) => !used.has(h)),
  };
}

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return null;
  return date.toISOString().slice(0, 10);
}

/** Accepts YYYY-MM-DD, YYYY/MM/DD, M/D/YYYY and full ISO timestamps; returns YYYY-MM-DD. */
export function parseImportDate(raw: string): string | null {
  const iso = ISO_DATE.exec(raw);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const us = US_DATE.exec(raw);
  if (us) return isoDate(Number(us[3]), Number(us[1]), Number(us[2]));
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  return null;
}

export type CoerceResult =
  { readonly ok: true; readonly value: ImportValue } | { readonly ok: false; readonly error: string };

function checkRange(column: ImportColumn, value: number): CoerceResult {
  if (column.min !== undefined && value < column.min)
    return { ok: false, error: `${column.header} must be at least ${column.min}` };
  if (column.max !== undefined && value > column.max)
    return { ok: false, error: `${column.header} must be at most ${column.max}` };
  return { ok: true, value };
}

export function coerceValue(column: ImportColumn, raw: string): CoerceResult {
  if (raw === '') {
    return column.required ? { ok: false, error: `${column.header} is required` } : { ok: true, value: null };
  }
  switch (column.type) {
    case 'integer': {
      const value = Number(raw.replace(/,/g, ''));
      if (!Number.isInteger(value)) return { ok: false, error: `${column.header} must be a whole number` };
      return checkRange(column, value);
    }
    case 'number': {
      const value = Number(raw.replace(/,/g, ''));
      if (!Number.isFinite(value)) return { ok: false, error: `${column.header} must be a number` };
      return checkRange(column, value);
    }
    case 'boolean': {
      const lower = raw.toLowerCase();
      if (TRUE_VALUES.has(lower)) return { ok: true, value: true };
      if (FALSE_VALUES.has(lower)) return { ok: true, value: false };
      return { ok: false, error: `${column.header} must be Yes or No` };
    }
    case 'date': {
      const value = parseImportDate(raw);
      return value
        ? { ok: true, value }
        : { ok: false, error: `${column.header} must be a date (YYYY-MM-DD)` };
    }
    case 'enum': {
      const match = (column.options ?? []).find((o) => o.toLowerCase() === raw.toLowerCase());
      return match
        ? { ok: true, value: match }
        : { ok: false, error: `${column.header} must be one of: ${(column.options ?? []).join(', ')}` };
    }
    default: {
      const max = column.maxLength ?? 200;
      return raw.length > max
        ? { ok: false, error: `${column.header} must be at most ${max} characters` }
        : { ok: true, value: raw };
    }
  }
}

export interface RowValidation {
  readonly rowNumber: number;
  readonly raw: Readonly<Record<string, string>>;
  readonly values: ImportRowValues;
  readonly errors: readonly string[];
}

export interface ImportValidation {
  readonly missingColumns: readonly string[];
  readonly unknownColumns: readonly string[];
  readonly rows: readonly RowValidation[];
  readonly validCount: number;
  readonly errorCount: number;
}

function schemaErrors(def: ImportDefinition, values: ImportRowValues): string[] {
  const schema = def.handler.rowSchema;
  if (!schema) return [];
  const parsed = schema.safeParse(values);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.message);
}

export function validateRows(def: ImportDefinition, file: ParsedImportFile): ImportValidation {
  const headerMap = mapHeaders(def.templateColumns, file.headers);
  const rows = file.rows.map((row): RowValidation => {
    const errors: string[] = [];
    const values: Record<string, ImportValue> = {};
    for (const column of def.templateColumns) {
      const header = headerMap.mapping.get(column.key);
      const result = coerceValue(column, header === undefined ? '' : (row.values[header] ?? ''));
      if (result.ok) values[column.key] = result.value;
      else errors.push(result.error);
    }
    const allErrors = errors.length === 0 ? schemaErrors(def, values) : errors;
    return { rowNumber: row.rowNumber, raw: row.values, values, errors: allErrors };
  });
  const errorCount = rows.filter((r) => r.errors.length > 0).length;
  return {
    missingColumns: headerMap.missingRequired,
    unknownColumns: headerMap.unknown,
    rows,
    validCount: rows.length - errorCount,
    errorCount,
  };
}

export interface ImportPreview {
  readonly configured: boolean;
  readonly totalRows: number;
  readonly validCount: number;
  readonly errorCount: number;
  readonly missingColumns: readonly string[];
  readonly unknownColumns: readonly string[];
  /** First rows (errors first) for the preview grid. */
  readonly rows: readonly {
    readonly rowNumber: number;
    readonly valid: boolean;
    readonly errors: readonly string[];
    readonly values: ImportRowValues;
  }[];
}

/** Validation preview payload (`?dryRun=1`): nothing is written. */
export function buildPreview(def: ImportDefinition, validation: ImportValidation): ImportPreview {
  const ordered = [...validation.rows].sort(
    (a, b) => Number(b.errors.length > 0) - Number(a.errors.length > 0) || a.rowNumber - b.rowNumber,
  );
  return {
    configured: def.handler.configured,
    totalRows: validation.rows.length,
    validCount: validation.validCount,
    errorCount: validation.errorCount,
    missingColumns: validation.missingColumns,
    unknownColumns: validation.unknownColumns,
    rows: ordered
      .slice(0, PREVIEW_ROW_LIMIT)
      .map((r) => ({
        rowNumber: r.rowNumber,
        valid: r.errors.length === 0,
        errors: r.errors,
        values: r.values,
      })),
  };
}
