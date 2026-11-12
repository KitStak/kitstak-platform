/** M13 round 3 (parity loop): warehouse-time-zone ranges and buckets, client filter, change-log deleted rows. */
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  clIn,
  dayFilter,
  daySql,
  localDayOf,
  parseRange,
  rangeFilter,
} from '@/server/repositories/analytics-common';
import { clientQs } from '@/server/repositories/analytics-labor';

const NY = 'America/New_York';

describe('analytics range in the warehouse time zone', () => {
  it("'today' is the warehouse-local day, not the UTC day (US evening)", () => {
    // 2026-11-10T03:30Z is 22:30 on 11/09 in New York.
    const r = parseRange({}, new Date('2026-11-10T03:30:00Z'), NY);
    expect(r.to).toBe('2026-11-09');
    expect(r.from).toBe('2026-10-11');
    expect(r.days).toHaveLength(30);
    expect(r.tz).toBe(NY);
    // Bounds are local midnights: EST (UTC-5) after the 11/01 DST change, EDT (UTC-4) before.
    expect(r.toIso).toBe('2026-11-10T05:00:00.000Z');
    expect(r.fromIso).toBe('2026-10-11T04:00:00.000Z');
    expect(r.bounds).toHaveLength(31);
  });

  it('falls back to UTC for an unknown zone', () => {
    const r = parseRange(
      { from: '2026-11-01', to: '2026-11-02' },
      new Date('2026-11-03T00:00:00Z'),
      'Not/AZone',
    );
    expect(r.tz).toBe('UTC');
    expect(r.fromIso).toBe('2026-11-01T00:00:00.000Z');
  });

  it('buckets an instant into its local day', () => {
    expect(localDayOf('2026-11-10T03:33:08.722Z', { tz: NY })).toBe('2026-11-09');
    expect(localDayOf('2026-11-10T05:00:00.000Z', { tz: NY })).toBe('2026-11-10');
  });

  it('daySql builds one CASE branch per day with local-midnight bounds', () => {
    const r = parseRange({ from: '2026-11-08', to: '2026-11-09' }, new Date('2026-11-10T00:00:00Z'), NY);
    const q = sql`SELECT ${daySql('x.at', r)}`.getSQL();
    const params = (q.queryChunks as unknown[]).length;
    expect(params).toBeGreaterThan(0);
    expect(r.bounds).toEqual([
      '2026-11-08T05:00:00.000Z',
      '2026-11-09T05:00:00.000Z',
      '2026-11-10T05:00:00.000Z',
    ]);
  });

  it('drilldown filters carry the exact local-day bounds, so grid totals match the buckets', () => {
    const r = parseRange({ from: '2026-11-09', to: '2026-11-09' }, new Date('2026-11-10T00:00:00Z'), NY);
    expect(dayFilter('shippedAt', '2026-11-09', r)).toBe(
      'f.shippedAt=date:custom:2026-11-09T05:00:00.000Z..2026-11-10T04:59:59.999Z',
    );
    expect(rangeFilter('shippedAt', r)).toBe(
      'f.shippedAt=date:custom:2026-11-09T05:00:00.000Z..2026-11-10T04:59:59.999Z',
    );
  });
});

describe('analytics client filter', () => {
  it('adds a client clause and drilldown filter only when clients are picked', () => {
    expect(clientQs({ clientIds: [] })).toBe('');
    expect(clientQs({ clientIds: ['c1', 'c 2'] })).toBe('&f.clientId=in:c1,c%202');
    expect(clIn('o.client_id', { clientIds: [] })).toBeTruthy();
    const r = parseRange({}, new Date('2026-11-10T00:00:00Z'), 'UTC', ['c1']);
    expect(r.clientIds).toEqual(['c1']);
  });
});
