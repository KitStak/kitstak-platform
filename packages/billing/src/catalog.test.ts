import { describe, expect, it } from 'vitest';
import { GRACE_DAYS, MODULES } from '@kitstak/entitlements';
import {
  BILLING_INTERVALS,
  CATALOG,
  DEFAULT_SELECTION,
  PRICING_IS_PLACEHOLDER,
  PRODUCT_IDS,
  allPriceKeys,
  daysLeft,
  formatDay,
  formatDayShort,
  formatMoney,
  isBundle,
  isProductId,
  normalizeSelection,
  parsePriceKey,
  parseStack,
  percentLabel,
  priceKey,
  priceKeyCents,
  productListLabel,
  quantityFor,
  seatLimitFor,
  stackParam,
  toStack,
  toggleProduct,
  unitCents,
} from './catalog';

describe('catalog prices', () => {
  it('holds the four agreed monthly list prices', () => {
    expect(CATALOG.products.crm.cents.monthly).toBe(2900);
    expect(CATALOG.products.projects.cents.monthly).toBe(1200);
    expect(CATALOG.products.wms.cents.monthly).toBe(34900);
    expect(CATALOG.products.pulse.cents.monthly).toBe(2900);
    expect(CATALOG.products.pulse.includedSeats).toBe(5);
    expect(PRICING_IS_PLACEHOLDER).toBe(false);
  });

  it.each(PRODUCT_IDS)('%s: the four columns relate exactly, so no screen ever rounds', (product) => {
    const { monthly, monthlyBundle, yearly, yearlyBundle } = CATALOG.products[product].cents;
    // 15% off for paying yearly.
    expect(yearly * 100).toBe(monthly * 12 * (100 - CATALOG.yearlyPercentOff));
    // 20% off with 2 or more products.
    expect(monthlyBundle * 100).toBe(monthly * (100 - CATALOG.bundlePercentOff));
    expect(yearlyBundle * 100).toBe(yearly * (100 - CATALOG.bundlePercentOff));
    // Every derived amount, and the per month view of a yearly price, is a whole number of cents.
    expect(monthly % 5).toBe(0);
    expect(yearly % 60).toBe(0);
    for (const cents of [monthly, monthlyBundle, yearly, yearlyBundle]) expect(Number.isInteger(cents)).toBe(true);
    expect(Number.isInteger(yearly / 12)).toBe(true);
    expect(Number.isInteger(yearlyBundle / 12)).toBe(true);
  });

  it('matches the Stripe mapping in CONTRACTS section 5.2', () => {
    const expected: Record<string, number> = {
      kitstak_crm_monthly: 2900,
      kitstak_crm_monthly_bundle: 2320,
      kitstak_crm_yearly: 29580,
      kitstak_crm_yearly_bundle: 23664,
      kitstak_projects_monthly: 1200,
      kitstak_projects_monthly_bundle: 960,
      kitstak_projects_yearly: 12240,
      kitstak_projects_yearly_bundle: 9792,
      kitstak_wms_monthly: 34900,
      kitstak_wms_monthly_bundle: 27920,
      kitstak_wms_yearly: 355980,
      kitstak_wms_yearly_bundle: 284784,
      kitstak_pulse_monthly: 2900,
      kitstak_pulse_monthly_bundle: 2320,
      kitstak_pulse_yearly: 29580,
      kitstak_pulse_yearly_bundle: 23664,
    };
    const keys = allPriceKeys();
    expect(keys).toHaveLength(16);
    expect(new Set(keys).size).toBe(16);
    expect([...keys].sort()).toEqual(Object.keys(expected).sort());
    for (const key of keys) expect(priceKeyCents(key)).toBe(expected[key]);
  });

  it('keeps the catalog constants in step with the entitlements package', () => {
    expect(CATALOG.graceDays).toBe(GRACE_DAYS);
    expect([...PRODUCT_IDS]).toEqual([...MODULES]);
    expect(CATALOG.trialDays).toBe(14);
    expect(CATALOG.bundleMinProducts).toBe(2);
    expect(BILLING_INTERVALS).toEqual(['monthly', 'yearly']);
  });
});

