import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Label } from '@/server/db/schema/column-types';
import { LABEL_COLORS } from '@/server/db/schema/column-types';
import type { ColumnDto, ItemDto } from '@/server/services/contracts/dto';
import { contrastRatio, pickTextColor } from './contrast';
import { countryFromNumber, flagEmoji, formatPhone, searchCountries, telHref } from './countries';
import { parseDateInput, parseTimeInput } from './date-parse';
import {
  dateUrgency,
  fileKind,
  formatBytes,
  formatCurrencyValue,
  formatDateValue,
  formatDuration,
  formatNumberValue,
  formatRelativeTime,
  formatTimelineRange,
  isValidEmail,
  normalizeUrl,
  parseNumberInput,
  prettyUrl,
  timelineDays,
  timelineProgress,
} from './format';
import {
  countLabelUsage,
  filterLabels,
  labelsFromSettings,
  moveLabel,
  newLabelId,
  nextLabelColor,
  setDoneLabel,
  validateLabels,
} from './labels';
import { batterySummary, checkboxSummary, dateRangeSummary, mirrorIsNumeric, numericSummary, numericValues, peopleSummary } from './summary';
import { collectLinkedIds, shortItemId } from './values';
import { formatPhoneNational } from './countries';
import { computeProgress, isCellEmpty, isItemDone, readCurrency, readDate, readFormula, rawCellValue } from './values';

const NOW = new Date(2026, 10, 5, 12, 0, 0); // Thu Nov 5 2026, local

const LABELS: Label[] = [
  { id: 'working', name: 'Working on it', color: 'orange', position: 0 },
  { id: 'done', name: 'Done', color: 'green', position: 1, isDone: true },
  { id: 'stuck', name: 'Stuck', color: 'red', position: 2 },
  { id: 'default', name: '', color: 'gray', position: 3, isDefault: true },
];

function column(partial: Partial<ColumnDto> & Pick<ColumnDto, 'key' | 'type'>): ColumnDto {
  return {
    id: partial.key,
    boardId: 'b',
    title: partial.key,
    description: null,
    scope: 'item',
    settings: {} as ColumnDto['settings'],
    width: 160,
    position: 'a0',
    hidden: false,
    required: false,
    ...partial,
  };
}

function item(values: Record<string, unknown>, computed: Record<string, unknown> = {}): ItemDto {
  return {
    id: 'i',
    boardId: 'b',
    groupId: 'g',
    parentItemId: null,
    name: 'Item',
    position: 'a0',
    values: values as ItemDto['values'],
    computed,
    subitemCount: 0,
    updateCount: 0,
    createdBy: null,
    updatedBy: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    archivedAt: null,
    deletedAt: null,
  };
}

const statusColumn = column({ key: 'status', type: 'status', settings: { labels: LABELS } as ColumnDto['settings'] });

describe('labels', () => {
  it('reads labels in board order and drops malformed entries', () => {
    const labels = labelsFromSettings({ labels: [{ id: 'b', name: 'B', color: 'red', position: 2 }, { id: 'a', name: 'A', color: 'nope', position: 1 }, { bad: true }] });
    expect(labels.map((label) => label.id)).toEqual(['a', 'b']);
    expect(labels[0]?.color).toBe('gray');
  });

  it('filters by name and keeps order', () => {
    expect(filterLabels(LABELS, 'o').map((label) => label.id)).toEqual(['working', 'done']);
    expect(filterLabels(LABELS, 'STU').map((label) => label.id)).toEqual(['stuck']);
    expect(filterLabels(LABELS, '  ')).toHaveLength(4);
  });

  it('moves labels immutably and renumbers positions', () => {
    const moved = moveLabel(LABELS, 0, 2);
    expect(moved.map((label) => label.id)).toEqual(['done', 'stuck', 'working', 'default']);
    expect(moved.map((label) => label.position)).toEqual([0, 1, 2, 3]);
    expect(LABELS[0]?.id).toBe('working');
  });

  it('marks exactly one done label', () => {
    const next = setDoneLabel(LABELS, 'stuck');
    expect(next.filter((label) => label.isDone).map((label) => label.id)).toEqual(['stuck']);
    expect(next.find((label) => label.id === 'default')?.isDefault).toBe(true);
    expect(setDoneLabel(LABELS, null).some((label) => label.isDone)).toBe(false);
  });

  it('creates unique ids and unused colors', () => {
    const id = newLabelId(LABELS, () => 0.5);
    expect(id).toMatch(/^l_[a-z0-9]+$/);
    expect(nextLabelColor(LABELS)).toBe('blue');
  });

  it('flags duplicate and blank dropdown names', () => {
    const result = validateLabels([...LABELS, { id: 'dup', name: 'done ', color: 'blue', position: 4 }], 'status');
    expect(result.ok).toBe(false);
    expect(result.errors.get('dup')).toMatch(/already/);
    expect(validateLabels([{ id: 'x', name: '', color: 'blue', position: 0 }], 'dropdown').ok).toBe(false);
  });

  it('counts usage across status and dropdown values', () => {
    const counts = countLabelUsage([item({ s: { labelId: 'done' } }), item({ s: { labelIds: ['done', 'stuck'] } })], 's');
    expect(counts.get('done')).toBe(2);
    expect(counts.get('stuck')).toBe(1);
  });
});

