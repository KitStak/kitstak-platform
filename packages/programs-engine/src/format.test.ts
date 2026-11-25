import { describe, expect, it } from 'vitest';
import { formatCents, formatHours, formatMarginBp, formatPercentBp, formatQty, formatUnitPrice, unitLabel } from './format';

describe('formatCents', () => {
  it('matches the pulse-bridge output', () => {
    expect(formatCents(1234567)).toBe('$12,346');
    expect(formatCents(1234567, { cents: true })).toBe('$12,345.67');
    expect(formatCents(-5000)).toBe('-$50');
    expect(formatCents(null)).toBe('Hidden');
    expect(formatCents(undefined, { empty: 'None' })).toBe('None');
  });
  it('takes bigint and integer strings without floats', () => {
    expect(formatCents(BigInt('123456789012345678'), { cents: true })).toBe('$1,234,567,890,123,456.78');
    expect(formatCents('153000')).toBe('$1,530');
    expect(formatCents('-20000', { cents: true })).toBe('-$200.00');
    expect(formatCents(-40)).toBe('$0');
    expect(formatCents(150)).toBe('$2');
  });
  it('shows a fraction of a cent as display only', () => {
    expect(formatCents(12.5, { cents: true })).toBe('$0.13');
    expect(formatCents('12.5')).toBe('$0');
    expect(formatCents('abc')).toBe('Hidden');
    expect(formatCents(Number.POSITIVE_INFINITY)).toBe('Hidden');
  });
  it('has a compact form', () => {
    expect(formatCents(BigInt(3692000), { compact: true })).toBe('$37K');
    expect(formatCents(BigInt(369200), { compact: true })).toBe('$3.7K');
    expect(formatCents(BigInt(123456789), { compact: true })).toBe('$1.2M');
    expect(formatCents(BigInt(99999999), { compact: true })).toBe('$1M');
    expect(formatCents(BigInt(15000000), { compact: true })).toBe('$150K');
    expect(formatCents(BigInt(-250000), { compact: true })).toBe('-$2.5K');
    expect(formatCents(BigInt(99900), { compact: true })).toBe('$999');
  });
  it('uses other currencies', () => {
    expect(formatCents(150000, { currency: 'EUR' })).toBe('€1,500');
    expect(formatCents(150000, { currency: 'ZZZ1' })).toBe('ZZZ1 1,500');
  });
});

