/**
 * Pure geometry for the Pulse charts: nice axis ticks, band layout, SVG paths and label fitting.
 * No React and no DOM, so every rule here is unit tested (`scale.test.ts`). Nothing in this file
 * does money math: values arrive as plain numbers that only decide where a mark is drawn.
 */

export interface NiceScale {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly ticks: readonly number[];
}

function niceStep(rough: number): number {
  if (!(rough > 0) || !Number.isFinite(rough)) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const unit = rough / power;
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10;
  return nice * power;
}

/** Rounds floating point noise off a tick ("0.30000000000000004" becomes 0.3). */
function tidy(value: number, step: number): number {
  const digits = Math.max(0, Math.ceil(-Math.log10(step)) + 2);
  return Number(value.toFixed(Math.min(digits, 12)));
}

/**
 * A scale with clean ticks that always holds zero (bars and money lines grow from zero) unless
 * `includeZero` is false. A flat or empty domain still gives a usable scale.
 */
export function niceScale(values: readonly (number | null | undefined)[], options: { tickCount?: number; includeZero?: boolean; integer?: boolean } = {}): NiceScale {
  const tickCount = Math.max(2, options.tickCount ?? 5);
  const finite = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  let min = finite.length ? Math.min(...finite) : 0;
  let max = finite.length ? Math.max(...finite) : 0;
  if (options.includeZero ?? true) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  if (min === max) {
    if (max === 0) max = 1;
    else if (max > 0) min = options.includeZero === false ? max - Math.abs(max) * 0.1 : 0;
    else max = 0;
  }
  let step = niceStep((max - min) / tickCount);
  if (options.integer) step = Math.max(1, Math.round(step));
  const niceMin = Math.floor(min / step + 1e-9) * step;
  const niceMax = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let value = niceMin; value <= niceMax + step * 1e-6; value += step) ticks.push(tidy(value, step));
  return { min: tidy(niceMin, step), max: tidy(niceMax, step), step, ticks };
}

/** Maps a value from a domain to pixels. A zero width domain maps to the middle of the range. */
export function linearScale(domainMin: number, domainMax: number, rangeMin: number, rangeMax: number): (value: number) => number {
  const span = domainMax - domainMin;
  if (span === 0) return () => (rangeMin + rangeMax) / 2;
  return (value) => rangeMin + ((value - domainMin) / span) * (rangeMax - rangeMin);
}

export interface BandLayout {
  /** Width of one slot. */
  readonly step: number;
  /** Width of the mark inside the slot (capped so bars stay thin). */
  readonly band: number;
  /** Center of slot `index`. */
  readonly center: (index: number) => number;
}

/** Slots for categories across `[start, end]`. Marks never fill the slot: the leftover is air. */
export function bandLayout(count: number, start: number, end: number, options: { maxBand?: number; fill?: number } = {}): BandLayout {
  const safeCount = Math.max(1, count);
  const step = Math.max(0, end - start) / safeCount;
  const band = Math.max(1, Math.min(options.maxBand ?? 24, step * (options.fill ?? 0.62)));
  return { step, band, center: (index) => start + step * (index + 0.5) };
}

/** X positions for a line: points spread edge to edge, a single point sits in the middle. */
export function pointPositions(count: number, start: number, end: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [(start + end) / 2];
  return Array.from({ length: count }, (_, index) => start + ((end - start) * index) / (count - 1));
}

const r = (value: number): number => Math.round(value * 100) / 100;

/** A polyline path. A `null` y breaks the line, so a missing day reads as a gap and not as zero. */
export function linePath(xs: readonly number[], ys: readonly (number | null)[]): string {
  let path = '';
  let pen = false;
  for (let index = 0; index < xs.length; index += 1) {
    const y = ys[index];
    if (y === null || y === undefined || !Number.isFinite(y)) {
      pen = false;
      continue;
    }
    path += `${pen ? 'L' : 'M'}${r(xs[index]!)} ${r(y)}`;
    pen = true;
  }
  return path;
}

