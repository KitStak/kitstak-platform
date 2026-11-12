import { describe, expect, it } from 'vitest';
import {
  highlightParts,
  matchScore,
  matchesStrictly,
  queryTokens,
  rankByMatch,
} from '@/server/services/shell-search-model';
import {
  isClosedLabelName,
  isDeadlineColumnTitle,
  pickDueWork,
  pickStatusColumn,
  weekWindow,
  type WorkCandidate,
} from '@/server/services/shell-home-model';
import { shouldTrackLinkClick } from './route-progress-model';
import { applyMove, dropPositionFor, isInsideFolder, resolveDrop } from './sidebar/tree-dnd';
import { contentRows, filterAndSort } from './pages/workspace-content-model';
import type { BoardSummaryDto, FolderDto, WorkspaceTreeDto } from './api';

const folder = (id: string, parentId: string | null, position: string, name = id): FolderDto => ({
  id,
  workspaceId: 'w',
  parentId,
  name,
  color: 'blue',
  position,
});
const board = (id: string, folderId: string | null, position: string, extra: Partial<BoardSummaryDto> = {}): BoardSummaryDto => ({
  id,
  workspaceId: 'w',
  folderId,
  name: id,
  kind: 'deals',
  description: null,
  icon: null,
  privacy: 'main',
  itemTerminology: 'Deal',
  position,
  archivedAt: null,
  deletedAt: null,
  updatedAt: '2026-11-01T00:00:00.000Z',
  ...extra,
});
const tree: WorkspaceTreeDto = {
  workspace: { id: 'w', name: 'W', description: null, icon: null, color: 'blue', kind: 'open', position: 'a0', createdAt: '', updatedAt: '' },
  folders: [folder('f1', null, 'a0', 'Pipeline'), folder('f2', 'f1', 'a0', 'Nested')],
  boards: [board('b1', null, 'a0'), board('b2', null, 'a1'), board('b3', 'f1', 'a0', { updatedAt: '2026-11-04T00:00:00.000Z' })],
  dashboards: [{ id: 'd1', workspaceId: 'w', name: 'Sales dashboard', position: 'a0' }],
};

describe('palette matching', () => {
  it('tokenizes and requires every word (strict)', () => {
    expect(queryTokens('  Beacon  Pharma ')).toEqual(['beacon', 'pharma']);
    expect(matchesStrictly('beacon pha', 'Beacon Pharma DC7')).toBe(true);
    expect(matchesStrictly('beacon labs', 'Beacon Pharma')).toBe(false);
    expect(matchesStrictly('', 'anything')).toBe(false);
  });

  it('ranks exact > prefix > word prefix > substring', () => {
    expect(matchScore('deals', 'Deals')).toBe(3);
    expect(matchScore('dea', 'Deals')).toBe(2);
    expect(matchScore('pip', 'Sales pipeline')).toBe(1);
    expect(matchScore('ipe', 'Sales pipeline')).toBe(0);
    expect(rankByMatch('lea', ['Release leads', 'Leads', 'Leads archive'], (x) => x)).toEqual([
      'Leads',
      'Leads archive',
      'Release leads',
    ]);
  });

  it('highlights every token occurrence and keeps all text', () => {
    const parts = highlightParts('Beacon Pharma beacon', 'beacon');
    expect(parts.map((p) => p.text).join('')).toBe('Beacon Pharma beacon');
    expect(parts.filter((p) => p.match).map((p) => p.text)).toEqual(['Beacon', 'beacon']);
    expect(highlightParts('abc', '')).toEqual([{ text: 'abc', match: false }]);
  });
});

describe('home model', () => {
  const candidate = (id: string, dueDate: string, extra: Partial<WorkCandidate> = {}): WorkCandidate => ({
    id,
    name: id,
    boardId: 'b',
    boardName: 'Deals',
    boardKind: 'deals',
    groupTitle: 'G',
    groupColor: 'blue',
    dueDate,
    status: null,
    done: false,
    ...extra,
  });

  it('keeps open work due by the end of the week, overdue first, deduped', () => {
    const result = pickDueWork(
      [
        candidate('later', '2026-11-20'),
        candidate('soon', '2026-11-07'),
        candidate('late', '2026-11-01'),
        candidate('soon', '2026-11-07'),
        candidate('closed', '2026-11-06', { done: true }),
        candidate('nodate', ''),
      ],
      '2026-11-05',
      '2026-11-08',
      10,
    );
    expect(result.map((item) => [item.id, item.overdue])).toEqual([
      ['late', true],
      ['soon', false],
    ]);
  });

  it('computes the local week window', () => {
    const window = weekWindow(new Date(2026, 10, 5, 15)); // Thursday
    expect(window).toEqual({ today: '2026-11-05', weekEnd: '2026-11-08', overdueFrom: '2026-10-06' });
    expect(weekWindow(new Date(2026, 10, 8)).weekEnd).toBe('2026-11-08'); // Sunday
  });

  it('recognises deadline columns and closed labels', () => {
    expect(isDeadlineColumnTitle('Due date')).toBe(true);
    expect(isDeadlineColumnTitle('Expected close')).toBe(true);
    expect(isDeadlineColumnTitle('Last contacted')).toBe(false);
    expect(isDeadlineColumnTitle('Owner')).toBe(false);
    expect(isClosedLabelName('Cancelled')).toBe(true);
    expect(isClosedLabelName('Won')).toBe(true);
    expect(isClosedLabelName('Working on it')).toBe(false);
    expect(isClosedLabelName(undefined)).toBe(false);
  });

  it('prefers the progress status column', () => {
    expect(pickStatusColumn([])).toBe(-1);
    expect(pickStatusColumn([{ title: 'Size', labels: [] }, { title: 'Stage', labels: [] }])).toBe(1);
    expect(pickStatusColumn([{ title: 'Status', labels: [] }, { title: 'Health', labels: [{ isDone: true }] }])).toBe(1);
    expect(pickStatusColumn([{ title: 'Type', labels: [] }])).toBe(0);
  });
});

