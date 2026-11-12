import { describe, expect, it, vi } from 'vitest';
import {
  MAX_WIDGET_CONFIG_BYTES,
  insightBatchSchema,
  insightFiltersSchema,
  insightQuerySchema,
  type InsightDto,
} from '@/server/services/contracts/dashboard-insights';
import { DatasetCache, datasetCacheKey } from '@/server/services/dashboards-insights-cache';
import { describeFilteredEmpty } from '../widgets/filter-context';
import { sparklineIsMeaningful } from '../widgets/numbers-widget';
import { fillRowHeight } from '../widgets/pipeline-widgets';
import { monthGrid, timelineWindow, weekStart } from '../widgets/time-widgets';
import { visibleWeeks } from '../widgets/workload-widget';
import { presetSize, widgetDefinition } from './catalog';
import { InsightBatcher, type BatchSender } from './insight-batcher';
import { collides, columnsFor, remapLayout, tidyLayout, toFullColumns, type GridItem } from './layout';

const item = (id: string, x: number, y: number, w: number, h: number): GridItem => ({ id, x, y, w, h });
const noOverlaps = (layout: readonly GridItem[]) => layout.every((a) => layout.every((b) => a.id === b.id || !collides(a, b)));

describe('responsive grid columns', () => {
  it('stacks on phones, remaps narrow grids to 6 columns, keeps 12 elsewhere', () => {
    expect(columnsFor(360, 390)).toBe(1);
    expect(columnsFor(560, 768)).toBe(6);
    // 1024px laptop with the sidebar open: the grid is ~760px wide and stays a full 12-column grid.
    expect(columnsFor(760, 1024)).toBe(12);
    expect(columnsFor(1300, 1440)).toBe(12);
  });

  it('remaps 12-column geometry onto 6 columns without overlaps and maps edits back', () => {
    const layout = [item('a', 0, 0, 3, 4), item('b', 3, 0, 3, 4), item('c', 6, 0, 6, 8)];
    const six = remapLayout(layout, 6);
    expect(six.every((entry) => entry.x + entry.w <= 6)).toBe(true);
    expect(noOverlaps(six)).toBe(true);
    const back = toFullColumns([item('a', 1, 0, 2, 4)], 6);
    expect(back[0]).toMatchObject({ x: 2, w: 4 });
    expect(toFullColumns([item('a', 4, 0, 4, 4)], 6)[0]).toMatchObject({ x: 4, w: 8 });
  });

  it('tidy fills holes left by short widgets', () => {
    const holey = [item('a', 0, 4, 6, 4), item('b', 6, 0, 6, 8), item('c', 0, 12, 3, 4)];
    const tidy = tidyLayout(holey);
    expect(noOverlaps(tidy)).toBe(true);
    expect(tidy.find((entry) => entry.id === 'b')).toMatchObject({ x: 0, y: 0 });
    expect(tidy.find((entry) => entry.id === 'a')).toMatchObject({ x: 6, y: 0 });
    expect(tidy.find((entry) => entry.id === 'c')).toMatchObject({ x: 6, y: 4 });
  });
});

