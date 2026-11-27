/**
 * CRM tools (boards of leads, contacts, accounts, deals...). The `crm` schema is shared by
 * every org, so every query filters on the configured org id. Private and shareable boards
 * and closed workspaces are left out unless KITSTAK_MCP_INCLUDE_PRIVATE=1.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MAX_LIMIT } from './config.js';
import { readShared, type Org, type Sql, type Tx } from './db.js';
import { fail, json, like, limitArg, READ_ONLY } from './util.js';

export interface CrmContext {
  readonly sql: Sql;
  readonly org: Org;
  readonly defaultLimit: number;
  readonly includePrivate: boolean;
  /** Whether the role can read core."user" names (people columns, update authors). */
  readonly canReadUsers: boolean;
}

interface Column {
  readonly board_id: string;
  readonly key: string;
  readonly title: string;
  readonly type: string;
  readonly settings: { labels?: { id: string; name: string }[] } | null;
}

const COMPUTED = new Set([
  'progress',
  'mirror',
  'formula',
  'last_updated',
  'creation_log',
  'item_id',
  'button',
]);
const BOARD_KINDS = ['leads', 'contacts', 'accounts', 'deals', 'activities', 'projects', 'custom'] as const;

/** Boards (and their workspaces) this server may read. Needs aliases b and w. */
function visibleBoards(tx: Tx, ctx: CrmContext) {
  return tx`
    b.org_id = ${ctx.org.id}::uuid AND b.deleted_at IS NULL AND w.deleted_at IS NULL
    ${ctx.includePrivate ? tx`` : tx`AND b.privacy = 'main' AND w.kind = 'open'`}`;
}

async function loadColumns(tx: Tx, ctx: CrmContext, boardIds: string[]): Promise<Map<string, Column[]>> {
  const byBoard = new Map<string, Column[]>();
  if (boardIds.length === 0) return byBoard;
  const rows = await tx<Column[]>`
    SELECT board_id::text, key, title, type::text, settings FROM crm.columns
    WHERE org_id = ${ctx.org.id}::uuid AND deleted_at IS NULL AND board_id::text IN ${tx(boardIds)}
    ORDER BY position`;
  for (const c of rows) byBoard.set(c.board_id, [...(byBoard.get(c.board_id) ?? []), c]);
  return byBoard;
}

type Values = Record<string, unknown>;

/** Collects the user and item ids that values point at, so they can be named. */
function refsOf(values: Values[], columns: Column[]): { users: Set<string>; items: Set<string> } {
  const users = new Set<string>();
  const items = new Set<string>();
  for (const v of values) {
    for (const c of columns) {
      const cell = v[c.key] as { ids?: string[]; itemIds?: string[] } | undefined;
      if (c.type === 'people') cell?.ids?.forEach((id) => users.add(id));
      if (c.type === 'connect_boards') cell?.itemIds?.forEach((id) => items.add(id));
    }
  }
  return { users, items };
}

async function nameMaps(
  tx: Tx,
  ctx: CrmContext,
  refs: { users: Set<string>; items: Set<string> },
): Promise<{ users: Map<string, string>; items: Map<string, string> }> {
  const users = new Map<string, string>();
  const items = new Map<string, string>();
  if (ctx.canReadUsers && refs.users.size > 0) {
    const rows = await tx<{ id: string; name: string }[]>`
      SELECT u.id::text, u.name FROM core."user" u
      JOIN core.member m ON m.user_id = u.id AND m.organization_id = ${ctx.org.id}::uuid
      WHERE u.id::text IN ${tx([...refs.users])}`;
    for (const r of rows) users.set(r.id, r.name);
  }
  if (refs.items.size > 0) {
    const rows = await tx<{ id: string; name: string }[]>`
      SELECT i.id::text, i.name FROM crm.items i
      JOIN crm.boards b ON b.id = i.board_id JOIN crm.workspaces w ON w.id = b.workspace_id
      WHERE ${visibleBoards(tx, ctx)} AND i.deleted_at IS NULL AND i.id::text IN ${tx([...refs.items])}`;
    for (const r of rows) items.set(r.id, r.name);
  }
  return { users, items };
}

