import { describe, expect, it } from 'vitest';
import type { NotificationDto } from '@/server/services/contracts/dto';
import {
  clusterSimilar,
  dayBucketFor,
  describeNotification,
  emphasize,
  formatShortTime,
  groupByDay,
  inScope,
  isSystemNotification,
  notificationHref,
  trimPreview,
} from './describe';

const base: NotificationDto = {
  id: 'n1',
  kind: 'mention',
  actor: { id: 'u1', name: 'Dana Fox', email: 'dana@example.com', image: null, title: null },
  boardId: 'b1',
  boardName: 'Deals',
  itemId: 'i1',
  itemName: 'Northwind',
  updateId: null,
  payload: {},
  readAt: null,
  createdAt: '2026-11-05T10:00:00.000Z',
};

const text = (entry: NotificationDto) => describeNotification(entry).label;

describe('describeNotification', () => {
  it('renders the actor and item in bold for a mention with a preview', () => {
    const result = describeNotification({ ...base, payload: { preview: '  Hello\n  there  ' } });
    expect(result.label).toBe('Dana Fox mentioned you on Northwind');
    expect(result.segments.filter((segment) => segment.strong).map((segment) => segment.text)).toEqual([
      'Dana Fox',
      'Northwind',
    ]);
    expect(result.preview).toBe('Hello there');
    expect(result.system).toBe(false);
  });

  it('describes assignments with the column title', () => {
    expect(text({ ...base, kind: 'assigned', payload: { columnTitle: 'Owner' } })).toBe(
      'Dana Fox assigned you to Northwind as Owner',
    );
    expect(text({ ...base, kind: 'assigned', payload: { columnTitle: 'Person' } })).toBe(
      'Dana Fox assigned you to Northwind',
    );
  });

  it('describes status changes with and without a target label', () => {
    expect(text({ ...base, kind: 'status_change', payload: { columnTitle: 'Stage', toLabel: 'Won' } })).toBe(
      'Dana Fox changed Stage to Won on Northwind',
    );
    expect(text({ ...base, kind: 'status_change' })).toBe('Dana Fox changed the status on Northwind');
  });

  it('treats automations as system events and bolds the item inside the message', () => {
    const entry: NotificationDto = {
      ...base,
      kind: 'automation',
      actor: null,
      payload: { message: 'Northwind was won 🎉' },
    };
    const result = describeNotification(entry);
    expect(result.system).toBe(true);
    expect(result.actorName).toBe('Automation');
    expect(result.segments).toEqual([{ text: 'Northwind', strong: true }, { text: ' was won 🎉' }]);
    expect(text({ ...entry, payload: {} })).toBe('An automation ran on Northwind');
    expect(text({ ...entry, payload: { message: 'Deal closed' } })).toBe('Deal closed · Northwind');
    expect(text({ ...entry, itemId: null, itemName: null, payload: { message: 'Import finished' } })).toBe(
      'Import finished',
    );
  });

  it('covers the remaining kinds', () => {
    expect(text({ ...base, kind: 'update_reply' })).toContain('replied to your update on');
    expect(text({ ...base, kind: 'update_on_subscribed' })).toContain('posted an update on');
    expect(text({ ...base, kind: 'reaction', payload: { emoji: '👍' } })).toBe(
      'Dana Fox reacted 👍 to your update on Northwind',
    );
    expect(text({ ...base, kind: 'board_shared' })).toBe('Dana Fox shared the board Deals with you');
    expect(text({ ...base, kind: 'invitation' })).toBe('Dana Fox invited you to Deals');
    expect(text({ ...base, kind: 'due_date', payload: { date: 'today' } })).toBe('Northwind is due today');
    expect(isSystemNotification({ kind: 'due_date', actor: base.actor })).toBe(true);
  });

  it('falls back to payload names when joins are missing', () => {
    expect(text({ ...base, itemName: null, payload: { itemName: 'From payload' } })).toBe(
      'Dana Fox mentioned you on From payload',
    );
    expect(text({ ...base, itemName: null })).toBe('Dana Fox mentioned you on an item');
  });
});

describe('trimPreview', () => {
  it('collapses whitespace and truncates with an ellipsis', () => {
    expect(trimPreview(null)).toBeNull();
    expect(trimPreview('   ')).toBeNull();
    expect(trimPreview('a'.repeat(20), 10)).toBe(`${'a'.repeat(9)}…`);
  });
});

