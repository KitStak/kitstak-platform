import { describe, expect, it } from 'vitest';
import { deleteJobWarning } from './delete-job-words';

describe('deleteJobWarning', () => {
  it('names the revenue and the labor hours that leave the reports', () => {
    expect(deleteJobWarning({ number: 'J-1005', stats: { revenueCents: 8037500, hours: '565.00' } })).toBe(
      'J-1005 has $80,375 of revenue and 565 labor hours. They leave every report until you restore the job.',
    );
  });

  it('never shows money to a reader who cannot see it', () => {
    const text = deleteJobWarning({ number: 'J-1005', stats: { revenueCents: null, hours: '565.25' } });
    expect(text).toBe('J-1005 has 565.3 labor hours. That leaves every report until you restore the job.');
    expect(text).not.toContain('$');
  });

  it('handles revenue with no hours and one hour', () => {
    expect(deleteJobWarning({ number: 'J-2', stats: { revenueCents: 80000, hours: '0' } })).toBe(
      'J-2 has $800 of revenue. That leaves every report until you restore the job.',
    );
    expect(deleteJobWarning({ number: 'J-3', stats: { revenueCents: null, hours: '1.000' } })).toContain(
      '1 labor hour.',
    );
  });

  it('says so when nothing is logged', () => {
    expect(deleteJobWarning({ number: 'J-9', stats: { revenueCents: 0, hours: '0.00' } })).toBe(
      'J-9 has no work logged yet. It leaves every list until you restore the job.',
    );
    expect(deleteJobWarning({ number: 'J-9' })).toContain('no work logged yet');
  });
});
