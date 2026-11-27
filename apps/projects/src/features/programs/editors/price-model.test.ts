import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICE_LINES, EMPTY_FIXED, centsToDollars, fromCardLines, oneTimeProblems, priceLinesProblems, priceToInput, readMoney, readPrice, toCardLines, toOneTimeInputs, type PriceLinesValue } from './price-model';

describe('price lines model', () => {
  it('reads money and prices as typed', () => {
    expect(readMoney('1,500')).toEqual({ ok: true, cents: '150000' });
    expect(readMoney('$12.5')).toEqual({ ok: true, cents: '1250' });
    expect(readMoney('0')).toEqual({ ok: false, message: 'Use an amount above $0.' });
    expect(readMoney('0', { allowZero: true })).toEqual({ ok: true, cents: '0' });
    expect(readMoney('1.234')).toEqual({ ok: false, message: 'Use up to 2 decimals for money.' });
    expect(readMoney('')).toEqual({ ok: false, message: 'Add an amount.' });
    expect(readPrice('1.95')).toEqual({ ok: true, price: '1.9500' });
    expect(readPrice('1.12345')).toEqual({ ok: false, message: 'Use up to 4 decimals for a rate.' });
  });

  it('says what to fix', () => {
    expect(priceLinesProblems(DEFAULT_PRICE_LINES)).toEqual({ perUnit: 'Add a price.' });
    const none: PriceLinesValue = { ...DEFAULT_PRICE_LINES, perUnit: { on: false, price: '', label: null } };
    expect(priceLinesProblems(none).lines).toMatch(/at least one line/);
    expect(priceLinesProblems(none, { later: true })).toEqual({});
    const minimum: PriceLinesValue = { ...DEFAULT_PRICE_LINES, perUnit: { on: true, price: '1.95', label: null }, minimum: { ...EMPTY_FIXED, on: true, amount: '0' } };
    expect(priceLinesProblems(minimum)).toEqual({ minimum: 'The minimum must be more than $0.' });
    expect(priceLinesProblems({ ...minimum, minimum: EMPTY_FIXED, variantRates: { 'XL-BRN': '2.123456' } })).toEqual({ 'variant:XL-BRN': 'Use up to 4 decimals for a rate.' });
  });

  it('makes card lines in cents and 4 decimal prices', () => {
    const value: PriceLinesValue = {
      perUnit: { on: true, price: '1.95', label: null },
      variantRates: { 'XL-BRN': '2.20', 'S-BRN': '' },
      perOrder: { on: true, amount: '5', label: 'Order fee' },
      perHour: { on: true, rate: '42.50', countAllTime: false, label: null },
      monthlyFee: { on: true, amount: '500', partialMonth: true, chargeWhilePaused: false, label: null },
      minimum: { on: true, amount: '12,000', partialMonth: false, chargeWhilePaused: true, label: null },
    };
    expect(toCardLines(value)).toEqual([
      { kind: 'per_unit', variantId: null, unitPrice: '1.9500', label: null },
      { kind: 'per_unit', variantKey: 'XL-BRN', unitPrice: '2.2000', label: null },
      { kind: 'per_order', variantId: null, amountCents: '500', label: 'Order fee' },
      { kind: 'per_hour', rateCents: 4250, label: null },
      { kind: 'flat_monthly', amountCents: '50000', prorate: true, chargeWhilePaused: false, label: null },
      { kind: 'monthly_minimum', amountCents: '1200000', prorate: false, chargeWhilePaused: true, label: null },
    ]);
  });

  it('reads saved lines back into the editor', () => {
    const value = fromCardLines(
      [
        { id: '1', kind: 'per_unit', variantId: null, ruleId: null, unitPrice: '1.9500', rateCents: null, amountCents: null, prorate: true, chargeWhilePaused: true, label: null, position: 0 },
        { id: '2', kind: 'per_unit', variantId: 'v-xl', ruleId: null, unitPrice: '2.2000', rateCents: null, amountCents: null, prorate: true, chargeWhilePaused: true, label: null, position: 1 },
        { id: '3', kind: 'per_unit', variantId: 'v-l', ruleId: 'rule', unitPrice: '2.1000', rateCents: null, amountCents: null, prorate: true, chargeWhilePaused: true, label: null, position: 2 },
        { id: '4', kind: 'monthly_minimum', variantId: null, ruleId: null, unitPrice: null, rateCents: null, amountCents: '1200000', prorate: true, chargeWhilePaused: true, label: null, position: 3 },
      ],
      new Map([['v-xl', 'XL-BRN'], ['v-l', 'L-BRN']]),
    );
    expect(value.perUnit).toEqual({ on: true, price: '1.95', label: null });
    expect(value.variantRates).toEqual({ 'XL-BRN': '2.2' });
    expect(value.minimum).toMatchObject({ on: true, amount: '12000.00' });
    expect(value.monthlyFee.on).toBe(false);
    expect(centsToDollars('150000')).toBe('1500.00');
    expect(priceToInput('1.8525')).toBe('1.8525');
    expect(priceToInput('2.0000')).toBe('2');
  });

  it('checks and converts one time charges', () => {
    const rows = [
      { id: 'a', label: 'Setup fee', amount: '2,500', chargeOn: '2026-11-02' },
      { id: 'b', label: '', amount: '1', chargeOn: '2026-11-02' },
      { id: 'c', label: 'Tooling', amount: '100', chargeOn: '2026-10-01' },
    ];
    expect(oneTimeProblems(rows, { notBefore: '2026-11-02' })).toEqual({ b: 'Name the charge.', c: 'The day cannot be before the program starts.' });
    expect(toOneTimeInputs(rows)).toEqual([
      { label: 'Setup fee', amountCents: '250000', chargeOn: '2026-11-02' },
      { label: 'Tooling', amountCents: '10000', chargeOn: '2026-10-01' },
    ]);
  });
});
