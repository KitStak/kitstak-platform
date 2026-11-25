import { describe, expect, it } from 'vitest';
import { type PlanSelection, PRODUCT_IDS, allPriceKeys, formatMoney, priceKeyCents } from './catalog';
import { quote, quoteSummaryLines } from './quote';

/** The nine reference carts in CONTRACTS section 4.3. Asserted to the cent. */
const CARTS: readonly { name: string; selection: PlanSelection; total: number; shown: string; perMonth?: string }[] = [
  { name: '1 Pulse', selection: { products: ['pulse'], seats: 1, warehouses: 1, interval: 'monthly' }, total: 2900, shown: '$29.00' },
  { name: '2 CRM 5 seats', selection: { products: ['crm'], seats: 5, warehouses: 1, interval: 'monthly' }, total: 14500, shown: '$145.00' },
  {
    name: '3 CRM 5 seats, WMS 1 warehouse',
    selection: { products: ['crm', 'wms'], seats: 5, warehouses: 1, interval: 'monthly' },
    total: 39520,
    shown: '$395.20',
  },
  {
    name: '4 CRM 5 seats, WMS 1 warehouse, yearly',
    selection: { products: ['crm', 'wms'], seats: 5, warehouses: 1, interval: 'yearly' },
    total: 403104,
    shown: '$4,031.04',
    perMonth: '$335.92',
  },
  {
    name: '5 Pulse, CRM 1 seat, yearly',
    selection: { products: ['crm', 'pulse'], seats: 1, warehouses: 1, interval: 'yearly' },
    total: 47328,
    shown: '$473.28',
    perMonth: '$39.44',
  },
  {
    name: '6 CRM and Projects 10 seats, WMS 2, Pulse',
    selection: { products: ['crm', 'wms', 'projects', 'pulse'], seats: 10, warehouses: 2, interval: 'monthly' },
    total: 90960,
    shown: '$909.60',
  },
  {
    name: '7 same as 6, yearly',
    selection: { products: ['crm', 'wms', 'projects', 'pulse'], seats: 10, warehouses: 2, interval: 'yearly' },
    total: 927792,
    shown: '$9,277.92',
    perMonth: '$773.16',
  },
  {
    name: '8 Projects 3 seats, yearly',
    selection: { products: ['projects'], seats: 3, warehouses: 1, interval: 'yearly' },
    total: 36720,
    shown: '$367.20',
    perMonth: '$30.60',
  },
  { name: '9 WMS 3 warehouses', selection: { products: ['wms'], seats: 1, warehouses: 3, interval: 'monthly' }, total: 104700, shown: '$1,047.00' },
];

describe('quote: the nine reference carts', () => {
  it.each(CARTS)('$name is $shown', ({ selection, total, shown, perMonth }) => {
    const q = quote(selection);
    expect(q.totalCents).toBe(total);
    expect(formatMoney(q.totalCents)).toBe(shown);
    if (perMonth) expect(formatMoney(q.monthlyEquivalentCents)).toBe(perMonth);
    // The identity: list minus the two discounts is the total.
    expect(q.listPeriodCents - q.yearlySavingsCents - q.bundleSavingsCents).toBe(q.totalCents);
    // The total is plain unit amount x quantity with the price the gateway charges.
    expect(q.lines.reduce((sum, line) => sum + priceKeyCents(line.priceKey) * line.quantity, 0)).toBe(total);
    expect(Number.isInteger(q.monthlyEquivalentCents)).toBe(true);
  });

  it('shows list price and each discount as its own amount', () => {
    const monthly = quote(CARTS[2].selection);
    expect(monthly.listPeriodCents).toBe(49400);
    expect(monthly.bundleSavingsCents).toBe(9880);
    expect(monthly.yearlySavingsCents).toBe(0);

    const yearly = quote(CARTS[3].selection);
    expect(yearly.listPeriodCents).toBe(592800);
    expect(yearly.yearlySavingsCents).toBe(88920);
    expect(yearly.bundleSavingsCents).toBe(100776);
    expect(yearly.periodMonths).toBe(12);

    expect(quote(CARTS[5].selection).listPeriodCents).toBe(113700);
  });
});