describe('format: numbers and currency', () => {
  it('uses separators, units and decimals', () => {
    expect(formatNumberValue(1_150_000, { unit: '$', unitPosition: 'prefix' })).toBe('$1,150,000');
    expect(formatNumberValue(42, { unit: '%', unitPosition: 'suffix' })).toBe('42%');
    expect(formatNumberValue(1250, { unit: 'seats' })).toBe('1,250 seats');
    expect(formatNumberValue(3.14159, { decimals: 2 })).toBe('3.14');
    expect(formatNumberValue(-5, { unit: '$', unitPosition: 'prefix' })).toBe('-$5');
    expect(formatNumberValue(1_150_000, {}, { compact: true })).toBe('1.2M');
    expect(formatNumberValue(12, { format: 'percent' })).toBe('12%');
  });

  it('formats currencies with ISO codes and compact notation', () => {
    expect(formatCurrencyValue(1_150_000, 'USD')).toBe('$1,150,000');
    expect(formatCurrencyValue(1_150_000, 'USD', 0, { compact: true })).toBe('$1.2M');
    expect(formatCurrencyValue(10.5, 'EUR', 2)).toBe('€10.50');
    expect(formatCurrencyValue(5, 'ZZZ')).toContain('5');
  });

  it('parses lenient numeric input and rejects garbage explicitly', () => {
    expect(parseNumberInput('1,234.5')).toEqual({ ok: true, value: 1234.5 });
    expect(parseNumberInput('$1.2k')).toEqual({ ok: true, value: 1200 });
    expect(parseNumberInput('3M')).toEqual({ ok: true, value: 3_000_000 });
    expect(parseNumberInput('-45%')).toEqual({ ok: true, value: -45 });
    expect(parseNumberInput('  ')).toEqual({ ok: true, value: null });
    expect(parseNumberInput('abc').ok).toBe(false);
    expect(parseNumberInput('1e400').ok).toBe(false);
  });
});

describe('format: dates and timelines', () => {
  it('shows the year only outside the current year', () => {
    expect(formatDateValue({ date: '2026-10-30' }, NOW)).toBe('Oct 30');
    expect(formatDateValue({ date: '2025-10-30' }, NOW)).toBe('Oct 30, 2025');
    expect(formatDateValue({ date: '2026-10-30', time: '10:00' }, NOW)).toBe('Oct 30, 10:00 AM');
  });

  it('supports relative, long and iso formats', () => {
    expect(formatDateValue({ date: '2026-11-05' }, NOW, 'relative')).toBe('Today');
    expect(formatDateValue({ date: '2026-11-06' }, NOW, 'relative')).toBe('Tomorrow');
    expect(formatDateValue({ date: '2026-11-03' }, NOW, 'relative')).toBe('2 days ago');
    expect(formatDateValue({ date: '2026-11-09' }, NOW, 'relative')).toBe('Monday');
    expect(formatDateValue({ date: '2026-11-05' }, NOW, 'long')).toBe('November 5, 2026');
    expect(formatDateValue({ date: '2026-11-05' }, NOW, 'iso')).toBe('2026-11-05');
  });

  it('computes deadline urgency', () => {
    expect(dateUrgency('2026-11-01', NOW, false)).toBe('overdue');
    expect(dateUrgency('2026-11-01', NOW, true)).toBe('done');
    expect(dateUrgency('2026-11-05', NOW, false)).toBe('today');
    expect(dateUrgency('2026-11-07', NOW, false)).toBe('soon');
    expect(dateUrgency('2026-12-07', NOW, false)).toBe('none');
    expect(dateUrgency('nope', NOW, false)).toBe('none');
  });

  it('formats timeline ranges, durations and progress', () => {
    expect(formatTimelineRange('2026-05-01', '2026-10-30', NOW)).toBe('May 1 – Oct 30');
    expect(formatTimelineRange('2025-12-20', '2026-01-05', NOW)).toBe('Dec 20, 2025 – Jan 5, 2026');
    expect(formatTimelineRange('2026-05-01', '2026-05-01', NOW)).toBe('May 1');
    expect(timelineDays('2026-05-01', '2026-10-30')).toBe(183);
    expect(formatDuration(183)).toBe('6 mo');
    expect(formatDuration(5)).toBe('5 days');
    expect(formatDuration(46)).toBe('46 days');
    expect(formatDuration(1)).toBe('1 day');
    expect(timelineProgress('2026-11-01', '2026-11-10', NOW)).toBeCloseTo(0.5);
    expect(timelineProgress('2026-12-01', '2026-12-10', NOW)).toBe(0);
    expect(timelineProgress('2026-01-01', '2026-01-10', NOW)).toBe(1);
  });

  it('formats relative times', () => {
    expect(formatRelativeTime(new Date(NOW.getTime() - 10_000).toISOString(), NOW)).toBe('Just now');
    expect(formatRelativeTime(new Date(NOW.getTime() - 5 * 60_000).toISOString(), NOW)).toBe('5m ago');
    expect(formatRelativeTime(new Date(NOW.getTime() - 3 * 3_600_000).toISOString(), NOW)).toBe('3h ago');
    expect(formatRelativeTime(new Date(2026, 10, 4, 9).toISOString(), NOW)).toBe('Yesterday');
    expect(formatRelativeTime('garbage', NOW)).toBe('');
  });
});

