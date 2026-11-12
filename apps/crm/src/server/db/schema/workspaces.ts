import { type AnyPgColumn, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  deletedAt,
  fractionalKey,
  id,
  orgId,
  ownedByUser,
  timestamps,
  userRef,
  workspaceKindEnum,
  workspaceRoleEnum,
} from './_shared';

export const workspaces = pgTable(
  'workspaces',
  {
    id: id(),
    orgId: orgId(),
    name: text('name').notNull(),
    description: text('description'),
    /** lucide icon name or emoji. */
    icon: text('icon'),
    /** Label palette token name. */
    color: text('color').notNull().default('blue'),
    kind: workspaceKindEnum('kind').notNull().default('open'),
    position: fractionalKey('position').notNull(),
    createdBy: userRef('created_by'),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('workspaces_org_idx')
      .on(t.orgId, t.position)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: id(),
    orgId: orgId(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: ownedByUser(),
    role: workspaceRoleEnum('role').notNull().default('member'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('workspace_members_ws_user_uq').on(t.workspaceId, t.userId),
    index('workspace_members_user_idx').on(t.userId),
  ],
);

export const folders = pgTable(
  'folders',
  {
    id: id(),
    orgId: orgId(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => folders.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
    position: fractionalKey('position').notNull(),
    createdBy: userRef('created_by'),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('folders_workspace_idx').on(t.workspaceId, t.parentId, t.position),
    index('folders_org_idx').on(t.orgId),
  ],
);
