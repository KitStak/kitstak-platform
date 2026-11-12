import { describe, expect, it } from 'vitest';
import {
  clampWidth,
  defaultGridPrefs,
  moveColumn,
  reconcileGridPrefs,
  togglePinned,
  visibilityMap,
  type PrefColumn,
} from '@/components/grid/grid-prefs';
import { nextSort, sortIndicator } from '@/components/grid/grid-sort';
import { clampPage, pageCountOf, pageSizeChoices } from '@/components/grid/grid-footer';
import {
  DATE_PRESET_OPTIONS,
  dateEditorToSpec,
  describeDateSpec,
  specToDateEditor,
  EMPTY_DATE_EDITOR,
} from '@/components/grid/filter-builder/date-presets';
import {
  EMPTY_OPTION_VALUE,
  describeFilterValue,
  draftToFilter,
  emptyDraft,
  filterToDraft,
  orderByPinned,
  searchFields,
  splitChips,
  toChips,
} from '@/components/grid/filter-builder/filter-model';
import { bulkDisabledReason } from '@/components/grid/bulk-actions';
import { exportQueryString } from '@/components/grid/export-button';
import { buildCsv, csvEscape } from '@/components/grid/legacy-csv';
import { findActiveView, viewIdentity } from '@/components/grid/use-grid';
import { parseSavedViews, validateViewName } from '@/components/grid/use-saved-views';
import { formatCountdown, filteredListHref } from '@/components/grid/cells';
import { pageSelectionState } from '@/components/grid/data-grid-columns';
import type { FilterFieldDef } from '@/components/grid/grid-types';
import { parseGridQuery, serializeGridQuery } from '@/server/query/grid-query';

const COLS: readonly PrefColumn[] = [
  { id: 'code', defaultVisible: true, alwaysVisible: true },
  { id: 'status', defaultVisible: true, alwaysVisible: false },
  { id: 'notes', defaultVisible: false, alwaysVisible: false },
];

