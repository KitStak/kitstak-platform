import { describe, expect, it } from 'vitest';
import { templateDayText } from './template-math';

describe('templateDayText', () => {
  it('counts the start date as Day 1', () => {
    expect(templateDayText(undefined)).toBeNull();
    expect(templateDayText(0)).toBe('Day 1');
    expect(templateDayText(14)).toBe('Day 15');
    expect(templateDayText(30)).toBe('Day 31');
  });
});
