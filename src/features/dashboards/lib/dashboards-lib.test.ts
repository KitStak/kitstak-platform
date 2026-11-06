import { describe, expect, it } from 'vitest';
import { defaultWidget, searchWidgets, widgetDefinition, WIDGETS } from './catalog';
import { insightToCsv } from './export';
import {
  activeFilterCount,
  describeRange,
  isFiltered,
  parseFilterParams,
  resolveRange,
  toInsightFilters,
  writeFilterParams,
} from './filters';
import { abbreviate, describeAggregate, formatCompact, formatExact, percentChange, resolveFormat } from './format';
import {
  changedItems,
  clampItem,
  collides,
  compact,
  firstFreeSlot,
  layoutHeight,
  moveItem,
  resizeItem,
  toCell,
  toPixels,
  toSpan,
  type GridItem,
} from './layout';
import { countdownParts, parseInline, parseRichText, safeHref } from './rich-text';
import type { ColumnDto } from '@/server/services/contracts/dto';
import type { DashboardSourceBoard, InsightDto } from '@/server/services/contracts/dashboard-insights';

const item = (id: string, x: number, y: number, w: number, h: number): GridItem => ({ id, x, y, w, h });

function noOverlaps(layout: readonly GridItem[]): boolean {
  return layout.every((a) => layout.every((b) => a.id === b.id || !collides(a, b)));
}

describe('layout engine', () => {
  it('detects overlap but not touching edges', () => {
    expect(collides(item('a', 0, 0, 4, 4), item('b', 3, 3, 2, 2))).toBe(true);
    expect(collides(item('a', 0, 0, 4, 4), item('b', 4, 0, 2, 2))).toBe(false);
    expect(collides(item('a', 0, 0, 4, 4), item('a', 0, 0, 4, 4))).toBe(false);
  });

  it('clamps size and position into the 12-column grid', () => {
    expect(clampItem(item('a', 10, -2, 6, 0))).toEqual(item('a', 6, 0, 6, 1));
    expect(clampItem(item('a', 0, 0, 1, 1), { minW: 3, minH: 4 })).toEqual(item('a', 0, 0, 3, 4));
  });

  it('compacts gaps and overlaps upward', () => {
    const result = compact([item('a', 0, 5, 6, 2), item('b', 0, 5, 6, 2), item('c', 6, 9, 6, 3)]);
    expect(result.find((entry) => entry.id === 'a')?.y).toBe(0);
    expect(result.find((entry) => entry.id === 'b')?.y).toBe(2);
    expect(result.find((entry) => entry.id === 'c')?.y).toBe(0);
    expect(noOverlaps(result)).toBe(true);
  });

  it('swaps vertically once the dragged centre passes the neighbour centre', () => {
    const layout = [item('a', 0, 0, 6, 4), item('b', 0, 4, 6, 4)];
    const stays = moveItem(layout, 'a', 0, 1);
    expect(stays.find((entry) => entry.id === 'a')?.y).toBe(0);
    const swapped = moveItem(layout, 'a', 0, 5);
    expect(swapped.find((entry) => entry.id === 'b')?.y).toBe(0);
    expect(swapped.find((entry) => entry.id === 'a')?.y).toBe(4);
  });

  it('moves horizontally into free columns and keeps the grid gap-free', () => {
    const layout = [item('a', 0, 0, 4, 4), item('b', 4, 0, 4, 4)];
    const moved = moveItem(layout, 'a', 8, 0);
    expect(moved.find((entry) => entry.id === 'a')).toMatchObject({ x: 8, y: 0 });
    expect(noOverlaps(moved)).toBe(true);
  });

  it('resizes and pushes neighbours below, honouring limits', () => {
    const layout = [item('a', 0, 0, 6, 4), item('b', 0, 4, 6, 4)];
    const grown = resizeItem(layout, 'a', 6, 6);
    expect(grown.find((entry) => entry.id === 'b')?.y).toBe(6);
    const tiny = resizeItem(layout, 'a', 1, 1, { minW: 3, minH: 3 });
    expect(tiny.find((entry) => entry.id === 'a')).toMatchObject({ w: 3, h: 3 });
  });

  it('finds the first free slot or appends at the bottom', () => {
    const layout = [item('a', 0, 0, 6, 4), item('b', 6, 0, 3, 4)];
    expect(firstFreeSlot(layout, 3, 4)).toEqual({ x: 9, y: 0 });
    expect(firstFreeSlot(layout, 6, 4)).toEqual({ x: 0, y: 4 });
    expect(firstFreeSlot([], 12, 2)).toEqual({ x: 0, y: 0 });
  });

  it('reports layout height and changed items', () => {
    const before = [item('a', 0, 0, 6, 4), item('b', 0, 4, 6, 2)];
    const after = [item('a', 0, 0, 6, 4), item('b', 6, 0, 6, 2)];
    expect(layoutHeight(before)).toBe(6);
    expect(changedItems(before, after).map((entry) => entry.id)).toEqual(['b']);
  });

  it('converts between grid units and pixels consistently', () => {
    const width = 1200;
    const px = toPixels(item('a', 3, 2, 4, 5), width);
    expect(toCell(px.left, px.top, width)).toEqual({ x: 3, y: 2 });
    expect(toSpan(px.width, px.height, width)).toEqual({ w: 4, h: 5 });
  });
});

