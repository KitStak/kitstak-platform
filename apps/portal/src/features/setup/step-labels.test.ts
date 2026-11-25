import { describe, expect, test } from 'vitest';
import { moreStepsLabel } from './step-labels';

describe('setup guide fold row (review round 4)', () => {
  test('the steps for later have their own row and their own count', () => {
    expect(moreStepsLabel(3)).toBe('Show 3 more steps for later');
    expect(moreStepsLabel(7)).toBe('Show 7 more steps for later');
    expect(moreStepsLabel(1)).toBe('Show 1 more step for later');
  });

  test('the row never adds the quick start steps to its count', () => {
    // Before: 4 folded quick start rows plus 3 or 7 later steps read "Show all steps (7 more)" or "(11 more)".
    for (const later of [3, 7]) {
      expect(moreStepsLabel(later)).not.toContain(String(4 + later));
    }
  });
});
