import { describe, expect, it } from 'vitest';
import type { TaskSummary } from '@/lib/types';
import { compareTasks, dueDateForDrop, focusQueue, groupByProject, groupByWhen, matchesText, whenGroup } from './my-work-model';

const TODAY = '2026-11-11';

function task(id: string, patch: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id,
    projectId: 'p1',
    projectKey: 'OPS',
    number: Number(id.replace(/\D/g, '')) || 1,
    key: `OPS-${id}`,
    title: id,
    statusId: 's',
    statusCategory: 'todo',
    priority: 'none',
    assigneeId: 'me',
    dueDate: null,
    completedAt: null,
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...patch,
  } as TaskSummary;
}

describe('whenGroup', () => {
  it.each([
    [null, 'none'],
    ['2026-11-10', 'overdue'],
    [TODAY, 'today'],
    ['2026-11-12', 'upcoming'],
    ['2026-11-18', 'upcoming'],
    ['2026-11-19', 'later'],
  ] as const)('due %s → %s', (due, group) => {
    expect(whenGroup(task('a', { dueDate: due }), TODAY)).toBe(group);
  });

  it('done and cancelled tasks are "done"', () => {
    expect(whenGroup(task('a', { statusCategory: 'done', dueDate: '2026-11-01' }), TODAY)).toBe('done');
    expect(whenGroup(task('a', { statusCategory: 'cancelled' }), TODAY)).toBe('done');
  });
});

describe('groupByWhen', () => {
  const tasks = [
    task('t1', { dueDate: TODAY, priority: 'low' }),
    task('t2', { dueDate: TODAY, priority: 'urgent' }),
    task('t3', { dueDate: '2026-11-01' }),
    task('t4'),
    task('t5', { statusCategory: 'done', dueDate: TODAY, completedAt: '2026-11-11T10:00:00.000Z' }),
  ];

  it('orders groups and sorts within them (due, then priority)', () => {
    const groups = groupByWhen(tasks, { today: TODAY });
    expect(groups.map((g) => g.key)).toEqual(['overdue', 'today', 'none']);
    expect(groups[1]!.tasks.map((t) => t.id)).toEqual(['t2', 't1']);
  });

  it('shows done tasks only when asked', () => {
    expect(groupByWhen(tasks, { today: TODAY, showDone: true }).map((g) => g.key)).toContain('done');
  });

  it('keeps just-finished tasks in their old group', () => {
    const groups = groupByWhen(tasks, { today: TODAY, keepIds: new Set(['t5']) });
    expect(groups.find((g) => g.key === 'today')!.tasks.map((t) => t.id)).toContain('t5');
  });
});

describe('compareTasks', () => {
  const a = task('a1', { title: 'Banana', priority: 'low', dueDate: '2026-11-01', updatedAt: '2026-11-05T00:00:00Z', projectId: 'p2' });
  const b = task('b2', { title: 'apple', priority: 'high', dueDate: '2026-11-03', updatedAt: '2026-11-09T00:00:00Z', projectId: 'p1' });
  const names = (id: string) => ({ p1: 'Alpha', p2: 'Zeta' })[id] ?? '';
  it('sorts by each option', () => {
    expect([a, b].sort(compareTasks('due')).map((t) => t.id)).toEqual(['a1', 'b2']);
    expect([a, b].sort(compareTasks('priority')).map((t) => t.id)).toEqual(['b2', 'a1']);
    expect([a, b].sort(compareTasks('updated')).map((t) => t.id)).toEqual(['b2', 'a1']);
    expect([a, b].sort(compareTasks('title')).map((t) => t.id)).toEqual(['b2', 'a1']);
    expect([a, b].sort(compareTasks('project', names)).map((t) => t.id)).toEqual(['b2', 'a1']);
  });
});

describe('groupByProject', () => {
  it('groups alphabetically by project name', () => {
    const names = (id: string) => ({ p1: 'Warehouse', p2: 'Apex' })[id] ?? '';
    const groups = groupByProject([task('a', { projectId: 'p1' }), task('b', { projectId: 'p2' })], names);
    expect(groups.map((g) => g.label)).toEqual(['Apex', 'Warehouse']);
  });
});

describe('dueDateForDrop', () => {
  it('maps drop targets to dates', () => {
    expect(dueDateForDrop('today', task('a'), TODAY)).toBe(TODAY);
    expect(dueDateForDrop('upcoming', task('a'), TODAY)).toBe('2026-11-12');
    expect(dueDateForDrop('upcoming', task('a', { dueDate: '2026-11-15' }), TODAY)).toBe('2026-11-15');
    expect(dueDateForDrop('later', task('a'), TODAY)).toBe('2026-11-25');
    expect(dueDateForDrop('none', task('a', { dueDate: TODAY }), TODAY)).toBeNull();
    expect(dueDateForDrop('overdue', task('a'), TODAY)).toBeUndefined();
    expect(dueDateForDrop('done', task('a'), TODAY)).toBeUndefined();
  });
});

describe('focusQueue', () => {
  it('takes open overdue + today tasks, most urgent first', () => {
    const queue = focusQueue(
      [
        task('a', { dueDate: TODAY, priority: 'low' }),
        task('b', { dueDate: '2026-11-02', priority: 'high' }),
        task('c', { dueDate: '2026-11-12', priority: 'urgent' }),
        task('d', { dueDate: TODAY, statusCategory: 'done' }),
        task('e'),
      ],
      TODAY,
    );
    expect(queue.map((t) => t.id)).toEqual(['b', 'a']);
  });
});

describe('matchesText', () => {
  it('matches title, key and project', () => {
    const t = task('a7', { title: 'Order boxes' });
    expect(matchesText(t, 'BOX')).toBe(true);
    expect(matchesText(t, 'ops-a7')).toBe(true);
    expect(matchesText(t, 'warehouse', () => 'Warehouse go-live')).toBe(true);
    expect(matchesText(t, 'zebra')).toBe(false);
    expect(matchesText(t, '  ')).toBe(true);
  });
});
