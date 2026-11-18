import { describe, expect, it } from 'vitest';
import { jobChartLabel } from './job-label';

describe('jobChartLabel', () => {
  it('names the job, not just its number', () => {
    expect(jobChartLabel('J-1005', 'Holiday gift kits')).toBe('J-1005 Holiday gift kits');
  });
  it('falls back to the number when there is no name', () => {
    expect(jobChartLabel('J-1005', null)).toBe('J-1005');
    expect(jobChartLabel('J-1005', '  ')).toBe('J-1005');
  });
  it('keeps long names short enough for a chart axis', () => {
    expect(jobChartLabel('J-1005', 'Driftwood Freight retrofit kits for the west coast')).toBe('J-1005 Driftwood Freight retrofit…');
  });
});
