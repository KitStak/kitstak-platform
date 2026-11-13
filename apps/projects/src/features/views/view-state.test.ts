import { describe, expect, it } from 'vitest';
import type { TaskSummary } from '@/lib/types';
import {
  EMPTY_QUICK,
  applyParams,
  configFrom,
  countActiveFilters,
  decodeSort,
  encodeSort,
  filtersFromQuick,
  hasOverrides,
  matchesQuick,
  quickFromConfig,
  quickFromFilters,
  settingsFromConfig,
  writeParams,
  type QuickFilters,
} from './view-state';

const ME = 'user-me';
const TODAY = '2026-11-13';

function task(overrides: Partial<TaskSummary>): TaskSummary {
  return {
    id: 't1',
    projectId: 'p1',
    projectKey: 'OPS',
    number: 1,
    key: 'OPS-1',
    title: 'Pack the Acme order',
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
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
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

const base = { quick: EMPTY_QUICK, settings: settingsFromConfig('board', undefined) };

describe('matchesQuick', () => {
  it('searches title and key, case-insensitive', () => {
    expect(matchesQuick(task({}), { ...EMPTY_QUICK, q: 'acme' }, ME, TODAY)).toBe(true);
    expect(matchesQuick(task({}), { ...EMPTY_QUICK, q: 'ops-1' }, ME, TODAY)).toBe(true);
    expect(matchesQuick(task({}), { ...EMPTY_QUICK, q: 'invoice' }, ME, TODAY)).toBe(false);
  });

  it('resolves me / none for assignees and only-mine', () => {
    const mine = task({ assigneeId: ME });
    const nobody = task({ assigneeId: null });
    expect(matchesQuick(mine, { ...EMPTY_QUICK, mine: true }, ME, TODAY)).toBe(true);
    expect(matchesQuick(nobody, { ...EMPTY_QUICK, mine: true }, ME, TODAY)).toBe(false);
    expect(matchesQuick(mine, { ...EMPTY_QUICK, assignees: ['me'] }, ME, TODAY)).toBe(true);
    expect(matchesQuick(nobody, { ...EMPTY_QUICK, assignees: ['none'] }, ME, TODAY)).toBe(true);
    expect(matchesQuick(nobody, { ...EMPTY_QUICK, assignees: ['me'] }, ME, TODAY)).toBe(false);
  });

  it('matches any selected label, or no label', () => {
    expect(matchesQuick(task({ labelIds: ['a', 'b'] }), { ...EMPTY_QUICK, labels: ['b'] }, ME, TODAY)).toBe(true);
    expect(matchesQuick(task({ labelIds: [] }), { ...EMPTY_QUICK, labels: ['none'] }, ME, TODAY)).toBe(true);
    expect(matchesQuick(task({ labelIds: ['a'] }), { ...EMPTY_QUICK, labels: ['none'] }, ME, TODAY)).toBe(false);
  });

  it('due buckets: overdue ignores done tasks', () => {
    expect(matchesQuick(task({ dueDate: '2026-11-10' }), { ...EMPTY_QUICK, due: 'overdue' }, ME, TODAY)).toBe(true);
    expect(matchesQuick(task({ dueDate: '2026-11-10', statusCategory: 'done' }), { ...EMPTY_QUICK, due: 'overdue' }, ME, TODAY)).toBe(false);
    expect(matchesQuick(task({ dueDate: TODAY }), { ...EMPTY_QUICK, due: 'today' }, ME, TODAY)).toBe(true);
    expect(matchesQuick(task({ dueDate: '2026-11-19' }), { ...EMPTY_QUICK, due: 'next_7_days' }, ME, TODAY)).toBe(true);
    expect(matchesQuick(task({ dueDate: null }), { ...EMPTY_QUICK, due: 'no_date' }, ME, TODAY)).toBe(true);
  });
});

describe('URL state', () => {
  it('round-trips overrides and drops params equal to the base', () => {
    const next = { quick: { ...EMPTY_QUICK, priorities: ['urgent', 'high'] } as QuickFilters, settings: { ...base.settings, swimlane: 'assignee' as const } };
    const params = writeParams(new URLSearchParams('task=OPS-2'), base, next);
    expect(params.get('priority')).toBe('urgent,high');
    expect(params.get('lane')).toBe('assignee');
    expect(params.get('task')).toBe('OPS-2');
    expect(params.has('q')).toBe(false);
    const read = applyParams(params, base);
    expect(read.quick.priorities).toEqual(['urgent', 'high']);
    expect(read.settings.swimlane).toBe('assignee');
    const back = writeParams(params, base, base);
    expect(hasOverrides(back)).toBe(false);
    expect(back.get('task')).toBe('OPS-2');
  });

  it('writes an empty list to clear a filter the saved view had', () => {
    const viewBase = { quick: { ...EMPTY_QUICK, statuses: ['s1'] }, settings: base.settings };
    const params = writeParams(new URLSearchParams(), viewBase, { ...viewBase, quick: { ...viewBase.quick, statuses: [] } });
    expect(params.has('status')).toBe(true);
    expect(applyParams(params, viewBase).quick.statuses).toEqual([]);
  });

  it('encodes custom-field sorts', () => {
    const rules = decodeSort(encodeSort([{ field: 'custom', fieldId: 'f1', dir: 'desc' }, { field: 'dueDate', dir: 'asc' }]));
    expect(rules).toEqual([{ field: 'custom', fieldId: 'f1', dir: 'desc' }, { field: 'dueDate', dir: 'asc' }]);
  });
});

describe('saved view config', () => {
  it('stores quick filters and a FilterGroup other surfaces can read', () => {
    const quick: QuickFilters = { ...EMPTY_QUICK, assignees: ['me'], priorities: ['urgent'], due: 'overdue' };
    const config = configFrom(quick, { ...base.settings, swimlane: 'priority' }, 'board');
    expect(config.swimlane).toBe('priority');
    expect(quickFromConfig(config).quick).toEqual(quick);
    const group = filtersFromQuick(quick);
    expect(group.conditions).toContainEqual({ field: 'priority', op: 'in', value: ['urgent'] });
    expect(group.conditions).toContainEqual({ field: 'dueDate', op: 'overdue' });
  });

  it('rebuilds quick filters from a plain FilterGroup and keeps the rest as extra', () => {
    const { quick, extra } = quickFromFilters({ match: 'all', conditions: [{ field: 'assignee', op: 'empty' }, { field: 'startDate', op: 'before', value: '2026-12-01' }] });
    expect(quick.assignees).toEqual(['none']);
    expect(extra).toHaveLength(1);
    expect(countActiveFilters(quick)).toBe(1);
  });
});
