/**
 * core.password_policy_state — lockout state owned by @kitstak/auth's
 * `passwordPolicyPlugin` (model `passwordPolicyState`). Hand-written (NOT managed by the
 * CRM `auth:schema` generator, which only emits core Better Auth tables): keep the shape
 * in lockstep with `packages/auth/src/password-policy-plugin.ts`.
 * Created by apps/wms/drizzle/0007_core_auth.sql.
 */
import { sql } from 'drizzle-orm';
import { integer, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { coreSchema } from '../_shared';

export const passwordPolicyState = coreSchema.table('password_policy_state', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: text('email').notNull().unique(),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: timestamp('locked_until'),
});

export type PasswordPolicyStateRow = typeof passwordPolicyState.$inferSelect;
