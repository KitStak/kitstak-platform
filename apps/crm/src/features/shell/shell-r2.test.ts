import { describe, expect, it } from 'vitest';
import { columnsThatFit } from '@/features/home/format';
import { filterToQuery, pickEnterTarget, type PaletteSearchDto } from '@/server/services/shell-search-model';
import { readFolderIcons, writeFolderIcon } from '@/server/services/shell-folders-model';
import { filterAndSort, contentRows } from './pages/workspace-content-model';
import { parseWorkspaceParams, workspaceParamEntries } from './pages/workspace-url-model';
import type { WorkspaceTreeDto } from './api';

const salesResults: PaletteSearchDto = {
  query: 'sales',
  items: [
    {
      id: 'i1',
      name: 'Sales kickoff',
      snippet: null,
      boardId: 'b1',
      boardName: 'Deals',
      boardKind: 'deals',
      itemTerminology: 'Deal',
      groupTitle: 'Open',
      groupColor: 'blue',
      status: null,
    },
    {
      id: 'i2',
      name: 'Inbound leads from sales site',
      snippet: null,
      boardId: 'b2',
      boardName: 'Leads',
      boardKind: 'leads',
      itemTerminology: 'Lead',
      groupTitle: 'New',
      groupColor: 'green',
      status: null,
    },
  ],
  boards: [{ id: 'b9', name: 'Sales Dashboard board', kind: 'custom', workspaceId: 'w', workspaceName: 'Sales CRM', folderName: null }],
  dashboards: [{ id: 'd1', name: 'Sales Dashboard', workspaceId: 'w', workspaceName: 'Sales CRM' }],
  people: [{ id: 'u1', name: 'Sam Leads', email: 'sam@example.com', image: null, title: null, role: 'member' }],
  workspaces: [{ id: 'w', name: 'Sales CRM', color: 'blue', kind: 'open' }],
};

describe('palette stale results', () => {
  it('keeps only rows of an older query that also match the current text', () => {
    const filtered = filterToQuery('leads', salesResults);
    expect(filtered.items.map((item) => item.id)).toEqual(['i2']);
    expect(filtered.dashboards).toEqual([]);
    expect(filtered.boards).toEqual([]);
    expect(filtered.workspaces).toEqual([]);
    expect(filtered.people.map((person) => person.id)).toEqual(['u1']);
    expect(filtered.query).toBe('leads');
  });

  it('never surfaces the old top match (Sales Dashboard) for a non-matching query', () => {
    const filtered = filterToQuery('zzz', salesResults);
    const total =
      filtered.items.length + filtered.boards.length + filtered.dashboards.length + filtered.people.length + filtered.workspaces.length;
    expect(total).toBe(0);
  });

  it('Enter opens the still-listed selection, else the first fresh row', () => {
    expect(pickEnterTarget('item:i2', ['item:i1', 'item:i2'])).toBe('item:i2');
    expect(pickEnterTarget('dashboard:d1', ['item:i2', 'nav:go-home'])).toBe('item:i2');
    expect(pickEnterTarget('x', [])).toBeNull();
  });
});

describe('home recents row', () => {
  it('fits whole cards only, at least one', () => {
    expect(columnsThatFit(1098, 220, 12)).toBe(4);
    expect(columnsThatFit(1578, 220, 12)).toBe(6);
    expect(columnsThatFit(100, 220, 12)).toBe(1);
    expect(columnsThatFit(0, 220, 12)).toBe(1);
    expect(columnsThatFit(Number.NaN, 220, 12)).toBe(1);
  });
});

describe('folder icons in org metadata', () => {
  it('writes one icon and preserves every other metadata key', () => {
    const before = JSON.stringify({ kitstak: { settings: { a: 1 } }, shell: { other: true, folderIcons: { f0: 'star' } } });
    const after = writeFolderIcon(before, 'f1', 'rocket');
    const parsed = JSON.parse(after) as { kitstak: unknown; shell: { other: boolean } };
    expect(parsed.kitstak).toEqual({ settings: { a: 1 } });
    expect(parsed.shell.other).toBe(true);
    expect(readFolderIcons(after)).toEqual({ f0: 'star', f1: 'rocket' });
  });

  it('removes an icon with null and ignores unknown / malformed values', () => {
    const withTwo = writeFolderIcon(writeFolderIcon(null, 'a', 'flag'), 'b', 'heart');
    expect(readFolderIcons(writeFolderIcon(withTwo, 'a', null))).toEqual({ b: 'heart' });
    expect(readFolderIcons('{"shell":{"folderIcons":{"x":"<script>","y":"globe"}}}')).toEqual({ y: 'globe' });
    expect(readFolderIcons('not json')).toEqual({});
    expect(readFolderIcons(undefined)).toEqual({});
  });
});

describe('workspace overview URL state', () => {
  const uuid = '6512dd18-4bb7-416f-9add-05a1908e39bb';
  const from = (query: string) => {
    const params = new URLSearchParams(query);
    return parseWorkspaceParams((key) => params.get(key));
  };

  it('parses valid params and falls back to defaults for junk', () => {
    expect(from(`tab=members&type=board&sort=name&q=deal&folder=${uuid}`)).toEqual({
      tab: 'members',
      type: 'board',
      sort: 'name',
      q: 'deal',
      folder: uuid,
    });
    expect(from('tab=evil&type=x&sort=y&folder=../../etc')).toEqual({
      tab: 'content',
      type: 'all',
      sort: 'updated',
      q: '',
      folder: null,
    });
  });

  it('omits defaults when writing', () => {
    expect(workspaceParamEntries({ tab: 'content', q: ' ', type: 'all', sort: 'updated', folder: null })).toEqual({
      tab: null,
      q: null,
      type: null,
      sort: null,
      folder: null,
    });
    expect(workspaceParamEntries({ tab: 'members', q: 'x', type: 'folder', sort: 'type', folder: uuid })).toEqual({
      tab: 'members',
      q: 'x',
      type: 'folder',
      sort: 'type',
      folder: uuid,
    });
  });

  it('filters content to the direct children of a folder', () => {
    const tree = {
      workspace: { id: 'w' },
      folders: [
        { id: 'f1', workspaceId: 'w', parentId: null, name: 'Pipeline', color: null, position: 'a' },
        { id: 'f2', workspaceId: 'w', parentId: 'f1', name: 'Nested', color: null, position: 'b' },
      ],
      boards: [
        { id: 'b1', folderId: 'f1', name: 'Deals', kind: 'deals', updatedAt: '2026-01-01', archivedAt: null, deletedAt: null },
        { id: 'b2', folderId: null, name: 'Root', kind: 'custom', updatedAt: '2026-01-02', archivedAt: null, deletedAt: null },
      ],
      dashboards: [],
    } as unknown as WorkspaceTreeDto;
    const rows = filterAndSort(contentRows(tree), { type: 'all', query: '', sort: 'name', folderId: 'f1' });
    expect(rows.map((row) => row.id)).toEqual(['b1', 'f2']);
  });
});
