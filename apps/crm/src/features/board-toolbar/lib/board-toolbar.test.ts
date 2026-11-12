import { describe, expect, it } from 'vitest';
import type { ColumnDto, ItemDto, UserSummaryDto, ViewDto } from '@/server/services/contracts/dto';
import {
  activeFilterCount,
  applyOverlay,
  configPatch,
  dirtyKeys,
  draftFromConfig,
  layoutPatch,
  overlayOf,
  parseGroupBy,
  stableStringify,
} from './draft';
import { decodeOverlay, encodeOverlay, patchBoardSearch, readBoardUrl } from './url-state';
import {
  buildFacets,
  coerceValue,
  defaultOperator,
  isFacetSelected,
  isRuleComplete,
  operatorsFor,
  ruleSummary,
  valueKind,
} from './filter-model';
import { bucketItems, dateBucket, isGroupable } from './group-by';
import { placementForMove, resolveActiveView, uniqueViewName } from './view-order';

const VIEW_ID = '057bced4-5d4a-4faf-8c1c-321fdcb8eb6b';

function column(partial: Partial<ColumnDto> & Pick<ColumnDto, 'key' | 'type'>): ColumnDto {
  return {
    id: `col-${partial.key}`,
    boardId: 'b',
    title: partial.key,
    description: null,
    scope: 'item',
    settings: {},
    width: 140,
    position: 'a',
    hidden: false,
    required: false,
    ...partial,
  } as ColumnDto;
}

const stage = column({
  key: 'stage',
  type: 'status',
  title: 'Stage',
  settings: {
    labels: [
      { id: 'won', name: 'Won', color: 'green', position: 0 },
      { id: 'lost', name: 'Lost', color: 'gray', position: 1 },
      { id: 'blank', name: '', color: 'gray', position: 2, isDefault: true },
    ],
  } as never,
});
const owner = column({ key: 'owner', type: 'people', title: 'Owner' });
const close = column({ key: 'close', type: 'date', title: 'Close' });
const value = column({ key: 'value', type: 'number', title: 'Value' });
const name = column({ key: 'name', type: 'name', title: 'Deal' });
const columns = [name, stage, owner, close, value];

const users: UserSummaryDto[] = [
  { id: 'u1', name: 'Ada', email: 'a@x', image: null, title: null },
  { id: 'u2', name: 'Bo', email: 'b@x', image: null, title: null },
];

function item(id: string, values: Record<string, unknown>): ItemDto {
  return {
    id,
    boardId: 'b',
    groupId: 'g',
    parentItemId: null,
    name: `Item ${id}`,
    position: id,
    values,
    computed: {},
    subitemCount: 0,
    updateCount: 0,
    createdBy: null,
    updatedBy: null,
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-03-04T00:00:00Z',
    archivedAt: null,
    deletedAt: null,
  } as ItemDto;
}

const items = [
  item('a', { stage: { labelId: 'won' }, owner: { ids: ['u1'] }, close: { date: '2026-11-03' }, value: 10 }),
  item('b', { stage: { labelId: 'lost' }, owner: { ids: ['u1', 'u2'] }, close: { date: '2026-12-20' } }),
  item('c', { stage: { labelId: 'blank' } }),
];

