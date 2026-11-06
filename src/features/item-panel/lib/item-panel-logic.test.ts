import { describe, expect, it } from 'vitest';
import type { ActivityDto, ColumnDto, GroupDto, ItemDto } from '@/server/services/contracts/dto';
import {
  NO_FILTER,
  activityPreview,
  describeActivity,
  distinctActors,
  groupByDay,
  isValueChange,
  matchesFilter,
} from './activity';
import { dayLabel, fileExtension, formatBytes, formatRelativeShort, panelFileKind, pluralize } from './format';
import { neighbors, orderedItemIds } from './item-order';
import { PANEL_DEFAULT_WIDTH, PANEL_MIN_WIDTH, clampPanelWidth, widthFromPointer } from './panel-width';
import { attachmentOnlyDoc, docText, isDocEmpty, mentionIds, safeHref } from './rich-text';
import { buildPanelHref, itemShareUrl, parseTab, readPanelState } from './url-state';

const ITEM = '378c79d8-6210-47bb-8413-f520a2359274';
const UPDATE = '53d26782-5df4-4e77-846a-fa2297d4c2ac';

function activity(partial: Partial<ActivityDto>): ActivityDto {
  return {
    id: partial.id ?? 'a',
    boardId: 'b',
    itemId: ITEM,
    actorId: 'u1',
    actorName: 'Maya Chen',
    actorImage: null,
    automationId: null,
    action: 'item.value_changed',
    columnKey: 'stage',
    before: null,
    after: null,
    createdAt: '2026-11-05T10:00:00.000Z',
    ...partial,
  };
}

describe('url state', () => {
  it('reads valid ids and falls back to the updates tab', () => {
    const state = readPanelState(new URLSearchParams(`item=${ITEM}&itemTab=bogus&update=nope`));
    expect(state).toEqual({ itemId: ITEM, tab: 'updates', updateId: null });
    expect(parseTab('files')).toBe('files');
  });

  it('ignores ids that are not uuids', () => {
    expect(readPanelState(new URLSearchParams('item=<script>')).itemId).toBeNull();
  });

  it('keeps unrelated params, omits the default tab and clears everything on close', () => {
    const opened = buildPanelHref('/acme/boards/1', '?view=v1', { itemId: ITEM, tab: 'updates' });
    expect(opened).toBe(`/acme/boards/1?view=v1&item=${ITEM}`);
    const tabbed = buildPanelHref('/acme/boards/1', `view=v1&item=${ITEM}`, { tab: 'files' });
    expect(tabbed).toBe(`/acme/boards/1?view=v1&item=${ITEM}&itemTab=files`);
    expect(buildPanelHref('/acme/boards/1', `view=v1&item=${ITEM}&itemTab=files&update=${UPDATE}`, { itemId: null })).toBe(
      '/acme/boards/1?view=v1',
    );
    expect(buildPanelHref('/x', `item=${ITEM}`, { itemId: null })).toBe('/x');
  });

  it('builds share links to an update', () => {
    const url = itemShareUrl({ origin: 'https://app.test', pathname: '/o/boards/1', search: '' }, ITEM, { updateId: UPDATE });
    expect(url).toBe(`https://app.test/o/boards/1?item=${ITEM}&update=${UPDATE}`);
  });
});

describe('panel width', () => {
  it('clamps to the min, the viewport gutter and handles NaN', () => {
    expect(clampPanelWidth(100, 1440)).toBe(PANEL_MIN_WIDTH);
    expect(clampPanelWidth(5000, 1440)).toBe(1200);
    expect(clampPanelWidth(900, 1000)).toBe(936 > 900 ? 900 : 936);
    expect(clampPanelWidth(Number.NaN, 1440)).toBe(PANEL_DEFAULT_WIDTH);
    expect(widthFromPointer(800, 1440)).toBe(640);
  });
});

describe('format', () => {
  const now = new Date(2026, 10, 5, 15, 0, 0);
  it('formats relative times', () => {
    expect(formatRelativeShort(new Date(2026, 10, 5, 14, 59, 40).toISOString(), now)).toBe('Just now');
    expect(formatRelativeShort(new Date(2026, 10, 5, 14, 30).toISOString(), now)).toBe('30m');
    expect(formatRelativeShort(new Date(2026, 10, 5, 9, 0).toISOString(), now)).toBe('6h');
    expect(formatRelativeShort(new Date(2026, 10, 4, 23, 0).toISOString(), now)).toBe('Yesterday');
    expect(formatRelativeShort(new Date(2026, 8, 3).toISOString(), now)).toBe('Sep 3');
    expect(formatRelativeShort(new Date(2024, 8, 3).toISOString(), now)).toBe('Sep 3, 2024');
    expect(formatRelativeShort('garbage', now)).toBe('');
  });

  it('labels days', () => {
    expect(dayLabel('2026-11-05', now)).toBe('Today');
    expect(dayLabel('2026-11-04', now)).toBe('Yesterday');
    expect(dayLabel('2025-01-02', now)).toBe('Jan 2, 2025');
  });

  it('formats bytes, kinds, extensions and plurals', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(25 * 1024 * 1024)).toBe('25 MB');
    expect(panelFileKind('image/png')).toBe('image');
    expect(panelFileKind('application/octet-stream', 'deck.pptx')).toBe('slides');
    expect(panelFileKind('text/csv')).toBe('sheet');
    expect(fileExtension('q3-report.final.pdf')).toBe('PDF');
    expect(fileExtension('README')).toBe('');
    expect(pluralize(1, 'file')).toBe('1 file');
    expect(pluralize(3, 'reply', 'replies')).toBe('3 replies');
  });
});

