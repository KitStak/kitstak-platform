import { describe, expect, it } from 'vitest';
import { MAX_RANGE_DAYS, dayCount, defaultPreset, formatRange, isOneDay, parseRange, presetRange, rangeButtonLabel, shiftDay, shiftRange } from './range';

const today = '2026-11-25';

describe('builds range param', () => {
  it('defaults by view: Today on Board, This week elsewhere', () => {
    expect(defaultPreset('board')).toBe('today');
    expect(defaultPreset('runs')).toBe('this-week');
    expect(parseRange(null, today, 'board')).toEqual({ from: today, to: today, preset: 'today' });
    expect(parseRange(undefined, today, 'list')).toEqual({ from: '2026-11-23', to: '2026-11-29', preset: 'this-week' });
  });

  it('reads presets, days and ranges', () => {
    expect(parseRange('yesterday', today)).toEqual({ from: '2026-11-24', to: '2026-11-24', preset: 'yesterday' });
    expect(parseRange('next-7', today)).toEqual({ from: today, to: '2026-12-01', preset: 'next-7' });
    expect(parseRange('last-7', today)).toEqual({ from: '2026-11-19', to: today, preset: 'last-7' });
    expect(parseRange('this-month', today)).toEqual({ from: '2026-11-01', to: '2026-11-30', preset: 'this-month' });
    expect(parseRange('2026-11-20', today)).toEqual({ from: '2026-11-20', to: '2026-11-20', preset: null });
    expect(parseRange('2026-11-23..2026-11-29', today)).toEqual({ from: '2026-11-23', to: '2026-11-29', preset: null });
  });

  it('falls back on bad or reversed values and caps long ranges', () => {
    expect(parseRange('2026-02-30', today, 'runs').preset).toBe('this-week');
    expect(parseRange('2026-11-29..2026-11-23', today, 'board').preset).toBe('today');
    const long = parseRange('2026-01-01..2026-12-31', today);
    expect(dayCount(long.from, long.to)).toBe(MAX_RANGE_DAYS);
  });

  it('writes the param back', () => {
    expect(formatRange(presetRange('today', today))).toBe('today');
    expect(formatRange({ from: '2026-11-20', to: '2026-11-20', preset: null })).toBe('2026-11-20');
    expect(formatRange({ from: '2026-11-23', to: '2026-11-29', preset: null })).toBe('2026-11-23..2026-11-29');
  });

  it('moves days and ranges', () => {
    expect(shiftDay({ from: today }, 1)).toEqual({ from: '2026-11-26', to: '2026-11-26', preset: null });
    expect(shiftRange({ from: '2026-11-23', to: '2026-11-29' }, -1)).toEqual({ from: '2026-11-16', to: '2026-11-22', preset: null });
    expect(isOneDay({ from: today, to: today })).toBe(true);
    expect(dayCount('2026-11-23', '2026-11-29')).toBe(7);
  });

  it('labels the range button', () => {
    expect(rangeButtonLabel(presetRange('this-week', today))).toBe('This week');
    expect(rangeButtonLabel({ from: '2026-11-23', to: '2026-11-29', preset: null })).toBe('Nov 23 to Nov 29');
  });
});
