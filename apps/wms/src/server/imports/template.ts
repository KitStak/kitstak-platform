/**
 * Import template + error file generators (BUILD_PLAN F6 `imports/`).
 *
 * Template: a "Template" sheet (required headers end in " *", one example row, dropdown
 * validation for enum and Yes/No columns) and a "Notes" sheet describing every column.
 * Error file: the failed rows as uploaded plus a trailing "Error" column.
 */
import type ExcelJS from 'exceljs';
import { addSheet, createWorkbook, styleHeader, workbookToBuffer } from '@/server/exports/xlsx';
import type { ImportColumn, ImportDefinition } from './types';

const VALIDATION_ROWS = 2000;
const TYPE_LABEL: Readonly<Record<ImportColumn['type'], string>> = {
  text: 'Text',
  integer: 'Whole number',
  number: 'Number',
  boolean: 'Yes / No',
  date: 'Date (YYYY-MM-DD)',
  enum: 'List',
};

export function templateHeader(column: ImportColumn): string {
  return column.required ? `${column.header} *` : column.header;
}

function columnLetter(index: number): string {
  let n = index;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function addListValidation(sheet: ExcelJS.Worksheet, colIndex: number, values: readonly string[]): void {
  const list = values.join(',');
  if (list.length === 0 || list.length > 255) return; // Excel limit for inline lists
  const letter = columnLetter(colIndex);
  for (let row = 2; row <= VALIDATION_ROWS; row += 1) {
    sheet.getCell(`${letter}${row}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`"${list}"`],
      showErrorMessage: true,
      errorTitle: 'Invalid value',
      error: `Choose one of: ${values.join(', ')}`,
    };
  }
}

function notesRow(column: ImportColumn): Record<string, string> {
  const rules: string[] = [];
  if (column.options) rules.push(`One of: ${column.options.join(', ')}`);
  if (column.min !== undefined) rules.push(`Min ${column.min}`);
  if (column.max !== undefined) rules.push(`Max ${column.max}`);
  if (column.type === 'text' && column.maxLength) rules.push(`Up to ${column.maxLength} characters`);
  return {
    column: column.header,
    required: column.required ? 'Yes' : 'No',
    type: TYPE_LABEL[column.type],
    rules: rules.join('; '),
    description: column.description ?? '',
    example: column.example,
  };
}

export async function buildImportTemplate(def: ImportDefinition): Promise<Buffer> {
  const workbook = createWorkbook();
  const columns = def.templateColumns;
  const sheet = workbook.addWorksheet('Template', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map((column) => ({
    header: templateHeader(column),
    key: column.key,
    width: Math.min(40, Math.max(12, templateHeader(column).length + 4, column.example.length + 2)),
    style: { numFmt: '@' }, // keep codes such as 0012 as text
  }));
  sheet.addRow(columns.map((column) => column.example));
  styleHeader(sheet, columns.length);
  columns.forEach((column, index) => {
    if (column.type === 'enum' && column.options) addListValidation(sheet, index + 1, column.options);
    if (column.type === 'boolean') addListValidation(sheet, index + 1, ['Yes', 'No']);
  });

  addSheet(workbook, {
    name: 'Notes',
    columns: [
      { key: 'column', label: 'Column', type: 'text' },
      { key: 'required', label: 'Required', type: 'text' },
      { key: 'type', label: 'Type', type: 'text' },
      { key: 'rules', label: 'Rules', type: 'text' },
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'example', label: 'Example', type: 'text' },
    ],
    rows: [
      ...columns.map(notesRow),
      { column: '', required: '', type: '', rules: '', description: '', example: '' },
      {
        column: 'How to use',
        required: '',
        type: '',
        rules: '',
        description:
          'Fill one entry per row on the Template sheet. Delete the example row before uploading. Columns marked * are required.',
        example: '',
      },
    ],
  });
  return workbookToBuffer(workbook);
}

export function templateFileName(def: ImportDefinition): string {
  return `${def.title} Template.xlsx`;
}

export interface FailedRow {
  readonly rowNumber: number;
  readonly raw: Readonly<Record<string, string>>;
  readonly message: string;
}

export async function buildErrorFile(
  def: ImportDefinition,
  headers: readonly string[],
  failed: readonly FailedRow[],
): Promise<Buffer> {
  const workbook = createWorkbook();
  addSheet(workbook, {
    name: 'Errors',
    columns: [
      { key: '__row', label: 'Row', type: 'integer' },
      ...headers.map((header, index) => ({ key: `c${index}`, label: header, type: 'text' as const })),
      { key: '__error', label: 'Error', type: 'text' },
    ],
    rows: failed.map((row) => ({
      __row: row.rowNumber,
      ...Object.fromEntries(headers.map((header, index) => [`c${index}`, row.raw[header] ?? ''])),
      __error: row.message,
    })),
  });
  return workbookToBuffer(workbook);
}

export function errorFileName(def: ImportDefinition): string {
  return `${def.title} Errors.xlsx`;
}
