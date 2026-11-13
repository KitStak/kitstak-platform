/**
 * Calendar math, pure for tests: month / week grids (weeks start on Monday) and the layout of
 * multi-day tasks into stacked lanes ("slots") for each week row.
 */
import { addDaysIso, parseIsoDate, startOfWeekIso, toIsoDate, type IsoDate } from '@/lib/dates';

export interface CalendarEvent<T = unknown> {
  readonly id: string;
  readonly start: IsoDate;
  readonly end: IsoDate;
  readonly item: T;
}

export interface WeekSegment<T = unknown> {
  readonly event: CalendarEvent<T>;
  /** Column index into the visible days of this row. */
  readonly startCol: number;
  readonly span: number;
  readonly slot: number;
  readonly continuesBefore: boolean;
  readonly continuesAfter: boolean;
}

export function firstOfMonth(value: IsoDate): IsoDate {
  return `${value.slice(0, 7)}-01`;
}

export function shiftMonth(value: IsoDate, months: number): IsoDate {
  const date = parseIsoDate(firstOfMonth(value));
  date.setMonth(date.getMonth() + months);
  return toIsoDate(date);
}

export function isWeekendIso(value: IsoDate): boolean {
  const day = parseIsoDate(value).getDay();
  return day === 0 || day === 6;
}

/** Week rows covering the month of `anchor` (4 to 6 rows of 7 days, Monday first). */
export function monthWeeks(anchor: IsoDate): IsoDate[][] {
  const first = firstOfMonth(anchor);
  const month = first.slice(0, 7);
  const weeks: IsoDate[][] = [];
  for (let cursor = startOfWeekIso(first); weeks.length < 6; cursor = addDaysIso(cursor, 7)) {
    const days = Array.from({ length: 7 }, (_, i) => addDaysIso(cursor, i));
    if (weeks.length > 0 && days[0]?.slice(0, 7) !== month) break;
    weeks.push(days);
  }
  return weeks;
}

export function weekOf(anchor: IsoDate): IsoDate[] {
  const start = startOfWeekIso(anchor);
  return Array.from({ length: 7 }, (_, i) => addDaysIso(start, i));
}

/**
 * Lays events over one row of visible days. Longer events and earlier starts get the top lanes;
 * each event takes the first lane free across all of its days. Events outside the row are skipped.
 */
export function layoutWeek<T>(days: readonly IsoDate[], events: readonly CalendarEvent<T>[]): WeekSegment<T>[] {
  if (days.length === 0) return [];
  const first = days[0] as IsoDate;
  const last = days[days.length - 1] as IsoDate;
  const placed: { event: CalendarEvent<T>; startCol: number; endCol: number }[] = [];
  for (const event of events) {
    if (event.end < first || event.start > last) continue;
    let startCol = -1;
    let endCol = -1;
    days.forEach((day, index) => {
      if (day >= event.start && day <= event.end) {
        if (startCol < 0) startCol = index;
        endCol = index;
      }
    });
    if (startCol < 0) continue; // Only on hidden days (e.g. weekends turned off).
    placed.push({ event, startCol, endCol });
  }
  placed.sort((a, b) => a.startCol - b.startCol || b.endCol - b.startCol - (a.endCol - a.startCol) || a.event.start.localeCompare(b.event.start) || a.event.id.localeCompare(b.event.id));
  const lanes: boolean[][] = [];
  return placed.map(({ event, startCol, endCol }) => {
    let slot = 0;
    for (; ; slot += 1) {
      const lane = lanes[slot] ?? (lanes[slot] = []);
      let free = true;
      for (let col = startCol; col <= endCol; col += 1) if (lane[col]) free = false;
      if (free) {
        for (let col = startCol; col <= endCol; col += 1) lane[col] = true;
        break;
      }
    }
    return {
      event,
      startCol,
      span: endCol - startCol + 1,
      slot,
      continuesBefore: event.start < (days[startCol] as IsoDate),
      continuesAfter: event.end > (days[endCol] as IsoDate),
    };
  });
}

/**
 * "+N more" count per column when only `maxSlots` lanes fit (0 = everything fits). In a column that
 * overflows, the last lane is used by the "+N more" button, so N counts every event in that column
 * that isn't in the lanes above it.
 */
export function hiddenPerColumn<T>(segments: readonly WeekSegment<T>[], columns: number, maxSlots: number): number[] {
  const total = Array.from({ length: columns }, () => 0);
  const shown = Array.from({ length: columns }, () => 0);
  const deepest = Array.from({ length: columns }, () => -1);
  for (const segment of segments) {
    for (let col = segment.startCol; col < segment.startCol + segment.span; col += 1) {
      total[col] = (total[col] ?? 0) + 1;
      if (segment.slot < maxSlots - 1) shown[col] = (shown[col] ?? 0) + 1;
      deepest[col] = Math.max(deepest[col] ?? -1, segment.slot);
    }
  }
  return total.map((count, col) => ((deepest[col] ?? -1) >= maxSlots ? count - (shown[col] ?? 0) : 0));
}

/** Whether a segment is drawn, given the overflow counts from `hiddenPerColumn`. */
export function isSegmentVisible<T>(segment: WeekSegment<T>, hidden: readonly number[], maxSlots: number): boolean {
  if (segment.slot < maxSlots - 1) return true;
  if (segment.slot > maxSlots - 1) return false;
  for (let col = segment.startCol; col < segment.startCol + segment.span; col += 1) if ((hidden[col] ?? 0) > 0) return false;
  return true;
}

/** Events touching a day, in the order they're laid out. */
export function eventsOn<T>(day: IsoDate, events: readonly CalendarEvent<T>[]): CalendarEvent<T>[] {
  return events.filter((event) => event.start <= day && event.end >= day);
}
