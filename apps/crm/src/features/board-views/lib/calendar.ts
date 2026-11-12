/** Calendar layout: events from a date/timeline column, week-row slotting for spanning bars. */
import type { ColumnDto, ItemDto } from '@/server/services/contracts/dto';
import { addDays, diffDays, type IsoDate } from './dates';
import { cellOf, dateRangeOf } from './values';

export interface CalendarEvent {
  readonly id: string;
  readonly item: ItemDto;
  readonly start: IsoDate;
  readonly end: IsoDate;
  readonly time?: string;
}

export function collectEvents(
  items: readonly ItemDto[],
  column: ColumnDto | undefined,
): { events: CalendarEvent[]; unscheduled: ItemDto[] } {
  const events: CalendarEvent[] = [];
  const unscheduled: ItemDto[] = [];
  if (!column) return { events, unscheduled: [...items] };
  for (const item of items) {
    const range = dateRangeOf(cellOf(item, column.key));
    if (!range) unscheduled.push(item);
    else events.push({ id: item.id, item, start: range.start, end: range.end, ...(range.time && { time: range.time }) });
  }
  events.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : (b.end > a.end ? 1 : -1)));
  return { events, unscheduled };
}

export interface WeekSegment {
  readonly event: CalendarEvent;
  /** Column index of the first visible day (0-based). */
  readonly startCol: number;
  readonly span: number;
  readonly slot: number;
  readonly continuesBefore: boolean;
  readonly continuesAfter: boolean;
}

/**
 * Lay out the events that touch `days` (one visible week row) into horizontal slots. Longer
 * events claim slots first so spanning bars stay stable; single-day events fill the gaps.
 */
export function layoutWeek(days: readonly IsoDate[], events: readonly CalendarEvent[]): WeekSegment[] {
  if (days.length === 0) return [];
  const first = days[0] as IsoDate;
  const last = days[days.length - 1] as IsoDate;
  const touching = events
    .filter((event) => event.start <= last && event.end >= first)
    .map((event) => {
      const startIndex = days.findIndex((day) => day >= event.start);
      const lastIndex = days.reduce((found, day, index) => (day <= event.end ? index : found), -1);
      return { event, startCol: Math.max(0, startIndex), endCol: lastIndex };
    })
    .filter((entry) => entry.endCol >= entry.startCol)
    .sort((a, b) => b.endCol - b.startCol - (a.endCol - a.startCol) || a.startCol - b.startCol);
  const occupied: boolean[][] = [];
  const segments: WeekSegment[] = [];
  for (const entry of touching) {
    let slot = 0;
    while (true) {
      const row = (occupied[slot] ??= Array.from({ length: days.length }, () => false));
      let free = true;
      for (let col = entry.startCol; col <= entry.endCol; col += 1) if (row[col]) free = false;
      if (free) {
        for (let col = entry.startCol; col <= entry.endCol; col += 1) row[col] = true;
        break;
      }
      slot += 1;
    }
    segments.push({
      event: entry.event,
      startCol: entry.startCol,
      span: entry.endCol - entry.startCol + 1,
      slot,
      continuesBefore: entry.event.start < first,
      continuesAfter: entry.event.end > last,
    });
  }
  return segments;
}

/** Events covering a day (for the "+N more" popover and day view). */
export function eventsOnDay(events: readonly CalendarEvent[], day: IsoDate): CalendarEvent[] {
  return events.filter((event) => event.start <= day && event.end >= day);
}

/** Count of segments per day column that don't fit in `maxSlots` visible slots. */
export function overflowByDay(segments: readonly WeekSegment[], dayCount: number, maxSlots: number): number[] {
  const hidden = Array.from({ length: dayCount }, () => 0);
  for (const segment of segments) {
    if (segment.slot < maxSlots) continue;
    for (let col = segment.startCol; col < segment.startCol + segment.span; col += 1) hidden[col] = (hidden[col] ?? 0) + 1;
  }
  return hidden;
}

/** New [start, end] after dropping an event that started on `from` onto `to` (keeps duration). */
export function shiftRange(event: Pick<CalendarEvent, 'start' | 'end'>, to: IsoDate): { start: IsoDate; end: IsoDate } {
  const length = diffDays(event.start, event.end);
  return { start: to, end: addDays(to, length) };
}

/** Minutes since midnight for "HH:MM". */
export function minutesOf(time: string | undefined): number | null {
  if (!time) return null;
  const match = /^(\d{2}):(\d{2})/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function timeOf(minutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 45, Math.round(minutes / 15) * 15));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

export function formatTime(time: string): string {
  const minutes = minutesOf(time);
  if (minutes === null) return time;
  const hours = Math.floor(minutes / 60);
  const suffix = hours >= 12 ? 'pm' : 'am';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  const mins = minutes % 60;
  return mins ? `${hour12}:${String(mins).padStart(2, '0')}${suffix}` : `${hour12}${suffix}`;
}