describe('route progress', () => {
  const base = {
    target: '',
    download: false,
    button: 0,
    modified: false,
    defaultPrevented: false,
    current: 'http://localhost:3100/acme',
  };
  it('tracks plain same-origin navigations only', () => {
    expect(shouldTrackLinkClick({ ...base, href: 'http://localhost:3100/acme/inbox' })).toBe(true);
    expect(shouldTrackLinkClick({ ...base, href: 'http://localhost:3100/acme#x' })).toBe(false);
    expect(shouldTrackLinkClick({ ...base, href: 'https://example.com/' })).toBe(false);
    expect(shouldTrackLinkClick({ ...base, href: 'http://localhost:3100/acme/inbox', modified: true })).toBe(false);
    expect(shouldTrackLinkClick({ ...base, href: 'http://localhost:3100/acme/inbox', target: '_blank' })).toBe(false);
    expect(shouldTrackLinkClick({ ...base, href: 'mailto:a@b.c' })).toBe(false);
  });
});

describe('tree drag and drop', () => {
  it('maps pointer position to drop zones', () => {
    const rect = { top: 100, height: 32 };
    expect(dropPositionFor('folder', 102, rect)).toBe('before');
    expect(dropPositionFor('folder', 116, rect)).toBe('inside');
    expect(dropPositionFor('folder', 130, rect)).toBe('after');
    expect(dropPositionFor('board', 110, rect)).toBe('before');
    expect(dropPositionFor('board', 125, rect)).toBe('after');
  });

  it('detects nesting', () => {
    expect(isInsideFolder(tree.folders, 'f1', 'f2')).toBe(true);
    expect(isInsideFolder(tree.folders, 'f2', 'f1')).toBe(false);
    expect(isInsideFolder(tree.folders, 'f1', null)).toBe(false);
  });

  it('resolves reorders, moves into folders and rejects no-ops / cycles', () => {
    expect(resolveDrop(tree, { id: 'b2', type: 'board', parentId: null }, { id: 'b1', type: 'board', parentId: null }, 'before')).toEqual({
      type: 'board',
      id: 'b2',
      folderId: null,
      placement: { beforeId: 'b1' },
    });
    expect(resolveDrop(tree, { id: 'b1', type: 'board', parentId: null }, { id: 'f1', type: 'folder', parentId: null }, 'inside')).toEqual({
      type: 'board',
      id: 'b1',
      folderId: 'f1',
      placement: {},
    });
    expect(resolveDrop(tree, { id: 'f1', type: 'folder', parentId: null }, { id: 'f2', type: 'folder', parentId: 'f1' }, 'inside')).toBeNull();
    expect(resolveDrop(tree, { id: 'b1', type: 'board', parentId: null }, { id: 'b1', type: 'board', parentId: null }, 'after')).toBeNull();
    expect(resolveDrop(tree, { id: 'd1', type: 'dashboard', parentId: null }, { id: 'b1', type: 'board', parentId: null }, 'after')).toBeNull();
  });

  it('applies moves optimistically with a sortable position', () => {
    const moved = applyMove(tree, { type: 'board', id: 'b2', folderId: null, placement: { beforeId: 'b1' } });
    const roots = moved.boards.filter((b) => b.folderId === null).sort((a, b) => (a.position < b.position ? -1 : 1));
    expect(roots.map((b) => b.id)).toEqual(['b2', 'b1']);
    const into = applyMove(tree, { type: 'board', id: 'b1', folderId: 'f1', placement: {} });
    expect(into.boards.find((b) => b.id === 'b1')?.folderId).toBe('f1');
    expect(tree.boards.find((b) => b.id === 'b1')?.folderId).toBeNull(); // input untouched
  });
});

describe('workspace content listing', () => {
  const rows = contentRows(tree);
  it('lists folders, boards and dashboards with folder names', () => {
    expect(rows).toHaveLength(6);
    expect(rows.find((row) => row.id === 'b3')?.folderName).toBe('Pipeline');
    expect(rows.find((row) => row.id === 'f1' && row.type === 'folder')).toMatchObject({ childCount: 2 });
  });
  it('filters by type and query and sorts', () => {
    expect(filterAndSort(rows, { type: 'board', query: '', sort: 'name' }).map((r) => r.id)).toEqual(['b1', 'b2', 'b3']);
    expect(filterAndSort(rows, { type: 'all', query: 'sales', sort: 'name' }).map((r) => r.id)).toEqual(['d1']);
    expect(filterAndSort(rows, { type: 'all', query: '', sort: 'updated' })[0]?.id).toBe('b3');
    expect(filterAndSort(rows, { type: 'all', query: '', sort: 'type' })[0]?.type).toBe('folder');
  });
});
