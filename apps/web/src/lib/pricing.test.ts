import { describe, expect, test } from 'vitest';
import {
  PRICING,
  formatUsd,
  includedSeatsLabel,
  isBundle,
  isPerSeat,
  moreSeatsPrompt,
  preliminaryPriceNote,
  quote,
} from './pricing';

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

  test('prices Pulse at $29 flat per organization, covering up to 5 seats', () => {
    expect(PULSE).toBe(2900);
    expect(PRICING.pulse).toMatchObject({ basis: 'flat_per_org', unit: 'organization', includedSeats: 5 });
    expect(formatUsd(PULSE)).toBe('$29');
  });

  test('prices Pulse as one flat line that seats and warehouses never change', () => {
    const sizes = [
      { seats: 1, warehouses: 1 },
      { seats: 5, warehouses: 1 },
      { seats: 6, warehouses: 4 },
      { seats: 60, warehouses: 12 },
      { seats: 9999, warehouses: 9999 },
    ];

    for (const size of sizes) {
      const alone = quote({ stack: ['pulse'], ...size, billing: 'monthly' });

      expect(alone.lines).toHaveLength(1);
      expect(alone.lines[0]).toMatchObject({
        product: 'pulse',
        basis: 'flat_per_org',
        quantity: 1,
        unitLabel: 'organization',
        unitCents: PULSE,
        subtotalCents: PULSE,
        basisLabel: 'Flat price per organization. Up to 5 seats.',
      });
      expect(alone.listMonthlyCents).toBe(PULSE);
      expect(alone.bundleSavingsCents).toBe(0);
      expect(alone.monthlyCents).toBe(PULSE);
    }
  });

  test('keeps the Pulse line the same when seats go above 5 in a mixed stack', () => {
    const pulseLine = (seats: number) =>
      quote({ stack: ['crm', 'projects', 'pulse'], seats, warehouses: 1, billing: 'monthly' }).lines.find(
        (l) => l.product === 'pulse',
      );

    expect(pulseLine(40)).toEqual(pulseLine(3));
    expect(pulseLine(40)?.subtotalCents).toBe(PULSE);
  });

  test('says how each per unit line was reached', () => {
    const q = quote({ stack: ['crm', 'wms'], seats: 5, warehouses: 1, billing: 'monthly' });

    expect(q.lines.map((l) => [l.basis, l.basisLabel])).toEqual([
      ['per_unit', '5 users × $29'],
      ['per_unit', '1 warehouse × $349'],
    ]);
  });

  test('applies the bundle discount to Pulse the same way as to every other product', () => {
    const mixed = quote({ stack: ['wms', 'pulse'], seats: 6, warehouses: 2, billing: 'monthly' });

    expect(mixed.lines.map((l) => [l.product, l.quantity])).toEqual([
      ['wms', 2],
      ['pulse', 1],
    ]);
    expect(mixed.listMonthlyCents).toBe(WMS * 2 + PULSE);
    expect(mixed.bundleSavingsCents).toBe(Math.round((WMS * 2 + PULSE) * PRICING.bundleDiscount));
    expect(mixed.monthlyCents).toBe(mixed.listMonthlyCents - mixed.bundleSavingsCents);
  });

  test('applies the yearly discount to Pulse alone and on top of the bundle discount', () => {
    const alone = quote({ stack: ['pulse'], seats: 5, warehouses: 1, billing: 'annual' });
    const mixed = quote({ stack: ['crm', 'pulse'], seats: 5, warehouses: 1, billing: 'annual' });
    const afterBundle = Math.round((CRM * 5 + PULSE) * (1 - PRICING.bundleDiscount));

    expect(alone.bundleSavingsCents).toBe(0);
    expect(alone.annualSavingsCents).toBe(Math.round(PULSE * PRICING.annualDiscount));
    expect(alone.monthlyCents).toBe(PULSE - alone.annualSavingsCents);
    expect(mixed.annualSavingsCents).toBe(Math.round(afterBundle * PRICING.annualDiscount));
    expect(mixed.monthlyCents).toBe(afterBundle - mixed.annualSavingsCents);
  });

  test('applies the bundle discount across all four products', () => {
    const four = quote({
      stack: ['crm', 'wms', 'projects', 'pulse'],
      seats: 4,
      warehouses: 1,
      billing: 'monthly',
    });

    expect(four.lines.map((l) => l.product)).toEqual(['crm', 'wms', 'projects', 'pulse']);
    expect(four.listMonthlyCents).toBe((CRM + PROJECTS) * 4 + WMS + PULSE);
    expect(four.bundleSavingsCents).toBe(Math.round(four.listMonthlyCents * PRICING.bundleDiscount));
  });

  test('gives a single product no bundle saving', () => {
    expect(isBundle(['projects'])).toBe(false);
    expect(
      quote({ stack: ['projects'], seats: 3, warehouses: 1, billing: 'monthly' }).bundleSavingsCents,
    ).toBe(0);
  });

  test('applies the bundle discount to any two products and to all three', () => {
    const pair = quote({ stack: ['crm', 'wms'], seats: 10, warehouses: 1, billing: 'monthly' });
    const three = quote({ stack: ['crm', 'wms', 'projects'], seats: 4, warehouses: 1, billing: 'monthly' });

    expect(pair.bundleSavingsCents).toBe(Math.round((CRM * 10 + WMS) * PRICING.bundleDiscount));
    expect(pair.monthlyCents).toBe(pair.listMonthlyCents - pair.bundleSavingsCents);
    expect(three.lines).toHaveLength(3);
    expect(three.bundleSavingsCents).toBe(
      Math.round((CRM * 4 + WMS + PROJECTS * 4) * PRICING.bundleDiscount),
    );
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

describe('billing basis', () => {
  test('charges the CRM and Projects per seat, the WMS per warehouse and Pulse flat', () => {
    expect((['crm', 'wms', 'projects', 'pulse'] as const).map(isPerSeat)).toEqual([true, false, true, false]);
    expect(PRICING.wms).toMatchObject({ basis: 'per_unit', quantityFrom: 'warehouses' });
  });

  test('names the seat limit only for the flat product, and quotes no price above it', () => {
    expect(includedSeatsLabel('pulse')).toBe('Up to 5 seats');
    expect(moreSeatsPrompt('pulse')).toBe('Need more than 5 seats?');
    for (const id of ['crm', 'wms', 'projects'] as const) {
      expect(includedSeatsLabel(id)).toBeNull();
      expect(moreSeatsPrompt(id)).toBeNull();
    }
    expect(Object.keys(PRICING.pulse).sort()).toEqual(
      ['basis', 'includedSeats', 'isConfirmed', 'monthlyCents', 'name', 'unit', 'unitPlural'].sort(),
    );
  });
});

describe('preliminaryPriceNote', () => {
  test('never calls the confirmed Pulse price preliminary or not final', () => {
    expect(preliminaryPriceNote(['pulse'])).toBeNull();
    expect(preliminaryPriceNote(['crm'])).toBe('Preliminary pricing, shown for planning.');
    expect(preliminaryPriceNote(['crm', 'pulse'])).toBe(
      'Preliminary pricing, shown for planning. The Pulse price is final.',
    );
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