describe('grid prefs', () => {
  it('builds defaults from column definitions', () => {
    const prefs = defaultGridPrefs(COLS);
    expect(prefs.visible).toEqual(['code', 'status']);
    expect(prefs.order).toEqual(['code', 'status', 'notes']);
    expect(prefs.density).toBe('Small');
    expect(prefs.pageSize).toBe(100);
  });

  it('reconciles stored prefs: drops unknown ids, appends new columns, forces always-visible', () => {
    const prefs = reconcileGridPrefs(
      {
        visible: ['status', 'gone'],
        order: ['status', 'gone', 'code'],
        widths: { status: 5000, gone: 90 },
        density: 'Large',
        pageSize: 300,
        pinned: ['status', 'gone'],
      },
      COLS,
    );
    expect(prefs.order).toEqual(['status', 'code', 'notes']);
    expect(prefs.visible).toEqual(['status', 'code']);
    expect(prefs.widths).toEqual({ status: 800 });
    expect(prefs.density).toBe('Large');
    expect(prefs.pageSize).toBe(300);
    expect(prefs.pinned).toEqual(['status']);
  });

  it('falls back to defaults for invalid payloads and odd page sizes', () => {
    expect(reconcileGridPrefs('nope', COLS)).toEqual(defaultGridPrefs(COLS));
    expect(reconcileGridPrefs(null, COLS)).toEqual(defaultGridPrefs(COLS));
    expect(reconcileGridPrefs({ pageSize: 42 }, COLS).pageSize).toBe(100);
  });

  it('keeps a column the user hid hidden, but shows brand-new default-visible ones', () => {
    const prefs = reconcileGridPrefs({ visible: ['code'], order: ['code', 'status'] }, [
      ...COLS,
      { id: 'fresh', defaultVisible: true, alwaysVisible: false },
    ]);
    expect(prefs.visible).toEqual(['code', 'fresh']);
  });

  it('moves, pins and maps visibility immutably', () => {
    const order = ['a', 'b', 'c'];
    expect(moveColumn(order, 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(moveColumn(order, 'a', null)).toEqual(['b', 'c', 'a']);
    expect(moveColumn(order, 'x', 'a')).toBe(order);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(togglePinned(['a'], 'a')).toEqual([]);
    expect(togglePinned([], 'a')).toEqual(['a']);
    expect(visibilityMap({ ...defaultGridPrefs(COLS) })).toEqual({ code: true, status: true, notes: false });
    expect(clampWidth(10)).toBe(60);
  });
});

describe('server multi-sort', () => {
  it('cycles asc → desc → off on plain click', () => {
    const a = nextSort([], 'code', false);
    expect(a).toEqual([{ field: 'code', dir: 'asc' }]);
    const b = nextSort(a, 'code', false);
    expect(b).toEqual([{ field: 'code', dir: 'desc' }]);
    expect(nextSort(b, 'code', false)).toEqual([]);
  });

  it('adds and keeps other sorts on shift-click, replacing on plain click', () => {
    const multi = nextSort([{ field: 'code', dir: 'asc' }], 'status', true);
    expect(multi).toEqual([
      { field: 'code', dir: 'asc' },
      { field: 'status', dir: 'asc' },
    ]);
    expect(nextSort(multi, 'code', true)).toEqual([
      { field: 'code', dir: 'desc' },
      { field: 'status', dir: 'asc' },
    ]);
    expect(nextSort(multi, 'status', false)).toEqual([{ field: 'status', dir: 'desc' }]);
    expect(sortIndicator(multi, 'status')).toEqual({ dir: 'asc', position: 2 });
    expect(sortIndicator([{ field: 'x', dir: 'desc' }], 'x')).toEqual({ dir: 'desc', position: null });
    expect(sortIndicator(multi, 'nope')).toBeNull();
  });

  it('round-trips through the URL grammar', () => {
    const sort = nextSort(nextSort([], 'createdAt', false), 'createdAt', false);
    expect(serializeGridQuery({ sort })).toBe('sort=-createdAt');
  });
});

describe('pager helpers', () => {
  it('computes page counts and clamps input', () => {
    expect(pageCountOf(0, 100)).toBe(1);
    expect(pageCountOf(1001, 100)).toBe(11);
    expect(clampPage(99, 5)).toBe(5);
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(Number.NaN, 5)).toBe(1);
    expect(pageSizeChoices(300)).toEqual([100, 300, 500, 700, 1000]);
    expect(pageSizeChoices(25)).toEqual([25, 100, 300, 500, 700, 1000]);
  });

  it('derives the tri-state header checkbox', () => {
    expect(pageSelectionState([], {})).toBe(false);
    expect(pageSelectionState(['a', 'b'], { a: true, b: true })).toBe(true);
    expect(pageSelectionState(['a', 'b'], { a: true })).toBe('indeterminate');
    expect(pageSelectionState(['a', 'b'], { z: true })).toBe('indeterminate');
    expect(pageSelectionState(['a'], {})).toBe(false);
  });
});

describe('date presets', () => {
  it('offers exactly 18 presets', () => {
    expect(DATE_PRESET_OPTIONS).toHaveLength(18);
    expect(DATE_PRESET_OPTIONS.filter((o) => o.needsDays)).toHaveLength(4);
  });

  it('maps editor values to grammar specs and back', () => {
    expect(dateEditorToSpec(EMPTY_DATE_EDITOR)).toBeNull();
    expect(dateEditorToSpec({ ...EMPTY_DATE_EDITOR, preset: 'last7d' })).toEqual({
      kind: 'fixed',
      preset: 'last7d',
    });
    expect(dateEditorToSpec({ ...EMPTY_DATE_EDITOR, preset: 'fri' })).toEqual({
      kind: 'weekday',
      preset: 'fri',
    });
    const rel = dateEditorToSpec({ ...EMPTY_DATE_EDITOR, preset: 'withinPast', days: 3 });
    expect(rel).toEqual({ kind: 'relative', preset: 'withinPast', days: 3 });
    expect(dateEditorToSpec({ ...EMPTY_DATE_EDITOR, preset: 'custom' })).toBeNull();
    const custom = dateEditorToSpec({ ...EMPTY_DATE_EDITOR, preset: 'custom', from: '2026/01/01 00:00' });
    expect(custom).toEqual({ kind: 'custom', from: '2026/01/01 00:00' });
    if (rel) expect(specToDateEditor(rel)).toMatchObject({ preset: 'withinPast', days: 3 });
    if (rel) expect(describeDateSpec(rel)).toBe('Within 3 Day(s) Past');
    expect(describeDateSpec({ kind: 'custom', from: 'a', to: 'b' })).toBe('a → b');
  });

  it('produces date values the grid grammar accepts', () => {
    const spec = dateEditorToSpec({
      ...EMPTY_DATE_EDITOR,
      preset: 'custom',
      from: '2026/01/01 08:00',
      to: '2026/01/31 17:30',
    });
    expect(spec).not.toBeNull();
    if (!spec) return;
    const qs = serializeGridQuery({ filters: [{ field: 'createdAt', op: 'date', date: spec }] });
    const parsed = parseGridQuery(qs);
    expect(parsed.issues).toEqual([]);
    expect(parsed.query.filters[0]).toEqual({ field: 'createdAt', op: 'date', date: spec });
  });
});

const FIELDS: readonly FilterFieldDef[] = [
  {
    field: 'status',
    label: 'Status',
    type: 'enum',
    allowEmpty: true,
    options: [
      { value: 'Open', label: 'Open' },
      { value: 'Shipped', label: 'Shipped' },
    ],
  },
  { field: 'code', label: 'Code', type: 'text' },
  { field: 'qty', label: 'Quantity', type: 'number' },
  { field: 'isKit', label: 'Is Kit', type: 'boolean' },
  { field: 'createdAt', label: 'Created', type: 'date' },
];

describe('filter model', () => {
  const [status, code, qty, isKit, created] = FIELDS as [
    FilterFieldDef,
    FilterFieldDef,
    FilterFieldDef,
    FilterFieldDef,
    FilterFieldDef,
  ];

  it('validates drafts with apply-disabled reasons', () => {
    expect(draftToFilter(status, emptyDraft(status))).toEqual({
      ok: false,
      reason: 'Select at least one value',
    });
    expect(draftToFilter(status, { type: 'enum', values: ['Open'] })).toEqual({
      ok: true,
      filter: { field: 'status', op: 'in', values: ['Open'] },
    });
    expect(draftToFilter(status, { type: 'enum', values: [EMPTY_OPTION_VALUE] })).toEqual({
      ok: true,
      filter: { field: 'status', op: 'empty' },
    });
    expect(draftToFilter(status, { type: 'enum', values: [EMPTY_OPTION_VALUE, 'Open'] }).ok).toBe(false);
    expect(draftToFilter(code, { type: 'text', op: 'sw', value: '  SO1 ' })).toEqual({
      ok: true,
      filter: { field: 'code', op: 'sw', value: 'SO1' },
    });
    expect(draftToFilter(code, { type: 'text', op: 'ct', value: '' }).ok).toBe(false);
    expect(draftToFilter(code, { type: 'text', op: 'empty', value: '' })).toEqual({
      ok: true,
      filter: { field: 'code', op: 'empty' },
    });
    expect(draftToFilter(qty, { type: 'number', min: 5, max: 1 })).toEqual({
      ok: false,
      reason: 'Min must not exceed Max',
    });
    expect(draftToFilter(qty, { type: 'number', min: 5, max: null })).toEqual({
      ok: true,
      filter: { field: 'qty', op: 'rng', min: '5' },
    });
    expect(draftToFilter(isKit, { type: 'boolean', value: null }).ok).toBe(false);
    expect(draftToFilter(isKit, { type: 'boolean', value: false })).toEqual({
      ok: true,
      filter: { field: 'isKit', op: 'bool', value: false },
    });
    expect(draftToFilter(created, emptyDraft(created))).toEqual({
      ok: false,
      reason: 'Choose a date option',
    });
  });

  it('restores drafts from applied filters', () => {
    expect(filterToDraft(status, { field: 'status', op: 'in', values: ['Open'] })).toEqual({
      type: 'enum',
      values: ['Open'],
    });
    expect(filterToDraft(qty, { field: 'qty', op: 'rng', min: '1', max: '9' })).toEqual({
      type: 'number',
      min: 1,
      max: 9,
    });
    expect(filterToDraft(code, { field: 'code', op: 'bool', value: true })).toEqual(emptyDraft(code));
    expect(filterToDraft(code, undefined)).toEqual({ type: 'text', op: 'ct', value: '' });
  });

  it('describes chips and splits overflow', () => {
    const chips = toChips(
      [
        { field: 'status', op: 'in', values: ['Open', 'Shipped'] },
        { field: 'qty', op: 'rng', max: '10' },
        { field: 'unknown', op: 'ex' },
      ],
      FIELDS,
    );
    expect(chips.map((c) => [c.label, c.value])).toEqual([
      ['Status', 'Open, Shipped'],
      ['Quantity', '≤ 10'],
      ['unknown', 'Is Not Empty'],
    ]);
    expect(describeFilterValue({ field: 'isKit', op: 'bool', value: true })).toBe('Yes');
    expect(describeFilterValue({ field: 'c', op: 'sw', value: 'SO' })).toBe('Starts With "SO"');
    const { visible, overflow } = splitChips(chips, 2);
    expect(visible).toHaveLength(2);
    expect(overflow).toHaveLength(1);
  });

  it('searches fields and orders pinned favourites first', () => {
    expect(searchFields(FIELDS, 'qua').map((f) => f.field)).toEqual(['qty']);
    expect(orderByPinned(FIELDS, ['createdAt']).map((f) => f.field)[0]).toBe('createdAt');
  });
});

describe('toolbar helpers', () => {
  it('explains disabled bulk actions', () => {
    const action = { key: 'ship', label: 'Ship', onSelect: () => undefined };
    expect(bulkDisabledReason(action, 0, 'order')).toBe('Select at least one order');
    expect(bulkDisabledReason(action, 0)).toBe('Select at least one record');
    expect(bulkDisabledReason({ ...action, disabledReason: 'Only Open orders' }, 2)).toBe('Only Open orders');
    expect(bulkDisabledReason(action, 2)).toBeNull();
  });

  it('strips paging from export queries and view identity', () => {
    expect(exportQueryString('q=SO&page=3&ps=300&sort=-code')).toBe('q=SO&sort=-code');
    expect(viewIdentity('sort=code&page=2&q=a')).toBe(viewIdentity('q=a&sort=code'));
    const views = parseSavedViews([
      { id: '1', gridKey: 'g', name: 'Open', query: 'f.status=in%3AOpen' },
      { bad: true },
    ]);
    expect(views).toEqual([]);
    const ok = parseSavedViews([{ id: '1', gridKey: 'g', name: 'Open', query: 'f.status=in:Open' }]);
    expect(findActiveView(ok, 'f.status=in%3AOpen&page=4')?.id).toBe('1');
  });

  it('validates saved view names', () => {
    const existing = parseSavedViews([{ id: '1', gridKey: 'g', name: 'Open orders', query: '' }]);
    expect(validateViewName('  ', existing)).toBe('Enter a view name');
    expect(validateViewName('open ORDERS', existing)).toBe('A view with this name already exists');
    expect(validateViewName('open orders', existing, '1')).toBeNull();
    expect(validateViewName('x'.repeat(61), existing)).toMatch(/At most/);
  });

  it('escapes CSV and reads nested accessor keys', () => {
    expect(csvEscape('a,"b"')).toBe('"a,""b"""');
    expect(csvEscape(null)).toBe('');
    const csv = buildCsv(
      [{ code: 'SO1', client: { name: 'Acme, Inc' } }],
      [
        { accessorKey: 'code', header: 'Code' },
        { accessorKey: 'client.name', header: 'Client' },
        { id: 'x', header: () => null },
      ],
    );
    expect(csv).toBe('Code,Client\nSO1,"Acme, Inc"');
  });

  it('formats countdowns and filtered deep links', () => {
    expect(formatCountdown(2 * 86_400_000 + 4 * 3_600_000)).toBe('2d 4h');
    expect(formatCountdown(-45 * 60_000)).toBe('45m overdue');
    expect(formatCountdown(3 * 3_600_000 + 12 * 60_000)).toBe('3h 12m');
    expect(filteredListHref('/orders', [{ field: 'sku', op: 'in', values: ['A,B'] }])).toBe(
      '/orders?f.sku=in%3AA%5C%2CB',
    );
    expect(filteredListHref('/orders', [])).toBe('/orders');
  });
});
