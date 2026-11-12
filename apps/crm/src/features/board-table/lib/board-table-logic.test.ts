import { describe, expect, it } from 'vitest';
import type { ColumnDto, GroupDto, ItemDto } from '@/server/services/contracts/dto';
import { cellText, csvField, sortKey, toCsv } from './cell-text';
import { autoFitWidth, computeLayout } from './columns';
import { filterItems, itemsByGroup, sortItems } from './filter-sort';
import { chainPositions, dropIndex, placementAt, rangeIds, selectionState, toggleMany } from './ordering';
import { buildRowModel, rowOffsets, stickyGroupAt, LAYOUT } from './rows';
import { DEFAULT_VIEW_STATE, hasActiveFilters, parseViewConfig, toggleLabelFilter } from './view-state';

function column(partial: Partial<ColumnDto> & Pick<ColumnDto, 'key' | 'type'>): ColumnDto {
  return {
    id: `c-${partial.key}`,
    boardId: 'b',
    title: partial.key,
    description: null,
    scope: 'item',
    settings: {} as ColumnDto['settings'],
    width: 140,
    position: partial.key,
    hidden: false,
    required: false,
    ...partial,
  };
}

function item(id: string, partial: Partial<ItemDto> = {}): ItemDto {
  return {
    id,
    boardId: 'b',
    groupId: 'g1',
    parentItemId: null,
    name: id,
    position: id,
    values: {},
    computed: {},
    subitemCount: 0,
    updateCount: 0,
    createdBy: null,
    updatedBy: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    archivedAt: null,
    deletedAt: null,
    ...partial,
  };
}

const STATUS = column({
  key: 'stage',
  type: 'status',
  settings: {
    labels: [
      { id: 'won', name: 'Won', color: 'green', position: 1, isDone: true },
      { id: 'lead', name: 'Lead', color: 'orange', position: 0 },
      { id: 'blank', name: '', color: 'gray', position: 2, isDefault: true },
    ],
  } as ColumnDto['settings'],
});
const AMOUNT = column({
  key: 'amount',
  type: 'number',
  settings: { unit: '$', unitPosition: 'prefix', decimals: 0 } as ColumnDto['settings'],
});
const OWNER = column({ key: 'owner', type: 'people' });
const NAME = column({ key: 'name', type: 'name', width: 300, position: '0' });
const COLUMNS = [NAME, STATUS, AMOUNT, OWNER];
const USERS = new Map([['u1', { id: 'u1', name: 'Maya Chen' }]]);

const ITEMS = [
  item('a', { name: 'Acme', values: { stage: { labelId: 'won' }, amount: 500, owner: { ids: ['u1'] } } }),
  item('b', { name: 'Globex', values: { stage: { labelId: 'lead' }, amount: 1500 } }),
  item('c', { name: 'Initech', values: {} }),
];

describe('view state', () => {
  it('parses malformed configs into safe defaults', () => {
    expect(parseViewConfig(null)).toEqual(DEFAULT_VIEW_STATE);
    const state = parseViewConfig({
      sort: [{ columnKey: 'x', direction: 'desc' }, 'junk'],
      density: 'compact',
      columnWidths: { x: 9999 },
    });
    expect(state.sort).toEqual([{ columnKey: 'x', direction: 'desc' }]);
    expect(state.density).toBe('compact');
    expect(state.columnWidths.x).toBe(1200);
  });

  it('toggles battery quick filters on and off', () => {
    const on = toggleLabelFilter(DEFAULT_VIEW_STATE.filters, 'stage', 'won');
    expect(on.rules).toEqual([{ columnKey: 'stage', operator: 'any_of', value: ['won'] }]);
    expect(toggleLabelFilter(on, 'stage', 'won').rules).toEqual([]);
    expect(hasActiveFilters({ ...DEFAULT_VIEW_STATE, filters: on })).toBe(true);
  });
});

describe('cell text and sort keys', () => {
  it('renders readable text per type', () => {
    expect(cellText(STATUS, ITEMS[0] as ItemDto)).toBe('Won');
    expect(cellText(AMOUNT, ITEMS[1] as ItemDto)).toBe('$1,500');
    expect(cellText(OWNER, ITEMS[0] as ItemDto, USERS)).toBe('Maya Chen');
    expect(sortKey(STATUS, ITEMS[2] as ItemDto)).toBeNull();
  });

  it('escapes CSV and neutralises formulas', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(toCsv([NAME, STATUS], [ITEMS[0] as ItemDto], USERS).split('\r\n')).toEqual([
      'name,stage',
      'Acme,Won',
    ]);
  });
});