describe('rich text', () => {
  const doc = {
    type: 'doc' as const,
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Hi ' },
          { type: 'mention', attrs: { id: 'u-2', label: 'Ethan' } },
        ],
      },
      { type: 'paragraph' },
    ],
  };
  it('extracts text and mentions and detects empty docs', () => {
    expect(docText(doc)).toBe('Hi @Ethan');
    expect(mentionIds(doc)).toEqual(['u-2']);
    expect(isDocEmpty({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe(true);
    expect(isDocEmpty(doc)).toBe(false);
    expect(docText(attachmentOnlyDoc(2))).toBe('Shared 2 files');
  });

  it('only allows http(s) and mailto links', () => {
    expect(safeHref('https://kitstak.example')).toBe('https://kitstak.example');
    expect(safeHref('mailto:a@b.co')).toBe('mailto:a@b.co');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref(42)).toBeNull();
  });
});

describe('item order', () => {
  const groups = [{ id: 'g1' }, { id: 'g2' }] as GroupDto[];
  const item = (id: string, groupId: string, position: string, parentItemId: string | null = null) =>
    ({ id, groupId, position, parentItemId }) as ItemDto;
  const items = [item('c', 'g2', 'a0'), item('b', 'g1', 'a1'), item('a', 'g1', 'a0'), item('s', 'g1', 'a2', 'a'), item('temp-1', 'g1', 'z')];

  it('orders by group then position, skipping subitems and temp rows', () => {
    expect(orderedItemIds(items, groups)).toEqual(['a', 'b', 'c']);
  });

  it('finds neighbors', () => {
    const ids = orderedItemIds(items, groups);
    expect(neighbors(ids, 'b')).toEqual({ prevId: 'a', nextId: 'c', index: 2, total: 3 });
    expect(neighbors(ids, 'a').prevId).toBeNull();
    expect(neighbors(ids, 'zzz')).toEqual({ prevId: null, nextId: null, index: 0, total: 3 });
  });
});

describe('activity', () => {
  const columns = new Map([['stage', { key: 'stage', title: 'Stage' } as ColumnDto]]);
  it('filters by column, person and automation', () => {
    const entry = activity({});
    expect(matchesFilter(entry, NO_FILTER)).toBe(true);
    expect(matchesFilter(entry, { columnKey: 'owner', actorId: null })).toBe(false);
    expect(matchesFilter(entry, { columnKey: 'stage', actorId: 'u1' })).toBe(true);
    expect(matchesFilter(entry, { columnKey: null, actorId: 'automation' })).toBe(false);
    expect(matchesFilter(activity({ automationId: 'x' }), { columnKey: null, actorId: 'automation' })).toBe(true);
  });

  it('groups consecutive entries by local day', () => {
    const entries = [
      activity({ id: '1', createdAt: new Date(2026, 10, 5, 12).toISOString() }),
      activity({ id: '2', createdAt: new Date(2026, 10, 5, 9).toISOString() }),
      activity({ id: '3', createdAt: new Date(2026, 10, 3, 9).toISOString() }),
    ];
    const days = groupByDay(entries);
    expect(days.map((day) => [day.key, day.entries.length])).toEqual([
      ['2026-11-05', 2],
      ['2026-11-03', 1],
    ]);
  });

  it('describes actions with board terminology', () => {
    expect(describeActivity(activity({}), columns, 'Deal')).toBe('changed Stage');
    expect(describeActivity(activity({ columnKey: 'gone' }), columns, 'Deal')).toBe('changed a column that was removed');
    expect(describeActivity(activity({ action: 'item.created', columnKey: null }), columns, 'Deal')).toBe('created this deal');
    expect(describeActivity(activity({ action: 'file.uploaded', after: { name: 'nda.pdf' } }), columns, 'Deal')).toBe(
      'uploaded nda.pdf',
    );
    expect(describeActivity(activity({ action: 'custom.thing' }), columns, 'Deal')).toBe('custom thing');
    expect(isValueChange(activity({}))).toBe(true);
    expect(isValueChange(activity({ action: 'item.renamed' }))).toBe(false);
    expect(activityPreview(activity({ action: 'update.created', after: { preview: 'Hello' } }))).toBe('Hello');
  });

  it('lists distinct actors alphabetically', () => {
    const actors = distinctActors([
      activity({ actorId: 'u2', actorName: 'Zed' }),
      activity({ actorId: 'u1', actorName: 'Ann' }),
      activity({ actorId: 'u2', actorName: 'Zed' }),
      activity({ actorId: null }),
    ]);
    expect(actors.map((actor) => actor.name)).toEqual(['Ann', 'Zed']);
  });
});
