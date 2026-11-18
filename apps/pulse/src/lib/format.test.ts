import { describe, expect, it } from 'vitest';
import {
  deltaDirection,
  deltaTone,
  formatCompactNumber,
  formatDecimalPlain,
  formatHeadcount,
  formatHours,
  formatHoursDelta,
  formatMoney,
  formatMoneyCompact,
  formatMoneyDelta,
  formatMoneyPerHour,
  formatMoneyPerUnit,
  formatMoneyPlain,
  formatMoneyWhole,
  formatNumber,
  formatNumberDelta,
  formatPace,
  formatPercent,
  formatPercentBp,
  formatPercentDelta,
  formatPercentWhole,
  formatPointsDelta,
  formatUnitPrice,
  formatUnits,
  pluralize,
} from './format';

const b = (n: number | string): bigint => BigInt(n);
const NBSP = String.fromCharCode(0xa0);

describe('money', () => {
  it('formats cents as dollars', () => {
    expect(formatMoney(b(123450))).toBe('$1,234.50');
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(5)).toBe('$0.05');
    expect(formatMoney('212384')).toBe('$2,123.84');
  });
  it('shows negatives with a minus, or in brackets for accounting', () => {
    expect(formatMoney(b(-4500))).toBe('-$45.00');
    expect(formatMoney(b(-4500), { accounting: true })).toBe('($45.00)');
  });
  it('is exact past 2^53', () => {
    expect(formatMoney(b('1234567890123456789'))).toBe('$12,345,678,901,234,567.89');
  });
  it('drops cents on request and never shows minus zero', () => {
    expect(formatMoneyWhole(b(4821000))).toBe('$48,210');
    expect(formatMoneyWhole(b(4821050))).toBe('$48,211');
    expect(formatMoneyWhole(b(-40))).toBe('$0');
    expect(formatMoneyWhole(b(-60))).toBe('-$1');
  });
  it('returns the empty text for missing values', () => {
    expect(formatMoney(null)).toBe('');
    expect(formatMoney(undefined, { empty: 'No revenue yet' })).toBe('No revenue yet');
    expect(formatMoneyCompact(null, { empty: 'n/a' })).toBe('n/a');
  });
  it('follows the locale and currency', () => {
    expect(formatMoney(b(123450), { locale: 'de-DE', currency: 'EUR' })).toBe(`1.234,50${NBSP}€`);
    expect(formatMoney(b(123450), { locale: 'en-GB', currency: 'GBP' })).toBe('£1,234.50');
    expect(formatMoney(b(123450), { currency: 'CAD' })).toBe('CA$1,234.50');
  });
  it('shortens big numbers', () => {
    expect(formatMoneyCompact(b(95000))).toBe('$950');
    expect(formatMoneyCompact(b(4821000))).toBe('$48.2K');
    expect(formatMoneyCompact(b(130000000))).toBe('$1.3M');
    expect(formatMoneyCompact(b(-4821000))).toBe('-$48.2K');
  });
  it('keeps up to 4 places on a unit price', () => {
    expect(formatUnitPrice('2.7500')).toBe('$2.75');
    expect(formatUnitPrice('0.0350')).toBe('$0.035');
    expect(formatUnitPrice(1.5715)).toBe('$1.5715');
    expect(formatUnitPrice(3)).toBe('$3.00');
    expect(formatUnitPrice(null)).toBe('');
    expect(formatUnitPrice('')).toBe('');
  });
  it('adds plain words for rates', () => {
    expect(formatMoneyPerHour(b(2176))).toBe('$21.76 an hour');
    expect(formatMoneyPerUnit(b(312))).toBe('$3.12 a unit');
    expect(formatMoneyPerUnit(b(312), 'kit')).toBe('$3.12 a kit');
    expect(formatMoneyPerHour(null)).toBe('');
  });
  it('writes plain values for inputs and CSV cells', () => {
    expect(formatMoneyPlain(b(123450))).toBe('1234.50');
    expect(formatMoneyPlain(b(-4500))).toBe('-45.00');
    expect(formatMoneyPlain(null)).toBe('');
    expect(formatDecimalPlain('96.00', 2)).toBe('96');
    expect(formatDecimalPlain('7.50', 2)).toBe('7.5');
    expect(formatDecimalPlain('0.0350', 4)).toBe('0.035');
    expect(formatDecimalPlain(100, 3)).toBe('100');
    expect(formatDecimalPlain(null, 2)).toBe('');
  });
});

