import { describe, expect, it } from 'vitest';
import { REPORTS, reportInfo } from './reports';
import { STREAMS, STREAM_IDS, isStreamId, streamInfo } from './streams';

describe('catalogs', () => {
  it('lists all 17 data streams once', () => {
    expect(STREAMS).toHaveLength(17);
    expect(new Set(STREAMS.map((stream) => stream.id)).size).toBe(17);
    expect([...STREAMS.map((stream) => stream.id)].sort()).toEqual([...STREAM_IDS].sort());
    expect(new Set(STREAMS.map((stream) => stream.file)).size).toBe(17);
  });

  it('finds streams by id', () => {
    expect(streamInfo('production')?.file).toBe('production.csv');
    expect(streamInfo('nope')).toBeNull();
    expect(isStreamId('costs')).toBe(true);
    expect(isStreamId('cost')).toBe(false);
  });

  it('lists all 19 reports with unique url safe slugs', () => {
    expect(REPORTS).toHaveLength(19);
    expect(new Set(REPORTS.map((report) => report.slug)).size).toBe(19);
    for (const report of REPORTS) expect(report.slug).toMatch(/^[a-z]+(-[a-z]+)*$/);
    expect(reportInfo('ready-to-bill')?.name).toBe('Ready to bill');
    expect(reportInfo('missing')).toBeNull();
  });

  it('keeps reports with no money open to floor roles', () => {
    expect(REPORTS.filter((report) => !report.needsMoney).map((report) => report.slug)).toEqual(['pace-vs-target', 'paid-time-not-on-any-job', 'daily-production-log', 'audit-log']);
  });
});
