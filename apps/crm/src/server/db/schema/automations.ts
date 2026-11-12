import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { automationRunStatusEnum, createdAt, deletedAt, id, orgId, timestamps, userRef } from './_shared';
import { boards, items } from './boards';

/** Recipe parts are validated by the automations engine (src/server/automations-engine). */
export interface AutomationTrigger {
  readonly type: string;
  readonly config?: Record<string, unknown>;
}
export interface AutomationCondition {
  readonly type: string;
  readonly config?: Record<string, unknown>;
}
export interface AutomationAction {
  readonly type: string;
  readonly config?: Record<string, unknown>;
}

export const automations = pgTable(
  'automations',
  {
    id: id(),
    orgId: orgId(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    trigger: jsonb('trigger').$type<AutomationTrigger>().notNull(),
    conditions: jsonb('conditions').$type<AutomationCondition[]>().notNull().default([]),
    actions: jsonb('actions').$type<AutomationAction[]>().notNull().default([]),
    enabled: boolean('enabled').notNull().default(true),
    runCount: integer('run_count').notNull().default(0),
    failureCount: integer('failure_count').notNull().default(0),
    lastRunAt: timestamp('last_run_at', { withTimezone: true, mode: 'date' }),
    createdBy: userRef('created_by'),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('automations_board_idx')
      .on(t.boardId)
      .where(sql`${t.deletedAt} is null`),
    index('automations_org_idx').on(t.orgId),
  ],
);

export const automationRuns = pgTable(
  'automation_runs',
  {
    id: id(),
    orgId: orgId(),
    automationId: uuid('automation_id')
      .notNull()
      .references(() => automations.id, { onDelete: 'cascade' }),
    boardId: uuid('board_id').references(() => boards.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id').references(() => items.id, { onDelete: 'set null' }),
    status: automationRunStatusEnum('status').notNull().default('pending'),
    triggerEvent: jsonb('trigger_event').$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb('result').$type<Record<string, unknown>>(),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
    durationMs: integer('duration_ms'),
    createdAt: createdAt(),
    updatedAt: timestamps().updatedAt,
  },
  (t) => [
    index('automation_runs_automation_created_idx').on(t.automationId, t.createdAt),
    index('automation_runs_org_created_idx').on(t.orgId, t.createdAt),
    index('automation_runs_pending_idx')
      .on(t.status)
      .where(sql`${t.status} in ('pending', 'running')`),
  ],
);
