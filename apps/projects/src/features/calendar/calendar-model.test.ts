import { describe, expect, it } from 'vitest';
import { eventsOn, hiddenPerColumn, isSegmentVisible, layoutWeek, monthWeeks, shiftMonth, weekOf, type CalendarEvent } from './calendar-model';

const ev = (id: string, start: string, end: string): CalendarEvent<null> => ({ id, start, end, item: null });

describe('calendar model', () => {
  it('builds Monday-first month grids with only the rows needed', () => {
    const weeks = monthWeeks('2026-11-13');
    expect(weeks[0]?.[0]).toBe('2026-10-26');
    expect(weeks.length).toBe(6);
    expect(weeks.at(-1)?.[6]).toBe('2026-12-06');
    expect(monthWeeks('2027-02-10').length).toBe(4);
  });

  it('moves between months and weeks', () => {
    expect(shiftMonth('2026-11-30', 1)).toBe('2026-12-01');
    expect(shiftMonth('2026-01-31', -1)).toBe('2025-12-01');
    expect(weekOf('2026-11-15')).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
  });

  it('stacks overlapping tasks into lanes', () => {
    const days = weekOf('2026-11-09');
    const segments = layoutWeek(days, [ev('a', '2026-11-10', '2026-11-12'), ev('b', '2026-11-11', '2026-11-11'), ev('c', '2026-11-05', '2026-11-09'), ev('d', '2026-11-13', '2026-11-20')]);
    const byId = Object.fromEntries(segments.map((s) => [s.event.id, s]));
    expect(byId.c).toMatchObject({ startCol: 0, span: 1, slot: 0, continuesBefore: true, continuesAfter: false });
    expect(byId.a).toMatchObject({ startCol: 1, span: 3, slot: 0 });
    expect(byId.b).toMatchObject({ startCol: 2, slot: 1 });
    expect(byId.d).toMatchObject({ startCol: 4, span: 3, continuesAfter: true, slot: 0 });
  });

  it('skips events that only fall on hidden days', () => {
    const weekdays = weekOf('2026-11-09').slice(0, 5);
    expect(layoutWeek(weekdays, [ev('w', '2026-11-14', '2026-11-15')])).toEqual([]);
    expect(layoutWeek(weekdays, [ev('x', '2026-11-13', '2026-11-16')])[0]).toMatchObject({ startCol: 4, span: 1, continuesAfter: true });
  });

  it('counts overflow per day', () => {
    const days = weekOf('2026-11-09');
    const events = [ev('1', '2026-11-10', '2026-11-10'), ev('2', '2026-11-10', '2026-11-10'), ev('3', '2026-11-10', '2026-11-10'), ev('4', '2026-11-10', '2026-11-10'), ev('5', '2026-11-11', '2026-11-11')];
    const segments = layoutWeek(days, events);
    const hidden = hiddenPerColumn(segments, 7, 3);
    expect(hidden[1]).toBe(2);
    expect(hidden[2]).toBe(0);
    expect(segments.filter((s) => isSegmentVisible(s, hidden, 3)).map((s) => s.event.id).sort()).toEqual(['1', '2', '5']);
    expect(eventsOn('2026-11-10', events).length).toBe(4);
  });
});