/** Turns stored cell values into readable values keyed by column title. */
export function renderValues(
  values: Values,
  columns: Column[],
  names: { users: Map<string, string>; items: Map<string, string> },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of columns) {
    if (COMPUTED.has(c.type) || c.type === 'name') continue;
    const v = values[c.key] as never;
    if (v === undefined || v === null) continue;
    const label = (id: string) => c.settings?.labels?.find((l) => l.id === id)?.name ?? id;
    let r: unknown;
    switch (c.type) {
      case 'status':
        r = label((v as { labelId: string }).labelId);
        break;
      case 'dropdown':
        r = (v as { labelIds: string[] }).labelIds.map(label);
        break;
      case 'people':
        r = (v as { ids?: string[] }).ids?.map((id) => names.users.get(id) ?? id);
        break;
      case 'connect_boards':
        // Items on boards this server cannot see are left out.
        r = (v as { itemIds?: string[] }).itemIds?.flatMap((id) => names.items.get(id) ?? []);
        break;
      case 'date': {
        const d = v as { date: string; time?: string };
        r = d.time ? `${d.date} ${d.time}` : d.date;
        break;
      }
      case 'timeline': {
        const t = v as { from: string; to: string };
        r = `${t.from} to ${t.to}`;
        break;
      }
      case 'currency': {
        const m = v as { amount: number; currency: string };
        r = `${m.amount} ${m.currency}`;
        break;
      }
      case 'email':
        r = (v as { email: string }).email;
        break;
      case 'phone':
        r = (v as { phone: string }).phone;
        break;
      case 'link':
        r = (v as { url: string }).url;
        break;
      case 'tags':
        r = (v as { tags: string[] }).tags;
        break;
      case 'location':
        r = (v as { address: string }).address;
        break;
      case 'country':
        r = (v as { code: string }).code;
        break;
      case 'files':
        r = `${(v as { fileIds?: string[] }).fileIds?.length ?? 0} file(s)`;
        break;
      default:
        r = v;
    }
    if (r === undefined || (Array.isArray(r) && r.length === 0)) continue;
    out[c.title] = r;
  }
  return out;
}

