import { describe, expect, it } from 'vitest';
import {
  FRAC_ONE,
  addCents,
  allocate,
  centsToDecimal,
  centsToNumber,
  changeBp,
  decimalToCents,
  divCeil,
  divFloor,
  divRound,
  frac,
  fracAdd,
  fracCeil,
  fracCmp,
  fracDiv,
  fracMax,
  fracMin,
  fracMul,
  fracOf,
  fracRound,
  fracSub,
  fracToNumber,
  fracToScaled,
  fromScaled,
  marginBp,
  marginGap,
  maxCents,
  minCents,
  mulBp,
  mulHoursRate,
  mulQuantityCents,
  mulQuantityPrice,
  mulRatio,
  perHourCents,
  perUnitCents,
  pow10,
  ratioBp,
  scaledToNumber,
  splitEvenly,
  subCents,
  sumBy,
  sumCents,
  toCents,
  toCentsOrNull,
  toScaled,
} from './money';

const b = (n: number | string): bigint => BigInt(n);

describe('divRound and friends', () => {
  it('rounds half away from zero', () => {
    expect(divRound(b(5), b(10))).toBe(b(1));
    expect(divRound(b(4), b(10))).toBe(b(0));
    expect(divRound(b(-5), b(10))).toBe(b(-1));
    expect(divRound(b(-4), b(10))).toBe(b(0));
    expect(divRound(b(15), b(10))).toBe(b(2));
    expect(divRound(b(25), b(10))).toBe(b(3));
    expect(divRound(b(-25), b(10))).toBe(b(-3));
    expect(divRound(b(0), b(7))).toBe(b(0));
  });
  it('refuses a divisor of zero or less', () => {
    expect(() => divRound(b(1), b(0))).toThrow(RangeError);
    expect(() => divRound(b(1), b(-2))).toThrow(RangeError);
    expect(() => divFloor(b(1), b(0))).toThrow(RangeError);
  });
  it('floors and ceils toward the right side', () => {
    expect(divFloor(b(7), b(2))).toBe(b(3));
    expect(divFloor(b(-7), b(2))).toBe(b(-4));
    expect(divCeil(b(7), b(2))).toBe(b(4));
    expect(divCeil(b(-7), b(2))).toBe(b(-3));
    expect(divCeil(b(8), b(2))).toBe(b(4));
  });
  it('handles numbers far past 2^53', () => {
    expect(divRound(b('900000000000000000000001'), b(2))).toBe(b('450000000000000000000001'));
  });
});

describe('reading cents', () => {
  it('accepts bigint, safe integers and integer strings', () => {
    expect(toCents(b(12))).toBe(b(12));
    expect(toCents(1250)).toBe(b(1250));
    expect(toCents(' -42 ')).toBe(b(-42));
    expect(toCents('9999999999999')).toBe(b('9999999999999'));
  });
  it('refuses fractions and junk', () => {
    expect(() => toCents(12.5)).toThrow(RangeError);
    expect(() => toCents('12.50')).toThrow(RangeError);
    expect(() => toCents('abc')).toThrow(RangeError);
    expect(() => toCents(Number.NaN)).toThrow(RangeError);
  });
  it('keeps null as null', () => {
    expect(toCentsOrNull(null)).toBeNull();
    expect(toCentsOrNull(undefined)).toBeNull();
    expect(toCentsOrNull('7')).toBe(b(7));
  });
  it('converts to a number only when exact', () => {
    expect(centsToNumber(b(123456))).toBe(123456);
    expect(() => centsToNumber(b('90071992547409930'))).toThrow(RangeError);
  });
});

