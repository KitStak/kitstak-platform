import { describe, expect, it } from 'vitest';
import { daysFrom, formatDay, formatMoney, formatMonth, formatPercent, initials, noun, plural, relativeDay } from './format';

const TODAY = new Date('2026-11-05T10:00:00Z');

describe('crm format', () => {
  it('formats money compactly above 100k', () => {
    expect(formatMoney(1_250_000)).toBe('$1.3M');
    expect(formatMoney(45_000)).toBe('$45,000');
    expect(formatMoney(45_000, 'EUR', { compact: true })).toBe('€45K');
  });

  it('formats percentages and handles null', () => {
    expect(formatPercent(0.4567)).toBe('46%');
    expect(formatPercent(0.4567, 1)).toBe('45.7%');
    expect(formatPercent(null)).toBe('None');
  });

  it('formats months and days', () => {
    expect(formatMonth('2026-11')).toBe('Nov 2026');
    expect(formatMonth('2027-01', true)).toBe('Jan');
    expect(formatMonth('overdue')).toBe('Overdue');
    expect(formatDay('2026-12-24', TODAY)).toBe('Dec 24');
    expect(formatDay('2027-01-02', TODAY)).toBe('Jan 2, 2027');
    expect(formatDay(null)).toBe('None');
  });

  it('computes relative days', () => {
    expect(daysFrom('2026-11-01', TODAY)).toBe(4);
    expect(relativeDay('2026-11-05', TODAY)).toBe('Today');
    expect(relativeDay('2026-11-04', TODAY)).toBe('Yesterday');
    expect(relativeDay('2026-11-06', TODAY)).toBe('Tomorrow');
    expect(relativeDay('2026-11-01', TODAY)).toBe('4 days ago');
    expect(relativeDay('2026-11-15', TODAY)).toBe('In 10 days');
  });

  it('pluralises item terminology', () => {
    expect(noun('Deal', 2)).toBe('deals');
    expect(noun('Activity', 3)).toBe('activities');
    expect(noun('Lead')).toBe('lead');
    expect(plural(1, 'deal')).toBe('1 deal');
    expect(plural(1200, 'deal')).toBe('1,200 deals');
  });

  it('derives initials', () => {
    expect(initials('Harbor Distribution')).toBe('HD');
    expect(initials('Acme')).toBe('AC');
    expect(initials('  ')).toBe('?');
  });
});
