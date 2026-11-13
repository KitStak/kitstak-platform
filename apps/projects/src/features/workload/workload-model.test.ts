import { describe, expect, it } from 'vitest';
import type { TaskSummary } from '@/lib/types';
import { EARLIER, NO_DATE, UNASSIGNED, buildWorkload, formatLoad, loadLevel, readWorkloadSettings, shiftToWeek, taskLoad, weekShares, weekStarts, withCapacity } from './workload-model';

function task(over: Partial<TaskSummary>): TaskSummary {
  return {
    id: over.id ?? 't',
    projectId: 'p',
    projectKey: 'OPS',
    number: 1,
    key: 'OPS-1',
    title: 'Task',
    statusId: 's',
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
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    subtaskCount: 0,
    subtaskDoneCount: 0,
    commentCount: 0,
    attachmentCount: 0,
    blockedByCount: 0,
    blockingCount: 0,
    linkCount: 0,
    ...over,
  };
}

describe('workload model', () => {
  const weeks = weekStarts('2026-11-13', 3); // Nov 9, 16, 23

  it('lists Monday week starts', () => {
    expect(weeks).toEqual(['2026-11-09', '2026-11-16', '2026-11-23']);
  });

  it('spreads a task over its work days', () => {
    const shares = weekShares('2026-11-12', '2026-11-17'); // Thu, Fri | Mon, Tue
    expect(shares.get('2026-11-09')).toBe(0.5);
    expect(shares.get('2026-11-16')).toBe(0.5);
    expect(weekShares('2026-11-14', '2026-11-15')).toEqual(new Map([['2026-11-09', 1]]));
  });

  it('measures effort in tasks, points or hours', () => {
    const t = task({ estimatePoints: 5, estimateMinutes: 90 });
    expect(taskLoad(t, 'tasks')).toBe(1);
    expect(taskLoad(t, 'points')).toBe(5);
    expect(taskLoad(t, 'hours')).toBe(1.5);
  });

  it('buckets work per person and week', () => {
    const rows = buildWorkload(
      [
        task({ id: 'a', assigneeId: 'maya', dueDate: '2026-11-18', estimatePoints: 3 }),
        task({ id: 'b', assigneeId: 'maya', startDate: '2026-11-12', dueDate: '2026-11-17', estimatePoints: 4 }),
        task({ id: 'c', assigneeId: 'maya', dueDate: '2026-11-02' }),
        task({ id: 'd', dueDate: null }),
        task({ id: 'e', assigneeId: 'maya', startDate: '2026-11-30', dueDate: '2026-12-02' }),
      ],
      weeks,
      'points',
    );
    const maya = rows.get('maya');
    expect(maya?.cells.get('2026-11-09')?.load).toBe(2);
    expect(maya?.cells.get('2026-11-16')?.load).toBe(5);
    expect(maya?.cells.get(EARLIER)?.tasks.map((x) => x.task.id)).toEqual(['c']);
    expect(maya?.unestimated).toBe(1);
    expect(rows.get(UNASSIGNED)?.cells.get(NO_DATE)?.tasks.length).toBe(1);
    const counted = buildWorkload([task({ id: 'b', assigneeId: 'maya', startDate: '2026-11-12', dueDate: '2026-11-17' })], weeks, 'tasks');
    // Counting tasks, a task spanning two weeks counts once, in its due week.
    expect(counted.get('maya')?.cells.get('2026-11-09')).toBeUndefined();
    expect(counted.get('maya')?.cells.get('2026-11-16')?.load).toBe(1);
  });

  it('rates how full a week is', () => {
    expect(loadLevel(0, 8)).toBe('empty');
    expect(loadLevel(3, 8)).toBe('light');
    expect(loadLevel(6, 8)).toBe('good');
    expect(loadLevel(8, 8)).toBe('full');
    expect(loadLevel(9, 8)).toBe('over');
    expect(formatLoad(2.25)).toBe('2.3');
    expect(formatLoad(4)).toBe('4');
  });

  it('moves a task to another week and keeps its length', () => {
    expect(shiftToWeek({ startDate: '2026-11-10', dueDate: '2026-11-12' }, '2026-11-09', '2026-11-23')).toEqual({ startDate: '2026-11-24', dueDate: '2026-11-26' });
    expect(shiftToWeek({ startDate: null, dueDate: null }, NO_DATE, '2026-11-16')).toEqual({ dueDate: '2026-11-20' });
    expect(shiftToWeek({ startDate: null, dueDate: '2026-11-02' }, EARLIER, '2026-11-16')).toEqual({ dueDate: '2026-11-20' });
    expect(shiftToWeek({ startDate: '2026-11-02', dueDate: null }, EARLIER, '2026-11-16')).toEqual({ startDate: '2026-11-20' });
  });

  it('reads and writes capacity per unit safely', () => {
    const settings = { theme: 'x', workload: { capacity: { hours: { perWeek: 32, perPerson: { maya: 20, bad: 'x' } } } } };
    expect(readWorkloadSettings(settings, 'hours')).toEqual({ unit: 'hours', perWeek: 32, perPerson: { maya: 20 } });
    expect(readWorkloadSettings(settings, 'tasks')).toEqual({ unit: 'tasks', perWeek: 8, perPerson: {} });
    expect(readWorkloadSettings({ workload: 'nope' }, 'points').perWeek).toBe(13);
    const next = withCapacity(settings, 'hours', { person: { id: 'maya', value: null } });
    expect(next.theme).toBe('x');
    expect(readWorkloadSettings(next, 'hours')).toEqual({ unit: 'hours', perWeek: 32, perPerson: {} });
    expect(readWorkloadSettings(withCapacity(next, 'tasks', { perWeek: 5, person: { id: 'jo', value: 3 } }), 'tasks')).toEqual({ unit: 'tasks', perWeek: 5, perPerson: { jo: 3 } });
  });
});