describe('scaled decimals', () => {
  it('scales exact strings and numbers', () => {
    expect(toScaled('92.00', 2)).toBe(b(9200));
    expect(toScaled('92.5', 2)).toBe(b(9250));
    expect(toScaled(92.5, 2)).toBe(b(9250));
    expect(toScaled('0.0350', 4)).toBe(b(350));
    expect(toScaled('.5', 2)).toBe(b(50));
    expect(toScaled('7.', 2)).toBe(b(700));
    expect(toScaled('-1.25', 2)).toBe(b(-125));
    expect(toScaled(b(3), 2)).toBe(b(300));
    expect(toScaled(3000, 3)).toBe(b(3000000));
  });
  it('rounds extra places half away from zero', () => {
    expect(toScaled('1.005', 2)).toBe(b(101));
    expect(toScaled('1.004', 2)).toBe(b(100));
    expect(toScaled('-1.005', 2)).toBe(b(-101));
    expect(toScaled(0.1 + 0.2, 2)).toBe(b(30));
    expect(toScaled('0.999', 2)).toBe(b(100));
  });
  it('reads numbers in exponent form', () => {
    expect(toScaled(1e-7, 4)).toBe(b(0));
    expect(toScaled(1.5e-3, 4)).toBe(b(15));
    expect(toScaled(1e21, 0)).toBe(b('1000000000000000000000'));
    expect(toScaled(-2.5e-2, 3)).toBe(b(-25));
  });
  it('refuses text that is not a number', () => {
    expect(() => toScaled('', 2)).toThrow(RangeError);
    expect(() => toScaled('.', 2)).toThrow(RangeError);
    expect(() => toScaled('9x', 2)).toThrow(RangeError);
    expect(() => toScaled('1,234', 2)).toThrow(RangeError);
    expect(() => toScaled(Number.POSITIVE_INFINITY, 2)).toThrow(RangeError);
  });
  it('turns scaled values back into text and numbers', () => {
    expect(fromScaled(b(9250), 2)).toBe('92.50');
    expect(fromScaled(b(-5), 2)).toBe('-0.05');
    expect(fromScaled(b(7), 0)).toBe('7');
    expect(fromScaled(b(350), 4)).toBe('0.0350');
    expect(scaledToNumber(b(18750), 2)).toBe(187.5);
    expect(pow10(5)).toBe(b(100000));
    expect(() => pow10(-1)).toThrow(RangeError);
  });
  it('moves between decimal money and cents', () => {
    expect(decimalToCents('1234.5')).toBe(b(123450));
    expect(decimalToCents(19.99)).toBe(b(1999));
    expect(centsToDecimal(b(123450))).toBe('1234.50');
    expect(centsToDecimal(-5)).toBe('-0.05');
  });
});

describe('adding', () => {
  it('adds, subtracts and sums', () => {
    expect(addCents(b(100), 250, '50')).toBe(b(400));
    expect(addCents()).toBe(b(0));
    expect(subCents(100, 250)).toBe(b(-150));
    expect(sumCents([b(1), null, 2, undefined, '3'])).toBe(b(6));
    expect(sumBy([{ c: b(5) }, { c: null }, { c: b(7) }], (row) => row.c)).toBe(b(12));
    expect(minCents(b(1), b(2))).toBe(b(1));
    expect(maxCents(b(1), b(2))).toBe(b(2));
  });
});

describe('multiplying (the spec examples from 4.2)', () => {
  it('92.00 hours at 2176 cents is 200192', () => {
    expect(mulHoursRate('92.00', 2176)).toBe(b(200192));
  });
  it('3,000 units at $2.7500 is 825000', () => {
    expect(mulQuantityPrice('3000', '2.7500')).toBe(b(825000));
    expect(mulQuantityPrice(3000, 2.75)).toBe(b(825000));
  });
  it('rounds once, at the cent', () => {
    expect(mulHoursRate('0.01', 50)).toBe(b(1)); // 0.5 cents rounds away from zero
    expect(mulHoursRate('0.01', 49)).toBe(b(0));
    expect(mulQuantityPrice('1', '0.0350')).toBe(b(4)); // 3.5 cents
    expect(mulQuantityPrice('1000', '0.0350')).toBe(b(3500));
    expect(mulQuantityPrice('0.333', '2.9999')).toBe(b(100));
    expect(mulQuantityCents('2.5', 199)).toBe(b(498)); // 497.5
  });
  it('multiplies by basis points and ratios', () => {
    expect(mulBp(10000, 800)).toBe(b(800));
    expect(mulBp(b(12345), 2500)).toBe(b(3086)); // 3086.25
    expect(mulBp(b(-12350), 5000)).toBe(b(-6175));
    expect(mulRatio(10000, b(2), b(3))).toBe(b(6667));
  });
  it('stays exact at the top of the allowed range', () => {
    // just under 100,000,000 units at just under $1,000,000
    expect(mulQuantityPrice('99999999.999', '999999.9999')).toBe(b('9999999998900000'));
  });
});

