import { describe, expect, it } from 'vitest';
import type { WorkspaceTreeDto } from '../api';
import { ancestorFolderIds, buildTree, filterTree, nodeName } from './tree-model';

const ws = {
  id: 'w1',
  name: 'Sales',
  description: null,
  icon: null,
  color: 'blue',
  kind: 'open' as const,
  position: 'a0',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function board(id: string, name: string, position: string, folderId: string | null = null) {
  return {
    id,
    workspaceId: 'w1',
    folderId,
    name,
    kind: 'deals' as const,
    description: null,
    icon: null,
    privacy: 'main' as const,
    itemTerminology: 'Deal',
    position,
    archivedAt: null,
    deletedAt: null,
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

const tree: WorkspaceTreeDto = {
  workspace: ws,
  folders: [
    { id: 'f1', workspaceId: 'w1', parentId: null, name: 'Pipeline', color: null, position: 'a1' },
    { id: 'f2', workspaceId: 'w1', parentId: 'f1', name: 'Archive 2025', color: null, position: 'a0' },
  ],
  boards: [
    board('b1', 'Deals', 'a1', 'f1'),
    board('b2', 'Contacts', 'a0'),
    board('b3', 'Old deals', 'a0', 'f2'),
    { ...board('b4', 'Deleted', 'a2'), deletedAt: '2026-02-01T00:00:00Z' },
  ],
  dashboards: [{ id: 'd1', workspaceId: 'w1', name: 'Revenue', position: 'a0' }],
};

describe('buildTree', () => {
  it('nests folders, sorts by position and puts dashboards last', () => {
    // Arrange / Act
    const nodes = buildTree(tree);
    // Assert
    expect(nodes.map(nodeName)).toEqual(['Pipeline', 'Contacts', 'Revenue']);
    const pipeline = nodes[0];
    expect(pipeline?.type).toBe('folder');
    if (pipeline?.type === 'folder')
      expect(pipeline.children.map(nodeName)).toEqual(['Archive 2025', 'Deals']);
  });

  it('omits deleted boards and re-roots orphans whose folder is missing', () => {
    const nodes = buildTree({ ...tree, boards: [board('x', 'Orphan', 'a0', 'missing'), ...tree.boards] });
    expect(nodes.map(nodeName)).toContain('Orphan');
    expect(JSON.stringify(nodes)).not.toContain('Deleted');
  });
});

describe('filterTree', () => {
  it('returns matches with their ancestor folders expanded', () => {
    const result = filterTree(buildTree(tree), 'old');
    expect(result.matchCount).toBe(1);
    expect(result.expand).toEqual(expect.arrayContaining(['f1', 'f2']));
    expect(result.nodes.map(nodeName)).toEqual(['Pipeline']);
  });

  it('returns the input unchanged for an empty query', () => {
    const nodes = buildTree(tree);
    expect(filterTree(nodes, '  ').nodes).toBe(nodes);
  });

  it('returns nothing when no node matches', () => {
    expect(filterTree(buildTree(tree), 'zzz').nodes).toHaveLength(0);
  });
});

describe('ancestorFolderIds', () => {
  it('walks up the folder chain', () => {
    expect(ancestorFolderIds(tree, 'b3')).toEqual(['f2', 'f1']);
    expect(ancestorFolderIds(tree, 'b2')).toEqual([]);
  });
});