describe('draft', () => {
  it('parses a saved config and finds no dirty keys against itself', () => {
    const saved = draftFromConfig({ sort: [{ columnKey: 'close', direction: 'desc' }], groupBy: 'stage' });
    expect(saved.groupBy).toEqual({ columnKey: 'stage' });
    expect(dirtyKeys(saved, saved)).toEqual([]);
  });

  it('treats hidden columns as a set and reports changed keys', () => {
    const saved = draftFromConfig({ hiddenColumnKeys: ['a', 'b'] });
    const working = { ...saved, hiddenColumnKeys: ['b', 'a'], personFilter: 'u1' };
    expect(dirtyKeys(working, saved)).toEqual(['personFilter']);
    expect(overlayOf(working, saved)).toEqual({ personFilter: 'u1' });
    expect(applyOverlay(saved, { personFilter: 'u1' }).personFilter).toBe('u1');
  });

  it('builds a save patch including the group-by bucket', () => {
    const saved = draftFromConfig({});
    const working = { ...saved, groupBy: { columnKey: 'close', bucket: 'quarter' as const } };
    expect(configPatch(working, dirtyKeys(working, saved))).toEqual({ groupBy: 'close', groupByBucket: 'quarter' });
    expect(configPatch(saved, ['groupBy'])).toEqual({ groupBy: null, groupByBucket: null });
  });

  it('ignores invalid group-by values', () => {
    expect(parseGroupBy({ groupBy: 'none' })).toBeNull();
    expect(parseGroupBy({ groupBy: 'close', groupByBucket: 'decade' })).toEqual({ columnKey: 'close' });
  });

  it('counts active filters', () => {
    expect(activeFilterCount({ filters: { conjunction: 'and', rules: [{ columnKey: 'x', operator: 'is_empty' }] }, personFilter: 'u' })).toBe(2);
  });

  it('computes auto-saved layout patches against column defaults', () => {
    const base = { columnWidths: {}, density: 'default' as const, collapsedColumnKeys: [] as string[] };
    expect(layoutPatch({ ...base, columnWidths: { stage: 140 } }, base, { stage: 140 })).toBeNull();
    expect(layoutPatch({ ...base, columnWidths: { stage: 200 }, density: 'compact' }, base, { stage: 140 })).toEqual({
      columnWidths: { stage: 200 },
      density: 'compact',
    });
  });

  it('stable stringify ignores key order and undefined', () => {
    expect(stableStringify({ b: 1, a: [1, { d: undefined, c: 2 }] })).toBe('{"a":[1,{"c":2}],"b":1}');
  });
});

describe('url state', () => {
  it('round-trips an overlay (unicode safe)', () => {
    const overlay = { filters: { conjunction: 'or' as const, rules: [{ columnKey: 'name', operator: 'contains' as const, value: 'Café ✓' }] } };
    const encoded = encodeOverlay(overlay);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(decodeOverlay(encoded)).toEqual(overlay);
    expect(encodeOverlay({})).toBeNull();
  });

  it('rejects malformed overlays', () => {
    expect(decodeOverlay('%%%')).toBeNull();
    expect(decodeOverlay(encodeOverlay({ sort: [{ columnKey: 'x', direction: 'up' }] } as never))).toBeNull();
    expect(decodeOverlay('a'.repeat(7000))).toBeNull();
  });

  it('reads and patches the query string without touching other params', () => {
    const next = patchBoardSearch('item=abc&q=old', { viewId: VIEW_ID, search: '', overlay: { personFilter: 'u1' } });
    const params = new URLSearchParams(next);
    expect(params.get('item')).toBe('abc');
    expect(params.has('q')).toBe(false);
    const state = readBoardUrl(params);
    expect(state.viewId).toBe(VIEW_ID);
    expect(state.overlay).toEqual({ personFilter: 'u1' });
    expect(readBoardUrl(new URLSearchParams('view=not-a-uuid')).viewId).toBeNull();
    expect(patchBoardSearch('', { overlay: null })).toBe('');
  });
});