describe('dashboard filters', () => {
  const today = new Date('2026-11-05T12:00:00Z');

  it('resolves presets relative to today', () => {
    expect(resolveRange({ range: 'all' }, today)).toEqual({});
    expect(resolveRange({ range: 'this_month' }, today)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(resolveRange({ range: 'this_quarter' }, today)).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(resolveRange({ range: 'last_quarter' }, today)).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(resolveRange({ range: 'next_quarter' }, today)).toEqual({ from: '2027-01-01', to: '2027-03-31' });
    expect(resolveRange({ range: 'last_30' }, today)).toEqual({ from: '2026-10-07', to: '2026-11-05' });
    expect(resolveRange({ range: 'ytd' }, today)).toEqual({ from: '2026-01-01', to: '2026-11-05' });
    expect(resolveRange({ range: 'custom', from: '2026-02-01', to: 'bad' }, today)).toEqual({ from: '2026-02-01' });
  });

  it('round-trips through URL params and preserves unrelated keys', () => {
    const state = { range: 'custom' as const, from: '2026-01-01', to: '2026-03-31', personIds: ['u1', 'u2'], search: 'acme' };
    const params = writeFilterParams(state, new URLSearchParams('present=1'));
    expect(params.get('present')).toBe('1');
    expect(parseFilterParams(params)).toEqual(state);
  });

  it('rejects malformed params', () => {
    const parsed = parseFilterParams(new URLSearchParams('range=forever&people=ok,<script>&from=2026-01-01'));
    expect(parsed).toEqual({ range: 'all', personIds: ['ok'], search: '' });
  });

  it('builds API filters and counts active filters', () => {
    const state = { range: 'this_month' as const, personIds: ['u1'], search: '  ' };
    expect(toInsightFilters(state, today)).toEqual({ from: '2026-11-01', to: '2026-11-30', personIds: ['u1'] });
    expect(isFiltered(state)).toBe(true);
    expect(activeFilterCount(state)).toBe(2);
    expect(isFiltered({ range: 'all', personIds: [], search: '' })).toBe(false);
    expect(describeRange({ range: 'custom', from: '2026-01-01', to: '2026-01-31', personIds: [], search: '' }, today)).toBe('Jan 1, 2026 – Jan 31, 2026');
  });
});

describe('number formatting', () => {
  it('abbreviates large values', () => {
    expect(abbreviate(950)).toBe('950');
    expect(abbreviate(9_999)).toBe('9,999');
    expect(abbreviate(12_500)).toBe('12.5K');
    expect(abbreviate(1_250_000)).toBe('1.25M');
    expect(abbreviate(-3_400_000_000)).toBe('-3.4B');
  });

  it('formats currency compactly and exactly, dropping a duplicate symbol prefix', () => {
    const format = resolveFormat({ format: 'number', prefix: '$' }, { key: 'v', title: 'Deal value', type: 'currency', currency: 'USD' }, 'sum');
    expect(format.prefix).toBeUndefined();
    expect(formatCompact(25_900_000, format)).toBe('$25.9M');
    expect(formatExact(1_250_000, format)).toBe('$1,250,000');
  });

  it('counts ignore currency and units', () => {
    const format = resolveFormat({ format: 'currency' }, { key: 'v', title: 'Deal value', type: 'currency', currency: 'USD' }, 'count');
    expect(format.currency).toBeUndefined();
    expect(formatCompact(164, format)).toBe('164');
  });

  it('applies units, percent and prefix/suffix', () => {
    expect(formatCompact(45, resolveFormat({ format: 'number' }, { key: 'd', title: 'Duration', type: 'number', unit: 'min' }, 'sum'))).toBe('45 min');
    expect(formatCompact(64.25, { format: 'percent' })).toBe('64.3%');
    expect(formatExact(12, { format: 'number', prefix: '#', suffix: ' deals' })).toBe('#12 deals');
  });

  it('computes percent change safely', () => {
    expect(percentChange(110, 100)).toBeCloseTo(10);
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(-50, -100)).toBeCloseTo(50);
  });

  it('describes the aggregate for tooltips', () => {
    const column = { key: 'v', title: 'Deal value', type: 'currency' };
    expect(describeAggregate('sum', column, [{ name: 'Deals' }])).toBe('Sum of Deal value on Deals');
    expect(describeAggregate('count', column, [{ name: 'A' }, { name: 'B' }])).toBe('Count of items across 2 boards');
  });
});

