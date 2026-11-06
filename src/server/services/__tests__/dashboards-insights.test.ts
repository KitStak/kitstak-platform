import { describe, expect, it } from 'vitest';
import type { ColumnDto, ItemDto } from '../contracts/dto';
import { parseWidgetSettings, widgetKindOf, widgetTypeForKind } from '../contracts/dashboard-insights';
import { computeInsight } from '../dashboards-insights-builders';
import { aggregate, bucketKey, bucketLabel, previousRange, type InsightDataset } from '../dashboards-insights-core';
import { starterWidgets } from '../dashboards-insights-starter';

const NOW = new Date('2026-11-05T12:00:00Z');
const BOARD = '00000000-0000-4000-8000-000000000001';

function column(key: string, type: string, settings: Record<string, unknown> = {}): ColumnDto {
  return { id: key, boardId: BOARD, key, title: key, description: null, type, scope: 'item', settings, width: 140, position: 'a', hidden: false, required: false } as unknown as ColumnDto;
}

const stage = column('stage', 'status', {
  labels: [
    { id: 'lead', name: 'Lead', color: 'sky', position: 0 },
    { id: 'proposal', name: 'Proposal', color: 'purple', position: 1 },
    { id: 'won', name: 'Won', color: 'green', position: 2, isDone: true },
    { id: 'lost', name: 'Lost', color: 'red', position: 3 },
    { id: 'default', name: '', color: 'gray', position: 4, isDefault: true },
  ],
});

let seq = 0;
function deal(stageId: string, value: number, close: string, owner: string, probability = 50, timeline?: [string, string]): ItemDto {
  seq += 1;
  return {
    id: `i${seq}`,
    boardId: BOARD,
    groupId: 'g1',
    parentItemId: null,
    name: `Deal ${seq}`,
    position: String(seq),
    values: {
      stage: { labelId: stageId },
      value: { amount: value, currency: 'USD' },
      probability,
      close: { date: close },
      owner: { ids: [owner] },
      ...(timeline ? { span: { from: timeline[0], to: timeline[1] } } : {}),
    },
    computed: {},
    subitemCount: 0,
    updateCount: 0,
    createdBy: null,
    updatedBy: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  } as unknown as ItemDto;
}

const dataset: InsightDataset = {
  boards: [{ id: BOARD, name: 'Deals' }],
  columns: [stage, column('value', 'currency', { currency: 'USD' }), column('probability', 'number'), column('close', 'date'), column('owner', 'people'), column('span', 'timeline')],
  groups: [{ id: 'g1', boardId: BOARD, title: 'Pipeline', color: 'blue' }],
  users: [
    { id: 'u1', name: 'Ada', email: 'ada@x.dev', image: null, title: null },
    { id: 'u2', name: 'Bo', email: 'bo@x.dev', image: null, title: null },
  ],
  items: [
    deal('lead', 100, '2026-11-10', 'u1', 10, ['2026-11-02', '2026-11-20']),
    deal('proposal', 200, '2026-12-15', 'u1', 60),
    deal('proposal', 300, '2026-10-20', 'u2', 50),
    deal('won', 400, '2026-10-25', 'u2'),
    deal('won', 500, '2026-11-03', 'u1'),
    deal('lost', 600, '2026-11-01', 'u2'),
  ],
};

const run = (kind: Parameters<typeof computeInsight>[0]['kind'], config: Record<string, unknown>, filters = { personIds: [] as string[] }) =>
  computeInsight({ kind, settings: parseWidgetSettings(config), filters, dataset, now: NOW });