describe('filter model', () => {
  it('offers type-matched operators and value editors', () => {
    expect(operatorsFor(stage).map((op) => op.value)).toEqual(['any_of', 'none_of', 'is_empty', 'is_not_empty']);
    expect(defaultOperator(value)).toBe('eq');
    expect(valueKind(close, 'between')).toBe('date-range');
    expect(valueKind(name, 'contains')).toBe('text');
    expect(valueKind(stage, 'is_empty')).toBe('none');
    expect(coerceValue(stage, 'any_of', 'x')).toEqual([]);
    expect(coerceValue(close, 'between', undefined)).toEqual(['', '']);
  });

  it('knows when a rule is complete', () => {
    expect(isRuleComplete({ columnKey: 'stage', operator: 'any_of', value: [] }, stage)).toBe(false);
    expect(isRuleComplete({ columnKey: 'stage', operator: 'is_empty' }, stage)).toBe(true);
    expect(isRuleComplete({ columnKey: 'value', operator: 'gt', value: '5' }, value)).toBe(true);
    expect(isRuleComplete({ columnKey: 'x', operator: 'gt', value: '5' }, undefined)).toBe(false);
  });

  it('builds faceted counts that ignore the facet column own rule', () => {
    const filters = { conjunction: 'and' as const, rules: [{ columnKey: 'stage', operator: 'any_of' as const, value: ['won'] }] };
    const facets = buildFacets(items, { columns, users, search: '', personFilter: null, filters });
    const stageFacet = facets.find((facet) => facet.column.key === 'stage');
    expect(stageFacet?.values.map((entry) => [entry.id, entry.count])).toEqual([
      ['won', 1],
      ['lost', 1],
      [null, 1],
    ]);
    const ownerFacet = facets.find((facet) => facet.column.key === 'owner');
    expect(ownerFacet?.values.map((entry) => [entry.id, entry.count])).toEqual([['u1', 1]]);
    expect(isFacetSelected(filters, 'stage', 'won')).toBe(true);
    expect(isFacetSelected(filters, 'stage', null)).toBe(false);
  });

  it('summarizes rules for chips', () => {
    expect(ruleSummary({ columnKey: 'stage', operator: 'any_of', value: ['won', 'lost'] }, stage, users)).toBe('Stage is Won, Lost');
    expect(ruleSummary({ columnKey: 'owner', operator: 'none_of', value: ['u1'] }, owner, users)).toBe('Owner is not Ada');
    expect(ruleSummary({ columnKey: 'value', operator: 'gt', value: 5 }, value, users)).toBe('Value greater than 5');
    expect(ruleSummary({ columnKey: 'close', operator: 'is_empty' }, close, users)).toBe('Close is empty');
  });
});

describe('group by', () => {
  it('groups by status in label order with an empty bucket last', () => {
    const buckets = bucketItems(items, stage, {}, users);
    expect(buckets.map((bucket) => [bucket.title, bucket.items.length])).toEqual([
      ['Won', 1],
      ['Lost', 1],
      ['No value', 1],
    ]);
  });

  it('puts multi-person items in each person bucket', () => {
    const buckets = bucketItems(items, owner, {}, users);
    expect(buckets.map((bucket) => [bucket.title, bucket.items.map((entry) => entry.id)])).toEqual([
      ['Ada', ['a', 'b']],
      ['Bo', ['b']],
      ['Unassigned', ['c']],
    ]);
  });

  it('buckets dates by month / quarter / week chronologically', () => {
    expect(bucketItems(items, close, { bucket: 'month' }, users).map((bucket) => bucket.title)).toEqual([
      'Nov 2026',
      'Dec 2026',
      'No date',
    ]);
    expect(dateBucket('2026-11-03', 'quarter')).toEqual({ key: '2026-Q4', title: 'Q4 2026' });
    expect(dateBucket('2026-11-05', 'week').title).toBe('Week of Nov 2, 2026');
    expect(isGroupable(stage)).toBe(true);
    expect(isGroupable(value)).toBe(false);
  });
});

describe('view order', () => {
  const views = ['a', 'b', 'c'].map((id, index) => ({
    id,
    boardId: 'x',
    type: index === 1 ? 'table' : 'kanban',
    name: id.toUpperCase(),
    config: {},
    position: `a${index}`,
    isDefault: false,
    ownerId: null,
  })) as ViewDto[];

  it('computes placements for drag reorder', () => {
    expect(placementForMove(views, 0, 2)).toEqual({ afterId: 'c' });
    expect(placementForMove(views, 2, 0)).toEqual({ beforeId: 'a' });
    expect(placementForMove(views, 1, 1)).toBeNull();
  });

  it('resolves the active view', () => {
    expect(resolveActiveView(views, 'c')?.id).toBe('c');
    expect(resolveActiveView(views, null)?.id).toBe('b');
    expect(resolveActiveView([], null)).toBeNull();
  });

  it('dedupes view names', () => {
    expect(uniqueViewName('A', views)).toBe('A 2');
    expect(uniqueViewName('Chart', views)).toBe('Chart');
  });
});
