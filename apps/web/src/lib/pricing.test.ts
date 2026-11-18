import { describe, expect, test } from 'vitest';
import { PRICING, formatUsd, isBundle, quote } from './pricing';

const CRM = PRICING.crm.monthlyCents;
const WMS = PRICING.wms.monthlyCents;
const PROJECTS = PRICING.projects.monthlyCents;
const PULSE = PRICING.pulse.monthlyCents;

describe('quote', () => {
  test('prices the CRM alone per user with no bundle saving', () => {
    const q = quote({ stack: ['crm'], seats: 5, warehouses: 1, billing: 'monthly' });

    expect(q.lines).toHaveLength(1);
    expect(q.listMonthlyCents).toBe(CRM * 5);
    expect(q.bundleSavingsCents).toBe(0);
    expect(q.monthlyCents).toBe(CRM * 5);
  });

  test('prices the WMS alone per warehouse and ignores seats', () => {
    const q = quote({ stack: ['wms'], seats: 40, warehouses: 2, billing: 'monthly' });

    expect(q.lines.map((l) => l.product)).toEqual(['wms']);
    expect(q.monthlyCents).toBe(WMS * 2);
  });

  test('prices Projects per user with the same seat count as the CRM', () => {
    const q = quote({ stack: ['crm', 'projects'], seats: 8, warehouses: 3, billing: 'monthly' });

    expect(q.lines.map((l) => [l.product, l.quantity])).toEqual([
      ['crm', 8],
      ['projects', 8],
    ]);
    expect(q.listMonthlyCents).toBe((CRM + PROJECTS) * 8);
  });

  test('prices Pulse per user, on its own and with the same seat count as the other per-user products', () => {
    const alone = quote({ stack: ['pulse'], seats: 6, warehouses: 4, billing: 'monthly' });
    const mixed = quote({ stack: ['wms', 'pulse'], seats: 6, warehouses: 2, billing: 'monthly' });

    expect(alone.lines.map((l) => [l.product, l.quantity, l.unitLabel])).toEqual([['pulse', 6, 'users']]);
    expect(alone.monthlyCents).toBe(PULSE * 6);
    expect(alone.bundleSavingsCents).toBe(0);
    expect(mixed.lines.map((l) => [l.product, l.quantity])).toEqual([
      ['wms', 2],
      ['pulse', 6],
    ]);
    expect(mixed.bundleSavingsCents).toBe(Math.round((WMS * 2 + PULSE * 6) * PRICING.bundleDiscount));
  });

  test('applies the bundle discount across all four products', () => {
    const four = quote({ stack: ['crm', 'wms', 'projects', 'pulse'], seats: 4, warehouses: 1, billing: 'monthly' });

    expect(four.lines.map((l) => l.product)).toEqual(['crm', 'wms', 'projects', 'pulse']);
    expect(four.listMonthlyCents).toBe((CRM + PROJECTS + PULSE) * 4 + WMS);
    expect(four.bundleSavingsCents).toBe(Math.round(four.listMonthlyCents * PRICING.bundleDiscount));
  });

  test('gives a single product no bundle saving', () => {
    expect(isBundle(['projects'])).toBe(false);
    expect(quote({ stack: ['projects'], seats: 3, warehouses: 1, billing: 'monthly' }).bundleSavingsCents).toBe(0);
  });

  test('applies the bundle discount to any two products and to all three', () => {
    const pair = quote({ stack: ['crm', 'wms'], seats: 10, warehouses: 1, billing: 'monthly' });
    const three = quote({ stack: ['crm', 'wms', 'projects'], seats: 4, warehouses: 1, billing: 'monthly' });

    expect(pair.bundleSavingsCents).toBe(Math.round((CRM * 10 + WMS) * PRICING.bundleDiscount));
    expect(pair.monthlyCents).toBe(pair.listMonthlyCents - pair.bundleSavingsCents);
    expect(three.lines).toHaveLength(3);
    expect(three.bundleSavingsCents).toBe(Math.round((CRM * 4 + WMS + PROJECTS * 4) * PRICING.bundleDiscount));
  });

  test('stacks the annual discount on top of the bundle discount', () => {
    const monthly = quote({ stack: ['crm', 'wms'], seats: 10, warehouses: 1, billing: 'monthly' });
    const annual = quote({ stack: ['crm', 'wms'], seats: 10, warehouses: 1, billing: 'annual' });

    expect(annual.annualSavingsCents).toBe(Math.round(monthly.monthlyCents * PRICING.annualDiscount));
    expect(annual.monthlyCents).toBe(monthly.monthlyCents - annual.annualSavingsCents);
    expect(annual.totalSavingsCents).toBe(annual.bundleSavingsCents + annual.annualSavingsCents);
  });

  test('clamps quantities to at least one and to the configured maximum', () => {
    const low = quote({ stack: ['crm', 'wms'], seats: 0, warehouses: -3, billing: 'monthly' });
    const high = quote({ stack: ['crm'], seats: 9999, warehouses: 1, billing: 'monthly' });

    expect(low.lines.map((l) => l.quantity)).toEqual([1, 1]);
    expect(high.lines[0]?.quantity).toBe(PRICING.crm.max);
  });

  test('treats non-finite quantities as one', () => {
    const q = quote({ stack: ['crm'], seats: Number.NaN, warehouses: 1, billing: 'monthly' });

    expect(q.lines[0]?.quantity).toBe(1);
  });
});

describe('formatUsd', () => {
  test('formats whole dollars without cents', () => {
    expect(formatUsd(34900)).toBe('$349');
  });

  test('rounds to the nearest dollar and groups thousands', () => {
    expect(formatUsd(123456)).toBe('$1,235');
  });
});
