import { describe, expect, it } from 'vitest';
import type { ProductionEntryDTO } from '@/lib/types';
import { groupWorkDays, isEmptyEntry, planDayLines, repeatedLaborLines, restoreDayLines } from './work-days';

const entry = (over: Partial<ProductionEntryDTO>): ProductionEntryDTO =>
  ({
    id: 'a',
    version: 1,
    workDate: '2026-11-17',
    laborClassId: 'team',
    unitsGood: '0',
    unitsScrap: '0',
    unitsRework: '0',
    headcount: null,
    hours: '0',
    setupHours: '0',
    overtimeHours: '0',
    hoursConfirmed: true,
    rateCents: null,
    laborCostCents: null,
    needsRate: false,
    locked: false,
    note: null,
    source: 'csv',
    ...over,
  }) as ProductionEntryDTO;

describe('groupWorkDays', () => {
  it('rolls two labor types on one day into one line', () => {
    const days = groupWorkDays([
      entry({ id: 'a', laborClassId: 'team', headcount: '4', hours: '32', rateCents: 2000, laborCostCents: 64000 }),
      entry({ id: 'b', laborClassId: 'temp', unitsGood: '243', headcount: '8', hours: '64', rateCents: 1700, laborCostCents: 108800 }),
      entry({ id: 'c', workDate: '2026-11-16', unitsGood: '132', hours: '56', laborCostCents: 95200 }),
    ]);
    expect(days).toHaveLength(2);
    const [first] = days;
    expect(first?.workDate).toBe('2026-11-17');
    expect(Number(first?.unitsGood)).toBe(243);
    expect(Number(first?.headcount)).toBe(12);
    expect(Number(first?.hours)).toBe(96);
    expect(first?.laborCostCents).toBe(172800);
    // Blended: $1,728 over 96 hours is $18.00 an hour.
    expect(first?.rateCents).toBe(1800);
    expect(first?.pace).toBeCloseTo(243 / 96, 2);
  });

  it('keeps cost null when money is hidden', () => {
    const [day] = groupWorkDays([entry({ hours: '8' })]);
    expect(day?.laborCostCents).toBeNull();
    expect(day?.rateCents).toBeNull();
  });
});

describe('planDayLines', () => {
  it('puts units, rework and note on the first line and hours on every line', () => {
    const lines = planDayLines({
      unitsGood: '243',
      unitsScrap: '2',
      unitsRework: '1',
      note: 'busy',
      lines: [
        { id: 'a', laborClassId: 'team', headcount: '4', hours: '32', setupHours: '0', overtimeHours: '0' },
        { id: null, laborClassId: 'temp', headcount: '8', hours: '64', setupHours: '0', overtimeHours: '0' },
      ],
    });
    expect(lines[0]).toMatchObject({ id: 'a', unitsGood: '243', unitsScrap: '2', unitsRework: '1', note: 'busy', hours: '32' });
    expect(lines[1]).toMatchObject({ id: null, unitsGood: '0', unitsScrap: '0', unitsRework: '0', note: null, hours: '64' });
  });
});

describe('restoreDayLines', () => {
  it('sends a row that is still there with its id and a row that is gone as a new line, values as they were', () => {
    const before = [
      { id: 'a', laborClassId: 'team', shift: 'day', unitsGood: '500.000', unitsScrap: '5.000', unitsRework: '0.000', headcount: '6.00', hours: '48.00', setupHours: '0.00', overtimeHours: '0.00', hoursConfirmed: true, note: 'first' },
      { id: 'b', laborClassId: 'lead', shift: 'day', unitsGood: '0.000', unitsScrap: '0.000', unitsRework: '0.000', headcount: '1.00', hours: '4.00', setupHours: '0.00', overtimeHours: '0.00', hoursConfirmed: true, note: null },
    ] as unknown as Parameters<typeof restoreDayLines>[0];
    const lines = restoreDayLines(before, new Set(['a']));
    expect(lines[0]).toMatchObject({ id: 'a', unitsGood: '500.000', hours: '48.00', headcount: '6.00', note: 'first' });
    expect(lines[1]).toMatchObject({ id: null, laborClassId: 'lead', hours: '4.00', headcount: '1.00' });
  });
});

describe('repeatedLaborLines', () => {
  it('names every line of a labor class picked twice', () => {
    expect(repeatedLaborLines([{ laborClassId: 'a' }, { laborClassId: 'b' }])).toEqual([]);
    expect(repeatedLaborLines([{ laborClassId: 'a' }, { laborClassId: 'b' }, { laborClassId: 'a' }])).toEqual([0, 2]);
  });
});

describe('isEmptyEntry', () => {
  it('is true only for a row with nothing on it', () => {
    const row = { unitsGood: '0.000', unitsScrap: '0.000', unitsRework: '0.000', hours: '0.00', headcount: null, note: null } as unknown as Parameters<typeof isEmptyEntry>[0];
    expect(isEmptyEntry(row)).toBe(true);
    expect(isEmptyEntry({ ...row, unitsGood: '1.000' })).toBe(false);
    expect(isEmptyEntry({ ...row, note: 'waiting on parts' })).toBe(false);
    expect(isEmptyEntry({ ...row, headcount: '2.00' })).toBe(false);
  });
});