/** Closed areas under a line down to `baseline`, one piece per unbroken run. */
export function areaPath(xs: readonly number[], ys: readonly (number | null)[], baseline: number): string {
  let path = '';
  let runStart = -1;
  const close = (endIndex: number) => {
    if (runStart < 0) return;
    path += `L${r(xs[endIndex]!)} ${r(baseline)}L${r(xs[runStart]!)} ${r(baseline)}Z`;
    runStart = -1;
  };
  for (let index = 0; index < xs.length; index += 1) {
    const y = ys[index];
    if (y === null || y === undefined || !Number.isFinite(y)) {
      close(index - 1);
      continue;
    }
    path += `${runStart < 0 ? 'M' : 'L'}${r(xs[index]!)} ${r(y)}`;
    if (runStart < 0) runStart = index;
  }
  close(xs.length - 1);
  return path;
}

/**
 * A bar from `from` to `to` along the value axis with the data end rounded and the base square.
 * `vertical` bars use x as the cross axis; horizontal bars swap the roles.
 */
export function barPath(cross: number, thickness: number, from: number, to: number, radius: number, vertical = true): string {
  const length = Math.abs(to - from);
  const rad = Math.max(0, Math.min(radius, thickness / 2, length));
  const dir = to >= from ? 1 : -1;
  const a = cross;
  const b = cross + thickness;
  const tip = to - dir * rad;
  if (vertical) {
    return `M${r(a)} ${r(from)}L${r(a)} ${r(tip)}Q${r(a)} ${r(to)} ${r(a + rad)} ${r(to)}L${r(b - rad)} ${r(to)}Q${r(b)} ${r(to)} ${r(b)} ${r(tip)}L${r(b)} ${r(from)}Z`;
  }
  return `M${r(from)} ${r(a)}L${r(tip)} ${r(a)}Q${r(to)} ${r(a)} ${r(to)} ${r(a + rad)}L${r(to)} ${r(b - rad)}Q${r(to)} ${r(b)} ${r(tip)} ${r(b)}L${r(from)} ${r(b)}Z`;
}

function polar(cx: number, cy: number, radius: number, angle: number): [number, number] {
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
}

/** A ring segment between two angles (radians, 0 at 3 o'clock, clockwise). */
export function arcPath(cx: number, cy: number, outer: number, inner: number, startAngle: number, endAngle: number): string {
  const sweep = Math.min(Math.abs(endAngle - startAngle), Math.PI * 2 - 1e-4);
  const end = startAngle + sweep;
  const large = sweep > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, outer, startAngle);
  const [x1, y1] = polar(cx, cy, outer, end);
  const [x2, y2] = polar(cx, cy, inner, end);
  const [x3, y3] = polar(cx, cy, inner, startAngle);
  return `M${r(x0)} ${r(y0)}A${r(outer)} ${r(outer)} 0 ${large} 1 ${r(x1)} ${r(y1)}L${r(x2)} ${r(y2)}A${r(inner)} ${r(inner)} 0 ${large} 0 ${r(x3)} ${r(y3)}Z`;
}

/** An open arc stroke (for rings and gauges). */
export function arcStroke(cx: number, cy: number, radius: number, startAngle: number, endAngle: number): string {
  const sweep = Math.min(Math.abs(endAngle - startAngle), Math.PI * 2 - 1e-4);
  const end = startAngle + sweep;
  const [x0, y0] = polar(cx, cy, radius, startAngle);
  const [x1, y1] = polar(cx, cy, radius, end);
  return `M${r(x0)} ${r(y0)}A${r(radius)} ${r(radius)} 0 ${sweep > Math.PI ? 1 : 0} 1 ${r(x1)} ${r(y1)}`;
}

const NARROW = new Set(['i', 'l', 'j', 't', 'f', 'r', 'I', '.', ',', ':', ';', "'", ' ', '|', '!', '(', ')']);
const WIDE = new Set(['m', 'w', 'M', 'W', '%', '@']);