describe('other formats', () => {
  it('formatMarginBp', () => {
    expect(formatMarginBp(3150)).toBe('31.5%');
    expect(formatMarginBp(-1266)).toBe('-12.7%');
    expect(formatMarginBp(null)).toBe('No margin yet');
    expect(formatMarginBp(3000)).toBe('30%');
    expect(formatMarginBp(0)).toBe('0%');
  });
  it('formatMarginBp never prints -0% and rounds half away from zero', () => {
    for (const bp of [-1, -2, -3, -4, 1, 4, -0, -0.4]) expect(formatMarginBp(bp)).toBe('0%');
    expect(formatMarginBp(-5)).toBe('-0.1%');
    expect(formatMarginBp(5)).toBe('0.1%');
    expect(formatMarginBp(-15)).toBe('-0.2%');
    expect(formatMarginBp(15)).toBe('0.2%');
    expect(formatMarginBp(-95)).toBe('-1%');
    expect(formatMarginBp(9995)).toBe('100%');
    expect(formatMarginBp(9994)).toBe('99.9%');
    expect(formatMarginBp(1234567)).toBe('12,345.7%');
    expect(formatMarginBp(-1234567)).toBe('-12,345.7%');
    expect(formatMarginBp(Number.POSITIVE_INFINITY, { empty: '' })).toBe('');
  });
  it('a margin rounds and an attainment cuts, as the format.ts header says', () => {
    expect(formatMarginBp(9995)).toBe('100%');
    expect(formatPercentBp(9995, { decimals: 1 })).toBe('99.9%');
  });
  it('formatPercentBp', () => {
    expect(formatPercentBp(10533)).toBe('105%');
    expect(formatPercentBp(10533, { decimals: 1 })).toBe('105.3%');
    expect(formatPercentBp(BigInt(10000), { decimals: 1 })).toBe('100%');
    expect(formatPercentBp(-450)).toBe('-4%');
    expect(formatPercentBp(-50)).toBe('0%');
    expect(formatPercentBp(null)).toBe('No number yet');
    expect(formatPercentBp(Number.NaN, { empty: '' })).toBe('');
  });
  it('formatPercentBp never shows a band the number has not reached (programHealth edges)', () => {
    // On track starts at exactly 10000, at risk at 9000 (forecast.ts programHealth).
    expect(formatPercentBp(9999)).toBe('99%');
    expect(formatPercentBp(9950)).toBe('99%');
    expect(formatPercentBp(BigInt(9999))).toBe('99%');
    expect(formatPercentBp(9999.9)).toBe('99%');
    expect(formatPercentBp(10000)).toBe('100%');
    expect(formatPercentBp(8999)).toBe('89%');
    expect(formatPercentBp(8950)).toBe('89%');
    expect(formatPercentBp(9000)).toBe('90%');
    expect(formatPercentBp(9999, { decimals: 1 })).toBe('99.9%');
    expect(formatPercentBp(8999, { decimals: 1 })).toBe('89.9%');
    expect(formatPercentBp(1234567)).toBe('12,345%');
  });
  it('formatUnitPrice trims to 2 decimals unless more are needed', () => {
    expect(formatUnitPrice('1.9500')).toBe('$1.95');
    expect(formatUnitPrice('1.8525')).toBe('$1.8525');
    expect(formatUnitPrice('1234.5')).toBe('$1,234.50');
    expect(formatUnitPrice(2)).toBe('$2.00');
    expect(formatUnitPrice('-0.25')).toBe('-$0.25');
    expect(formatUnitPrice(null)).toBe('No price');
    expect(formatUnitPrice(Number.NaN, { empty: '' })).toBe('');
  });
  it('formatQty and unitLabel', () => {
    expect(formatQty('1200.000')).toBe('1,200');
    expect(formatQty('12.500')).toBe('12.5');
    expect(formatQty(BigInt(7))).toBe('7');
    expect(formatQty('-3')).toBe('-3');
    expect(formatQty(null)).toBe('0');
    expect(formatQty(Number.NaN)).toBe('0');
    expect(unitLabel('1.000', { singular: 'kit', plural: 'kits' })).toBe('1 kit');
    expect(unitLabel(1200, { singular: 'kit', plural: 'kits' })).toBe('1,200 kits');
    expect(unitLabel('2.5', { singular: 'kit', plural: 'kits' })).toBe('2.5 kits');
  });
  it('formatHours', () => {
    expect(formatHours('1.58')).toBe('1.58 h');
    expect(formatHours('2.00')).toBe('2 h');
    expect(formatHours('1234.5')).toBe('1,234.5 h');
    expect(formatHours(null)).toBe('0 h');
    expect(formatHours(Number.NaN)).toBe('0 h');
  });
});

describe('compact money rolls over to the next unit', () => {
  it('prints $1M for $999,500 and never 1,000 of a smaller unit', () => {
    expect(formatCents(BigInt(99950000), { compact: true })).toBe('$1M');
    expect(formatCents(BigInt(-99950000), { compact: true })).toBe('-$1M');
    expect(formatCents(BigInt(99999999900), { compact: true })).toBe('$1B');
    expect(formatCents(BigInt('99999999999900'), { compact: true })).toBe('$1T');
    expect(formatCents(BigInt(99999), { compact: true })).toBe('$1K');
    expect(formatCents(BigInt(99949999), { compact: true })).toBe('$999K');
    expect(formatCents(BigInt(999500000), { compact: true })).toBe('$10M');
    for (let cents = BigInt(99900000); cents < BigInt(100100000); cents += BigInt(9973)) expect(formatCents(cents, { compact: true })).not.toMatch(/1,000/);
  });
});

describe('number formatters never throw on bad stored text', () => {
  it('shows the empty text, like formatCents', () => {
    expect(formatCents('abc')).toBe('Hidden');
    expect(formatUnitPrice('abc')).toBe('No price');
    expect(formatUnitPrice('abc', { empty: 'None' })).toBe('None');
    expect(formatQty('abc')).toBe('0');
    expect(formatQty('1.2.3', { empty: 'Not set' })).toBe('Not set');
    expect(formatHours('abc')).toBe('0 h');
    expect(unitLabel('abc', { singular: 'kit', plural: 'kits' })).toBe('0 kits');
    expect(formatUnitPrice('1.8525')).toBe('$1.8525');
  });
});
