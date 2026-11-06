import { describe, expect, it } from 'vitest';
import {
  allowedPaletteGroups,
  orderPaletteGroups,
  type PaletteSearchDto,
} from '@/server/services/shell-search-model';
import { G_CHORDS, buildNavCommands } from './nav-registry';
import { canManageMembers, isLastOwner } from './pages/workspace-members-model';
import { sortTreeAlpha, type TreeNode } from './sidebar/tree-model';
import { sanitizeTreeSort } from './store';

const empty: PaletteSearchDto = { query: '', items: [], boards: [], dashboards: [], people: [], workspaces: [] };

describe('palette group permissions', () => {
  it('gives owners, members and viewers every group', () => {
    for (const role of ['owner', 'member', 'viewer'] as const) {
      expect([...allowedPaletteGroups({ roles: [role], userId: 'u1' })].sort()).toEqual(
        ['boards', 'dashboards', 'items', 'people', 'workspaces'],
      );
    }
  });

  it('limits guests to items and boards (no dashboards, workspaces or people directory)', () => {
    const groups = allowedPaletteGroups({ roles: ['guest'], userId: 'g1' });
    expect([...groups].sort()).toEqual(['boards', 'items']);
    expect(groups.has('people')).toBe(false);
    expect(groups.has('dashboards')).toBe(false);
    expect(groups.has('workspaces')).toBe(false);
  });

  it('treats system contexts as unrestricted', () => {
    expect(allowedPaletteGroups({ roles: [], userId: null }).size).toBe(5);
  });
});

describe('orderPaletteGroups', () => {
  it('puts an exact board match above partial item matches', () => {
    const data: PaletteSearchDto = {
      ...empty,
      query: 'deal',
      items: [
        { id: 'i1', name: 'E2E panel deal 1', snippet: null, boardId: 'b', boardName: 'Deals', boardKind: 'deals', itemTerminology: 'Deal', groupTitle: 'Open', groupColor: 'blue', status: null },
      ],
      boards: [{ id: 'b', name: 'Deals', kind: 'deals', workspaceId: 'w', workspaceName: 'Sales', folderName: null }],
    };
    expect(orderPaletteGroups('deal', data)).toEqual(['boards', 'items']);
  });

  it('keeps the default order on ties and drops empty groups', () => {
    const data: PaletteSearchDto = {
      ...empty,
      items: [
        { id: 'i1', name: 'Acme renewal', snippet: null, boardId: 'b', boardName: 'Deals', boardKind: 'deals', itemTerminology: 'Deal', groupTitle: 'Open', groupColor: 'blue', status: null },
      ],
      people: [{ id: 'p', name: 'Acme Bot', email: 'bot@acme.test', image: null, title: null, role: 'member' }],
    };
    expect(orderPaletteGroups('acme', data)).toEqual(['items', 'people']);
  });
});

describe('nav registry', () => {
  it('lists CRM pages, dashboards, trash and workspace overviews', () => {
    const list = buildNavCommands({
      orgSlug: 'acme',
      crmBoards: { deals: { id: 'd1' }, contacts: { id: 'c1' } },
      workspaces: [{ id: 'w1', name: 'Sales CRM', color: 'green' }],
      canAdmin: false,
    });
    const ids = list.map((command) => command.id);
    expect(ids).toEqual(expect.arrayContaining(['go-pipeline', 'go-deals', 'go-contacts', 'go-duplicates', 'go-dashboards', 'go-trash', 'go-ws-w1']));
    expect(ids).not.toContain('go-admin');
    expect(list.find((command) => command.id === 'go-deals')?.href).toBe('/acme/boards/d1');
    expect(list.find((command) => command.id === 'go-ws-w1')?.href).toBe('/acme/workspaces/w1');
  });

  it('hides CRM rows until boards are known and shows Admin to admins', () => {
    const ids = buildNavCommands({ orgSlug: 'acme', canAdmin: true }).map((command) => command.id);
    expect(ids).not.toContain('go-pipeline');
    expect(ids).toContain('go-admin');
  });

  it('maps G-chords to routes', () => {
    expect(G_CHORDS.p?.('acme')).toBe('/acme/crm/pipeline');
    expect(G_CHORDS.d?.('acme')).toBe('/acme/dashboards');
    expect(G_CHORDS.h?.('acme')).toBe('/acme');
  });
});

describe('workspace member rules', () => {
  const members = [
    { userId: 'a', role: 'owner' as const },
    { userId: 'b', role: 'member' as const },
  ];
  it('lets workspace owners and org admins manage members, not plain members', () => {
    expect(canManageMembers({ orgRole: 'member', userId: 'a', members })).toBe(true);
    expect(canManageMembers({ orgRole: 'member', userId: 'b', members })).toBe(false);
    expect(canManageMembers({ orgRole: 'admin', userId: 'z', members })).toBe(true);
  });
  it('flags the last owner', () => {
    expect(isLastOwner(members[0]!, members)).toBe(true);
    expect(isLastOwner(members[1]!, members)).toBe(false);
  });
});

describe('tree sort', () => {
  const board = (id: string, name: string): TreeNode => ({ type: 'board', id, board: { id, name } as never });
  it('sorts A–Z per level with folders first', () => {
    const nodes: TreeNode[] = [
      board('2', 'zeta'),
      board('1', 'Alpha'),
      { type: 'folder', id: 'f', folder: { id: 'f', name: 'Folder' } as never, children: [board('4', 'b'), board('3', 'a')] },
    ];
    const sorted = sortTreeAlpha(nodes);
    expect(sorted.map((node) => node.id)).toEqual(['f', '1', '2']);
    const folder = sorted[0];
    expect(folder?.type === 'folder' ? folder.children.map((node) => node.id) : []).toEqual(['3', '4']);
  });
  it('sanitizes persisted sort modes', () => {
    expect(sanitizeTreeSort({ w1: 'alpha', w2: 'weird', w3: 1 })).toEqual({ w1: 'alpha' });
    expect(sanitizeTreeSort(null)).toEqual({});
  });
});
