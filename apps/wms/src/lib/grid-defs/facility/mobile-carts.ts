/** Mobile Carts grid + wizard schema (M10). PURE. */
import { z } from 'zod';
import { MOBILE_CART_STATUSES } from '@/lib/enums';
import {
  requiredId,
  requiredPattern,
  requiredText,
  optionalText,
  versionField,
  type FacilityField,
} from './common';

export const MOBILE_CARTS_GRID_KEY = 'mobile-carts';
export const CART_OPERATION_TYPES = ['Picking', 'Replenishment'] as const;
export const MAX_CART_LEVELS = 20;
export const MAX_CART_COLUMNS = 20;

export const MOBILE_CART_FIELDS: readonly FacilityField[] = [
  { field: 'code', label: 'Cart code', type: 'text' },
  { field: 'warehouseId', label: 'Warehouse', type: 'enum' },
  { field: 'cartTypeId', label: 'Mobile cart type', type: 'enum' },
  { field: 'status', label: 'Status', type: 'enum', options: MOBILE_CART_STATUSES },
  { field: 'cellCount', label: 'Number of cells', type: 'number' },
  { field: 'levels', label: 'Number of levels', type: 'number' },
  { field: 'columns', label: 'Number of columns', type: 'number' },
  { field: 'taskCount', label: 'Number of tasks', type: 'number' },
  { field: 'orderCount', label: 'Number of orders', type: 'number' },
  { field: 'jobCode', label: 'Job code', type: 'text' },
  { field: 'operationType', label: 'Operation type', type: 'enum', options: CART_OPERATION_TYPES },
  { field: 'allowMultipleJob', label: 'Allow multiple job', type: 'boolean' },
  { field: 'isDynamic', label: 'Dynamic', type: 'boolean' },
];

export const MOBILE_CART_SORT_FIELDS = [
  'code',
  'description',
  'warehouseCode',
  'status',
  'cellCount',
  'levels',
  'columns',
  'taskCount',
  'jobCode',
  'orderCount',
  'operationType',
  'allowMultipleJob',
  'createdAt',
] as const;
export const MOBILE_CART_SEARCH_FIELDS = ['code'] as const;

/** Cell barcode: `<CART>-<level letter><column 2-digit>`, e.g. CART-01-A03. */
export function cellBarcode(cartCode: string, level: number, column: number): string {
  return `${cartCode.trim().toUpperCase()}-${String.fromCharCode(64 + level)}${String(column).padStart(2, '0')}`;
}

export interface CellDraft {
  readonly level: number;
  readonly column: number;
  readonly barcode: string;
}

/** Cells = levels × columns, level-major. */
export function buildCells(cartCode: string, levels: number, columns: number): CellDraft[] {
  const cells: CellDraft[] = [];
  for (let level = 1; level <= levels; level += 1) {
    for (let column = 1; column <= columns; column += 1)
      cells.push({ level, column, barcode: cellBarcode(cartCode || 'CART', level, column) });
  }
  return cells;
}

/** Put-wall colour cycle shown on the cell list (Logiwa parity: Orange, Green, Red, Blue, Pink, Light Blue, Purple). */
export const CELL_COLORS = [
  { name: 'Orange', hex: '#F28C28' },
  { name: 'Green', hex: '#28B573' },
  { name: 'Red', hex: '#E5484D' },
  { name: 'Blue', hex: '#2F6FEB' },
  { name: 'Pink', hex: '#E86BB0' },
  { name: 'Light Blue', hex: '#5BC0EB' },
  { name: 'Purple', hex: '#7C4DDB' },
] as const;

/** Suggestion sequence: 1-based, level-major then column (the order operators fill cells). */
export function cellSequence(level: number, column: number, columns: number): number {
  return (level - 1) * Math.max(1, columns) + column;
}

/** Colour for a cell, cycling by suggestion sequence. */
export function cellColor(sequence: number): (typeof CELL_COLORS)[number] {
  return CELL_COLORS[(Math.max(1, sequence) - 1) % CELL_COLORS.length];
}

/** Logiwa CELL NAME: `<Cart>_<column>_<level>`, e.g. MC-01_3_2. */
export function cellName(cartCode: string, column: number, level: number): string {
  return `${cartCode.trim() || 'CART'}_${column}_${level}`;
}

/** DISPLAY NAME shown on the mobile screen: level letter + 2-digit column, e.g. B03 — the same suffix as the cell barcode, so what operators read is what they scan. */
export function cellDisplayName(level: number, column: number): string {
  return `${String.fromCharCode(64 + Math.max(1, level))}${String(column).padStart(2, '0')}`;
}

const cellSchema = z.object({
  level: z.number().int().min(1).max(MAX_CART_LEVELS),
  column: z.number().int().min(1).max(MAX_CART_COLUMNS),
  barcode: requiredText('Cell barcode', 60),
});

const INFO_SHAPE = {
  code: requiredPattern(
    'Code',
    40,
    /^[A-Za-z0-9_-][A-Za-z0-9 _-]*$/,
    'Letters, numbers, space, dash or underscore',
  ),
  warehouseId: requiredId('Warehouse'),
  description: optionalText(250),
  cartTypeId: requiredId('Mobile cart type'),
  levels: z
    .number({ error: 'Levels is required' })
    .int('Whole number')
    .min(1, 'At least 1 level')
    .max(MAX_CART_LEVELS, `At most ${MAX_CART_LEVELS} levels`),
  columns: z
    .number({ error: 'Columns is required' })
    .int('Whole number')
    .min(1, 'At least 1 column')
    .max(MAX_CART_COLUMNS, `At most ${MAX_CART_COLUMNS} columns`),
  operationType: z.enum(CART_OPERATION_TYPES),
  allowMultipleJob: z.boolean(),
  isDynamic: z.boolean(),
};

/** Wizard step 1 (Mobile cart). */
export const mobileCartInfoSchema = z.object(INFO_SHAPE);

export const mobileCartSchema = z
  .object({
    ...INFO_SHAPE,
    cells: z
      .array(cellSchema)
      .min(1, 'Generate the cell list')
      .max(MAX_CART_LEVELS * MAX_CART_COLUMNS),
    version: versionField,
  })
  .superRefine((v, ctx) => {
    if (v.cells.length !== v.levels * v.columns)
      ctx.addIssue({
        code: 'custom',
        path: ['cells'],
        message: `Expected ${v.levels * v.columns} cells (levels × columns)`,
      });
    const seen = new Map<string, number>();
    v.cells.forEach((c, i) => {
      const key = c.barcode.trim().toUpperCase();
      if (seen.has(key))
        ctx.addIssue({
          code: 'custom',
          path: ['cells', i, 'barcode'],
          message: 'Cell barcodes must be unique',
        });
      seen.set(key, i);
    });
  });

export type MobileCartInput = z.input<typeof mobileCartSchema>;
export type MobileCartSave = z.output<typeof mobileCartSchema>;

export const MOBILE_CART_DEFAULTS: MobileCartInput = {
  code: '',
  warehouseId: '',
  description: '',
  cartTypeId: '',
  levels: 4,
  columns: 6,
  operationType: 'Picking',
  allowMultipleJob: false,
  isDynamic: false,
  cells: [],
};

export const duplicateCartSchema = z.object({
  code: requiredPattern(
    'Code',
    40,
    /^[A-Za-z0-9_-][A-Za-z0-9 _-]*$/,
    'Letters, numbers, space, dash or underscore',
  ),
});