describe('widget kind mapping', () => {
  it('maps extra kinds onto stored widget types', () => {
    expect(widgetTypeForKind('forecast')).toBe('chart');
    expect(widgetTypeForKind('countdown')).toBe('text');
    expect(widgetKindOf('chart', { kind: 'forecast' })).toBe('forecast');
    expect(widgetKindOf('number', { kind: 'forecast' })).toBe('numbers');
    expect(widgetKindOf('text', {})).toBe('text');
  });

  it('degrades malformed settings to defaults', () => {
    const settings = parseWidgetSettings({ aggregate: 'nope', chartType: 7, capacity: -1, boardIds: 'x' });
    expect(settings).toMatchObject({ aggregate: 'count', chartType: 'bar', capacity: 5 });
    expect(settings.boardIds).toBeUndefined();
  });
});

describe('core helpers', () => {
  it('aggregates including median', () => {
    expect(aggregate([1, 9, 3], 'median', 3)).toBe(3);
    expect(aggregate([1, 9, 3, 5], 'median', 4)).toBe(4);
    expect(aggregate([], 'average', 0)).toBe(0);
    expect(aggregate([2, 4], 'count', 7)).toBe(7);
  });

  it('buckets dates and computes the previous period', () => {
    expect(bucketKey('2026-11-05', 'month')).toBe('2026-11');
    expect(bucketKey('2026-11-05', 'quarter')).toBe('2026-Q4');
    expect(bucketKey('2026-11-05', 'week')).toBe('2026-11-02');
    expect(bucketLabel('2026-11', 'month')).toBe('Nov 26');
    expect(previousRange({ from: '2026-11-01', to: '2026-11-30' })).toEqual({ from: '2026-10-02', to: '2026-10-31' });
    expect(previousRange({ from: '2026-11-01' })).toBeNull();
  });
});

