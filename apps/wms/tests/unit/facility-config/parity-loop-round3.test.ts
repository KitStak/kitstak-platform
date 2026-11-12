import { describe, expect, it } from 'vitest';
import {
  countryCodeOf,
  normalizeState,
  warehouseInfoSchema,
  WAREHOUSE_DEFAULTS,
} from '@/lib/grid-defs/facility/warehouses';
import { groupZonesByWarehouse } from '@/components/locations/zone-summary-strip';

describe('warehouse address validation (round 3)', () => {
  it('resolves country names and codes', () => {
    expect(countryCodeOf('United States')).toBe('US');
    expect(countryCodeOf('usa')).toBe('US');
    expect(countryCodeOf('CA')).toBe('CA');
    expect(countryCodeOf('Narnia')).toBeNull();
  });
  it('normalizes US/CA states and rejects free text', () => {
    expect(normalizeState('United States', 'california')).toBe('CA');
    expect(normalizeState('United States', 'tx')).toBe('TX');
    expect(normalizeState('Canada', 'Ontario')).toBe('ON');
    expect(normalizeState('United States', 'ZZZZ-notastate abc')).toBeNull();
    expect(normalizeState('Germany', 'Bavaria')).toBe('Bavaria');
  });
  it('schema flags an invalid state and an unknown country', () => {
    const base = {
      ...WAREHOUSE_DEFAULTS,
      code: 'T1',
      name: 'T',
      prefix: 'T',
      addressLine: '1 Main',
      postalCode: '89501',
      city: 'Reno',
      contactName: 'A',
      contactPhone: '7755550100',
    };
    const bad = warehouseInfoSchema.safeParse({ ...base, state: 'ZZZZ-notastate abc' });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues.some((i) => i.path[0] === 'state')).toBe(true);
    const ok = warehouseInfoSchema.safeParse({ ...base, state: 'NV' });
    expect(ok.error?.issues ?? []).toEqual([]);
    const noCountry = warehouseInfoSchema.safeParse({ ...base, state: 'NV', country: 'Atlantis' });
    expect(noCountry.error?.issues.some((i) => i.path[0] === 'country')).toBe(true);
  });
});

describe('zone strip grouping', () => {
  it('groups by warehouse in first-seen order', () => {
    const z = (zone: string, warehouseCode: string) => ({
      zoneId: zone + warehouseCode,
      zone,
      warehouseCode,
      binCount: 1,
      occupiedCount: 0,
      storedUnits: 0,
    });
    const g = groupZonesByWarehouse([z('Bulk', 'KS2'), z('Bulk', 'MLT1'), z('Pick', 'KS2')]);
    expect(g.map((x) => x.warehouseCode)).toEqual(['KS2', 'MLT1']);
    expect(g[0]?.zones.map((x) => x.zone)).toEqual(['Bulk', 'Pick']);
  });
});
