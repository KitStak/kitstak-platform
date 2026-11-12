import { describe, expect, it } from 'vitest';
import { bucketTxnDirection } from '@/server/repositories/inventory-by-location';

type Raw = Parameters<typeof bucketTxnDirection>[0];
const txn = (over: Partial<Raw>): Raw =>
  ({ type: 'Inventory Adjustment', qty: 1, fromInventoryId: null, toInventoryId: 'b1', ...over }) as Raw;

describe('bucket transaction direction', () => {
  it('labels single-sided adjustments by sign', () => {
    expect(bucketTxnDirection(txn({ qty: 2 }), 'b1')).toBe('in');
    expect(bucketTxnDirection(txn({ qty: -1 }), 'b1')).toBe('out');
    expect(bucketTxnDirection(txn({ type: 'Count', qty: 3 }), 'b1')).toBe('in');
  });
  it('labels transfers by side and same-bucket moves as neutral', () => {
    expect(
      bucketTxnDirection(txn({ type: 'Transfer', fromInventoryId: 'b1', toInventoryId: 'b2' }), 'b1'),
    ).toBe('out');
    expect(
      bucketTxnDirection(txn({ type: 'Transfer', fromInventoryId: 'b2', toInventoryId: 'b1' }), 'b1'),
    ).toBe('in');
    expect(
      bucketTxnDirection(txn({ type: 'Status', fromInventoryId: 'b1', toInventoryId: 'b1' }), 'b1'),
    ).toBe('neutral');
  });
});
