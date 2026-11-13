import { describe, expect, it } from 'vitest';
import { applyFilters, groupTasks, NO_GROUP, sortTasks } from './task-filters';
import type { TaskSummary } from './types';

const ME = 'me-user';

function task(overrides: Partial<TaskSummary>): TaskSummary {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    projectId: 'p1',
    projectKey: 'OPS',
    number: 1,
    key: 'OPS-1',
    title: 'Task',
    statusId: 's-todo',
    statusCategory: 'todo',
    sectionId: null,
    priority: 'none',
    assigneeId: null,
    reporterId: null,
    startDate: null,
    dueDate: null,
    estimatePoints: null,
    estimateMinutes: null,
    parentTaskId: null,
    position: 'a0',
    isMilestone: false,
    milestoneId: null,
    labelIds: [],
    customFields: {},
    completedAt: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    subtaskCount: 0,
    subtaskDoneCount: 0,
    commentCount: 0,
    attachmentCount: 0,
    blockedByCount: 0,
    blockingCount: 0,
    linkCount: 0,
    ...overrides,
  };
}

const today = '2026-11-13';

describe('task filters', () => {
  const tasks = [
    task({ id: 'a', assigneeId: ME, dueDate: '2026-11-10', priority: 'high', labelIds: ['l1'] }),
    task({ id: 'b', assigneeId: 'other', dueDate: '2026-11-14', priority: 'urgent' }),
    task({ id: 'c', assigneeId: ME, dueDate: '2026-11-01', statusCategory: 'done', position: 'a1' }),
    task({ id: 'd', title: 'Call Acme about pallets', customFields: { f1: 5 } }),
  ];

  it('resolves "me" and combines with all/any', () => {
    const mine = applyFilters(tasks, { match: 'all', conditions: [{ field: 'assignee', op: 'is', value: 'me' }] }, { me: ME, today });
    expect(mine.map((t) => t.id)).toEqual(['a', 'c']);
    const any = applyFilters(
      tasks,
      { match: 'any', conditions: [{ field: 'priority', op: 'is', value: 'urgent' }, { field: 'label', op: 'in', value: ['l1'] }] },
      { me: ME, today },
    );
    expect(any.map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('treats overdue as open-and-past-due', () => {
    const overdue = applyFilters(tasks, { match: 'all', conditions: [{ field: 'dueDate', op: 'overdue' }] }, { me: ME, today });
    expect(overdue.map((t) => t.id)).toEqual(['a']);
  });

  it('handles text, empty and custom fields', () => {
    const ctx = { me: ME, today };
    expect(applyFilters(tasks, { match: 'all', conditions: [{ field: 'title', op: 'contains', value: 'acme' }] }, ctx)).toHaveLength(1);
    expect(applyFilters(tasks, { match: 'all', conditions: [{ field: 'assignee', op: 'empty' }] }, ctx)).toHaveLength(1);
    expect(applyFilters(tasks, { match: 'all', conditions: [{ field: 'custom', fieldId: 'f1', op: 'gt', value: 3 }] }, ctx)).toHaveLength(1);
  });

  it('sorts with nulls last and priority order', () => {
    expect(sortTasks(tasks, [{ field: 'priority', dir: 'asc' }]).map((t) => t.id).slice(0, 2)).toEqual(['b', 'a']);
    expect(sortTasks(tasks, [{ field: 'dueDate', dir: 'asc' }]).map((t) => t.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('groups with a fixed order and a trailing none bucket', () => {
    const groups = groupTasks(tasks, 'assignee', { order: [ME] });
    expect(groups.map((g) => g.key)).toEqual([ME, 'other', NO_GROUP]);
    expect(groups[0].tasks.map((t) => t.id)).toEqual(['a', 'c']);
  });
});
