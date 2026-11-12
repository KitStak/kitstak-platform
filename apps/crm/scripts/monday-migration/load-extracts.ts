/**
 * monday.com → KitStak CRM board loader.
 *
 * Reads board extract JSON files (produced from the monday.com connector) and creates the
 * equivalent boards, columns, groups, items and subitems in the target org. Idempotent per
 * board: a board whose `settings.mondayBoardId` already exists in the org is skipped.
 *
 * Usage (from apps/crm):
 *   DATABASE_URL=... EXTRACT_DIR=<dir with board-*.json> ORG_SLUG=team1 \
 *     pnpm exec tsx scripts/monday-migration/load-extracts.ts [board-file.json ...]
 *
 * Not migrated (by design, see README.md in this folder): file attachments, monday
 * automations, views beyond the default table, item update threads.
 */
import '../load-env';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../src/server/db';
import {
  boardMembers,
  boards,
  columns,
  folders,
  groups,
  items,
  member,
  organization,
  user,
  views,
  workspaces,
} from '../../src/server/db/schema';
import type { ItemValues, StoredCellValue } from '../../src/server/db/schema/cell-values';
import { validateCellValue, type ColumnType } from '../../src/server/db/schema/cell-values';
import type { Label, LabelColor } from '../../src/server/db/schema/column-types';
import { defaultStoredWidth } from '../../src/server/db/schema/column-types';
import { initialPositions, positionAfter } from '../../src/server/services/positions';

// ---------------------------------------------------------------------------------------------
// Extract file shapes
// ---------------------------------------------------------------------------------------------

interface ExtractLabel {
  readonly id: number | string;
  readonly label: string;
  readonly hex?: string;
  readonly index?: number;
  readonly is_done?: boolean;
}

interface ExtractColumn {
  readonly id: string;
  readonly title: string;
  readonly type: string;
  readonly labels?: readonly ExtractLabel[];
}

interface ExtractSubitem {
  readonly id: string;
  readonly name: string;
  readonly created_at?: string;
  readonly updated_at?: string;
  readonly column_values?: Readonly<Record<string, unknown>>;
}

interface ExtractItem extends ExtractSubitem {
  readonly group: string;
  readonly subitems?: readonly ExtractSubitem[];
}

interface ExtractBoard {
  readonly board: {
    readonly id: string;
    readonly name: string;
    readonly description?: string | null;
    readonly item_terminology?: string;
    readonly workspace: string;
    readonly folder?: string | null;
  };
  /** Shared column/group layout (see TEMPLATES); the extract's own fields win when present. */
  readonly template?: string;
  readonly columns?: readonly ExtractColumn[];
  readonly subItemColumns?: readonly ExtractColumn[];
  readonly groups?: readonly { readonly id: string; readonly title: string }[];
  readonly items: readonly ExtractItem[];
}

/**
 * The monday "roadmap" template every Task Keeper client board was created from. Column ids
 * match the monday column ids used inside item column_values (the files column is normalized
 * to key "files" since file payloads are not migrated).
 */
const TASK_KEEPER_TEMPLATE: Pick<ExtractBoard, 'columns' | 'subItemColumns' | 'groups'> = {
  columns: [
    { id: 'person', title: 'Owner', type: 'people' },
    { id: 'text', title: 'Opportunity/Problem', type: 'text' },
    {
      id: 'status',
      title: 'Priority',
      type: 'status',
      labels: [
        { id: 0, label: 'Medium', hex: '#66ccff', index: 1 },
        { id: 1, label: 'High', hex: '#ff007f', index: 0 },
        { id: 2, label: 'Low', hex: '#9aadbd', index: 2 },
      ],
    },
    { id: 'timeline', title: 'Timeline', type: 'timeline' },
    {
      id: 'status7',
      title: 'Initiative status',
      type: 'status',
      labels: [
        { id: 0, label: 'Working on it', hex: '#fdab3d', index: 0 },
        { id: 1, label: 'Done', hex: '#00c875', index: 1, is_done: true },
        { id: 2, label: 'Stuck', hex: '#df2f4a', index: 2 },
        { id: 5, label: 'Not Started', hex: '#c4c4c4', index: 3 },
      ],
    },
    { id: 'files', title: 'Files', type: 'file' },
  ],
  subItemColumns: [
    { id: 'person', title: 'Owner', type: 'people' },
    {
      id: 'status',
      title: 'Status',
      type: 'status',
      labels: [
        { id: 0, label: 'Working on it', hex: '#fdab3d', index: 1 },
        { id: 1, label: 'Done', hex: '#00c875', index: 2, is_done: true },
        { id: 2, label: 'Stuck', hex: '#df2f4a', index: 0 },
      ],
    },
    { id: 'date0', title: 'Date', type: 'date' },
  ],
  groups: [
    { id: 'topics', title: 'TO DO' },
    { id: 'group_mm7g34xj', title: 'COMPLETED' },
  ],
};

