import { describe, expect, it } from 'vitest';
import type { ColumnDto, GroupDto, ItemDto, UserSummaryDto } from '@/server/services/contracts/dto';
import {
  answersToValues,
  formClosedReason,
  guardViewConfigWrite,
  isQuestionVisible,
  looksAutomated,
  parseFormSettings,
  pickUniqueForm,
  stripServerFormKeys,
  safeRedirect,
  toPublicForm,
} from '@/server/services/board-views-form-model';
import { issueRenderStamp, verifyRenderStamp } from '@/server/services/board-views-form-stamp';
import { collectEvents, eventsOnDay, layoutWeek, overflowByDay, shiftRange, timeOf } from './calendar';
import { buildChartData, toPercent } from './chart';
import { calendarSettings, chartSettings, kanbanSettings, timelineSettings } from './config';
import { addDays, addMonths, dateBucket, diffDays, formatSpan, monthMatrix, startOfWeek, weekDays } from './dates';
import { filterFiles, fileKind, formatBytes } from './files';
import { applyViewFilters } from './filter';
import { applyCardMove, buildLanes, EMPTY_LANE, groupIntoLanes, laneCellValue, laneTotals, moveInOrder, shiftLane } from './kanban';
import { buildTicks, computeRange, dragRange, fitZoom } from './timeline';
import { dateRangeOf, formatCompact, numericValue, pluralNoun, rescheduledValue } from './values';

const col = (key: string, type: ColumnDto['type'], settings: Record<string, unknown> = {}, title = key): ColumnDto => ({
  id: `c-${key}`,
  boardId: 'b',
  key,
  title,
  description: null,
  type,
  scope: 'item',
  settings: settings as ColumnDto['settings'],
  width: 160,
  position: key,
  hidden: false,
  required: false,
});

const STAGE = col('stage', 'status', {
  labels: [
    { id: 'lead', name: 'Lead', color: 'sky', position: 0 },
    { id: 'won', name: 'Won', color: 'green', position: 1, isDone: true },
    { id: 'default', name: '', color: 'gray', position: 2, isDefault: true },
  ],
});
const COLUMNS = [
  col('name', 'name'),
  STAGE,
  col('owner', 'people'),
  col('value', 'currency', { currency: 'USD' }),
  col('probability', 'number', { unit: '%' }, 'Close probability'),
  col('close', 'date'),
  col('timeline', 'timeline'),
];
const GROUPS: GroupDto[] = [
  { id: 'g1', boardId: 'b', title: 'Q1', color: 'blue', position: 'a', collapsedDefault: false, archivedAt: null },
  { id: 'g2', boardId: 'b', title: 'Q2', color: 'purple', position: 'b', collapsedDefault: false, archivedAt: null },
];
const USERS: UserSummaryDto[] = [{ id: 'u1', name: 'Maya', email: 'm@x', image: null, title: null }];

function item(id: string, values: Record<string, unknown>, extra: Partial<ItemDto> = {}): ItemDto {
  return {
    id,
    boardId: 'b',
    groupId: 'g1',
    parentItemId: null,
    name: `Item ${id}`,
    position: id,
    values: values as ItemDto['values'],
    computed: {},
    subitemCount: 0,
    updateCount: 0,
    createdBy: null,
    updatedBy: null,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    archivedAt: null,
    deletedAt: null,
    ...extra,
  };
}

const ITEMS = [
  item('a', { stage: { labelId: 'lead' }, value: { amount: 1000, currency: 'USD' }, probability: 50, owner: { ids: ['u1'] }, close: { date: '2026-11-03' } }),
  item('b', { stage: { labelId: 'won' }, value: { amount: 3000, currency: 'USD' }, probability: 100, timeline: { from: '2026-11-02', to: '2026-11-10' } }),
  item('c', { value: { amount: 500, currency: 'USD' } }, { groupId: 'g2' }),
];

describe('dates', () => {
  it('does UTC-safe calendar math', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(diffDays('2026-11-01', '2026-11-08')).toBe(7);
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(startOfWeek('2026-11-05', 1)).toBe('2026-11-02');
    expect(startOfWeek('2026-11-05', 0)).toBe('2026-11-01');
  });
  it('builds full month matrices and week days', () => {
    const weeks = monthMatrix('2026-11-15', 0);
    expect(weeks[0]?.[0]).toBe('2026-11-01');
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks.flat()).toContain('2026-11-30');
    expect(weekDays('2026-11-05', 1)).toHaveLength(7);
  });
  it('formats spans and buckets', () => {
    expect(formatSpan('2026-11-12', '2026-11-19')).toBe('Nov 12 → Nov 19 (8d)');
    expect(dateBucket('2026-05-20', 'quarter')).toEqual({ key: '2026-Q2', label: 'Q2 2026' });
    expect(dateBucket('2026-05-20', 'month').key).toBe('2026-05');
  });
});

