import { describe, expect, it } from 'vitest';
import { parseDateSpec, resolveDateRange, serializeDateSpec } from '@/server/query/date-presets';

// Thursday 2026-11-05 15:30 UTC
const NOW = new Date('2026-11-05T15:30:00.000Z');

function range(value: string, tz = 0) {
  const spec = parseDateSpec(value);
  if (!spec) throw new Error(`bad spec ${value}`);
  return resolveDateRange(spec, NOW, tz);
}

describe('date presets', () => {
  it('today / lastNd / last12m', () => {
    expect(range('today')).toEqual({ from: '2026-11-05T00:00:00.000Z', to: '2026-11-05T23:59:59.999Z' });
    expect(range('last3d').from).toBe('2026-11-03T00:00:00.000Z');
    expect(range('last30d').from).toBe('2026-10-07T00:00:00.000Z');
    expect(range('last12m').from).toBe('2025-11-05T00:00:00.000Z');
  });

  it('relative presets', () => {
    expect(range('ahead2d')).toEqual({ from: '2026-11-07T00:00:00.000Z', to: null });
    expect(range('before2d')).toEqual({ from: null, to: '2026-11-03T23:59:59.999Z' });
    expect(range('withinPast1d')).toEqual({ from: '2026-11-04T00:00:00.000Z', to: NOW.toISOString() });
    expect(range('withinNext1d')).toEqual({ from: NOW.toISOString(), to: '2026-11-06T23:59:59.999Z' });
  });

  it('weekday picks the most recent such day', () => {
    expect(range('thu').from).toBe('2026-11-05T00:00:00.000Z');
    expect(range('mon').from).toBe('2026-11-02T00:00:00.000Z');
    expect(range('fri').from).toBe('2026-10-30T00:00:00.000Z');
  });

  it('honours a warehouse timezone offset', () => {
    // CST (-360): local day 2026-11-05 starts 06:00Z.
    expect(range('today', -360)).toEqual({
      from: '2026-11-05T06:00:00.000Z',
      to: '2026-11-06T05:59:59.999Z',
    });
  });

  it('custom ranges with date-only and picker formats', () => {
    expect(range('custom:2026-11-01..2026-11-02')).toEqual({
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-02T23:59:59.999Z',
    });
    expect(range('custom:2026/11/05 00:00..2026/11/05 23:59')).toEqual({
      from: '2026-11-05T00:00:00.000Z',
      to: '2026-11-05T23:59:59.999Z',
    });
    expect(range('custom:..2026-11-02').from).toBeNull();
  });

  it('rejects invalid specs and round-trips valid ones', () => {
    for (const bad of ['yesterday', 'ahead99999d', 'custom:', 'custom:..', 'custom:nope..2026-01-01'])
      expect(parseDateSpec(bad)).toBeNull();
    for (const good of ['today', 'sat', 'before7d', 'custom:2026-01-01..']) {
      const spec = parseDateSpec(good);
      expect(spec && serializeDateSpec(spec)).toBe(good);
    }
  });
});
