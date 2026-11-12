/**
 * wms.user_profiles — WMS-only identity columns off core.user (BLUEPRINT.md §2.3).
 */
import { sql } from 'drizzle-orm';
import { boolean, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { wmsSchema } from '../_shared';

export const WMS_LEGACY_ROLES = ['admin', 'manager', 'operator', 'viewer'] as const;
export type WmsLegacyRole = (typeof WMS_LEGACY_ROLES)[number];

export const userProfiles = wmsSchema.table('user_profiles', {
  /**
   * TODO(Phase 3): add the drizzle FK `.references(() => user.id, { onDelete: 'cascade' })`
   * once Better Auth core."user" relocates; SQL FK deferred in drizzle/0001_core_fks.sql.
   */
  userId: uuid('user_id').primaryKey(),
  legacyRole: text('legacy_role', { enum: WMS_LEGACY_ROLES }).notNull().default('viewer'),
  userType: text('user_type').notNull().default('Operation'),
  isApiUser: boolean('is_api_user').notNull().default(false),
  allClients: boolean('all_clients').notNull().default(true),
  preferences: jsonb('preferences')
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true, mode: 'date' }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'date' }),
});

export type WmsUserProfile = typeof userProfiles.$inferSelect;
export type NewWmsUserProfile = typeof userProfiles.$inferInsert;
