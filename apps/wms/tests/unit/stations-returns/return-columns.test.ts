/** Round 2: Return Orders grid headers fit their labels (no overlapping "FROM COUNTRY NAMESTATUS"). */
import { describe, expect, it } from 'vitest';
import { buildReturnColumns, headerFitWidth } from '@/components/returns/return-columns';

describe('return order columns', () => {
  it('every column is at least as wide as its header label needs', () => {
    for (const c of buildReturnColumns()) {
      const h = typeof c.header === 'string' ? c.header : '';
      expect(c.size ?? 0, h).toBeGreaterThanOrEqual(headerFitWidth(h));
      expect(c.minSize ?? 0, h).toBeGreaterThanOrEqual(headerFitWidth(h));
    }
  });
});
