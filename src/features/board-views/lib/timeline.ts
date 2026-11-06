/** Timeline (Gantt) geometry: visible range, day ↔ px mapping, header ticks and drag math. */
import type { TimelineZoom } from './config';
import { addDays, addMonths, diffDays, formatIso, isoToTime, startOfMonth, startOfWeek, type IsoDate } from './dates';

export const PX_PER_DAY: Readonly<Record<TimelineZoom, number>> = { day: 44, week: 18, month: 6, quarter: 2.4 };

export const ZOOM_LABELS: Readonly<Record<TimelineZoom, string>> = {
  day: 'Days',
  week: 'Weeks',
  month: 'Months',
  quarter: 'Quarters',
};

export interface TimelineRange {
  readonly start: IsoDate;
  readonly end: IsoDate;
  readonly days: number;
}

/** Range covering every bar plus today, padded and snapped to month starts. */
export function computeRange(dates: readonly { start: IsoDate; end: IsoDate }[], today: IsoDate): TimelineRange {
  let min = today;
  let max = today;
  for (const entry of dates) {
    if (entry.start < min) min = entry.start;
    if (entry.end > max) max = entry.end;
  }
  const start = startOfMonth(addMonths(min, -1));
  const end = addDays(startOfMonth(addMonths(max, 2)), -1);
  return { start, end, days: diffDays(start, end) + 1 };
}

export function dayToX(range: TimelineRange, iso: IsoDate, pxPerDay: number): number {
  return diffDays(range.start, iso) * pxPerDay;
}

export function xToDayOffset(px: number, pxPerDay: number): number {
  return Math.round(px / pxPerDay);
}

export interface Tick {
  readonly key: string;
  readonly label: string;
  readonly x: number;
  readonly width: number;
  readonly weekend?: boolean;
}

const QUARTER = (iso: IsoDate) => Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1;

/** Two-tier header: major (months / quarters / years) and minor (days / weeks / months). */
export function buildTicks(range: TimelineRange, zoom: TimelineZoom): { major: Tick[]; minor: Tick[] } {
  const px = PX_PER_DAY[zoom];
  const major: Tick[] = [];
  const minor: Tick[] = [];
  const push = (list: Tick[], from: IsoDate, to: IsoDate, label: string, weekend?: boolean) => {
    const clippedFrom = from < range.start ? range.start : from;
    const clippedTo = to > range.end ? range.end : to;
    if (clippedFrom > clippedTo) return;
    list.push({
      key: `${from}`,
      label,
      x: dayToX(range, clippedFrom, px),
      width: (diffDays(clippedFrom, clippedTo) + 1) * px,
      ...(weekend && { weekend }),
    });
  };
  // Major tier
  if (zoom === 'quarter') {
    for (let cursor = `${range.start.slice(0, 4)}-01-01`; cursor <= range.end; cursor = addMonths(cursor, 12)) {
      push(major, cursor, addDays(addMonths(cursor, 12), -1), cursor.slice(0, 4));
    }
  } else if (zoom === 'month') {
    const q = QUARTER(range.start);
    let cursor = `${range.start.slice(0, 4)}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`;
    for (; cursor <= range.end; cursor = addMonths(cursor, 3)) {
      push(major, cursor, addDays(addMonths(cursor, 3), -1), `Q${QUARTER(cursor)} ${cursor.slice(0, 4)}`);
    }
  } else {
    for (let cursor = startOfMonth(range.start); cursor <= range.end; cursor = addMonths(cursor, 1)) {
      push(major, cursor, addDays(addMonths(cursor, 1), -1), formatIso(cursor, 'month'));
    }
  }
  // Minor tier
  if (zoom === 'day') {
    for (let cursor = range.start; cursor <= range.end; cursor = addDays(cursor, 1)) {
      const weekday = new Date(isoToTime(cursor) ?? 0).getUTCDay();
      push(minor, cursor, cursor, String(Number(cursor.slice(8, 10))), weekday === 0 || weekday === 6);
    }
  } else if (zoom === 'week') {
    for (let cursor = startOfWeek(range.start, 1); cursor <= range.end; cursor = addDays(cursor, 7)) {
      push(minor, cursor, addDays(cursor, 6), formatIso(cursor < range.start ? range.start : cursor));
    }
  } else {
    for (let cursor = startOfMonth(range.start); cursor <= range.end; cursor = addMonths(cursor, 1)) {
      push(minor, cursor, addDays(addMonths(cursor, 1), -1), zoom === 'month' ? formatIso(cursor, 'monthShort') : formatIso(cursor, 'monthShort').charAt(0));
    }
  }
  return { major, minor };
}

export type DragMode = 'move' | 'start' | 'end';

/** Bar range after dragging by `deltaDays` in `mode` (never inverts; min 1 day). */
export function dragRange(
  range: { start: IsoDate; end: IsoDate },
  mode: DragMode,
  deltaDays: number,
): { start: IsoDate; end: IsoDate } {
  if (mode === 'move') return { start: addDays(range.start, deltaDays), end: addDays(range.end, deltaDays) };
  if (mode === 'start') {
    const start = addDays(range.start, deltaDays);
    return { start: start > range.end ? range.end : start, end: range.end };
  }
  const end = addDays(range.end, deltaDays);
  return { start: range.start, end: end < range.start ? range.start : end };
}

/** Smallest zoom that fits `days` into `width` px. */
export function fitZoom(days: number, width: number): TimelineZoom {
  const order: TimelineZoom[] = ['day', 'week', 'month', 'quarter'];
  return order.find((zoom) => days * PX_PER_DAY[zoom] <= width) ?? 'quarter';
}
