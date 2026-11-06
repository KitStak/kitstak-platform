import { describe, expect, it } from 'vitest';
import { buildXlsx, columnLetter, crc32, excelSerial, safeSheetName } from '@/features/import-export/lib/xlsx-writer';
import { projectItems } from '@/features/import-export/lib/export-format';
import { applyViewToItems, visibleColumns } from '@/features/import-export/lib/view-filter';
import type { ColumnDto, ItemDto } from '@/server/services/contracts/dto';
import { parseImportFile } from '../import-export-parse';
import { decodeXmlText, readXlsx, serialToIso } from '../import-export-xlsx';

const column = (key: string, type: ColumnDto['type'], title = key, settings: unknown = {}, hidden = false): ColumnDto => ({
  id: key,
  boardId: 'b',
  key,
  title,
  description: null,
  type,
  scope: 'item',
  settings: settings as ColumnDto['settings'],
  width: 140,
  position: key,
  hidden,
  required: false,
});

const item = (id: string, name: string, values: Record<string, unknown>): ItemDto => ({
  id,
  boardId: 'b',
  groupId: 'g1',
  parentItemId: null,
  name,
  position: id,
  values: values as ItemDto['values'],
  computed: {},
  subitemCount: 0,
  updateCount: 0,
  createdBy: null,
  updatedBy: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  archivedAt: null,
  deletedAt: null,
});

const columns = [
  column('name', 'name', 'Deal'),
  column('stage', 'status', 'Stage', { labels: [{ id: 'won', name: 'Won', color: 'green', position: 0 }, { id: 'lost', name: 'Lost', color: 'red', position: 1 }] }),
  column('value', 'currency', 'Value', { currency: 'USD' }),
  column('owner', 'people', 'Owner'),
  column('close', 'date', 'Close'),
  column('secret', 'text', 'Secret', {}, true),
];
const items = [
  item('1', 'Acme', { stage: { labelId: 'won' }, value: { amount: 500, currency: 'USD' }, owner: { ids: ['u1'] }, close: { date: '2024-02-01' } }),
  item('2', 'Globex', { stage: { labelId: 'lost' }, value: { amount: 1500, currency: 'USD' }, close: { date: '2024-05-01' } }),
  item('3', 'Initech', { value: { amount: 50, currency: 'USD' } }),
];
const ctx = { users: new Map([['u1', { id: 'u1', name: 'Maya Chen', email: 'maya@x.io', image: null, title: null }]]) };

describe('view filter', () => {
  it('filters with and/or rules, search and person filter', () => {
    const byLabel = applyViewToItems(items, columns, { filters: { rules: [{ columnKey: 'stage', operator: 'is', value: ['won'] }] } }, ctx);
    expect(byLabel.map((entry) => entry.name)).toEqual(['Acme']);
    const or = applyViewToItems(
      items,
      columns,
      {
        filters: {
          conjunction: 'or',
          rules: [
            { columnKey: 'value', operator: 'gt', value: 1000 },
            { columnKey: 'stage', operator: 'is_empty' },
          ],
        },
      },
      ctx,
    );
    expect(or.map((entry) => entry.name)).toEqual(['Globex', 'Initech']);
    expect(applyViewToItems(items, columns, { search: 'glob' }, ctx).map((entry) => entry.name)).toEqual(['Globex']);
    expect(applyViewToItems(items, columns, { personFilter: 'u1' }, ctx).map((entry) => entry.name)).toEqual(['Acme']);
    expect(
      applyViewToItems(items, columns, { filters: { rules: [{ columnKey: 'close', operator: 'before', value: '2024-03-01' }] } }, ctx).map((e) => e.name),
    ).toEqual(['Acme']);
  });

  it('sorts and hides columns', () => {
    const sorted = applyViewToItems(items, columns, { sort: [{ columnKey: 'value', direction: 'desc' }] }, ctx);
    expect(sorted.map((entry) => entry.name)).toEqual(['Globex', 'Acme', 'Initech']);
    const visible = visibleColumns(columns, { hiddenColumnKeys: ['owner'], columnOrder: ['close', 'stage'] });
    expect(visible.map((entry) => entry.key)).toEqual(['name', 'close', 'stage', 'value']);
  });

  it('projects formatted values with raw extras', () => {
    const table = projectItems({ columns: visibleColumns(columns, undefined), items, groups: [{ id: 'g1', boardId: 'b', title: 'Q1', color: 'blue', position: 'a', collapsedDefault: false, archivedAt: null }], ctx });
    expect(table.header).toEqual(['Deal', 'Group', 'Stage', 'Value', 'Value (currency)', 'Owner', 'Owner (emails)', 'Close']);
    expect(table.rows[0]).toEqual(['Acme', 'Q1', 'Won', { number: 500, format: 'decimal' }, 'USD', 'Maya Chen', 'maya@x.io', { date: '2024-02-01' }]);
  });
});

