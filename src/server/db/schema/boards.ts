import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  archivedAt,
  boardKindEnum,
  boardPrivacyEnum,
  boardRoleEnum,
  columnScopeEnum,
  columnTypeEnum,
  createdAt,
  deletedAt,
  fractionalKey,
  id,
  orgId,
  ownedByUser,
  timestamps,
  userRef,
  viewTypeEnum,
} from './_shared';
import type { ColumnSettings, ItemValues } from './cell-values';
import { folders, workspaces } from './workspaces';
import { user } from './auth';

export interface BoardSettings {
  /** Default row density for the board. */
  readonly density?: 'compact' | 'default' | 'comfortable';
  /** Terminology for subitems ("Subitem", "Task"...). */
  readonly subitemTerminology?: string;
  /** Column key used as the primary status for progress & kanban defaults. */
  readonly primaryStatusColumnKey?: string;
  readonly [key: string]: unknown;
}

export const boards = pgTable(
  'boards',
  {
    id: id(),
    orgId: orgId(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id').references(() => folders.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    kind: boardKindEnum('kind').notNull().default('custom'),
    description: text('description'),
    icon: text('icon'),
    privacy: boardPrivacyEnum('privacy').notNull().default('main'),
    itemTerminology: text('item_terminology').notNull().default('Item'),
    settings: jsonb('settings').$type<BoardSettings>().notNull().default({}),
    position: fractionalKey('position').notNull(),
    createdBy: userRef('created_by'),
    ...timestamps(),
    archivedAt: archivedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('boards_org_idx')
      .on(t.orgId)
      .where(sql`${t.deletedAt} is null`),
    index('boards_workspace_idx').on(t.workspaceId, t.folderId, t.position),
    index('boards_org_kind_idx').on(t.orgId, t.kind),
  ],
);

/** Board owners, explicit members (private / shareable boards) and subscribers. */
export const boardMembers = pgTable(
  'board_members',
  {
    id: id(),
    orgId: orgId(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    userId: ownedByUser(),
    role: boardRoleEnum('role').notNull().default('subscriber'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('board_members_board_user_uq').on(t.boardId, t.userId),
    index('board_members_user_idx').on(t.userId),
  ],
);

export const columns = pgTable(
  'columns',
  {
    id: id(),
    orgId: orgId(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    /** Stable string id; key into `items.values`. Never changes after creation. */
    key: text('key').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    type: columnTypeEnum('type').notNull(),
    /** Whether the column belongs to items or to subitems of this board. */
    scope: columnScopeEnum('scope').notNull().default('item'),
    settings: jsonb('settings').$type<ColumnSettings>().notNull().default({}),
    width: integer('width').notNull().default(160),
    position: fractionalKey('position').notNull(),
    hidden: boolean('hidden').notNull().default(false),
    required: boolean('required').notNull().default(false),
    createdBy: userRef('created_by'),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('columns_board_key_uq').on(t.boardId, t.key),
    index('columns_board_position_idx').on(t.boardId, t.scope, t.position),
    index('columns_org_idx').on(t.orgId),
  ],
);

export const groups = pgTable(
  'groups',
  {
    id: id(),
    orgId: orgId(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** Label palette token name. */
    color: text('color').notNull().default('blue'),
    position: fractionalKey('position').notNull(),
    collapsedDefault: boolean('collapsed_default').notNull().default(false),
    ...timestamps(),
    archivedAt: archivedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('groups_board_position_idx').on(t.boardId, t.position), index('groups_org_idx').on(t.orgId)],
);

export const items = pgTable(
  'items',
  {
    id: id(),
    orgId: orgId(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    parentItemId: uuid('parent_item_id').references((): AnyPgColumn => items.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: fractionalKey('position').notNull(),
    values: jsonb('values').$type<ItemValues>().notNull().default({}),
    createdBy: userRef('created_by'),
    updatedBy: userRef('updated_by'),
    ...timestamps(),
    archivedAt: archivedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('items_board_group_position_idx')
      .on(t.boardId, t.groupId, t.position)
      .where(sql`${t.deletedAt} is null and ${t.parentItemId} is null`),
    index('items_parent_idx')
      .on(t.parentItemId, t.position)
      .where(sql`${t.parentItemId} is not null`),
    index('items_org_idx').on(t.orgId),
    index('items_board_updated_idx').on(t.boardId, t.updatedAt),
    index('items_values_gin_idx').using('gin', sql`${t.values} jsonb_path_ops`),
    /** Full-text search over the item name + every string inside `values` (see services/search). */
    index('items_search_idx').using(
      'gin',
      sql`(to_tsvector('simple'::regconfig, ${t.name}) || jsonb_to_tsvector('simple'::regconfig, ${t.values}, '["string"]'::jsonb))`,
    ),
  ],
);

/** connect_boards relations (directed; reciprocal columns create a row per direction). */
export const itemLinks = pgTable(
  'item_links',
  {
    id: id(),
    orgId: orgId(),
    fromItemId: uuid('from_item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    toItemId: uuid('to_item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    columnKey: text('column_key').notNull(),
    position: integer('position').notNull().default(0),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('item_links_from_to_col_uq').on(t.fromItemId, t.columnKey, t.toItemId),
    index('item_links_to_idx').on(t.toItemId),
  ],
);

export interface ViewConfig {
  readonly filters?: unknown;
  readonly sort?: ReadonlyArray<{ readonly columnKey: string; readonly direction: 'asc' | 'desc' }>;
  readonly groupBy?: string | null;
  readonly hiddenColumnKeys?: readonly string[];
  readonly columnOrder?: readonly string[];
  readonly search?: string;
  /** Kanban: status/dropdown column whose labels are lanes. */
  readonly kanbanColumnKey?: string;
  /** Calendar / timeline: date or timeline column. */
  readonly dateColumnKey?: string;
  readonly [key: string]: unknown;
}

export const views = pgTable(
  'views',
  {
    id: id(),
    orgId: orgId(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    type: viewTypeEnum('type').notNull().default('table'),
    name: text('name').notNull(),
    config: jsonb('config').$type<ViewConfig>().notNull().default({}),
    position: fractionalKey('position').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    /** Personal (unshared) view when set. */
    ownerId: uuid('owner_id').references(() => user.id, { onDelete: 'cascade' }),
    createdBy: userRef('created_by'),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('views_board_position_idx').on(t.boardId, t.position),
    uniqueIndex('views_board_default_uq')
      .on(t.boardId)
      .where(sql`${t.isDefault} = true and ${t.deletedAt} is null`),
  ],
);
