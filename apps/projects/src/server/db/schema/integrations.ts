/** Links from tasks/projects to records in CRM, WMS and the shared customer registry. */
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { INTEGRATION_TARGET_TYPES } from '@/lib/constants';
import { createdAt, id, orgId, pmSchema, tstz } from './_shared';
import { projects } from './projects';
import { tasks } from './tasks';

/**
 * Exactly one of `project_id` / `task_id` is set (CHECK in SQL). `target_id` is text because
 * WMS ids are text; CRM/core ids are uuids stored as text. Cached fields let chips render
 * without a cross-schema read; src/server/integrations refreshes them.
 */
export const integrationLinks = pmSchema.table(
  'integration_links',
  {
    id: id(),
    orgId: orgId(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    targetType: text('target_type', { enum: INTEGRATION_TARGET_TYPES }).notNull(),
    targetId: text('target_id').notNull(),
    cachedTitle: text('cached_title'),
    cachedStatus: text('cached_status'),
    cachedUrl: text('cached_url'),
    cachedAt: tstz('cached_at'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('integration_links_task_target_unique')
      .on(t.taskId, t.targetType, t.targetId)
      .where(sql`${t.taskId} IS NOT NULL`),
    uniqueIndex('integration_links_project_target_unique')
      .on(t.projectId, t.targetType, t.targetId)
      .where(sql`${t.projectId} IS NOT NULL`),
    index('integration_links_target_idx').on(t.orgId, t.targetType, t.targetId),
  ],
);

export type IntegrationLink = typeof integrationLinks.$inferSelect;
export type NewIntegrationLink = typeof integrationLinks.$inferInsert;

/**
 * Cross-app event inbox (drizzle/0001_integration_events.sql). CRM / WMS insert rows through
 * @kitstak/pm-bridge; src/server/integrations/events.ts drains them into automation events.
 */
export const INTEGRATION_EVENT_KINDS = ['record_status_changed', 'task_created'] as const;
export type IntegrationEventKind = (typeof INTEGRATION_EVENT_KINDS)[number];
export const INTEGRATION_EVENT_SOURCES = ['crm', 'wms', 'portal', 'projects'] as const;

export const integrationEvents = pmSchema.table(
  'integration_events',
  {
    id: id(),
    orgId: orgId(),
    source: text('source', { enum: INTEGRATION_EVENT_SOURCES }).notNull(),
    kind: text('kind', { enum: INTEGRATION_EVENT_KINDS }).notNull(),
    targetType: text('target_type', { enum: INTEGRATION_TARGET_TYPES }),
    targetId: text('target_id'),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    title: text('title'),
    beforeStatus: text('before_status'),
    afterStatus: text('after_status'),
    url: text('url'),
    actorId: uuid('actor_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    processedAt: tstz('processed_at'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
  },
  (t) => [
    index('integration_events_pending_idx').on(t.orgId, t.createdAt).where(sql`${t.processedAt} IS NULL`),
    index('integration_events_target_idx').on(t.orgId, t.targetType, t.targetId, t.createdAt),
  ],
);