export function registerCrmTools(server: McpServer, ctx: CrmContext): void {
  const lim = (n: number | undefined) => Math.min(n ?? ctx.defaultLimit, MAX_LIMIT);
  const boardArg = z.string().optional().describe('Board id, or its exact name (e.g. "Deals").');

  server.registerTool(
    'crm_list_boards',
    {
      title: 'List CRM boards',
      description:
        'CRM boards (leads, contacts, accounts, deals, activities, custom) with their workspace, kind and item count. Use the board id or name with crm_search_items.',
      inputSchema: {
        kind: z.enum(BOARD_KINDS).optional(),
        query: z.string().optional().describe('Part of the board name.'),
      },
      annotations: READ_ONLY,
    },
    async ({ kind, query }) =>
      json(
        await readShared(
          ctx.sql,
          (tx) => tx`
            SELECT b.id::text AS board_id, b.name, b.kind::text, w.name AS workspace, b.item_terminology,
              (SELECT count(*) FROM crm.items i WHERE i.board_id = b.id AND i.deleted_at IS NULL
                AND i.archived_at IS NULL AND i.parent_item_id IS NULL) AS items,
              b.archived_at IS NOT NULL AS archived
            FROM crm.boards b JOIN crm.workspaces w ON w.id = b.workspace_id
            WHERE ${visibleBoards(tx, ctx)}
              ${kind ? tx`AND b.kind = ${kind}` : tx``}
              ${query ? tx`AND b.name ILIKE ${like(query)}` : tx``}
            ORDER BY w.name, b.name`,
        ),
      ),
  );

  server.registerTool(
    'crm_search_items',
    {
      title: 'Search CRM items',
      description:
        'Search CRM records (a lead, contact, account, deal...) by name or any text in their fields, optionally on one board or board kind. Returns each item with its group (stage) and readable field values.',
      inputSchema: {
        query: z.string().optional().describe('Text in the item name or any field.'),
        board: boardArg,
        kind: z.enum(BOARD_KINDS).optional().describe('Only boards of this kind, e.g. "deals".'),
        group: z.string().optional().describe('Exact group name, e.g. a pipeline stage.'),
        include_archived: z.boolean().optional(),
        limit: limitArg,
      },
      annotations: READ_ONLY,
    },
    async (a) => {
      const result = await readShared(ctx.sql, async (tx) => {
        const rows = await tx<
          {
            id: string;
            name: string;
            board_id: string;
            board: string;
            group: string;
            values: Values;
            updated_at: Date;
          }[]
        >`
          SELECT i.id::text, i.name, b.id::text AS board_id, b.name AS board, g.title AS group, i.values,
            i.updated_at, count(*) OVER () AS total_matching
          FROM crm.items i
          JOIN crm.boards b ON b.id = i.board_id
          JOIN crm.workspaces w ON w.id = b.workspace_id
          JOIN crm.groups g ON g.id = i.group_id
          WHERE ${visibleBoards(tx, ctx)} AND i.org_id = ${ctx.org.id}::uuid
            AND i.deleted_at IS NULL AND i.parent_item_id IS NULL
            ${a.include_archived ? tx`` : tx`AND i.archived_at IS NULL AND b.archived_at IS NULL`}
            ${a.board ? tx`AND (b.id::text = ${a.board} OR b.name = ${a.board})` : tx``}
            ${a.kind ? tx`AND b.kind = ${a.kind}` : tx``}
            ${a.group ? tx`AND g.title = ${a.group}` : tx``}
            ${
              a.query
                ? // String values only, so JSON keys ("labelIds", "amount"...) never match.
                  tx`AND (i.name ILIKE ${like(a.query)} OR EXISTS (
                    SELECT 1 FROM jsonb_path_query(i.values, 'strict $.** ? (@.type() == "string")') v
                    WHERE v #>> '{}' ILIKE ${like(a.query)}))`
                : tx``
            }
          ORDER BY i.updated_at DESC
          LIMIT ${lim(a.limit)}`;
        const columns = await loadColumns(tx, ctx, [...new Set(rows.map((r) => r.board_id))]);
        const all = [...columns.values()].flat();
        const names = await nameMaps(
          tx,
          ctx,
          refsOf(
            rows.map((r) => r.values),
            all,
          ),
        );
        return rows.map(({ values, board_id, ...r }) => ({
          ...r,
          fields: renderValues(values, columns.get(board_id) ?? [], names),
        }));
      });
      return json(result);
    },
  );

  server.registerTool(
    'crm_get_item',
    {
      title: 'Get CRM item',
      description:
        'One CRM record with all its fields, subitems, linked records and the latest updates (comments).',
      inputSchema: { item_id: z.string().uuid().describe('Item id from crm_search_items.') },
      annotations: READ_ONLY,
    },
    async ({ item_id }) => {
      const result = await readShared(ctx.sql, async (tx) => {
        const [item] = await tx<
          {
            id: string;
            name: string;
            board_id: string;
            board: string;
            kind: string;
            group: string;
            values: Values;
          }[]
        >`
          SELECT i.id::text, i.name, b.id::text AS board_id, b.name AS board, b.kind::text AS kind,
            g.title AS group, i.values, i.created_at, i.updated_at, i.archived_at
          FROM crm.items i
          JOIN crm.boards b ON b.id = i.board_id
          JOIN crm.workspaces w ON w.id = b.workspace_id
          JOIN crm.groups g ON g.id = i.group_id
          WHERE ${visibleBoards(tx, ctx)} AND i.org_id = ${ctx.org.id}::uuid AND i.deleted_at IS NULL
            AND i.id = ${item_id}::uuid`;
        if (!item) return null;
        const subitems = await tx<{ name: string; values: Values }[]>`
          SELECT name, values FROM crm.items
          WHERE parent_item_id = ${item_id}::uuid AND org_id = ${ctx.org.id}::uuid AND deleted_at IS NULL
          ORDER BY position`;
        const linked = await tx`
          SELECT DISTINCT o.id::text AS item_id, o.name, ob.name AS board
          FROM crm.item_links l
          JOIN crm.items o ON o.id = CASE WHEN l.from_item_id = ${item_id}::uuid THEN l.to_item_id ELSE l.from_item_id END
          JOIN crm.boards b ON b.id = o.board_id
          JOIN crm.workspaces w ON w.id = b.workspace_id
          JOIN crm.boards ob ON ob.id = o.board_id
          WHERE l.org_id = ${ctx.org.id}::uuid AND (l.from_item_id = ${item_id}::uuid OR l.to_item_id = ${item_id}::uuid)
            AND o.deleted_at IS NULL AND ${visibleBoards(tx, ctx)}`;
        const updates = await tx`
          SELECT ${ctx.canReadUsers ? tx`(SELECT u.name FROM core."user" u WHERE u.id = up.author_id)` : tx`NULL`} AS author,
            left(up.body_text, 1500) AS text, up.pinned, up.created_at
          FROM crm.updates up
          WHERE up.item_id = ${item_id}::uuid AND up.org_id = ${ctx.org.id}::uuid AND up.deleted_at IS NULL
            AND up.parent_update_id IS NULL
          ORDER BY up.pinned DESC, up.created_at DESC
          LIMIT 10`;
        const columns = (await loadColumns(tx, ctx, [item.board_id])).get(item.board_id) ?? [];
        const names = await nameMaps(
          tx,
          ctx,
          refsOf([item.values, ...subitems.map((s) => s.values)], columns),
        );
        const { values, board_id: _b, ...header } = item;
        return {
          ...header,
          fields: renderValues(values, columns, names),
          subitems: subitems.map((s) => ({ name: s.name, fields: renderValues(s.values, columns, names) })),
          linked,
          latest_updates: updates,
        };
      });
      return result ? json(result) : fail(`No CRM item ${item_id} on a board this server can read.`);
    },
  );
}
