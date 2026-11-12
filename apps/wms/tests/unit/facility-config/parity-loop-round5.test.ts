import { describe, expect, it } from 'vitest';
import { commonCodePrefix } from '@/lib/grid-defs/facility/common';
import { defaultWarehouseHint } from '@/components/facility/facility-shared';

describe('commonCodePrefix (generator success toast filter)', () => {
  it('returns the shared prefix', () =>
    expect(commonCodePrefix(['KSCRIT-A-01', 'KSCRIT-A-02'])).toBe('KSCRIT-A-0'));
  it('handles a single code', () => expect(commonCodePrefix(['P-A-01-1'])).toBe('P-A-01-1'));
  it('returns empty when nothing is shared', () => expect(commonCodePrefix(['A-01', 'B-01'])).toBe(''));
  it('returns empty for no codes', () => expect(commonCodePrefix([])).toBe(''));
});

describe('defaultWarehouseHint (critic R4: no silent warehouse default)', () => {
  const ids = ['mlt1', 'ks2'];
  it('explains the header context', () => expect(defaultWarehouseHint(ids, 'ks2', null)).toMatch(/header/));
  it('explains the preferred warehouse', () =>
    expect(defaultWarehouseHint(ids, null, 'mlt1')).toMatch(/preferred/));
  it('is null when nothing is defaulted', () => expect(defaultWarehouseHint(ids, null, null)).toBeNull());
});