describe('filter and sort', () => {
  const ctx = { columns: COLUMNS, users: USERS };

  it('searches names and cell text', () => {
    expect(
      filterItems(ITEMS, { ...DEFAULT_VIEW_STATE, search: 'maya' }, ctx).map((entry) => entry.id),
    ).toEqual(['a']);
    expect(
      filterItems(ITEMS, { ...DEFAULT_VIEW_STATE, search: 'glob' }, ctx).map((entry) => entry.id),
    ).toEqual(['b']);
  });

  it('applies label, numeric, empty and person rules', () => {
    const rule = (r: object) => ({
      ...DEFAULT_VIEW_STATE,
      filters: { conjunction: 'and' as const, rules: [r as never] },
    });
    expect(
      filterItems(ITEMS, rule({ columnKey: 'stage', operator: 'any_of', value: ['lead'] }), ctx).map(
        (e) => e.id,
      ),
    ).toEqual(['b']);
    expect(
      filterItems(ITEMS, rule({ columnKey: 'amount', operator: 'gt', value: 600 }), ctx).map((e) => e.id),
    ).toEqual(['b']);
    expect(
      filterItems(ITEMS, rule({ columnKey: 'stage', operator: 'is_empty' }), ctx).map((e) => e.id),
    ).toEqual(['c']);
    expect(filterItems(ITEMS, { ...DEFAULT_VIEW_STATE, personFilter: 'u1' }, ctx).map((e) => e.id)).toEqual([
      'a',
    ]);
  });

  it('sorts with empties last in both directions', () => {
    const asc = sortItems(ITEMS, { sort: [{ columnKey: 'amount', direction: 'asc' }] }, ctx).map((e) => e.id);
    const desc = sortItems(ITEMS, { sort: [{ columnKey: 'amount', direction: 'desc' }] }, ctx).map(
      (e) => e.id,
    );
    expect(asc).toEqual(['a', 'b', 'c']);
    expect(desc).toEqual(['b', 'a', 'c']);
  });

  it('buckets by group in manual order', () => {
    const buckets = itemsByGroup(
      [item('z', { groupId: 'g2' }), ...ITEMS],
      ['g1', 'g2'],
      DEFAULT_VIEW_STATE,
      ctx,
    );
    expect(buckets.get('g1')?.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(buckets.get('g2')?.map((e) => e.id)).toEqual(['z']);
  });
});

describe('ordering', () => {
  const siblings = [
    { id: 'a', position: 'a0' },
    { id: 'b', position: 'a1' },
    { id: 'c', position: 'a2' },
  ];

  it('places between neighbours and detects no-op drops', () => {
    const moving = new Set(['c']);
    const placement = placementAt(siblings, moving, dropIndex(siblings, moving, 'a', 'after'));
    expect(placement?.afterId).toBe('a');
    expect(placement && placement.position > 'a0' && placement.position < 'a1').toBe(true);
    expect(
      placementAt(siblings, new Set(['b']), dropIndex(siblings, new Set(['b']), 'a', 'after')),
    ).toBeNull();
    expect(placementAt(siblings, moving, 0)?.beforeId).toBe('a');
  });

  it('chains positions for multi-row drops', () => {
    const chain = chainPositions({ position: 'a0V' }, 3, 'a1');
    expect(chain).toHaveLength(3);
    expect([...chain].sort()).toEqual(chain);
    expect(chain.every((pos) => pos < 'a1')).toBe(true);
  });

  it('selects ranges and toggles blocks', () => {
    expect(rangeIds(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(rangeIds(['a', 'b'], null, 'b')).toEqual(['b']);
    expect([...toggleMany(new Set(['a']), ['a', 'b'])]).toEqual(['a', 'b']);
    expect([...toggleMany(new Set(['a', 'b']), ['a', 'b'])]).toEqual([]);
    expect(selectionState(new Set(['a']), ['a', 'b'])).toBe('indeterminate');
  });
});

describe('row model', () => {
  const groups: GroupDto[] = [
    {
      id: 'g1',
      boardId: 'b',
      title: 'Open',
      color: 'green',
      position: 'a0',
      collapsedDefault: false,
      archivedAt: null,
    },
    {
      id: 'g2',
      boardId: 'b',
      title: 'Closed',
      color: 'gray',
      position: 'a1',
      collapsedDefault: false,
      archivedAt: null,
    },
  ];
  const base = {
    groups,
    itemsByGroup: new Map([
      ['g1', ITEMS],
      ['g2', []],
    ]),
    collapsedGroupIds: new Set<string>(),
    expandedItemIds: new Set<string>(),
    subitems: new Map(),
    density: 'default' as const,
  };

  it('emits header, items, add and footer rows per group', () => {
    const model = buildRowModel(base);
    const kinds = model.rows.map((row) => row.kind);
    expect(kinds.slice(0, 8)).toEqual([
      'gap',
      'group-header',
      'column-header',
      'item',
      'item',
      'item',
      'add-item',
      'footer',
    ]);
    expect(model.ranges).toHaveLength(2);
  });

  it('collapses groups, expands subitems and hides empty groups when filtering', () => {
    const model = buildRowModel({
      ...base,
      collapsedGroupIds: new Set(['g2']),
      expandedItemIds: new Set(['a']),
      subitems: new Map([['a', [item('s1', { parentItemId: 'a' })]]]),
    });
    expect(model.rows.some((row) => row.kind === 'subitem')).toBe(true);
    expect(model.rows.find((row) => row.kind === 'collapsed')?.groupId).toBe('g2');
    expect(buildRowModel({ ...base, hideEmptyGroups: true }).ranges.map((range) => range.groupId)).toEqual([
      'g1',
    ]);
  });

  it('pins the group whose rows span the scroll offset', () => {
    const model = buildRowModel(base);
    const offsets = rowOffsets(model.rows);
    expect(stickyGroupAt(model, offsets, 0, 80)).toBeNull();
    const pinned = stickyGroupAt(model, offsets, LAYOUT.gapFirst + 50, 80);
    expect(pinned?.groupId).toBe('g1');
    expect(pinned?.push).toBe(0);
  });
});

describe('column layout', () => {
  it('orders, hides and collapses columns', () => {
    const layout = computeLayout(COLUMNS, {
      columnWidths: { amount: 200 },
      hiddenColumnKeys: ['owner'],
      collapsedColumnKeys: ['stage'],
    });
    expect(layout.columns.map((entry) => entry.column.key)).toEqual(['amount', 'stage']);
    expect(layout.columns[1]?.width).toBe(32);
    expect(layout.columns[0]?.width).toBe(200);
    // Stored name defaults below the registry default (360) are floored so names stay readable.
    expect(layout.nameWidth).toBe(360);
  });

  it('keeps an explicit view width for the name column (above the 280px floor)', () => {
    const layout = computeLayout(COLUMNS, {
      columnWidths: { name: 290 },
      hiddenColumnKeys: [],
      collapsedColumnKeys: [],
    });
    expect(layout.nameWidth).toBe(290);
    const clamped = computeLayout(COLUMNS, {
      columnWidths: { name: 120 },
      hiddenColumnKeys: [],
      collapsedColumnKeys: [],
    });
    expect(clamped.nameWidth).toBe(280);
  });

  it('auto-fits to content', () => {
    expect(autoFitWidth(AMOUNT, ITEMS, USERS)).toBeGreaterThanOrEqual(60);
    expect(autoFitWidth(STATUS, ITEMS, USERS)).toBeGreaterThan(60);
  });
});

describe('paste parsing and terminology', () => {
  it('parses simple types and rejects the rest', async () => {
    const { parsePaste } = await import('./paste');
    expect(parsePaste(column({ key: 'n', type: 'number' }), '$1,250\n')).toEqual({ ok: true, value: 1250 });
    expect(parsePaste(column({ key: 'n', type: 'number' }), 'abc')).toEqual({ ok: false });
    expect(parsePaste(column({ key: 'e', type: 'email' }), 'a@b.co')).toEqual({
      ok: true,
      value: { email: 'a@b.co' },
    });
    expect(parsePaste(column({ key: 's', type: 'status' }), 'Done')).toEqual({ ok: false });
  });

  it('pluralizes terminology', async () => {
    const { countLabel, pluralize } = await import('./terminology');
    expect(pluralize('Opportunity')).toBe('Opportunities');
    expect(pluralize('Deal')).toBe('Deals');
    expect(countLabel(1, 'Deal')).toBe('1 Deal');
    expect(countLabel(1200, 'deal')).toBe('1,200 deals');
  });
});

describe('realtime flash detection', () => {
  it('flags remote cell changes, skips local ones and bulk reloads', async () => {
    const { remoteChanges, ROW_FLASH } = await import('../hooks/use-remote-flash');
    const before = item('a', { values: { amount: 1 }, updatedAt: '1' });
    const after = item('a', { values: { amount: 2 }, updatedAt: '2' });
    const prev = new Map([['a', before]]);
    expect([...remoteChanges(prev, [after], () => false)]).toEqual([['a', ['amount']]]);
    expect(remoteChanges(prev, [after], () => true).size).toBe(0);
    expect(remoteChanges(prev, [before, item('new')], () => false).get('new')).toEqual([ROW_FLASH]);
    const bulk = Array.from({ length: 60 }, (_, index) => item(`n${index}`));
    expect(remoteChanges(prev, [before, ...bulk], () => false).size).toBe(0);
  });
});
