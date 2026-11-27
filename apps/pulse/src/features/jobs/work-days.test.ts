import { describe, expect, it } from 'vitest';
import type { ProductionEntryDTO } from '@/lib/types';
import { groupJobDays, groupWorkDays, hasShifts, isEmptyEntry, laborLineWords, planDayLines, repeatedLaborLines, restoreDayLines, shiftWords } from './work-days';

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

describe('shifts on one day', () => {
  it('lets a day line and a night line share a labor class, and still catches a repeat on one shift', () => {
    expect(repeatedLaborLines([{ laborClassId: 'a', shift: 'day' }, { laborClassId: 'a', shift: 'night' }])).toEqual([]);
    expect(repeatedLaborLines([{ laborClassId: 'a', shift: 'night' }, { laborClassId: 'a', shift: 'night' }])).toEqual([0, 1]);
    expect(repeatedLaborLines([{ laborClassId: 'a' }, { laborClassId: 'a', shift: 'day' }])).toEqual([0, 1]);
  });

  it('names the shift only when it is not the usual day shift', () => {
    expect(shiftWords('day')).toBeNull();
    expect(shiftWords(null)).toBeNull();
    expect(shiftWords('night')).toBe('Night shift');
  });

  it('says which shift each line is on in the delete question when the day has two', () => {
    const rows = [{ shift: 'day', hours: '1.00' }, { shift: 'night', hours: '8.00' }];
    expect(hasShifts(rows)).toBe(true);
    expect(rows.map((row) => laborLineWords(row, 'Machine operator', hasShifts(rows), (hours) => String(Number(hours))))).toEqual([
      'Machine operator, day shift, 1 hour',
      'Machine operator, night shift, 8 hours',
    ]);
    expect(laborLineWords({ shift: 'day', hours: '4.00' }, 'Packer', false, (hours) => String(Number(hours)))).toBe('Packer, 4 hours');
  });

  it('keeps the shift of a line read from the day when it saves', () => {
    const [line] = planDayLines({ unitsGood: '1', unitsScrap: '0', note: null, lines: [{ id: 'x', laborClassId: 'a', shift: 'night', headcount: '1', hours: '8', setupHours: '0', overtimeHours: '0' }] });
    expect(line?.shift).toBe('night');
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

describe('groupJobDays', () => {
  it('keeps two jobs on one date apart and rolls each job day up', () => {
    const days = groupJobDays([
      entry({ id: 'a', jobId: 'j1', laborClassId: 'team', headcount: '4', hours: '32', laborCostCents: 64000 }),
      entry({ id: 'b', jobId: 'j1', laborClassId: 'temp', unitsGood: '243', headcount: '8', hours: '64', laborCostCents: 108800 }),
      entry({ id: 'c', jobId: 'j2', unitsGood: '50', headcount: '2', hours: '16' }),
    ]);
    expect(days).toHaveLength(2);
    expect(days[0]?.jobId).toBe('j1');
    expect(days[0]?.day.rows.map((row) => row.id)).toEqual(['b', 'a']);
    expect(Number(days[0]?.day.unitsGood)).toBe(243);
    expect(Number(days[0]?.day.headcount)).toBe(12);
    expect(days[0]?.day.laborCostCents).toBe(172800);
    expect(days[1]?.day.rows).toHaveLength(1);
  });
});
