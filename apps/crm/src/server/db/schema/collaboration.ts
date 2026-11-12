import {
  type AnyPgColumn,
  bigint,
  boolean,
  index,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { crmSchema } from './_schema';
import { deletedAt, id, notificationKindEnum, orgId, ownedByUser, timestamps, userRef } from './_shared';
import { boards, items } from './boards';

/** Tiptap / ProseMirror JSON document (sanitized server-side before storage). */
export interface RichTextDoc {
  readonly type: 'doc';
  readonly content?: readonly unknown[];
}

/** Item updates (comments) with threaded replies. */
export const updates = crmSchema.table(
  'updates',
  {
    id: id(),
    orgId: orgId(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    authorId: userRef('author_id'),
    parentUpdateId: uuid('parent_update_id').references((): AnyPgColumn => updates.id, {
      onDelete: 'cascade',
    }),
    body: jsonb('body').$type<RichTextDoc>().notNull(),
    /** Plain-text projection of `body` for search, previews and notifications. */
    bodyText: text('body_text').notNull().default(''),
    /** User ids mentioned in the body (denormalized for notification fan-out). */
    mentionedUserIds: uuid('mentioned_user_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    pinned: boolean('pinned').notNull().default(false),
    editedAt: timestamp('edited_at', { withTimezone: true, mode: 'date' }),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('updates_item_created_idx').on(t.itemId, t.createdAt),
    index('updates_parent_idx').on(t.parentUpdateId),
    index('updates_board_created_idx').on(t.boardId, t.createdAt),
    index('updates_org_idx').on(t.orgId),
    /** Full-text search over update bodies (see services/search). */
    index('updates_search_idx').using('gin', sql`to_tsvector('simple'::regconfig, ${t.bodyText})`),
  ],
);

export const updateReactions = crmSchema.table(
  'update_reactions',
  {
    id: id(),
    orgId: orgId(),
    updateId: uuid('update_id')
      .notNull()
      .references(() => updates.id, { onDelete: 'cascade' }),
    userId: ownedByUser(),
    emoji: text('emoji').notNull(),
    ...timestamps(),
  },
  (t) => [uniqueIndex('update_reactions_uq').on(t.updateId, t.userId, t.emoji)],
);

/** "Seen by" receipts. */
export const updateReads = crmSchema.table(
  'update_reads',
  {
    id: id(),
    orgId: orgId(),
    updateId: uuid('update_id')
      .notNull()
      .references(() => updates.id, { onDelete: 'cascade' }),
    userId: ownedByUser(),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('update_reads_uq').on(t.updateId, t.userId),
    index('update_reads_user_idx').on(t.userId),
  ],
);

export const files = crmSchema.table(
  'files',
  {
    id: id(),
    orgId: orgId(),
    boardId: uuid('board_id').references(() => boards.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'cascade' }),
    updateId: uuid('update_id').references(() => updates.id, { onDelete: 'cascade' }),
    /** Column key when attached through a files column. */
    columnKey: text('column_key'),
    uploadedBy: userRef('uploaded_by'),
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    /** Opaque key in the storage backend (local `.data/uploads` in dev). Never a user path. */
    storageKey: text('storage_key').notNull().unique(),
    /** Hex SHA-256 of the content. */
    checksum: text('checksum'),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('files_item_idx').on(t.itemId),
    index('files_update_idx').on(t.updateId),
    index('files_board_idx').on(t.boardId, t.createdAt),
    index('files_org_idx').on(t.orgId),
  ],
);

/** Activity log: every item/board change (powers the item "Activity" tab and undo). */
export const activityLog = crmSchema.table(
  'activity_log',
  {
    id: id(),
    orgId: orgId(),
    boardId: uuid('board_id').references(() => boards.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'cascade' }),
    /** Null when performed by the system / an automation. */
    actorId: userRef('actor_id'),
    automationId: uuid('automation_id'),
    /** e.g. item.created, item.updated, item.moved, item.deleted, column.created, group.renamed... */
    action: text('action').notNull(),
    columnKey: text('column_key'),
    before: jsonb('before').$type<unknown>(),
    after: jsonb('after').$type<unknown>(),
    ...timestamps(),
  },
  (t) => [
    index('activity_board_created_idx').on(t.boardId, t.createdAt),
    index('activity_item_created_idx').on(t.itemId, t.createdAt),
    index('activity_org_created_idx').on(t.orgId, t.createdAt),
  ],
);

export const notifications = crmSchema.table(
  'notifications',
  {
    id: id(),
    orgId: orgId(),
    userId: ownedByUser(),
    kind: notificationKindEnum('kind').notNull(),
    actorId: userRef('actor_id'),
    boardId: uuid('board_id').references(() => boards.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'cascade' }),
    updateId: uuid('update_id').references(() => updates.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
    ...timestamps(),
  },
  (t) => [
    index('notifications_user_created_idx').on(t.userId, t.createdAt),
    index('notifications_user_unread_idx')
      .on(t.userId)
      .where(sql`${t.readAt} is null`),
  ],
);
