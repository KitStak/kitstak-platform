import { describe, expect, it } from 'vitest';
import { calendarProblems, copyLastYear, moveHoliday } from './calendar-model';

describe('work calendar', () => {
  it('keeps fixed holidays on their date', () => {
    expect(moveHoliday({ date: '2025-12-25', name: 'Christmas' }, 2026)).toEqual({ date: '2026-12-25', name: 'Christmas' });
  });
  it('moves floating holidays by weekday', () => {
    expect(moveHoliday({ date: '2025-11-27', name: 'Thanksgiving' }, 2026).date).toBe('2026-11-26');
    expect(moveHoliday({ date: '2025-05-26', name: 'Memorial Day' }, 2026).date).toBe('2026-05-25');
    expect(moveHoliday({ date: '2025-09-01', name: 'Labor Day' }, 2026).date).toBe('2026-09-07');
    expect(moveHoliday({ date: '2025-11-28', name: 'Day after Thanksgiving' }, 2026).date).toBe('2026-11-27');
  });
  it('copies only last year and skips dates already there', () => {
    const list = copyLastYear([{ date: '2025-12-25', name: 'Christmas' }, { date: '2026-12-25', name: 'Christmas' }, { date: '2025-01-01', name: 'New Year' }], 2026);
    expect(list.map((h) => h.date)).toEqual(['2025-01-01', '2025-12-25', '2026-01-01', '2026-12-25']);
  });
  it('checks the draft', () => {
    expect(calendarProblems({ timezone: 'UTC', workingDays: [], holidays: [{ date: '2026-01-01', name: '' }], capacity: 'x' })).toEqual({ workingDays: 'Pick at least one work day.', 'holiday:0': 'Name the holiday.', capacity: 'Use hours like 80 or 7.5.' });
  });
});
