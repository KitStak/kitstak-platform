import { describe, expect, it } from 'vitest';
import { defaultOrderValues } from '@/components/orders/wizard/order-form-model';

describe('defaultOrderValues (Logiwa parity)', () => {
  it('defaults Reason For Export to Sale, priority 0, dates to now', () => {
    const now = new Date('2026-11-09T10:00:00Z');
    const v = defaultOrderValues(now);
    expect(v.reasonForExport).toBe('Sale');
    expect(v.priorityRank).toBe(0);
    expect(v.orderDate).toBe(now.toISOString());
    expect(v.expectedShipDate).toBe(now.toISOString());
    expect(v.skipAddressVerification).toBe(false);
    expect(v.useShipAsBilling).toBe(true);
  });
});
