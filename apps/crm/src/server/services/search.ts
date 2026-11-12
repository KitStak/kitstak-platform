/**
 * Global search: Postgres full-text over item names + every string cell value, update
 * bodies, and name matches for boards / workspaces. Org-scoped and limited to boards the
 * caller can see; results are ranked with ts_rank and recency.
 */
import { and, desc, eq, ilike, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { boards, groups, items, updates, workspaces } from '@/server/db/schema';
import { visibleBoardsPredicate } from './access';
import { isOrgAdmin, type ServiceContext } from './context';
import type { SearchResultDto, SearchResultType } from './contracts/dto';

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  types: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      const list = value === undefined ? [] : Array.isArray(value) ? value : value.split(',');
      const allowed: SearchResultType[] = ['item', 'board', 'update', 'workspace'];
      const picked = list.filter((entry): entry is SearchResultType => (allowed as string[]).includes(entry));
      return picked.length > 0 ? picked : allowed;
    }),
  boardId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/** Turn free text into a safe prefix tsquery string (`foo:* & bar:*`), or null if nothing usable. */
export function toPrefixTsQuery(input: string): string | null {
  const tokens = input
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0)
    .slice(0, 8);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `${token}:*`).join(' & ');
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Item search vector — MUST match the `items_search_idx` expression to use the index. */
const itemVector = sql`(to_tsvector('simple'::regconfig, ${items.name}) || jsonb_to_tsvector('simple'::regconfig, ${items.values}, '["string"]'::jsonb))`;

function snippetFromValues(values: Record<string, unknown>, query: string): string | null {
  const tokens = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const strings: string[] = [];
  const walk = (value: unknown, depth: number) => {
    if (depth > 3) return;
    if (typeof value === 'string') strings.push(value);
    else if (Array.isArray(value)) value.forEach((entry) => walk(entry, depth + 1));
    else if (value && typeof value === 'object')
      Object.values(value).forEach((entry) => walk(entry, depth + 1));
  };
  walk(values, 0);
  const hit = strings.find((text) => tokens.some((token) => text.toLowerCase().includes(token)));
  return hit ? hit.slice(0, 160) : null;
}

export async function search(ctx: ServiceContext, query: SearchQuery): Promise<SearchResultDto[]> {
  const tsquery = toPrefixTsQuery(query.q);
  const results: SearchResultDto[] = [];
  const boardScope = query.boardId ? [eq(boards.id, query.boardId)] : [];
  const like = `%${escapeLike(query.q)}%`;

  if (tsquery && query.types.includes('item')) {
    const q = sql`to_tsquery('simple', ${tsquery})`;
    const rows = await ctx.db
      .select({
        id: items.id,
        name: items.name,
        values: items.values,
        boardId: items.boardId,
        boardName: boards.name,
        groupTitle: groups.title,
        updatedAt: items.updatedAt,
        rank: sql<number>`ts_rank(${itemVector}, ${q})`,
      })
      .from(items)
      .innerJoin(boards, eq(boards.id, items.boardId))
      .innerJoin(groups, eq(groups.id, items.groupId))
      .where(
        and(
          eq(items.orgId, ctx.orgId),
          isNull(items.deletedAt),
          isNull(items.archivedAt),
          sql`${itemVector} @@ ${q}`,
          visibleBoardsPredicate(ctx),
          isNull(boards.archivedAt),
          ...boardScope,
        ),
      )
      .orderBy(desc(sql`ts_rank(${itemVector}, ${q})`), desc(items.updatedAt))
      .limit(query.limit);
    for (const row of rows) {
      const nameHit = row.name.toLowerCase().includes(query.q.toLowerCase());
      results.push({
        type: 'item',
        id: row.id,
        title: row.name,
        snippet: nameHit ? null : snippetFromValues(row.values, query.q),
        boardId: row.boardId,
        boardName: row.boardName,
        itemId: row.id,
        groupTitle: row.groupTitle,
        // Exact name matches float to the top.
        rank: Number(row.rank) + (nameHit ? 1 : 0),
        updatedAt: row.updatedAt.toISOString(),
      });
    }
  }

  if (tsquery && query.types.includes('update')) {
    const q = sql`to_tsquery('simple', ${tsquery})`;
    const vector = sql`to_tsvector('simple'::regconfig, ${updates.bodyText})`;
    const rows = await ctx.db
      .select({
        id: updates.id,
        itemId: updates.itemId,
        itemName: items.name,
        boardId: updates.boardId,
        boardName: boards.name,
        createdAt: updates.createdAt,
        rank: sql<number>`ts_rank(${vector}, ${q})`,
        snippet: sql<string>`ts_headline('simple', ${updates.bodyText}, ${q}, 'StartSel="",StopSel="",MaxWords=24,MinWords=10,MaxFragments=1')`,
      })
      .from(updates)
      .innerJoin(items, eq(items.id, updates.itemId))
      .innerJoin(boards, eq(boards.id, updates.boardId))
      .where(
        and(
          eq(updates.orgId, ctx.orgId),
          isNull(updates.deletedAt),
          isNull(items.deletedAt),
          sql`${vector} @@ ${q}`,
          visibleBoardsPredicate(ctx),
          ...boardScope,
        ),
      )
      .orderBy(desc(sql`ts_rank(${vector}, ${q})`), desc(updates.createdAt))
      .limit(query.limit);
    for (const row of rows) {
      results.push({
        type: 'update',
        id: row.id,
        title: row.itemName,
        snippet: row.snippet,
        boardId: row.boardId,
        boardName: row.boardName,
        itemId: row.itemId,
        groupTitle: null,
        rank: Number(row.rank) * 0.8,
        updatedAt: row.createdAt.toISOString(),
      });
    }
  }

  if (query.types.includes('board') && !query.boardId) {
    const rows = await ctx.db
      .select({
        id: boards.id,
        name: boards.name,
        description: boards.description,
        updatedAt: boards.updatedAt,
        workspaceName: workspaces.name,
      })
      .from(boards)
      .innerJoin(workspaces, eq(workspaces.id, boards.workspaceId))
      .where(and(visibleBoardsPredicate(ctx), isNull(boards.archivedAt), ilike(boards.name, like)))
      .orderBy(desc(boards.updatedAt))
      .limit(query.limit);
    for (const row of rows) {
      const exact = row.name.toLowerCase().startsWith(query.q.toLowerCase());
      results.push({
        type: 'board',
        id: row.id,
        title: row.name,
        snippet: row.workspaceName,
        boardId: row.id,
        boardName: row.name,
        itemId: null,
        groupTitle: null,
        rank: exact ? 2 : 1.5,
        updatedAt: row.updatedAt.toISOString(),
      });
    }
  }

  if (query.types.includes('workspace') && !query.boardId) {
    const rows = await ctx.db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        kind: workspaces.kind,
        updatedAt: workspaces.updatedAt,
      })
      .from(workspaces)
      .where(and(eq(workspaces.orgId, ctx.orgId), isNull(workspaces.deletedAt), ilike(workspaces.name, like)))
      .limit(query.limit);
    for (const row of rows) {
      if (row.kind === 'closed' && !isOrgAdmin(ctx)) continue; // closed workspaces are listed via the sidebar only
      results.push({
        type: 'workspace',
        id: row.id,
        title: row.name,
        snippet: null,
        boardId: null,
        boardName: null,
        itemId: null,
        groupTitle: null,
        rank: 1.2,
        updatedAt: row.updatedAt.toISOString(),
      });
    }
  }

  return results
    .sort((a, b) => b.rank - a.rank || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, query.limit * 2);
}
