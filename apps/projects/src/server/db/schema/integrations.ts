/** Links from tasks/projects to records in CRM, WMS and the shared customer registry. */
import { sql } from 'drizzle-orm';
import { index, jsonb, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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
