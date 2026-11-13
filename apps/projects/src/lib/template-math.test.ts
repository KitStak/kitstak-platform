import { describe, expect, it } from 'vitest';
import { countTemplateTaskTree, describeTemplateTaskCounts, withScheduledStarts } from './template-math';
import type { TemplatePayload } from './template-types';

const payload: TemplatePayload = {
  statuses: [],
  tasks: [
    { title: 'A', dueOffsetDays: 3 },
    { title: 'B', dueOffsetDays: 8, subtasks: [{ title: 'B1' }, { title: 'B2', subtasks: [{ title: 'B2a' }] }] },
    { title: 'C', startOffsetDays: 2, dueOffsetDays: 10 },
    { title: 'M', isMilestone: true, dueOffsetDays: 10 },
    { title: 'D', dueOffsetDays: 10 },
    { title: 'E' },
  ],
};

describe('template counts', () => {
  it('counts top-level tasks and subtasks separately', () => {
    expect(countTemplateTaskTree(payload)).toEqual({ tasks: 6, subtasks: 3 });
    expect(countTemplateTaskTree({ tasks: [] })).toEqual({ tasks: 0, subtasks: 0 });
  });
  it('describes counts in plain words', () => {
    expect(describeTemplateTaskCounts({ tasks: 11, subtasks: 3 })).toBe('11 tasks + 3 subtasks');
    expect(describeTemplateTaskCounts({ tasks: 1, subtasks: 1 })).toBe('1 task + 1 subtask');
    expect(describeTemplateTaskCounts({ tasks: 4, subtasks: 0 }, 'starter tasks')).toBe('4 starter tasks');
    expect(describeTemplateTaskCounts({ tasks: 0, subtasks: 0 })).toBe('No tasks');
  });
});

describe('withScheduledStarts', () => {
  const tasks = withScheduledStarts(payload).tasks ?? [];
  it('starts the first task on day 0 and chains later ones', () => {
    expect(tasks[0]?.startOffsetDays).toBe(0);
    expect(tasks[1]?.startOffsetDays).toBe(4);
    expect(tasks[4]?.startOffsetDays).toBe(9);
  });
  it('keeps explicit starts, single-day milestones and undated tasks', () => {
    expect(tasks[2]?.startOffsetDays).toBe(2);
    expect(tasks[3]?.startOffsetDays).toBe(10);
    expect(tasks[5]?.startOffsetDays).toBeUndefined();
  });
  it('gives undated subtasks the parent range', () => {
    expect(tasks[1]?.subtasks?.[0]).toMatchObject({ startOffsetDays: 4, dueOffsetDays: 8 });
  });
});
