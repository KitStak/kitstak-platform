/**
 * Column helpers and enums shared by every domain table.
 * Conventions: uuid PK (`gen_random_uuid()`), `org_id` FK → organization (cascade),
 * `created_at` / `updated_at` timestamptz, optional `deleted_at` for soft delete.
 */
import { customType, pgEnum, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { COLUMN_TYPES } from './cell-values';
import { organization, user } from './auth';

export const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);

export const orgId = () =>
  uuid('org_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' });

/** Nullable user reference that survives user deletion (audit-style attribution). */
export const userRef = (name: string) => uuid(name).references(() => user.id, { onDelete: 'set null' });

/** Required user reference removed with the user (per-user rows: favorites, notifications...). */
export const ownedByUser = (name = 'user_id') =>
  uuid(name)
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' });

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const deletedAt = () => timestamp('deleted_at', { withTimezone: true, mode: 'date' });

export const archivedAt = () => timestamp('archived_at', { withTimezone: true, mode: 'date' });

export const timestamps = () => ({ createdAt: createdAt(), updatedAt: updatedAt() });

/**
 * Fractional-index position key (see `fractional-indexing`). Stored with the "C" collation so
 * that Postgres orders keys byte-wise, exactly as the library compares them.
 */
export const fractionalKey = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'text COLLATE "C"';
  },
});

// ------------------------------------------------------------------------------------------
// Enums
// ------------------------------------------------------------------------------------------

export const workspaceKindEnum = pgEnum('workspace_kind', ['open', 'closed']);
export const workspaceRoleEnum = pgEnum('workspace_role', ['owner', 'member']);
export const boardKindEnum = pgEnum('board_kind', [
  'leads',
  'contacts',
  'accounts',
  'deals',
  'activities',
  'projects',
  'custom',
]);
export const boardPrivacyEnum = pgEnum('board_privacy', ['main', 'private', 'shareable']);
export const boardRoleEnum = pgEnum('board_role', ['owner', 'editor', 'viewer', 'subscriber']);
export const columnTypeEnum = pgEnum('column_type', COLUMN_TYPES);
export const columnScopeEnum = pgEnum('column_scope', ['item', 'subitem']);
export const viewTypeEnum = pgEnum('view_type', [
  'table',
  'kanban',
  'calendar',
  'timeline',
  'chart',
  'form',
  'dashboard',
  'files',
]);
export const widgetTypeEnum = pgEnum('widget_type', [
  'number',
  'chart',
  'battery',
  'table',
  'calendar',
  'timeline',
  'workload',
  'leaderboard',
  'funnel',
  'text',
]);
export const automationRunStatusEnum = pgEnum('automation_run_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
  'skipped',
]);
export const notificationKindEnum = pgEnum('notification_kind', [
  'mention',
  'assigned',
  'update_reply',
  'update_on_subscribed',
  'status_change',
  'due_date',
  'invitation',
  'automation',
  'reaction',
  'board_shared',
]);
export const entityTypeEnum = pgEnum('entity_type', [
  'workspace',
  'folder',
  'board',
  'dashboard',
  'item',
  'view',
]);
