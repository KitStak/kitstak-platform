import { describe, expect, it } from 'vitest';
import type { TaskSummary } from '@/lib/types';
import { DEFAULT_BUILD_FILTERS, activeBuildFilterCount, foldsOnBoard, formatBuildFilters, matchesBuildFilters, orderRunKeys, parseBuildFilters, toCsv, totalsOf } from './builds-model';

function build(id: string, over: Partial<{ date: string; runId: string; scheduleId: string | null; planned: string; built: string; status: TaskSummary['statusCategory']; variantId: string | null; unplanned: boolean; closedShort: boolean; revenue: string | null }> = {}): TaskSummary {
  const date = over.date ?? '2026-11-25';
  return {
    id,
    key: `GLOVE-${id}`,
    kind: 'build',
    statusCategory: over.status ?? 'todo',
    dueDate: date,
    build: {
      variantId: over.variantId === undefined ? 'v1' : over.variantId,
      buildDate: date,
      runId: over.runId ?? `run:s1:${date}`,
      scheduleId: over.scheduleId === undefined ? 's1' : over.scheduleId,
      plannedQty: over.planned ?? '100.000',
      builtQty: over.built ?? '0.000',
      remainingQty: '0.000',
      scrapQty: '0.000',
      unplanned: over.unplanned ?? false,
      closedShort: over.closedShort ?? false,
      revenueCents: over.revenue === undefined ? '0' : over.revenue,
    },
  } as unknown as TaskSummary;
}

describe('build filters', () => {
  it('round trips through the URL', () => {
    const filters = { variants: ['a', 'b'], short: true, unplanned: false, workKind: 'both' as const };
    expect(parseBuildFilters(formatBuildFilters(filters))).toEqual(filters);
    expect(formatBuildFilters(DEFAULT_BUILD_FILTERS)).toBe('');
    expect(parseBuildFilters('')).toEqual(DEFAULT_BUILD_FILTERS);
    expect(activeBuildFilterCount(filters)).toBe(3);
  });

  it('keeps tasks out by default and in with Both', () => {
    const task = { id: 't', kind: 'task', statusCategory: 'todo', build: null } as unknown as TaskSummary;
    expect(matchesBuildFilters(task, DEFAULT_BUILD_FILTERS)).toBe(false);
    expect(matchesBuildFilters(task, { ...DEFAULT_BUILD_FILTERS, workKind: 'both' })).toBe(true);
    expect(matchesBuildFilters(build('1'), { ...DEFAULT_BUILD_FILTERS, workKind: 'task' })).toBe(false);
  });

  it('filters by variant, unplanned and short', () => {
    expect(matchesBuildFilters(build('1'), { ...DEFAULT_BUILD_FILTERS, variants: ['v2'] })).toBe(false);
    expect(matchesBuildFilters(build('1', { unplanned: true }), { ...DEFAULT_BUILD_FILTERS, unplanned: true })).toBe(true);
    expect(matchesBuildFilters(build('1', { status: 'done', built: '80.000' }), { ...DEFAULT_BUILD_FILTERS, short: true })).toBe(true);
    expect(matchesBuildFilters(build('1', { status: 'todo', built: '80.000' }), { ...DEFAULT_BUILD_FILTERS, short: true })).toBe(false);
  });
});

describe('runs and folds', () => {
  it('orders runs newest day first, scheduled before Unscheduled', () => {
    const tasks = [build('1', { date: '2026-11-24', runId: 'run:manual:2026-11-24', scheduleId: null }), build('2', { date: '2026-11-25', runId: 'run:manual:2026-11-25', scheduleId: null }), build('3', { date: '2026-11-25' })];
    expect(orderRunKeys(tasks)).toEqual(['run:s1:2026-11-25', 'run:manual:2026-11-25', 'run:manual:2026-11-24']);
  });

  it('folds done cards before the range, and older than today in long ranges', () => {
    const range = { from: '2026-11-23', to: '2026-11-29' };
    expect(foldsOnBoard(build('1', { status: 'done', date: '2026-11-20' }), range, '2026-11-25')).toBe(true);
    expect(foldsOnBoard(build('1', { status: 'done', date: '2026-11-24' }), range, '2026-11-25')).toBe(true);
    expect(foldsOnBoard(build('1', { status: 'done', date: '2026-11-25' }), range, '2026-11-25')).toBe(false);
    expect(foldsOnBoard(build('1', { status: 'todo', date: '2026-11-20' }), range, '2026-11-25')).toBe(false);
    expect(foldsOnBoard(build('1', { status: 'done', date: '2026-11-25' }), { from: '2026-11-25', to: '2026-11-25' }, '2026-11-26')).toBe(false);
  });
});

describe('totals and csv', () => {
  it('adds quantities exactly and hides money when any row hides it', () => {
    const totals = totalsOf([build('1', { planned: '100.000', built: '60.500', revenue: '11798', status: 'done' }), build('2', { planned: '100.000', built: '40.000', revenue: '7800' })]);
    expect(totals).toMatchObject({ builds: 2, done: 1, planned: '200.000', built: '100.500', revenueCents: '19598' });
    expect(totalsOf([build('1', { revenue: null })]).revenueCents).toBeNull();
  });
  it('quotes CSV cells', () => {
    expect(toCsv([['a', 'b,c'], ['say "hi"', 'x']])).toBe('a,"b,c"\n"say ""hi""",x');
  });
});

describe('build display helpers', () => {
  it('flips show defaults from the stored set', async () => {
    const { buildShowFrom } = await import('./builds-model');
    expect(buildShowFrom(new Set())).toEqual({ qty: true, revenue: true, rate: false, variant: true, sku: false });
    expect(buildShowFrom(new Set(['qty', 'sku']))).toMatchObject({ qty: false, sku: true });
  });
});
