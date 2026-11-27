import { describe, expect, it } from 'vitest';
import { addTenPercent, applySchedule, cellKey, copyFrom, dayInfo, daysFor, existingByCell, fillDown, fillRight, rowsToCreate, suggestFromHistory, totalsOf, fillDefaultQty, type DayInfo, type ExistingBuild, type PlannerVariant } from './planner-model';

const calendar = { workingDays: [1, 2, 3, 4, 5], daysOff: [] as string[], extraWorkDays: [] as string[] };
const holidays = new Map([['2026-11-26', 'Thanksgiving']]);
// Week of Mon Nov 23 2026.
const week = daysFor('week', '2026-11-25');
const infos: DayInfo[] = week.map((date) => dayInfo(date, calendar, holidays, '2026-10-31'));
const info = (date: string) => infos.find((day) => day.date === date);
const variants: PlannerVariant[] = [
  { id: 'a', name: 'Small Brown', defaultQty: '100.000', unitPrice: '1.9500', stdMinutesPerUnit: '1.500' },
  { id: 'b', name: 'XL Brown', defaultQty: null, unitPrice: '2.2000', stdMinutesPerUnit: null },
];
const build = (id: string, variantId: string, date: string, planned: string, built = '0.000'): ExistingBuild => ({ id, key: `G-${id}`, variantId, date, plannedQty: planned, builtQty: built, cancelled: false });

describe('days', () => {
  it('shows Monday to Sunday and marks holidays and weekends', () => {
    expect(week[0]).toBe('2026-11-23');
    expect(week).toHaveLength(7);
    expect(info('2026-11-26')).toMatchObject({ work: false, offName: 'Thanksgiving' });
    expect(info('2026-11-28')).toMatchObject({ work: false, offName: 'Weekend' });
    expect(daysFor('2weeks', '2026-11-25')).toHaveLength(14);
    expect(daysFor('day', '2026-11-25')).toEqual(['2026-11-25']);
  });
});

describe('fills', () => {
  it('fills default qty on work days only and never over existing builds', () => {
    const existing = existingByCell([build('1', 'a', '2026-11-23', '100.000')]);
    const cells = fillDefaultQty(new Map(), variants, infos, existing);
    expect(cells.get(cellKey('a', '2026-11-23'))).toBeUndefined();
    expect(cells.get(cellKey('a', '2026-11-24'))).toBe('100');
    expect(cells.get(cellKey('a', '2026-11-26'))).toBeUndefined();
    expect(cells.get(cellKey('b', '2026-11-24'))).toBeUndefined();
  });

  it('copies last week from history', () => {
    const history = existingByCell([build('9', 'b', '2026-11-17', '40.000')]);
    const cells = copyFrom(new Map(), variants, infos, new Map(), history, -7);
    expect(cells.get(cellKey('b', '2026-11-24'))).toBe('40');
  });

  it('applies a schedule with qty by weekday', () => {
    const cells = applySchedule(new Map(), { pattern: 'weekdays', days: [], lines: [{ variantId: 'a', qty: '100.000', qtyByWeekday: { '5': '50' } }] }, infos, new Map(), calendar);
    expect(cells.get(cellKey('a', '2026-11-27'))).toBe('50');
    expect(cells.get(cellKey('a', '2026-11-25'))).toBe('100');
    expect(cells.has(cellKey('a', '2026-11-26'))).toBe(false);
  });

  it('suggests the average built per weekday in whole units', () => {
    const history = [build('1', 'b', '2026-11-16', '100.000', '90.000'), build('2', 'b', '2026-11-09', '100.000', '95.000')];
    const result = suggestFromHistory(new Map(), variants, infos, new Map(), history);
    expect(result.cells.get(cellKey('b', '2026-11-23'))).toBe('93');
    expect(result.suggested.has(cellKey('b', '2026-11-23'))).toBe(true);
  });
});

describe('selection', () => {
  const block = { rows: ['a', 'b'], days: ['2026-11-23', '2026-11-24', '2026-11-25'] };
  it('fills right and down and adds 10 percent', () => {
    const base = new Map([
      [cellKey('a', '2026-11-23'), '100'],
      [cellKey('b', '2026-11-23'), '40'],
    ]);
    const right = fillRight(base, block, info);
    expect(right.get(cellKey('b', '2026-11-25'))).toBe('40');
    const down = fillDown(base, block, info);
    expect(down.get(cellKey('b', '2026-11-23'))).toBe('100');
    expect(addTenPercent(base, block).get(cellKey('b', '2026-11-23'))).toBe('44');
  });
});

describe('totals and rows', () => {
  it('sums units, money and hours exactly', () => {
    const cells = new Map([
      [cellKey('a', '2026-11-23'), '100'],
      [cellKey('b', '2026-11-23'), '40'],
      [cellKey('b', '2026-11-24'), 'abc'],
    ]);
    const totals = totalsOf(cells, variants, week);
    expect(totals.builds).toBe(2);
    expect(totals.units).toBe('140.000');
    expect(totals.revenueCents).toBe('28300');
    expect(totals.hours).toBe('2.50');
    expect(totals.invalid).toBe(1);
  });

  it('skips cells that already have a build when one per day is on', () => {
    const cells = new Map([
      [cellKey('a', '2026-11-23'), '100'],
      [cellKey('a', '2026-11-24'), '100'],
    ]);
    const existing = existingByCell([build('1', 'a', '2026-11-23', '100.000')]);
    expect(rowsToCreate(cells, variants, infos, existing, { onePerDay: true, assigneeId: null })).toEqual({ rows: [{ variantId: 'a', buildDate: '2026-11-24', plannedQty: '100.000', assigneeId: null }], alreadyExisted: 1 });
    expect(rowsToCreate(cells, variants, infos, existing, { onePerDay: false, assigneeId: 'u' }).rows).toHaveLength(2);
  });
});
