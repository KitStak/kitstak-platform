import { describe, expect, it } from 'vitest';
import { chartNumber, resolveFormat, seriesColor, signed } from './chart-format';
import { arcPath, areaPath, bandLayout, barPath, estimateTextWidth, fitLabel, formatDateLong, formatDateTick, labelStride, linePath, linearScale, niceScale, pointPositions, shiftDate, visibleLabelIndexes, weekdayOf, wrapLabel } from './scale';

describe('niceScale', () => {
  it('gives round ticks that hold zero', () => {
    const scale = niceScale([1200, 4800, 18_300]);
    expect(scale.min).toBe(0);
    expect(scale.max).toBe(20_000);
    expect(scale.ticks).toEqual([0, 5000, 10_000, 15_000, 20_000]);
  });
  it('covers values under zero', () => {
    const scale = niceScale([-3100, 19_100]);
    expect(scale.min).toBeLessThanOrEqual(-3100);
    expect(scale.max).toBeGreaterThanOrEqual(19_100);
    expect(scale.ticks).toContain(0);
  });
  it('survives empty, all zero and single value data', () => {
    expect(niceScale([]).max).toBeGreaterThan(0);
    expect(niceScale([0, 0, 0]).ticks.length).toBeGreaterThan(1);
    expect(niceScale([42]).max).toBeGreaterThanOrEqual(42);
    expect(niceScale([-7]).min).toBeLessThanOrEqual(-7);
    expect(niceScale([null, undefined, Number.NaN]).ticks.every(Number.isFinite)).toBe(true);
  });
  it('can leave zero out for lines', () => {
    const scale = niceScale([2100, 2900], { includeZero: false });
    expect(scale.min).toBeGreaterThan(0);
    expect(scale.min).toBeLessThanOrEqual(2100);
  });
  it('has no floating point noise in ticks', () => {
    expect(niceScale([0.1, 0.7]).ticks.every((tick) => String(tick).length <= 4)).toBe(true);
  });
});

describe('geometry', () => {
  it('maps values to pixels and puts a flat domain in the middle', () => {
    expect(linearScale(0, 100, 200, 0)(25)).toBe(150);
    expect(linearScale(5, 5, 0, 100)(5)).toBe(50);
  });
  it('caps bar width and centers slots', () => {
    const band = bandLayout(4, 0, 400);
    expect(band.band).toBe(24);
    expect(band.center(0)).toBe(50);
    expect(bandLayout(0, 0, 100).step).toBe(100);
  });
  it('centers a single point', () => {
    expect(pointPositions(1, 0, 100)).toEqual([50]);
    expect(pointPositions(3, 0, 100)).toEqual([0, 50, 100]);
    expect(pointPositions(0, 0, 100)).toEqual([]);
  });
  it('breaks lines at gaps', () => {
    expect(linePath([0, 10, 20, 30], [5, null, 7, 9])).toBe('M0 5M20 7L30 9');
    expect(linePath([], [])).toBe('');
    expect(areaPath([0, 10], [5, 6], 20)).toBe('M0 5L10 6L10 20L0 20Z');
  });
  it('draws bars both ways without NaN', () => {
    for (const path of [barPath(10, 20, 100, 40, 4), barPath(10, 20, 100, 140, 4), barPath(10, 20, 0, 1, 4, false), arcPath(50, 50, 40, 20, 0, Math.PI * 2)]) {
      expect(path).not.toContain('NaN');
      expect(path.startsWith('M')).toBe(true);
    }
  });
});

describe('labels', () => {
  it('cuts long labels and keeps short ones', () => {
    expect(fitLabel('Kitting', 200)).toBe('Kitting');
    const cut = fitLabel('Bluebird Subscription Boxes International', 80);
    expect(cut.endsWith('...')).toBe(true);
    expect(estimateTextWidth(cut)).toBeLessThanOrEqual(80);
    expect(fitLabel('Anything', 2)).toBe('');
  });
  it('wraps to two lines at spaces', () => {
    expect(wrapLabel('Labor efficiency', 60)).toEqual(['Labor', 'efficiency']);
    expect(wrapLabel('Price', 60)).toEqual(['Price']);
    const lines = wrapLabel('Bluebird Subscription Boxes International', 70);
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith('...')).toBe(true);
  });
  it('skips labels that would touch and always keeps the newest', () => {
    const labels = Array.from({ length: 30 }, () => 'Oct 30');
    const stride = labelStride(labels, 12);
    expect(stride).toBeGreaterThan(1);
    const shown = visibleLabelIndexes(30, stride);
    expect(shown.has(29)).toBe(true);
    expect(labelStride(['a'], 5)).toBe(1);
  });
});

describe('dates', () => {
  it('formats ticks and long text', () => {
    expect(formatDateTick('2026-11-03')).toBe('Nov 3');
    expect(formatDateTick('2026-11-01', 'month', '2026-10-01')).toBe('Nov');
    expect(formatDateTick('2027-01-01', 'month', '2026-12-01')).toBe('Jan 2027');
    expect(formatDateLong('2026-11-03')).toBe('Tue, Nov 3, 2026');
    expect(formatDateLong('2026-11-02', 'week')).toBe('Week of Nov 2, 2026');
    expect(formatDateLong('2026-11-01', 'month')).toBe('November 2026');
    expect(formatDateTick('not a date')).toBe('not a date');
  });
  it('shifts dates across months and leap days', () => {
    expect(shiftDate('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftDate('2028-02-28', 1)).toBe('2028-02-29');
    expect(weekdayOf('2026-11-17')).toBe(2);
  });
});

describe('chart formats', () => {
  it('reads money in cents and percent in basis points', () => {
    expect(resolveFormat('money').axis(4_821_000)).toBe('$48.2K');
    expect(resolveFormat('money').value(4_821_000)).toBe('$48,210');
    expect(resolveFormat('money').value(1250)).toBe('$12.50');
    expect(resolveFormat('money').value(-45_00)).toBe('-$45.00');
    expect(resolveFormat('percent').value(2236)).toBe('22.4%');
    expect(resolveFormat('percent').axis(3000)).toBe('30%');
    expect(resolveFormat('hours').value(1)).toBe('1 hour');
    expect(resolveFormat(undefined).value(12_480)).toBe('12,480');
  });
  it('adds a plus only above zero', () => {
    expect(signed('$10', 10)).toBe('+$10');
    expect(signed('-$10', -10)).toBe('-$10');
    expect(signed('$0', 0)).toBe('$0');
  });
  it('keeps missing numbers missing', () => {
    expect(chartNumber(null)).toBeNull();
    expect(chartNumber('')).toBeNull();
    expect(chartNumber('12.5')).toBe(12.5);
    expect(chartNumber(BigInt(7))).toBe(7);
  });
  it('never invents a ninth hue', () => {
    expect(seriesColor(0)).toBe('var(--pulse-series-1)');
    expect(seriesColor(8)).toBe('var(--pulse-chart-neutral)');
  });
});
