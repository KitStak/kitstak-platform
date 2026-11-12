import { describe, expect, it } from 'vitest';
import {
  COLUMN_TYPES,
  COLUMN_TYPE_REGISTRY,
  cellValueSchemaFor,
  getColumnTypeDefinition,
  isColumnType,
  isEmptyCellValue,
  parseColumnSettings,
  safeParseColumnSettings,
  validateCellValue,
} from './cell-values';

describe('column registry', () => {
  it('defines every column type with valid default settings', () => {
    for (const type of COLUMN_TYPES) {
      const definition = getColumnTypeDefinition(type);
      expect(definition.type).toBe(type);
      expect(definition.defaultWidth).toBeGreaterThanOrEqual(definition.minWidth);
      expect(safeParseColumnSettings(type, definition.defaultSettings()).ok).toBe(true);
    }
    expect(Object.keys(COLUMN_TYPE_REGISTRY)).toHaveLength(COLUMN_TYPES.length);
  });

  it('ships status defaults with a done label and unique ids', () => {
    const settings = COLUMN_TYPE_REGISTRY.status.defaultSettings();
    expect(settings.labels.some((label) => label.isDone)).toBe(true);
    expect(safeParseColumnSettings('status', { labels: [...settings.labels, settings.labels[0]] }).ok).toBe(
      false,
    );
  });

  it('fills settings defaults', () => {
    expect(parseColumnSettings('number', {})).toMatchObject({ decimals: 0, summary: 'sum' });
    expect(parseColumnSettings('rating', undefined)).toEqual({ max: 5 });
  });

  it('recognizes column types', () => {
    expect(isColumnType('status')).toBe(true);
    expect(isColumnType('nope')).toBe(false);
  });
});

describe('cell values', () => {
  it('accepts valid values and null clears', () => {
    expect(validateCellValue('status', { labelId: 'done' }).ok).toBe(true);
    expect(validateCellValue('date', { date: '2026-11-05', time: '09:30' }).ok).toBe(true);
    expect(validateCellValue('currency', { amount: 1200.5, currency: 'USD' }).ok).toBe(true);
    expect(validateCellValue('email', { email: 'ana@example.com' }).ok).toBe(true);
    expect(validateCellValue('link', { url: 'https://example.com/a' }).ok).toBe(true);
    expect(validateCellValue('checkbox', true).ok).toBe(true);
    expect(validateCellValue('text', null).ok).toBe(true);
  });

  it('rejects malformed values', () => {
    expect(validateCellValue('status', { labelId: 'x', extra: 1 }).ok).toBe(false);
    expect(validateCellValue('date', { date: '05/11/2026' }).ok).toBe(false);
    expect(validateCellValue('timeline', { from: '2026-02-01', to: '2026-01-01' }).ok).toBe(false);
    expect(validateCellValue('link', { url: 'javascript:alert(1)' }).ok).toBe(false);
    expect(validateCellValue('people', { ids: ['not-a-uuid'] }).ok).toBe(false);
    expect(validateCellValue('number', Number.NaN).ok).toBe(false);
    expect(validateCellValue('rating', 11).ok).toBe(false);
  });

  it('refuses writes to computed columns', () => {
    expect(validateCellValue('formula', 3).ok).toBe(false);
    expect(cellValueSchemaFor('last_updated').safeParse(null).success).toBe(false);
  });

  it('detects empty cells', () => {
    expect(isEmptyCellValue(null)).toBe(true);
    expect(isEmptyCellValue('  ')).toBe(true);
    expect(isEmptyCellValue({ ids: [] })).toBe(true);
    expect(isEmptyCellValue({ labelId: 'done' })).toBe(false);
    expect(isEmptyCellValue(0)).toBe(false);
    expect(isEmptyCellValue(false)).toBe(true);
  });
});
