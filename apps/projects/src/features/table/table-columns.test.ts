import { describe, expect, it } from 'vitest';
import { buildColumns, fitColumns, resolveColumns, toCsv } from './table-columns';

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

describe('fitColumns', () => {
  const cols = [
    { key: 'status', natural: 140, floor: 128, compact: 132 },
    { key: 'assignee', natural: 132, floor: 132, compact: 64 },
    { key: 'priority', natural: 112, floor: 112, compact: 64 },
    { key: 'labels', natural: 180, floor: 120 },
    { key: 'customer', natural: 180, floor: 124 },
  ];
  it('keeps automatic widths when the Task column already has its room', () => {
    const fit = fitColumns(cols, 1400, 400, 280);
    expect(fit.compact).toBe(false);
    expect(fit.widths.get('labels')).toBe(180);
    expect(fit.titleWidth).toBe(1400 - 744);
  });
  it('shrinks other columns toward their floors before the Task column gives up room', () => {
    const fit = fitColumns(cols, 1100, 400, 280);
    expect(fit.compact).toBe(false);
    expect(fit.titleWidth).toBe(400);
    expect(fit.widths.get('labels')).toBeLessThan(180);
    expect(fit.widths.get('labels')).toBeGreaterThanOrEqual(120);
  });
  it('goes compact (avatar, icon) before scrolling, and never squeezes Task under its minimum', () => {
    const fit = fitColumns(cols, 900, 400, 280);
    expect(fit.compact).toBe(true);
    expect(fit.widths.get('assignee')).toBe(64);
    const tiny = fitColumns(cols, 500, 400, 280);
    expect(tiny.titleWidth).toBe(280);
  });
});
