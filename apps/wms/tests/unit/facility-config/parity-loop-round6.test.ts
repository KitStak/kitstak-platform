import { describe, expect, it } from 'vitest';
import { storedAddressIssues } from '@/lib/grid-defs/facility/warehouses';
import { cellBarcode, cellDisplayName } from '@/lib/grid-defs/facility/mobile-carts';
import { GENERATOR_DEFAULTS, generatorCount } from '@/lib/grid-defs/facility/location-generator';
import { pickDefaultWarehouse } from '@/components/facility/facility-shared';

describe('round 6: legacy warehouse address flags', () => {
  it('flags unknown country, invalid US state and bad phone', () => {
    const issues = storedAddressIssues({
      country: 'Narnia',
      state: 'ZZZZ-notastate',
      contactPhone: 'not a phone',
    });
    expect(issues.some((i) => i.includes('Narnia'))).toBe(true);
    expect(issues.some((i) => i.includes('not a phone'))).toBe(true);
    expect(
      storedAddressIssues({ country: 'United States', state: 'ZZZZ-notastate', contactPhone: '' })[0],
    ).toContain("isn't valid for US");
  });
  it('is clean for a valid record', () => {
    expect(
      storedAddressIssues({ country: 'United States', state: 'TN', contactPhone: '+1 901 555 0100' }),
    ).toEqual([]);
  });
});

describe('round 6: one cell naming convention', () => {
  it('display name matches the barcode suffix', () => {
    expect(cellDisplayName(1, 1)).toBe('A01');
    expect(cellBarcode('MC-05', 2, 3).endsWith(cellDisplayName(2, 3))).toBe(true);
  });
});

describe('round 6: generator starts empty', () => {
  it('previews 0 locations until a range is typed', () => {
    expect(
      generatorCount({
        zone: '',
        separator: '-',
        aisles: GENERATOR_DEFAULTS.aisles,
        racks: GENERATOR_DEFAULTS.racks,
        levels: GENERATOR_DEFAULTS.levels,
        positions: GENERATOR_DEFAULTS.positions,
      }),
    ).toBe(0);
  });
});

describe('round 6: warehouse default', () => {
  it('prefers header context, then preference, then the only warehouse', () => {
    expect(pickDefaultWarehouse(['a', 'b'], 'b', 'a')).toBe('b');
    expect(pickDefaultWarehouse(['a', 'b'], null, 'a')).toBe('a');
    expect(pickDefaultWarehouse(['a'], null, null)).toBe('a');
  });
});