/** The monday "project management" template used by the Product Connections boards. */
const PC_PROJECT_TEMPLATE: Pick<ExtractBoard, 'columns' | 'subItemColumns' | 'groups'> = {
  columns: [
    { id: 'project_owner', title: 'Owner', type: 'people' },
    {
      id: 'project_status',
      title: 'Status',
      type: 'status',
      labels: [
        { id: 0, label: 'Working on it', hex: '#fdab3d', index: 1 },
        { id: 1, label: 'Done', hex: '#00c875', index: 0, is_done: true },
        { id: 2, label: 'Stuck', hex: '#df2f4a', index: 2 },
        { id: 5, label: 'Not Started', hex: '#c4c4c4', index: 3 },
      ],
    },
    { id: 'date', title: 'Due date', type: 'date' },
    { id: 'timerange', title: 'Timeline', type: 'timeline' },
    {
      id: 'priority',
      title: 'Priority',
      type: 'status',
      labels: [
        { id: 110, label: 'High', hex: '#401694', index: 0 },
        { id: 109, label: 'Medium', hex: '#5559df', index: 1 },
        { id: 7, label: 'Low', hex: '#579bfc', index: 2 },
      ],
    },
    { id: 'files', title: 'Files', type: 'file' },
  ],
  subItemColumns: [
    { id: 'person', title: 'Owner', type: 'people' },
    {
      id: 'status',
      title: 'Status',
      type: 'status',
      labels: [
        { id: 0, label: 'Working on it', hex: '#fdab3d', index: 1 },
        { id: 1, label: 'Done', hex: '#00c875', index: 2, is_done: true },
        { id: 2, label: 'Stuck', hex: '#df2f4a', index: 0 },
      ],
    },
    { id: 'date0', title: 'Date', type: 'date' },
  ],
  groups: [
    { id: 'new_group29179', title: 'To-Do' },
    { id: 'new_group43041', title: 'Completed' },
  ],
};

const TEMPLATES: Readonly<Record<string, Pick<ExtractBoard, 'columns' | 'subItemColumns' | 'groups'>>> = {
  'task-keeper': TASK_KEEPER_TEMPLATE,
  'pc-project': PC_PROJECT_TEMPLATE,
};

function resolveExtract(extract: ExtractBoard): Required<Pick<ExtractBoard, 'columns' | 'groups'>> &
  ExtractBoard {
  const template = extract.template ? TEMPLATES[extract.template] : undefined;
  if (extract.template && !template) throw new Error(`Unknown extract template "${extract.template}"`);
  return {
    ...extract,
    columns: extract.columns ?? template?.columns ?? [],
    subItemColumns: extract.subItemColumns ?? template?.subItemColumns ?? [],
    groups: extract.groups ?? template?.groups ?? [],
  };
}

// ---------------------------------------------------------------------------------------------
// Mappings
// ---------------------------------------------------------------------------------------------