describe('date parsing', () => {
  it('understands keywords, offsets, weekdays and explicit dates', () => {
    const iso = (text: string) => {
      const date = parseDateInput(text, NOW);
      return date ? `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}` : null;
    };
    expect(iso('today')).toBe('2026-11-5');
    expect(iso('tomorrow')).toBe('2026-11-6');
    expect(iso('in 3 days')).toBe('2026-11-8');
    expect(iso('+2w')).toBe('2026-11-19');
    expect(iso('fri')).toBe('2026-11-6');
    expect(iso('next thu')).toBe('2026-11-12');
    expect(iso('thursday')).toBe('2026-11-5');
    expect(iso('next week')).toBe('2026-11-9');
    expect(iso('12/24')).toBe('2026-12-24');
    expect(iso('2027-02-03')).toBe('2027-2-3');
    expect(iso('Dec 5 2027')).toBe('2027-12-5');
    expect(iso('5th march')).toBe('2026-3-5');
    expect(iso('end of month')).toBe('2026-11-30');
    expect(iso('2/30')).toBeNull();
    expect(iso('blorp')).toBeNull();
  });

  it('parses times', () => {
    expect(parseTimeInput('3pm')).toBe('15:00');
    expect(parseTimeInput('3:30 pm')).toBe('15:30');
    expect(parseTimeInput('12am')).toBe('00:00');
    expect(parseTimeInput('0930')).toBe('09:30');
    expect(parseTimeInput('25:00')).toBeNull();
    expect(parseTimeInput('13pm')).toBeNull();
  });
});

describe('contact helpers', () => {
  it('validates emails and urls', () => {
    expect(isValidEmail('jordan@acme.example')).toBe(true);
    expect(isValidEmail('jordan@acme')).toBe(false);
    expect(normalizeUrl('acme.com/pricing')).toBe('https://acme.com/pricing');
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('ftp://acme.com')).toBeNull();
    expect(prettyUrl('https://www.acme.com/pricing/')).toBe('acme.com/pricing');
  });

  it('formats phones with country dial codes', () => {
    expect(formatPhone('+12145550163')).toBe('+1 214 555 0163');
    expect(formatPhone('2145550163', 'US')).toBe('+1 214 555 0163');
    expect(formatPhone('+442079460958', 'GB')).toBe('+44 20 7946 0958');
    expect(countryFromNumber('+447700900123')?.code).toBe('GB');
    expect(countryFromNumber('+15145550000', 'CA')?.code).toBe('CA');
    expect(telHref('(214) 555-0163', 'US')).toBe('tel:+12145550163');
    expect(flagEmoji('US')).toBe('🇺🇸');
    expect(flagEmoji('USA')).toBe('');
    expect(searchCountries('+44').map((country) => country.code)).toContain('GB');
    expect(searchCountries('germ').map((country) => country.code)).toEqual(['DE']);
  });

  it('classifies files and sizes', () => {
    expect(fileKind('application/pdf')).toBe('pdf');
    expect(fileKind('application/octet-stream', 'a.xlsx')).toBe('sheet');
    expect(fileKind('image/png')).toBe('image');
    expect(fileKind('application/zip')).toBe('archive');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(482_113)).toBe('471 KB');
    expect(formatBytes(5_120_000)).toBe('4.9 MB');
  });
});

