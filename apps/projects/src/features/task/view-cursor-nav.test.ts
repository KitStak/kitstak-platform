import { describe, expect, it } from 'vitest';
import { fieldForKey, neighbourCell, stepIndex } from './view-cursor-nav';

describe('stepIndex', () => {
  it('lands on the first row when there is no cursor yet', () => {
    expect(stepIndex(-1, 1, 5)).toBe(0);
    expect(stepIndex(-1, -1, 5)).toBe(0);
  });
  it('moves and clamps at both ends', () => {
    expect(stepIndex(0, 1, 3)).toBe(1);
    expect(stepIndex(2, 1, 3)).toBe(2);
    expect(stepIndex(0, -1, 3)).toBe(0);
  });
  it('returns -1 for an empty view', () => {
    expect(stepIndex(-1, 1, 0)).toBe(-1);
  });
});

describe('neighbourCell', () => {
  const cell = (left: number, top: number, count: number) => ({ left, right: left + 100, top, bottom: top + 300, count });
  it('picks the nearest non-empty cell in the same lane', () => {
    const cells = [cell(0, 0, 2), cell(110, 0, 0), cell(220, 0, 1), cell(110, 400, 3)];
    expect(neighbourCell(cells, 0, 1)).toBe(2);
    expect(neighbourCell(cells, 2, -1)).toBe(0);
    expect(neighbourCell(cells, 0, -1)).toBe(-1);
  });
});

describe('fieldForKey', () => {
  it('maps Linear style keys', () => {
    expect(fieldForKey('s')).toBe('status');
    expect(fieldForKey('a')).toBe('assignee');
    // One key map: l never means labels (it is "column right" on a board), # always does.
    expect(fieldForKey('l')).toBeNull();
    expect(fieldForKey('l')).toBeNull();
    expect(fieldForKey('#')).toBe('labels');
    expect(fieldForKey('#')).toBe('labels');
    expect(fieldForKey('L')).toBe('labels');
    expect(fieldForKey('q')).toBeNull();
  });
});
