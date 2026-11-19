import { describe, expect, it } from 'vitest';
import { earliestEntryDate, entryDateProblem, isTypedSource } from './entry-dates';

describe('the date rule for typed entries', () => {
  it('allows today back to the same day 10 years ago', () => {
    expect(earliestEntryDate('2026-11-19')).toBe('2016-11-19');
    expect(earliestEntryDate('2028-02-29')).toBe('2018-02-28');
    expect(entryDateProblem('work', '2026-11-19', '2026-11-19')).toBeNull();
    expect(entryDateProblem('work', '2016-11-19', '2026-11-19')).toBeNull();
  });

  it('names what is wrong in plain words', () => {
    expect(entryDateProblem('work', '2026-11-20', '2026-11-19')).toEqual({ message: 'Work cannot be dated after today. Pick today or an earlier day.', field: 'This day is after today.', reason: 'future' });
    expect(entryDateProblem('vas', '2030-01-01', '2026-11-19')?.message).toBe('An extra service cannot be dated after today. Pick today or an earlier day.');
    expect(entryDateProblem('indirect', '1990-01-01', '2026-11-19')).toEqual({
      message: 'Time not on a job cannot be dated more than 10 years ago, before Nov 19, 2016. Check the year.',
      field: 'This day is more than 10 years ago.',
      reason: 'too_old',
    });
    expect(entryDateProblem('cost', '2016-11-18', '2026-11-19')?.reason).toBe('too_old');
  });

  it('leaves the dates of synced rows alone', () => {
    for (const source of ['manual', 'csv', 'sample', null, undefined]) expect(isTypedSource(source)).toBe(true);
    for (const source of ['wms', 'crm', 'projects', 'punch', 'system']) expect(isTypedSource(source)).toBe(false);
  });
});
