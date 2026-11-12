import { describe, expect, it } from 'vitest';
import { formatLbOz, weightBreakdown, type PackLine } from '@/components/packing/pack-model';
import { notPackableOrderMessage } from '@/server/repositories/packing-scan';
import { nearestEnabled } from '@/components/returns/shipped-order-picker';

describe('pack weight breakdown', () => {
  const lines = [{ orderLineId: 'l1', weightOz: 8 }] as unknown as PackLine[];
  const box = { items: { l1: 2 } } as never;
  it('sums unit weight x qty plus package tare', () => {
    const b = weightBreakdown(lines, box, { emptyWeightLb: 0.35 } as never);
    expect(b).toEqual({ itemsOz: 16, tareOz: 5.6, totalOz: 21.6 });
    expect(formatLbOz(b.totalOz)).toBe('1 lb 5.6 oz');
    expect(formatLbOz(b.itemsOz)).toBe('1 lb');
    expect(formatLbOz(5.6)).toBe('5.6 oz');
  });
  it('treats a missing package as zero tare', () => {
    expect(weightBreakdown(lines, box, null).totalOz).toBe(16);
  });
});

describe('order-mode not-packable message', () => {
  it("says why the order can't be packed", () => {
    expect(notPackableOrderMessage('SO1', 'Ready to Ship')).toBe(
      'SO1 is Ready to Ship (already packed). Open the order to reprint the label.',
    );
    expect(notPackableOrderMessage('SO1', 'Cancelled')).toContain('cannot be packed');
    expect(notPackableOrderMessage('SO1', 'On Hold')).toContain('Release the hold');
    expect(notPackableOrderMessage('SO1', 'Open')).toContain('no picked units');
  });
});

describe('shipped-order picker active option', () => {
  it('never lands on a disabled row', () => {
    expect(nearestEnabled([1, 2], 0)).toBe(1);
    expect(nearestEnabled([1, 2], 5)).toBe(2);
    expect(nearestEnabled([], 0)).toBe(-1);
  });
});
