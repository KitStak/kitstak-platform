import { describe, expect, it } from 'vitest';
import { greetingFor, hourIn } from './greeting';

describe('greetingFor', () => {
  it('uses one set of boundaries', () => {
    expect(greetingFor(new Date(2026, 0, 1, 4))).toBe('Good evening');
    expect(greetingFor(new Date(2026, 0, 1, 5))).toBe('Good morning');
    expect(greetingFor(new Date(2026, 0, 1, 12))).toBe('Good afternoon');
    expect(greetingFor(new Date(2026, 0, 1, 17, 30))).toBe('Good afternoon');
    expect(greetingFor(new Date(2026, 0, 1, 18))).toBe('Good evening');
  });
  it('reads the hour in the given zone', () => {
    const at = new Date('2026-11-13T17:30:00Z');
    expect(hourIn(at, 'UTC')).toBe(17);
    expect(greetingFor(at, 'UTC')).toBe('Good afternoon');
    expect(greetingFor(at, 'America/Los_Angeles')).toBe('Good morning');
    expect(greetingFor(at, 'Asia/Tokyo')).toBe('Good evening');
  });
  it('falls back to local time for a bad zone', () => {
    expect(hourIn(new Date(2026, 0, 1, 9), 'Not/AZone')).toBe(9);
  });
});
