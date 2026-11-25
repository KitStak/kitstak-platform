/** Comments, attachments, the activity log, time tracking and the notification inbox. */
import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, text, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { ACTOR_KINDS, ATTACHMENT_STORAGES, NOTIFICATION_KINDS, TIME_ENTRY_SOURCES } from '@/lib/constants';
import { bytea, createdAt, deletedAt, id, orgId, pmSchema, tstz, updatedAt } from './_shared';
import { projects } from './projects';
import { tasks } from './tasks';

/** emoji → user ids who reacted. */
export type Reactions = Record<string, string[]>;

export const comments = pmSchema.table(
  'comments',
  {
    id: id(),
    orgId: orgId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    parentCommentId: uuid('parent_comment_id').references((): AnyPgColumn => comments.id, {
      onDelete: 'cascade',
    }),
    authorId: uuid('author_id'),
    /** Markdown. Mentions are written as `@[Name](user:<uuid>)`; see src/lib/mentions.ts. */
    body: text('body').notNull(),
    mentions: uuid('mentions').array().notNull().default(sql`'{}'::uuid[]`),
    reactions: jsonb('reactions').$type<Reactions>().notNull().default(sql`'{}'::jsonb`),
    editedAt: tstz('edited_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('comments_task_idx').on(t.taskId, t.createdAt)],
);

export const attachments = pmSchema.table(
  'attachments',
  {
    id: id(),
    orgId: orgId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    commentId: uuid('comment_id').references(() => comments.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storage: text('storage', { enum: ATTACHMENT_STORAGES }).notNull(),
    /** Blob URL (storage=blob) or relative path under .data/attachments (storage=disk). */
    storageKey: text('storage_key'),
    /** File bytes when storage=db. Never selected in list queries. */
    data: bytea('data'),
    uploadedBy: uuid('uploaded_by'),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('attachments_task_idx').on(t.taskId),
    index('attachments_project_idx').on(t.projectId, t.createdAt),
  ],
);

/** Immutable event log: who did what, with before/after values. Never updated or deleted. */
export const activity = pmSchema.table(
  'activity',
  {
    id: id(),
    orgId: orgId(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id'),
    actorKind: text('actor_kind', { enum: ACTOR_KINDS }).notNull().default('user'),
    /** Dotted verb, e.g. `task.created`, `task.updated`, `comment.added` (src/server/domain/activity.ts). */
    verb: text('verb').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    /** Changed field for `*.updated` events (title, status, assignee, due_date…). */
    field: text('field'),
    before: jsonb('before'),
    after: jsonb('after'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    index('activity_project_idx').on(t.projectId, t.createdAt),
    index('activity_task_idx').on(t.taskId, t.createdAt),
    index('activity_org_idx').on(t.orgId, t.createdAt),
    index('activity_actor_idx').on(t.actorId, t.createdAt),
  ],
);

export const timeEntries = pmSchema.table(
  'time_entries',
  {
    id: id(),
    orgId: orgId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    startedAt: tstz('started_at').notNull(),
    /** null while the timer is running. */
    endedAt: tstz('ended_at'),
    /** Set on stop (timer) or entry (manual). */
    durationMinutes: integer('duration_minutes'),
    note: text('note'),
    billable: boolean('billable').notNull().default(false),
    source: text('source', { enum: TIME_ENTRY_SOURCES }).notNull().default('timer'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('time_entries_task_idx').on(t.taskId),
    index('time_entries_user_idx').on(t.orgId, t.userId, t.startedAt),
    index('time_entries_project_started_idx').on(t.projectId, t.startedAt).where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const notifications = pmSchema.table(
  'notifications',
  {
    id: id(),
    orgId: orgId(),
    /** Recipient. */
    userId: uuid('user_id').notNull(),
    actorId: uuid('actor_id'),
    kind: text('kind', { enum: NOTIFICATION_KINDS }).notNull(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    commentId: uuid('comment_id').references(() => comments.id, { onDelete: 'cascade' }),
    /** Plain-language headline: "Maya assigned you OPS-12". */
    title: text('title').notNull(),
    body: text('body'),
    /** In-app path to open (e.g. /p/OPS/12). */
    url: text('url'),
    readAt: tstz('read_at'),
    archivedAt: tstz('archived_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_inbox_idx').on(t.orgId, t.userId, t.createdAt),
    index('notifications_unread_idx')
      .on(t.orgId, t.userId)
      .where(sql`${t.readAt} IS NULL AND ${t.archivedAt} IS NULL`),
  ],
);

export type Comment = typeof comments.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type ActivityRow = typeof activity.$inferSelect;
export type TimeEntry = typeof timeEntries.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