describe('quote lines', () => {
  it('writes the math in plain words', () => {
    const q = quote({ products: ['crm', 'wms', 'pulse'], seats: 5, warehouses: 1, interval: 'monthly' });
    expect(q.lines.map((line) => line.math)).toEqual([
      'CRM: 5 users x $29 = $145 per month',
      'WMS: 1 warehouse x $349 = $349 per month',
      // With CRM in the plan Pulse covers every seat, so the line names no limit (review round 5).
      'Pulse: $29 per month for your whole team',
    ]);
    expect(q.lines.map((line) => line.unitLabel)).toEqual(['users', 'warehouse', 'organization']);
    // Pulse alone, or with the WMS only, stops at its 5 seats and says so.
    expect(quote({ products: ['pulse'], seats: 3, warehouses: 1, interval: 'monthly' }).lines[0].math).toBe('Pulse: $29 per month for your whole team, up to 5 seats');
    expect(quote({ products: ['wms', 'pulse'], seats: 3, warehouses: 1, interval: 'monthly' }).lines[1].math).toBe('Pulse: $29 per month for your whole team, up to 5 seats');
    expect(quote({ products: ['projects', 'pulse'], seats: 128, warehouses: 1, interval: 'monthly' }).lines[1].math).toBe('Pulse: $29 per month for your whole team');
  });

  it('uses bundle and yearly price keys when they apply', () => {
    expect(quote({ products: ['crm'], seats: 2, warehouses: 1, interval: 'monthly' }).lines[0].priceKey).toBe('kitstak_crm_monthly');
    const bundleYearly = quote({ products: ['crm', 'projects'], seats: 2, warehouses: 1, interval: 'yearly' });
    expect(bundleYearly.isBundle).toBe(true);
    expect(bundleYearly.lines.map((line) => line.priceKey)).toEqual(['kitstak_crm_yearly_bundle', 'kitstak_projects_yearly_bundle']);
    expect(bundleYearly.lines[0].unitCents).toBe(23664);
    expect(bundleYearly.lines[0].listUnitMonthlyCents).toBe(2900);
    for (const line of bundleYearly.lines) expect(allPriceKeys()).toContain(line.priceKey);
  });

  it('keeps PRODUCT_IDS order and normalizes its input', () => {
    const q = quote({ products: ['pulse', 'crm'] as never, seats: 9999, warehouses: 0, interval: 'monthly' });
    expect(q.lines.map((line) => line.product)).toEqual(['crm', 'pulse']);
    expect(q.selection.seats).toBe(500);
    expect(q.selection.warehouses).toBe(1);
    expect(PRODUCT_IDS.indexOf('crm')).toBeLessThan(PRODUCT_IDS.indexOf('pulse'));
  });

  it('an empty cart costs nothing', () => {
    const q = quote({ products: [], seats: 3, warehouses: 1, interval: 'monthly' });
    expect(q.lines).toEqual([]);
    expect(q.totalCents).toBe(0);
    expect(q.seatLimit).toBeNull();
  });

  it('notes when the team is bigger than Pulse covers', () => {
    expect(quote({ products: ['pulse'], seats: 5, warehouses: 1, interval: 'monthly' }).pulseSeatNote).toBeNull();
    expect(quote({ products: ['pulse'], seats: 6, warehouses: 1, interval: 'monthly' }).pulseSeatNote).toBe(
      'The Pulse price covers up to 5 seats.',
    );
    expect(quote({ products: ['crm'], seats: 60, warehouses: 1, interval: 'monthly' }).pulseSeatNote).toBeNull();
    expect(quote({ products: ['crm', 'pulse'], seats: 60, warehouses: 1, interval: 'monthly' }).seatLimit).toBe(60);
  });
});

describe('quoteSummaryLines', () => {
  it('lists list price, discounts and total, in order', () => {
    const lines = quoteSummaryLines(quote(CARTS[3].selection));
    expect(lines).toEqual([
      { label: 'List price for 12 months', amountCents: 592800, kind: 'list' },
      { label: 'Yearly discount (15%)', amountCents: -88920, kind: 'discount' },
      { label: 'Bundle discount (20%)', amountCents: -100776, kind: 'discount' },
      { label: 'Total per year', amountCents: 403104, kind: 'total' },
    ]);
    expect(lines.reduce((sum, line) => (line.kind === 'total' ? sum : sum + line.amountCents), 0)).toBe(403104);
  });

  it('leaves out discounts that do not apply', () => {
    expect(quoteSummaryLines(quote(CARTS[1].selection))).toEqual([
      { label: 'List price', amountCents: 14500, kind: 'list' },
      { label: 'Total per month', amountCents: 14500, kind: 'total' },
    ]);
  });
});