describe('numbers, percents, hours, units and pace', () => {
  it('formats plain numbers', () => {
    expect(formatNumber(12480)).toBe('12,480');
    expect(formatNumber('7.50')).toBe('7.5');
    expect(formatNumber(7.456)).toBe('7.46');
    expect(formatNumber(7, { minDigits: 1, maxDigits: 1 })).toBe('7.0');
    expect(formatNumber(b(1000000))).toBe('1,000,000');
    expect(formatNumber(1234.5, { locale: 'de-DE' })).toBe('1.234,5');
    expect(formatNumber(null)).toBe('');
    expect(formatCompactNumber(12480)).toBe('12.5K');
    expect(formatCompactNumber(950)).toBe('950');
  });
  it('formats percents from basis points and ratios', () => {
    expect(formatPercentBp(2236)).toBe('22.4%');
    expect(formatPercentBp(3000)).toBe('30%');
    expect(formatPercentBp(-1250)).toBe('-12.5%');
    expect(formatPercentBp(2236, { digits: 2 })).toBe('22.36%');
    expect(formatPercentBp(3800, { fixed: true })).toBe('38.0%');
    expect(formatPercentBp(-2, { fixed: true })).toBe('0.0%');
    expect(formatPercentWhole(2236)).toBe('22%');
    expect(formatPercent(0.2236)).toBe('22.4%');
    expect(formatPercentBp(null, { empty: 'No revenue yet' })).toBe('No revenue yet');
    expect(formatPercent(Number.NaN)).toBe('');
    expect(formatPercentBp(-2)).toBe('0%');
  });
  it('formats hours four ways', () => {
    expect(formatHours('7.50')).toBe('7.5');
    expect(formatHours(96)).toBe('96');
    expect(formatHours(7.5, { style: 'unit' })).toBe('7.5 hours');
    expect(formatHours(1, { style: 'unit' })).toBe('1 hour');
    expect(formatHours(187.5, { style: 'short' })).toBe('187.5 h');
    expect(formatHours(7.5, { style: 'clock' })).toBe('7:30');
    expect(formatHours('0.25', { style: 'clock' })).toBe('0:15');
    expect(formatHours('7.99', { style: 'clock' })).toBe('7:59');
    expect(formatHours(null)).toBe('');
  });
  it('formats units with a unit word', () => {
    expect(formatUnits(3000)).toBe('3,000');
    expect(formatUnits('3000.000', 'kit')).toBe('3,000 kits');
    expect(formatUnits(1, 'kit')).toBe('1 kit');
    expect(formatUnits(2, 'box')).toBe('2 boxes');
    expect(formatUnits(2.5, 'pallet')).toBe('2.5 pallets');
    expect(pluralize('assembly')).toBe('assemblies');
    expect(pluralize('display')).toBe('displays');
    expect(pluralize('batch')).toBe('batches');
  });
  it('formats pace and headcount', () => {
    expect(formatPace(32)).toBe('32.0');
    expect(formatPace('31.467')).toBe('31.5');
    expect(formatPace(32, { withWords: true })).toBe('32.0 units per person per hour');
    expect(formatPace(null, { empty: 'No pace yet' })).toBe('No pace yet');
    expect(formatHeadcount(12)).toBe('12');
    expect(formatHeadcount('12.50')).toBe('12.5');
  });
});

describe('changes with a sign', () => {
  it('formats money changes', () => {
    expect(formatMoneyDelta(b(60000))).toBe('+$600.00');
    expect(formatMoneyDelta(b(-23500))).toBe('-$235.00');
    expect(formatMoneyDelta(b(0))).toBe('$0.00');
    expect(formatMoneyDelta(b(60000), { cents: false })).toBe('+$600');
    expect(formatMoneyDelta(null)).toBe('');
  });
  it('formats percent and point changes', () => {
    expect(formatPercentDelta(1250)).toBe('+12.5%');
    expect(formatPercentDelta(-300)).toBe('-3%');
    expect(formatPercentDelta(0)).toBe('0%');
    // A change that rounds to nothing carries no sign.
    expect(formatPercentDelta(-4, { digits: 0 })).toBe('0%');
    expect(formatPercentDelta(-2)).toBe('0%');
    expect(formatPercentDelta(-60, { digits: 0 })).toBe('-1%');
    expect(formatPointsDelta(240)).toBe('+2.4 points');
    expect(formatPointsDelta(-100)).toBe('-1 point');
    expect(formatPointsDelta(0)).toBe('0 points');
    expect(formatPointsDelta(null)).toBe('');
  });
  it('formats number and hour changes', () => {
    expect(formatNumberDelta(120)).toBe('+120');
    expect(formatNumberDelta(-7.5)).toBe('-7.5');
    expect(formatNumberDelta(0)).toBe('0');
    expect(formatHoursDelta(25)).toBe('+25 hours');
    expect(formatHoursDelta(-1)).toBe('-1 hour');
  });
  it('never uses a long dash or a double dash', () => {
    const samples = [formatMoney(b(-4500)), formatMoneyDelta(b(-4500)), formatPercentDelta(-300), formatPointsDelta(-240), formatNumberDelta(-3), formatMoneyCompact(b(-4821000))];
    for (const sample of samples) {
      expect(sample).not.toMatch(/[‒-―−]/);
      expect(sample).not.toContain('--');
    }
  });
  it('picks a tone and a direction', () => {
    expect(deltaTone(5, 'up')).toBe('good');
    expect(deltaTone(-5, 'up')).toBe('bad');
    expect(deltaTone(b(5), 'down')).toBe('bad');
    expect(deltaTone(b(-5), 'down')).toBe('good');
    expect(deltaTone(0, 'up')).toBe('neutral');
    expect(deltaTone(null, 'up')).toBe('neutral');
    expect(deltaDirection(b(3))).toBe('up');
    expect(deltaDirection(-3)).toBe('down');
    expect(deltaDirection(0)).toBe('flat');
    expect(deltaDirection(undefined)).toBe('flat');
  });
});
