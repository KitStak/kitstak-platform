import { describe, expect, test } from 'vitest';
import type { InvoiceRow } from '@kitstak/billing/server';
import { invoiceView } from './invoice-view';

type Line = InvoiceRow['lines'][number];
const line = (description: string, product: Line['product'], quantity: number, unitCents: number, amountCents: number, proration = false): Line => ({
  description,
  product,
  quantity,
  unitCents,
  amountCents,
  proration,
});
const MONTH = { periodStart: new Date('2026-12-07T00:00:00Z'), periodEnd: new Date('2027-01-07T00:00:00Z') };

describe('invoiceView', () => {
  test('a plan invoice repeats the picker lines, and the promo code is listed once', () => {
    // TEST-0001 from the review: CRM for 5 and 1 warehouse with the bundle price, and TEST10.
    const view = invoiceView({
      ...MONTH,
      lines: [
        line('KitStak CRM', 'crm', 5, 2320, 11600),
        line('KitStak WMS', 'wms', 1, 27920, 27920),
        line('Promo code TEST10 (10% off)', null, 1, -3952, -3952),
      ],
      discountCents: 3952,
      creditAppliedCents: 0,
    });
    expect(view.quote?.lines.map((entry) => entry.math)).toEqual([
      'CRM: 5 users x $29 = $145 per month',
      'WMS: 1 warehouse x $349 = $349 per month',
    ]);
    expect(view.quote?.listPeriodCents).toBe(49400);
    expect(view.quote?.bundleSavingsCents).toBe(9880);
    // The subtotal is the sum of the lines above it.
    expect(view.subtotalCents).toBe(39520);
    expect(view.quote?.totalCents).toBe(view.subtotalCents);
    // Once, not as a table line AND as "Discount".
    expect(view.adjustments).toEqual([{ label: 'Promo code TEST10 (10% off)', amountCents: -3952 }]);
    expect(view.subtotalCents + view.adjustments.reduce((sum, entry) => sum + entry.amountCents, 0)).toBe(35568);
  });

  test('a discount or credit with no line of its own is still shown, once', () => {
    const view = invoiceView({
      ...MONTH,
      lines: [line('KitStak CRM', 'crm', 2, 2900, 5800)],
      discountCents: 580,
      creditAppliedCents: 1000,
    });
    expect(view.adjustments).toEqual([
      { label: 'Discount', amountCents: -580 },
      { label: 'Credit from your account', amountCents: -1000 },
    ]);
  });

  test('a plan change keeps the gateway lines, and the subtotal still equals their sum', () => {
    const view = invoiceView({
      ...MONTH,
      lines: [
        line('Unused time on 5 seats', 'crm', 5, -1160, -5800, true),
        line('Remaining time on 6 seats', 'crm', 6, 1160, 6960, true),
      ],
      discountCents: 0,
      creditAppliedCents: 0,
    });
    expect(view.quote).toBeNull();
    expect(view.rawLines).toHaveLength(2);
    expect(view.subtotalCents).toBe(1160);
    expect(view.adjustments).toEqual([]);
  });

  test('lines that do not match the catalog fall back to the gateway lines', () => {
    const view = invoiceView({ ...MONTH, lines: [line('KitStak CRM', 'crm', 5, 2500, 12500)], discountCents: 0, creditAppliedCents: 0 });
    expect(view.quote).toBeNull();
    expect(view.subtotalCents).toBe(12500);
  });

  test('a yearly plan is rebuilt with the yearly discount as its own line', () => {
    const year = { periodStart: new Date('2026-12-07T00:00:00Z'), periodEnd: new Date('2027-12-07T00:00:00Z') };
    const view = invoiceView({ ...year, lines: [line('KitStak CRM', 'crm', 2, 29580, 59160)], discountCents: 0, creditAppliedCents: 0 });
    expect(view.quote?.interval).toBe('yearly');
    expect(view.quote?.yearlySavingsCents).toBe(10440);
    expect(view.quote?.totalCents).toBe(59160);
  });
});