describe('stacks', () => {
  it('cleans, orders and removes repeats', () => {
    expect(toStack(['pulse', 'crm', 'crm', 'nope'])).toEqual(['crm', 'pulse']);
    expect(parseStack('wms, CRM')).toEqual(['crm', 'wms']);
    expect(parseStack('both')).toEqual(['crm', 'wms']);
    expect(parseStack('both,pulse')).toEqual(['crm', 'wms', 'pulse']);
    expect(parseStack(null)).toEqual([]);
    expect(parseStack('  ')).toEqual([]);
    expect(stackParam(['wms', 'crm'] as never)).toBe('crm,wms');
  });

  it('toggles a product and knows a bundle', () => {
    expect(toggleProduct(['crm'], 'wms')).toEqual(['crm', 'wms']);
    expect(toggleProduct(['crm', 'wms'], 'crm')).toEqual(['wms']);
    expect(isBundle(['crm'])).toBe(false);
    expect(isBundle(['crm', 'pulse'])).toBe(true);
    expect(isProductId('wms')).toBe(true);
    expect(isProductId('billing')).toBe(false);
  });

  it('writes app lists in plain words', () => {
    expect(productListLabel(['crm'])).toBe('CRM');
    expect(productListLabel(['crm', 'wms'])).toBe('CRM and WMS');
    expect(productListLabel(['crm', 'wms', 'projects', 'pulse'])).toBe('CRM, WMS, Projects and Pulse');
  });
});

describe('normalizeSelection', () => {
  it('never throws and returns the default for junk', () => {
    for (const junk of [null, undefined, 7, 'x', [], () => 1]) {
      expect(normalizeSelection(junk)).toEqual(DEFAULT_SELECTION);
    }
    expect(DEFAULT_SELECTION).toEqual({ products: [], seats: 1, warehouses: 1, interval: 'monthly' });
  });

  it('clamps numbers and drops unknown products', () => {
    expect(
      normalizeSelection({ products: ['wms', 'crm', 'hack', 3], seats: 99999, warehouses: -4, interval: 'yearly', price: 1 }),
    ).toEqual({ products: ['crm', 'wms'], seats: 500, warehouses: 1, interval: 'yearly' });
    expect(normalizeSelection({ products: 'crm,pulse', seats: '12', warehouses: 2.6, interval: 'weekly' })).toEqual({
      products: ['crm', 'pulse'],
      seats: 12,
      warehouses: 3,
      interval: 'monthly',
    });
    expect(normalizeSelection({ products: ['crm'], seats: Number.NaN, warehouses: Infinity }).seats).toBe(1);
    expect(normalizeSelection({ products: ['crm'], interval: 'annual' }).interval).toBe('yearly');
  });

  it('is stable when applied twice', () => {
    const once = normalizeSelection({ products: ['pulse', 'crm'], seats: 7, warehouses: 3, interval: 'yearly' });
    expect(normalizeSelection(once)).toEqual(once);
  });
});

