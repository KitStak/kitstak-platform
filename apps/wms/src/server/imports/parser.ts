/**
 * Import file parser (BUILD_PLAN F6 `parser.ts`): xlsx (first sheet, or "Template") and
 * CSV (RFC 4180; comma, semicolon or tab, auto-detected; UTF-8 with or without BOM).
 * Returns the header row plus every non-blank data row as trimmed strings keyed by header.
 */
import ExcelJS from "exceljs";
import { validationError } from "@/server/api/errors";
import { MIME, sniffMime } from "@/server/files/mime";

export const MAX_IMPORT_ROWS = 50_000;
export const MAX_IMPORT_COLUMNS = 200;

export interface ParsedRow {
  /** 1-based spreadsheet row number (header is row 1). */
  readonly rowNumber: number;
  readonly values: Readonly<Record<string, string>>;
}

export interface ParsedImportFile {
  readonly headers: readonly string[];
  readonly rows: readonly ParsedRow[];
}

/** Splits CSV text into records of fields (quotes, escaped quotes, CRLF, embedded newlines). */
export function parseCsvRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field.length === 0) quoted = true;
    else if (ch === delimiter) {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else field += ch;
  }
  if (quoted) throw validationError("The CSV file has an unterminated quoted field");
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

export function detectDelimiter(firstLine: string): string {
  const candidates = [",", ";", "\t"] as const;
  return candidates.reduce((best, candidate) =>
    firstLine.split(candidate).length > firstLine.split(best).length ? candidate : best, ",");
}

function toRows(matrix: readonly (readonly string[])[]): ParsedImportFile {
  const [headerRow, ...dataRows] = matrix;
  const headers = (headerRow ?? []).map((h) => h.trim());
  while (headers.length > 0 && headers[headers.length - 1] === "") headers.pop();
  if (headers.length === 0) throw validationError("The file has no header row");
  if (headers.length > MAX_IMPORT_COLUMNS) throw validationError(`The file has more than ${MAX_IMPORT_COLUMNS} columns`);
  const duplicate = headers.find((h, i) => h !== "" && headers.indexOf(h) !== i);
  if (duplicate) throw validationError(`Duplicate column "${duplicate}" in the header row`);

  const rows: ParsedRow[] = [];
  dataRows.forEach((cells, index) => {
    const values = Object.fromEntries(headers.map((h, col) => [h, (cells[col] ?? "").trim()]).filter(([h]) => h !== ""));
    if (Object.values(values).every((v) => v === "")) return;
    rows.push({ rowNumber: index + 2, values });
  });
  if (rows.length > MAX_IMPORT_ROWS) {
    throw validationError(`The file has more than ${MAX_IMPORT_ROWS.toLocaleString("en-US")} rows; split it into smaller files`);
  }
  return { headers, rows };
}

export function parseCsv(bytes: Uint8Array): ParsedImportFile {
  const text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  return toRows(parseCsvRecords(text, detectDelimiter(firstLine)));
}

/** Text of one exceljs cell: dates become `YYYY-MM-DD`, formulas their result. */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  }
  if (typeof value === "object") {
    if ("result" in value) return cellText((value.result ?? null) as ExcelJS.CellValue);
    if ("richText" in value) return value.richText.map((part) => part.text).join("");
    if ("text" in value) return String(value.text);
    if ("error" in value) return "";
  }
  return String(value);
}

export async function parseXlsx(bytes: Uint8Array): Promise<ParsedImportFile> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
  } catch (error: unknown) {
    throw validationError("The Excel file could not be read. Save it as .xlsx and try again.", { file: [String(error instanceof Error ? error.message : error)] });
  }
  const sheet = workbook.getWorksheet("Template") ?? workbook.worksheets[0];
  if (!sheet) throw validationError("The Excel file has no worksheets");
  const matrix: string[][] = [];
  const columnCount = Math.min(sheet.columnCount, MAX_IMPORT_COLUMNS + 1);
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells: string[] = [];
    for (let col = 1; col <= columnCount; col += 1) cells.push(cellText(row.getCell(col).value));
    matrix[rowNumber - 1] = cells;
  });
  return toRows(Array.from(matrix, (cells) => cells ?? []));
}

/** Parses an uploaded import file by its sniffed type. */
export async function parseImportFile(bytes: Uint8Array, fileName: string): Promise<ParsedImportFile> {
  const mime = sniffMime(bytes, fileName);
  if (mime === MIME.xlsx) return parseXlsx(bytes);
  if (mime === MIME.csv) return parseCsv(bytes);
  throw validationError("Unsupported file type: upload an Excel (.xlsx) or CSV file", { file: ["Upload an Excel (.xlsx) or CSV file"] });
}
