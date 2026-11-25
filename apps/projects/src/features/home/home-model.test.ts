import { describe, expect, it } from 'vitest';
import type { TaskSummary } from '@/lib/types';
import type { ProgramListItemDTO } from '@/lib/program-types';
import { customerProgramText, gettingStartedSteps, greetingFor, homeBuckets, homeStats, programsByCustomer, requiredSteps, sameAsDay, summarySentence } from './home-model';

const TODAY = '2026-11-11'; // Wednesday

function task(id: string, patch: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id,
    projectId: 'p',
    projectKey: 'OPS',
    number: 1,
    key: `OPS-${id}`,
    title: id,
    statusId: 's',
    statusCategory: 'todo',
    sectionId: null,
    priority: 'none',
    assigneeId: 'me',
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
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    subtaskCount: 0,
    subtaskDoneCount: 0,
    commentCount: 0,
    attachmentCount: 0,
    blockedByCount: 0,
    blockingCount: 0,
    linkCount: 0,
    ...patch,
  } as TaskSummary;
}

describe('greetingFor', () => {
  it('follows the time of day', () => {
    expect(greetingFor(new Date(2026, 10, 11, 8))).toBe('Good morning');
    expect(greetingFor(new Date(2026, 10, 11, 13))).toBe('Good afternoon');
    expect(greetingFor(new Date(2026, 10, 11, 19))).toBe('Good evening');
    expect(greetingFor(new Date(2026, 10, 11, 2))).toBe('Good evening');
  });
});

describe('homeBuckets', () => {
  const tasks = [
    task('late', { dueDate: '2026-11-09' }),
    task('today-low', { dueDate: TODAY, priority: 'low' }),
    task('today-urgent', { dueDate: TODAY, priority: 'urgent' }),
    task('fri', { dueDate: '2026-11-13' }),
    task('in7', { dueDate: '2026-11-18' }),
    task('in8', { dueDate: '2026-11-19' }),
    task('none'),
    task('done-today', { dueDate: TODAY, statusCategory: 'done', completedAt: '2026-11-11T09:00:00.000Z' }),
    task('cancelled', { dueDate: '2026-11-01', statusCategory: 'cancelled' }),
  ];

  it('splits open tasks into overdue, today and the next 7 days', () => {
    const buckets = homeBuckets(tasks, TODAY);
    expect(buckets.overdue.map((t) => t.id)).toEqual(['late']);
    expect(buckets.today.map((t) => t.id)).toEqual(['today-urgent', 'today-low']);
    expect(buckets.week.map((t) => t.id)).toEqual(['fri', 'in7']);
  });

  it('keeps tasks finished during this visit in place', () => {
    const buckets = homeBuckets(tasks, TODAY, new Set(['done-today']));
    expect(buckets.today.map((t) => t.id)).toContain('done-today');
  });
});

describe('homeStats + summarySentence', () => {
  it('counts open, due today, overdue and done this week', () => {
    const stats = homeStats(
      [
        task('a', { dueDate: '2026-11-10' }),
        task('b', { dueDate: TODAY }),
        task('c'),
        task('d', { statusCategory: 'done', completedAt: '2026-11-09T10:00:00.000Z' }),
        task('e', { statusCategory: 'done', completedAt: '2026-11-08T10:00:00.000Z' }),
      ],
      TODAY,
    );
    expect(stats).toEqual({ open: 3, dueToday: 1, overdue: 1, doneThisWeek: 1 });
    expect(summarySentence(stats)).toBe('You have 1 overdue task and 1 due today.');
  });

  it('reads naturally in every case', () => {
    expect(summarySentence({ open: 0, dueToday: 0, overdue: 0, doneThisWeek: 0 })).toMatch(/clear/);
    expect(summarySentence({ open: 5, dueToday: 0, overdue: 0, doneThisWeek: 0 })).toBe('Nothing is due today. You have 5 open tasks in total.');
    expect(summarySentence({ open: 5, dueToday: 2, overdue: 0, doneThisWeek: 0 })).toBe('You have 2 tasks due today.');
    expect(summarySentence({ open: 5, dueToday: 0, overdue: 3, doneThisWeek: 0 })).toBe('You have 3 overdue tasks. Let’s get them done.');
  });
});

describe('gettingStartedSteps', () => {
  it('marks steps done from real data', () => {
    const steps = gettingStartedSteps({
      projectCount: 1,
      createdTaskCount: 0,
      tasks: [task('x', { dueDate: TODAY })],
      usedSearch: true,
      peopleCount: 1,
    });
    expect(Object.fromEntries(steps.map((s) => [s.id, s.done]))).toEqual({
      project: true,
      task: false,
      due: true,
      done: false,
      search: true,
      team: false,
    });
  });
});

describe('gettingStartedSteps program step', () => {
  const base = { projectCount: 1, createdTaskCount: 1, tasks: [], usedSearch: true, peopleCount: 2 };
  it('offers an optional program step when the org has none and the person can create', () => {
    const steps = gettingStartedSteps({ ...base, programCount: 0, canCreateProgram: true });
    const step = steps.find((entry) => entry.id === 'program');
    expect(step).toMatchObject({ title: 'Set up a program', optional: true, done: false });
    expect(requiredSteps(steps).some((entry) => entry.id === 'program')).toBe(false);
  });
  it('hides it once a program exists or when the person cannot create', () => {
    expect(gettingStartedSteps({ ...base, programCount: 1, canCreateProgram: true }).some((entry) => entry.id === 'program')).toBe(false);
    expect(gettingStartedSteps({ ...base, programCount: 0, canCreateProgram: false }).some((entry) => entry.id === 'program')).toBe(false);
    expect(gettingStartedSteps(base).some((entry) => entry.id === 'program')).toBe(false);
  });
});

describe('programs on home', () => {
  const today = { date: '2026-11-25', builds: 8, done: 5, plannedUnits: '800.000', builtUnits: '500.000' };
  const program = (patch: Partial<ProgramListItemDTO> = {}) =>
    ({ id: 'g', key: 'GLOVE', name: 'Glove kits', icon: 'repeat', color: 'amber', status: 'active', archivedAt: null, customer: { kind: 'crm_account', id: 'acct-1', name: 'Bluestone Foods' }, today, ...patch }) as ProgramListItemDTO;

  it('says how far a customer program is today', () => {
    expect(customerProgramText(program())).toBe('Glove kits · 5 of 8 builds done today');
    expect(customerProgramText(program({ today: { ...today, builds: 1, done: 0 } }))).toBe('Glove kits · 0 of 1 build done today');
    expect(customerProgramText(program({ today: { ...today, builds: 0, done: 0 } }))).toBe('Glove kits · No builds today');
  });

  it('groups running programs by customer id and name', () => {
    const map = programsByCustomer([program(), program({ id: 'old', key: 'OLD', status: 'completed' }), program({ id: 'n', key: 'NOCUST', customer: null })]);
    expect(map.get('acct-1')?.map((p) => p.key)).toEqual(['GLOVE']);
    expect(map.get('name:bluestone foods')?.map((p) => p.key)).toEqual(['GLOVE']);
    expect(map.size).toBe(2);
  });

  it('spots a single run that is the whole day', () => {
    expect(sameAsDay({ builds: 8, plannedUnits: '800.000', builtUnits: '500.000' }, 8, '800.000', '500.000')).toBe(true);
    expect(sameAsDay({ builds: 5, plannedUnits: '500.000', builtUnits: '500.000' }, 8, '800.000', '500.000')).toBe(false);
  });
});
