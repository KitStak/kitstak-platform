/**
 * The marketing site has no prices of its own. These checks prove that every figure it shows comes
 * from the one shared catalog in `@kitstak/billing`, and that the reference carts in
 * docs/billing/CONTRACTS.md section 4.3 price the same through this file as they do at sign-up.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import * as shared from '@kitstak/billing';
import { describe, expect, test } from 'vitest';
import {
  BUNDLE_OFF,
  CATALOG,
  PRICING_IS_PLACEHOLDER,
  TRIAL_DAYS,
  TRIAL_LINE,
  YEARLY_OFF,
  formatMoney,
  includedSeatsLabel,
  isBundle,
  isPerSeat,
  listPrice,
  midMonthSeatExample,
  monthlyTerms,
  moreSeatsPrompt,
  priceInWords,
  priceOf,
  quote,
  quoteSummaryLines,
  unitPerMonth,
  unitPerYear,
} from './pricing';
import type { PlanSelection } from './pricing';

const cart = (patch: Partial<PlanSelection>): PlanSelection => ({
  products: [],
  seats: 1,
  warehouses: 1,
  interval: 'monthly',
  ...patch,
});

describe('one catalog', () => {
  test('the site re-exports the shared catalog and quote, not copies of them', () => {
    expect(CATALOG).toBe(shared.CATALOG);
    expect(quote).toBe(shared.quote);
    expect(quoteSummaryLines).toBe(shared.quoteSummaryLines);
    expect(formatMoney).toBe(shared.formatMoney);
    expect(isBundle).toBe(shared.isBundle);
  });

  test('prices are live, so nothing on the site calls them preliminary', () => {
    expect(PRICING_IS_PLACEHOLDER).toBe(false);
  });

  test('the percents and the trial length come from the catalog', () => {
    expect(BUNDLE_OFF).toBe(`${CATALOG.bundlePercentOff}%`);
    expect(YEARLY_OFF).toBe(`${CATALOG.yearlyPercentOff}%`);
    expect(TRIAL_DAYS).toBe(CATALOG.trialDays);
    expect(TRIAL_LINE).toBe('14 days free. No card needed.');
  });
});

describe('reference carts (CONTRACTS 4.3), through the site', () => {
  const CARTS: readonly (readonly [string, PlanSelection, number, string])[] = [
    ['Pulse, monthly', cart({ products: ['pulse'] }), 2900, '$29.00'],
    ['CRM 5 seats, monthly', cart({ products: ['crm'], seats: 5 }), 14500, '$145.00'],
    ['CRM 5 and WMS 1, monthly', cart({ products: ['crm', 'wms'], seats: 5 }), 39520, '$395.20'],
    [
      'CRM 5 and WMS 1, yearly',
      cart({ products: ['crm', 'wms'], seats: 5, interval: 'yearly' }),
      403104,
      '$4,031.04',
    ],
    ['Pulse and CRM 1, yearly', cart({ products: ['crm', 'pulse'], interval: 'yearly' }), 47328, '$473.28'],
    [
      'all four, 10 seats, 2 warehouses, monthly',
      cart({ products: ['crm', 'wms', 'projects', 'pulse'], seats: 10, warehouses: 2 }),
      90960,
      '$909.60',
    ],
    [
      'all four, 10 seats, 2 warehouses, yearly',
      cart({ products: ['crm', 'wms', 'projects', 'pulse'], seats: 10, warehouses: 2, interval: 'yearly' }),
      927792,
      '$9,277.92',
    ],
    ['Projects 3 seats, yearly', cart({ products: ['projects'], seats: 3, interval: 'yearly' }), 36720, '$367.20'],
    ['WMS 3 warehouses, monthly', cart({ products: ['wms'], warehouses: 3 }), 104700, '$1,047.00'],
  ];

  test.each(CARTS)('%s', (_name, selection, totalCents, shown) => {
    const q = quote(selection);

    expect(q.totalCents).toBe(totalCents);
    expect(formatMoney(q.totalCents)).toBe(shown);
    expect(q.listPeriodCents - q.yearlySavingsCents - q.bundleSavingsCents).toBe(q.totalCents);
  });

  test('the cart the calculator and the sign-up page both lead with reads $395.20 per month', () => {
    const q = quote(cart({ products: ['crm', 'wms'], seats: 5 }));

    expect(q.lines.map((line) => line.math)).toEqual([
      'CRM: 5 users x $29 = $145 per month',
      'WMS: 1 warehouse x $349 = $349 per month',
    ]);
    expect(quoteSummaryLines(q).map((row) => [row.label, formatMoney(row.amountCents)])).toEqual([
      ['List price', '$494.00'],
      ['Bundle discount (20%)', '-$98.80'],
      ['Total per month', '$395.20'],
    ]);
  });

  test('yearly shows both discounts as their own dollar lines and the per month view', () => {
    const q = quote(cart({ products: ['crm', 'wms'], seats: 5, interval: 'yearly' }));

    expect(quoteSummaryLines(q).map((row) => [row.label, formatMoney(row.amountCents)])).toEqual([
      ['List price for 12 months', '$5,928.00'],
      ['Yearly discount (15%)', '-$889.20'],
      ['Bundle discount (20%)', '-$1,007.76'],
      ['Total per year', '$4,031.04'],
    ]);
    expect(formatMoney(q.monthlyEquivalentCents)).toBe('$335.92');
  });
});

describe('phrases the site builds from the catalog', () => {
  test('says each price in words', () => {
    expect(priceInWords('crm')).toBe('$29 per user each month');
    expect(priceInWords('projects')).toBe('$12 per user each month');
    expect(priceInWords('wms')).toBe('$349 per warehouse each month');
    expect(priceInWords('pulse')).toBe('$29 each month for your whole team');
  });

  test('builds every phrase from the catalog entry, so a price change shows everywhere', () => {
    for (const id of shared.PRODUCT_IDS) {
      const cents = CATALOG.products[id].cents;
      expect(priceOf(id)).toBe(CATALOG.products[id]);
      expect(listPrice(id)).toBe(formatMoney(cents.monthly, { trimZeroCents: true }));
      expect(priceInWords(id)).toBe(`${listPrice(id)} ${monthlyTerms(id)}`);
      expect(unitPerMonth(id, 'monthly')).toBe(listPrice(id));
      expect(unitPerYear(id)).toBe(formatMoney(cents.yearly, { trimZeroCents: true }));
    }
  });

  test('shows a yearly price by the month without rounding', () => {
    for (const id of shared.PRODUCT_IDS) {
      const yearly = CATALOG.products[id].cents.yearly;
      // The catalog keeps every yearly price a whole number of cents per month.
      expect(yearly % 12).toBe(0);
      expect(unitPerMonth(id, 'yearly')).toBe(formatMoney(yearly / 12, { trimZeroCents: true }));
    }
    expect(unitPerMonth('crm', 'yearly')).toBe('$24.65');
    expect(unitPerYear('crm')).toBe('$295.80');
    expect(unitPerMonth('wms', 'yearly')).toBe('$296.65');
  });

  test('charges the CRM and Projects per seat, the WMS per warehouse and Pulse flat', () => {
    expect((['crm', 'wms', 'projects', 'pulse'] as const).map(isPerSeat)).toEqual([true, false, true, false]);
    expect(priceOf('wms').quantityFrom).toBe('warehouses');
    expect(priceOf('pulse').quantityFrom).toBe('flat');
  });

  test('names the seat limit only for the flat product, and quotes no price above it', () => {
    expect(includedSeatsLabel('pulse')).toBe('Up to 5 seats');
    expect(moreSeatsPrompt('pulse')).toBe('Need more than 5 seats?');
    for (const id of ['crm', 'wms', 'projects'] as const) {
      expect(includedSeatsLabel(id)).toBeNull();
      expect(moreSeatsPrompt(id)).toBeNull();
    }
  });

  test('warns when the team is bigger than the Pulse price covers, and only then', () => {
    expect(quote(cart({ products: ['pulse'], seats: 5 })).pulseSeatNote).toBeNull();
    expect(quote(cart({ products: ['pulse'], seats: 6 })).pulseSeatNote).toBe(
      'The Pulse price covers up to 5 seats.',
    );
    expect(quote(cart({ products: ['crm'], seats: 60 })).pulseSeatNote).toBeNull();
  });

  test('keeps the Pulse line the same whatever the seats and warehouses', () => {
    const pulseLine = (seats: number, warehouses: number) =>
      quote(cart({ products: ['pulse'], seats, warehouses })).lines[0];

    expect(pulseLine(1, 1)).toEqual(pulseLine(500, 50));
    expect(pulseLine(1, 1)?.math).toBe('Pulse: $29 per month for your whole team, up to 5 seats');
  });

  test('the worked example for a change in the middle of a month is half a seat, to the cent', () => {
    const seat = CATALOG.products.crm.cents.monthly;

    expect(seat % 2).toBe(0);
    expect(midMonthSeatExample()).toEqual({ today: '$14.50', eachMonth: '$29' });
  });

  test('cleans a cart the way sign-up does', () => {
    const low = quote(cart({ products: ['crm', 'wms'], seats: 0, warehouses: -3 }));
    const high = quote(cart({ products: ['crm'], seats: 9999 }));

    expect(low.lines.map((line) => line.quantity)).toEqual([1, 1]);
    expect(high.lines[0]?.quantity).toBe(priceOf('crm').max);
  });
});

/* Source guard: a price may only be written in the shared catalog. */