describe('values', () => {
  it('reads values defensively', () => {
    expect(readDate({ date: '2026-01-02', time: '10:00' })).toEqual({ date: '2026-01-02', time: '10:00' });
    expect(readDate({ date: 'x' })).toBeNull();
    expect(readCurrency({ amount: 5 })).toEqual({ amount: 5, currency: 'USD' });
    expect(readFormula({ result: 4, error: 'bad' })).toEqual({ result: 4, error: 'bad' });
    expect(readFormula(7)).toEqual({ result: 7 });
  });

  it('knows when a cell is empty', () => {
    expect(isCellEmpty('status', { labelId: 'done' })).toBe(false);
    expect(isCellEmpty('status', null)).toBe(true);
    expect(isCellEmpty('rating', 0)).toBe(true);
    expect(isCellEmpty('checkbox', false)).toBe(true);
    expect(isCellEmpty('people', { ids: [], teamIds: ['t'] })).toBe(false);
    expect(isCellEmpty('text', '  ')).toBe(true);
  });

  it('prefers computed values and the item name', () => {
    const target = item({ number: 3 }, { formula: { result: 9 } });
    expect(rawCellValue(column({ key: 'formula', type: 'formula' }), target)).toEqual({ result: 9 });
    expect(rawCellValue(column({ key: 'name', type: 'name' }), target)).toBe('Item');
  });

  it('computes progress from status and checkbox columns like the server', () => {
    const progress = column({ key: 'progress', type: 'progress' });
    const check = column({ key: 'check', type: 'checkbox' });
    const columns = [statusColumn, check, progress];
    expect(computeProgress(progress, item({ status: { labelId: 'done' }, check: true }), columns)).toBe(100);
    expect(computeProgress(progress, item({ status: { labelId: 'working' }, check: true }), columns)).toBe(50);
    expect(computeProgress(column({ key: 'p', type: 'progress', settings: { sourceColumnKeys: ['check'] } as ColumnDto['settings'] }), item({ check: false }), columns)).toBe(0);
    expect(isItemDone(item({ status: { labelId: 'done' } }), columns)).toBe(true);
    expect(isItemDone(item({}), columns)).toBe(false);
  });
});

describe('summaries', () => {
  it('aggregates numbers', () => {
    expect(numericSummary([1, 2, 3, 10], 'sum')).toBe(16);
    expect(numericSummary([1, 2, 3, 10], 'average')).toBe(4);
    expect(numericSummary([1, 2, 3, 10], 'median')).toBe(2.5);
    expect(numericSummary([5, 1, 3], 'median')).toBe(3);
    expect(numericSummary([5, 1, 3], 'min')).toBe(1);
    expect(numericSummary([5, 1, 3], 'max')).toBe(5);
    expect(numericSummary([5, 1, 3], 'count')).toBe(3);
    expect(numericSummary([], 'sum')).toBe(0);
    expect(numericSummary([], 'average')).toBeNull();
    expect(numericSummary([1], 'none')).toBeNull();
  });

  it('builds a status battery in board order with empties last', () => {
    const items = [item({ status: { labelId: 'done' } }), item({ status: { labelId: 'done' } }), item({ status: { labelId: 'stuck' } }), item({})];
    const summary = batterySummary(statusColumn, items);
    expect(summary.total).toBe(4);
    expect(summary.segments.map((segment) => [segment.id, segment.count, segment.percent])).toEqual([
      ['done', 2, 50],
      ['stuck', 1, 25],
      ['__empty__', 1, 25],
    ]);
    expect(summary.doneCount).toBe(2);
  });

  it('summarises checkboxes, dates, people and numeric columns', () => {
    const items = [
      item({ c: true, d: { date: '2026-11-01' }, t: { from: '2026-10-01', to: '2026-10-09' }, p: { ids: ['u1', 'u2'] }, m: { amount: 10, currency: 'USD' } }),
      item({ c: false, d: { date: '2026-12-15' }, p: { ids: ['u2'] }, m: { amount: 5, currency: 'USD' } }),
    ];
    expect(checkboxSummary('c', items)).toEqual({ checked: 1, total: 2 });
    expect(dateRangeSummary(column({ key: 'd', type: 'date' }), items)).toEqual({ from: '2026-11-01', to: '2026-12-15', count: 2 });
    expect(dateRangeSummary(column({ key: 't', type: 'timeline' }), items)).toEqual({ from: '2026-10-01', to: '2026-10-09', count: 1 });
    expect(peopleSummary('p', items)).toEqual([
      { id: 'u2', count: 2 },
      { id: 'u1', count: 1 },
    ]);
    expect(numericValues(column({ key: 'm', type: 'currency' }), items)).toEqual([10, 5]);
  });

  it('only sums mirror columns whose mirrored values are numeric', () => {
    const mirror = column({ key: 'mi', type: 'mirror' });
    const text = [item({ mi: { display: 'Strategic', values: ['Strategic'] } }), item({})];
    const numbers = [item({ mi: { display: '1,200', values: [1200] } }), item({ mi: { display: '$30', values: [{ amount: 30, currency: 'USD' }] } })];
    expect(mirrorIsNumeric(mirror, text)).toBe(false);
    expect(mirrorIsNumeric(mirror, [])).toBe(false);
    expect(mirrorIsNumeric(mirror, numbers)).toBe(true);
    expect(numericValues(mirror, numbers)).toEqual([1200, 30]);
  });
});

