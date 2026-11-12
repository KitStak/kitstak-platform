/**
 * xlsx writer (exceljs): styled frozen header, auto filter, auto column widths and typed
 * cell formats. Shared by exports, import templates and import error files.
 */
import ExcelJS from "exceljs";
import type { ExportColumn, ExportColumnType, ExportRow } from "./types";

const HEADER_FILL = "FF1F3A5F";
const HEADER_FONT = "FFFFFFFF";
const MIN_WIDTH = 8;
const MAX_WIDTH = 60;
const WIDTH_SAMPLE_ROWS = 500;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

export const NUM_FMT: Readonly<Partial<Record<ExportColumnType, string>>> = {
  integer: "#,##0",
  number: "#,##0.####",
  money: "#,##0.00",
  date: "m/d/yyyy",
  datetime: "m/d/yyyy h:mm:ss AM/PM",
};

/** Reads a dot path (`client.name`) from a row. */
export function readPath(row: ExportRow, key: string): unknown {
  if (key in row) return row[key];
  let current: unknown = row;
  for (const part of key.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Infers a column type from sample values. */
export function inferColumnType(values: readonly unknown[]): ExportColumnType {
  const present = values.filter((v) => v !== null && v !== undefined && v !== "");
  if (present.length === 0) return "text";
  if (present.every((v) => typeof v === "boolean")) return "boolean";
  if (present.every((v) => typeof v === "number" && Number.isInteger(v))) return "integer";
  if (present.every((v) => typeof v === "number")) return "number";
  if (present.every((v) => typeof v === "string" && ISO_DATETIME_RE.test(v))) return "datetime";
  if (present.every((v) => typeof v === "string" && ISO_DATE_RE.test(v))) return "date";
  return "text";
}

function humanize(key: string): string {
  const last = key.split(".").pop() ?? key;
  const spaced = last.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Columns from the scalar keys of the first rows (generic provider without a column list). */
export function inferColumns(rows: readonly ExportRow[]): ExportColumn[] {
  const keys: string[] = [];
  for (const row of rows.slice(0, WIDTH_SAMPLE_ROWS)) {
    for (const [key, value] of Object.entries(row)) {
      const scalar = value === null || ["string", "number", "boolean"].includes(typeof value);
      if (scalar && !keys.includes(key)) keys.push(key);
    }
  }
  return keys.map((key) => ({ key, label: humanize(key) }));
}

/** Converts a raw value into what exceljs should store for the column type. */
export function toCellValue(value: unknown, type: ExportColumnType): ExcelJS.CellValue {
  if (value === null || value === undefined || value === "") return null;
  switch (type) {
    case "boolean":
      return value === true || value === 1 || value === "true" ? "Yes" : "No";
    case "integer":
    case "number":
    case "money": {
      const num = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(num)) return String(value);
      return type === "money" ? Math.round(num * 100) / 100 : num;
    }
    case "date":
    case "datetime": {
      const date = value instanceof Date ? value : new Date(String(value));
      return Number.isNaN(date.getTime()) ? String(value) : date;
    }
    default:
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
  }
}

function displayLength(value: ExcelJS.CellValue, type: ExportColumnType): number {
  if (value === null || value === undefined) return 0;
  if (value instanceof Date) return type === "date" ? 10 : 22;
  return String(value).length;
}

export interface SheetSpec {
  readonly name: string;
  readonly columns: readonly ExportColumn[];
  readonly rows: readonly ExportRow[];
}

function resolvedTypes(columns: readonly ExportColumn[], rows: readonly ExportRow[]): ExportColumnType[] {
  return columns.map((column) => column.type
    ?? inferColumnType(rows.slice(0, WIDTH_SAMPLE_ROWS).map((row) => readPath(row, column.key))));
}

/** Sheet names: max 31 chars, no `[]:*?/\`. */
export function safeSheetName(name: string): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31);
  return cleaned.length > 0 ? cleaned : "Sheet1";
}

export function addSheet(workbook: ExcelJS.Workbook, spec: SheetSpec): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(safeSheetName(spec.name), { views: [{ state: "frozen", ySplit: 1 }] });
  const types = resolvedTypes(spec.columns, spec.rows);
  const widths = spec.columns.map((column) => column.label.length);

  sheet.columns = spec.columns.map((column, index) => ({
    header: column.label,
    key: column.key,
    style: NUM_FMT[types[index] ?? "text"] ? { numFmt: NUM_FMT[types[index] ?? "text"] } : {},
  }));

  spec.rows.forEach((row, rowIndex) => {
    const values = spec.columns.map((column, index) => toCellValue(readPath(row, column.key), types[index] ?? "text"));
    sheet.addRow(values);
    if (rowIndex < WIDTH_SAMPLE_ROWS) {
      values.forEach((value, index) => {
        widths[index] = Math.max(widths[index] ?? 0, displayLength(value, types[index] ?? "text"));
      });
    }
  });

  spec.columns.forEach((_, index) => {
    sheet.getColumn(index + 1).width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, (widths[index] ?? 0) + 2));
  });
  styleHeader(sheet, spec.columns.length);
  return sheet;
}

export function styleHeader(sheet: ExcelJS.Worksheet, columnCount: number): void {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: HEADER_FONT } };
  header.alignment = { vertical: "middle" };
  header.height = 20;
  for (let col = 1; col <= columnCount; col += 1) {
    header.getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  }
  if (columnCount > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnCount } };
  }
}

export function createWorkbook(): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "KitStak WMS";
  workbook.created = new Date();
  return workbook;
}

export async function workbookToBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

/** One-sheet workbook as bytes. */
export async function buildXlsx(spec: SheetSpec): Promise<Buffer> {
  const workbook = createWorkbook();
  addSheet(workbook, spec);
  return workbookToBuffer(workbook);
}
