import { describe, expect, it } from 'vitest';
import {
  createKitDeltas,
  disassembleDeltas,
  matchSourceScan,
  signed,
  sourceScanCodes,
} from '@/lib/grid-defs/work-orders/kit-steps';

describe('Create Kit source confirmation', () => {
  const comps = [
    { locationCode: 'MLT1-C-01', lpNumber: null },
    { locationCode: 'mlt1-c-01', lpNumber: 'LP0009' },
    { locationCode: null, lpNumber: null },
  ];
  it('collects distinct location and LP codes without picking', () => {
    expect(sourceScanCodes(comps, false, 'KIT-01').sort()).toEqual(['LP0009', 'MLT1-C-01']);
  });
  it('uses the kitting area with picking', () => {
    expect(sourceScanCodes(comps, true, 'kit-01')).toEqual(['KIT-01']);
  });
  it('matches case-insensitively and rejects others', () => {
    expect(matchSourceScan(['MLT1-C-01'], ' mlt1-c-01 ')).toEqual({ ok: true, code: 'MLT1-C-01' });
    expect(matchSourceScan(['MLT1-C-01'], 'X-9').ok).toBe(false);
    expect(matchSourceScan(['MLT1-C-01'], '').ok).toBe(false);
    expect(matchSourceScan([], 'anything').ok).toBe(true);
  });
});

describe('Inventory transaction deltas', () => {
  const comps = [
    { id: 'c1', sku: 'A', location: 'L1', current: 10, perKit: 2 },
    { id: 'c2', sku: 'B', location: 'L1', current: 5, perKit: 1 },
  ];
  it('create kit: kit +n, components −perKit×n', () => {
    expect(createKitDeltas({ sku: 'K', location: 'KIT', current: 0 }, comps, 3).map((l) => l.change)).toEqual(
      [3, -6, -3],
    );
  });
  it('disassemble: kit −n, components +perKit×n', () => {
    expect(
      disassembleDeltas({ sku: 'K', location: 'KIT', current: 4 }, comps, 2).map((l) => l.change),
    ).toEqual([-2, 4, 2]);
  });
  it('formats signed values with a true minus', () => {
    expect([signed(3), signed(-6), signed(0)]).toEqual(['+3', '−6', '0']);
  });
});