/** monday display name → KitStak user email (AI agent users intentionally absent). */
const PEOPLE_BY_NAME: Readonly<Record<string, string>> = {
  'Michael Lunsford': 'mike@team-01.com',
  'Mike Lunsford': 'mike@team-01.com',
  'Lauren Sage': 'lauren@team-01.com',
  'Bryan King': 'bryan@team-01.com',
  'Franky Fuertes': 'franky@team-01.com',
  'Josh Hooper': 'josh@team-01.com',
  'Chris Harrison': 'chris@team-01.com',
  'Tyler Bucholz': 'tyler.bucholz@team-01.com',
};

const MONDAY_TYPE_MAP: Readonly<Record<string, ColumnType>> = {
  name: 'name',
  text: 'text',
  long_text: 'long_text',
  'long-text': 'long_text',
  status: 'status',
  color: 'status',
  people: 'people',
  person: 'people',
  'multiple-person': 'people',
  date: 'date',
  timeline: 'timeline',
  timerange: 'timeline',
  numbers: 'number',
  numeric: 'number',
  email: 'email',
  phone: 'phone',
  link: 'link',
  dropdown: 'dropdown',
  tags: 'tags',
  checkbox: 'checkbox',
  rating: 'rating',
  file: 'files',
};

/** Column types silently skipped (computed in monday or handled elsewhere). */
const SKIPPED_TYPES = new Set([
  'subtasks',
  'subitems',
  'formula',
  'mirror',
  'lookup',
  'button',
  'auto_number',
  'autonumber',
  'item_id',
  'pulse-id',
  'creation_log',
  'pulse-log',
  'last_updated',
  'pulse-updated',
  'board_relation',
  'board-relation',
  'dependency',
  'progress',
  'tracking',
  'integration',
  'doc',
  'monday_doc',
]);

const TOKEN_PALETTE: ReadonlyArray<readonly [LabelColor, number, number, number]> = [
  ['green', 0x00, 0xc8, 0x75],
  ['orange', 0xfd, 0xab, 0x3d],
  ['red', 0xdf, 0x2f, 0x4a],
  ['gray', 0xc4, 0xc4, 0xc4],
  ['blue', 0x57, 0x9b, 0xfc],
  ['dark-blue', 0x22, 0x50, 0x91],
  ['purple', 0xa2, 0x5d, 0xdc],
  ['pink', 0xff, 0x5a, 0xc4],
  ['teal', 0x4e, 0xcc, 0xc6],
  ['yellow', 0xff, 0xcb, 0x00],
  ['lime', 0x9c, 0xd3, 0x26],
  ['brown', 0x7f, 0x53, 0x47],
];

function hexToToken(hex: string | undefined, fallback: LabelColor = 'blue'): LabelColor {
  if (!hex) return fallback;
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return fallback;
  const value = Number.parseInt(match[1] as string, 16);
  const [r, g, b] = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
  let best: LabelColor = fallback;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [token, tr, tg, tb] of TOKEN_PALETTE) {
    const distance = (r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = token;
    }
  }
  return best;
}

const GROUP_COLORS = ['blue', 'green', 'purple', 'orange', 'teal', 'pink', 'yellow', 'red'] as const;

// ---------------------------------------------------------------------------------------------
// Value transforms (monday display strings → KitStak stored cell values)
// ---------------------------------------------------------------------------------------------

const DATE_RE = /\d{4}-\d{2}-\d{2}/g;

interface TransformContext {
  readonly usersByName: ReadonlyMap<string, string>;
  readonly warn: (message: string) => void;
  /** Dropdown columns accumulate labels from the values they encounter. */
  readonly dropdownLabels: Map<string, Map<string, string>>;
}

