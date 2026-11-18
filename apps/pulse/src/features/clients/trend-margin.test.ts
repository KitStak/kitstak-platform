import { describe, expect, it } from 'vitest';
import { trendMarginLine } from './trend-margin';

describe('trendMarginLine', () => {
  it('leaves a week with tiny revenue off the margin line, so one outlier does not flatten the rest', () => {
    // Apex Threads: the week of Oct 26 had $433.50 of revenue and a -3,903.7% margin.
    const points = [
      { revenueCents: 1_250_000, marginBp: 2100 },
      { revenueCents: 43_350, marginBp: -390_370 },
      { revenueCents: 1_100_000, marginBp: 1650 },
    ];
    expect(trendMarginLine(points)).toEqual({ values: [2100, null, 1650], skipped: 1 });
  });

  it('keeps every week when revenue is steady', () => {
    const points = [
      { revenueCents: 900_000, marginBp: -500 },
      { revenueCents: 1_000_000, marginBp: 1200 },
    ];
    expect(trendMarginLine(points)).toEqual({ values: [-500, 1200], skipped: 0 });
  });

  it('a week with no revenue has no margin', () => {
    expect(trendMarginLine([{ revenueCents: 0, marginBp: null }, { revenueCents: null, marginBp: null }])).toEqual({ values: [null, null], skipped: 0 });
  });
});
