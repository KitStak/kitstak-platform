/** Bulk writers for seed items, links and activity history. */
import { and, inArray, isNull, sql } from 'drizzle-orm';
import { customerLinks, customers as coreCustomers } from '@kitstak/db/schema';
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

/**
 * WMS seed clients paired with a name-adjacent CRM account-name prefix, so demos show a
 * plausible "Warehouse (WMS)" link out of the box (e.g. "Apex Threads Co." under the account
 * "Apex Freight"). Order matters: the first unused account wins.
 */
const WMS_PAIRINGS: ReadonlyArray<readonly [code: string, namePrefix: string]> = [
  ['APX', 'Apex '],
  ['HRB', 'Harbor '],
  ['SMT', 'Summit '],
];

/**
 * Pre-link 2–3 seeded accounts to WMS clients mirrored into `core.customers` (demo pairing
 * only). Fail-soft: when the core registry tables are absent (CRM-only database) or the WMS
 * seed has not run, nothing is written and the seed carries on.
 */
export async function writeWmsLinks(
  db: Executor,
  orgId: string,
  accountsBoardId: string | undefined,
  accounts: readonly SeedItem[],
): Promise<number> {
  if (!accountsBoardId) return 0;
  const probe = await db.execute<{ ok: boolean }>(
    sql`select to_regclass('core.customers') is not null and to_regclass('crm.customer_links') is not null as ok`,
  );
  if (probe.rows[0]?.ok !== true) return 0;
  const candidates = await db
    .select({ id: coreCustomers.id, code: coreCustomers.code })
    .from(coreCustomers)
    .where(
      and(
        inArray(
          coreCustomers.code,
          WMS_PAIRINGS.map(([code]) => code),
        ),
        isNull(coreCustomers.deletedAt),
      ),
    );
  const customerByCode = new Map(candidates.map((row) => [row.code, row.id]));
  const used = new Set<string>();
  const rows: (typeof customerLinks.$inferInsert)[] = [];
  for (const [code, namePrefix] of WMS_PAIRINGS) {
    const coreCustomerId = customerByCode.get(code);
    if (!coreCustomerId) continue;
    // Prefer the name-adjacent account; fall back to the first unused customer account so the
    // demo still shows 2–3 links when the RNG sampled no matching company name.
    const account =
      accounts.find((entry) => !used.has(entry.id) && entry.name.startsWith(namePrefix)) ??
      accounts.find((entry) => !used.has(entry.id) && entry.group === 'customers');
    if (!account) continue;
    used.add(account.id);
    rows.push({ coreCustomerId, orgId, boardId: accountsBoardId, itemId: account.id });
  }
  if (rows.length > 0) await db.insert(customerLinks).values(rows).onConflictDoNothing();
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