describe('rich text', () => {
  it('parses headings, lists and paragraphs', () => {
    const blocks = parseRichText('# Title\n\nFirst line\nsecond line\n- one\n- **two**\n\nEnd');
    expect(blocks.map((block) => block.kind)).toEqual(['heading', 'paragraph', 'list', 'paragraph']);
    const list = blocks[2];
    expect(list?.kind === 'list' && list.items[1]).toEqual([{ kind: 'bold', text: 'two' }]);
  });

  it('only allows safe links', () => {
    expect(parseInline('[ok](https://x.dev) and [bad](javascript:alert(1))')).toEqual([
      { kind: 'link', text: 'ok', href: 'https://x.dev' },
      { kind: 'text', text: ' and ' },
      { kind: 'text', text: 'bad' },
      { kind: 'text', text: ')' },
    ]);
    expect(safeHref('//evil.com')).toBeNull();
    expect(safeHref('/org/boards/1')).toBe('/org/boards/1');
  });

  it('breaks a countdown into units', () => {
    const now = new Date('2026-11-05T12:00:00Z');
    expect(countdownParts(new Date('2026-11-06T13:01:05Z'), now)).toEqual({ past: false, days: 1, hours: 1, minutes: 1, seconds: 5 });
    expect(countdownParts(new Date('2026-11-01T00:00:00Z'), now).past).toBe(true);
  });
});

describe('widget catalog', () => {
  const column = (key: string, type: string, extra: Partial<ColumnDto> = {}): ColumnDto =>
    ({ id: key, boardId: 'b1', key, title: key, description: null, type, scope: 'item', settings: {}, width: 140, position: 'a', hidden: false, required: false, ...extra }) as ColumnDto;
  const deals: DashboardSourceBoard = {
    id: 'b1',
    name: 'Deals',
    kind: 'deals',
    workspaceId: 'w1',
    itemTerminology: 'Deal',
    columns: [
      column('stage', 'status', { settings: { labels: [{ id: 'won', name: 'Won', color: 'green', position: 0 }, { id: 'lost', name: 'Lost', color: 'red', position: 1 }] } as never }),
      column('owner', 'people'),
      column('deal_value', 'currency'),
      column('probability', 'number', { title: 'Close probability' }),
      column('close_date', 'date'),
    ],
    groups: [],
  };

  it('has a unique, complete definition per kind', () => {
    expect(new Set(WIDGETS.map((entry) => entry.kind)).size).toBe(WIDGETS.length);
    expect(widgetDefinition('section').chromeless).toBe(true);
    expect(searchWidgets('pipeline', 'all').map((entry) => entry.kind)).toEqual(expect.arrayContaining(['funnel', 'forecast']));
    expect(searchWidgets('', 'content').every((entry) => entry.categories.includes('content'))).toBe(true);
  });

  it('picks sensible columns for every data widget', () => {
    expect(defaultWidget('numbers', [deals]).config).toMatchObject({ valueColumnKey: 'deal_value', aggregate: 'sum', format: 'currency' });
    expect(defaultWidget('forecast', [deals]).config).toMatchObject({ probabilityColumnKey: 'probability', dateColumnKey: 'close_date', excludeLabelIds: ['lost'] });
    expect(defaultWidget('funnel', [deals]).config).toMatchObject({ groupByColumnKey: 'stage', excludeLabelIds: ['lost'] });
    expect(defaultWidget('leaderboard', [deals]).config).toMatchObject({ groupByColumnKey: 'owner', valueColumnKey: 'deal_value' });
    expect(defaultWidget('countdown', [], new Date('2026-11-05T00:00:00Z')).config).toMatchObject({ targetDate: '2026-12-31' });
    expect(defaultWidget('numbers', []).config).toMatchObject({ aggregate: 'count' });
  });
});

describe('csv export', () => {
  it('escapes values and neutralises formulas', () => {
    const insight = {
      forecast: [],
      workload: null,
      rows: [],
      stacks: [],
      series: [{ key: 'a', label: '=HYPERLINK("x")', value: 1, count: 2 }, { key: 'b', label: 'Acme, Inc', value: 3, count: 4 }],
    } as unknown as InsightDto;
    const csv = insightToCsv(insight).split('\n');
    expect(csv[0]).toBe('Label,Value,Items');
    expect(csv[1]).toBe(`"'=HYPERLINK(""x"")",1,2`);
    expect(csv[2]).toBe('"Acme, Inc",3,4');
  });
});