describe('insight batcher', () => {
  const insight = (total: number) => ({ total }) as unknown as InsightDto;

  it('coalesces loads from one tick into one request and resolves each widget', async () => {
    vi.useFakeTimers();
    const send = vi.fn<BatchSender>(async (_id, body) => ({
      results: Object.fromEntries(body.widgets.map((widget, index) => [widget.key, { ok: true as const, data: insight(index) }])),
    }));
    const batcher = new InsightBatcher(send);
    const filters = { personIds: [] };
    const a = batcher.load('d1', filters, { key: 'a', type: 'number', config: {} });
    const b = batcher.load('d1', filters, { key: 'b', type: 'chart', config: {} });
    await vi.runAllTimersAsync();
    await expect(a).resolves.toMatchObject({ total: 0 });
    await expect(b).resolves.toMatchObject({ total: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('rejects only the widget that failed and marks refreshes as fresh', async () => {
    vi.useFakeTimers();
    const send = vi.fn<BatchSender>(async () => ({
      results: { a: { ok: true as const, data: insight(1) }, b: { ok: false as const, error: 'boom' } },
    }));
    const batcher = new InsightBatcher(send);
    batcher.markFresh();
    const a = batcher.load('d1', { personIds: [] }, { key: 'a', type: 'number', config: {} });
    const b = batcher.load('d1', { personIds: [] }, { key: 'b', type: 'number', config: {} });
    const settled = Promise.allSettled([a, b]);
    await vi.runAllTimersAsync();
    const [first, second] = await settled;
    expect(first.status).toBe('fulfilled');
    expect(second.status).toBe('rejected');
    expect(send.mock.calls[0]?.[1].fresh).toBe(true);
    vi.useRealTimers();
  });
});

describe('dataset cache', () => {
  it('shares one load per key and lets hydrated data serve plain requests', async () => {
    let now = 0;
    const cache = new DatasetCache<string>(1000, () => now);
    const load = vi.fn(async () => 'data');
    const key = { orgId: 'o', userId: 'u', boardIds: ['b2', 'b1'], hydrated: true };
    await Promise.all([cache.get(key, load), cache.get({ ...key, boardIds: ['b1', 'b2'] }, load)]);
    await cache.get({ ...key, hydrated: false }, load);
    expect(load).toHaveBeenCalledTimes(1);
    now = 2000;
    await cache.get(key, load);
    expect(load).toHaveBeenCalledTimes(2);
    await cache.get(key, load, { fresh: true });
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('never serves a failed load and keys by user', async () => {
    const cache = new DatasetCache<string>(1000);
    const failing = vi.fn(async () => {
      throw new Error('db down');
    });
    const key = { orgId: 'o', userId: 'u', boardIds: ['b'], hydrated: false };
    await expect(cache.get(key, failing)).rejects.toThrow('db down');
    await Promise.resolve();
    const ok = vi.fn(async () => 'ok');
    await expect(cache.get(key, ok)).resolves.toBe('ok');
    expect(datasetCacheKey(key)).not.toBe(datasetCacheKey({ ...key, userId: 'v' }));
  });
});

describe('insight contracts', () => {
  it('rejects from > to and non-uuid people, accepts the me token', () => {
    expect(insightFiltersSchema.safeParse({ from: '2026-05-01', to: '2026-04-01', personIds: [] }).success).toBe(false);
    expect(insightFiltersSchema.safeParse({ personIds: ['x'] }).success).toBe(false);
    expect(insightFiltersSchema.safeParse({ personIds: ['me', '7f0c1b9e-4a7b-4c55-9a51-2c8a6c3f4d10'] }).success).toBe(true);
  });

  it('caps the serialized widget config size', () => {
    const huge = { junk: 'x'.repeat(MAX_WIDGET_CONFIG_BYTES) };
    expect(insightQuerySchema.safeParse({ widget: { type: 'number', config: huge } }).success).toBe(false);
    expect(insightBatchSchema.safeParse({ widgets: [{ key: 'a', type: 'number', config: {} }] }).success).toBe(true);
  });
});

describe('widget density + time helpers', () => {
  it('fills rows into spare height within bounds', () => {
    expect(fillRowHeight(400, 4, 52, 84)).toBe(84);
    expect(fillRowHeight(240, 4, 52, 84)).toBe(60);
    expect(fillRowHeight(100, 4, 52, 84)).toBe(52);
  });

  it('shows fewer workload weeks on narrow cards', () => {
    expect(visibleWeeks(340, 6)).toBe(4);
    expect(visibleWeeks(900, 6)).toBe(6);
    expect(visibleWeeks(120, 6)).toBe(2);
  });

  it('hides sparklines that would be flat lines', () => {
    expect(sparklineIsMeaningful([0, 0, 0, 0, 0, 9])).toBe(false);
    expect(sparklineIsMeaningful([3, 0, 4, 5])).toBe(true);
  });

  it('builds only the weeks of the month', () => {
    const feb2027 = monthGrid(new Date(Date.UTC(2027, 1, 1)));
    expect(feb2027.length % 7).toBe(0);
    expect(feb2027.length).toBeLessThanOrEqual(35);
    expect(weekStart('2026-11-06')).toBe('2026-11-02');
  });

  it('derives the timeline window from the filter, else from the items', () => {
    expect(timelineWindow([], '2026-11-06', { from: '2026-10-01', to: '2026-12-31' })).toEqual({ start: '2026-10-01', end: '2026-12-31' });
    const fromItems = timelineWindow([{ from: '2026-08-15', to: '2026-09-01' }], '2026-11-06');
    expect(fromItems.start).toBe('2026-08-01');
    expect(fromItems.end).toBe('2027-02-28');
  });

  it('explains filtered-empty states from the active filters', () => {
    const base = { search: '', hasPeople: false, hasRange: false, rangeLabel: 'All time' };
    expect(describeFilteredEmpty({ ...base, search: 'zzz' }).title).toBe('No items match “zzz”');
    expect(describeFilteredEmpty({ ...base, hasRange: true, rangeLabel: 'This quarter' }).description).toContain('This quarter');
  });

  it('sizes widgets for the S / M / L presets within limits', () => {
    const chart = widgetDefinition('chart');
    expect(presetSize('chart', 'M')).toEqual(chart.size);
    expect(presetSize('chart', 'S').w).toBeGreaterThanOrEqual(chart.limits.minW);
    expect(presetSize('chart', 'L').w).toBeLessThanOrEqual(12);
  });
});

describe('layout swap', () => {
  it('swaps same-sized widgets when one is dropped onto the other', async () => {
    const { moveItem } = await import('./layout');
    const row = [item('a', 0, 0, 3, 4), item('b', 3, 0, 3, 4), item('c', 6, 0, 3, 4)];
    const next = moveItem(row, 'b', 6, 0);
    expect(next.find((entry) => entry.id === 'b')).toMatchObject({ x: 6, y: 0 });
    expect(next.find((entry) => entry.id === 'c')).toMatchObject({ x: 3, y: 0 });
  });
});
