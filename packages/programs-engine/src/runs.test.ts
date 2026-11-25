import { describe, expect, it } from 'vitest';
import { RUN_STATE_LABELS, type RunBuild, groupRuns, parseRunId, runId, runState } from './runs';

const build = (partial: Partial<RunBuild> & Pick<RunBuild, 'buildId'>): RunBuild => ({
  containerId: 'GLOVE',
  buildDate: '2026-11-25',
  scheduleId: 'S',
  scheduleName: 'Weekday glove run',
  statusCategory: 'todo',
  plannedQty: '100',
  builtQty: '0',
  closedShort: false,
  ...partial,
});

describe('run ids', () => {
  it('makes and reads ids', () => {
    expect(runId({ scheduleId: 'S', date: '2026-11-25' })).toBe('run:S:2026-11-25');
    expect(runId({ scheduleId: null, date: '2026-11-25' })).toBe('run:manual:2026-11-25');
    expect(parseRunId('run:S:2026-11-25')).toEqual({ scheduleId: 'S', date: '2026-11-25' });
    expect(parseRunId('run:manual:2026-11-25')).toEqual({ scheduleId: null, date: '2026-11-25' });
    expect(parseRunId('run:S:2026-02-30')).toBeNull();
    expect(parseRunId('build:S:2026-11-25')).toBeNull();
  });
});

describe('groupRuns', () => {
  it('E42 a scheduled run in progress and the hand made builds', () => {
    const builds: RunBuild[] = [
      ...Array.from({ length: 5 }, (_, i) => build({ buildId: `d${i}`, statusCategory: 'done', builtQty: '100' })),
      build({ buildId: 'p', statusCategory: 'in_progress', builtQty: '60' }),
      build({ buildId: 't1' }),
      build({ buildId: 't2' }),
      build({ buildId: 'm', scheduleId: null, scheduleName: null }),
    ];
    const runs = groupRuns(builds);
    expect(runs.map((run) => run.id)).toEqual(['run:S:2026-11-25', 'run:manual:2026-11-25']);
    expect(runs[0]).toMatchObject({ name: 'Weekday glove run', state: 'in_progress', builds: 8, done: 5, plannedUnits: '800.000', builtUnits: '560.000' });
    expect(runs[1]).toMatchObject({ name: 'Unscheduled', state: 'planned', builds: 1 });
  });
  it('sorts by date, then schedule name, with Unscheduled last', () => {
    const runs = groupRuns([
      build({ buildId: 'a', buildDate: '2026-11-26', scheduleId: null, scheduleName: null }),
      build({ buildId: 'b', buildDate: '2026-11-26', scheduleId: 'Z', scheduleName: 'Zip run' }),
      build({ buildId: 'c', buildDate: '2026-11-26', scheduleId: 'A', scheduleName: 'Apex run' }),
      build({ buildId: 'd', buildDate: '2026-11-25', scheduleId: 'Q', scheduleName: null }),
      build({ buildId: 'e', buildDate: '2026-11-25', containerId: 'OTHER', scheduleId: 'Q', scheduleName: null }),
    ]);
    expect(runs.map((run) => [run.date, run.name, run.containerId])).toEqual([
      ['2026-11-25', 'Scheduled run', 'GLOVE'],
      ['2026-11-25', 'Scheduled run', 'OTHER'],
      ['2026-11-26', 'Apex run', 'GLOVE'],
      ['2026-11-26', 'Zip run', 'GLOVE'],
      ['2026-11-26', 'Unscheduled', 'GLOVE'],
    ]);
  });
});

describe('runState', () => {
  it('covers every state', () => {
    expect(runState([])).toBe('planned');
    expect(runState([build({ buildId: 'a', statusCategory: 'cancelled' })])).toBe('cancelled');
    expect(runState([build({ buildId: 'a', statusCategory: 'done', builtQty: '100' }), build({ buildId: 'b', statusCategory: 'cancelled' })])).toBe('done');
    expect(runState([build({ buildId: 'a', statusCategory: 'done', builtQty: '90' })])).toBe('short');
    expect(runState([build({ buildId: 'a', statusCategory: 'done', builtQty: '100', closedShort: true })])).toBe('short');
    expect(runState([build({ buildId: 'a', builtQty: '10' })])).toBe('in_progress');
    expect(runState([build({ buildId: 'a' })])).toBe('planned');
  });
  it('a cancelled build keeps its built units but not its plan', () => {
    const [run] = groupRuns([build({ buildId: 'a', statusCategory: 'done', builtQty: '100' }), build({ buildId: 'b', statusCategory: 'cancelled', builtQty: '20' })]);
    expect(run).toMatchObject({ plannedUnits: '100.000', builtUnits: '120.000', cancelled: 1, state: 'done' });
  });
  it('has words for each state', () => {
    expect(RUN_STATE_LABELS.short).toBe('Closed short');
  });
});

describe('cancelled output never hides a short run', () => {
  it('counts planned and built over the same live builds', () => {
    const cancelled = { statusCategory: 'cancelled' as const, plannedQty: '100', builtQty: '40', closedShort: false };
    const done = { statusCategory: 'done' as const, plannedQty: '100', builtQty: '70', closedShort: false };
    expect(runState([cancelled, done])).toBe('short');
    expect(runState([cancelled, { ...done, builtQty: '100' }])).toBe('done');
    const [run] = groupRuns([build({ buildId: 'c', ...cancelled }), build({ buildId: 'd', ...done })]);
    expect(run?.state).toBe('short');
    // The Run still totals every build's output.
    expect(run?.builtUnits).toBe('110.000');
    expect(run?.plannedUnits).toBe('100.000');
  });
});
