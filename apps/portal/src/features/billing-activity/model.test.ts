import { describe, expect, it } from 'vitest';
import {
  ACTION_KIND,
  ACTIVITY_FILTERS,
  EMPTY_COPY,
  actionsFor,
  csvCell,
  dayKey,
  dayLabel,
  groupByDay,
  invoiceIdOf,
  isActivityFilter,
  kindOf,
  timeLabel,
  toneOf,
  type ActivityItem,
} from './model';

const item = (id: string, at: string, action = 'payment.succeeded'): ActivityItem => ({
  id,
  at: new Date(at),
  actorLabel: 'KitStak',
  action,
  summary: 'Payment of $395.20 succeeded.',
  data: {},
});

describe('billing activity model', () => {
  it('has the four filters of the spec, in order', () => {
    expect(ACTIVITY_FILTERS.map((filter) => filter.label)).toEqual(['All', 'Payments', 'Plan changes', 'Emails']);
    expect(isActivityFilter('payments')).toBe(true);
    expect(isActivityFilter('everything')).toBe(false);
    expect(isActivityFilter(undefined)).toBe(false);
  });

  it('puts every audit action in exactly one filter', () => {
    const all = Object.keys(ACTION_KIND);
    const grouped = [...(actionsFor('payments') ?? []), ...(actionsFor('plan') ?? []), ...(actionsFor('emails') ?? [])];
    expect(grouped.sort()).toEqual([...all].sort());
    expect(actionsFor('all')).toBeNull();
    expect(actionsFor('emails')).toEqual(['email.sent']);
    expect(actionsFor('payments')).toEqual(['payment.succeeded', 'payment.failed', 'payment.retried', 'card.updated']);
    // An action from a newer writer still shows.
    expect(kindOf('something.new')).toBe('plan');
    expect(toneOf('something.new')).toBe('info');
    expect(toneOf('payment.failed')).toBe('danger');
    expect(toneOf('payment.succeeded')).toBe('success');
  });

  it('groups rows by the day in the viewer time zone', () => {
    const now = new Date('2026-12-08T02:00:00.000Z');
    const rows = [
      item('a', '2026-12-08T01:30:00.000Z'),
      item('b', '2026-12-07T23:10:00.000Z'),
      item('c', '2026-12-07T05:00:00.000Z'),
      item('d', '2026-12-01T12:00:00.000Z'),
    ];
    // In Chicago it is still Dec 7 at 02:00 UTC on Dec 8.
    const chicago = groupByDay(rows, now, 'America/Chicago');
    expect(chicago.map((day) => [day.label, day.items.map((row) => row.id)])).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
      ['Dec 1, 2026', ['d']],
    ]);
    const utc = groupByDay(rows, now, 'UTC');
    expect(utc.map((day) => [day.label, day.items.length])).toEqual([
      ['Today', 1],
      ['Yesterday', 2],
      ['Dec 1, 2026', 1],
    ]);
    expect(dayKey(new Date('2026-12-08T01:30:00.000Z'), 'America/Chicago')).toBe('2026-12-07');
    expect(dayLabel(new Date('2026-11-01T12:00:00.000Z'), now, 'UTC')).toBe('Nov 1, 2026');
    expect(timeLabel(new Date('2026-12-07T21:42:00.000Z'), 'UTC')).toBe('9:42 PM');
    expect(groupByDay([], now, 'UTC')).toEqual([]);
  });

  it('reads an invoice id only when it looks like one', () => {
    expect(invoiceIdOf({ invoiceId: 'in_test_16471622db7154b63f530270' })).toBe('in_test_16471622db7154b63f530270');
    expect(invoiceIdOf({ invoiceId: '../../etc/passwd' })).toBeNull();
    expect(invoiceIdOf({ invoiceId: 42 })).toBeNull();
    expect(invoiceIdOf({})).toBeNull();
  });

  it('writes CSV cells that cannot start a formula', () => {
    expect(csvCell('Payment of $395.20 succeeded.')).toBe('"Payment of $395.20 succeeded."');
    expect(csvCell('She said "hi"')).toBe('"She said ""hi"""');
    expect(csvCell('=HYPERLINK("http://evil.example")')).toBe('"\'=HYPERLINK(""http://evil.example"")"');
    expect(csvCell('+1 555')).toBe('"\'+1 555"');
    expect(csvCell('@maya')).toBe('"\'@maya"');
    expect(csvCell('-5')).toBe('"\'-5"');
  });

  it('has an empty state for every filter, in plain words', () => {
    expect(EMPTY_COPY.all).toEqual({ title: 'Nothing here yet.', body: 'Billing events will show up as they happen.' });
    for (const filter of ACTIVITY_FILTERS) expect(EMPTY_COPY[filter.id].body.split(' ').length).toBeLessThanOrEqual(20);
  });
});