describe('values', () => {
  it('reads numbers and date ranges from every shape', () => {
    expect(numericValue({ amount: 5, currency: 'USD' })).toBe(5);
    expect(numericValue({ result: 7 })).toBe(7);
    expect(numericValue('x')).toBeNull();
    expect(dateRangeOf({ date: '2026-01-02', time: '09:00' })).toEqual({ start: '2026-01-02', end: '2026-01-02', time: '09:00' });
    expect(dateRangeOf({ from: '2026-01-05', to: '2026-01-02' })).toEqual({ start: '2026-01-02', end: '2026-01-05' });
  });
  it('writes rescheduled values per column type, keeping time', () => {
    expect(rescheduledValue(col('d', 'date'), { date: '2026-01-01', time: '10:00' }, '2026-02-02', '2026-02-02')).toEqual({ date: '2026-02-02', time: '10:00' });
    expect(rescheduledValue(col('t', 'timeline'), null, '2026-02-02', '2026-02-01')).toEqual({ from: '2026-02-02', to: '2026-02-02' });
  });
  it('formats compact money and plural nouns', () => {
    expect(formatCompact(1_200_000, 'USD')).toBe('$1.2M');
    expect(pluralNoun('Deal', 2)).toBe('deals');
    expect(pluralNoun('Activity', 3)).toBe('activities');
    expect(pluralNoun('Deal', 1)).toBe('deal');
  });
});

describe('filters', () => {
  it('applies saved rules, search and person filter', () => {
    expect(applyViewFilters(ITEMS, COLUMNS, { filters: { rules: [{ columnKey: 'stage', operator: 'none_of', value: ['won'] }] } }).map((entry) => entry.id)).toEqual(['a', 'c']);
    expect(applyViewFilters(ITEMS, COLUMNS, { filters: { rules: [{ columnKey: 'value', operator: 'gte', value: 1000 }] } })).toHaveLength(2);
    expect(applyViewFilters(ITEMS, COLUMNS, { personFilter: 'u1' }).map((entry) => entry.id)).toEqual(['a']);
    expect(applyViewFilters(ITEMS, COLUMNS, { search: 'item b' }).map((entry) => entry.id)).toEqual(['b']);
    expect(applyViewFilters(ITEMS, COLUMNS, { filters: { conjunction: 'or', rules: [{ columnKey: 'stage', operator: 'is', value: 'won' }, { columnKey: 'stage', operator: 'is_empty' }] } })).toHaveLength(2);
  });
  it('drops subitems', () => {
    expect(applyViewFilters([item('s', {}, { parentItemId: 'a' })], COLUMNS, {})).toHaveLength(0);
  });
});

