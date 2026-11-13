import { describe, expect, test } from 'vitest';
import { PRICING, formatUsd, quote } from './pricing';

const CRM = PRICING.crm.monthlyCents;
const WMS = PRICING.wms.monthlyCents;

describe('quote', () => {
  test('prices the CRM alone per user with no bundle saving', () => {
    const q = quote({ stack: 'crm', seats: 5, warehouses: 1, billing: 'monthly' });

    expect(q.lines).toHaveLength(1);
    expect(q.listMonthlyCents).toBe(CRM * 5);
    expect(q.bundleSavingsCents).toBe(0);
    expect(q.monthlyCents).toBe(CRM * 5);
  });

  test('prices the WMS alone per warehouse and ignores seats', () => {
    const q = quote({ stack: 'wms', seats: 40, warehouses: 2, billing: 'monthly' });

    expect(q.lines.map((l) => l.product)).toEqual(['wms']);
    expect(q.monthlyCents).toBe(WMS * 2);
  });

  test('applies the bundle discount to both products when both are chosen', () => {
    const q = quote({ stack: 'both', seats: 10, warehouses: 1, billing: 'monthly' });
    const list = CRM * 10 + WMS;

    expect(q.listMonthlyCents).toBe(list);
    expect(q.bundleSavingsCents).toBe(Math.round(list * PRICING.bundleDiscount));
    expect(q.monthlyCents).toBe(list - q.bundleSavingsCents);
  });

  test('stacks the annual discount on top of the bundle discount', () => {
    const monthly = quote({ stack: 'both', seats: 10, warehouses: 1, billing: 'monthly' });
    const annual = quote({ stack: 'both', seats: 10, warehouses: 1, billing: 'annual' });

    expect(annual.annualSavingsCents).toBe(Math.round(monthly.monthlyCents * PRICING.annualDiscount));
    expect(annual.monthlyCents).toBe(monthly.monthlyCents - annual.annualSavingsCents);
    expect(annual.totalSavingsCents).toBe(annual.bundleSavingsCents + annual.annualSavingsCents);
  });

  test('clamps quantities to at least one and to the configured maximum', () => {
    const low = quote({ stack: 'both', seats: 0, warehouses: -3, billing: 'monthly' });
    const high = quote({ stack: 'crm', seats: 9999, warehouses: 1, billing: 'monthly' });

    expect(low.lines.map((l) => l.quantity)).toEqual([1, 1]);
    expect(high.lines[0]?.quantity).toBe(PRICING.crm.max);
  });

  test('treats non-finite quantities as one', () => {
    const q = quote({ stack: 'crm', seats: Number.NaN, warehouses: 1, billing: 'monthly' });

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