describe('quantities, unit prices and seat limits', () => {
  const selection = { products: ['crm', 'wms', 'projects', 'pulse'], seats: 10, warehouses: 2, interval: 'monthly' } as const;

  it('counts seats, warehouses and one flat unit', () => {
    expect(quantityFor('crm', selection)).toBe(10);
    expect(quantityFor('projects', selection)).toBe(10);
    expect(quantityFor('wms', selection)).toBe(2);
    expect(quantityFor('pulse', selection)).toBe(1);
  });

  it('picks the unit price for the interval and the bundle', () => {
    expect(unitCents('crm', 'monthly', false)).toBe(2900);
    expect(unitCents('crm', 'monthly', true)).toBe(2320);
    expect(unitCents('wms', 'yearly', false)).toBe(355980);
    expect(unitCents('wms', 'yearly', true)).toBe(284784);
  });

  it('seatLimitFor: per user app wins, Pulse alone is 5, WMS alone has no limit', () => {
    expect(seatLimitFor({ products: ['crm'], seats: 7, warehouses: 1, interval: 'monthly' })).toBe(7);
    expect(seatLimitFor({ products: ['projects', 'pulse'], seats: 12, warehouses: 1, interval: 'monthly' })).toBe(12);
    expect(seatLimitFor({ products: ['pulse'], seats: 12, warehouses: 1, interval: 'monthly' })).toBe(5);
    expect(seatLimitFor({ products: ['wms', 'pulse'], seats: 2, warehouses: 1, interval: 'monthly' })).toBe(5);
    expect(seatLimitFor({ products: ['wms'], seats: 9, warehouses: 1, interval: 'monthly' })).toBeNull();
    expect(seatLimitFor({ products: [], seats: 9, warehouses: 1, interval: 'monthly' })).toBeNull();
  });
});

describe('price keys', () => {
  it('builds and parses, both ways', () => {
    expect(priceKey('crm', 'monthly', false)).toBe('kitstak_crm_monthly');
    expect(priceKey('wms', 'yearly', true)).toBe('kitstak_wms_yearly_bundle');
    for (const key of allPriceKeys()) {
      const parsed = parsePriceKey(key);
      expect(parsed).not.toBeNull();
      if (parsed) expect(priceKey(parsed.product, parsed.interval, parsed.bundle)).toBe(key);
    }
  });

  it('refuses keys it does not know (the old tier products never match)', () => {
    for (const key of ['starter_monthly', 'kitstak_billing_monthly', 'kitstak_crm_weekly', 'kitstak_crm_monthly_bundle_x', '']) {
      expect(parsePriceKey(key)).toBeNull();
    }
  });
});

describe('formatting', () => {
  it('formatMoney never rounds', () => {
    expect(formatMoney(147900)).toBe('$1,479.00');
    expect(formatMoney(39520)).toBe('$395.20');
    expect(formatMoney(2900, { trimZeroCents: true })).toBe('$29');
    expect(formatMoney(2320, { trimZeroCents: true })).toBe('$23.20');
    expect(formatMoney(-9880)).toBe('-$98.80');
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(5)).toBe('$0.05');
    expect(formatMoney(403104)).toBe('$4,031.04');
    expect(formatMoney(123456789)).toBe('$1,234,567.89');
    expect(formatMoney(99)).toBe('$0.99');
  });

  it('writes percent labels and dates one way', () => {
    expect(percentLabel(20)).toBe('20%');
    const date = new Date('2026-12-07T15:30:00.000Z');
    expect(formatDay(date)).toBe('Dec 7, 2026');
    expect(formatDayShort(date)).toBe('Dec 7');
    // Late evening in Los Angeles is still Dec 7 there when UTC says Dec 8.
    expect(formatDay(new Date('2026-12-08T05:00:00.000Z'), 'America/Los_Angeles')).toBe('Dec 7, 2026');
    expect(formatDay(date, 'Not/AZone')).toBe('Dec 7, 2026');
  });

  it('daysLeft rounds up and never goes below 0', () => {
    const now = new Date('2026-11-23T12:00:00.000Z');
    expect(daysLeft(new Date('2026-12-07T12:00:00.000Z'), now)).toBe(14);
    expect(daysLeft(new Date('2026-11-23T12:00:01.000Z'), now)).toBe(1);
    expect(daysLeft(new Date('2026-11-25T11:00:00.000Z'), now)).toBe(2);
    expect(daysLeft(now, now)).toBe(0);
    expect(daysLeft(new Date('2026-11-01T00:00:00.000Z'), now)).toBe(0);
  });
});
