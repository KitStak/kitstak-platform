/** pm.tasks + task relations: labels, dependencies, watchers. */
import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { DEPENDENCY_KINDS, PRIORITIES, TASK_KINDS } from '@/lib/constants';
import { createdAt, deletedAt, id, orgId, pmSchema, tstz, updatedAt } from './_shared';
import { labels, milestones, projects, sections, statuses } from './projects';

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

/** Repeat rule: when a recurring task is completed, the next occurrence is created. */
export interface TaskRecurrence {
  readonly frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  readonly interval: number;
  /** 0 = Sunday … 6 = Saturday (weekly only). */
  readonly weekdays?: readonly number[];
}

/** Custom field values keyed by pm.custom_fields.id. */
export type CustomFieldValues = Record<string, unknown>;

export const tasks = pmSchema.table(
  'tasks',
  {
    id: id(),
    orgId: orgId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Per-project sequence → human id `${project.key}-${number}`. */
    number: integer('number').notNull(),
    /** `build` rows carry quantity and money in pm.builds; fixed after insert (KP103), never a subtask (KP101). */
    kind: text('kind', { enum: TASK_KINDS }).notNull().default('task'),
    title: text('title').notNull(),
    /** Rich text (sanitized HTML). */
    description: text('description'),
    statusId: uuid('status_id')
      .notNull()
      .references(() => statuses.id, { onDelete: 'restrict' }),
    sectionId: uuid('section_id').references(() => sections.id, { onDelete: 'set null' }),
    priority: text('priority', { enum: PRIORITIES }).notNull().default('none'),
    assigneeId: uuid('assignee_id'),
    reporterId: uuid('reporter_id'),
    startDate: date('start_date', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }),
    estimatePoints: integer('estimate_points'),
    estimateMinutes: integer('estimate_minutes'),
    parentTaskId: uuid('parent_task_id').references((): AnyPgColumn => tasks.id, { onDelete: 'cascade' }),
    /** Fractional rank within (status column | section | parent); src/lib/rank.ts. */
    position: text('position').notNull(),
    /** Task rendered as a diamond milestone on the timeline. */
    isMilestone: boolean('is_milestone').notNull().default(false),
    milestoneId: uuid('milestone_id').references(() => milestones.id, { onDelete: 'set null' }),
    customFields: jsonb('custom_fields').$type<CustomFieldValues>().notNull().default(sql`'{}'::jsonb`),
    recurrence: jsonb('recurrence').$type<TaskRecurrence>(),
    completedAt: tstz('completed_at'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    /** Generated: title + tag-stripped description, for full-text search. */
    search: tsvector('search').generatedAlwaysAs(
      (): SQL =>
        sql`to_tsvector('simple', coalesce(${tasks.title}, '') || ' ' || coalesce(regexp_replace(${tasks.description}, '<[^>]+>', ' ', 'g'), ''))`,
    ),
  },
  (t) => [
    uniqueIndex('tasks_project_number_unique').on(t.projectId, t.number),
    index('tasks_project_live_idx').on(t.projectId).where(sql`${t.deletedAt} IS NULL`),
    index('tasks_assignee_idx').on(t.orgId, t.assigneeId).where(sql`${t.deletedAt} IS NULL`),
    index('tasks_status_idx').on(t.statusId),
    index('tasks_parent_idx').on(t.parentTaskId),
    index('tasks_due_idx').on(t.orgId, t.dueDate),
    index('tasks_search_idx').using('gin', t.search),
    index('tasks_org_kind_assignee_idx').on(t.orgId, t.kind, t.assigneeId).where(sql`${t.deletedAt} IS NULL`),
    index('tasks_project_kind_due_idx').on(t.projectId, t.kind, t.dueDate).where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const taskLabels = pmSchema.table(
  'task_labels',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    labelId: uuid('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
    orgId: orgId(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'task_labels_pkey', columns: [t.taskId, t.labelId] }),
    index('task_labels_label_idx').on(t.labelId),
  ],
);

/** `blocking_task_id` blocks `blocked_task_id` (the blocked task waits). */
export const taskDependencies = pmSchema.table(
  'task_dependencies',
  {
    id: id(),
    orgId: orgId(),
    blockingTaskId: uuid('blocking_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    blockedTaskId: uuid('blocked_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: DEPENDENCY_KINDS }).notNull().default('finish_to_start'),
    /** Lag in days between the two ends (timeline). */
    lagDays: integer('lag_days').notNull().default(0),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('task_dependencies_pair_unique').on(t.blockingTaskId, t.blockedTaskId),
    index('task_dependencies_blocked_idx').on(t.blockedTaskId),
  ],
);

export const watchers = pmSchema.table(
  'watchers',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    orgId: orgId(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'watchers_pkey', columns: [t.taskId, t.userId] }),
    index('watchers_user_idx').on(t.userId),
  ],
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskLabel = typeof taskLabels.$inferSelect;
export type TaskDependency = typeof taskDependencies.$inferSelect;
export type Watcher = typeof watchers.$inferSelect;
