/** M13 round 4 (parity loop): signed ledger quantities + running balance, export source links, zone offsets, partial day. */
import { describe, expect, it } from 'vitest';
import {
  exportFilterSummary,
  exportSourceHref,
  onHandDelta,
  runningBalances,
  signedLedgerQty,
} from '@/server/repositories/reports-logs';
import { zoneOffsetMinutes } from '@/server/repositories/reports-grid';
import { partialDayOnTime } from '@/server/repositories/analytics-operational';

describe('transaction history signed quantities', () => {
  it('source-only rows are decrements', () => {
    expect(signedLedgerQty(6, true, false)).toBe(-6); // Cancel Receiving
    expect(signedLedgerQty(1, true, false)).toBe(-1); // Kitting out of a location
  });
  it('target-only rows keep their stored sign (receipts, signed adjust/count deltas)', () => {
    expect(signedLedgerQty(400, false, true)).toBe(400);
    expect(signedLedgerQty(-3, false, true)).toBe(-3);
  });
  it('moves keep the quantity but do not change warehouse on hand', () => {
    expect(signedLedgerQty(24, true, true)).toBe(24);
    expect(onHandDelta(24, true, true)).toBe(0);
    expect(onHandDelta(5, true, false)).toBe(-5);
  });
  it('running balance gives before/after per row', () => {
    const rows = [{ delta: 10 }, { delta: 0 }, { delta: -4 }, { delta: 2 }];
    expect(runningBalances(rows)).toEqual([
      { before: 0, after: 10 },
      { before: 10, after: 10 },
      { before: 10, after: 6 },
      { before: 6, after: 8 },
    ]);
  });
});

describe('export history links back to the source grid', () => {
  it('keeps the exported filter set and drops paging', () => {
    expect(exportSourceHref('report-transaction-history', 'f.type=in%3AReceiving&page=3')).toBe(
      '/reports/transaction-history?f.type=in%3AReceiving',
    );
    expect(exportSourceHref('inventory-atp', '')).toBe('/inventory/atp');
    expect(exportSourceHref('unknown-grid', '')).toBeNull();
    expect(exportSourceHref(null, '')).toBeNull();
  });
  it('summarizes filters and search', () => {
    expect(exportFilterSummary('f.type=in%3AReceiving&f.sku=eq%3AA&q=ABC')).toBe('2 filters · search "ABC"');
    expect(exportFilterSummary('')).toBeNull();
    expect(exportFilterSummary('page=2')).toBeNull();
  });
});

describe('report date chips use the warehouse zone', () => {
  it('computes offsets east of UTC including DST', () => {
    expect(zoneOffsetMinutes('America/Chicago', new Date('2026-11-09T12:00:00Z'))).toBe(-360);
    expect(zoneOffsetMinutes('America/Chicago', new Date('2026-07-01T12:00:00Z'))).toBe(-300);
    expect(zoneOffsetMinutes('UTC')).toBe(0);
    expect(zoneOffsetMinutes('Not/AZone')).toBe(0);
  });
});

describe('fulfillment on-time trend', () => {
  it('leaves today off the line and breaks on undated days', () => {
    expect(partialDayOnTime('2026-11-09', '2026-11-09', 10, 0)).toBeNull();
    expect(partialDayOnTime('2026-11-08', '2026-11-09', 0, 0)).toBeNull();
    expect(partialDayOnTime('2026-11-08', '2026-11-09', 4, 3)).toBe(75);
  });
});
