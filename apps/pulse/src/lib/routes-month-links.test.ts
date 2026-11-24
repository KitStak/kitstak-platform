import { describe, expect, it } from 'vitest';
import { routes } from './routes';

describe('month close links', () => {
  it('opens the review page on one month', () => {
    expect(routes.logReview()).toBe('/log/review');
    expect(routes.logReview({ month: '2026-01-01' })).toBe('/log/review?month=2026-01');
  });

  it('opens the entries on the month, showing only rows with units and no hours', () => {
    expect(routes.logEntries()).toBe('/log/entries');
    expect(routes.logEntries({ from: '2026-01-01', to: '2026-01-31', needsHours: true })).toBe('/log/entries?from=2026-01-01&to=2026-01-31&needsHours=1');
  });

  it('opens paid time on exactly the month', () => {
    expect(routes.labor('rates')).toBe('/labor?tab=rates');
    expect(routes.labor('time', { from: '2026-01-01', to: '2026-01-31' })).toBe('/labor?tab=time&range=custom&from=2026-01-01&to=2026-01-31');
  });
});
