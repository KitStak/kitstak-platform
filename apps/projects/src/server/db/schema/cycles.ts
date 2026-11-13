/** pm.cycles, pm.cycle_tasks (membership history) and pm.triage_items (intake queue). SQL: drizzle/0002_cycles_triage.sql. */
import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { PRIORITIES } from '@/lib/constants';
import { createdAt, deletedAt, id, orgId, pmSchema, tstz, updatedAt } from './_shared';
import { projects } from './projects';
import { tasks } from './tasks';
import { forms } from './studio';

export const cycles = pmSchema.table(
  'cycles',
  {
    id: id(),
    orgId: orgId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    name: text('name'),
    goal: text('goal'),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    autoRollover: boolean('auto_rollover').notNull().default(true),
    completedAt: tstz('completed_at'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('cycles_project_number_idx').on(t.projectId, t.number),
    index('cycles_project_dates_idx').on(t.projectId, t.startDate).where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const CYCLE_REMOVED_REASONS = ['removed', 'moved', 'rolled_over'] as const;

export const cycleTasks = pmSchema.table(
  'cycle_tasks',
  {
    id: id(),
    orgId: orgId(),
    cycleId: uuid('cycle_id')
      .notNull()
      .references(() => cycles.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    addedAt: tstz('added_at').notNull().defaultNow(),
    addedBy: uuid('added_by'),
    removedAt: tstz('removed_at'),
    removedReason: text('removed_reason', { enum: CYCLE_REMOVED_REASONS }),
  },
  (t) => [uniqueIndex('cycle_tasks_active_idx').on(t.taskId).where(sql`${t.removedAt} IS NULL`), index('cycle_tasks_cycle_idx').on(t.cycleId)],
);

export const TRIAGE_STATES = ['pending', 'snoozed', 'accepted', 'declined', 'merged'] as const;
export const TRIAGE_SOURCES = ['manual', 'form', 'crm', 'wms', 'portal', 'api'] as const;

export const triageItems = pmSchema.table(
  'triage_items',
  {
    id: id(),
    orgId: orgId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    priority: text('priority', { enum: PRIORITIES }).notNull().default('none'),
    source: text('source', { enum: TRIAGE_SOURCES }).notNull().default('manual'),
    sourceLabel: text('source_label'),
    formId: uuid('form_id').references(() => forms.id, { onDelete: 'set null' }),
    linkType: text('link_type'),
    linkId: text('link_id'),
    requesterId: uuid('requester_id'),
    requesterName: text('requester_name'),
    requesterEmail: text('requester_email'),
    state: text('state', { enum: TRIAGE_STATES }).notNull().default('pending'),
    snoozedUntil: date('snoozed_until', { mode: 'string' }),
    declineReason: text('decline_reason'),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    decidedBy: uuid('decided_by'),
    decidedAt: tstz('decided_at'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('triage_items_queue_idx').on(t.projectId, t.state, t.createdAt)],
);

export type Cycle = typeof cycles.$inferSelect;
export type CycleTask = typeof cycleTasks.$inferSelect;
export type TriageItem = typeof triageItems.$inferSelect;
