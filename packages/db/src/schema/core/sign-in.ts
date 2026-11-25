/**
 * Sign in facts the shared auth layer owns (drizzle/0011_core_sign_in_round4.sql).
 *
 * core.sign_in_blocks: a person with a row here is switched off. `createAuth` in @kitstak/auth
 * reads it at every door of every app, so no sign in, session, password reset or emailed code
 * works for them. Write it through `blockSignIn` / `unblockSignIn` in @kitstak/auth, never by hand
 * in app code.
 *
 * core.user_last_org: the organization a person worked in last. A new session starts there.
 */
import { text, uuid } from 'drizzle-orm/pg-core';
import { coreSchema, createdAt, updatedAt } from '../_shared';
import { organization, user } from './auth';

export const SIGN_IN_BLOCK_REASONS = ['deactivated'] as const;
export type SignInBlockReason = (typeof SIGN_IN_BLOCK_REASONS)[number];

export const signInBlocks = coreSchema.table('sign_in_blocks', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  reason: text('reason').notNull().default('deactivated'),
  /** Who switched the person off. Kept after that person is deleted, so it is not a foreign key. */
  blockedBy: uuid('blocked_by'),
  createdAt: createdAt(),
});

export const userLastOrg = coreSchema.table('user_last_org', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  updatedAt: updatedAt(),
});

export type SignInBlockRow = typeof signInBlocks.$inferSelect;
export type UserLastOrgRow = typeof userLastOrg.$inferSelect;