describe('day grouping', () => {
  const now = new Date(2026, 10, 5, 15, 0, 0);
  it('buckets by local day', () => {
    expect(dayBucketFor(new Date(2026, 10, 5, 0, 5).toISOString(), now)).toBe('Today');
    expect(dayBucketFor(new Date(2026, 10, 4, 23, 59).toISOString(), now)).toBe('Yesterday');
    expect(dayBucketFor(new Date(2026, 10, 3, 12).toISOString(), now)).toBe('Earlier');
    expect(dayBucketFor('nope', now)).toBe('Earlier');
  });

  it('groups in fixed order and keeps entry order', () => {
    const entries = [
      { id: 'a', createdAt: new Date(2026, 10, 5, 9).toISOString() },
      { id: 'b', createdAt: new Date(2026, 10, 5, 8).toISOString() },
      { id: 'c', createdAt: new Date(2026, 10, 1).toISOString() },
    ];
    const groups = groupByDay(entries, now);
    expect(groups.map((group) => group.bucket)).toEqual(['Today', 'Earlier']);
    expect(groups[0]?.entries.map((entry) => entry.id)).toEqual(['a', 'b']);
  });
});

describe('notificationHref', () => {
  it('deep links into the item panel', () => {
    expect(notificationHref('acme', base)).toBe('/acme/boards/b1?item=i1');
    expect(notificationHref('acme', { ...base, updateId: 'u9' })).toBe('/acme/boards/b1?item=i1&update=u9');
    expect(notificationHref('acme', { ...base, itemId: null })).toBe('/acme/boards/b1');
    expect(notificationHref('acme', { ...base, boardId: null })).toBeNull();
  });
});

describe('formatShortTime', () => {
  const now = new Date('2026-11-05T12:00:00Z');
  it('formats compact relative times', () => {
    expect(formatShortTime('2026-11-05T11:59:30Z', now)).toBe('now');
    expect(formatShortTime('2026-11-05T11:15:00Z', now)).toBe('45m');
    expect(formatShortTime('2026-11-05T07:00:00Z', now)).toBe('5h');
    expect(formatShortTime('2026-11-02T12:00:00Z', now)).toBe('3d');
    expect(formatShortTime('2026-10-01T12:00:00Z', now)).toBe('Oct 1');
    expect(formatShortTime('2025-10-01T12:00:00Z', now)).toBe('Oct 1, 2025');
    expect(formatShortTime('bad', now)).toBe('');
  });
});

describe('emphasize', () => {
  const strong = (segments: ReturnType<typeof emphasize>) =>
    segments.filter((segment) => segment.strong).map((segment) => segment.text);

  it('bolds file names and quoted names in system messages', () => {
    expect(strong(emphasize('Imported 120 rows from import-contacts.csv'))).toEqual(['import-contacts.csv']);
    expect(strong(emphasize('Moved to "Closed won" by rule'))).toEqual(['"Closed won"']);
    expect(
      emphasize('Imported 3 rows')
        .map((segment) => segment.text)
        .join(''),
    ).toBe('Imported 3 rows');
  });

  it('bolds given names such as the board', () => {
    expect(strong(emphasize('Nightly sync finished for Deals (2 skipped)', ['Deals']))).toEqual(['Deals']);
  });

  it('bolds the import file in an automation notification', () => {
    const result = describeNotification({
      ...base,
      kind: 'automation',
      actor: null,
      itemId: null,
      itemName: null,
      payload: { message: 'Import of import-contacts.csv finished: 2 rows skipped' },
    });
    expect(result.segments.filter((segment) => segment.strong).map((segment) => segment.text)).toContain(
      'import-contacts.csv',
    );
  });
});

describe('clusterSimilar', () => {
  const system = (id: string, message: string, extra: Partial<NotificationDto> = {}): NotificationDto => ({
    ...base,
    id,
    kind: 'automation',
    actor: null,
    payload: { message },
    ...extra,
  });

  it('folds consecutive identical system events and keeps people events apart', () => {
    const clusters = clusterSimilar([
      system('a', 'Import finished'),
      system('b', 'Import finished'),
      system('c', 'Import finished'),
      { ...base, id: 'm1' },
      { ...base, id: 'm2' },
      system('d', 'Import finished'),
      system('e', 'Import failed'),
    ]);
    expect(clusters.map((cluster) => [cluster.head.id, cluster.similar.map((entry) => entry.id)])).toEqual([
      ['a', ['b', 'c']],
      ['m1', []],
      ['m2', []],
      ['d', []],
      ['e', []],
    ]);
  });

  it('folds the same event across boards but not across items', () => {
    expect(clusterSimilar([system('a', 'Ran'), system('b', 'Ran', { boardId: 'b2' })])).toHaveLength(1);
    expect(clusterSimilar([system('a', 'Ran'), system('b', 'Ran', { itemId: 'i2' })])).toHaveLength(2);
  });
});

describe('inScope', () => {
  it('matches the actor name like the server search', () => {
    expect(inScope(base, { q: 'dana' })).toBe(true);
    expect(inScope(base, { q: 'hannah' })).toBe(false);
  });
  it('matches item, board and payload text and respects the board filter', () => {
    expect(inScope(base, { q: 'north' })).toBe(true);
    expect(inScope({ ...base, payload: { preview: 'Quarterly plan' } }, { q: 'quarterly' })).toBe(true);
    expect(inScope(base, { boardId: 'b2' })).toBe(false);
    expect(inScope(base, { boardId: 'b1', q: 'deals' })).toBe(true);
  });
});
