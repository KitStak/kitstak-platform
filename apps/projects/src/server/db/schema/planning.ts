/** Goals (OKRs), saved views and dashboards. */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { GOAL_HEALTHS, GOAL_PROGRESS_MODES, KEY_RESULT_KINDS, VIEW_SURFACES, VIEW_TYPES } from '@/lib/constants';
import type { ViewConfig } from '@/lib/view-config';
import { createdAt, deletedAt, id, orgId, pmSchema, updatedAt } from './_shared';
import { projects } from './projects';

export const goals = pmSchema.table(
  'goals',
  {
    id: id(),
    orgId: orgId(),
    parentGoalId: uuid('parent_goal_id').references((): AnyPgColumn => goals.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description'),
    ownerId: uuid('owner_id'),
    /** Free label for the time frame ("Q4 2026", "2027"). */
    period: text('period'),
    startDate: date('start_date', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }),
    health: text('health', { enum: GOAL_HEALTHS }).notNull().default('on_track'),
    progressMode: text('progress_mode', { enum: GOAL_PROGRESS_MODES }).notNull().default('key_results'),
    /** 0-100, used when progress_mode = manual. */
    manualProgress: integer('manual_progress').notNull().default(0),
    color: text('color').notNull().default('blue'),
    position: text('position').notNull(),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('goals_org_idx').on(t.orgId).where(sql`${t.deletedAt} IS NULL`)],
);

export const goalKeyResults = pmSchema.table(
  'goal_key_results',
  {
    id: id(),
    orgId: orgId(),
    goalId: uuid('goal_id')
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind', { enum: KEY_RESULT_KINDS }).notNull().default('number'),
    startValue: doublePrecision('start_value').notNull().default(0),
    targetValue: doublePrecision('target_value').notNull().default(100),
    currentValue: doublePrecision('current_value').notNull().default(0),
    unit: text('unit'),
    /** kind = project: progress rolls up from this project's task completion. */
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    position: text('position').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('goal_key_results_goal_idx').on(t.goalId)],
);

/** Projects contributing to a goal (progress_mode = projects rolls up their completion). */
export const goalProjects = pmSchema.table(
  'goal_projects',
  {
    goalId: uuid('goal_id')
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    orgId: orgId(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'goal_projects_pkey', columns: [t.goalId, t.projectId] }),
    index('goal_projects_project_idx').on(t.projectId),
  ],
);

/** A named view. `project_id` null = cross-project (My Work); `user_id` null = shared with the project. */
export const savedViews = pmSchema.table(
  'saved_views',
  {
    id: id(),
    orgId: orgId(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id'),
    name: text('name').notNull(),
    type: text('type', { enum: VIEW_TYPES }).notNull(),
    /** `work` (projects and My Work), `programs` (program directory) or `floor` (Floor today). */
    surface: text('surface', { enum: VIEW_SURFACES }).notNull().default('work'),
    config: jsonb('config').$type<ViewConfig>().notNull().default(sql`'{}'::jsonb`),
    isDefault: boolean('is_default').notNull().default(false),
    position: text('position').notNull(),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('saved_views_project_idx').on(t.orgId, t.projectId)],
);

/** One dashboard widget (layout + widget-specific options). */
export interface DashboardWidget {
  readonly id: string;
  readonly type: string;
  readonly title?: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly options?: Record<string, unknown>;
}

export const dashboards = pmSchema.table(
  'dashboards',
  {
    id: id(),
    orgId: orgId(),
    /** null = portfolio dashboard across projects. */
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    widgets: jsonb('widgets').$type<DashboardWidget[]>().notNull().default(sql`'[]'::jsonb`),
    /** Filters applied to every widget (project ids, assignees, date range). */
    filters: jsonb('filters').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    position: text('position').notNull(),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('dashboards_org_idx').on(t.orgId)],
);

export type Goal = typeof goals.$inferSelect;
export type GoalKeyResult = typeof goalKeyResults.$inferSelect;
export type GoalProject = typeof goalProjects.$inferSelect;
export type SavedView = typeof savedViews.$inferSelect;
export type Dashboard = typeof dashboards.$inferSelect;
