import { describe, expect, it } from 'vitest';
import { expectedLoad } from '@/components/shipment-plans/plan-form-model';

const base = {
  storedWeightLb: 0,
  storedVolumeFt3: 0,
  lineWeightLb: 3.5,
  lineVolumeFt3: 1.2,
  missingDimsProducts: 0,
};

describe('expectedLoad', () => {
  const AUTH = 'order lines · used on the Manifest/BOL';
  it('uses order lines when nothing is stored', () => {
    expect(expectedLoad(base)).toMatchObject({
      weightLb: 3.5,
      volumeFt3: 1.2,
      sourceLabel: AUTH,
      detail: null,
      warning: null,
    });
  });
  it('uses order lines when stored agrees', () => {
    expect(expectedLoad({ ...base, storedWeightLb: 3.5, storedVolumeFt3: 1.2 })).toMatchObject({
      sourceLabel: AUTH,
      detail: null,
    });
  });
  it('keeps the order lines as the one headline and labels a differing entered value', () => {
    const r = expectedLoad({ ...base, storedWeightLb: 4, storedVolumeFt3: 0 });
    expect(r.weightLb).toBe(3.5);
    expect(r.sourceLabel).toBe(AUTH);
    expect(r.detail).toBe('Entered on plan: 4.00 lb, 0.00 ft³ (not printed on the BOL)');
  });
  it('falls back to the entered value only when the order lines carry no weight', () => {
    const r = expectedLoad({
      ...base,
      lineWeightLb: 0,
      lineVolumeFt3: 0,
      storedWeightLb: 2.8,
      storedVolumeFt3: 0.32,
      unitCount: 3,
    });
    expect(r).toMatchObject({
      weightLb: 2.8,
      volumeFt3: 0.32,
      sourceLabel: 'entered on plan (order lines have no weight)',
      detail: null,
    });
    expect(r.warning).toContain('no weight or volume');
  });
  it('warns about products missing dims', () => {
    expect(expectedLoad({ ...base, lineWeightLb: 0, lineVolumeFt3: 0, missingDimsProducts: 2 }).warning).toBe(
      '2 products missing weight or dimensions',
    );
  });
});

import { deriveFromOrders } from '@/components/shipment-plans/plan-form-model';

describe('deriveFromOrders', () => {
  it("keeps the plan's own value", () =>
    expect(deriveFromOrders('FedEx', ['UPS'])).toEqual({ value: 'FedEx', hint: null }));
  it('inherits a value every order shares', () =>
    expect(deriveFromOrders(null, ['UPS · 2nd Day', 'UPS · 2nd Day'])).toEqual({
      value: 'UPS · 2nd Day',
      hint: 'from orders',
    }));
  it('marks a value only some orders have as partial', () =>
    expect(deriveFromOrders(null, ['UPS · 2nd Day', 'UPS · 2nd Day', null])).toEqual({
      value: 'UPS · 2nd Day',
      hint: 'partial: 2 of 3 orders',
    }));
  it('marks mixed values', () => expect(deriveFromOrders('', ['UPS', 'FedEx']).value).toBe('Mixed (2)'));
  it('returns null with no data', () =>
    expect(deriveFromOrders(null, [null])).toEqual({ value: null, hint: null }));
});

describe('expectedLoad zero-line warning', () => {
  it('warns when orders have units but lines carry no weight or volume', () => {
    const r = expectedLoad({
      storedWeightLb: 2.8,
      storedVolumeFt3: 0.32,
      lineWeightLb: 0,
      lineVolumeFt3: 0,
      missingDimsProducts: 0,
      unitCount: 7,
    });
    expect(r.warning).toBe('Order lines have no weight or volume: products missing dimensions');
  });
});
