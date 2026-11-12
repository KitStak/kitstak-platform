import { describe, expect, it } from 'vitest';
import { initialCustomParams } from '@/components/shipping/custom-report-params';
import { selectCustomReportRows, type EodRow } from '@/server/repositories/end-of-day';

const row = (id: string, shipDate: string, carrierCode: string, warehouseCode = 'MLT1'): EodRow => ({
  id,
  isPending: false,
  manifestId: id,
  warehouseId: 'w',
  warehouseCode,
  shipFrom: 'Main',
  carrierConnectionId: 'cc',
  carrierPrefix: `${carrierCode}-1`,
  carrierCode,
  carrierName: carrierCode,
  shipDate,
  closeDate: null,
  isPrinted: false,
  totalPackages: 1,
  voidedPackages: 0,
  status: 'Open',
  reportFileId: null,
  version: 1,
  sequence: 1,
  isOverdue: false,
  timezone: 'America/Chicago',
  scheduledPickupAt: null,
});

const rows = [
  row('a', '2026-11-05', 'UPS'),
  row('b', '2026-11-06', 'USPS'),
  row('c', '2026-11-07', 'UPS', 'KS2'),
  row('d', '2026-11-09', 'UPS'),
];

describe('Print custom report parameters', () => {
  it('covers every manifest whose ship date is in the inclusive range', () => {
    expect(selectCustomReportRows(rows, { from: '2026-11-05', to: '2026-11-07' }).map((r) => r.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
  it('accepts a reversed range', () => {
    expect(selectCustomReportRows(rows, { from: '2026-11-07', to: '2026-11-06' }).map((r) => r.id)).toEqual([
      'b',
      'c',
    ]);
  });
  it('filters by carrier and warehouse', () => {
    expect(
      selectCustomReportRows(rows, { from: '2026-11-01', to: '2026-11-30', carrierCodes: ['UPS'] }).map(
        (r) => r.id,
      ),
    ).toEqual(['a', 'c', 'd']);
    expect(
      selectCustomReportRows(rows, {
        from: '2026-11-01',
        to: '2026-11-30',
        carrierCodes: ['UPS'],
        warehouseCodes: ['KS2'],
      }).map((r) => r.id),
    ).toEqual(['c']);
  });
  it('seeds the dialog from the selection, or today with all carriers', () => {
    expect(initialCustomParams([], new Date(2026, 10, 9))).toEqual({
      from: '2026-11-09',
      to: '2026-11-09',
      carrier: null,
    });
    expect(initialCustomParams([rows[2], rows[0]])).toEqual({
      from: '2026-11-05',
      to: '2026-11-07',
      carrier: 'UPS',
    });
    expect(initialCustomParams([rows[0], rows[1]]).carrier).toBeNull();
  });
});