function transformValue(
  ctx: TransformContext,
  columnKey: string,
  type: ColumnType,
  labelsByName: ReadonlyMap<string, string> | undefined,
  raw: unknown,
): StoredCellValue | null {
  if (raw === null || raw === undefined) return null;
  const display = typeof raw === 'string' ? raw.trim() : raw;
  if (typeof display === 'string' && display.length === 0) return null;

  switch (type) {
    case 'text':
      return String(display).slice(0, 2_000);
    case 'long_text':
      return String(display).slice(0, 50_000);
    case 'status': {
      const labelId = labelsByName?.get(String(display));
      if (!labelId) {
        ctx.warn(`status value "${String(display)}" has no label on column ${columnKey}; dropped`);
        return null;
      }
      return { labelId };
    }
    case 'people': {
      const ids: string[] = [];
      for (const namePart of String(display).split(',')) {
        const name = namePart.trim();
        if (!name) continue;
        const userId = ctx.usersByName.get(name);
        if (userId) ids.push(userId);
        else ctx.warn(`person "${name}" not mapped (AI agent or unknown); dropped from ${columnKey}`);
      }
      return ids.length > 0 ? { ids } : null;
    }
    case 'date': {
      const dates = String(display).match(DATE_RE);
      return dates?.[0] ? { date: dates[0] } : null;
    }
    case 'timeline': {
      const dates = String(display).match(DATE_RE);
      if (!dates || dates.length === 0) return null;
      const from = dates[0] as string;
      const to = (dates[1] ?? dates[0]) as string;
      return from <= to ? { from, to } : { from: to, to: from };
    }
    case 'number': {
      const value = Number.parseFloat(String(display).replace(/[^0-9.eE+-]/g, ''));
      return Number.isFinite(value) ? value : null;
    }
    case 'checkbox':
      return display === true || ['v', 'true', 'checked', '✓', 'yes'].includes(String(display).toLowerCase());
    case 'rating': {
      const value = Number.parseInt(String(display), 10);
      return Number.isFinite(value) ? Math.max(0, Math.min(10, value)) : null;
    }
    case 'email': {
      const email = String(display).split(/[ ,]/)[0] ?? '';
      return email.includes('@') ? { email } : null;
    }
    case 'phone':
      return { phone: String(display).slice(0, 32) };
    case 'link': {
      const text = String(display);
      const urlMatch = /https?:\/\/\S+/.exec(text);
      if (!urlMatch) return null;
      const label = text.replace(urlMatch[0], '').replace(/[\s-]+$/, '').trim();
      return { url: urlMatch[0], ...(label ? { text: label } : {}) };
    }
    case 'tags': {
      const tags = String(display)
        .split(',')
        .map((tag) => tag.trim().replace(/^#/, ''))
        .filter((tag) => tag.length > 0);
      return tags.length > 0 ? { tags } : null;
    }
    case 'dropdown': {
      const perColumn = ctx.dropdownLabels.get(columnKey);
      if (!perColumn) return null;
      const labelIds: string[] = [];
      for (const part of String(display).split(',')) {
        const name = part.trim();
        if (!name) continue;
        let id = perColumn.get(name);
        if (!id) {
          id = `opt-${perColumn.size + 1}`;
          perColumn.set(name, id);
        }
        labelIds.push(id);
      }
      return labelIds.length > 0 ? { labelIds } : null;
    }
    case 'files':
      // File payloads are monday-hosted; attachments are not migrated in this pass.
      return null;
    default:
      ctx.warn(`no transform for column type ${type} (${columnKey}); dropped`);
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Board loading
// ---------------------------------------------------------------------------------------------

interface PreparedColumn {
  readonly key: string;
  readonly title: string;
  readonly type: ColumnType;
  readonly scope: 'item' | 'subitem';
  readonly labels?: readonly Label[];
  readonly labelsByName?: ReadonlyMap<string, string>;
}

function prepareColumns(
  extract: ExtractBoard,
  warn: (message: string) => void,
): { columns: PreparedColumn[]; primaryStatusKey: string | undefined } {
  const prepared: PreparedColumn[] = [];
  let primaryStatusKey: string | undefined;

  const add = (column: ExtractColumn, scope: 'item' | 'subitem'): void => {
    if (column.type === 'name') return; // the name column is implicit in KitStak
    if (SKIPPED_TYPES.has(column.type)) return;
    const type = MONDAY_TYPE_MAP[column.type];
    if (!type) {
      warn(`unmapped monday column type "${column.type}" (${column.title}); skipped`);
      return;
    }
    const key = scope === 'subitem' ? `sub_${column.id}` : column.id;
    let labels: Label[] | undefined;
    let labelsByName: Map<string, string> | undefined;
    if (type === 'status') {
      const source = [...(column.labels ?? [])].sort((a, b) => (a.index ?? 999) - (b.index ?? 999));
      labels = source.map((entry, position) => ({
        id: String(entry.id),
        name: entry.label,
        color: hexToToken(entry.hex),
        position,
        ...(entry.is_done ? { isDone: true } : {}),
      }));
      labels.push({ id: 'default', name: '', color: 'gray', position: labels.length, isDefault: true });
      labelsByName = new Map(labels.map((label) => [label.name, label.id]));
      if (scope === 'item' && !primaryStatusKey && /status/i.test(column.title)) primaryStatusKey = key;
    }
    prepared.push({ key, title: column.title, type, scope, labels, labelsByName });
  };

  for (const column of extract.columns ?? []) add(column, 'item');
  for (const column of extract.subItemColumns ?? []) add(column, 'subitem');
  return { columns: prepared, primaryStatusKey };
}

function buildValues(
  ctx: TransformContext,
  prepared: readonly PreparedColumn[],
  scope: 'item' | 'subitem',
  columnValues: Readonly<Record<string, unknown>> | undefined,
): ItemValues {
  const values: ItemValues = {};
  if (!columnValues) return values;
  for (const column of prepared) {
    if (column.scope !== scope) continue;
    const sourceKey = scope === 'subitem' ? column.key.replace(/^sub_/, '') : column.key;
    const raw = columnValues[sourceKey];
    const value = transformValue(ctx, column.key, column.type, column.labelsByName, raw);
    if (value === null) continue;
    const checked = validateCellValue(column.type, value);
    if (!checked.ok) {
      ctx.warn(`invalid ${column.type} value on ${column.key}: ${checked.message}; dropped`);
      continue;
    }
    if (checked.value !== null) values[column.key] = checked.value;
  }
  return values;
}

async function loadBoard(
  extract: ExtractBoard,
  env: {
    readonly orgId: string;
    readonly adminId: string;
    readonly usersByName: ReadonlyMap<string, string>;
    readonly workspaceIdByName: ReadonlyMap<string, string>;
    readonly folderIdByName: ReadonlyMap<string, string>;
  },
): Promise<{ items: number; subitems: number; warnings: string[] }> {
  const warnings: string[] = [];
  const warn = (message: string): void => {
    warnings.push(message);
  };

  const workspaceId = env.workspaceIdByName.get(extract.board.workspace);
  if (!workspaceId) throw new Error(`Workspace "${extract.board.workspace}" not provisioned`);
  const folderId = extract.board.folder ? (env.folderIdByName.get(extract.board.folder) ?? null) : null;

  const [existing] = await db
    .select({ id: boards.id })
    .from(boards)
    .where(and(eq(boards.orgId, env.orgId), sql`${boards.settings}->>'mondayBoardId' = ${extract.board.id}`))
    .limit(1);
  if (existing) {
    warn(`board already migrated (${existing.id}); skipped`);
    return { items: 0, subitems: 0, warnings };
  }

  const { columns: prepared, primaryStatusKey } = prepareColumns(extract, warn);
  const ctx: TransformContext = {
    usersByName: env.usersByName,
    warn,
    dropdownLabels: new Map(prepared.filter((c) => c.type === 'dropdown').map((c) => [c.key, new Map()])),
  };

  const terminologyRaw = extract.board.item_terminology ?? 'Item';
  const itemTerminology = terminologyRaw.charAt(0).toUpperCase() + terminologyRaw.slice(1);

  let createdItems = 0;
  let createdSubitems = 0;

  await db.transaction(async (tx) => {
    const [lastBoard] = await tx
      .select({ position: boards.position })
      .from(boards)
      .where(and(eq(boards.workspaceId, workspaceId), eq(boards.orgId, env.orgId)))
      .orderBy(sql`${boards.position} desc`)
      .limit(1);
    const boardPosition = positionAfter(lastBoard?.position);

    const [board] = await tx
      .insert(boards)
      .values({
        orgId: env.orgId,
        workspaceId,
        folderId,
        name: extract.board.name,
        kind: 'custom',
        description: extract.board.description ?? null,
        itemTerminology,
        settings: {
          mondayBoardId: extract.board.id,
          subitemTerminology: 'Subitem',
          ...(primaryStatusKey ? { primaryStatusColumnKey: primaryStatusKey } : {}),
        },
        position: boardPosition,
        createdBy: env.adminId,
      })
      .returning({ id: boards.id });
    if (!board) throw new Error('Board insert returned no row');

    await tx
      .insert(boardMembers)
      .values({ orgId: env.orgId, boardId: board.id, userId: env.adminId, role: 'owner' })
      .onConflictDoNothing();

    // Items first (so dropdown labels accumulate), but columns must exist before items are
    // meaningful; we instead compute item rows now and insert columns after, inside the same tx.
    const groupDefs = extract.groups ?? [];
    const groupPositions = initialPositions(groupDefs.length);
    const groupIdByMonday = new Map<string, string>();
    const groupRows = groupDefs.map((group, index) => {
      const id = randomUUID();
      groupIdByMonday.set(group.id, id);
      return {
        id,
        orgId: env.orgId,
        boardId: board.id,
        title: group.title,
        color: GROUP_COLORS[index % GROUP_COLORS.length] as string,
        position: groupPositions[index] as string,
      };
    });
    if (groupRows.length > 0) await tx.insert(groups).values(groupRows);

    type ItemRow = typeof items.$inferInsert;
    const topRows: ItemRow[] = [];
    const subRows: ItemRow[] = [];

    const itemsByGroup = new Map<string, ExtractItem[]>();
    for (const item of extract.items) {
      itemsByGroup.set(item.group, [...(itemsByGroup.get(item.group) ?? []), item]);
    }
    for (const [groupMondayId, groupItems] of itemsByGroup) {
      const groupId = groupIdByMonday.get(groupMondayId);
      if (!groupId) {
        warn(`item group ${groupMondayId} missing on board; ${groupItems.length} items skipped`);
        continue;
      }
      const positions = initialPositions(groupItems.length);
      groupItems.forEach((item, index) => {
        const itemId = randomUUID();
        topRows.push({
          id: itemId,
          orgId: env.orgId,
          boardId: board.id,
          groupId,
          name: item.name.slice(0, 2_000) || 'Untitled',
          position: positions[index] as string,
          values: buildValues(ctx, prepared, 'item', item.column_values),
          createdBy: env.adminId,
          updatedBy: env.adminId,
          ...(item.created_at ? { createdAt: new Date(item.created_at) } : {}),
          ...(item.updated_at ? { updatedAt: new Date(item.updated_at) } : {}),
        });
        const subs = item.subitems ?? [];
        const subPositions = initialPositions(subs.length);
        subs.forEach((sub, subIndex) => {
          subRows.push({
            id: randomUUID(),
            orgId: env.orgId,
            boardId: board.id,
            groupId,
            parentItemId: itemId,
            name: sub.name.slice(0, 2_000) || 'Untitled',
            position: subPositions[subIndex] as string,
            values: buildValues(ctx, prepared, 'subitem', sub.column_values),
            createdBy: env.adminId,
            updatedBy: env.adminId,
            ...(sub.created_at ? { createdAt: new Date(sub.created_at) } : {}),
            ...(sub.updated_at ? { updatedAt: new Date(sub.updated_at) } : {}),
          });
        });
      });
    }

    // Columns (dropdown labels are now fully accumulated).
    const itemColumns = prepared.filter((column) => column.scope === 'item');
    const subColumns = prepared.filter((column) => column.scope === 'subitem');
    const columnRows = [
      ...itemColumns.map((column, index) => ({ column, scope: 'item' as const, index, total: itemColumns.length })),
      ...subColumns.map((column, index) => ({ column, scope: 'subitem' as const, index, total: subColumns.length })),
    ];
    const positionsByScope = {
      item: initialPositions(itemColumns.length),
      subitem: initialPositions(subColumns.length),
    };
    if (columnRows.length > 0) {
      await tx.insert(columns).values(
        columnRows.map(({ column, scope, index }) => {
          let settings: Record<string, unknown> = {};
          if (column.type === 'status' && column.labels) settings = { labels: column.labels };
          if (column.type === 'dropdown') {
            const accumulated = ctx.dropdownLabels.get(column.key) ?? new Map<string, string>();
            settings = {
              labels: [...accumulated.entries()].map(([name, id], position) => ({
                id,
                name,
                color: GROUP_COLORS[position % GROUP_COLORS.length],
                position,
              })),
            };
          }
          return {
            orgId: env.orgId,
            boardId: board.id,
            key: column.key,
            title: column.title,
            type: column.type,
            scope,
            settings,
            width: defaultStoredWidth(column.type, column.title),
            position: positionsByScope[scope][index] as string,
            createdBy: env.adminId,
          };
        }),
      );
    }

    await tx.insert(views).values({
      orgId: env.orgId,
      boardId: board.id,
      type: 'table',
      name: 'Main table',
      position: initialPositions(1)[0] as string,
      isDefault: true,
      createdBy: env.adminId,
    });

    const CHUNK = 200;
    for (let start = 0; start < topRows.length; start += CHUNK)
      await tx.insert(items).values(topRows.slice(start, start + CHUNK));
    for (let start = 0; start < subRows.length; start += CHUNK)
      await tx.insert(items).values(subRows.slice(start, start + CHUNK));
    createdItems = topRows.length;
    createdSubitems = subRows.length;
  });

  return { items: createdItems, subitems: createdSubitems, warnings };
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const extractDir = process.env.EXTRACT_DIR;
  if (!extractDir) throw new Error('EXTRACT_DIR is required');
  const orgSlug = process.env.ORG_SLUG ?? 'team1';

  const requested = process.argv.slice(2);
  const files = (requested.length > 0 ? requested : readdirSync(extractDir).filter((f) => /^board-.*\.json$/.test(f))).sort();
  if (files.length === 0) throw new Error(`No board-*.json files in ${extractDir}`);

  const [org] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.slug, orgSlug))
    .limit(1);
  if (!org) throw new Error(`Organization "${orgSlug}" not found — run provision-team1.ts first`);

  const memberRows = await db
    .select({ userId: member.userId, email: user.email, role: member.role })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, org.id));
  const idByEmail = new Map(memberRows.map((row) => [row.email, row.userId]));
  const adminId = idByEmail.get('mike@team-01.com');
  if (!adminId) throw new Error('Admin member mike@team-01.com not found');
  const usersByName = new Map<string, string>();
  for (const [name, email] of Object.entries(PEOPLE_BY_NAME)) {
    const id = idByEmail.get(email);
    if (id) usersByName.set(name, id);
  }

  const workspaceRows = await db
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.orgId, org.id));
  const workspaceIdByName = new Map(workspaceRows.map((row) => [row.name, row.id]));
  const folderRows = await db
    .select({ id: folders.id, name: folders.name })
    .from(folders)
    .where(eq(folders.orgId, org.id));
  const folderIdByName = new Map(folderRows.map((row) => [row.name, row.id]));

  let totalItems = 0;
  let totalSubitems = 0;
  let failed = 0;
  for (const file of files) {
    const extract = resolveExtract(JSON.parse(readFileSync(join(extractDir, file), 'utf8')) as ExtractBoard);
    try {
      const result = await loadBoard(extract, { orgId: org.id, adminId, usersByName, workspaceIdByName, folderIdByName });
      totalItems += result.items;
      totalSubitems += result.subitems;
      const summary = result.warnings.length > 0 ? ` — ${result.warnings.length} warning(s)` : '';
      console.log(`${extract.board.name}: ${result.items} items, ${result.subitems} subitems${summary}`);
      for (const warning of result.warnings) console.log(`    warn: ${warning}`);
    } catch (error: unknown) {
      failed += 1;
      console.error(`${extract.board.name}: FAILED — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`\nDone: ${totalItems} items, ${totalSubitems} subitems across ${files.length} board file(s); ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
