import { describe, expect, it } from 'vitest';
import type { ProductionEntryDTO } from '@/lib/types';
import { groupWorkDays, planDaySave, repeatedLaborClass } from './work-days';

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

describe('planDaySave', () => {
  it('puts units and note on the first line and removes dropped lines', () => {
    const plan = planDaySave({
      jobId: 'job',
      workDate: '2026-11-17',
      unitsGood: '243',
      unitsScrap: '2',
      note: 'busy',
      existingIds: ['a', 'b'],
      lines: [
        { id: 'a', version: 3, laborClassId: 'team', headcount: '4', hours: '32', setupHours: '0', overtimeHours: '0' },
        { id: null, laborClassId: 'temp', headcount: '8', hours: '64', setupHours: '0', overtimeHours: '0' },
      ],
    });
    expect(plan.entries[0]).toMatchObject({ id: 'a', version: 3, unitsGood: '243', unitsScrap: '2', note: 'busy' });
    expect(plan.entries[1]).toMatchObject({ id: null, unitsGood: '0', unitsScrap: '0', note: null, hours: '64' });
    expect(plan.entries[1]).not.toHaveProperty('version');
    expect(plan.removeIds).toEqual(['b']);
  });
});

describe('repeatedLaborClass', () => {
  it('finds a labor type picked twice', () => {
    expect(repeatedLaborClass([{ laborClassId: 'a' }, { laborClassId: 'b' }])).toBeNull();
    expect(repeatedLaborClass([{ laborClassId: 'a' }, { laborClassId: 'a' }])).toBe('a');
  });
});
