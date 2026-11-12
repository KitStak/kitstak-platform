import { describe, expect, it } from 'vitest';
import { voidSummary } from '@/lib/grid-defs/shipping/shipments';
import { isAutoExpectedLoad } from '@/lib/grid-defs/shipping/shipment-plans';

describe('void toast count', () => {
  it('reports every label a multi-package void cancelled, with the shipment count', () => {
    expect(voidSummary(2, 1)).toBe('2 labels voided (1 shipment)');
    expect(voidSummary(5, 2)).toBe('5 labels voided (2 shipments)');
  });
  it('keeps single-package voids short', () => {
    expect(voidSummary(1, 1)).toBe('1 label voided');
    expect(voidSummary(3, 3)).toBe('3 labels voided');
  });
});

describe('expected load follows the orders while automatic', () => {
  const previous = { weightLb: 3.5, volumeFt3: 1.2 };
  it('treats a never-set plan (0/0) as automatic', () => {
    expect(isAutoExpectedLoad(0, 0, previous)).toBe(true);
  });
  it("treats a value equal to the previous orders' totals as automatic", () => {
    expect(isAutoExpectedLoad(3.5, 1.2, previous)).toBe(true);
    expect(isAutoExpectedLoad(3.501, 1.199, previous)).toBe(true);
  });
  it('keeps a value the user typed by hand', () => {
    expect(isAutoExpectedLoad(4, 1.2, previous)).toBe(false);
    expect(isAutoExpectedLoad(0, 2, previous)).toBe(false);
  });
});
