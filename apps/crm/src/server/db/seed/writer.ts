/** Bulk writers for seed items, links and activity history. */
import type { Executor } from '../index';
import { activityLog, itemLinks, items } from '../schema';
import type { StoredCellValue } from '../schema/cell-values';
import { initialPositions } from '@/server/services/positions';
import type { BoardKey, SeedItem } from './crm-data';

const CHUNK = 400;

async function insertChunked<T>(rows: readonly T[], insert: (chunk: T[]) => Promise<unknown>): Promise<void> {
  for (let start = 0; start < rows.length; start += CHUNK) await insert(rows.slice(start, start + CHUNK));
}

export interface BoardTarget {
  readonly boardId: string;
  readonly groupIds: ReadonlyMap<string, string>;
}

export async function writeItems(
  db: Executor,
  orgId: string,
  targets: ReadonlyMap<BoardKey, BoardTarget>,
  seedItems: readonly SeedItem[],
): Promise<void> {
  const positions = new Map<string, string>();
  const buckets = new Map<string, SeedItem[]>();
  for (const item of seedItems) {
    const bucket = item.parentId ? `parent:${item.parentId}` : `${item.board}:${item.group}`;
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), item]);
  }
  for (const list of buckets.values()) {
    const sorted = [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const keys = initialPositions(sorted.length);
    sorted.forEach((item, index) => positions.set(item.id, keys[index] as string));
  }
  const rowFor = (item: SeedItem) => {
    const target = targets.get(item.board);
    const groupId = target?.groupIds.get(item.group);
    if (!target || !groupId) throw new Error(`Seed: unknown board/group ${item.board}/${item.group}`);
    const lastChange = item.history.at(-1)?.at ?? item.createdAt;
    return {
      id: item.id,
      orgId,
      boardId: target.boardId,
      groupId,
      parentItemId: item.parentId ?? null,
      name: item.name,
      position: positions.get(item.id) as string,
      values: item.values as Record<string, StoredCellValue>,
      createdBy: item.createdBy,
      updatedBy: item.history.at(-1)?.by ?? item.createdBy,
      createdAt: item.createdAt,
      updatedAt: lastChange,
    };
  };
  const topLevel = seedItems.filter((item) => !item.parentId).map(rowFor);
  const subitems = seedItems.filter((item) => item.parentId).map(rowFor);
  await insertChunked(topLevel, (chunk) => db.insert(items).values(chunk));
  await insertChunked(subitems, (chunk) => db.insert(items).values(chunk));
}

/** One link row per connect_boards reference (both directions are already in the values). */
export async function writeLinks(
  db: Executor,
  orgId: string,
  seedItems: readonly SeedItem[],
  connectKeys: ReadonlySet<string>,
): Promise<number> {
  const rows: (typeof itemLinks.$inferInsert)[] = [];
  for (const item of seedItems) {
    for (const [key, value] of Object.entries(item.values)) {
      if (!connectKeys.has(key)) continue;
      const ids = (value as { itemIds?: string[] } | null)?.itemIds ?? [];
      ids.forEach((toItemId, position) =>
        rows.push({
          orgId,
          fromItemId: item.id,
          toItemId,
          columnKey: key,
          position,
          createdBy: item.createdBy,
          createdAt: item.createdAt,
        }),
      );
    }
  }
  await insertChunked(rows, (chunk) => db.insert(itemLinks).values(chunk).onConflictDoNothing());
  return rows.length;
}

export async function writeActivity(
  db: Executor,
  orgId: string,
  targets: ReadonlyMap<BoardKey, BoardTarget>,
  seedItems: readonly SeedItem[],
): Promise<number> {
  const rows: (typeof activityLog.$inferInsert)[] = [];
  for (const item of seedItems) {
    const boardId = targets.get(item.board)?.boardId ?? null;
    rows.push({
      orgId,
      boardId,
      itemId: item.id,
      actorId: item.createdBy,
      action: item.parentId ? 'subitem.created' : 'item.created',
      after: { name: item.name },
      createdAt: item.createdAt,
      updatedAt: item.createdAt,
    });
    for (const change of item.history) {
      rows.push({
        orgId,
        boardId,
        itemId: item.id,
        actorId: change.by,
        action: 'item.value_changed',
        columnKey: change.columnKey,
        before: change.before,
        after: change.after,
        createdAt: change.at,
        updatedAt: change.at,
      });
    }
  }
  await insertChunked(rows, (chunk) => db.insert(activityLog).values(chunk));
  return rows.length;
}
