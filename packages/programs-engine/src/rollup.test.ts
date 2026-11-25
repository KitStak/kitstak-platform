import { describe, expect, it } from 'vitest';
import { workDaysInMonth } from './calendar';
import { CALENDAR, PROGRAM_ID, SETUP, VERSIONS, outputFor } from './glove.fixture';
import { monthCharges } from './month';
import { avgUnitPrice, programHeadline, rangeRollup, rollupByDay, rollupByVariant } from './rollup';

function glove(month: string, asOf = '2026-11-25') {
  const days = workDaysInMonth(CALENDAR, month).filter((date) => date < asOf);
  return monthCharges({ programId: PROGRAM_ID, month, asOf, calendar: CALENDAR, versions: VERSIONS, output: outputFor(days), finished: [], time: [], oneTime: month === '2026-09' ? [SETUP] : [] });
}

describe('avgUnitPrice', () => {
  it('E45 161000 cents over 800 units is $2.0125', () => {
    expect(avgUnitPrice(BigInt(161000), '800.000')).toBe('2.0125');
  });
  it('is null with no units', () => {
    expect(avgUnitPrice(BigInt(500), '0')).toBeNull();
  });
  it('keeps the sign for a credit', () => {
    expect(avgUnitPrice(BigInt(-500), '-10')).toBe('0.5000');
  });
});

describe('rollupByVariant', () => {
  it('has one row per variant with units, builds and the average price', () => {
    const result = glove('2026-11');
    const xl = result.byVariant.find((row) => row.variantId === 'v-XL-BRN');
    expect(xl).toMatchObject({ units: '1700.000', builds: 17, perUnitCents: BigInt(374000), avgUnitPrice: '2.2000' });
    expect(result.byVariant).toHaveLength(8);
    expect(result.byVariant[0]!.totalCents >= result.byVariant[7]!.totalCents).toBe(true);
    expect(rollupByVariant(result)).toEqual(result.byVariant);
  });
});

describe('rollupByDay', () => {
  it('lists every day of the month with planned units and a running total', () => {
    const result = glove('2026-11');
    const days = rollupByDay(result, [
      { date: '2026-11-25', qty: '800' },
      { date: '2026-11-25', qty: '50' },
    ]);
    expect(days).toHaveLength(30);
    expect(days[0]).toMatchObject({ date: '2026-11-01', units: '0.000', workCents: BigInt(0), feeCents: BigInt(150000), cumulativeCents: BigInt(150000) });
    expect(days[1]).toMatchObject({ date: '2026-11-02', units: '800.000', workCents: BigInt(161000), cumulativeCents: BigInt(311000) });
    expect(days.find((day) => day.date === '2026-11-25')?.plannedUnits).toBe('850.000');
    expect(days[29]!.cumulativeCents).toBe(result.totalCents);
  });
});

describe('range rollups and the headline', () => {
  it('adds months without rounding again', () => {
    const months = ['2026-09', '2026-10', '2026-11'].map((month) => glove(month));
    const range = rangeRollup(months);
    const total = months.reduce((sum, month) => sum + month.totalCents, BigInt(0));
    expect(range.totalCents).toBe(total);
    expect(range.workCents + range.fixedCents + range.adjustmentCents + range.topUpCents).toBe(total);
    expect(range.fixedCents).toBe(BigInt(80000 + 250000 + 150000 + 150000));
    expect(programHeadline({ months })).toEqual({ revenueCents: total, units: range.units });
    expect(rangeRollup([])).toEqual({ units: '0.000', totalCents: BigInt(0), workCents: BigInt(0), fixedCents: BigInt(0), adjustmentCents: BigInt(0), topUpCents: BigInt(0) });
  });
  it('refuses the same month twice, so revenue is never counted twice (M2)', () => {
    const november = glove('2026-11');
    const october = glove('2026-10');
    expect(() => rangeRollup([october, november, november])).toThrow(new RangeError('Duplicate month 2026-11'));
    expect(() => programHeadline({ months: [november, november] })).toThrow(new RangeError('Duplicate month 2026-11'));
    expect(programHeadline({ months: [october, november] }).revenueCents).toBe(october.totalCents + november.totalCents);
  });
});