describe('ratios people read', () => {
  it('margin is profit over revenue in basis points', () => {
    expect(marginBp(391250, 1750000)).toBe(2236);
    expect(marginBp(-100, 1000)).toBe(-1000);
    expect(marginBp(0, 1000)).toBe(0);
  });
  it('is null, never 0 and never infinity, with no revenue', () => {
    expect(marginBp(500, 0)).toBeNull();
    expect(marginBp(500, -10)).toBeNull();
    expect(marginGap(500, 0)).toBe('no_revenue');
    expect(marginGap(500, -10)).toBe('negative_revenue');
    expect(marginGap(500, 1000)).toBeNull();
  });
  it('is null outside plus or minus 1,000,000 bp', () => {
    expect(marginBp(-1000001, 10000)).toBeNull();
    expect(marginGap(-1000001, 10000)).toBe('out_of_range');
    expect(ratioBp(1000000, 10000)).toBe(1000000);
  });
  it('change is measured against the size of the earlier number', () => {
    expect(changeBp(120, 100)).toBe(2000);
    expect(changeBp(80, 100)).toBe(-2000);
    expect(changeBp(50, -100)).toBe(15000);
    expect(changeBp(50, 0)).toBeNull();
  });
  it('per unit and per hour are null with nothing to divide by', () => {
    expect(perUnitCents(1358750, 10000)).toBe(b(136));
    expect(perUnitCents(100, 0)).toBeNull();
    expect(perUnitCents(100, '-1')).toBeNull();
    expect(perHourCents(115000, 50)).toBe(b(2300));
    expect(perHourCents(115000, 0)).toBeNull();
  });
});

describe('allocate (largest remainder)', () => {
  it('matches the spec example: $100.00 over 96.00, 40.00 and 24.50 hours', () => {
    expect(allocate(10000, [b(9600), b(4000), b(2450)])).toEqual([b(5981), b(2492), b(1527)]);
  });
  it('always adds up to the total', () => {
    const cases: [number, number[]][] = [
      [1, [1, 1, 1]],
      [100, [1, 1, 1]],
      [9999, [3, 7, 11, 13]],
      [5, [0, 0, 9]],
      [123456789, [1, 2, 3, 4, 5, 6, 7]],
    ];
    for (const [total, weights] of cases) {
      const parts = allocate(total, weights.map(b));
      expect(parts.reduce((sum, part) => sum + part, b(0))).toBe(b(total));
    }
  });
  it('gives ties to the earlier row', () => {
    expect(allocate(1, [b(1), b(1), b(1)])).toEqual([b(1), b(0), b(0)]);
    expect(allocate(2, [b(1), b(1), b(1)])).toEqual([b(1), b(1), b(0)]);
  });
  it('spreads a negative total the same way', () => {
    expect(allocate(-10000, [b(9600), b(4000), b(2450)])).toEqual([b(-5981), b(-2492), b(-1527)]);
  });
  it('spreads nothing when every weight is zero', () => {
    expect(allocate(500, [b(0), b(0)])).toEqual([b(0), b(0)]);
    expect(allocate(500, [])).toEqual([]);
  });
  it('refuses a weight below zero', () => {
    expect(() => allocate(500, [b(1), b(-1)])).toThrow(RangeError);
  });
  it('splits evenly with the extra cents first', () => {
    expect(splitEvenly(100, 3)).toEqual([b(34), b(33), b(33)]);
    expect(() => splitEvenly(100, 0)).toThrow(RangeError);
  });
});

describe('fractions', () => {
  it('reduces and keeps the sign on top', () => {
    expect(frac(b(6), b(-4))).toEqual({ n: b(-3), d: b(2) });
    expect(frac(b(0), b(5))).toEqual({ n: b(0), d: b(1) });
    expect(() => frac(b(1), b(0))).toThrow(RangeError);
  });
  it('does exact math', () => {
    const third = frac(b(1), b(3));
    expect(fracAdd(third, third)).toEqual(frac(b(2), b(3)));
    expect(fracSub(FRAC_ONE, third)).toEqual(frac(b(2), b(3)));
    expect(fracMul(third, frac(b(3)))).toEqual(FRAC_ONE);
    expect(fracDiv(third, third)).toEqual(FRAC_ONE);
    expect(fracCmp(third, frac(b(1), b(2)))).toBe(-1);
    expect(fracCmp(third, frac(b(2), b(6)))).toBe(0);
    expect(fracMin(third, FRAC_ONE)).toEqual(third);
    expect(fracMax(third, FRAC_ONE)).toEqual(FRAC_ONE);
    expect(fracOf('92.5', 2)).toEqual(frac(b(185), b(2)));
  });
  it('rounds only when asked', () => {
    expect(fracRound(frac(b(5), b(2)))).toBe(b(3));
    expect(fracRound(frac(b(-5), b(2)))).toBe(b(-3));
    expect(fracCeil(frac(b(6000), b(320)))).toBe(b(19));
    expect(fracToScaled(frac(b(1), b(3)), 3)).toBe(b(333));
    expect(fracToNumber(frac(b(2), b(3)), 2)).toBe(0.67);
  });
});
