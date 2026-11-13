import { describe, expect, it } from 'vitest';
import { buildColumns, resolveColumns, toCsv } from './table-columns';

describe('toCsv', () => {
  it('quotes commas, quotes and newlines, and neutralises formulas', () => {
    const csv = toCsv([
      ['ID', 'Task'],
      ['OPS-1', 'Pack, label and ship'],
      ['OPS-2', 'Say "hi"'],
      ['OPS-3', '=SUM(A1:A2)'],
      ['OPS-4', '-1200'],
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[1]).toBe('OPS-1,"Pack, label and ship"');
    expect(lines[2]).toBe('OPS-2,"Say ""hi"""');
    expect(lines[3]).toBe(`OPS-3,"'=SUM(A1:A2)"`);
    expect(lines[4]).toBe('OPS-4,-1200');
  });
});

describe('resolveColumns', () => {
  const defs = buildColumns([
    { id: 'f1', projectId: 'p', name: 'Budget', type: 'currency', config: { currency: 'USD' }, description: null, required: false, position: 'a0' },
  ]);
  it('keeps the task name first and visible, and drops unknown keys', () => {
    const columns = resolveColumns(defs, [{ key: 'status' }, { key: 'title', hidden: true }, { key: 'custom:gone' }]);
    expect(columns[0]).toMatchObject({ key: 'title', hidden: false });
    expect(columns.some((column) => column.key === 'custom:gone')).toBe(false);
    expect(columns.find((column) => column.key === 'custom:f1')?.hidden).toBe(true);
  });
  it('shows custom fields on a fresh table', () => {
    expect(resolveColumns(defs, []).find((column) => column.key === 'custom:f1')?.hidden).toBe(false);
  });
});
