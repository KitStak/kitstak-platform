import { describe, expect, test } from 'vitest';
import { EXAMPLES, demoTask } from './quick-add-demo';

// A Wednesday, so "next fri" and "tomorrow" are unambiguous.
const TODAY = '2026-11-18';

describe('quick add demo (runs the Projects parser)', () => {
  test('reads date, priority, person and label out of the first example', () => {
    const task = demoTask(EXAMPLES[0]!, TODAY);

    expect(task.title).toBe('Print pallet labels');
    expect(task.parse.priority).toBe('high');
    expect(task.parse.assigneeId).toBe('u-dana');
    expect(task.parse.labelIds).toEqual(['l-warehouse']);
    expect(task.parse.dueDate).toMatch(/^2026-11-2\d$/);
  });

  test('turns a short WMS code into the exact code and a link', () => {
    const task = demoTask(EXAMPLES[1]!, TODAY);

    expect(task.title).toContain('PO002240');
    expect(task.links).toEqual([{ code: 'PO002240', label: 'WMS receipt' }]);
    expect(task.parse.priority).toBe('urgent');
    expect(task.parse.dueDate).toBe('2026-11-19');
  });

  test('files the task in the project named with +KEY', () => {
    const task = demoTask(EXAMPLES[2]!, TODAY);

    expect(task.key).toBe('ONB-46');
    expect(task.parse.dueDate).toBe('2026-11-21');
  });

  test('keeps an unknown person in the title and flags it', () => {
    const task = demoTask('Call the carrier @nobody', TODAY);

    expect(task.title).toContain('@nobody');
    expect(task.parse.tokens.find((t) => t.kind === 'assignee')?.unresolved).toBe(true);
  });
});
