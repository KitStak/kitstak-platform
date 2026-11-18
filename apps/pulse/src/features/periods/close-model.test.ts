import { describe, expect, it } from 'vitest';
import { closableFrom, pickMonth } from './close-model';

const months = [
  { periodMonth: '2026-11-01', status: 'open' as const, inProgress: true },
  { periodMonth: '2026-10-01', status: 'open' as const, inProgress: false },
  { periodMonth: '2026-09-01', status: 'closed' as const, inProgress: false },
];

describe('pickMonth', () => {
  it('opens the month asked for when it exists', () => {
    expect(pickMonth(months, '2026-09-01')).toBe('2026-09-01');
  });
  it('falls back to the oldest finished month that is still open', () => {
    expect(pickMonth(months, null)).toBe('2026-10-01');
    expect(pickMonth(months, '2020-01-01')).toBe('2026-10-01');
  });
  it('falls back to the newest month when nothing waits', () => {
    expect(pickMonth([months[0]!, months[2]!], null)).toBe('2026-11-01');
    expect(pickMonth([], null)).toBeNull();
  });
});

describe('closableFrom', () => {
  it('names the day after the month ends', () => {
    expect(closableFrom('2026-11-01')).toBe('December 1');
    expect(closableFrom('2026-12-01')).toBe('January 1');
  });
});
