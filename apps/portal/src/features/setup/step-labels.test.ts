import { describe, expect, test } from 'vitest';
import { moreStepsLabel, otherStepsLabel } from './step-labels';

describe('setup guide fold rows (review round 4)', () => {
  test('the phone row counts in the header\'s terms: 5 steps, one open, 4 hidden', () => {
    expect(otherStepsLabel(5 - 1)).toBe('Show the other 4 steps');
    expect(otherStepsLabel(2)).toBe('Show the other 2 steps');
    expect(otherStepsLabel(1)).toBe('Show the other step');
  });

  test('the steps for later have their own row and their own count', () => {
    expect(moreStepsLabel(3)).toBe('Show 3 more steps for later');
    expect(moreStepsLabel(7)).toBe('Show 7 more steps for later');
    expect(moreStepsLabel(1)).toBe('Show 1 more step for later');
  });

  test('no row ever adds the two counts together', () => {
    // Before: 4 folded quick start rows plus 3 or 7 later steps read "Show all steps (7 more)" or "(11 more)".
    for (const later of [3, 7]) {
      expect(otherStepsLabel(4)).not.toContain(String(4 + later));
      expect(moreStepsLabel(later)).not.toContain(String(4 + later));
    }
  });
});
