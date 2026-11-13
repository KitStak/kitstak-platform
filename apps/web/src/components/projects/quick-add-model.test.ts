import { describe, expect, test } from 'vitest';
import { parseQuickAdd } from './quick-add-model';

describe('parseQuickAdd', () => {
  test('pulls the date, priority, person and label out of one line', () => {
    const task = parseQuickAdd('Print pallet labels fri !high @dana #warehouse');

    expect(task).toEqual({
      title: 'Print pallet labels',
      due: 'Friday',
      priority: 'high',
      assignee: 'Dana',
      labels: ['warehouse'],
    });
  });

  test('leaves a plain sentence as the title', () => {
    const task = parseQuickAdd('Call the carrier about the late truck');

    expect(task).toEqual({
      title: 'Call the carrier about the late truck',
      due: null,
      priority: null,
      assignee: null,
      labels: [],
    });
  });

  test('keeps an unknown priority word in the title', () => {
    expect(parseQuickAdd('Fix it !asap').title).toBe('Fix it !asap');
  });

  test('uses only the first date word and keeps later ones in the title', () => {
    const task = parseQuickAdd('Move Monday standup to tomorrow');

    expect(task.due).toBe('Monday');
    expect(task.title).toBe('Move standup to tomorrow');
  });

  test('collects several labels without repeats', () => {
    expect(parseQuickAdd('Audit #returns #q4 #returns').labels).toEqual(['returns', 'q4']);
  });

  test('ignores a bare symbol and strips markup characters from field values', () => {
    const task = parseQuickAdd('Ship @ # ! @<b>sam</b>');

    expect(task.assignee).toBe('Bsamb');
    expect(task.title).toBe('Ship @ # !');
  });

  test('returns an empty task for empty input', () => {
    expect(parseQuickAdd('   ')).toEqual({ title: '', due: null, priority: null, assignee: null, labels: [] });
  });
});
