import { describe, expect, it } from 'vitest';
import { compactWhen } from '@/lib/grid-defs/integrations/workflows';
import { formatBatchWhen, groupImports } from '@/components/integrations/imports-hub';

const time = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;

describe('compactWhen', () => {
  const now = new Date(2026, 10, 9, 12, 0);
  it('drops the year inside the current year', () => {
    expect(compactWhen(new Date(2026, 10, 9, 23, 46), time, now)).toBe('11/09 23:46');
  });
  it('shows the date with year for older values', () => {
    expect(compactWhen(new Date(2025, 0, 3, 8, 5), time, now)).toBe('01/03/2025');
  });
  it('passes invalid input through', () => {
    expect(compactWhen('nope', time, now)).toBe('nope');
  });
});

describe('imports hub helpers', () => {
  it('groups by area in registry order', () => {
    const g = groupImports([
      { key: 'products', title: 'P', area: 'products', href: '/products', configured: true, columns: 3 },
      { key: 'locations', title: 'L', area: 'locations', href: '/locations', configured: true, columns: 2 },
      { key: 'pack-types', title: 'PT', area: 'products', href: '/products', configured: false, columns: 4 },
    ]);
    expect(g.map((x) => x.area)).toEqual(['products', 'locations']);
    expect(g[0]?.items.map((i) => i.key)).toEqual(['products', 'pack-types']);
  });
  it('formats batch timestamps compactly', () => {
    expect(formatBatchWhen(new Date(2026, 10, 9, 23, 46).toISOString())).toBe('11/09/2026 11:46 PM');
    expect(formatBatchWhen(new Date(2026, 0, 1, 0, 5).toISOString())).toBe('01/01/2026 12:05 AM');
    expect(formatBatchWhen('bad')).toBe('bad');
  });
});