describe('computeInsight', () => {
  it('flags unconfigured widgets and skips content widgets', () => {
    const empty = computeInsight({ kind: 'numbers', settings: parseWidgetSettings({}), filters: { personIds: [] }, dataset: { ...dataset, boards: [] }, now: NOW });
    expect(empty.unconfigured).toBe(true);
    expect(run('text', {}).itemCount).toBe(0);
  });

  it('sums numbers with a status filter and compares periods', () => {
    const result = run('numbers', { valueColumnKey: 'value', aggregate: 'sum', dateColumnKey: 'close', filter: { columnKey: 'stage', labelIds: ['won'], exclude: false } });
    expect(result.total).toBe(900);
    expect(result.itemCount).toBe(2);
    expect(result.valueColumn).toMatchObject({ key: 'value', currency: 'USD' });
    expect(result.comparison).toEqual({ current: 900, previous: 0, label: 'Last 30 days vs prior 30' });
    expect(result.sparkline).toHaveLength(6);
  });

  it('applies dashboard date range, people and search filters', () => {
    const ranged = run('numbers', { aggregate: 'count', dateColumnKey: 'close' }, { personIds: [], from: '2026-11-01', to: '2026-11-30' } as never);
    expect(ranged.total).toBe(3);
    expect(ranged.comparison?.label).toBe('vs previous period');
    expect(run('numbers', {}, { personIds: ['u2'] }).total).toBe(3);
    expect(run('numbers', {}, { personIds: [], search: 'deal 1' } as never).total).toBeGreaterThanOrEqual(1);
  });

  it('groups a chart by status in label order with stacks', () => {
    const result = run('chart', { groupByColumnKey: 'stage', chartType: 'stacked_bar', stackByColumnKey: 'owner' });
    expect(result.series.map((point) => point.key)).toEqual(['lead', 'proposal', 'won', 'lost']);
    expect(result.stacks.map((stack) => stack.label).sort()).toEqual(['Ada', 'Bo']);
    expect(result.series.find((point) => point.key === 'proposal')?.stack).toEqual({ u1: 1, u2: 1 });
  });

  it('respects include/exclude labels, sort and limit', () => {
    const result = run('chart', { groupByColumnKey: 'stage', excludeLabelIds: ['lost'], valueColumnKey: 'value', aggregate: 'sum', sortBy: 'value_desc', limit: 2 });
    expect(result.series.map((point) => [point.key, point.value])).toEqual([['won', 900], ['proposal', 500]]);
  });

  it('computes battery done ratio', () => {
    const result = run('battery', { groupByColumnKey: 'stage' });
    expect(result.doneRatio).toBeCloseTo(2 / 6);
    expect(result.series.find((point) => point.key === 'won')?.isDone).toBe(true);
  });

  it('ranks the leaderboard by value', () => {
    const result = run('leaderboard', { groupByColumnKey: 'owner', valueColumnKey: 'value', aggregate: 'sum' });
    expect(result.series.map((point) => [point.label, point.value])).toEqual([['Bo', 1300], ['Ada', 800]]);
  });

  it('builds a cumulative funnel with conversion rates', () => {
    const result = run('funnel', { groupByColumnKey: 'stage', excludeLabelIds: ['lost'], valueColumnKey: 'value', aggregate: 'sum' });
    expect(result.series.map((point) => [point.key, point.count])).toEqual([['lead', 5], ['proposal', 4], ['won', 2]]);
    expect(result.series[0]?.conversion).toBeNull();
    expect(result.series[1]?.conversion).toBeCloseTo(0.8);
    expect(result.series[2]?.conversion).toBeCloseTo(0.5);
    expect(result.series[2]?.value).toBe(900);
  });

  it('forecasts pipeline, weighted and won value by close month with an overdue bucket', () => {
    const result = run('forecast', { groupByColumnKey: 'stage', valueColumnKey: 'value', probabilityColumnKey: 'probability', dateColumnKey: 'close', excludeLabelIds: ['lost'], months: 3 });
    expect(result.forecast.map((bucket) => bucket.key)).toEqual(['overdue', '2026-11', '2026-12', '2027-01']);
    const overdue = result.forecast[0];
    expect(overdue).toMatchObject({ pipeline: 300, weighted: 150 });
    expect(result.forecast[1]).toMatchObject({ pipeline: 100, weighted: 10, won: 500 });
    expect(result.forecast[2]).toMatchObject({ pipeline: 200, weighted: 120 });
  });

  it('builds weekly workload per person', () => {
    const result = run('workload', { groupByColumnKey: 'owner', dateColumnKey: 'span', capacity: 2 });
    const ada = result.workload?.rows.find((row) => row.name === 'Ada');
    expect(result.workload?.periods).toHaveLength(6);
    expect(ada?.cells.slice(0, 3)).toEqual([1, 1, 1]);
    expect(result.workload?.capacity).toBe(2);
  });

  it('returns sorted, limited rows for tables and dated rows for calendars', () => {
    const table = run('table', { valueColumnKey: 'value', sortBy: 'value_desc', limit: 2, columnKeys: ['stage', 'value', 'missing'] });
    expect(table.rows.map((row) => row.name)).toEqual(['Deal 6', 'Deal 5'].map((name) => table.rows.find((row) => row.name === name)?.name));
    expect(table.rowsTruncated).toBe(true);
    expect(table.tableKeys).toEqual(['stage', 'value']);
    const calendar = run('calendar', { dateColumnKey: 'span' });
    expect(calendar.rows).toHaveLength(1);
  });
});

describe('starter widgets', () => {
  it('builds a sales cockpit for a deals board and a generic set otherwise', () => {
    const board = { id: BOARD, name: 'Deals', kind: 'deals', workspaceId: 'w', itemTerminology: 'Deal', columns: dataset.columns, groups: [] };
    const cockpit = starterWidgets([board]);
    expect(cockpit.map((widget) => widget.config.kind)).toEqual(expect.arrayContaining(['numbers', 'forecast', 'funnel', 'leaderboard', 'table']));
    expect(cockpit.find((widget) => widget.config.kind === 'forecast')?.type).toBe('chart');
    const generic = starterWidgets([{ ...board, kind: 'projects', itemTerminology: 'Task' }]);
    expect(generic[0]?.title).toBe('Total tasks');
    expect(starterWidgets([])).toEqual([]);
  });
});