const srcRoot = path.resolve(__dirname, '..');

function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return name === 'generated' ? [] : sourceFiles(file);
    return /\.tsx?$/.test(name) && !/\.test\.ts$/.test(name) ? [file] : [];
  });
}

/** Files where a bare number equal to a price in cents is a size or a limit, not money. */
const LAYOUT_NUMBERS: ReadonlySet<string> = new Set([
  'components/logo.tsx',
  'components/pulse/pulse-shots.ts',
  'components/contact/contact-form.tsx',
  'lib/og-image.tsx',
]);

describe('no price is written on the site', () => {
  const files = sourceFiles(srcRoot).map((file) => ({
    name: path.relative(srcRoot, file).split(path.sep).join('/'),
    // Comments may quote an example figure. Only code and copy are checked.
    code: readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, ''),
  }));

  test('no file holds a catalog price in cents', () => {
    const cents = new Set(
      shared.PRODUCT_IDS.flatMap((id) => Object.values(CATALOG.products[id].cents)).map(String),
    );
    const offenders = files
      .filter(({ code }) => (code.match(/\b\d{3,6}\b/g) ?? []).some((n) => cents.has(n)))
      .filter(({ name }) => !LAYOUT_NUMBERS.has(name))
      .map(({ name }) => name);

    expect(offenders).toEqual([]);
  });

  test('no file writes a list price in dollars', () => {
    const dollars = shared.PRODUCT_IDS.map((id) => listPrice(id).replace('$', '\\$'));
    const pattern = new RegExp(`(${dollars.join('|')})(?![\\d,.])`);
    const offenders = files.filter(({ code }) => pattern.test(code)).map(({ name }) => name);

    expect(offenders).toEqual([]);
  });

  test('nothing calls a price preliminary or a stand-in', () => {
    const offenders = files.filter(({ code }) => /preliminary|stand-in/i.test(code)).map(({ name }) => name);

    expect(offenders).toEqual([]);
  });

  test('only the pricing module imports the billing catalog and quote', () => {
    const offenders = files
      .filter(({ code }) => /@kitstak\/billing\/(catalog|quote)/.test(code))
      .map(({ name }) => name);

    expect(offenders.sort()).toEqual(['components/site-links.ts', 'lib/pricing.ts']);
  });
});
