import { describe, expect, it } from 'vitest';
import type { MyWorkBoardDto, MyWorkDto, MyWorkItemDto } from '@/server/services/contracts/inbox-mywork';
import {
  bucketFor,
  buildMyWorkView,
  doneLabelOf,
  formatDueDate,
  isClosedGroup,
  isDone,
  isNeutralDoneLabel,
  isRecordBoard,
  parseIsoDay,
  patchMyWorkItem,
  toIsoDay,
} from './my-work-model';

// Thursday, Nov 5 2026 (local)
const now = new Date(2026, 10, 5, 10, 0);

const board: MyWorkBoardDto = {
  id: 'b1',
  name: 'Deals',
  kind: 'deals',
  itemTerminology: 'Deal',
  canEdit: true,
  recordList: false,
  status: {
    key: 'stage',
    title: 'Stage',
    labels: [
      { id: 'open', name: 'Open', color: 'blue', isDone: false, isClosed: false },
      { id: 'won', name: 'Won', color: 'green', isDone: true, isClosed: true },
      { id: 'lost', name: 'Lost', color: 'red', isDone: false, isClosed: true },
    ],
  },
  date: { key: 'close', title: 'Close date' },
};

const item = (id: string, date: string | null, extra: Partial<MyWorkItemDto> = {}): MyWorkItemDto => ({
  id,
  name: `Item ${id}`,
  boardId: 'b1',
  groupId: 'g1',
  groupTitle: 'Pipeline',
  groupColor: 'blue',
  statusLabelId: 'open',
  date,
  updatedAt: '2026-11-01T00:00:00Z',
  ...extra,
});

describe('bucketFor', () => {
  it.each([
    ['2026-11-04', 'overdue'],
    ['2026-11-05', 'today'],
    ['2026-11-06', 'this-week'],
    ['2026-11-08', 'this-week'], // Sunday ends the week
    ['2026-11-09', 'next-week'],
    ['2026-11-15', 'next-week'],
    ['2026-11-16', 'later'],
  ] as const)('%s → %s', (date, bucket) => {
    expect(bucketFor(date, now)).toBe(bucket);
  });

  it('treats missing and malformed dates as no date', () => {
    expect(bucketFor(null, now)).toBe('no-date');
    expect(bucketFor('11/05/2026', now)).toBe('no-date');
  });

  it('handles a Sunday "today" (week still ends that day)', () => {
    const sunday = new Date(2026, 10, 8, 9);
    expect(bucketFor('2026-11-09', sunday)).toBe('next-week');
    expect(bucketFor('2026-11-16', sunday)).toBe('later');
  });
});

describe('iso day helpers', () => {
  it('round-trips local dates', () => {
    expect(toIsoDay(new Date(2026, 0, 3))).toBe('2026-01-03');
    expect(parseIsoDay('2026-01-03')?.getDate()).toBe(3);
    expect(parseIsoDay('nope')).toBeNull();
  });
});

describe('done detection', () => {
  it('uses the board label done flag', () => {
    expect(isDone(board, { statusLabelId: 'won' })).toBe(true);
    expect(isDone(board, { statusLabelId: 'open' })).toBe(false);
    expect(isDone(board, { statusLabelId: null })).toBe(false);
    expect(doneLabelOf(board)?.id).toBe('won');
    expect(doneLabelOf({ ...board, status: null })).toBeNull();
  });

  it('treats closed outcomes (Lost, Cancelled) as done, never overdue', () => {
    expect(isDone(board, { statusLabelId: 'lost' })).toBe(true);
    const data: MyWorkDto = {
      boards: [board],
      items: [item('lost', '2026-10-01', { statusLabelId: 'lost' }), item('open', '2026-10-02')],
      truncated: false,
    };
    const view = buildMyWorkView(data, { boardId: null, search: '', showDone: false }, now);
    expect(view.sections.flatMap((section) => section.rows.map((row) => row.item.id))).toEqual(['open']);
    expect(view.hiddenDone).toBe(1);
  });

  it('treats items in closed or completed groups as done', () => {
    expect(isClosedGroup('Closed lost')).toBe(true);
    expect(isClosedGroup('Completed')).toBe(true);
    expect(isClosedGroup('Pipeline')).toBe(false);
    expect(isDone(board, { statusLabelId: 'open', groupTitle: 'Closed lost' })).toBe(true);
    expect(isDone(board, { statusLabelId: null, groupTitle: 'Completed' })).toBe(true);
    expect(isDone(board, { statusLabelId: 'open', groupTitle: 'In progress' })).toBe(false);
  });
});