describe('xlsx writer + reader', () => {
  it('has correct helpers', () => {
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686);
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(27)).toBe('AB');
    expect(excelSerial('1970-01-01')).toBe(25569);
    expect(serialToIso(45352, false)).toBe('2024-03-01');
    expect(safeSheetName('Q1: [Deals]/2024', new Set())).toBe('Q1   Deals  2024');
    expect(decodeXmlText('a &amp; b &#x41; &lt;')).toBe('a & b A <');
  });

  it('round-trips a workbook through the import reader', () => {
    const bytes = buildXlsx([
      { name: 'Deals', rows: [['Name', 'Amount', 'Close', 'Won'], ['Acme & Co <x>', 1200.5, { date: '2024-03-01' }, true], ['Bob', { number: 7, format: 'currency' }, null, false]] },
      { name: 'Other', rows: [['A'], ['1']] },
    ]);
    const sheets = readXlsx(bytes, { maxRows: 100, maxColumns: 50 });
    expect(sheets.map((sheet) => sheet.name)).toEqual(['Deals', 'Other']);
    expect(sheets[0]?.rows).toEqual([
      ['Name', 'Amount', 'Close', 'Won'],
      ['Acme & Co <x>', '1200.5', '2024-03-01', 'TRUE'],
      ['Bob', '7', '', 'FALSE'],
    ]);
  });

  it('enforces the uncompressed size budget (zip-bomb guard)', () => {
    const workbook = buildXlsx([{ name: 'S', rows: [['h'], ['x'.repeat(5000)]] }]);
    const sheets = readXlsx(workbook, { maxRows: 10, maxColumns: 10, maxUncompressedBytes: 100_000 }).length;
    expect(sheets).toBe(1);
    expect(() => readXlsx(workbook, { maxRows: 10, maxColumns: 10, maxUncompressedBytes: 10 })).toThrow();
  });
});

describe('parseImportFile', () => {
  it('parses CSV and decodes Windows-1252', () => {
    const latin = Uint8Array.from([0x4e, 0x61, 0x6d, 0x65, 0x0a, 0x43, 0x61, 0x66, 0xe9]); // "Name\nCafé" in cp1252
    const result = parseImportFile('people.csv', latin);
    expect(result.sheets[0]?.rows).toEqual([['Name'], ['Café']]);
  });

  it('rejects unsupported and malformed files with friendly messages', () => {
    expect(() => parseImportFile('a.xls', Uint8Array.from([0xd0, 0xcf, 0x11]))).toThrow(/Legacy .xls/);
    expect(() => parseImportFile('a.pdf', Uint8Array.from([0x25, 0x50]))).toThrow(/Upload a .csv/);
    expect(() => parseImportFile('a.xlsx', Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0, 0]))).toThrow(/couldn't read/i);
    expect(() => parseImportFile('a.csv', new Uint8Array())).toThrow(/empty/);
  });
});
