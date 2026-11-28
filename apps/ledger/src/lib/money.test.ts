import { describe, expect, it } from 'vitest';
import { centsToWire, divRound, formatCents, inCentsBounds, lineTax, mulHoursRate, mulQuantityPrice, parseMoney, sumCents, toCents, toScaled } from './money';

const B = (value: number | string): bigint => BigInt(value);

describe('money (SPEC 4.2)', () => {
  it('rounds half away from zero', () => {
    expect(divRound(B(5), B(10))).toBe(B(1));
    expect(divRound(B(-5), B(10))).toBe(B(-1));
    expect(divRound(B(4), B(10))).toBe(B(0));
    expect(() => divRound(B(1), B(0))).toThrow(RangeError);
  });

  it('line amounts of the INV-1042 example', () => {
    expect(mulQuantityPrice('412', '18.5000')).toBe(B(762200));
    expect(mulQuantityPrice(3000, '2.75')).toBe(B(825000));
    expect(mulQuantityPrice('3000.000', '0.0350')).toBe(B(10500));
    expect(mulQuantityPrice('-2', '10')).toBe(B(-2000));
  });

  it('tax per line: the 866 example and halves', () => {
    expect(lineTax(B(10500), 82500)).toBe(B(866));
    expect(lineTax(B(200), 25000)).toBe(B(5));
    expect(lineTax(B(-10500), 82500)).toBe(B(-866));
    expect(() => lineTax(B(1), 250001)).toThrow(RangeError);
  });

  it('hours times a rate in cents (the agency example)', () => {
    expect(mulHoursRate('16.00', B(1975))).toBe(B(31600));
  });

  it('scales decimals exactly', () => {
    expect(toScaled('1.23456', 4)).toBe(B(12346));
    expect(toScaled('-0.5', 0)).toBe(B(-1));
    expect(() => toScaled('abc', 2)).toThrow(RangeError);
  });

  it('sums and wires cents as strings', () => {
    expect(sumCents([B(1), '2', 3, null])).toBe(B(6));
    expect(centsToWire(B(1598566))).toBe('1598566');
    expect(toCents('-45')).toBe(B(-45));
    expect(() => toCents('1.5')).toThrow(RangeError);
  });

  it('formats in en-US', () => {
    expect(formatCents(B(1598566))).toBe('$15,985.66');
    expect(formatCents(B(-4500))).toBe('-$45.00');
    expect(formatCents(B(5))).toBe('$0.05');
  });

  it('parses money as people type it', () => {
    expect(parseMoney('$1,234.50')).toBe(B(123450));
    expect(parseMoney('(45.00)')).toBe(B(-4500));
    expect(parseMoney('-45')).toBe(B(-4500));
    expect(parseMoney('12.3')).toBe(B(1230));
    expect(parseMoney('1,23')).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('ten')).toBeNull();
  });

  it('keeps the cents bounds', () => {
    expect(inCentsBounds(B('10000000000000'))).toBe(true);
    expect(inCentsBounds(B('10000000000001'))).toBe(false);
  });
});
