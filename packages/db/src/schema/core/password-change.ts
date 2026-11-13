/**
 * core.password_change_required — users who must replace an administrator-set password
 * before using the portal or CRM (drizzle/0003_core_password_change_required.sql).
 *
 * The row stores the credential hash that was current when the requirement was set. It is
 * in force only while `core.account.password` still equals that hash, so any successful
 * password change lifts it and a stale row is inert. Read it through
 * `isPasswordChangeRequired` (../../password-change.ts), never by row existence alone.
 */
import { sql } from 'drizzle-orm';
import { check, text, uuid } from 'drizzle-orm/pg-core';
import { coreSchema, createdAt } from '../_shared';
import { user } from './auth';

export const PASSWORD_CHANGE_REASONS = ['provisioned', 'admin_reset'] as const;
export type PasswordChangeReason = (typeof PASSWORD_CHANGE_REASONS)[number];

export const passwordChangeRequired = coreSchema.table(
  'password_change_required',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** `core.account.password` at the time the requirement was set. Never a plaintext password. */
    credentialHash: text('credential_hash').notNull(),
    reason: text('reason', { enum: PASSWORD_CHANGE_REASONS }).notNull().default('provisioned'),
    createdAt: createdAt(),
  },
  (t) => [check('password_change_required_reason_check', sql`${t.reason} IN ('provisioned', 'admin_reset')`)],
);

export type PasswordChangeRequiredRow = typeof passwordChangeRequired.$inferSelect;
