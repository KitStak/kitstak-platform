import { describe, expect, it } from 'vitest';
import { EMPTY_CALC, blendedRateCents, bpToPercent, crewHeadcount, percentToBp, reviveInputs, runCalc, scalePrice, toQuoteInput, trimDecimal, type CalcInputs } from './calc-model';

const base: CalcInputs = {
  ...EMPTY_CALC,
  units: '10,000',
  standardUph: '40',
  crew: [{ laborClassId: null, label: 'Packers', headcount: '5', rate: '$22.00' }],
  materialPerUnit: '0.45',
  otherCosts: [{ label: 'Freight', amount: '1,000' }],
  targetMarginPct: '30',
};

describe('calculator form model', () => {
  it('blends a mixed crew by people', () => {
    expect(blendedRateCents([{ laborClassId: null, label: 'a', headcount: '2', rate: '20' }, { laborClassId: null, label: 'b', headcount: '1', rate: '26' }])).toBe(BigInt(2200));
    expect(crewHeadcount([{ laborClassId: null, label: 'a', headcount: '2', rate: '20' }, { laborClassId: null, label: 'b', headcount: '1.5', rate: '26' }])).toBe('3.50');
    expect(blendedRateCents([{ laborClassId: null, label: 'a', headcount: '2', rate: '' }])).toBeNull();
  });

  it('matches the worked example of the quote library', () => {
    const run = runCalc(base);
    expect(run.errors).toEqual({});
    expect(run.summary?.laborHours).toBe(250);
    expect(run.summary?.laborCents).toBe(550000);
    expect(run.summary?.costCents).toBe(1100000);
    expect(run.summary?.target?.pricePerUnit).toBe('1.5715');
    expect(run.summary?.target?.meetsTarget).toBe(true);
    expect(run.summary?.chosen?.pricePerUnit).toBe('1.5715');
    expect(run.plan?.revenueCents).toBe(1571500);
    expect(run.plan?.otherCents).toBe(100000);
  });

  it('uses a typed price and flags one under the lowest price worth taking', () => {
    const run = runCalc({ ...base, sharedPct: '10', pricePerUnit: '1.00' });
    expect(run.summary?.atPrice?.pricePerUnit).toBe('1.0000');
    expect(run.summary?.chosen?.profitCents).toBeLessThan(0);
    expect(run.summary?.belowLowest).toBe(true);
    expect(run.summary?.sharedCents).toBe(55000);
  });

  it('counts no material when the client buys the parts', () => {
    expect(runCalc({ ...base, partsOwner: 'client' }).summary?.materialCents).toBe(0);
  });

  it('builds a five by five grid around the chosen price', () => {
    const grid = runCalc(base).grid;
    expect(grid?.rows).toHaveLength(5);
    expect(grid?.prices).toHaveLength(5);
    expect(grid?.prices[grid.baseColumn]).toBe('1.5715');
    const middle = grid?.rows[2]?.cells[2];
    expect(middle?.marginBp).toBeGreaterThanOrEqual(3000);
    // A slower crew at the same price earns less.
    expect(grid?.rows[0]?.cells[2]?.profitCents).toBeLessThan(middle?.profitCents ?? 0);
  });

  it('says what to type when a field is empty or wrong', () => {
    const empty = toQuoteInput(EMPTY_CALC);
    expect(empty.input).toBeNull();
    expect(empty.incomplete).toBe(true);
    expect(empty.errors.units).toMatch(/units/);
    const bad = toQuoteInput({ ...base, units: 'abc', targetMarginPct: '100' });
    expect(bad.errors.units).toBeTruthy();
    expect(bad.errors.targetMarginPct).toMatch(/100%/);
  });

  it('reads percents, prices and stored inputs', () => {
    expect(percentToBp('30.5')).toBe(3050);
    expect(bpToPercent(3050)).toBe('30.5');
    expect(bpToPercent(3000)).toBe('30');
    expect(scalePrice('2.0000', 9500)).toBe('1.9000');
    expect(trimDecimal('2.7500')).toBe('2.75');
    expect(trimDecimal('40')).toBe('40');
    const revived = reviveInputs({ units: 500, crew: [], partsOwner: 'client', services: [{ label: 'Labels', quantity: '10', unitPrice: '1' }] });
    expect(revived.units).toBe('500');
    expect(revived.crew).toHaveLength(1);
    expect(revived.partsOwner).toBe('client');
    expect(revived.services[0]?.costPerUnit).toBe('');
    expect(reviveInputs(null)).toEqual(EMPTY_CALC);
  });
});