describe('ids and phone display', () => {
  it('shows the searchable 8-char uuid prefix as the short id', () => {
    expect(shortItemId('3f9a01c2-0000-4000-8000-000000000401')).toBe('3f9a01c2');
    expect(shortItemId('3F9A01C2-0000-4000-8000-000000000401')).toBe('3f9a01c2');
    expect(shortItemId('1042')).toBe('1042');
  });

  it('collects linked item ids from connect values only', () => {
    const id1 = '11111111-1111-4111-8111-111111111111';
    const id2 = '22222222-2222-4222-8222-222222222222';
    const ids = collectLinkedIds([item({ a: { itemIds: [id2, id1] }, b: { labelIds: ['x'] } }), item({ a: { itemIds: [id1, 'nope'] } })]);
    expect(ids).toEqual([id1, id2]);
  });

  it('formats national phone numbers for narrow columns', () => {
    expect(formatPhoneNational('+1 214 555 0163', 'US')).toBe('214 555 0163');
    expect(formatPhoneNational('+44 20 7946 0958', 'GB')).toBe('020 7946 0958');
  });
});

describe('pill contrast (CE-011)', () => {
  const tokens = readFileSync(path.resolve(__dirname, '../../../styles/tokens.css'), 'utf8');
  const lightBlock = tokens.slice(0, tokens.indexOf(":root[data-theme='dark']"));
  const token = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(lightBlock)?.[1];

  it('computes WCAG ratios', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBe(21);
    expect(pickTextColor('#ffcb00')).toBe('ink');
    expect(pickTextColor('#1d4fa8')).toBe('white');
  });

  it.each(LABEL_COLORS)('label %s text passes AA on its pill', (color) => {
    const bg = token(`label-${color}`);
    const hover = token(`label-${color}-hover`);
    const fg = token(`label-${color}-fg`);
    expect(bg && fg).toBeTruthy();
    expect(contrastRatio(bg as string, fg as string)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(hover as string, fg as string)).toBeGreaterThanOrEqual(4.5);
  });

  const darkStart = tokens.indexOf(":root[data-theme='dark']");
  const darkBlock = tokens.slice(darkStart, tokens.indexOf('@media (prefers-color-scheme: dark)', darkStart));
  const mediaBlock = tokens.slice(tokens.indexOf('@media (prefers-color-scheme: dark)', darkStart));
  const darkToken = (block: string, name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1];

  it.each(LABEL_COLORS)('label %s is dimmed for dark and keeps AA text (both dark selectors)', (color) => {
    for (const block of [darkBlock, mediaBlock]) {
      const bg = darkToken(block, `label-${color}`);
      const hover = darkToken(block, `label-${color}-hover`);
      const fg = darkToken(block, `label-${color}-fg`);
      expect(bg && hover && fg).toBeTruthy();
      expect(bg).not.toBe(token(`label-${color}`));
      expect(contrastRatio(bg as string, fg as string)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(hover as string, fg as string)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('dark blank (gray) label is a muted surface, not a bright slab', () => {
    const blank = darkToken(darkBlock, 'label-gray') as string;
    expect(contrastRatio(blank, '#171b25')).toBeLessThan(2);
  });
});