describe('kanban', () => {
  const lanes = buildLanes('stage', COLUMNS, GROUPS);
  it('builds label lanes plus an empty lane, skipping the default label', () => {
    expect(lanes.map((lane) => lane.id)).toEqual(['lead', 'won', EMPTY_LANE]);
    expect(buildLanes('__group', COLUMNS, GROUPS).map((lane) => lane.id)).toEqual(['g1', 'g2']);
    expect(buildLanes('stage', COLUMNS, GROUPS, ['won']).map((lane) => lane.id)[0]).toBe('won');
  });
  it('groups cards by lane respecting the saved order', () => {
    const map = groupIntoLanes(ITEMS, lanes, 'stage', COLUMNS, {});
    expect(map.get('lead')?.map((entry) => entry.id)).toEqual(['a']);
    expect(map.get(EMPTY_LANE)?.map((entry) => entry.id)).toEqual(['c']);
    const two = [item('x', { stage: { labelId: 'lead' } }), item('y', { stage: { labelId: 'lead' } })];
    expect(groupIntoLanes(two, lanes, 'stage', COLUMNS, { lead: ['y', 'x'] }).get('lead')?.map((entry) => entry.id)).toEqual(['y', 'x']);
  });
  it('computes Σ and weighted Σ', () => {
    expect(laneTotals(ITEMS, 'value', 'probability')).toEqual({ count: 3, sum: 4500, weighted: 3500 });
    expect(laneTotals(ITEMS, null, null).sum).toBeNull();
  });
  it('moves cards and lanes immutably', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
    const order = applyCardMove({ lead: ['a', 'x'] }, { itemId: 'a', fromLane: 'lead', toLane: 'won', targetIds: ['b'], index: 1 });
    expect(order).toEqual({ lead: ['x'], won: ['b', 'a'] });
    expect(shiftLane(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(shiftLane(['a', 'b'], 'a', -1)).toEqual(['a', 'b']);
    expect(laneCellValue(lanes[0]!, STAGE)).toEqual({ labelId: 'lead' });
    expect(laneCellValue(lanes[2]!, STAGE)).toBeNull();
  });
});

describe('calendar', () => {
  const { events, unscheduled } = collectEvents(ITEMS, COLUMNS.find((entry) => entry.key === 'timeline'));
  it('splits scheduled and unscheduled items', () => {
    expect(events.map((event) => event.id)).toEqual(['b']);
    expect(unscheduled.map((entry) => entry.id)).toEqual(['a', 'c']);
  });
  it('slots spanning events across a week row', () => {
    const days = weekDays('2026-11-05', 0);
    const extra = { id: 'z', item: ITEMS[0]!, start: '2026-11-03', end: '2026-11-03' };
    const segments = layoutWeek(days, [...events, extra]);
    const span = segments.find((segment) => segment.event.id === 'b');
    expect(span).toMatchObject({ startCol: 1, span: 6, slot: 0, continuesAfter: true, continuesBefore: false });
    expect(segments.find((segment) => segment.event.id === 'z')?.slot).toBe(1);
    expect(overflowByDay(segments, 7, 1)[2]).toBe(1);
    expect(eventsOnDay([...events, extra], '2026-11-03')).toHaveLength(2);
  });
  it('keeps duration when rescheduling and snaps times', () => {
    expect(shiftRange({ start: '2026-11-02', end: '2026-11-10' }, '2026-11-05')).toEqual({ start: '2026-11-05', end: '2026-11-13' });
    expect(timeOf(9 * 60 + 7)).toBe('09:00');
    expect(timeOf(26 * 60)).toBe('23:45');
  });
});

describe('timeline', () => {
  it('pads the range around bars and today', () => {
    const range = computeRange([{ start: '2026-03-10', end: '2026-04-02' }], '2026-03-20');
    expect(range.start).toBe('2026-02-01');
    expect(range.end).toBe('2026-05-31');
    expect(range.days).toBe(120);
    const ticks = buildTicks(range, 'week');
    expect(ticks.major[0]?.label).toBe('February 2026');
    expect(ticks.minor.length).toBeGreaterThan(15);
  });
  it('drags and resizes without inverting', () => {
    const bar = { start: '2026-01-10', end: '2026-01-12' };
    expect(dragRange(bar, 'move', 3)).toEqual({ start: '2026-01-13', end: '2026-01-15' });
    expect(dragRange(bar, 'start', 5)).toEqual({ start: '2026-01-12', end: '2026-01-12' });
    expect(dragRange(bar, 'end', -9)).toEqual({ start: '2026-01-10', end: '2026-01-10' });
    expect(fitZoom(30, 2000)).toBe('day');
    expect(fitZoom(400, 1000)).toBe('quarter');
  });
});

describe('chart', () => {
  it('aggregates by label with empty labels and drill-down ids', () => {
    const data = buildChartData(ITEMS, chartSettings({}, COLUMNS), { columns: COLUMNS, groups: GROUPS, users: USERS });
    expect(data.points.map((point) => [point.key, point.value])).toEqual([
      ['lead', 1],
      ['won', 1],
      ['__none', 1],
    ]);
    expect(data.points[0]?.itemIds).toEqual(['a']);
  });
  it('sums a currency column, stacks and normalises to 100%', () => {
    const settings = { ...chartSettings({ chartView: { yColumnKey: 'value', stackColumnKey: '__group', sort: 'value_desc', hideEmpty: true } }, COLUMNS) };
    const data = buildChartData(ITEMS, settings, { columns: COLUMNS, groups: GROUPS, users: USERS });
    expect(data.points[0]).toMatchObject({ key: 'won', value: 3000 });
    expect(data.total).toBe(4500);
    expect(data.stacks.map((stack) => stack.key)).toEqual(['g1', 'g2']);
    expect(toPercent(data.points)[0]?.stacks.g1).toBe(100);
  });
  it('buckets dates and accumulates', () => {
    const settings = chartSettings({ chartView: { xColumnKey: 'close', dateBucket: 'month', cumulative: true } }, COLUMNS);
    const data = buildChartData(ITEMS, settings, { columns: COLUMNS, groups: GROUPS, users: USERS });
    expect(data.points.map((point) => point.key)).toEqual(['2026-11', '__none']);
    expect(data.points.at(-1)?.value).toBe(3);
  });
});

describe('config', () => {
  it('honours legacy seed keys and smart defaults', () => {
    const kanban = kanbanSettings({ kanbanColumnKey: 'stage', kanbanCardColumnKeys: ['owner', 'bogus'] }, COLUMNS);
    expect(kanban.groupBy).toBe('stage');
    expect(kanban.cardFields).toEqual(['owner']);
    expect(kanban.sumColumnKey).toBe('value');
    expect(kanban.weightColumnKey).toBe('probability');
    expect(calendarSettings({ dateColumnKey: 'timeline' }, COLUMNS).dateColumnKey).toBe('timeline');
    expect(calendarSettings({}, COLUMNS).dateColumnKey).toBe('close');
    expect(timelineSettings({}, COLUMNS).columnKey).toBe('timeline');
    expect(chartSettings({ chart: { type: 'bar', xColumnKey: 'stage', yColumnKey: 'value', aggregate: 'sum' } }, COLUMNS)).toMatchObject({ type: 'column', yColumnKey: 'value', aggregate: 'sum' });
  });
  it('falls back when settings are corrupt', () => {
    expect(kanbanSettings({ kanban: { groupBy: 42 } }, COLUMNS).groupBy).toBe('stage');
    expect(chartSettings({ chartView: { xColumnKey: 'value' } }, COLUMNS).xColumnKey).toBe('stage');
  });
});

describe('files', () => {
  it('classifies, filters and sorts', () => {
    const base = { size: 10, boardId: 'b', itemId: 'a', updateId: null, columnKey: null, uploadedBy: null, url: '' };
    const files = [
      { ...base, id: '1', name: 'deck.pdf', mime: 'application/pdf', createdAt: '2026-01-01' },
      { ...base, id: '2', name: 'logo.png', mime: 'image/png', createdAt: '2026-02-01', size: 99 },
    ];
    expect(fileKind(files[0]!)).toBe('pdf');
    expect(filterFiles(files, { query: '', kind: 'all', sort: 'newest', itemNames: new Map() }).map((file) => file.id)).toEqual(['2', '1']);
    expect(filterFiles(files, { query: 'Item A', kind: 'image', sort: 'name', itemNames: new Map([['a', 'Item A']]) }).map((file) => file.id)).toEqual(['2']);
    expect(formatBytes(1536)).toBe('1.5 KB');
  });
});

describe('form model', () => {
  const formColumns = COLUMNS.map((entry) => ({ key: entry.key, title: entry.title, type: entry.type, settings: entry.settings }));
  it('always keeps a required name question and seeds from columns', () => {
    const settings = parseFormSettings({}, formColumns, 'Deals intake');
    expect(settings.title).toBe('Deals intake');
    expect(settings.questions[0]).toMatchObject({ columnKey: 'name', required: true });
    expect(settings.questions.length).toBeGreaterThan(1);
    const kept = parseFormSettings({ questions: [{ columnKey: 'value' }, { columnKey: 'ghost' }] }, formColumns);
    expect(kept.questions.map((question) => question.columnKey)).toEqual(['name', 'value']);
  });
  it('validates answers and only writes visible form columns', () => {
    const questions = [
      { columnKey: 'name', required: true, hidden: false },
      { columnKey: 'stage', required: true, hidden: false },
      { columnKey: 'value', required: false, hidden: false, condition: { columnKey: 'stage', operator: 'is' as const, value: 'won' } },
    ];
    expect(answersToValues(questions, formColumns, { name: '', stage: 'nope' })).toEqual({ ok: false, errors: { name: 'This field is required', stage: 'Choose one of the options' } });
    const ok = answersToValues(questions, formColumns, { name: 'Acme', stage: 'won', value: '1,200', owner: { ids: ['x'] } });
    expect(ok).toEqual({ ok: true, name: 'Acme', values: { stage: { labelId: 'won' }, value: { amount: 1200, currency: 'USD' } } });
    const hidden = answersToValues(questions, formColumns, { name: 'Acme', stage: 'lead', value: '5' });
    expect(hidden.ok && hidden.values).toEqual({ stage: { labelId: 'lead' } });
  });
  it('evaluates conditions, closure, redirects and bots', () => {
    expect(isQuestionVisible({ columnKey: 'x', required: false, hidden: false, condition: { columnKey: 'stage', operator: 'is_not_empty' } }, { stage: 'won' })).toBe(true);
    expect(formClosedReason(parseFormSettings({ maxResponses: 2, responseCount: 2 }, formColumns), '2026-01-01')).toBe('full');
    expect(formClosedReason(parseFormSettings({ closeAt: '2025-12-31' }, formColumns), '2026-01-01')).toBe('expired');
    expect(safeRedirect('javascript:alert(1)')).toBeNull();
    expect(safeRedirect('https://kitstak.example/thanks')).toBe('https://kitstak.example/thanks');
    expect(looksAutomated({ website: 'spam.example' }, 9000)).toBe(true);
    expect(looksAutomated({}, 300)).toBe(true);
    expect(looksAutomated({}, null)).toBe(true); // no / forged stamp → bot
    expect(looksAutomated({}, 9000)).toBe(false);
  });
  it('verifies the signed render stamp server side', () => {
    const secret = 's'.repeat(40);
    const token = 'A'.repeat(43);
    const stamp = issueRenderStamp(secret, token, 1_000_000_000_000);
    expect(verifyRenderStamp(secret, token, stamp, 1_000_000_005_000)).toBe(5000);
    expect(verifyRenderStamp(secret, 'B'.repeat(43), stamp, 1_000_000_005_000)).toBeNull();
    expect(verifyRenderStamp('x'.repeat(40), token, stamp, 1_000_000_005_000)).toBeNull();
    expect(verifyRenderStamp(secret, token, `1000000004000.${stamp.split('.')[1]}`, 1_000_000_005_000)).toBeNull();
    expect(verifyRenderStamp(secret, token, undefined, 1)).toBeNull();
  });
  it('keeps form token / publish state / counter server-owned on view PATCH', () => {
    const stored = { kanban: { a: 1 }, form: { title: 'Intake', token: 'REAL'.repeat(11), published: true, responseCount: 7 } };
    // Attack 1: forge a weak token + publish without the publish endpoint.
    const forged = guardViewConfigWrite({ form: { title: 'x' } }, { form: { token: 'A'.repeat(43), published: true } }, true);
    expect(forged.form).toEqual({ title: 'x' });
    // Attack 2: copy another form's token onto a throwaway form.
    const copied = guardViewConfigWrite(stored, { form: { token: 'VICTIM'.repeat(8), title: 'Collider' } }, true);
    expect(copied.form).toMatchObject({ title: 'Collider', token: 'REAL'.repeat(11), published: true, responseCount: 7 });
    // A stale builder save can't reset the counter or unpublish; other keys deep-merge.
    const stale = guardViewConfigWrite(stored, { form: { description: 'd', responseCount: 0, published: false } }, true);
    expect(stale).toEqual({ kanban: { a: 1 }, form: { title: 'Intake', description: 'd', token: 'REAL'.repeat(11), published: true, responseCount: 7 } });
    // Replace mode still preserves the server-owned keys.
    expect(guardViewConfigWrite(stored, { chart: {} }, false)).toEqual({ chart: {}, form: { title: 'Intake', token: 'REAL'.repeat(11), published: true, responseCount: 7 } });
    expect(stripServerFormKeys({ form: { title: 't', token: 'x', published: true, responseCount: 3 } })).toEqual({ form: { title: 't' } });
  });
  it('fails closed on ambiguous public tokens', () => {
    expect(pickUniqueForm([])).toBeNull();
    expect(pickUniqueForm([{ id: 'a' }, { id: 'b' }])).toBeNull();
    expect(pickUniqueForm([{ id: 'a' }])).toEqual({ id: 'a' });
  });
  it('projects only public fields', () => {
    const dto = toPublicForm(parseFormSettings({ questions: [{ columnKey: 'stage', required: true }], token: 'secret-token-value-that-is-long-enough' }, formColumns), formColumns, '2026-01-01');
    expect(dto.questions.map((question) => question.key)).toEqual(['name', 'stage']);
    expect(dto.questions[1]?.options.map((option) => option.id)).toEqual(['lead', 'won']);
    expect(JSON.stringify(dto)).not.toContain('secret-token');
  });
});
