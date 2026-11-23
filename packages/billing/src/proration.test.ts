import { describe, expect, it } from 'vitest';
import { prorationDateFor, prorationDaysLeft, prorationDirection } from './proration';

const DAY = 24 * 60 * 60 * 1000;
const start = new Date('2026-11-23T10:15:30.000Z');
const end = new Date('2026-12-23T10:15:30.000Z');

describe('prorationDirection', () => {
  it('is a charge when the price per period goes up or stays', () => {
    expect(prorationDirection({ oldRecurringCents: 100, newRecurringCents: 200, intervalChanged: false })).toBe('charge');
    expect(prorationDirection({ oldRecurringCents: 100, newRecurringCents: 100, intervalChanged: false })).toBe('charge');
  });
  it('is a credit when the price goes down or the billing period changes', () => {
    expect(prorationDirection({ oldRecurringCents: 200, newRecurringCents: 100, intervalChanged: false })).toBe('credit');
    expect(prorationDirection({ oldRecurringCents: 100, newRecurringCents: 9000, intervalChanged: true })).toBe('credit');
  });
});

describe('prorationDateFor', () => {
  it('charges the full period for a plan paid minutes ago', () => {
    const now = new Date(start.getTime() + 7 * 60 * 1000);
    expect(prorationDaysLeft({ periodStart: start, periodEnd: end, now, direction: 'charge' })).toBe(30);
    expect(prorationDateFor({ periodStart: start, periodEnd: end, now, direction: 'charge' })).toEqual(start);
  });

  it('gives the same date all day long, so the amount cannot move while a person reads it', () => {
    const morning = new Date(start.getTime() + 3 * DAY + 60 * 1000);
    const night = new Date(start.getTime() + 4 * DAY - 60 * 1000);
    const a = prorationDateFor({ periodStart: start, periodEnd: end, now: morning, direction: 'charge' });
    const b = prorationDateFor({ periodStart: start, periodEnd: end, now: night, direction: 'charge' });
    expect(a).toEqual(b);
    expect(a).toEqual(new Date(start.getTime() + 3 * DAY));
  });

  it('is always a whole number of days before the period end', () => {
    for (const minutes of [1, 59, 600, 1441, 20_000, 43_000]) {
      const now = new Date(start.getTime() + minutes * 60 * 1000);
      for (const direction of ['charge', 'credit'] as const) {
        const date = prorationDateFor({ periodStart: start, periodEnd: end, now, direction });
        expect((end.getTime() - date.getTime()) % DAY).toBe(0);
        expect(date.getTime()).toBeGreaterThanOrEqual(start.getTime());
        expect(date.getTime()).toBeLessThanOrEqual(end.getTime());
      }
    }
  });

  it('never credits more days than a charge at the same moment would have billed', () => {
    for (const minutes of [0, 1, 1439, 1440, 1441, 10_000, 43_199]) {
      const now = new Date(start.getTime() + minutes * 60 * 1000);
      const charged = prorationDaysLeft({ periodStart: start, periodEnd: end, now, direction: 'charge' });
      const later = new Date(now.getTime() + 60 * 1000);
      const credited = prorationDaysLeft({ periodStart: start, periodEnd: end, now: later, direction: 'credit' });
      expect(credited).toBeLessThanOrEqual(charged);
    }
  });

  it('a credit a minute after a charge leaves at least one day paid', () => {
    const now = new Date(start.getTime() + 5 * DAY + 3_600_000);
    const charged = prorationDaysLeft({ periodStart: start, periodEnd: end, now, direction: 'charge' });
    const credited = prorationDaysLeft({ periodStart: start, periodEnd: end, now: new Date(now.getTime() + 60_000), direction: 'credit' });
    expect(charged - credited).toBe(1);
  });

  it('stays inside the period after it ended or before it began', () => {
    const after = new Date(end.getTime() + DAY);
    expect(prorationDateFor({ periodStart: start, periodEnd: end, now: after, direction: 'charge' })).toEqual(end);
    const before = new Date(start.getTime() - DAY);
    expect(prorationDateFor({ periodStart: start, periodEnd: end, now: before, direction: 'charge' })).toEqual(start);
  });
});
