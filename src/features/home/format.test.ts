import { describe, expect, it } from 'vitest';
import { formatDueLabel, formatRelativeTime, greetingFor, pluralize, proportions } from './format';

describe('greetingFor', () => {
  it('returns a greeting for each part of the day', () => {
    expect(greetingFor(new Date(2026, 0, 1, 8))).toBe('Good morning');
    expect(greetingFor(new Date(2026, 0, 1, 13))).toBe('Good afternoon');
    expect(greetingFor(new Date(2026, 0, 1, 21))).toBe('Good evening');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-11-05T12:00:00Z');
  it('formats recent times compactly', () => {
    expect(formatRelativeTime('2026-11-05T11:59:30Z', now)).toBe('just now');
    expect(formatRelativeTime('2026-11-05T11:55:00Z', now)).toBe('5m ago');
    expect(formatRelativeTime('2026-11-05T09:00:00Z', now)).toBe('3h ago');
    expect(formatRelativeTime('2026-11-03T12:00:00Z', now)).toBe('2d ago');
  });
  it('returns an empty string for invalid input', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('');
  });
});

describe('home formatters', () => {
  it('labels due dates relative to today', () => {
    expect(formatDueLabel('2026-11-05', '2026-11-05')).toEqual({ text: 'Today', tone: 'today' });
    expect(formatDueLabel('2026-11-06', '2026-11-05')).toEqual({ text: 'Tomorrow', tone: 'soon' });
    expect(formatDueLabel('2026-11-04', '2026-11-05')).toEqual({ text: 'Yesterday', tone: 'overdue' });
    expect(formatDueLabel('2026-10-20', '2026-11-05').tone).toBe('overdue');
  });
  it('splits proportions to 100', () => {
    expect(proportions([1, 1, 1]).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 5);
    expect(proportions([0, 0])).toEqual([0, 0]);
    expect(proportions([3, 1])).toEqual([75, 25]);
  });
  it('pluralizes terminology', () => {
    expect(pluralize('deal', 2)).toBe('deals');
    expect(pluralize('activity', 3)).toBe('activities');
    expect(pluralize('deal', 1)).toBe('deal');
    expect(pluralize('box', 2)).toBe('boxes');
  });
});