/** A close guess at the width of UI text in pixels (the charts never measure the DOM). */
export function estimateTextWidth(text: string, fontSize = 11): number {
  let units = 0;
  for (const char of text) {
    if (NARROW.has(char)) units += 0.3;
    else if (WIDE.has(char)) units += 0.86;
    else if (char >= 'A' && char <= 'Z') units += 0.66;
    else if (char >= '0' && char <= '9') units += 0.6;
    else units += 0.54;
  }
  return units * fontSize;
}

/** Cuts a label to fit `maxWidth`, ending in three dots. Short labels pass through. */
export function fitLabel(text: string, maxWidth: number, fontSize = 11): string {
  if (estimateTextWidth(text, fontSize) <= maxWidth) return text;
  const chars = Array.from(text);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (estimateTextWidth(`${chars.slice(0, mid).join('')}...`, fontSize) <= maxWidth) low = mid;
    else high = mid - 1;
  }
  if (low <= 0) return '';
  return `${chars.slice(0, low).join('').trimEnd()}...`;
}

/**
 * Which x labels to draw so no two touch: every `stride`th one, anchored so the last label
 * (the newest date) always shows.
 */
export function labelStride(labels: readonly string[], slotWidth: number, options: { fontSize?: number; gap?: number; maxLabelWidth?: number } = {}): number {
  if (labels.length <= 1) return 1;
  const fontSize = options.fontSize ?? 11;
  const cap = options.maxLabelWidth ?? Number.POSITIVE_INFINITY;
  const widest = Math.min(cap, Math.max(...labels.map((label) => estimateTextWidth(label, fontSize))));
  const needed = widest + (options.gap ?? 10);
  return Math.max(1, Math.ceil(needed / Math.max(1, slotWidth)));
}

export function visibleLabelIndexes(count: number, stride: number): Set<number> {
  const shown = new Set<number>();
  for (let index = count - 1; index >= 0; index -= stride) shown.add(index);
  return shown;
}

export type TimeBucket = 'day' | 'week' | 'month';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parts(date: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** Short axis text for a `YYYY-MM-DD` bucket start: "Nov 3", or "Nov" and "Jan 2027" for months. */
export function formatDateTick(date: string, bucket: TimeBucket = 'day', previous?: string): string {
  const p = parts(date);
  if (!p) return date;
  if (bucket === 'month') {
    const before = previous ? parts(previous) : null;
    const yearChanged = before !== null && before.year !== p.year;
    return yearChanged || (p.month === 1 && before !== null) ? `${MONTHS[p.month - 1]} ${p.year}` : MONTHS[p.month - 1]!;
  }
  return `${MONTHS[p.month - 1]} ${p.day}`;
}

/** Full text for tooltips and the data table: "Tue, Nov 3, 2026", "Week of Nov 2, 2026", "November 2026". */
export function formatDateLong(date: string, bucket: TimeBucket = 'day'): string {
  const p = parts(date);
  if (!p) return date;
  if (bucket === 'month') return `${MONTHS_LONG[p.month - 1]} ${p.year}`;
  const base = `${MONTHS[p.month - 1]} ${p.day}, ${p.year}`;
  if (bucket === 'week') return `Week of ${base}`;
  return `${WEEKDAYS[weekdayOf(date)]}, ${base}`;
}

/** Day of the week for a `YYYY-MM-DD` date, 0 = Sunday. Time zones never shift it. */
export function weekdayOf(date: string): number {
  const p = parts(date);
  if (!p) return 0;
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/** Adds days to a `YYYY-MM-DD` date. */
export function shiftDate(date: string, days: number): string {
  const p = parts(date);
  if (!p) return date;
  return new Date(Date.UTC(p.year, p.month - 1, p.day + days)).toISOString().slice(0, 10);
}

export const MONTH_NAMES_SHORT: readonly string[] = MONTHS;
export const WEEKDAY_NAMES_SHORT: readonly string[] = WEEKDAYS;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
