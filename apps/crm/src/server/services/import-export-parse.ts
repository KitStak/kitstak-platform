/**
 * Server-side parsing of uploaded import files (CSV/TSV/TXT and XLSX). Type and size are
 * validated here (never trusting the browser), contents are bounded by row/column caps.
 */
import 'server-only';
import { parseCsv } from '@/features/import-export/lib/csv';
import { BadRequestError } from '@/server/http/errors';
import { IMPORT_MAX_ROWS, type ParseFileResult } from './import-export-contracts';
import { readXlsx, SpreadsheetReadError } from './import-export-xlsx';

export const IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_COLUMNS = 200;

const TEXT_EXTENSIONS = new Set(['csv', 'tsv', 'txt']);

export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Legacy Excel CSV exports are commonly Windows-1252.
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 4096);
  let zeros = 0;
  for (const byte of sample) if (byte === 0) zeros += 1;
  return zeros > sample.length * 0.1 && !(bytes[0] === 0xff || bytes[0] === 0xfe);
}

export function parseImportFile(fileName: string, bytes: Uint8Array): ParseFileResult {
  if (bytes.byteLength === 0) throw new BadRequestError('This file is empty.');
  if (bytes.byteLength > IMPORT_MAX_FILE_BYTES) throw new BadRequestError('This file is larger than 10 MB. Split it into smaller files and import them one at a time.');
  const extension = fileName.toLowerCase().split('.').pop() ?? '';
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;

  if (extension === 'xls' || (bytes[0] === 0xd0 && bytes[1] === 0xcf)) {
    throw new BadRequestError(
      'Legacy .xls workbooks are not supported. Save the file as .xlsx or .csv and try again.',
    );
  }
  if (extension === 'xlsx' || isZip) {
    if (!isZip) throw new BadRequestError("This isn't a valid .xlsx workbook. Save it again from Excel or export it as CSV.");
    try {
      const sheets = readXlsx(bytes, { maxRows: IMPORT_MAX_ROWS + 10, maxColumns: MAX_COLUMNS });
      return { fileName, format: 'xlsx', sheets };
    } catch (error) {
      if (error instanceof SpreadsheetReadError) throw new BadRequestError(error.message);
      throw new BadRequestError("This file couldn't be opened. Save it again or export it as CSV.");
    }
  }
  if (!TEXT_EXTENSIONS.has(extension)) {
    throw new BadRequestError('Upload a .csv, .tsv or .xlsx file.');
  }
  if (looksBinary(bytes)) throw new BadRequestError("This file doesn't look like text. Upload a .csv, .tsv, .txt or .xlsx file.");
  const text = decodeText(bytes);
  const parsed = parseCsv(text, {
    maxRows: IMPORT_MAX_ROWS + 10,
    maxColumns: MAX_COLUMNS,
    delimiter: extension === 'tsv' ? '\t' : undefined,
  });
  if (parsed.rows.length === 0) throw new BadRequestError('We couldn’t find any rows in this file.');
  return {
    fileName,
    format: 'csv',
    sheets: [{ name: fileName.replace(/\.[^.]+$/, ''), rows: parsed.rows, totalRows: parsed.totalRows, truncated: parsed.truncated }],
  };
}
