import { describe, expect, it } from 'vitest';
import { buildReport, cycleDays, dayRange, median, niceMax, tightNiceMax, type ReportTaskRow } from './report-math';

const at = (day: string, hour = 10) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).toISOString();

function row(partial: Partial<ReportTaskRow> & { id: string }): ReportTaskRow {
  return {
    projectId: 'p1',
    key: `OPS-${partial.id}`,
    title: `Task ${partial.id}`,
    statusId: 'todo-status',
    category: 'todo',
    assigneeId: null,
    createdAt: at('2026-11-02'),
    completedAt: null,
    startedAt: null,
    dueDate: null,
    points: null,
    ...partial,
  };
}

const statuses = [
  { id: 'todo-status', name: 'To do', category: 'todo' as const, color: 'gray' },
  { id: 'doing', name: 'Doing', category: 'in_progress' as const, color: 'blue' },
  { id: 'done-status', name: 'Done', category: 'done' as const, color: 'green' },
];

describe('report math', () => {
  it('computes median and cycle days', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(cycleDays({ createdAt: at('2026-11-01'), startedAt: at('2026-11-03'), completedAt: at('2026-11-05') })).toBe(2);
    expect(cycleDays({ createdAt: at('2026-11-01'), startedAt: null, completedAt: at('2026-11-05') })).toBe(4);
    expect(cycleDays({ createdAt: at('2026-11-01'), startedAt: null, completedAt: null })).toBeNull();
  });

  it('builds day ranges that always end on the last day', () => {
    expect(dayRange('2026-11-01', '2026-11-03')).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(dayRange('2026-11-01', '2026-11-08', 3)).toEqual(['2026-11-01', '2026-11-04', '2026-11-07', '2026-11-08']);
  });

  it('rounds axis maxima to friendly numbers', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(23)).toBe(25);
    expect(niceMax(130)).toBe(200);
  });

  it('keeps line chart ceilings just above the data', () => {
    expect(tightNiceMax(0)).toBe(1);
    expect(tightNiceMax(3)).toBe(3);
    expect(tightNiceMax(105)).toBe(120);
    expect(tightNiceMax(130)).toBe(150);
    expect(tightNiceMax(16)).toBe(20);
  });

  it('builds totals, distribution, burn and weekly velocity', () => {
    const rows: ReportTaskRow[] = [
      row({ id: '1', category: 'done', statusId: 'done-status', assigneeId: 'u1', createdAt: at('2026-11-02'), startedAt: at('2026-11-03'), completedAt: at('2026-11-05'), points: 3 }),
      row({ id: '2', category: 'done', statusId: 'done-status', assigneeId: 'u1', createdAt: at('2026-11-02'), completedAt: at('2026-11-10'), points: 2 }),
      row({ id: '3', category: 'in_progress', statusId: 'doing', assigneeId: 'u2', dueDate: '2026-11-10', points: 5 }),
      row({ id: '4', dueDate: '2026-11-14', assigneeId: 'u2' }),
      row({ id: '5', createdAt: at('2026-11-11') }),
      row({ id: '6', category: 'cancelled', statusId: 'done-status', completedAt: at('2026-11-06') }),
    ];
    const report = buildReport({ rows, statuses, byCategory: false, today: '2026-11-12', from: '2026-11-02', dueDate: '2026-11-20', weeks: 3 });

    expect(report.totals).toMatchObject({ total: 5, open: 3, inProgress: 1, done: 2, overdue: 1, unassigned: 1, completedThisWeek: 1, completedLastWeek: 1, createdThisWeek: 1 });
    expect(report.statusDistribution.map((slice) => [slice.id, slice.count])).toEqual([
      ['todo-status', 2],
      ['doing', 1],
      ['done-status', 3],
    ]);

    // Burn chart runs to the due date; future days have no actuals.
    expect(report.to).toBe('2026-11-20');
    const first = report.burn[0];
    expect(first).toMatchObject({ date: '2026-11-02', scope: 4, done: 0, remaining: 4, ideal: 4 });
    const today = report.burn.find((point) => point.date === '2026-11-12');
    expect(today).toMatchObject({ scope: 5, done: 2, remaining: 3 });
    const future = report.burn.find((point) => point.date === '2026-11-15');
    expect(future?.scope).toBeNull();
    expect(report.burn.at(-1)).toMatchObject({ date: '2026-11-20', ideal: 0 });

    expect(report.weeks.map((week) => [week.weekStart, week.completed, week.points])).toEqual([
      ['2026-10-26', 0, 0],
      ['2026-11-02', 1, 3],
      ['2026-11-09', 1, 2],
    ]);
    expect(report.weeks[1]?.medianCycleDays).toBe(2);
    expect(report.totals.averageVelocity).toBe(0.5);

    expect(report.people[0]).toMatchObject({ assigneeId: 'u2', open: 2, inProgress: 1, overdue: 1, dueThisWeek: 1, points: 5 });
    expect(report.completedThisWeek.map((task) => task.key)).toEqual(['OPS-2']);
  });

  it('groups by category for portfolio reports and clamps the window', () => {
    const rows = [row({ id: '1', createdAt: at('2025-01-01') }), row({ id: '2', category: 'in_progress', statusId: 'x' })];
    const report = buildReport({ rows, statuses: [], byCategory: true, today: '2026-11-12', from: '2025-01-01', dueDate: null, maxDays: 30 });
    expect(report.from).toBe('2026-10-13');
    expect(report.burn.every((point) => point.ideal === null)).toBe(true);
    expect(report.statusDistribution.find((slice) => slice.id === 'in_progress')?.count).toBe(1);
    expect(report.statusDistribution.find((slice) => slice.id === 'todo')?.count).toBe(1);
  });
});