describe('buildMyWorkView', () => {
  const data: MyWorkDto = {
    boards: [board, { ...board, id: 'b2', name: 'Leads' }],
    items: [
      item('a', '2026-11-01'),
      item('b', '2026-11-05'),
      item('c', null),
      item('d', '2026-11-03', { statusLabelId: 'won' }),
      item('e', '2026-12-01', { boardId: 'b2', name: 'Acme expansion' }),
      item('orphan', null, { boardId: 'missing' }),
    ],
    truncated: false,
  };

  it('groups into ordered sections and hides done items by default', () => {
    const view = buildMyWorkView(data, { boardId: null, search: '', showDone: false }, now);
    expect(view.sections.map((section) => section.id)).toEqual(['overdue', 'today', 'later', 'no-date']);
    expect(view.total).toBe(4);
    expect(view.hiddenDone).toBe(1);
  });

  it('shows done items when asked, sorted by date', () => {
    const view = buildMyWorkView(data, { boardId: null, search: '', showDone: true }, now);
    expect(view.sections[0]?.rows.map((row) => row.item.id)).toEqual(['a', 'd']);
    expect(view.sections[0]?.rows[1]?.done).toBe(true);
  });

  it('filters by board and multi-term search', () => {
    expect(buildMyWorkView(data, { boardId: 'b2', search: '', showDone: false }, now).total).toBe(1);
    const searched = buildMyWorkView(data, { boardId: null, search: 'acme leads', showDone: false }, now);
    expect(searched.sections.flatMap((section) => section.rows.map((row) => row.item.id))).toEqual(['e']);
    expect(buildMyWorkView(data, { boardId: null, search: 'zzz', showDone: false }, now).sections).toEqual(
      [],
    );
  });

  it('keeps record boards and boards without a date column out unless asked', () => {
    const contacts: MyWorkBoardDto = {
      ...board,
      id: 'c',
      name: 'Contacts',
      kind: 'contacts',
      recordList: true,
    };
    const notes: MyWorkBoardDto = { ...board, id: 'n', name: 'Notes', date: null };
    expect(isRecordBoard(contacts)).toBe(true);
    expect(isRecordBoard(notes)).toBe(true);
    expect(isRecordBoard(board)).toBe(false);
    const withRecords: MyWorkDto = {
      boards: [board, contacts, notes],
      items: [item('t', '2026-11-05'), item('p', null, { boardId: 'c' }), item('q', null, { boardId: 'n' })],
      truncated: false,
    };
    const hidden = buildMyWorkView(withRecords, { boardId: null, search: '', showDone: false }, now);
    expect(hidden.total).toBe(1);
    expect(hidden.hiddenRecords).toBe(2);
    expect(hidden.sections.map((section) => section.id)).toEqual(['today']);
    const shown = buildMyWorkView(
      withRecords,
      { boardId: null, search: '', showDone: false, showRecords: true },
      now,
    );
    expect(shown.sections.map((section) => section.id)).toEqual(['today', 'records']);
    expect(shown.total).toBe(3);
  });
});

describe('patchMyWorkItem', () => {
  it('returns a new payload without mutating', () => {
    const data: MyWorkDto = { boards: [board], items: [item('a', null)], truncated: false };
    const next = patchMyWorkItem(data, 'a', { date: '2026-11-07' });
    expect(next.items[0]?.date).toBe('2026-11-07');
    expect(data.items[0]?.date).toBeNull();
  });
});

describe('formatDueDate', () => {
  it('uses one format per bucket', () => {
    expect(formatDueDate('2026-11-05', now)).toBe('Today');
    expect(formatDueDate('2026-11-06', now)).toBe('Fri, Nov 6');
    expect(formatDueDate('2026-11-09', now)).toBe('Mon, Nov 9');
    expect(formatDueDate('2026-11-14', now)).toBe('Sat, Nov 14');
    expect(formatDueDate('2026-11-04', now)).toBe('Nov 4');
    expect(formatDueDate('2026-12-24', now)).toBe('Dec 24');
    expect(formatDueDate('2027-01-02', now)).toBe('Jan 2, 2027');
    expect(formatDueDate('2025-12-30', now)).toBe('Dec 30, 2025');
    expect(formatDueDate('bad', now)).toBe('bad');
  });

  it('respects an explicit bucket', () => {
    expect(formatDueDate('2026-11-10', now, 'next-week')).toBe('Tue, Nov 10');
    expect(formatDueDate('2026-11-10', now, 'later')).toBe('Nov 10');
  });
});

describe('isNeutralDoneLabel', () => {
  it('allows plain completion labels only', () => {
    expect(isNeutralDoneLabel({ name: 'Done' })).toBe(true);
    expect(isNeutralDoneLabel({ name: ' Completed ' })).toBe(true);
    expect(isNeutralDoneLabel({ name: 'Won' })).toBe(false);
    expect(isNeutralDoneLabel({ name: 'Closed won' })).toBe(false);
    expect(isNeutralDoneLabel(null)).toBe(false);
  });
});

describe('finished past-dates section', () => {
  it('is titled Completed in the neutral tone when every row is done', () => {
    const data: MyWorkDto = {
      boards: [board],
      items: [item('a', '2026-11-01', { statusLabelId: 'won' }), item('b', '2026-11-02', { statusLabelId: 'lost' })],
      truncated: false,
    };
    const view = buildMyWorkView(data, { boardId: null, search: '', showDone: true }, now);
    expect(view.sections[0]).toMatchObject({ id: 'overdue', title: 'Completed', tone: 'neutral' });
  });

  it('stays red Past dates while any row is still open', () => {
    const data: MyWorkDto = {
      boards: [board],
      items: [item('a', '2026-11-01', { statusLabelId: 'won' }), item('b', '2026-11-02')],
      truncated: false,
    };
    const view = buildMyWorkView(data, { boardId: null, search: '', showDone: true }, now);
    expect(view.sections[0]).toMatchObject({ id: 'overdue', title: 'Past dates', tone: 'danger' });
  });
});
