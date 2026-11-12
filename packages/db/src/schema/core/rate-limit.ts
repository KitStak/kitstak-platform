/**
 * core.rate_limit — Better Auth's database rate-limit storage (auth review 2026-11-11,
 * M4): `createAuth` sets `rateLimit.storage: 'database'`, so auth-path counters are
 * durable and shared across serverless instances instead of per-process memory.
 *
 * Hand-written (NOT managed by the CRM `auth:schema` generator): the TS property keys
 * (`key`, `count`, `lastRequest`) must match Better Auth's rateLimit model field names —
 * the Drizzle adapter resolves fields against these keys, while the DB columns stay
 * snake_case. Created by apps/wms/drizzle/0008 and apps/crm/drizzle/0004 (IF NOT EXISTS
 * on both, so either app can run first against the shared database).
 */
import { sql } from 'drizzle-orm';
import { bigint, integer, text, uuid } from 'drizzle-orm/pg-core';
import { coreSchema } from '../_shared';

export const rateLimit = coreSchema.table('rate_limit', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  key: text('key').notNull().unique(),
  count: integer('count').notNull().default(0),
  /** Epoch milliseconds (Better Auth stores `Date.now()`). */
  lastRequest: bigint('last_request', { mode: 'number' }).notNull().default(0),
});

export type RateLimitRow = typeof rateLimit.$inferSelect;
